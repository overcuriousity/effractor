//! When each step of a generated graph completes, in one sample.
//!
//! A fact (`Any`) completes with its first producer; an action (`All`) waits
//! for every prerequisite and then takes its own duration; an input completes
//! at its duration, zero or never. Cycles are legal and nothing in one
//! completes unless something outside it did first: every node starts at
//! never and only a finalized completion can move another. An event queue
//! finalizes nodes in nondecreasing time, ties by index, each once — no
//! recursion, no fixpoint iteration, no epsilon.

use std::cmp::{Ordering, Reverse};
use std::collections::BinaryHeap;

use effractor_core::{Code, Diagnostic};

/// One node of a plan. Inputs are node indices.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GraphOp {
    /// Completes at its own duration: zero, never, or a draw.
    Input,
    /// Completes when its first input does. Its own duration is not read.
    Any(Vec<usize>),
    /// Completes its duration after the last of its inputs.
    All(Vec<usize>),
}

/// A graph checked for evaluation: every input in range, none twice, no
/// action without prerequisites, and who depends on whom, precomputed.
#[derive(Debug, Clone)]
pub struct EventPlan {
    ops: Vec<GraphOp>,
    /// `dependents[offsets[i]..offsets[i + 1]]` need node `i`.
    offsets: Vec<usize>,
    dependents: Vec<usize>,
}

/// A sample's derivation of one node: the nodes it rests on and the edges
/// between them, prerequisite first. A join holds all of its branches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Witness {
    /// Ascending.
    pub nodes: Vec<usize>,
    /// `(prerequisite, dependent)`, ascending.
    pub edges: Vec<(usize, usize)>,
}

/// Reused between samples, so a sample allocates nothing.
#[derive(Debug, Clone, Default)]
pub(crate) struct Scratch {
    pub(crate) times: Vec<f64>,
    /// For an Any, the producer it accepted; unused otherwise.
    accepted: Vec<usize>,
    /// For an All, prerequisites still to complete.
    waiting: Vec<usize>,
    /// For an All, the latest prerequisite completion so far.
    latest: Vec<f64>,
    queued: Vec<bool>,
    queue: BinaryHeap<Reverse<Event>>,
}

#[derive(Debug, Clone, Copy)]
struct Event(f64, usize);

impl PartialEq for Event {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other) == Ordering::Equal
    }
}
impl Eq for Event {}
impl PartialOrd for Event {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Event {
    fn cmp(&self, other: &Self) -> Ordering {
        self.0.total_cmp(&other.0).then(self.1.cmp(&other.1))
    }
}

impl EventPlan {
    pub fn new(operations: Vec<GraphOp>) -> Result<Self, Vec<Diagnostic>> {
        let n = operations.len();
        let mut errors = Vec::new();
        let mut counts = vec![0usize; n + 1];
        let mut seen = vec![usize::MAX; n];
        for (i, op) in operations.iter().enumerate() {
            let inputs = match op {
                GraphOp::Input => continue,
                GraphOp::Any(inputs) => inputs,
                GraphOp::All(inputs) => {
                    if inputs.is_empty() {
                        errors.push(Diagnostic::error(
                            Code::EmptyGate,
                            format!("nodes[{i}]"),
                            "an action needs at least one prerequisite",
                        ));
                    }
                    inputs
                }
            };
            for &j in inputs {
                if j >= n {
                    errors.push(Diagnostic::error(
                        Code::UnknownChild,
                        format!("nodes[{i}]"),
                        format!("input {j} is not a node"),
                    ));
                } else if seen[j] == i {
                    errors.push(Diagnostic::error(
                        Code::DuplicateChild,
                        format!("nodes[{i}]"),
                        format!("input {j} is listed twice"),
                    ));
                } else {
                    seen[j] = i;
                    counts[j + 1] += 1;
                }
            }
        }
        if !errors.is_empty() {
            return Err(errors);
        }
        for i in 0..n {
            counts[i + 1] += counts[i];
        }
        let offsets = counts;
        let mut fill = offsets.clone();
        let mut dependents = vec![0; offsets[n]];
        for (i, op) in operations.iter().enumerate() {
            if let GraphOp::Any(inputs) | GraphOp::All(inputs) = op {
                for &j in inputs {
                    dependents[fill[j]] = i;
                    fill[j] += 1;
                }
            }
        }
        Ok(Self {
            ops: operations,
            offsets,
            dependents,
        })
    }

