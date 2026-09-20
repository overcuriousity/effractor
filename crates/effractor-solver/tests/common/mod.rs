//! Shared by the solver's integration tests: small model builders, a random
//! DAG strategy, and the brute-force oracle everything exact is checked against.
#![allow(dead_code)]

use effractor_core::*;
use proptest::prelude::*;

pub fn id<T: std::str::FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

pub fn model(top: &str, nodes: Vec<(&str, Node)>) -> Model {
    let mut m = Model::new("test", Profile::FaultTree, id(top));
    for (name, node) in nodes {
        m.nodes.insert(id(name), node);
    }
    assert_eq!(
        validate(&m)
            .iter()
            .filter(|d| d.severity == Severity::Error)
            .count(),
        0,
        "{:#?}",
        validate(&m)
    );
    m
}

pub fn leaf(p: f64) -> Node {
    Node::leaf("leaf", LeafKind::Basic, Some(Ttc::P(p)))
}

pub fn gate(gate: Gate, children: &[&str]) -> Node {
    Node::gate("gate", gate, children.iter().map(|c| id(c)).collect())
}

/// Does `node` hold when exactly the leaves in `on` do? Plain recursion over
/// the structure — the definition, not an algorithm.
pub fn holds(m: &Model, node: &NodeId, on: &dyn Fn(&NodeId) -> bool) -> bool {
    match &m.nodes[node].kind {
        NodeKind::Leaf(_) => on(node),
        NodeKind::Gate { gate, children } => {
            let n = children.iter().filter(|c| holds(m, c, on)).count();
            match gate {
                Gate::And => n == children.len(),
                Gate::Or => n >= 1,
                Gate::Vote { k } => n >= *k,
            }
        }
    }
}

/// P(top) by summing over every assignment of `leaves`, in the given order.
pub fn brute_force(m: &Model, leaves: &[NodeId], p: &[f64]) -> f64 {
    (0u32..1 << leaves.len())
        .filter(|bits| {
            holds(m, &m.top, &|l| {
                bits >> leaves.iter().position(|x| x == l).unwrap() & 1 == 1
            })
        })
        .map(|bits| {
            (0..leaves.len())
                .map(|i| if bits >> i & 1 == 1 { p[i] } else { 1.0 - p[i] })
                .product::<f64>()
        })
        .sum()
}

/// A random coherent DAG: up to `max_leaves` leaves, then gates that may take
/// any earlier node as a child — so shared leaves and shared sub-gates are the
/// norm, not the exception. `top` is the last gate.
pub fn dag(max_leaves: usize) -> impl Strategy<Value = Model> {
    (2..=max_leaves, 1..=8usize).prop_flat_map(|(n_leaves, n_gates)| {
        let gates: Vec<_> = (0..n_gates)
            .map(|g| {
                let pool = n_leaves + g;
                (
                    proptest::sample::subsequence((0..pool).collect::<Vec<_>>(), 1..=pool.min(4)),
                    0..3usize,
                    any::<proptest::sample::Index>(),
                )
            })
            .collect();
        (proptest::collection::vec(0.0..=1.0f64, n_leaves), gates).prop_map(move |(ps, gates)| {
            let name = |i: usize| {
                if i < n_leaves {
                    format!("l{i}")
                } else {
                    format!("g{}", i - n_leaves)
                }
            };
            let mut m = Model::new(
                "random",
                Profile::FaultTree,
                id(&name(n_leaves + n_gates - 1)),
            );
            for (i, p) in ps.iter().enumerate() {
                m.nodes.insert(id(&name(i)), leaf(*p));
            }
            for (g, (children, kind, k)) in gates.into_iter().enumerate() {
                let gate = match kind {
                    0 => Gate::And,
                    1 => Gate::Or,
                    _ => Gate::Vote {
                        k: k.index(children.len()) + 1,
                    },
                };
                let children = children.into_iter().map(|c| id(&name(c))).collect();
                m.nodes
                    .insert(id(&name(n_leaves + g)), Node::gate("gate", gate, children));
            }
            m
        })
    })
}
