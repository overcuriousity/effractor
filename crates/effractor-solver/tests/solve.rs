mod common;

use common::*;
use effractor_core::{Distribution as D, *};
use effractor_solver::{Config, Solve, SolveError, solve};

fn rate(r: f64) -> Node {
    Node::leaf("leaf", LeafKind::Basic, Some(Ttc::Rate(r)))
}

fn control(enabled: bool, cost: f64, node: &str, ttc: D) -> Control {
    Control {
        label: "control".into(),
        description: None,
        cost,
        enabled,
        effects: vec![Effect {
            node: id(node),
            ttc,
        }],
    }
}

/// The course's reference tree, with an asset and four controls.
fn webserver() -> Model {
    let mut m = model(
        "top",
        vec![
            ("top", gate(Gate::Or, &["access", "function"])),
            ("access", gate(Gate::Or, &["admin", "network", "server"])),
            (
                "function",
                gate(Gate::Or, &["hardware", "software", "malware", "server"]),
            ),
            ("admin", rate(7e-7)),
            ("network", rate(3.5e-7)),
            ("server", rate(2.5e-6)),
            ("hardware", rate(1.3e-6)),
            ("software", rate(2.3e-7)),
            (
                "malware",
                Node::leaf("Malware", LeafKind::Undeveloped, Some(Ttc::P(0.004))),
            ),
        ],
    );
    m.horizon = 8760.0;
    m.assets.insert(
        id("web"),
        Asset {
            label: "Webserver".into(),
            description: None,
            loss: Loss {
                c: None,
                i: None,
                a: Some(D::Pert {
                    min: 60_000.0,
                    mode: 120_000.0,
                    max: 400_000.0,
                }),
            },
        },
    );
    m.nodes[&id::<NodeId>("top")]
        .consequences
        .push(Consequence {
            asset: id("web"),
            dim: Dim::A,
            fraction: 1.0,
        });
    m.controls
        .insert(id("cluster"), control(false, 4000.0, "server", D::Infinity));
    m.controls.insert(
        id("psu"),
        control(false, 1800.0, "hardware", D::Exponential(4e-7)),
    );
    m.controls.insert(
        id("placebo"),
        control(false, 500.0, "software", D::Exponential(2.3e-7)),
    );
    m.controls.insert(
        id("edr"),
        control(true, 3000.0, "malware", D::Bernoulli(0.001)),
    );
    m
}

fn cfg(m: &Model) -> Config {
    Config {
        samples: 20_000,
        ..Config::from_model(m)
    }
}

#[test]
fn the_reference_tree() {
    let m = webserver();
    let r = solve(&m, &cfg(&m)).unwrap();
    assert_eq!((r.schema, r.profile, r.time_unit), (1, "fault-tree", "h"));

    let cuts = r.cut_sets.available().unwrap();
    assert_eq!(
        (cuts.total.as_str(), cuts.sets.len(), &cuts.truncated),
        ("6", 6, &None)
    );
    assert!(
        r.leaves.iter().all(|l| l.spof),
        "an OR tree is all single points of failure"
    );

    let exact = r.exact.available().unwrap();
    let sampled = r.sampled.available().unwrap();
    assert!(
        sampled.p_top_ci.lo <= exact.p_top && exact.p_top <= sampled.p_top_ci.hi,
        "{} vs {:?}",
        exact.p_top,
        sampled.p_top_ci
    );
    assert_eq!(exact.ttc_cdf.len(), 65);
    assert_eq!(exact.ttc_cdf[64], (8760.0, exact.p_top));
    // edr is enabled, so malware is at 0.001, not the 0.004 the leaf says.
    let malware = r.leaves.iter().find(|l| l.id == "malware").unwrap();
    assert_eq!(malware.p, Some(0.001));
    let server = r.leaves.iter().find(|l| l.id == "server").unwrap();
    assert!(
        r.leaves
            .iter()
            .all(|l| l.fussell_vesely <= server.fussell_vesely)
    );

    let top = r.nodes.iter().find(|n| n.id == "top").unwrap();
    assert_eq!(top.p_exact, Some(exact.p_top));
    assert_eq!(top.p_sampled, Some(sampled.p_top));
    assert!(r.attacker.is_none(), "a fault tree has no attacker");

    let loss = sampled.loss.as_ref().unwrap();
    let pert_mean = (60_000.0 + 4.0 * 120_000.0 + 400_000.0) / 6.0;
    assert!(
        (loss.mean / (exact.p_top * pert_mean) - 1.0).abs() < 0.1,
        "{}",
        loss.mean
    );
}