    pub fn len(&self) -> usize {
        self.ops.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ops.is_empty()
    }

    /// Every node's completion time, `INFINITY` for never. `durations` has one
    /// entry per node, none negative or NaN.
    pub fn times(&self, durations: &[f64]) -> Result<Vec<f64>, Vec<Diagnostic>> {
        self.check(durations)?;
        let mut scratch = Scratch::default();
        self.evaluate(durations, &mut scratch);
        Ok(scratch.times)
    }

    /// How `node` completed in this sample, or `None` if it never did or the
    /// durations are not valid ones.
    pub fn witness(&self, durations: &[f64], node: usize) -> Option<Witness> {
        self.check(durations).ok()?;
        let mut scratch = Scratch::default();
        self.evaluate(durations, &mut scratch);
        self.derivation(&scratch, node)
    }

    fn check(&self, durations: &[f64]) -> Result<(), Vec<Diagnostic>> {
        if durations.len() != self.ops.len() {
            return Err(vec![Diagnostic::error(
                Code::ParamDomain,
                "durations",
                format!("{} durations for {} nodes", durations.len(), self.ops.len()),
            )]);
        }
        let errors: Vec<Diagnostic> = durations
            .iter()
            .enumerate()
            .filter(|(_, d)| d.is_nan() || **d < 0.0)
            .map(|(i, d)| {
                Diagnostic::error(
                    Code::ParamDomain,
                    format!("durations[{i}]"),
                    format!("{d} is not a duration"),
                )
            })
            .collect();
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors)
        }
    }

    /// The evaluator itself; `durations` has been checked.
    pub(crate) fn evaluate(&self, durations: &[f64], s: &mut Scratch) {
        let n = self.ops.len();
        s.times.clear();
        s.times.resize(n, f64::INFINITY);
        s.accepted.clear();
        s.accepted.resize(n, usize::MAX);
        s.latest.clear();
        s.latest.resize(n, 0.0);
        s.queued.clear();
        s.queued.resize(n, false);
        s.waiting.clear();
        s.queue.clear();
        for (i, op) in self.ops.iter().enumerate() {
            s.waiting.push(match op {
                GraphOp::All(inputs) => inputs.len(),
                _ => 0,
            });
            if matches!(op, GraphOp::Input) && durations[i].is_finite() {
                s.queued[i] = true;
                s.queue.push(Reverse(Event(durations[i], i)));
            }
        }
        while let Some(Reverse(Event(t, i))) = s.queue.pop() {
            s.times[i] = t;
            for &j in &self.dependents[self.offsets[i]..self.offsets[i + 1]] {
                if s.queued[j] {
                    continue;
                }
                match self.ops[j] {
                    GraphOp::Any(_) => {
                        s.accepted[j] = i;
                        s.queued[j] = true;
                        s.queue.push(Reverse(Event(t, j)));
                    }
                    GraphOp::All(_) => {
                        s.waiting[j] -= 1;
                        s.latest[j] = s.latest[j].max(t);
                        if s.waiting[j] == 0 {
                            // Past the largest float is never, not NaN: both
                            // sides are nonnegative.
                            let done = s.latest[j] + durations[j];
                            if done.is_finite() {
                                s.queued[j] = true;
                                s.queue.push(Reverse(Event(done, j)));
                            }
                        }
                    }
                    GraphOp::Input => {}
                }
            }
        }
    }

    /// The derivation of `node` from an evaluated sample: an explicit stack,
    /// through accepted producers and every prerequisite.
    pub(crate) fn derivation(&self, s: &Scratch, node: usize) -> Option<Witness> {
        if !s.times.get(node)?.is_finite() {
            return None;
        }
        let mut seen = vec![false; self.ops.len()];
        let mut stack = vec![node];
        let mut edges = Vec::new();
        seen[node] = true;
        while let Some(i) = stack.pop() {
            let inputs: &[usize] = match &self.ops[i] {
                GraphOp::Input => &[],
                GraphOp::Any(_) => std::slice::from_ref(&s.accepted[i]),
                GraphOp::All(inputs) => inputs,
            };
            for &j in inputs {
                edges.push((j, i));
                if !seen[j] {
                    seen[j] = true;
                    stack.push(j);
                }
            }
        }
        edges.sort_unstable();
        Some(Witness {
            nodes: (0..self.ops.len()).filter(|&i| seen[i]).collect(),
            edges,
        })
    }
}
