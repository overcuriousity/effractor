use effractor_core::{Distribution as D, Shorthand};
use effractor_solver::dist::{CHUNK, cdf, chunk_rng, sample};
use proptest::prelude::*;

fn close(got: f64, want: f64, tol: f64) {
    assert!((got - want).abs() <= tol, "got {got}, want {want}");
}

fn product(p: f64, d: D) -> D {
    D::Product(p, Box::new(d))
}

#[test]
fn cdfs_match_closed_forms() {
    close(cdf(&D::Exponential(0.5), 2.0), 1.0 - (-1.0f64).exp(), 1e-15);
    // Tiny rates are the fault-tree case; 1 - exp(-x) would lose every digit.
    close(cdf(&D::Exponential(1e-12), 1.0), 1e-12, 1e-24);

    close(cdf(&D::Bernoulli(0.3), 0.0), 0.3, 0.0);
    close(cdf(&D::Bernoulli(0.3), 1e9), 0.3, 0.0);

    // Gamma(1, θ) is Exponential(1/θ); Gamma(2, 1) has 1 - (1 + t)e^-t.
    close(
        cdf(
            &D::Gamma {
                shape: 1.0,
                scale: 2.0,
            },
            3.0,
        ),
        cdf(&D::Exponential(0.5), 3.0),
        1e-14,
    );
    for t in [0.1, 1.0, 5.0, 30.0] {
        close(
            cdf(
                &D::Gamma {
                    shape: 2.0,
                    scale: 1.0,
                },
                t,
            ),
            1.0 - (1.0 + t) * (-t).exp(),
            1e-13,
        );
    }

    close(
        cdf(
            &D::LogNormal {
                mu: 1.5,
                sigma: 0.7,
            },
            1.5f64.exp(),
        ),
        0.5,
        1e-15,
    );
    close(
        cdf(
            &D::LogNormal {
                mu: 0.0,
                sigma: 1.0,
            },
            1f64.exp(),
        ),
        0.841_344_746_068_542_9,
        1e-14,
    );

    close(
        cdf(
            &D::Pareto {
                xm: 2.0,
                alpha: 3.0,
            },
            1.9,
        ),
        0.0,
        0.0,
    );
    close(
        cdf(
            &D::Pareto {
                xm: 2.0,
                alpha: 3.0,
            },
            4.0,
        ),
        1.0 - 0.125,
        1e-15,
    );

    // Truncated at 0: no mass below it, and the rest renormalised.
    let tn = D::TruncatedNormal { mean: 1.0, sd: 1.0 };
    close(cdf(&tn, 0.0), 0.0, 0.0);
    let phi = |z: f64| {
        cdf(
            &D::LogNormal {
                mu: 0.0,
                sigma: 1.0,
            },
            z.exp(),
        )
    };
    close(
        cdf(&tn, 2.0),
        (phi(1.0) - phi(-1.0)) / (1.0 - phi(-1.0)),
        1e-14,
    );

    close(cdf(&D::Zero, 0.0), 1.0, 0.0);
    close(cdf(&D::Infinity, 1e300), 0.0, 0.0);
    close(cdf(&D::Infinity, f64::INFINITY), 0.0, 0.0);
    close(
        cdf(&product(0.4, D::Exponential(1.0)), 1.0),
        0.4 * (1.0 - (-1.0f64).exp()),
        1e-15,
    );
    close(
        cdf(&D::Named(Shorthand::HardAndUncertain), 10.0),
        0.5 * (1.0 - (-1.0f64).exp()),
        1e-15,
    );

    close(cdf(&D::Const(5.0), 4.9), 0.0, 0.0);
    close(cdf(&D::Const(5.0), 5.0), 1.0, 0.0);
    // A symmetric Pert has its median at the mode; Pert(0, .5, 1) is Beta(3, 3).
    close(
        cdf(
            &D::Pert {
                min: 0.0,
                mode: 0.5,
                max: 1.0,
            },
            0.5,
        ),
        0.5,
        1e-13,
    );
    let x: f64 = 0.3; // I_x(3,3) = 10x^3 - 15x^4 + 6x^5
    close(
        cdf(
            &D::Pert {
                min: 0.0,
                mode: 0.5,
                max: 1.0,
            },
            x,
        ),
        10.0 * x.powi(3) - 15.0 * x.powi(4) + 6.0 * x.powi(5),
        1e-13,
    );
}

