use effractor_core::Distribution as D;
use effractor_solver::attacker::{Step, attacker, expected_max};

fn rel(got: f64, want: f64, tol: f64) {
    assert!(((got - want) / want).abs() < tol, "got {got}, want {want}");
}

#[test]
fn expected_time_of_the_slowest_step() {
    // One exponential, at every scale a model might use.
    for rate in [1e-6, 1e-3, 1.0, 1e3] {
        rel(expected_max(&[&D::Exponential(rate)]), 1.0 / rate, 1e-6);
    }
    // Two iid exponentials: 1/λ + 1/(2λ).
    rel(
        expected_max(&[&D::Exponential(0.2), &D::Exponential(0.2)]),
        7.5,
        1e-6,
    );
    // Different rates: 1/a + 1/b − 1/(a + b).
    rel(
        expected_max(&[&D::Exponential(0.5), &D::Exponential(0.01)]),
        2.0 + 100.0 - 1.0 / 0.51,
        1e-6,
    );
    rel(
        expected_max(&[&D::Gamma {
            shape: 3.0,
            scale: 2.0,
        }]),
        6.0,
        1e-6,
    );
    rel(
        expected_max(&[&D::LogNormal {
            mu: 1.0,
            sigma: 0.5,
        }]),
        (1.0f64 + 0.125).exp(),
        1e-6,
    );
    rel(
        expected_max(&[&D::Pareto {
            xm: 2.0,
            alpha: 3.0,
        }]),
        3.0,
        1e-4,
    );
}

/// A tail that falls like a power is most of the mean far out: the
/// integral has to reach it and keep its digits there.
#[test]
fn heavy_tails_are_integrated_to_the_end() {
    for alpha in [1.05, 1.1, 1.25, 1.5] {
        rel(
            expected_max(&[&D::Pareto { xm: 1.0, alpha }]),
            alpha / (alpha - 1.0),
            1e-6,
        );
    }
    // Barely a mean at all: most of it lies past the largest float.
    rel(
        expected_max(&[&D::Pareto {
            xm: 1.0,
            alpha: 1.001,
        }]),
        1001.0,
        1e-2,
    );
    for sigma in [2.0f64, 3.0] {
        rel(
            expected_max(&[&D::LogNormal { mu: 0.0, sigma }]),
            (sigma * sigma / 2.0).exp(),
            1e-6,
        );
    }
    // A mean past the largest float is none.
    assert_eq!(
        expected_max(&[&D::LogNormal {
            mu: 0.0,
            sigma: 40.0
        }]),
        f64::INFINITY
    );
}

/// Where a time jumps or bends — a constant, a Pareto's minimum, a Pert's
/// ends — the integral is split, and stays exact.
#[test]
fn kinks_and_jumps_are_integrated_exactly() {
    rel(
        expected_max(&[&D::Const(5.0), &D::Exponential(1.0)]),
        5.0 + (-5.0f64).exp(),
        1e-9,
    );
    rel(
        expected_max(&[&D::Pert {
            min: 10.0,
            mode: 12.0,
            max: 40.0,
        }]),
        (10.0 + 4.0 * 12.0 + 40.0) / 6.0,
        1e-9,
    );
    // max(Pareto(2, 3), Const(3)): 3 + ∫₃^∞ (2/t)³ dt = 3 + 8 / (2 · 9).
    rel(
        expected_max(&[
            &D::Pareto {
                xm: 2.0,
                alpha: 3.0,
            },
            &D::Const(3.0),
        ]),
        3.0 + 8.0 / 18.0,
        1e-9,
    );
}

#[test]
fn time_is_conditional_on_succeeding_at_all() {
    // "Half the time never" does not make the successful half slower.
    let uncertain = D::Product(0.5, Box::new(D::Exponential(0.1)));
    rel(expected_max(&[&uncertain]), 10.0, 1e-6);
    assert_eq!(expected_max(&[&D::Bernoulli(0.3)]), 0.0);
    assert_eq!(expected_max(&[&D::Zero, &D::Bernoulli(0.3)]), 0.0);
    assert_eq!(
        expected_max(&[&D::Exponential(1.0), &D::Infinity]),
        f64::INFINITY
    );
    assert_eq!(
        expected_max(&[&D::Pareto {
            xm: 1.0,
            alpha: 1.0
        }]),
        f64::INFINITY
    );
}