#[test]
fn controls_are_ranked_by_what_they_buy() {
    let m = webserver();
    let r = solve(&m, &cfg(&m)).unwrap();
    let c = r.controls.available().unwrap();
    assert_eq!(c.measure, "expected_loss");
    assert_eq!(
        c.baseline,
        r.sampled.available().unwrap().loss.as_ref().unwrap().mean
    );
    let by = |id: &str| c.controls.iter().find(|x| x.id == id).unwrap();

    // Blocking the biggest single point of failure is the best buy — per euro,
    // which is the ranking: at 9000 instead of 4000 the PSU would win.
    assert_eq!(by("cluster").rank, Some(1));
    assert!(by("cluster").value_per_cost > by("psu").value_per_cost);
    assert!(by("cluster").value > by("psu").value && by("psu").value > Some(0.0));
    assert_eq!(by("psu").rank, Some(2));
    // …and a control that changes nothing is worth exactly nothing: the same
    // seed gives the same draws, so this is 0, not "about 0".
    assert_eq!(by("placebo").value, Some(0.0));
    assert_eq!(by("placebo").flipped, Some(c.baseline));
    let zero = by("placebo").value_ci.as_ref().unwrap();
    assert_eq!((zero.lo, zero.hi), (0.0, 0.0));
    // Paired, so the interval is about the control and excludes zero, where the
    // two expected losses' own intervals overlap almost entirely.
    let ci = by("cluster").value_ci.as_ref().unwrap();
    assert!(
        ci.lo > 0.0 && Some(ci.lo) <= by("cluster").value && by("cluster").value <= Some(ci.hi),
        "{ci:?}"
    );
    let loss = r.sampled.available().unwrap().loss.as_ref().unwrap();
    assert!(ci.hi - ci.lo < loss.mean_ci.hi - loss.mean_ci.lo);
    assert_eq!(by("placebo").rank, Some(3));
    // An enabled control is valued by what removing it would cost; it is not ranked.
    assert!(by("edr").value > Some(0.0) && by("edr").flipped > Some(c.baseline));
    assert_eq!((by("edr").rank, by("edr").value_per_cost), (None, None));
    assert_eq!(
        by("cluster").value_per_cost,
        by("cluster").value.map(|v| v / 4000.0)
    );
}

#[test]
fn without_losses_controls_are_measured_exactly_and_nothing_extra_is_sampled() {
    let mut m = webserver();
    m.assets.clear();
    m.nodes[&id::<NodeId>("top")].consequences.clear();
    let s = Solve::begin(&m, &cfg(&m)).unwrap();
    assert_eq!(
        s.progress().total,
        5,
        "20 000 samples is 5 chunks, for the baseline only"
    );
    let r = s.finish();
    let c = r.controls.available().unwrap();
    assert_eq!(
        (c.measure, c.baseline),
        ("p_top", r.exact.available().unwrap().p_top)
    );
    assert_eq!(
        c.controls.iter().find(|x| x.id == "cluster").unwrap().rank,
        Some(1)
    );
    assert!(r.sampled.available().unwrap().loss.is_none());
}

#[test]
fn stepping_is_the_same_computation() {
    let m = webserver();
    let mut s = Solve::begin(&m, &cfg(&m)).unwrap();
    // Everything exact is there before the first sample.
    assert!(s.exact().available().is_some() && s.cut_sets().available().is_some());
    let total = s.progress().total;
    assert_eq!(total, 5 * 5, "baseline and four flips, five chunks each");
    let mut seen = vec![];
    while s.progress().done < total {
        seen.push(s.step().done);
    }
    assert_eq!(seen, (1..=total).collect::<Vec<_>>());
    assert_eq!(s.step().done, total, "stepping past the end is harmless");
    assert_eq!(s.finish(), solve(&m, &cfg(&m)).unwrap());
}

