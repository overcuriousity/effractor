//! The special functions the distributions need, on top of `libm` only.
//!
//! `std`'s `f64::ln`, `exp`, `powf` and friends call the platform's libm
//! natively and a different implementation under wasm, and the two disagree in
//! the last bit often enough to move a Monte Carlo result. Nothing here, or
//! anywhere in this crate, may use them. `powi` is out too: it lowers to an
//! intrinsic whose rounding is not pinned down.

use libm::{erfc, exp, lgamma, log, sqrt};

const SQRT_2: f64 = core::f64::consts::SQRT_2;
const SQRT_2PI: f64 = 2.506_628_274_631_000_7;

/// Standard normal CDF.
pub fn phi(z: f64) -> f64 {
    0.5 * erfc(-z / SQRT_2)
}

/// Standard normal quantile: Acklam's rational approximation (relative error
/// 1.15e-9), then one Halley step against `erfc`, which takes it to the limits
/// of f64. `p` in (0, 1).
pub fn phi_inv(p: f64) -> f64 {
    const A: [f64; 6] = [
        -3.969683028665376e+01,
        2.209460984245205e+02,
        -2.759285104469687e+02,
        1.38357751867269e+02,
        -3.066479806614716e+01,
        2.506628277459239e+00,
    ];
    const B: [f64; 5] = [
        -5.447609879822406e+01,
        1.615858368580409e+02,
        -1.556989798598866e+02,
        6.680131188771972e+01,
        -1.328068155288572e+01,
    ];
    const C: [f64; 6] = [
        -7.784894002430293e-03,
        -3.223964580411365e-01,
        -2.400758277161838e+00,
        -2.549732539343734e+00,
        4.374664141464968e+00,
        2.938163982698783e+00,
    ];
    const D: [f64; 4] = [
        7.784695709041462e-03,
        3.224671290700398e-01,
        2.445134137142996e+00,
        3.754408661907416e+00,
    ];
    const LOW: f64 = 0.02425;

    let tail = |q: f64| {
        (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5])
            / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0)
    };
    let x = if p < LOW {
        tail(sqrt(-2.0 * log(p)))
    } else if p > 1.0 - LOW {
        -tail(sqrt(-2.0 * log(1.0 - p)))
    } else {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q
            / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    };
    let e = phi(x) - p;
    let u = e * SQRT_2PI * exp(x * x / 2.0);
    x - u / (1.0 + x * u / 2.0)
}

/// Regularized lower incomplete gamma P(a, x): series below a + 1, Lentz's
/// continued fraction above.
pub fn gamma_p(a: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x == f64::INFINITY {
        return 1.0;
    }
    let front = exp(a * log(x) - x - lgamma(a));
    if x < a + 1.0 {
        let (mut term, mut sum, mut n) = (1.0 / a, 1.0 / a, a);
        for _ in 0..1000 {
            n += 1.0;
            term *= x / n;
            sum += term;
            if term.abs() < sum.abs() * 1e-16 {
                break;
            }
        }
        (sum * front).clamp(0.0, 1.0)
    } else {
        const TINY: f64 = 1e-300;
        let mut b = x + 1.0 - a;
        let mut c = 1.0 / TINY;
        let mut d = 1.0 / b;
        let mut h = d;
        for i in 1..1000 {
            let i = f64::from(i);
            let an = -i * (i - a);
            b += 2.0;
            d = an * d + b;
            if d.abs() < TINY {
                d = TINY;
            }
            c = b + an / c;
            if c.abs() < TINY {
                c = TINY;
            }
            d = 1.0 / d;
            let delta = d * c;
            h *= delta;
            if (delta - 1.0).abs() < 1e-16 {
                break;
            }
        }
        (1.0 - front * h).clamp(0.0, 1.0)
    }
}

/// Regularized incomplete beta I_x(a, b).
pub fn beta_i(a: f64, b: f64, x: f64) -> f64 {
    if x <= 0.0 {
        return 0.0;
    }
    if x >= 1.0 {
        return 1.0;
    }
    let front = exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * log(x) + b * log(1.0 - x));
    // The continued fraction converges fast on one side of the mean only.
    if x < (a + 1.0) / (a + b + 2.0) {
        front * beta_cf(a, b, x) / a
    } else {
        1.0 - front * beta_cf(b, a, 1.0 - x) / b
    }
}

fn beta_cf(a: f64, b: f64, x: f64) -> f64 {
    const TINY: f64 = 1e-300;
    let guard = |v: f64| if v.abs() < TINY { TINY } else { v };
    let mut c = 1.0;
    let mut d = 1.0 / guard(1.0 - (a + b) * x / (a + 1.0));
    let mut h = d;
    for m in 1..1000 {
        let m = f64::from(m);
        let even = m * (b - m) * x / ((a + 2.0 * m - 1.0) * (a + 2.0 * m));
        d = 1.0 / guard(1.0 + even * d);
        c = guard(1.0 + even / c);
        h *= d * c;
        let odd = -(a + m) * (a + b + m) * x / ((a + 2.0 * m) * (a + 2.0 * m + 1.0));
        d = 1.0 / guard(1.0 + odd * d);
        c = guard(1.0 + odd / c);
        let delta = d * c;
        h *= delta;
        if (delta - 1.0).abs() < 1e-16 {
            break;
        }
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quantile_inverts_the_cdf() {
        for p in [
            1e-300,
            1e-12,
            1e-4,
            0.02,
            0.025,
            0.3,
            0.5,
            0.7,
            0.975,
            0.98,
            1.0 - 1e-12,
        ] {
            let back = phi(phi_inv(p));
            assert!((back - p).abs() <= p * 1e-12, "p = {p}: back = {back}");
        }
        assert_eq!(phi_inv(0.5), 0.0);
        assert!((phi_inv(0.975) - 1.959_963_984_540_054).abs() < 1e-14);
    }
}
