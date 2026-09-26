//! effractor's own spelling of a time-to-compromise: chances in percent,
//! exponentials by their average time, Never and Immediate.

use effractor_core::{Distribution as D, Shorthand};
use effractor_format::expr::{chance, parse, write};

fn round_trip(text: &str, d: D) {
    assert_eq!(parse(text), Ok(d.clone()), "{text}");
    assert_eq!(write(&d), text);
}

#[test]
fn every_form_reads_and_writes_back() {
    round_trip("30%", D::Bernoulli(0.3));
    round_trip(
        "50% * Exponential(mean 12.5)",
        D::Product(0.5, Box::new(D::ExponentialMean(12.5))),
    );
    round_trip("Exponential(mean 12.5)", D::ExponentialMean(12.5));
    round_trip(
        "25% * Gamma(2, 4)",
        D::Product(
            0.25,
            Box::new(D::Gamma {
                shape: 2.0,
                scale: 4.0,
            }),
        ),
    );
    round_trip(
        "LogNormal(1.5, 0.5)",
        D::LogNormal {
            mu: 1.5,
            sigma: 0.5,
        },
    );
    round_trip(
        "Pareto(1, 2)",
        D::Pareto {
            xm: 1.0,
            alpha: 2.0,
        },
    );
    round_trip(
        "TruncatedNormal(5, 2)",
        D::TruncatedNormal { mean: 5.0, sd: 2.0 },
    );
    round_trip(
        "Pert(1, 2, 5)",
        D::Pert {
            min: 1.0,
            mode: 2.0,
            max: 5.0,
        },
    );
    round_trip("Never", D::Infinity);
    round_trip("Immediate", D::Zero);
    round_trip("0%", D::Bernoulli(0.0));
    round_trip("100%", D::Bernoulli(1.0));
    round_trip("Exponential(mean 1e-12)", D::ExponentialMean(1e-12));
}

#[test]
fn spacing_is_free_and_a_chance_may_have_decimals() {
    assert_eq!(
        parse(" 50 %  *  Exponential( mean 2 ) "),
        parse("50% * Exponential(mean 2)")
    );
    assert_eq!(parse("12.5%"), Ok(D::Bernoulli(0.125)));
    assert_eq!(parse("33.3%"), Ok(D::Bernoulli(0.333)));
    assert_eq!(parse("0.25%"), Ok(D::Bernoulli(0.0025)));
}

#[test]
fn a_chance_is_written_exactly_for_every_probability() {
    for p in [
        0.0,
        1.0,
        0.5,
        0.333,
        1.0 / 3.0,
        0.0000025,
        0.1 + 0.2,
        0.999_999_999_999_9,
    ] {
        let text = format!("{}%", chance(p));
        assert_eq!(parse(&text), Ok(D::Bernoulli(p)), "{text}");
    }
    assert_eq!(chance(0.333), "33.3");
    assert_eq!(chance(0.05), "5");
    assert_eq!(chance(1.0), "100");
}

#[test]
fn a_mean_is_written_exactly() {
    for m in [1.0 / 3.0, 12.5, 1e-12, 1e15, 83333.33333333333] {
        assert_eq!(
            parse(&write(&D::ExponentialMean(m))),
            Ok(D::ExponentialMean(m))
        );
    }
}

#[test]
fn old_spellings_are_refused_with_their_replacement() {
    let e = parse("Bernoulli(0.5) * Exponential(0.1)").unwrap_err();
    assert_eq!(e.col, 1);
    assert!(e.message.contains("50%"), "{}", e.message);
    let e = parse("Exponential(0.08)").unwrap_err();
    assert!(
        e.message.contains("Exponential(mean 12.5)"),
        "{}",
        e.message
    );
    let e = parse("HardAndUncertain").unwrap_err();
    assert!(
        e.message.contains("50% * Exponential(mean 10)"),
        "{}",
        e.message
    );
    for (old, new) in [
        ("Infinity", "Never"),
        ("Enabled", "Never"),
        ("Zero", "Immediate"),
        ("Disabled", "Immediate"),
    ] {
        assert!(parse(old).unwrap_err().message.contains(new), "{old}");
    }
}

#[test]
fn mistakes_are_named_where_they_are() {
    let at = |s: &str| parse(s).unwrap_err();
    assert_eq!(at("101%").col, 1);
    assert!(at("101%").message.contains("0% to 100%"));
    assert!(at("-5%").message.contains("number"));
    let comma = at("12,5%");
    assert_eq!(comma.col, 3);
    assert!(comma.message.contains("decimal point"));
    assert!(at("Exponential(mean 0)").message.contains("mean"));
    let order = at("Exponential(mean 5) * 50%");
    assert!(order.message.contains("chance first"), "{}", order.message);
    assert!(at("50% * 20%").message.contains("time"));
    assert!(at("Exponential(5)").message.contains("mean"));
    assert!(at("Gamma(2)").message.contains("Gamma(shape, scale)"));
    assert!(at("Weibull(1, 2)").message.contains("unknown"));
    assert_eq!(at("30% extra").col, 5);
}

#[test]
fn an_imported_rate_and_a_preset_are_written_in_the_new_spelling() {
    assert_eq!(write(&D::Exponential(0.1)), "Exponential(mean 10)");
    assert_eq!(
        write(&D::Named(Shorthand::HardAndUncertain)),
        "50% * Exponential(mean 10)"
    );
    assert_eq!(write(&D::Named(Shorthand::Enabled)), "Never");
    assert_eq!(write(&D::Const(3.0)), "3");
}

/// A legacy spelling reads only what can be written back: `-0` is 0%, and a
/// rate whose mean is past any number is refused rather than written `inf`.
#[test]
fn what_an_old_spelling_says_can_be_saved() {
    assert_eq!(chance(-0.0), "0");
    assert_eq!(write(&D::Bernoulli(-0.0)), "0%");
    assert!(D::Exponential(1e-310).check_params().is_err());
    assert!(D::Exponential(1e-300).check_params().is_ok());
    let text = concat!(
        "effractor: 2\nprofile: fault-tree\nname: T\ntop: t\nnodes:\n",
        "  t: {label: T, leaf: basic, ttc: \"Exponential(1e-310)\"}\n",
    );
    assert!(effractor_format::load(text).is_err());
}
