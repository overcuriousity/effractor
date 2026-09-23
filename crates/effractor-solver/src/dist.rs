//! CDFs and samplers for every [`Distribution`], and the RNG stream scheme.

use effractor_core::Distribution;
use libm::{exp, expm1, log, pow, sqrt};
use rand_chacha::ChaCha8Rng;
use rand_core::{Rng, SeedableRng};

use crate::special::{beta_i, gamma_p, phi, phi_inv};

/// Samples are drawn in chunks of this many iterations, each from its own RNG
/// stream. It is part of the reproducibility contract: changing it changes
/// every sampled result.
pub const CHUNK: usize = 4096;

/// The RNG for chunk `chunk` of a run seeded with `seed`. ChaCha streams are
/// independent, so chunks can be computed in any order, on any number of
/// threads, and merged by index into the same result.
pub fn chunk_rng(seed: u64, chunk: u64) -> ChaCha8Rng {
    let mut key = [0u8; 32];
    key[..8].copy_from_slice(&seed.to_le_bytes());
    let mut rng = ChaCha8Rng::from_seed(key);
    rng.set_stream(chunk);
    rng
}

/// Uniform on the open interval (0, 1): 53 bits, centred in their cell, so
/// neither `log(0)` nor a quantile of exactly 1 can happen.
fn uniform(rng: &mut ChaCha8Rng) -> f64 {
    ((rng.next_u64() >> 11) as f64 + 0.5) * (1.0 / 9_007_199_254_740_992.0)
}

fn normal(rng: &mut ChaCha8Rng) -> f64 {
    phi_inv(uniform(rng))
}

/// Marsaglia–Tsang. For shape < 1, draw at shape + 1 and scale back by
/// U^(1/shape).
fn gamma(shape: f64, rng: &mut ChaCha8Rng) -> f64 {
    if shape < 1.0 {
        let boost = pow(uniform(rng), 1.0 / shape);
        return gamma(shape + 1.0, rng) * boost;
    }
    let d = shape - 1.0 / 3.0;
    let c = 1.0 / sqrt(9.0 * d);
    loop {
        let x = normal(rng);
        let v = 1.0 + c * x;
        let v = v * v * v;
        if v <= 0.0 {
            continue;
        }
        if log(uniform(rng)) < 0.5 * x * x + d - d * v + d * log(v) {
            return d * v;
        }
    }
}

/// Standard normal upper tail, Q(z) = 1 - Φ(z), without the subtraction.
fn upper(z: f64) -> f64 {
    phi(-z)
}

enum Truncation {
    /// Q(a), the mass of the normal above 0, where a = -mean / sd.
    Tail(f64),
    /// That mass underflowed.
    Exponential(f64),
}

/// A normal truncated at 0 is worked in its upper tail: what is left above 0
/// can be tiny, and `1 - Φ(a)` would round it to nothing long before `Q(a)`
/// does. Past a ≈ 38 even `Q(a)` underflows; out there the truncated normal
/// *is* an exponential with rate a / sd to every digit f64 has, so it is
/// computed as one instead of as 0 / 0.
fn truncation(mean: f64, sd: f64) -> Truncation {
    let a = -mean / sd;
    let q_a = upper(a);
    if q_a > 1e-300 {
        Truncation::Tail(q_a)
    } else {
        Truncation::Exponential(a / sd)
    }
}

fn pert_shape(min: f64, mode: f64, max: f64) -> (f64, f64) {
    let range = max - min;
    (
        1.0 + 4.0 * (mode - min) / range,
        1.0 + 4.0 * (max - mode) / range,
    )
}

/// One draw. As a time-to-compromise, `INFINITY` means "never".
pub fn sample(d: &Distribution, rng: &mut ChaCha8Rng) -> f64 {
    use Distribution as D;
    match d {
        D::Bernoulli(p) => {
            if uniform(rng) < *p {
                0.0
            } else {
                f64::INFINITY
            }
        }
        D::Exponential(rate) => -log(uniform(rng)) / rate,
        // The rate first, then used as the arm above uses it: the same bits.
        D::ExponentialMean(mean) => -log(uniform(rng)) / (1.0 / mean),
        D::Gamma { shape, scale } => gamma(*shape, rng) * scale,
        D::LogNormal { mu, sigma } => exp(mu + sigma * normal(rng)),
        D::Pareto { xm, alpha } => xm / pow(uniform(rng), 1.0 / alpha),
        D::TruncatedNormal { mean, sd } => match truncation(*mean, *sd) {
            // X = mean + sd * Q⁻¹(U * Q(a)), all in the upper tail.
            Truncation::Tail(q_a) => (mean - sd * phi_inv(uniform(rng) * q_a)).max(0.0),
            Truncation::Exponential(rate) => -log(uniform(rng)) / rate,
        },
        D::Zero => 0.0,
        D::Infinity => f64::INFINITY,
        D::Product(p, inner) => {
            if uniform(rng) < *p {
                sample(inner, rng)
            } else {
                f64::INFINITY
            }
        }
        D::Named(s) => sample(&s.expand(), rng),
        D::Const(v) => *v,
        D::Pert { min, mode, max } => {
            let (a, b) = pert_shape(*min, *mode, *max);
            let (x, y) = (gamma(a, rng), gamma(b, rng));
            min + (max - min) * x / (x + y)
        }
    }
}

/// P(X <= t). For a time-to-compromise this is the probability the step has
/// happened by `t`; it tops out at the mass that is not "never".
pub fn cdf(d: &Distribution, t: f64) -> f64 {
    use Distribution as D;
    if t < 0.0 || t.is_nan() {
        return 0.0;
    }
    match d {
        D::Bernoulli(p) => *p,
        D::Exponential(rate) => -expm1(-rate * t),
        D::ExponentialMean(mean) => -expm1(-(1.0 / mean) * t),
        D::Gamma { shape, scale } => gamma_p(*shape, t / scale),
        D::LogNormal { mu, sigma } => {
            if t == 0.0 {
                0.0
            } else {
                phi((log(t) - mu) / sigma)
            }
        }
        D::Pareto { xm, alpha } => {
            if t < *xm {
                0.0
            } else {
                1.0 - pow(xm / t, *alpha)
            }
        }
        D::TruncatedNormal { mean, sd } => match truncation(*mean, *sd) {
            Truncation::Tail(q_a) => (1.0 - upper((t - mean) / sd) / q_a).clamp(0.0, 1.0),
            Truncation::Exponential(rate) => -expm1(-rate * t),
        },
        D::Zero => 1.0,
        D::Infinity => 0.0,
        D::Product(p, inner) => p * cdf(inner, t),
        D::Named(s) => cdf(&s.expand(), t),
        D::Const(v) => {
            if t >= *v {
                1.0
            } else {
                0.0
            }
        }
        D::Pert { min, mode, max } => {
            let (a, b) = pert_shape(*min, *mode, *max);
            beta_i(a, b, (t - min) / (max - min))
        }
    }
}
