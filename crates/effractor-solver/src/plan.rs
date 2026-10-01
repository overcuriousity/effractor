//! The model, flattened once: everything reachable from top, children before
//! parents, leaves numbered in the order every analysis uses.

use std::collections::{HashMap, HashSet};

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
        let mut on_path: HashSet<&NodeId> = HashSet::new();
        let (top, _) = model.nodes.get_key_value(&model.top).ok_or(InvalidModel)?;
        let mut path: Vec<(&NodeId, usize)> = vec![(top, 0)];
        on_path.insert(top);
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
                if !on_path.insert(child) {
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
    /// listing.
    ///
    /// Only what a leaf makes true is looked at: from the leaf up, a gate is
    /// visited when an input of it turns true and turns true itself once
    /// enough have, and the walk stops at a step from which `or`s alone lead
    /// to top — that step true, top is. A tree, or a chain of `or`s or of
    /// `and`s, costs O(steps + edges) in all. Evaluating the whole model
    /// again for every leaf cost O(leaves × (steps + edges)): half a minute
    /// for a chain of 40,000. What remains is a leaf that turns long stretches
    /// of the model true without reaching such a step, in a model that
    /// shares it under many `and`s; no method is linear there in general (it
    /// is intersecting reachable sets), and a limit would need an answer
    /// besides yes and no. Gates without inputs are refused by validation.
    pub(crate) fn single_points_of_failure(&self) -> Vec<bool> {
        let n = self.steps.len();
        // Who reads each step, as one flat list.
        let mut offsets = vec![0usize; n + 1];
        for step in &self.steps {
            if let Step::Gate { inputs, .. } = step {
                for &j in inputs {
                    offsets[j + 1] += 1;
                }
            }
        }
        for i in 0..n {
            offsets[i + 1] += offsets[i];
        }
        let mut readers = vec![0usize; offsets[n]];
        let mut fill = offsets.clone();
        for (i, step) in self.steps.iter().enumerate() {
            if let Step::Gate { inputs, .. } = step {
                for &j in inputs {
                    readers[fill[j]] = i;
                    fill[j] += 1;
                }
            }
        }
        // Enough for top: top, and the inputs of an `or` (or a vote of one)
        // that is. Readers sit at higher indices, so one pass down.
        let mut enough = vec![false; n];
        enough[self.top()] = true;
        for i in (0..n).rev() {
            if let Step::Gate { gate, inputs } = &self.steps[i]
                && enough[i]
                && matches!(gate, Gate::Or | Gate::Vote { k: 1 })
            {
                for &j in inputs {
                    enough[j] = true;
                }
            }
        }
        let need = |i: usize| match &self.steps[i] {
            Step::Leaf(_) => 1,
            Step::Gate { gate, inputs } => match gate {
                Gate::Or => 1,
                Gate::And => inputs.len(),
                Gate::Vote { k } => *k,
            },
        };

        let mut true_inputs = vec![0usize; n];
        let mut on = vec![false; n];
        let mut touched: Vec<usize> = Vec::new();
        let mut queue: Vec<usize> = Vec::new();
        let mut out = vec![false; self.leaves.len()];
        for (i, step) in self.steps.iter().enumerate() {
            let Step::Leaf(leaf) = step else { continue };
            queue.push(i);
            on[i] = true;
            touched.push(i);
            while let Some(u) = queue.pop() {
                if enough[u] {
                    out[*leaf] = true;
                    break;
                }
                for &r in &readers[offsets[u]..offsets[u + 1]] {
                    true_inputs[r] += 1;
                    touched.push(r);
                    if !on[r] && true_inputs[r] >= need(r) {
                        on[r] = true;
                        queue.push(r);
                    }
                }
            }
            queue.clear();
            for t in touched.drain(..) {
                true_inputs[t] = 0;
                on[t] = false;
            }
        }
        out
    }

    /// When does each step complete, given when each leaf does? A leaf is its
    /// own time; `or` is the first of its inputs, `and` the last, `vote` the
    /// k-th. `INFINITY` is "never" and needs no special case: min, max and
    /// ordering already treat it correctly. A leaf time that is not a number
    /// is never too, as the graph evaluator has it — taken as one at the leaf,
    /// so no gate sees a NaN, which `max` and `min` would skip and a sort
    /// could put first. `out` is reused across iterations.
    pub fn times(&self, leaf_times: &[f64], out: &mut Vec<f64>, scratch: &mut Vec<f64>) {
        out.clear();
        for step in &self.steps {
            let t = match step {
                Step::Leaf(leaf) => match leaf_times[*leaf] {
                    t if t.is_nan() => f64::INFINITY,
                    t => t,
                },
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

#[cfg(test)]
mod tests {
    use effractor_core::{LeafKind, Model, Node, Profile, Ttc};

    use super::*;

    /// The definition: every leaf alone, every step evaluated.
    fn naive(plan: &Plan) -> Vec<bool> {
        let mut values = vec![false; plan.steps.len()];
        (0..plan.leaves.len())
            .map(|single| {
                for (i, step) in plan.steps.iter().enumerate() {
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
                values[plan.top()]
            })
            .collect()
    }

    fn build(top: &str, gates: Vec<(String, Gate, Vec<String>)>, leaves: &[String]) -> Plan {
        let mut m = Model::new("t", Profile::FaultTree, top.parse().unwrap());
        for (id, gate, children) in gates {
            let children = children.iter().map(|c| c.parse().unwrap()).collect();
            m.nodes
                .insert(id.parse().unwrap(), Node::gate("g", gate, children));
        }
        for id in leaves {
            m.nodes.insert(
                id.parse().unwrap(),
                Node::leaf("l", LeafKind::Basic, Some(Ttc::P(0.5))),
            );
        }
        Plan::build(&m).unwrap()
    }

    /// Small DAGs from a fixed generator: shared leaves and shared gates, every
    /// gate kind, held to the definition.
    #[test]
    fn single_points_of_failure_are_the_definition() {
        let mut state: u64 = 0x2545_f491_4f6c_dd1d;
        let mut next = |n: usize| {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            (state >> 33) as usize % n
        };
        for _ in 0..500 {
            let n_leaves = 2 + next(7);
            let n_gates = 1 + next(7);
            let leaves: Vec<String> = (0..n_leaves).map(|i| format!("l{i}")).collect();
            let mut pool = leaves.clone();
            let mut gates = Vec::new();
            for g in 0..n_gates {
                let mut children: Vec<String> = Vec::new();
                for _ in 0..1 + next(4) {
                    let c = pool[next(pool.len())].clone();
                    if !children.contains(&c) {
                        children.push(c);
                    }
                }
                let gate = match next(3) {
                    0 => Gate::Or,
                    1 => Gate::And,
                    _ => Gate::Vote {
                        k: 1 + next(children.len()),
                    },
                };
                let id = format!("g{g}");
                gates.push((id.clone(), gate, children));
                pool.push(id);
            }
            let top = format!("g{}", n_gates - 1);
            let plan = build(&top, gates, &leaves);
            assert_eq!(plan.single_points_of_failure(), naive(&plan));
        }
    }

    /// Chains as long as a model can be: each leaf's answer is found near
    /// it, not by evaluating the whole model again for every leaf.
    #[test]
    fn single_points_of_failure_of_long_chains_come_at_once() {
        let n = 40_000;
        let leaves: Vec<String> = (0..n).map(|i| format!("l{i}")).collect();
        for gate in [Gate::Or, Gate::And] {
            // g0 = l0, gᵢ = gate(lᵢ, gᵢ₋₁); top is the last.
            let mut gates = vec![("g0".to_owned(), Gate::Or, vec!["l0".to_owned()])];
            for i in 1..n {
                gates.push((
                    format!("g{i}"),
                    gate,
                    vec![format!("l{i}"), format!("g{}", i - 1)],
                ));
            }
            let plan = build(&format!("g{}", n - 1), gates, &leaves);
            let spof = plan.single_points_of_failure();
            let want = if gate == Gate::Or { n } else { 0 };
            assert_eq!(spof.iter().filter(|s| **s).count(), want);
        }
    }
}
