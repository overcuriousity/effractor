use effractor_core::{Distribution as D, Shorthand};
use effractor_mal::{ParseError, number, parse_expr};
use proptest::prelude::*;

fn err(src: &str) -> ParseError {
    parse_expr(src).expect_err(src)
}

#[test]
fn every_distribution() {
    assert_eq!(parse_expr("Bernoulli(0.5)"), Ok(D::Bernoulli(0.5)));
    assert_eq!(
        parse_expr("Exponential(2.5e-6)"),
        Ok(D::Exponential(2.5e-6))
    );
    assert_eq!(
        parse_expr("Gamma(2, 0.5)"),
        Ok(D::Gamma {
            shape: 2.0,
            scale: 0.5
        })
    );
    assert_eq!(
        parse_expr("LogNormal(-1.5, 0.3)"),
        Ok(D::LogNormal {
            mu: -1.5,
            sigma: 0.3
        })
    );
    assert_eq!(
        parse_expr("Pareto(1, 3)"),
        Ok(D::Pareto {
            xm: 1.0,
            alpha: 3.0
        })
    );
    assert_eq!(
        parse_expr("TruncatedNormal(10, 2)"),
        Ok(D::TruncatedNormal {
            mean: 10.0,
            sd: 2.0
        })
    );
    assert_eq!(
        parse_expr("Pert(60000, 120000, 400000)"),
        Ok(D::Pert {
            min: 6e4,
            mode: 1.2e5,
            max: 4e5
        })
    );
    assert_eq!(parse_expr("Zero"), Ok(D::Zero));
    assert_eq!(parse_expr("Infinity"), Ok(D::Infinity));
}

#[test]
fn every_shorthand_stays_named() {
    for s in Shorthand::ALL {
        assert_eq!(parse_expr(s.name()), Ok(D::Named(s)));
    }
}

#[test]
fn product_form_in_either_order() {
    let want = D::Product(0.5, Box::new(D::Exponential(0.1)));
    assert_eq!(
        parse_expr("Bernoulli(0.5) * Exponential(0.1)"),
        Ok(want.clone())
    );
    assert_eq!(
        parse_expr("Exponential(0.1)*Bernoulli(0.5)"),
        Ok(want.clone())
    );
}

#[test]
fn whitespace_is_free() {
    assert_eq!(
        parse_expr("  Gamma ( 2 ,0.5 )  "),
        Ok(D::Gamma {
            shape: 2.0,
            scale: 0.5
        })
    );
}

#[test]
fn errors_point_at_the_problem() {
    assert_eq!(
        err(""),
        ParseError {
            col: 1,
            message: "expected a distribution".into()
        }
    );
    assert_eq!(
        err("Exponential"),
        ParseError {
            col: 12,
            message: "Exponential takes 1 argument: Exponential(rate)".into()
        }
    );
    assert_eq!(
        err("Gamma(1)"),
        ParseError {
            col: 1,
            message: "Gamma takes 2 arguments: Gamma(shape, scale)".into()
        }
    );
    assert_eq!(
        err("Zero(1)"),
        ParseError {
            col: 5,
            message: "Zero takes no arguments".into()
        }
    );
    assert_eq!(err("Exponental(1)").col, 1);
    assert!(
        err("Exponental(1)")
            .message
            .contains("unknown distribution \"Exponental\"")
    );
    assert_eq!(
        err("Exponential(abc)"),
        ParseError {
            col: 13,
            message: "expected a number".into()
        }
    );
    assert_eq!(err("Exponential(1").message, "expected `,` or `)`");
    assert_eq!(
        err("Exponential(1) junk"),
        ParseError {
            col: 16,
            message: "unexpected input after the expression".into()
        }
    );
    assert_eq!(
        err("Exponential(1) * Gamma(1, 2)").message,
        "one side of `*` must be Bernoulli(p)"
    );
    assert_eq!(err("Bernoulli(0.5) * Exponential(1) * Zero").col, 33);
    // Columns count characters, not bytes.
    assert_eq!(err("ä").col, 1);
    assert_eq!(err("Zero ä").col, 6);
}

#[test]
fn numbers() {
    for (src, want) in [
        ("1", 1.0),
        ("-0.5", -0.5),
        ("+3", 3.0),
        ("1e3", 1e3),
        ("1.5E-3", 1.5e-3),
        (".5", 0.5),
    ] {
        assert_eq!(
            parse_expr(&format!("Exponential({src})")),
            Ok(D::Exponential(want)),
            "{src}"
        );
    }
    // Not numbers a model should contain; the parser must not let them in as one.
    for src in ["inf", "NaN", "1e", "--1", "1e999"] {
        assert!(parse_expr(&format!("Exponential({src})")).is_err(), "{src}");
    }
}

#[test]
fn domains_are_not_the_parsers_business() {
    // Syntax here, domains in core::validate — one place, with a document path.
    let d = parse_expr("Bernoulli(1.5)").unwrap();
    assert!(d.check_params().is_err());
}

#[test]
fn small_and_large_numbers_print_in_scientific_notation() {
    assert_eq!(number(2.5e-6), "2.5e-6");
    assert_eq!(number(0.002), "0.002");
    assert_eq!(number(120000.0), "120000");
    assert_eq!(number(3e15), "3e15");
}

fn num() -> impl Strategy<Value = f64> {
    prop_oneof![
        (-1e6..1e6f64),
        (1e-12..1e-3f64),
        (1e15..1e18f64),
        Just(0.0),
        any::<f64>().prop_filter("finite", |v| v.is_finite()),
    ]
}

proptest! {
    #[test]
    fn a_printed_number_reads_back(v in num()) {
        let text = format!("Gamma({}, {})", number(v), number(-v));
        prop_assert_eq!(parse_expr(&text), Ok(D::Gamma { shape: v, scale: -v }));
    }

    #[test]
    fn no_input_panics(src in "\\PC{0,40}") {
        let _ = parse_expr(&src);
    }

    #[test]
    fn nor_does_near_valid_input(src in "[A-Za-z]{0,12}[(), *.0-9eE+-]{0,24}") {
        let _ = parse_expr(&src);
    }
}
