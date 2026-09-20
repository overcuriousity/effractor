mod common;

use common::*;
use effractor_core::*;
use effractor_solver::bdd::{Bdd, BddError};
use proptest::prelude::*;

const LIMIT: usize = 1_000_000;

fn close(got: f64, want: f64) {
    assert!((got - want).abs() <= 1e-14, "got {got}, want {want}");
}

/// P(top), with each leaf's probability read off its `p:`.
fn p_top(m: &Model) -> f64 {
    let bdd = Bdd::compile(m, LIMIT).unwrap();
    let p: Vec<f64> = bdd
        .vars()
        .iter()
        .map(|v| match &m.nodes[v].kind {
            NodeKind::Leaf(Leaf {
                ttc: Some(Ttc::P(p)),
                ..
            }) => *p,
            other => panic!("{other:?}"),
        })
        .collect();
    bdd.prob(bdd.root(), &p)
}

#[test]
fn series_system() {
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Or, &["a", "b", "c"])),
            ("a", leaf(0.1)),
            ("b", leaf(0.2)),
            ("c", leaf(0.3)),
        ],
    );
    close(p_top(&m), 1.0 - 0.9 * 0.8 * 0.7);
}

#[test]
fn parallel_system() {
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::And, &["a", "b", "c"])),
            ("a", leaf(0.1)),
            ("b", leaf(0.2)),
            ("c", leaf(0.3)),
        ],
    );
    close(p_top(&m), 0.1 * 0.2 * 0.3);
}

#[test]
fn two_of_three() {
    let (a, b, c) = (0.1, 0.2, 0.3);
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Vote { k: 2 }, &["a", "b", "c"])),
            ("a", leaf(a)),
            ("b", leaf(b)),
            ("c", leaf(c)),
        ],
    );
    close(
        p_top(&m),
        a * b * (1.0 - c) + a * (1.0 - b) * c + (1.0 - a) * b * c + a * b * c,
    );
}

#[test]
fn vote_degenerates_to_or_and_and() {
    let build = |g| {
        model(
            "top",
            vec![
                ("top", gate(g, &["a", "b", "c"])),
                ("a", leaf(0.1)),
                ("b", leaf(0.2)),
                ("c", leaf(0.3)),
            ],
        )
    };
    close(p_top(&build(Gate::Vote { k: 1 })), p_top(&build(Gate::Or)));
    close(p_top(&build(Gate::Vote { k: 3 })), p_top(&build(Gate::And)));
}

/// top = (a or s) and (b or s), which is s or (a and b). A tree evaluation
/// multiplies the two branches as if they were independent — they share `s`,
/// so that is wrong, and this is the case that says so.
#[test]
fn a_repeated_event_is_one_random_variable() {
    let (a, b, s) = (0.1, 0.2, 0.3);
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::And, &["left", "right"])),
            ("left", gate(Gate::Or, &["a", "s"])),
            ("right", gate(Gate::Or, &["b", "s"])),
            ("a", leaf(a)),
            ("b", leaf(b)),
            ("s", leaf(s)),
        ],
    );
    let exact = s + (1.0 - s) * a * b;
    let naive = (1.0 - (1.0 - a) * (1.0 - s)) * (1.0 - (1.0 - b) * (1.0 - s));
    close(p_top(&m), exact);
    assert!(
        (naive - exact).abs() > 0.05,
        "the fixture must tell the two apart"
    );
}

#[test]
fn a_shared_gate_is_compiled_once_and_every_node_has_a_function() {
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Or, &["x", "y"])),
            ("x", gate(Gate::And, &["shared", "a"])),
            ("y", gate(Gate::And, &["shared", "b"])),
            ("shared", gate(Gate::Or, &["c", "d"])),
            ("a", leaf(0.5)),
            ("b", leaf(0.5)),
            ("c", leaf(0.5)),
            ("d", leaf(0.5)),
            ("orphan", leaf(0.5)),
        ],
    );
    let bdd = Bdd::compile(&m, LIMIT).unwrap();
    // Variable order: depth-first from top, children in document order.
    let order: Vec<&str> = bdd.vars().iter().map(|v| v.as_str()).collect();
    assert_eq!(order, ["c", "d", "a", "b"]);
    let p = [0.5; 4];
    close(bdd.prob(bdd.node(&id("shared")).unwrap(), &p), 0.75);
    close(bdd.prob(bdd.node(&id("x")).unwrap(), &p), 0.375);
    // Not reachable from top: not part of the function, not an error either.
    assert!(bdd.node(&id("orphan")).is_none());
}

