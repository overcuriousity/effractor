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
    let edges: Vec<Vec<usize>> = (0..n).map(support_inputs).collect();
    let missing = missing_paths(&edges, &|i| {
        if !unknown(i) {
            return &[][..];
        }
        match &resolved.ttc[i] {
            ResolvedTtc::Unknown(paths) => &paths[..],
            ResolvedTtc::Known(_) => &[][..],
        }
    });

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

/// For every node, the sorted, distinct paths of `own` over every node its
/// support edges reach, itself included. Cycles are condensed first
/// (Tarjan's algorithm, iteratively: a graph is user input), then each
/// component takes the union of its own and its successors' paths as
/// bitsets over the distinct paths, sinks first: linear in the graph times
/// the number of distinct unknown paths / 64.
fn missing_paths<'a>(
    edges: &[Vec<usize>],
    own: &dyn Fn(usize) -> &'a [String],
) -> Vec<Vec<String>> {
    let n = edges.len();
    let mut names: Vec<&'a String> = (0..n).flat_map(own).collect();
    names.sort();
    names.dedup();
    if names.is_empty() {
        return vec![Vec::new(); n];
    }
    let words = names.len().div_ceil(64);

    // Components in the order Tarjan closes them: every successor's before
    // its own.
    const NONE: usize = usize::MAX;
    let mut index = vec![NONE; n];
    let mut low = vec![0; n];
    let mut on_stack = vec![false; n];
    let mut stack: Vec<usize> = Vec::new();
    let mut component = vec![NONE; n];
    let mut components: Vec<Vec<usize>> = Vec::new();
    let mut next = 0;
    for root in 0..n {
        if index[root] != NONE {
            continue;
        }
        // (node, how many of its edges are done)
        let mut calls: Vec<(usize, usize)> = vec![(root, 0)];
        index[root] = next;
        low[root] = next;
        next += 1;
        stack.push(root);
        on_stack[root] = true;
        while let Some(&mut (v, ref mut done)) = calls.last_mut() {
            if let Some(&w) = edges[v].get(*done) {
                *done += 1;
                if index[w] == NONE {
                    index[w] = next;
                    low[w] = next;
                    next += 1;
                    stack.push(w);
                    on_stack[w] = true;
                    calls.push((w, 0));
                } else if on_stack[w] {
                    low[v] = low[v].min(index[w]);
                }
                continue;
            }
            calls.pop();
            if let Some(&(parent, _)) = calls.last() {
                low[parent] = low[parent].min(low[v]);
            }
            if low[v] == index[v] {
                let c = components.len();
                let mut members = Vec::new();
                while let Some(w) = stack.pop() {
                    on_stack[w] = false;
                    component[w] = c;
                    members.push(w);
                    if w == v {
                        break;
                    }
                }
                components.push(members);
            }
        }
    }

    let mut bits = vec![0u64; components.len() * words];
    for (c, members) in components.iter().enumerate() {
        let (done, rest) = bits.split_at_mut(c * words);
        let mine = &mut rest[..words];
        for &v in members {
            for path in own(v) {
                let k = names.binary_search(&path).unwrap_or_default();
                mine[k / 64] |= 1 << (k % 64);
            }
            for &w in &edges[v] {
                let d = component[w];
                if d != c {
                    for (m, &b) in mine.iter_mut().zip(&done[d * words..(d + 1) * words]) {
                        *m |= b;
                    }
                }
            }
        }
    }
    (0..n)
        .map(|v| {
            let mine = &bits[component[v] * words..(component[v] + 1) * words];
            (0..names.len())
                .filter(|k| mine[k / 64] & (1 << (k % 64)) != 0)
                .map(|k| names[k].clone())
                .collect()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::missing_paths;

    /// What `missing_paths` must equal: every node's reach walked on its own.
    fn walked(edges: &[Vec<usize>], own: &[Vec<String>]) -> Vec<Vec<String>> {
        (0..edges.len())
            .map(|start| {
                let mut seen = vec![false; edges.len()];
                let mut stack = vec![start];
                seen[start] = true;
                let mut out: Vec<String> = Vec::new();
                while let Some(i) = stack.pop() {
                    out.extend(own[i].iter().cloned());
                    for &j in &edges[i] {
                        if !seen[j] {
                            seen[j] = true;
                            stack.push(j);
                        }
                    }
                }
                out.sort();
                out.dedup();
                out
            })
            .collect()
    }

    #[test]
    fn condensed_unions_equal_walking_every_node_alone() {
        // A small deterministic generator: cycles, self-loops, shared paths,
        // more than 64 distinct paths so bitsets span words.
        let mut state: u64 = 0x9e37_79b9_7f4a_7c15;
        let mut next = |bound: u64| {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            (state % bound) as usize
        };
        for round in 0..200 {
            let n = 1 + next(60);
            let edges: Vec<Vec<usize>> = (0..n)
                .map(|_| (0..next(4)).map(|_| next(n as u64)).collect())
                .collect();
            let own: Vec<Vec<String>> = (0..n)
                .map(|_| {
                    if next(3) == 0 {
                        (0..1 + next(3)).map(|_| format!("p{}", next(90))).collect()
                    } else {
                        Vec::new()
                    }
                })
                .collect();
            let got = missing_paths(&edges, &|i| &own[i][..]);
            assert_eq!(got, walked(&edges, &own), "round {round}");
        }
    }
}
