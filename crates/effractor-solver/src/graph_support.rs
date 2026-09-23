//! What a generated graph allows before any number: which steps can happen
//! at all, which a known defence or denial blocks, which happen at once, and
//! which unknown inputs each step's time would rest on.
//!
//! An unknown duration or policy is provisionally possible: it might be
//! anything. A known impossible one blocks its step. A step's *support* is
//! what its time can depend on: every prerequisite of an action, every
//! possible producer of a fact, and nothing behind a step that happens at
//! zero in every sample, since nothing can make that earlier. A step whose
//! support holds an unknown input has no number; one whose support does not
//! has one, whatever is unknown elsewhere. Every closure here is a least
//! fixpoint over a worklist, so a cycle nothing enters stays out of it.

use effractor_components::{GeneratedGraph, GeneratedKind, ResolvedGraph, ResolvedTtc};
use effractor_core::Distribution;

/// A step's qualitative state under one scenario.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    /// Happens at time zero in every sample.
    Seeded,
    /// Can happen, given its prerequisites and possible durations.
    Possible,
    /// Its own duration or policy says never.
    Blocked,
    /// Nothing that can happen leads to it.
    Unreachable,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Seeded => "seeded",
            Self::Possible => "possible",
            Self::Blocked => "blocked",
            Self::Unreachable => "unreachable",
        }
    }
}

/// Aligned with the graph's nodes.
#[derive(Debug, Clone, PartialEq)]
pub struct GraphSupport {
    pub status: Vec<Status>,
    /// The unknown inputs a node's time would rest on, sorted; empty if it
    /// has a number, or if it cannot happen at all.
    pub missing: Vec<Vec<String>>,
    /// Completes at zero in every sample.
    pub zero: Vec<bool>,
    /// The target's support, ascending; empty when the target cannot happen.
    pub target_support: Vec<usize>,
}

/// A node's own contribution to its time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Own {
    Zero,
    Never,
    Unknown,
    Random,
}

/// Does this TTC mean "never", in every sample? By meaning, not spelling:
/// `Bernoulli(0)`, `0 * D`, `p * Infinity` and a shorthand that expands to
/// never all are.
pub fn never(d: &Distribution) -> bool {
    use Distribution as D;
    match d {
        D::Infinity => true,
        D::Bernoulli(p) => *p <= 0.0,
        D::Product(p, inner) => *p <= 0.0 || never(inner),
        D::Named(s) => never(&s.expand()),
        _ => false,
    }
}

/// Does this TTC mean "at once", in every sample?
fn always_zero(d: &Distribution) -> bool {
    use Distribution as D;
    match d {
        D::Zero => true,
        D::Bernoulli(p) => *p >= 1.0,
        D::Product(p, inner) => *p >= 1.0 && always_zero(inner),
        D::Named(s) => always_zero(&s.expand()),
        _ => false,
    }
}

fn inputs(kind: &GeneratedKind) -> &[usize] {
    match kind {
        GeneratedKind::Input => &[],
        GeneratedKind::Any { inputs } | GeneratedKind::All { inputs } => inputs,
    }
}

