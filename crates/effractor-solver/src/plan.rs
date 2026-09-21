//! The model, flattened once: everything reachable from top, children before
//! parents, leaves numbered in the order every analysis uses.

use std::collections::HashMap;

use effractor_core::{Gate, Model, NodeId, NodeKind};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Step {
    /// Index into [`Plan::leaves`].
    Leaf(usize),
    /// Indices into [`Plan::steps`], all smaller than this step's own.
    Gate { gate: Gate, inputs: Vec<usize> },
}

#[derive(Debug, Clone)]
pub struct Plan {
    /// Depth-first from top, children in document order. This is the BDD's
    /// variable order and the order leaves are sampled in; both being the same
    /// list is what lets exact and sampled results talk about "leaf 3".
    pub leaves: Vec<NodeId>,
    pub steps: Vec<Step>,
    pub ids: Vec<NodeId>,
    pub index: HashMap<NodeId, usize>,
}

/// A cycle or a dangling reference. `core::validate` reports these properly;
/// this only guarantees that no analysis loops or panics on one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InvalidModel;

impl Plan {
    /// Iterative: a model is user input, and its depth must not be able to
    /// overflow a stack.
    pub fn build(model: &Model) -> Result<Plan, InvalidModel> {
        let mut plan = Plan {
            leaves: vec![],
            steps: vec![],
            ids: vec![],
            index: HashMap::new(),
        };
        let mut on_path: HashMap<&NodeId, ()> = HashMap::new();
        let (top, _) = model.nodes.get_key_value(&model.top).ok_or(InvalidModel)?;
        let mut path: Vec<(&NodeId, usize)> = vec![(top, 0)];
        on_path.insert(top, ());
        while let Some((id, next)) = path.last_mut() {
            let id = *id;
            let children: &[NodeId] = match &model.nodes[id].kind {
                NodeKind::Gate { children, .. } => children,
                NodeKind::Leaf(_) => &[],
            };
            if let Some(child) = children.get(*next) {
                *next += 1;
                let (child, _) = model.nodes.get_key_value(child).ok_or(InvalidModel)?;
                if plan.index.contains_key(child) {
                    continue;
                }
                if on_path.insert(child, ()).is_some() {
                    return Err(InvalidModel);
                }
                path.push((child, 0));
                continue;
            }
            let step = match &model.nodes[id].kind {
                NodeKind::Leaf(_) => {
                    plan.leaves.push(id.clone());
                    Step::Leaf(plan.leaves.len() - 1)
                }
                NodeKind::Gate { gate, children } => Step::Gate {
                    gate: *gate,
                    inputs: children.iter().map(|c| plan.index[c]).collect(),
                },
            };
            plan.index.insert(id.clone(), plan.steps.len());
            plan.steps.push(step);
            plan.ids.push(id.clone());
            on_path.remove(id);
            path.pop();
        }
        Ok(plan)
    }

    /// Test each leaf alone, with every other leaf false. In this coherent
    /// model (no constants or negation), top being true makes that leaf a
    /// singleton minimal cut set. This stays exact without a BDD or a cut-set
    /// listing. O(leaves * (steps + edges)) time, O(steps) scratch space.
    pub(crate) fn single_points_of_failure(&self) -> Vec<bool> {
        let mut values = vec![false; self.steps.len()];
        (0..self.leaves.len())
            .map(|single| {
                for (i, step) in self.steps.iter().enumerate() {
                    values[i] = match step {
                        Step::Leaf(leaf) => *leaf == single,
                        Step::Gate { gate, inputs } => match gate {
                            Gate::Or => inputs.iter().any(|j| values[*j]),
                            Gate::And => inputs.iter().all(|j| values[*j]),
                            Gate::Vote { k } => {
                                inputs.iter().filter(|j| values[**j]).take(*k).count() == *k
                            }
                        },
                    };
                }
                values[self.top()]
            })
            .collect()
    }

    /// When does each step complete, given when each leaf does? A leaf is its
    /// own time; `or` is the first of its inputs, `and` the last, `vote` the
    /// k-th. `INFINITY` is "never" and needs no special case: min, max and
    /// ordering already treat it correctly. `out` is reused across iterations.
    pub fn times(&self, leaf_times: &[f64], out: &mut Vec<f64>, scratch: &mut Vec<f64>) {
        out.clear();
        for step in &self.steps {
            let t = match step {
                Step::Leaf(leaf) => leaf_times[*leaf],
                Step::Gate { gate, inputs } => match gate {
                    Gate::Or => inputs.iter().map(|i| out[*i]).fold(f64::INFINITY, f64::min),
                    Gate::And => inputs.iter().map(|i| out[*i]).fold(0.0, f64::max),
                    Gate::Vote { k } => {
                        scratch.clear();
                        scratch.extend(inputs.iter().map(|i| out[*i]));
                        scratch.sort_by(f64::total_cmp);
                        scratch
                            .get(k.wrapping_sub(1))
                            .copied()
                            .unwrap_or(f64::INFINITY)
                    }
                },
            };
            out.push(t);
        }
    }

    /// The last step is top: it is finished last.
    pub fn top(&self) -> usize {
        self.steps.len() - 1
    }
}
