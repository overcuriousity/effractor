//! The attacker's view of the cut sets: what each costs, how long it takes,
//! how likely it is to be noticed — and which are worth choosing between.

use effractor_core::Distribution;

use crate::dist::cdf;

/// What the model says about one leaf, as the attacker sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct Step {
    pub ttc: Distribution,
    /// Missing attributes count as zero — free, unnoticed — and the caller
    /// reports which were missing; an optimistic attacker is the safe default.
    pub cost: Option<f64>,
    pub detection: Option<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Attack {
    /// Index into the cut sets this was built from.
    pub set: usize,
    /// Sum over the set. A leaf shared between branches is in the set once
    /// and is paid for once.
    pub cost: f64,
    /// 1 − Π(1 − dᵢ): noticed at any step is noticed.
    pub detection: f64,
    /// Π pᵢ(T): every step done within the horizon.
    pub success: f64,
    /// E[max TTCᵢ | every step succeeds at all]. All steps start at once;
    /// `INFINITY` if some step never succeeds or has no finite mean.
    pub time: f64,
    /// Not dominated in (cost, time, detection), all three minimised.
    pub on_front: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Attacker {
    pub attacks: Vec<Attack>,
    /// The cheapest attack that can succeed; ties go to the faster, then to
    /// the earlier set.
    pub cheapest: Option<usize>,
}

/// Restricting this to *minimal* cut sets loses nothing: cost, time and
/// detection can only grow when a set does, so every non-minimal set is
/// dominated by the minimal one inside it.
pub fn attacker(sets: &[Vec<usize>], steps: &[Step], horizon: f64) -> Attacker {
    let mut attacks: Vec<Attack> = sets
        .iter()
        .enumerate()
        .map(|(set, leaves)| {
            let in_set = || leaves.iter().map(|l| &steps[*l]);
            let ttcs: Vec<&Distribution> = in_set().map(|s| &s.ttc).collect();
            Attack {
                set,
                cost: in_set().map(|s| s.cost.unwrap_or(0.0)).sum(),
                detection: 1.0
                    - in_set()
                        .map(|s| 1.0 - s.detection.unwrap_or(0.0))
                        .product::<f64>(),
                success: in_set().map(|s| cdf(&s.ttc, horizon)).product(),
                time: expected_max(&ttcs),
                on_front: false,
            }
        })
        .collect();

    let key = |a: &Attack| [a.cost, a.time, a.detection];
    let dominates = |a: &Attack, b: &Attack| {
        key(a).iter().zip(key(b)).all(|(x, y)| *x <= y) && key(a) != key(b)
    };
    let viable: Vec<usize> = (0..attacks.len())
        .filter(|i| attacks[*i].success > 0.0)
        .collect();
    let front: Vec<usize> = viable
        .iter()
        .copied()
        .filter(|i| !viable.iter().any(|j| dominates(&attacks[*j], &attacks[*i])))
        .collect();
    for i in front {
        attacks[i].on_front = true;
    }
    let cheapest = viable.into_iter().min_by(|a, b| {
        let (a, b) = (&attacks[*a], &attacks[*b]);
        a.cost
            .total_cmp(&b.cost)
            .then(a.time.total_cmp(&b.time))
            .then(a.set.cmp(&b.set))
    });
    Attacker { attacks, cheapest }
}

/// E[max Xᵢ] with each Xᵢ conditioned on being finite: ∫₀^∞ 1 − Π F̃ᵢ(t) dt.
///
/// The half-line is folded onto [0, 1) by t = m·s / (1 − s), with m the median
/// of the maximum — so half the mass sits either side of s = ½ whether times
/// run to microseconds or millennia — and integrated by Simpson's rule.
pub fn expected_max(ttcs: &[&Distribution]) -> f64 {
    let mass: Vec<f64> = ttcs.iter().map(|d| cdf(d, f64::INFINITY)).collect();
    if mass.iter().any(|m| *m <= 0.0) || ttcs.iter().any(|d| has_no_mean(d)) {
        return f64::INFINITY;
    }
    let g = |t: f64| {
        ttcs.iter()
            .zip(&mass)
            .map(|(d, m)| cdf(d, t) / m)
            .product::<f64>()
    };

    let mut median = 1.0;
    while g(median) < 0.5 && median < 1e300 {
        median *= 2.0;
    }
    while g(median / 2.0) >= 0.5 && median > 1e-300 {
        median /= 2.0;
    }
    if median <= 1e-300 {
        return 0.0; // everything happens at once
    }

    const PANELS: usize = 4000; // even
    let h = 1.0 / PANELS as f64;
    let integrand = |i: usize| {
        if i == PANELS {
            return 0.0; // s = 1 is t = ∞, where a finite mean leaves nothing
        }
        let s = i as f64 * h;
        let survival = 1.0 - g(median * s / (1.0 - s));
        survival * median / ((1.0 - s) * (1.0 - s))
    };
    let sum: f64 = (0..=PANELS)
        .map(|i| {
            integrand(i)
                * if i == 0 || i == PANELS {
                    1.0
                } else if i % 2 == 1 {
                    4.0
                } else {
                    2.0
                }
        })
        .sum();
    sum * h / 3.0
}

fn has_no_mean(d: &Distribution) -> bool {
    match d {
        Distribution::Pareto { alpha, .. } => *alpha <= 1.0,
        Distribution::Product(_, inner) => has_no_mean(inner),
        Distribution::Named(s) => has_no_mean(&s.expand()),
        _ => false,
    }
}
