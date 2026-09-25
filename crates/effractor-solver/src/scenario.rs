//! Which distribution each leaf has, once controls have had their say.

use effractor_core::{Distribution, Model, NodeKind};

use crate::dist::cdf;
use crate::plan::{Plan, Step};

/// One entry per plan leaf; `None` where the model gives the leaf no numbers.
///
/// `enabled` has one flag per control, in document order. While a control is
/// enabled its effects replace the leaf's own TTC. Where several enabled
/// controls touch one leaf, the effect that leaves it least likely within the
/// horizon applies — effects do not add up — and document order breaks ties.
pub fn leaf_distributions(
    model: &Model,
    plan: &Plan,
    enabled: &[bool],
) -> Vec<Option<Distribution>> {
    let mut out: Vec<Option<Distribution>> = plan
        .leaves
        .iter()
        .map(|id| match &model.nodes[id].kind {
            NodeKind::Leaf(leaf) => leaf.ttc.as_ref().map(|t| t.distribution()),
            NodeKind::Gate { .. } => None,
        })
        .collect();
    let mut strongest: Vec<Option<f64>> = vec![None; out.len()];
    for (control, _) in model.controls.values().zip(enabled).filter(|(_, on)| **on) {
        for effect in &control.effects {
            let Some(&Step::Leaf(leaf)) = plan.index.get(&effect.node).map(|s| &plan.steps[*s])
            else {
                continue;
            };
            let p = cdf(&effect.ttc, model.horizon);
            if strongest[leaf].is_none_or(|best| p < best) {
                strongest[leaf] = Some(p);
                out[leaf] = Some(effect.ttc.clone());
            }
        }
    }
    out
}

/// The as-is state of every control.
pub fn as_written(model: &Model) -> Vec<bool> {
    model.controls.values().map(|c| c.enabled).collect()
}