#[test]
fn nothing_happens_before_time_zero() {
    for d in [
        D::Bernoulli(1.0),
        D::Zero,
        D::Exponential(1.0),
        D::Const(0.0),
    ] {
        assert_eq!(cdf(&d, -1e-9), 0.0, "{d:?}");
    }
}

/// Kolmogorov–Smirnov distance between draws and the CDF they claim to follow.
/// Seeded, so this is a fixed computation, not a flaky one.
fn ks(d: &D, n: usize) -> f64 {
    let mut rng = chunk_rng(7, 0);
    let mut xs: Vec<f64> = (0..n).map(|_| sample(d, &mut rng)).collect();
    xs.sort_by(f64::total_cmp);
    xs.iter().enumerate().fold(0.0, |worst, (i, x)| {
        let f = cdf(d, *x);
        worst
            .max((f - i as f64 / n as f64).abs())
            .max(((i + 1) as f64 / n as f64 - f).abs())
    })
}

#[test]
fn samples_follow_their_cdf() {
    let n = 20_000;
    let critical = 1.63 / (n as f64).sqrt(); // alpha = 0.01
    for d in [
        D::Exponential(0.3),
        D::Gamma {
            shape: 0.4,
            scale: 2.0,
        },
        D::Gamma {
            shape: 1.0,
            scale: 1.0,
        },
        D::Gamma {
            shape: 7.5,
            scale: 0.5,
        },
        D::LogNormal {
            mu: 0.5,
            sigma: 1.2,
        },
        D::Pareto {
            xm: 1.5,
            alpha: 2.5,
        },
        D::TruncatedNormal { mean: 1.0, sd: 2.0 },
        D::TruncatedNormal {
            mean: -2.0,
            sd: 1.0,
        },
        D::TruncatedNormal {
            mean: 50.0,
            sd: 1.0,
        },
        D::Pert {
            min: 10.0,
            mode: 12.0,
            max: 40.0,
        },
    ] {
        let distance = ks(&d, n);
        assert!(distance < critical, "{d:?}: KS {distance} >= {critical}");
    }
}

#[test]
fn mixtures_put_the_right_mass_on_never() {
    let n = 40_000;
    for (d, p) in [
        (D::Bernoulli(0.3), 0.3),
        (product(0.7, D::Exponential(1.0)), 0.7),
        (D::Named(Shorthand::EasyAndUncertain), 0.5),
    ] {
        let mut rng = chunk_rng(11, 0);
        let finite = (0..n).filter(|_| sample(&d, &mut rng).is_finite()).count() as f64 / n as f64;
        close(finite, p, 0.01);
    }
    let mut rng = chunk_rng(1, 0);
    assert_eq!(sample(&D::Bernoulli(1.0), &mut rng), 0.0);
    assert_eq!(sample(&D::Bernoulli(0.0), &mut rng), f64::INFINITY);
    assert_eq!(sample(&D::Zero, &mut rng), 0.0);
    assert_eq!(sample(&D::Infinity, &mut rng), f64::INFINITY);
    assert_eq!(sample(&D::Const(9.5), &mut rng), 9.5);
}

#[test]
fn chunks_are_independent_streams_of_one_seed() {
    let draw = |seed, chunk| {
        let mut rng = chunk_rng(seed, chunk);
        (0..4)
            .map(|_| sample(&D::Exponential(1.0), &mut rng).to_bits())
            .collect::<Vec<_>>()
    };
    assert_eq!(draw(42, 3), draw(42, 3));
    assert_ne!(draw(42, 3), draw(42, 4));
    assert_ne!(draw(42, 3), draw(43, 3));
    assert_eq!(CHUNK, 4096);
}