#[test]
fn an_invalid_model_is_refused_with_its_diagnostics() {
    let mut m = webserver();
    m.nodes.insert(id("access"), gate(Gate::Or, &["ghost"]));
    let Err(SolveError::Invalid(d)) = solve(&m, &cfg(&m)) else {
        panic!("should not solve")
    };
    assert!(d.iter().any(|d| d.code == Code::UnknownChild));
}

#[test]
fn a_leaf_without_numbers_costs_only_the_numbers() {
    let mut m = webserver();
    m.nodes.insert(
        id("malware"),
        Node::leaf("Malware", LeafKind::Undeveloped, None),
    );
    m.controls.shift_remove(&id::<ControlId>("edr"));
    let r = solve(&m, &cfg(&m)).unwrap();
    let cuts = r.cut_sets.available().unwrap();
    assert_eq!(cuts.sets.len(), 6);
    assert!(cuts.sets.iter().all(|s| s.probability.is_none()));
    assert!(
        r.leaves
            .iter()
            .all(|l| l.spof && l.p.is_none() && l.birnbaum.is_none())
    );
    for reason in [
        format!("{:?}", r.exact),
        format!("{:?}", r.sampled),
        format!("{:?}", r.controls),
    ] {
        assert!(reason.contains("no distribution on: malware"), "{reason}");
    }
}

/// A leaf may get its numbers only from a control that is on. Switching that
/// control off leaves the leaf without any: that one flip cannot be measured,
/// says why, and costs nothing else.
#[test]
fn a_flip_that_takes_a_leafs_only_numbers_is_unavailable_not_a_crash() {
    let text = r#"effractor: 1
profile: fault-tree
name: t
time_unit: h
horizon: 10
top: top
nodes:
  top:
    label: Top
    gate: or
    children: [a, b]
  a:
    label: A
    leaf: basic
  b:
    label: B
    leaf: basic
    p: 0.1
controls:
  c:
    label: C
    cost: 1
    enabled: true
    effects:
      - {node: a, ttc: "Exponential(mean 5)"}
  d:
    label: D
    cost: 1
    enabled: false
    effects:
      - {node: b, ttc: "1%"}
"#;
    let (doc, diagnostics) = effractor_format::diagnose_document(text);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    let Some(Document::Tree(m)) = doc else {
        panic!("a tree")
    };
    let r = solve(&m, &cfg(&m)).unwrap();
    assert!(r.exact.available().is_some() && r.sampled.available().is_some());
    let c = r.controls.available().unwrap();
    let by = |id: &str| c.controls.iter().find(|x| x.id == id).unwrap();
    assert_eq!(
        (by("c").flipped, by("c").value, by("c").rank),
        (None, None, None)
    );
    assert_eq!(
        by("c").unavailable.as_deref(),
        Some("switched off, it leaves no distribution on: a")
    );
    assert!(by("d").unavailable.is_none());
    assert!(by("d").value.is_some_and(|v| v > 0.0));
    assert_eq!(by("d").rank, Some(1));
}

#[test]
fn past_the_node_limit_sampling_carries_on_alone() {
    let mut m = webserver();
    m.assets.clear();
    m.nodes[&id::<NodeId>("top")].consequences.clear();
    let r = solve(
        &m,
        &Config {
            bdd_node_limit: 4,
            ..cfg(&m)
        },
    )
    .unwrap();
    assert!(format!("{:?}", r.exact).contains("NodeLimit(4)"));
    assert!(r.cut_sets.available().is_none());
    assert!(
        r.leaves
            .iter()
            .all(|l| l.p.is_some() && l.birnbaum.is_none())
    );
    let sampled = r.sampled.available().unwrap();
    let c = r.controls.available().unwrap();
    assert_eq!(
        (c.measure, c.baseline),
        ("p_top", sampled.p_top),
        "the sampled value stands in"
    );
    assert_eq!(
        c.controls.iter().find(|x| x.id == "placebo").unwrap().value,
        Some(0.0)
    );
    assert_eq!(
        c.controls.iter().find(|x| x.id == "cluster").unwrap().rank,
        Some(1)
    );
}