pub fn analyze(graph: &GeneratedGraph, resolved: &ResolvedGraph) -> GraphSupport {
    let n = graph.nodes.len();
    let own: Vec<Own> = graph
        .nodes
        .iter()
        .zip(&resolved.ttc)
        .map(|(node, ttc)| match (&node.kind, ttc) {
            (GeneratedKind::Any { .. }, _) => Own::Zero,
            (_, ResolvedTtc::Unknown(_)) => Own::Unknown,
            (_, ResolvedTtc::Known(d)) if never(d) => Own::Never,
            (_, ResolvedTtc::Known(d)) if always_zero(d) => Own::Zero,
            (_, ResolvedTtc::Known(_)) => Own::Random,
        })
        .collect();

    let mut dependents: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (i, node) in graph.nodes.iter().enumerate() {
        for &j in inputs(&node.kind) {
            dependents[j].push(i);
        }
    }

    // What can happen, and what happens at once: the same closure, with a
    // different test for a node's own part.
    let closure = |allowed: &dyn Fn(Own) -> bool| -> Vec<bool> {
        let mut holds = vec![false; n];
        let mut waiting: Vec<usize> = graph
            .nodes
            .iter()
            .map(|node| match &node.kind {
                GeneratedKind::All { inputs } => inputs.len(),
                _ => 1,
            })
            .collect();
        let mut work: Vec<usize> = (0..n)
            .filter(|&i| matches!(graph.nodes[i].kind, GeneratedKind::Input) && allowed(own[i]))
            .collect();
        for &i in &work {
            holds[i] = true;
        }
        while let Some(i) = work.pop() {
            for &j in &dependents[i] {
                if holds[j] {
                    continue;
                }
                let ready = match graph.nodes[j].kind {
                    GeneratedKind::Any { .. } => true,
                    GeneratedKind::All { .. } => {
                        waiting[j] -= 1;
                        waiting[j] == 0 && allowed(own[j])
                    }
                    GeneratedKind::Input => false,
                };
                if ready {
                    holds[j] = true;
                    work.push(j);
                }
            }
        }
        holds
    };
    let possible = closure(&|o| o != Own::Never);
    let zero = closure(&|o| o == Own::Zero);

    let status: Vec<Status> = (0..n)
        .map(|i| {
            if zero[i] {
                Status::Seeded
            } else if possible[i] {
                Status::Possible
            } else if own[i] == Own::Never
                && !matches!(graph.nodes[i].kind, GeneratedKind::Any { .. })
            {
                Status::Blocked
            } else {
                Status::Unreachable
            }
        })
        .collect();

    // Support edges run from a possible, not-at-once node to every
    // prerequisite of an action, or every possible producer of a fact.
    let expands = |i: usize| possible[i] && !zero[i];
    let support_inputs = |i: usize| -> Vec<usize> {
        if !expands(i) {
            return Vec::new();
        }
        match &graph.nodes[i].kind {
            GeneratedKind::Input => Vec::new(),
            GeneratedKind::All { inputs } => inputs.clone(),
            GeneratedKind::Any { inputs } => {
                inputs.iter().copied().filter(|&j| possible[j]).collect()
            }
        }
    };
    let support_of = |start: usize| -> Vec<usize> {
        let mut seen = vec![false; n];
        let mut stack = vec![start];
        seen[start] = true;
        while let Some(i) = stack.pop() {
            for j in support_inputs(i) {
                if !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
        (0..n).filter(|&i| seen[i]).collect()
    };
    let unknown = |i: usize| expands(i) && own[i] == Own::Unknown;

    // Which nodes an unknown can reach, backwards along support edges: only
    // those need their own support walked for the paths.
    let mut tainted = vec![false; n];
    let mut stack: Vec<usize> = (0..n).filter(|&i| unknown(i)).collect();
    for &i in &stack {
        tainted[i] = true;
    }
    while let Some(i) = stack.pop() {
        for &j in &dependents[i] {
            if !tainted[j] && support_inputs(j).contains(&i) {
                tainted[j] = true;
                stack.push(j);
            }
        }
    }
    let missing: Vec<Vec<String>> = (0..n)
        .map(|i| {
            if !tainted[i] {
                return Vec::new();
            }
            let mut paths: Vec<String> = support_of(i)
                .into_iter()
                .filter(|&j| unknown(j))
                .flat_map(|j| match &resolved.ttc[j] {
                    ResolvedTtc::Unknown(paths) => paths.clone(),
                    ResolvedTtc::Known(_) => Vec::new(),
                })
                .collect();
            paths.sort();
            paths.dedup();
            paths
        })
        .collect();

    let target_support = if possible[graph.target] {
        support_of(graph.target)
    } else {
        Vec::new()
    };
    GraphSupport {
        status,
        missing,
        zero,
        target_support,
    }
}