fn step(rate: f64, cost: f64, detection: f64) -> Step {
    Step {
        ttc: D::Exponential(rate),
        cost: Some(cost),
        detection: Some(detection),
    }
}

#[test]
fn attributes_of_a_cut_set() {
    let steps = [step(1.0, 100.0, 0.1), step(1.0, 50.0, 0.2)];
    let a = &attacker(&[vec![0, 1]], &steps, 1.0).attacks[0];
    assert_eq!(a.cost, 150.0);
    assert!((a.detection - (1.0 - 0.9 * 0.8)).abs() < 1e-15);
    let p = 1.0 - (-1.0f64).exp();
    assert!((a.success - p * p).abs() < 1e-15);
    rel(a.time, 1.5, 1e-6);
}

#[test]
fn the_front_keeps_every_real_trade_off_and_nothing_else() {
    let steps = [
        step(1.0, 10.0, 0.9),   // 0: cheap, fast, loud
        step(0.01, 10.0, 0.0),  // 1: cheap, slow, silent
        step(1.0, 500.0, 0.0),  // 2: dear, fast, silent
        step(0.01, 500.0, 0.9), // 3: worse than all of them
        step(1.0, 10.0, 0.9),   // 4: a twin of 0
    ];
    let sets: Vec<Vec<usize>> = (0..5).map(|i| vec![i]).collect();
    let r = attacker(&sets, &steps, 1.0);
    let front: Vec<bool> = r.attacks.iter().map(|a| a.on_front).collect();
    assert_eq!(
        front,
        [true, true, true, false, true],
        "twins are both on the front; the dominated set is not"
    );
    assert_eq!(
        r.cheapest,
        Some(0),
        "cost ties go to the faster, then the earlier"
    );
}

#[test]
fn an_impossible_attack_is_not_an_option() {
    let never = Step {
        ttc: D::Bernoulli(0.0),
        cost: Some(0.0),
        detection: Some(0.0),
    };
    let r = attacker(&[vec![0], vec![1]], &[never, step(1.0, 10.0, 0.5)], 1.0);
    assert_eq!(r.attacks[0].success, 0.0);
    assert!(!r.attacks[0].on_front);
    assert_eq!(r.cheapest, Some(1));
    assert_eq!(attacker(&[], &[], 1.0).cheapest, None);
}

#[test]
fn missing_attributes_are_an_optimistic_attacker() {
    let bare = Step {
        ttc: D::Exponential(1.0),
        cost: None,
        detection: None,
    };
    let a = &attacker(&[vec![0]], &[bare], 1.0).attacks[0];
    assert_eq!((a.cost, a.detection), (0.0, 0.0));
}

mod front {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Small integer attributes, so ties and exact domination are common.
        #[test]
        fn the_front_is_exactly_the_non_dominated_attacks(attrs in proptest::collection::vec((0u8..4, 0u8..4, 0u8..4), 1..12)) {
            let steps: Vec<Step> = attrs.iter().map(|(c, t, d)| step(1.0 / f64::from(*t + 1), f64::from(*c), f64::from(*d) / 4.0)).collect();
            let sets: Vec<Vec<usize>> = (0..steps.len()).map(|i| vec![i]).collect();
            let r = attacker(&sets, &steps, 1.0);
            // Time is monotone in t here, so domination can be read off the integers.
            let dominates = |a: &(u8, u8, u8), b: &(u8, u8, u8)| a.0 <= b.0 && a.1 <= b.1 && a.2 <= b.2 && a != b;
            for (i, a) in r.attacks.iter().enumerate() {
                let dominated = attrs.iter().any(|other| dominates(other, &attrs[i]));
                prop_assert_eq!(a.on_front, !dominated, "attack {}: {:?} in {:?}", i, attrs[i], attrs);
            }
            let cheapest = r.cheapest.unwrap();
            prop_assert!(attrs.iter().all(|a| a.0 >= attrs[cheapest].0));
        }
    }
}