/// Fussell–Vesely needs a function per leaf on top of the diagram; Birnbaum
/// only the diagram. A limit between the two costs Fussell–Vesely alone, and
/// says so.
#[test]
fn a_limit_that_only_fussell_vesely_needs_costs_only_fussell_vesely() {
    // "Some cut set with a holds" is a ∧ (b ∨ c), which top's diagram lacks.
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Vote { k: 2 }, &["a", "b", "c"])),
            ("a", leaf(0.1)),
            ("b", leaf(0.2)),
            ("c", leaf(0.3)),
        ],
    );
    let base = effractor_solver::bdd::Bdd::compile(&m, usize::MAX)
        .unwrap()
        .size();
    let full = solve(&m, &cfg(&m)).unwrap();
    let r = solve(
        &m,
        &Config {
            bdd_node_limit: base,
            ..cfg(&m)
        },
    )
    .unwrap();
    assert!(r.cut_sets.available().is_some());
    let exact = r.exact.available().unwrap();
    assert_eq!(exact.p_top, full.exact.available().unwrap().p_top);
    for (leaf, want) in r.leaves.iter().zip(&full.leaves) {
        assert_eq!(
            (leaf.birnbaum, leaf.fussell_vesely),
            (want.birnbaum, None),
            "{}",
            leaf.id
        );
    }
    assert_eq!(
        exact.fussell_vesely_unavailable.as_deref(),
        Some(format!("Fussell–Vesely gave up: NodeLimit({base})").as_str())
    );
    assert_eq!(
        full.exact.available().unwrap().fussell_vesely_unavailable,
        None
    );
}

#[test]
fn cut_set_limits_are_reported() {
    let m = webserver();
    let r = solve(
        &m,
        &Config {
            mcs_max_sets: 2,
            ..cfg(&m)
        },
    )
    .unwrap();
    let cuts = r.cut_sets.available().unwrap();
    assert_eq!((cuts.total.as_str(), cuts.sets.len()), ("6", 2));
    assert_eq!(
        cuts.truncated.as_deref(),
        Some("only the 2 smallest cut sets are listed")
    );
}

#[test]
fn spofs_do_not_depend_on_cut_set_or_bdd_limits() {
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Or, &["s1", "s2", "pair"])),
            ("s1", leaf(0.1)),
            ("s2", leaf(0.2)),
            ("pair", gate(Gate::And, &["a", "b"])),
            ("a", leaf(0.3)),
            ("b", leaf(0.4)),
        ],
    );
    for (bdd_node_limit, mcs_max_sets, mcs_max_order) in [
        (1_000_000, 10_000, None),
        (1_000_000, 1, None),
        (1_000_000, 0, None),
        (1_000_000, 10_000, Some(0)),
        (2, 10_000, None),
    ] {
        let r = solve(
            &m,
            &Config {
                samples: 10,
                bdd_node_limit,
                mcs_max_sets,
                mcs_max_order,
                ..Config::from_model(&m)
            },
        )
        .unwrap();
        for leaf in r.leaves {
            assert_eq!(
                leaf.spof,
                matches!(leaf.id.as_str(), "s1" | "s2"),
                "{} with BDD limit {bdd_node_limit}, set cap {mcs_max_sets}, order {mcs_max_order:?}",
                leaf.id
            );
        }
    }
}

#[test]
fn a_leaf_top_is_a_structural_spof_even_with_zero_probability_and_no_bdd() {
    let m = model("top", vec![("top", leaf(0.0))]);
    let r = solve(
        &m,
        &Config {
            samples: 10,
            bdd_node_limit: 2,
            ..Config::from_model(&m)
        },
    )
    .unwrap();
    assert!(r.cut_sets.available().is_none());
    assert_eq!(r.leaves.len(), 1);
    assert_eq!(r.leaves[0].p, Some(0.0));
    assert!(r.leaves[0].spof);
}

