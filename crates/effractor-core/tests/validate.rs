//! One fixture per diagnostic code: a valid model, bent in exactly one place.

use effractor_core::*;

fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

fn leaf(label: &str, p: f64) -> Node {
    Node::leaf(label, LeafKind::Basic, Some(Ttc::P(p)))
}

fn gate(label: &str, gate: Gate, children: &[&str]) -> Node {
    Node::gate(label, gate, children.iter().map(|c| id(c)).collect())
}

/// top = or(access, server); access = and(admin, server) — `server` is shared.
fn valid() -> Model {
    let mut m = Model::new("Webserver", Profile::FaultTree, id("top"));
    m.nodes
        .insert(id("top"), gate("Top", Gate::Or, &["access", "server"]));
    m.nodes.insert(
        id("access"),
        gate("Access", Gate::And, &["admin", "server"]),
    );
    m.nodes.insert(id("admin"), leaf("Admin", 0.01));
    m.nodes.insert(id("server"), leaf("Server", 0.02));
    m.assets.insert(
        id("web"),
        Asset {
            label: "Webserver".into(),
            description: None,
            loss: Loss {
                c: None,
                i: None,
                a: Some(Distribution::Const(1000.0)),
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
    m.controls.insert(
        id("psu"),
        Control {
            label: "PSU".into(),
            description: None,
            cost: 100.0,
            enabled: false,
            effects: vec![Effect {
                node: id("server"),
                ttc: Distribution::Bernoulli(0.001),
            }],
        },
    );
    m
}

fn codes(m: &Model) -> Vec<(Code, Severity)> {
    validate(m)
        .into_iter()
        .map(|d| (d.code, d.severity))
        .collect()
}

fn only(m: &Model) -> Diagnostic {
    let mut d = validate(m);
    assert_eq!(d.len(), 1, "{d:#?}");
    d.remove(0)
}

#[test]
fn a_valid_model_with_a_repeated_event_is_clean() {
    assert_eq!(codes(&valid()), vec![]);
}

#[test]
fn ids_are_lowercase_kebab() {
    assert!("server-outage".parse::<NodeId>().is_ok());
    assert!("7".parse::<NodeId>().is_ok());
    for bad in ["", "-a", "A", "a_b", "a b", "ä"] {
        assert!(bad.parse::<NodeId>().is_err(), "{bad:?}");
    }
}

#[test]
fn unknown_top() {
    let mut m = valid();
    m.top = id("nope");
    let d = validate(&m);
    assert!(
        d.iter()
            .any(|d| d.code == Code::UnknownTop && d.path == "top"),
        "{d:#?}"
    );
}

#[test]
fn unknown_child() {
    let mut m = valid();
    m.nodes.insert(
        id("top"),
        gate("Top", Gate::Or, &["access", "server", "ghost"]),
    );
    let d = only(&m);
    assert_eq!((d.code, d.severity), (Code::UnknownChild, Severity::Error));
    assert_eq!(d.path, "nodes.top.children[2]");
    assert!(d.message.contains("ghost"));
}

#[test]
fn cycle_is_reported_with_its_path() {
    let mut m = valid();
    m.nodes
        .insert(id("admin"), gate("Admin", Gate::Or, &["top"]));
    let d = validate(&m);
    let cycle = d.iter().find(|d| d.code == Code::Cycle).expect("cycle");
    assert!(
        cycle.message.contains("top -> access -> admin -> top"),
        "{}",
        cycle.message
    );
}

#[test]
fn deep_chains_do_not_overflow_the_stack() {
    let mut m = Model::new("deep", Profile::FaultTree, id("n0"));
    let n = 200_000;
    for i in 0..n {
        m.nodes.insert(
            id(&format!("n{i}")),
            gate("g", Gate::Or, &[&format!("n{}", i + 1)]),
        );
    }
    m.nodes.insert(id(&format!("n{n}")), leaf("end", 0.5));
    assert_eq!(codes(&m), vec![]);
}

#[test]
fn empty_gate() {
    let mut m = valid();
    m.nodes.insert(id("access"), gate("Access", Gate::And, &[]));
    assert!(codes(&m).contains(&(Code::EmptyGate, Severity::Error)));
}

#[test]
fn duplicate_child() {
    let mut m = valid();
    m.nodes.insert(
        id("access"),
        gate("Access", Gate::And, &["admin", "admin", "server"]),
    );
    assert_eq!(only(&m).code, Code::DuplicateChild);
}

#[test]
fn vote_k_out_of_range() {
    for k in [0, 3] {
        let mut m = valid();
        m.nodes.insert(
            id("access"),
            gate("Access", Gate::Vote { k }, &["admin", "server"]),
        );
        assert_eq!(only(&m).code, Code::VoteRange, "k = {k}");
    }
    let mut m = valid();
    m.nodes.insert(
        id("access"),
        gate("Access", Gate::Vote { k: 2 }, &["admin", "server"]),
    );
    assert_eq!(codes(&m), vec![]);
}

#[test]
fn parameter_out_of_domain() {
    let mut m = valid();
    m.nodes.insert(id("admin"), leaf("Admin", 1.5));
    let d = only(&m);
    assert_eq!(d.code, Code::ParamDomain);
    assert_eq!(d.path, "nodes.admin.p");

    for bad in [
        Distribution::Exponential(0.0),
        Distribution::Exponential(f64::NAN),
        Distribution::Gamma {
            shape: -1.0,
            scale: 1.0,
        },
        Distribution::LogNormal {
            mu: 0.0,
            sigma: 0.0,
        },
        Distribution::Pareto {
            xm: 0.0,
            alpha: 1.0,
        },
        Distribution::TruncatedNormal { mean: 1.0, sd: 0.0 },
        Distribution::Product(2.0, Box::new(Distribution::Exponential(1.0))),
        Distribution::Product(0.5, Box::new(Distribution::Bernoulli(0.5))),
    ] {
        let mut m = valid();
        m.nodes.insert(
            id("admin"),
            Node::leaf("Admin", LeafKind::Basic, Some(Ttc::Expr(bad.clone()))),
        );
        assert_eq!(only(&m).code, Code::ParamDomain, "{bad:?}");
    }
}

#[test]
fn distributions_have_roles() {
    // Pert calibrates a loss magnitude; it is not a time-to-compromise.
    let mut m = valid();
    let pert = Distribution::Pert {
        min: 1.0,
        mode: 2.0,
        max: 3.0,
    };
    m.nodes.insert(
        id("admin"),
        Node::leaf("Admin", LeafKind::Basic, Some(Ttc::Expr(pert.clone()))),
    );
    assert_eq!(only(&m).code, Code::DistributionRole);

    // …and a loss cannot be "never".
    let mut m = valid();
    m.assets[&id::<AssetId>("web")].loss.a = Some(Distribution::Infinity);
    let d = only(&m);
    assert_eq!(d.code, Code::DistributionRole);
    assert_eq!(d.path, "assets.web.loss.a");

    let mut m = valid();
    m.assets[&id::<AssetId>("web")].loss.a = Some(pert);
    assert_eq!(codes(&m), vec![]);
}

#[test]
fn pert_must_be_ordered() {
    let mut m = valid();
    m.assets[&id::<AssetId>("web")].loss.a = Some(Distribution::Pert {
        min: 5.0,
        mode: 2.0,
        max: 3.0,
    });
    assert_eq!(only(&m).code, Code::ParamDomain);
}

#[test]
fn consequence_problems() {
    let mut m = valid();
    m.nodes[&id::<NodeId>("top")].consequences[0].asset = id("ghost");
    let d = only(&m);
    assert_eq!(d.code, Code::UnknownAsset);
    assert_eq!(d.path, "nodes.top.consequences[0].asset");

    for f in [0.0, 1.1, f64::NAN] {
        let mut m = valid();
        m.nodes[&id::<NodeId>("top")].consequences[0].fraction = f;
        assert_eq!(only(&m).code, Code::FractionRange, "{f}");
    }

    // The asset has no `c` magnitude, so a `c` consequence would lose nothing.
    let mut m = valid();
    m.nodes[&id::<NodeId>("top")].consequences[0].dim = Dim::C;
    assert_eq!(only(&m).code, Code::NoMagnitude);
}

#[test]
fn control_problems() {
    let mut m = valid();
    m.controls[&id::<ControlId>("psu")].effects[0].node = id("ghost");
    assert_eq!(only(&m).code, Code::UnknownEffectNode);

    let mut m = valid();
    m.controls[&id::<ControlId>("psu")].effects[0].node = id("access");
    let d = only(&m);
    assert_eq!(d.code, Code::EffectOnGate);
    assert_eq!(d.path, "controls.psu.effects[0].node");

    let mut m = valid();
    m.controls[&id::<ControlId>("psu")].cost = -1.0;
    assert_eq!(only(&m).code, Code::ParamDomain);
}

#[test]
fn overlapping_effects_warn() {
    let mut m = valid();
    let mut second = m.controls[&id::<ControlId>("psu")].clone();
    second.label = "UPS".into();
    m.controls.insert(id("ups"), second);
    let d = only(&m);
    assert_eq!(
        (d.code, d.severity),
        (Code::OverlappingEffects, Severity::Warning)
    );
    assert!(d.message.contains("psu") && d.message.contains("ups"));
}

#[test]
fn unreachable_nodes_warn() {
    let mut m = valid();
    m.nodes.insert(id("orphan"), leaf("Orphan", 0.1));
    let d = only(&m);
    assert_eq!((d.code, d.severity), (Code::Unreachable, Severity::Warning));
    assert_eq!(d.path, "nodes.orphan");
}

#[test]
fn attacker_attributes_belong_to_the_attack_tree_profile() {
    let mut with_cost = valid();
    if let NodeKind::Leaf(l) = &mut with_cost.nodes[&id::<NodeId>("admin")].kind {
        l.cost = Some(500.0);
        l.detection = Some(0.2);
    }
    let d = validate(&with_cost);
    assert_eq!(d.len(), 2, "{d:#?}");
    assert!(
        d.iter()
            .all(|d| d.code == Code::ProfileAttribute && d.severity == Severity::Warning)
    );

    with_cost.profile = Profile::AttackTree;
    assert_eq!(codes(&with_cost), vec![]);

    if let NodeKind::Leaf(l) = &mut with_cost.nodes[&id::<NodeId>("admin")].kind {
        l.detection = Some(1.2);
    }
    assert_eq!(only(&with_cost).code, Code::ParamDomain);
}

#[test]
fn a_leaf_without_data_is_allowed() {
    // Qualitative analysis still works; the solver reports what it cannot do.
    let mut m = valid();
    m.nodes.insert(
        id("admin"),
        Node::leaf("Admin", LeafKind::Undeveloped, None),
    );
    assert_eq!(codes(&m), vec![]);
}

#[test]
fn horizon_and_analysis_ranges() {
    let mut m = valid();
    m.horizon = 0.0;
    assert_eq!(only(&m).code, Code::ParamDomain);

    let mut m = valid();
    m.analysis.samples = 0;
    assert_eq!(only(&m).code, Code::ParamDomain);

    let mut m = valid();
    m.analysis.confidence = 1.0;
    let d = only(&m);
    assert_eq!(d.path, "analysis.confidence");
}

#[test]
fn shorthands_expand_as_mal_defines_them() {
    use Distribution as D;
    assert_eq!(Shorthand::EasyAndCertain.expand(), D::Exponential(1.0));
    assert_eq!(
        Shorthand::HardAndUncertain.expand(),
        D::Product(0.5, Box::new(D::Exponential(0.1)))
    );
    assert_eq!(Shorthand::VeryHardAndCertain.expand(), D::Exponential(0.01));
    assert_eq!(Ttc::Rate(2.0).distribution(), D::Exponential(2.0));
    assert_eq!(Ttc::P(0.3).distribution(), D::Bernoulli(0.3));
}
