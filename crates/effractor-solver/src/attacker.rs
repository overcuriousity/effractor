//! The attacker's view of the cut sets: what each costs, how long it takes,
//! how likely it is to be noticed — and which are worth choosing between.

use core::f64::consts::{FRAC_PI_2, PI};

use effractor_core::Distribution;
use libm::{cosh, exp, expm1, log1p, pow, sinh};

use crate::dist::{cdf, tail};

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

/// E[max Xᵢ] with each Xᵢ conditioned on being finite: ∫₀^∞ S(t) dt, where
/// S(t) = 1 − Π F̃ᵢ(t) is the chance the slowest step is still running at t.
///
/// S is computed from the steps' tails, 1 − Π(1 − S̃ᵢ), so it keeps its
/// digits where a heavy tail's mean lies: far out, after `1 − cdf` has
/// rounded to 0. The half-line is split where some step's time jumps or
/// bends (a constant, a Pareto's minimum, a Pert's ends). Each finite piece
/// is integrated by tanh-sinh quadrature and the last, unbounded one by
/// exp-sinh, t = b + m·exp(π/2·sinh x) with m about the median of the
/// maximum: a tail that falls like a power is a double exponential in x, so
/// the trapezoid rule converges as fast there as for a light tail. Each
/// level halves the step, and the result is taken once two levels agree;
/// past the largest float a Pareto's tail is added in closed form. A mean
/// that no float holds is `INFINITY`, as is one that does not exist.
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
    let survival = |t: f64| {
        let log_done: f64 = ttcs
            .iter()
            .zip(&mass)
            .map(|(d, m)| log1p(-(tail(d, t) / m).min(1.0)))
            .sum();
        -expm1(log_done)
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

    let mut kinks = Vec::new();
    for d in ttcs {
        kinks_of(d, &mut kinks);
    }
    kinks.retain(|k| k.is_finite() && *k > 0.0);
    kinks.sort_by(f64::total_cmp);
    kinks.dedup();
    let mut pieces: Vec<Piece> = Vec::with_capacity(kinks.len() + 1);
    let mut from = 0.0;
    for k in kinks {
        pieces.push(Piece::Between(from, k));
        from = k;
    }
    pieces.push(Piece::After(from, median));

    let mut sums = vec![0.0; pieces.len()];
    let mut last = f64::NAN;
    let mut total = 0.0;
    for level in 0..=MAX_LEVEL {
        let h = 1.0 / (1u64 << level) as f64;
        for (piece, sum) in pieces.iter().zip(&mut sums) {
            let reach = (piece.reach() / h) as i64;
            // Level 0 takes every integer; each later one the odd multiples
            // of its step, which are the points the one before did not have.
            let (first, stride) = if level == 0 {
                (-reach, 1)
            } else {
                (-reach | 1, 2)
            };
            let mut added = 0.0;
            let mut k = first;
            while k <= reach {
                added += piece.integrand(k as f64 * h, &survival);
                k += stride;
            }
            *sum = if level == 0 {
                added
            } else {
                *sum / 2.0 + h * added
            };
        }
        total = sums.iter().sum::<f64>();
        if !total.is_finite() {
            return f64::INFINITY;
        }
        if level >= MIN_LEVEL && (total - last).abs() <= 1e-10 * total {
            break;
        }
        last = total;
    }
    let beyond: f64 = ttcs.iter().map(|d| pareto_beyond(d, f64::MAX)).sum();
    let mean = total + beyond;
    if mean.is_finite() {
        mean
    } else {
        f64::INFINITY
    }
}

/// The levels of [`expected_max`]'s step, 2⁻ˡᵉᵛᵉˡ: at least this fine
/// before two levels may agree by chance, and no finer than the last. A
/// smooth piece agrees by level 5 or 6.
const MIN_LEVEL: u32 = 3;
const MAX_LEVEL: u32 = 10;

/// A stretch of the time axis on which every step's time is smooth.
enum Piece {
    /// [a, b], by tanh-sinh.
    Between(f64, f64),
    /// [b, ∞), by exp-sinh at the given scale.
    After(f64, f64),
}

impl Piece {
    /// How far out in x the points go: beyond it a point weighs nothing.
    fn reach(&self) -> f64 {
        match self {
            // π/2·sinh(3.5) ≈ 26: a weight of e⁻⁵² of the piece's length.
            Piece::Between(..) => 3.5,
            // π/2·sinh(6.9) ≈ 780: t − b under- or overflows on either side.
            Piece::After(..) => 6.9,
        }
    }

    /// S(t(x))·dt/dx.
    fn integrand(&self, x: f64, survival: &dyn Fn(f64) -> f64) -> f64 {
        let y = FRAC_PI_2 * sinh(x);
        match *self {
            Piece::Between(a, b) => {
                // (1 + tanh y) / 2 = 1 / (1 + e⁻²ʸ), from the near end.
                let e = exp(-2.0 * y.abs());
                let near = (b - a) * (e / (1.0 + e));
                let weight = (b - a) * PI * cosh(x) * e / ((1.0 + e) * (1.0 + e));
                if weight == 0.0 {
                    return 0.0;
                }
                let t = if y < 0.0 { a + near } else { b - near };
                survival(t) * weight
            }
            Piece::After(b, scale) => {
                let u = scale * exp(y);
                let t = b + u;
                if u == 0.0 || !t.is_finite() {
                    return 0.0;
                }
                let s = survival(t);
                if s == 0.0 {
                    return 0.0;
                }
                s * u * (FRAC_PI_2 * cosh(x))
            }
        }
    }
}

/// Where `d`'s CDF jumps or bends away from 0 and ∞.
fn kinks_of(d: &Distribution, out: &mut Vec<f64>) {
    use Distribution as D;
    match d {
        D::Const(v) => out.push(*v),
        D::Pareto { xm, .. } => out.push(*xm),
        D::Pert { min, max, .. } => out.extend([*min, *max]),
        D::Product(_, inner) => kinks_of(inner, out),
        D::Named(s) => kinks_of(&s.expand(), out),
        _ => {}
    }
}

/// ∫ₜ^∞ of a Pareto's tail, given that it is finite: xm·(xm/t)^(α−1)/(α−1)
/// past its minimum. For t = the largest float it is what [`expected_max`]'s
/// points cannot reach; only a tail falling about as slowly as 1/t leaves
/// anything there. Every other kind leaves nothing.
fn pareto_beyond(d: &Distribution, t: f64) -> f64 {
    match d {
        Distribution::Pareto { xm, alpha } if t >= *xm => {
            xm * pow(xm / t, alpha - 1.0) / (alpha - 1.0)
        }
        Distribution::Product(_, inner) => pareto_beyond(inner, t),
        Distribution::Named(s) => pareto_beyond(&s.expand(), t),
        _ => 0.0,
    }
}

/// No mean at all, or one past the largest float.
fn has_no_mean(d: &Distribution) -> bool {
    match d {
        Distribution::Pareto { alpha, .. } => *alpha <= 1.0,
        // exp(μ + σ²/2) overflows past ln(f64::MAX) ≈ 709.78.
        Distribution::LogNormal { mu, sigma } => mu + sigma * sigma / 2.0 > 709.78,
        Distribution::Product(_, inner) => has_no_mean(inner),
        Distribution::Named(s) => has_no_mean(&s.expand()),
        _ => false,
    }
}