#[test]
fn spofs_without_bdd_handle_shared_events_and_voting_without_probabilities() {
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Vote { k: 2 }, &["left", "right", "c"])),
            ("left", gate(Gate::Or, &["s", "a"])),
            ("right", gate(Gate::Or, &["s", "b"])),
            ("s", Node::leaf("S", LeafKind::Undeveloped, None)),
            ("a", Node::leaf("A", LeafKind::Basic, None)),
            ("b", Node::leaf("B", LeafKind::Basic, None)),
            ("c", Node::leaf("C", LeafKind::Basic, None)),
        ],
    );
    let r = solve(
        &m,
        &Config {
            bdd_node_limit: 2,
            ..Config::from_model(&m)
        },
    )
    .unwrap();
    assert!(r.cut_sets.available().is_none());
    assert!(r.exact.available().is_none());
    for leaf in r.leaves {
        assert_eq!(leaf.spof, leaf.id == "s", "{}", leaf.id);
    }
}

fn attack_tree() -> Model {
    let step = |ttc: &str, cost: Option<f64>, detection: Option<f64>| {
        let d = match ttc {
            "easy" => D::Named(Shorthand::EasyAndCertain),
            "hard" => D::Named(Shorthand::HardAndUncertain),
            _ => D::Named(Shorthand::VeryHardAndCertain),
        };
        let mut n = Node::leaf("step", LeafKind::Basic, Some(Ttc::Expr(d)));
        if let NodeKind::Leaf(l) = &mut n.kind {
            (l.cost, l.detection) = (cost, detection);
        }
        n
    };
    let mut m = model(
        "admin",
        vec![
            ("admin", gate(Gate::Or, &["phish-then-escalate", "exploit"])),
            (
                "phish-then-escalate",
                gate(Gate::And, &["phish", "escalate"]),
            ),
            ("phish", step("easy", Some(200.0), Some(0.3))),
            ("escalate", step("hard", Some(1000.0), Some(0.2))),
            ("exploit", step("very-hard", Some(50_000.0), None)),
        ],
    );
    m.profile = Profile::AttackTree;
    m.time_unit = TimeUnit::Days;
    m.horizon = 30.0;
    m
}

#[test]
fn an_attack_tree_has_an_attacker() {
    let m = attack_tree();
    let r = solve(&m, &cfg(&m)).unwrap();
    let a = r.attacker.as_ref().unwrap().available().unwrap();
    assert_eq!(a.attacks.len(), 2);
    let cheapest = &a.attacks[a.cheapest.unwrap()];
    assert_eq!(
        (cheapest.leaves.as_slice(), cheapest.cost),
        (
            ["phish".to_string(), "escalate".to_string()].as_slice(),
            1200.0
        )
    );
    assert!(
        a.attacks.iter().all(|x| x.on_front),
        "cheap and loud, or dear and silent: a real trade-off"
    );
    assert_eq!(
        (a.assumed_free.len(), a.assumed_unnoticed.as_slice()),
        (0, ["exploit".to_string()].as_slice())
    );
}

/// The results file is an interface: the UI and anything reading exports
/// depend on its shape, and on its numbers being the same in the browser as
/// here. `UPDATE_SNAPSHOTS=1 cargo test` rewrites it; CI also runs this under
/// wasmtime against the same file.
#[test]
fn results_json_is_stable_and_identical_under_wasm() {
    let m = webserver();
    let got = serde_json::to_string_pretty(
        &solve(
            &m,
            &Config {
                samples: 8192,
                ..cfg(&m)
            },
        )
        .unwrap(),
    )
    .unwrap()
        + "\n";
    if std::env::var_os("UPDATE_SNAPSHOTS").is_some() {
        std::fs::write("tests/snapshots/webserver.json", &got).unwrap();
    }
    assert!(
        got == include_str!("snapshots/webserver.json"),
        "results changed; if intended, rerun with UPDATE_SNAPSHOTS=1 and review the diff"
    );
}
