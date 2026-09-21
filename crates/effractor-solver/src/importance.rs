//! How much each leaf matters.

use crate::bdd::{Bdd, BddError, Ref};
use crate::mcs::CutSets;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Importance {
    /// Birnbaum: P(top | leaf holds) − P(top | leaf does not). How much top's
    /// probability moves with this leaf's — independent of the leaf's own.
    pub birnbaum: f64,
    /// Fussell–Vesely, by its definition: the probability that at least one
    /// minimal cut set *containing this leaf* holds, given that top does. Not
    /// the rare-event shortcut 1 − P(top | leaf = 0) / P(top), which differs
    /// as soon as cut sets overlap with any weight.
    pub fussell_vesely: f64,
}

/// One entry per variable, in variable order.
pub fn importance(
    bdd: &mut Bdd,
    top: Ref,
    cut_sets: &CutSets,
    leaf_p: &[f64],
) -> Result<Vec<Importance>, BddError> {
    let (_, containing) = cut_sets.as_functions(bdd, leaf_p.len())?;
    let p_top = bdd.prob(top, leaf_p);
    Ok((0..leaf_p.len())
        .map(|v| Importance {
            birnbaum: bdd.prob_given(top, leaf_p, v, true) - bdd.prob_given(top, leaf_p, v, false),
            fussell_vesely: if p_top > 0.0 {
                bdd.prob(containing[v], leaf_p) / p_top
            } else {
                0.0
            },
        })
        .collect())
}