#[test]
fn a_leaf_as_top() {
    let m = model("only", vec![("only", leaf(0.25))]);
    close(p_top(&m), 0.25);
}

#[test]
fn the_node_limit_is_an_answer_not_a_crash() {
    // (a0 and b0) or (a1 and b1) or … with all a's ordered before all b's is
    // the textbook exponential case.
    let n = 14;
    let names: Vec<String> = (0..n)
        .flat_map(|i| [format!("a{i}"), format!("b{i}"), format!("and{i}")])
        .collect();
    let mut nodes = vec![];
    let firsts: Vec<&str> = (0..n).map(|i| names[3 * i].as_str()).collect();
    nodes.push(("order", gate(Gate::And, &firsts)));
    for i in 0..n {
        nodes.push((names[3 * i].as_str(), leaf(0.5)));
        nodes.push((names[3 * i + 1].as_str(), leaf(0.5)));
        nodes.push((
            names[3 * i + 2].as_str(),
            gate(Gate::And, &[&names[3 * i], &names[3 * i + 1]]),
        ));
    }
    let ands: Vec<&str> = (0..n).map(|i| names[3 * i + 2].as_str()).collect();
    nodes.push(("pairs", gate(Gate::Or, &ands)));
    nodes.push(("top", gate(Gate::Or, &["order", "pairs"])));
    let m = model("top", nodes);
    assert_eq!(
        Bdd::compile(&m, 1_000).err(),
        Some(BddError::NodeLimit(1_000))
    );
    assert!(Bdd::compile(&m, LIMIT).is_ok());
}

#[test]
fn an_invalid_model_is_refused_not_looped_on() {
    let mut m = Model::new("bad", Profile::FaultTree, id("a"));
    m.nodes.insert(id("a"), gate(Gate::Or, &["b"]));
    m.nodes.insert(id("b"), gate(Gate::Or, &["a"]));
    assert_eq!(Bdd::compile(&m, LIMIT).err(), Some(BddError::InvalidModel));
    m.nodes.insert(id("b"), gate(Gate::Or, &["ghost"]));
    assert_eq!(Bdd::compile(&m, LIMIT).err(), Some(BddError::InvalidModel));
}

#[test]
fn depth_is_not_a_stack_problem() {
    // g0 = l0 and g1, g1 = l1 and g2, … — deep in the model and deep in the BDD.
    let n = 50_000;
    let mut m = Model::new("deep", Profile::FaultTree, id("g0"));
    for i in 0..n {
        m.nodes.insert(
            id(&format!("g{i}")),
            Node::gate(
                "g",
                Gate::And,
                vec![id(&format!("l{i}")), id(&format!("g{}", i + 1))],
            ),
        );
        m.nodes.insert(id(&format!("l{i}")), leaf(1.0));
    }
    m.nodes.insert(id(&format!("g{n}")), leaf(0.5));
    close(p_top(&m), 0.5);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]
    #[test]
    fn exact_probability_equals_brute_force(m in dag(10)) {
        let bdd = Bdd::compile(&m, LIMIT).unwrap();
        let p: Vec<f64> = bdd.vars().iter().map(|v| match &m.nodes[v].kind {
            NodeKind::Leaf(Leaf { ttc: Some(Ttc::P(p)), .. }) => *p,
            _ => unreachable!(),
        }).collect();
        let want = brute_force(&m, bdd.vars(), &p);
        let got = bdd.prob(bdd.root(), &p);
        prop_assert!((got - want).abs() <= 1e-12, "got {got}, want {want}");
    }
}