/// FNV-1a over the raw bits of one chunk of draws.
fn fingerprint(d: &D) -> u64 {
    let mut rng = chunk_rng(42, 3);
    (0..CHUNK).fold(0xcbf2_9ce4_8422_2325u64, |h, _| {
        sample(d, &mut rng)
            .to_bits()
            .to_le_bytes()
            .iter()
            .fold(h, |h, b| {
                (h ^ u64::from(*b)).wrapping_mul(0x0000_0100_0000_01b3)
            })
    })
}

/// The reproducibility contract. These constants were produced once, natively;
/// CI runs this same test under wasmtime. If both pass, native and wasm agree
/// bit for bit — and a change that moves any of them is a change to every
/// result anyone has ever recorded, so it should be loud.
#[test]
fn draws_are_bit_identical_everywhere() {
    let got: Vec<(&str, u64)> = vec![
        ("exponential", fingerprint(&D::Exponential(0.3))),
        (
            "gamma<1",
            fingerprint(&D::Gamma {
                shape: 0.4,
                scale: 2.0,
            }),
        ),
        (
            "gamma>1",
            fingerprint(&D::Gamma {
                shape: 7.5,
                scale: 0.5,
            }),
        ),
        (
            "lognormal",
            fingerprint(&D::LogNormal {
                mu: 0.5,
                sigma: 1.2,
            }),
        ),
        (
            "pareto",
            fingerprint(&D::Pareto {
                xm: 1.5,
                alpha: 2.5,
            }),
        ),
        (
            "truncnormal",
            fingerprint(&D::TruncatedNormal { mean: 1.0, sd: 2.0 }),
        ),
        (
            "pert",
            fingerprint(&D::Pert {
                min: 10.0,
                mode: 12.0,
                max: 40.0,
            }),
        ),
        ("product", fingerprint(&product(0.7, D::Exponential(1.0)))),
    ];
    let want: Vec<(&str, u64)> = include!("dist_fingerprints.in");
    assert_eq!(got, want);
}

fn ttc() -> impl Strategy<Value = D> {
    prop_oneof![
        (0.0..=1.0f64).prop_map(D::Bernoulli),
        (1e-9..1e3f64).prop_map(D::Exponential),
        (0.05..50.0f64, 1e-3..1e3f64).prop_map(|(shape, scale)| D::Gamma { shape, scale }),
        (-5.0..5.0f64, 0.05..3.0f64).prop_map(|(mu, sigma)| D::LogNormal { mu, sigma }),
        (1e-3..1e3f64, 0.1..10.0f64).prop_map(|(xm, alpha)| D::Pareto { xm, alpha }),
        (-10.0..100.0f64, 0.1..50.0f64).prop_map(|(mean, sd)| D::TruncatedNormal { mean, sd }),
        (0.0..=1.0f64, 1e-6..10.0f64).prop_map(|(p, rate)| product(p, D::Exponential(rate))),
    ]
}

proptest! {
    #[test]
    fn a_cdf_is_a_cdf(d in ttc(), a in 0.0..1e4f64, b in 0.0..1e4f64) {
        let (lo, hi) = if a <= b { (a, b) } else { (b, a) };
        let (f_lo, f_hi) = (cdf(&d, lo), cdf(&d, hi));
        prop_assert!((0.0..=1.0).contains(&f_lo) && (0.0..=1.0).contains(&f_hi), "{f_lo} {f_hi}");
        prop_assert!(f_lo <= f_hi + 1e-12, "not monotone: F({lo}) = {f_lo} > F({hi}) = {f_hi}");
    }

    #[test]
    fn a_draw_is_a_time(d in ttc(), seed in any::<u64>()) {
        let mut rng = chunk_rng(seed, 0);
        for _ in 0..64 {
            let t = sample(&d, &mut rng);
            prop_assert!(t >= 0.0, "{t}"); // also rules out NaN
        }
    }
}
