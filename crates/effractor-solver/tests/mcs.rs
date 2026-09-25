mod common;

use common::*;
use effractor_core::*;
use effractor_solver::bdd::Bdd;
use effractor_solver::importance::{birnbaum, fussell_vesely};
use effractor_solver::mcs::{CutSets, Truncated};
use proptest::prelude::*;

const LIMIT: usize = 1_000_000;

fn cut_sets(m: &Model) -> (Bdd, CutSets) {
    let bdd = Bdd::compile(m, LIMIT).unwrap();
    let z = CutSets::of(&bdd, bdd.root(), LIMIT).unwrap();
    (bdd, z)
}

fn named(bdd: &Bdd, sets: &[Vec<usize>]) -> Vec<Vec<String>> {
    sets.iter()
        .map(|s| s.iter().map(|v| bdd.vars()[*v].to_string()).collect())
        .collect()
}

fn leaf_p(m: &Model, bdd: &Bdd) -> Vec<f64> {
    bdd.vars()
        .iter()
        .map(|v| match &m.nodes[v].kind {
            NodeKind::Leaf(Leaf {
                ttc: Some(Ttc::P(p)),
                ..
            }) => *p,
            _ => unreachable!(),
        })
        .collect()
}

/// The course's reference tree: `server` is under both branches.
fn webserver() -> Model {
    model(
        "top",
        vec![
            ("top", gate(Gate::Or, &["access", "function"])),
            ("access", gate(Gate::Or, &["admin", "network", "server"])),
            (
                "function",
                gate(Gate::Or, &["hardware", "software", "malware", "server"]),
            ),
            ("admin", leaf(0.006)),
            ("network", leaf(0.003)),
            ("server", leaf(0.021)),
            ("hardware", leaf(0.011)),
            ("software", leaf(0.002)),
            ("malware", leaf(0.004)),
        ],
    )
}

#[test]
fn an_or_tree_is_all_single_points_of_failure_and_the_shared_leaf_appears_once() {
    let (bdd, z) = cut_sets(&webserver());
    let e = z.enumerate(None, 100);
    assert_eq!(
        named(&bdd, &e.sets),
        [
            ["admin"],
            ["network"],
            ["server"],
            ["hardware"],
            ["software"],
            ["malware"]
        ]
    );
    assert_eq!((e.total, e.truncated), (6, None));
}

#[test]
fn supersets_are_not_minimal() {
    // top = s or (a and b) or (a and b and c) or (s and c)
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Or, &["s", "ab", "abc", "sc"])),
            ("ab", gate(Gate::And, &["a", "b"])),
            ("abc", gate(Gate::And, &["a", "b", "c"])),
            ("sc", gate(Gate::And, &["s", "c"])),
            ("s", leaf(0.1)),
            ("a", leaf(0.1)),
            ("b", leaf(0.1)),
            ("c", leaf(0.1)),
        ],
    );
    let (bdd, z) = cut_sets(&m);
    assert_eq!(
        named(&bdd, &z.enumerate(None, 100).sets),
        [vec!["s"], vec!["a", "b"]]
    );
}

#[test]
fn two_of_three_has_the_three_pairs() {
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Vote { k: 2 }, &["a", "b", "c"])),
            ("a", leaf(0.1)),
            ("b", leaf(0.1)),
            ("c", leaf(0.1)),
        ],
    );
    let (bdd, z) = cut_sets(&m);
    assert_eq!(
        named(&bdd, &z.enumerate(None, 100).sets),
        [["a", "b"], ["a", "c"], ["b", "c"]]
    );
}

/// and(or(a0, b0), or(a1, b1), …): 2^n cut sets from a diagram linear in n.
fn wide(n: usize) -> Model {
    let names: Vec<String> = (0..n)
        .flat_map(|i| [format!("or{i}"), format!("a{i}"), format!("b{i}")])
        .collect();
    let mut nodes = vec![];
    let ors: Vec<&str> = (0..n).map(|i| names[3 * i].as_str()).collect();
    nodes.push(("top", gate(Gate::And, &ors)));
    for i in 0..n {
        nodes.push((
            names[3 * i].as_str(),
            gate(Gate::Or, &[&names[3 * i + 1], &names[3 * i + 2]]),
        ));
        nodes.push((names[3 * i + 1].as_str(), leaf(0.5)));
        nodes.push((names[3 * i + 2].as_str(), leaf(0.5)));
    }
    model("top", nodes)
}

#[test]
fn counting_does_not_need_listing() {
    let (_, z) = cut_sets(&wide(100));
    assert_eq!(z.total(), 1u128 << 100);
    assert!(z.size() < 1000, "{}", z.size());
    let e = z.enumerate(None, 50);
    assert_eq!(
        (e.sets.len(), e.truncated),
        (50, Some(Truncated::MaxSets(50)))
    );
    assert!(e.sets.iter().all(|s| s.len() == 100));
}

#[test]
fn limits_are_reported_and_small_sets_survive_them() {
    // s alone, or all of a0..a3: one set of order 1, one of order 4.
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Or, &["all", "s"])),
            ("all", gate(Gate::And, &["a0", "a1", "a2", "a3"])),
            ("a0", leaf(0.5)),
            ("a1", leaf(0.5)),
            ("a2", leaf(0.5)),
            ("a3", leaf(0.5)),
            ("s", leaf(0.5)),
        ],
    );
    let (bdd, z) = cut_sets(&m);
    let e = z.enumerate(Some(2), 100);
    assert_eq!(named(&bdd, &e.sets), [["s"]]);
    assert_eq!((e.total, e.truncated), (2, Some(Truncated::MaxOrder(2))));
    let e = z.enumerate(None, 1);
    assert_eq!(
        named(&bdd, &e.sets),
        [["s"]],
        "the single point of failure is what truncation keeps"
    );
    assert_eq!(e.truncated, Some(Truncated::MaxSets(1)));
    assert_eq!(z.enumerate(Some(4), 100).truncated, None);
}

