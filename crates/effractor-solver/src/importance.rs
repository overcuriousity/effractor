//! How much each leaf matters.

use crate::bdd::{Bdd, BddError, Ref};
use crate::mcs::CutSets;

/// Birnbaum, one per variable: P(top | leaf holds) − P(top | leaf does not).
/// How much top's probability moves with this leaf's — independent of the
/// leaf's own. Needs nothing but the diagram.
pub fn birnbaum(bdd: &Bdd, top: Ref, leaf_p: &[f64]) -> Vec<f64> {
    (0..leaf_p.len())
        .map(|v| bdd.prob_given(top, leaf_p, v, true) - bdd.prob_given(top, leaf_p, v, false))
        .collect()
}

/// Fussell–Vesely, one per variable, by its definition: the probability that
/// at least one minimal cut set *containing this leaf* holds, given that top
/// does. Not the rare-event shortcut 1 − P(top | leaf = 0) / P(top), which
/// differs as soon as cut sets overlap with any weight. It adds a function per
/// leaf to the diagram, which is what can run into its node limit.
pub fn fussell_vesely(
    bdd: &mut Bdd,
    top: Ref,
    cut_sets: &CutSets,
    leaf_p: &[f64],
) -> Result<Vec<f64>, BddError> {
    let (_, containing) = cut_sets.as_functions(bdd, leaf_p.len())?;
    let p_top = bdd.prob(top, leaf_p);
    Ok((0..leaf_p.len())
        .map(|v| {
            if p_top > 0.0 {
                bdd.prob(containing[v], leaf_p) / p_top
            } else {
                0.0
            }
        })
        .collect())
}