#[test]
fn degenerate_tops() {
    // A model that is one leaf: that leaf is the only cut set.
    let m = model("top", vec![("top", leaf(0.5))]);
    let (_, z) = cut_sets(&m);
    assert_eq!(z.enumerate(None, 10).sets, [vec![0]]);
}

#[test]
fn importance_on_the_reference_tree() {
    let m = webserver();
    let (mut bdd, z) = cut_sets(&m);
    let p = leaf_p(&m, &bdd);
    let top = bdd.root();
    let b = birnbaum(&bdd, top, &p);
    let fv = fussell_vesely(&mut bdd, top, &z, &p).unwrap();
    let p_top = 1.0 - p.iter().map(|p| 1.0 - p).product::<f64>();
    for v in 0..p.len() {
        // In a pure OR tree: Birnbaum is the product of the other survivals,
        // and the only cut set containing a leaf is the leaf itself.
        let others: f64 = p
            .iter()
            .enumerate()
            .filter(|(w, _)| *w != v)
            .map(|(_, p)| 1.0 - p)
            .product();
        assert!((b[v] - others).abs() < 1e-14, "{}", b[v]);
        assert!((fv[v] - p[v] / p_top).abs() < 1e-14, "{}", fv[v]);
    }
    let server = bdd
        .vars()
        .iter()
        .position(|v| v.as_str() == "server")
        .unwrap();
    assert!(
        fv.iter().all(|f| *f <= fv[server]),
        "the shared server matters most"
    );
}

#[test]
fn fussell_vesely_is_the_definition_not_the_rare_event_shortcut() {
    // Cut sets {a, b} and {a, c} overlap heavily and nothing is rare.
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::And, &["a", "bc"])),
            ("bc", gate(Gate::Or, &["b", "c"])),
            ("a", leaf(0.9)),
            ("b", leaf(0.8)),
            ("c", leaf(0.7)),
        ],
    );
    let (mut bdd, z) = cut_sets(&m);
    let p = leaf_p(&m, &bdd);
    let top = bdd.root();
    let fv = fussell_vesely(&mut bdd, top, &z, &p).unwrap();
    let b = bdd.vars().iter().position(|v| v.as_str() == "b").unwrap();
    let p_top = 0.9 * (1.0 - 0.2 * 0.3);
    let definition = (0.9 * 0.8) / p_top; // P(a and b) / P(top)
    let shortcut = 1.0 - (0.9 * 0.7) / p_top; // 1 - P(top | b = 0) / P(top)
    assert!((fv[b] - definition).abs() < 1e-14, "{}", fv[b]);
    assert!(
        (definition - shortcut).abs() > 0.4,
        "the fixture must tell them apart"
    );
}

/// Every subset of the leaves that makes top hold and has no proper subset
/// that does — by checking all 2^n of them.
fn minimal_by_brute_force(m: &Model, leaves: &[NodeId]) -> Vec<Vec<usize>> {
    let n = leaves.len();
    let sat = |bits: u32| {
        holds(m, &m.top, &|l| {
            bits >> leaves.iter().position(|x| x == l).unwrap() & 1 == 1
        })
    };
    let mut out: Vec<Vec<usize>> = (0u32..1 << n)
        .filter(|bits| sat(*bits) && (0..n).all(|i| bits >> i & 1 == 0 || !sat(bits & !(1 << i))))
        .map(|bits| (0..n).filter(|i| bits >> i & 1 == 1).collect())
        .collect();
    out.sort_by(|a: &Vec<usize>, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)));
    out
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(300))]
    #[test]
    fn cut_sets_are_exactly_the_minimal_satisfying_sets(m in dag(9)) {
        let (bdd, z) = cut_sets(&m);
        let want = minimal_by_brute_force(&m, bdd.vars());
        let got = z.enumerate(None, usize::MAX);
        prop_assert_eq!(got.total, want.len() as u128);
        prop_assert_eq!(got.sets, want);
    }

    #[test]
    fn importance_matches_brute_force(m in dag(8)) {
        let (mut bdd, z) = cut_sets(&m);
        let p = leaf_p(&m, &bdd);
        let leaves = bdd.vars().to_vec();
        let top = bdd.root();
        let b = birnbaum(&bdd, top, &p);
        let fv = fussell_vesely(&mut bdd, top, &z, &p).unwrap();
        let sets = minimal_by_brute_force(&m, &leaves);
        let n = leaves.len();
        let weight = |bits: u32| (0..n).map(|i| if bits >> i & 1 == 1 { p[i] } else { 1.0 - p[i] }).product::<f64>();
        let p_top = brute_force(&m, &leaves, &p);
        for v in 0..n {
            let force = |on: bool| { let mut q = p.clone(); q[v] = if on { 1.0 } else { 0.0 }; brute_force(&m, &leaves, &q) };
            prop_assert!((b[v] - (force(true) - force(false))).abs() < 1e-12);
            let through_v: f64 = (0u32..1 << n)
                .filter(|bits| sets.iter().any(|s| s.contains(&v) && s.iter().all(|i| bits >> i & 1 == 1)))
                .map(weight)
                .sum();
            let want = if p_top > 0.0 { through_v / p_top } else { 0.0 };
            prop_assert!((fv[v] - want).abs() < 1e-9, "leaf {}: got {}, want {}", v, fv[v], want);
        }
    }
}
