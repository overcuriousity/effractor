//! What is wrong, and where: every diagnostic carries a path and the line and
//! column that path has in the text.

use effractor_core::{Diagnostic, Severity};
use effractor_format::{diagnose, load};

const HEAD: &str = "effractor: 1\nprofile: fault-tree\nname: T\ntop: t\n";

/// `(code, path, line, col)` of everything reported, in order.
fn report(text: &str) -> Vec<(&'static str, String, usize, usize)> {
    let (_, diagnostics) = diagnose(text);
    diagnostics.iter().map(summary).collect()
}

fn summary(d: &Diagnostic) -> (&'static str, String, usize, usize) {
    let pos = d.pos.unwrap_or_else(|| panic!("no position on {d:?}"));
    (d.code.as_str(), d.path.clone(), pos.line, pos.col)
}

fn one(text: &str) -> (&'static str, String, usize, usize) {
    let mut all = report(text);
    assert_eq!(all.len(), 1, "{all:?}");
    all.remove(0)
}

fn doc(nodes: &str) -> String {
    format!("{HEAD}nodes:\n{nodes}")
}

#[test]
fn a_clean_document_reports_nothing() {
    let text = doc("  t: {label: T, leaf: basic, p: 0.5}\n");
    assert_eq!(report(&text), vec![]);
    assert!(load(&text).is_ok());
}

#[test]
fn broken_yaml_is_a_syntax_error_where_the_parser_stopped() {
    let (code, path, line, _) = one("effractor: 1\nname: [unclosed\nprofile: x\n");
    assert_eq!((code, path.as_str()), ("syntax", ""));
    assert!(line >= 2);
    assert_eq!(one("").0, "syntax");
    assert_eq!(one("- a\n- b\n").0, "wrong-type");
}

#[test]
fn the_version_gate() {
    let body = "profile: fault-tree\nname: T\ntop: t\nnodes:\n  t: {label: T, leaf: basic}\n";
    assert_eq!(one(body), ("missing-key", "effractor".into(), 1, 1));
    assert_eq!(
        one(&format!("effractor: 2\n{body}")),
        ("version", "effractor".into(), 1, 12)
    );
    assert_eq!(
        one(&format!("effractor: 0\n{body}")),
        ("version", "effractor".into(), 1, 12)
    );
    assert_eq!(
        one(&format!("effractor: one\n{body}")),
        ("wrong-type", "effractor".into(), 1, 12)
    );
    // A newer document is not read at all: its other keys may mean anything.
    assert_eq!(
        report(&format!("effractor: 2\nfuture: true\n{body}")).len(),
        1
    );
}

#[test]
fn unknown_keys_are_errors_with_a_position() {
    let text = doc("  t:\n    label: T\n    leaf: basic\n    consequence: []\n");
    assert_eq!(
        one(&text),
        ("unknown-key", "nodes.t.consequence".into(), 9, 5)
    );
    assert_eq!(
        one(&format!(
            "{HEAD}colour: red\nnodes:\n  t: {{label: T, leaf: basic}}\n"
        )),
        ("unknown-key", "colour".into(), 5, 1)
    );
    let nested = doc(
        "  t:\n    label: T\n    leaf: basic\n    consequences:\n      - {asset: a, dim: c, part: 0.5}\n",
    ) + "assets:\n  a: {label: A, loss: {c: 1, d: 2}}\n";
    assert_eq!(
        report(&nested),
        vec![
            ("unknown-key", "nodes.t.consequences[0].part".into(), 10, 28),
            ("unknown-key", "assets.a.loss.d".into(), 12, 30),
        ]
    );
}

#[test]
fn extension_keys_are_not_unknown() {
    let text = doc("  t: {label: T, leaf: basic, x-anything: {goes: [here]}}\n") + "x-top: 1\n";
    assert_eq!(report(&text), vec![]);
}

#[test]
fn a_key_written_twice() {
    let text = doc("  t:\n    label: T\n    leaf: basic\n    label: U\n");
    assert_eq!(one(&text), ("duplicate-key", "nodes.t.label".into(), 9, 5));
    let text = doc("  t: {label: T, leaf: basic}\n  t: {label: U, leaf: basic}\n");
    assert_eq!(one(&text), ("duplicate-key", "nodes.t".into(), 7, 3));
}

#[test]
fn missing_keys_point_at_what_lacks_them() {
    assert_eq!(
        one(&doc("  t:\n    leaf: basic\n")),
        ("missing-key", "nodes.t.label".into(), 6, 3)
    );
    assert_eq!(
        one(&doc("  t:\n    label: T\n")),
        ("missing-key", "nodes.t".into(), 6, 3)
    );
    assert_eq!(
        one(&doc(
            "  t:\n    label: T\n    gate: vote\n    children: [a]\n  a: {label: A, leaf: basic}\n"
        )),
        ("missing-key", "nodes.t.k".into(), 6, 3)
    );
    assert_eq!(
        one("effractor: 1\nprofile: fault-tree\nname: T\ntop: t\n"),
        ("missing-key", "nodes".into(), 1, 1)
    );
}

#[test]
fn keys_that_do_not_belong_together() {
    let text = doc("  t:\n    label: T\n    leaf: basic\n    p: 0.1\n    rate: 0.2\n");
    assert_eq!(one(&text), ("misplaced-key", "nodes.t.rate".into(), 10, 5));
    let text = doc("  t:\n    label: T\n    gate: or\n    leaf: basic\n    children: [t]\n");
    assert_eq!(one(&text).0, "misplaced-key");
    let text = doc(
        "  t:\n    label: T\n    gate: and\n    k: 2\n    children: [a]\n  a: {label: A, leaf: basic, children: []}\n",
    );
    assert_eq!(
        report(&text),
        vec![
            ("misplaced-key", "nodes.t.k".into(), 9, 5),
            ("misplaced-key", "nodes.a.children".into(), 11, 30),
        ]
    );
}

#[test]
fn wrong_types_and_words() {
    for (line, path, col) in [
        ("    p: often\n", "nodes.t.p", 8),
        ("    p: \"0.5\"\n", "nodes.t.p", 8),
        ("    p: .inf\n", "nodes.t.p", 8),
        ("    cost: [1]\n", "nodes.t.cost", 11),
        ("    description: {a: b}\n", "nodes.t.description", 18),
    ] {
        let text = doc(&format!("  t:\n    label: T\n    leaf: basic\n{line}"));
        assert_eq!(one(&text), ("wrong-type", path.into(), 9, col), "{line}");
    }
    let text = doc("  t:\n    label: T\n    leaf: simple\n");
    assert_eq!(one(&text), ("wrong-type", "nodes.t.leaf".into(), 8, 11));
    let text =
        "effractor: 1\nprofile: fault\nname: T\ntop: t\nnodes:\n  t: {label: T, leaf: basic}\n";
    assert_eq!(one(text), ("wrong-type", "profile".into(), 2, 10));
    let text = doc("  t: {label: T, leaf: basic}\n") + "analysis: {seed: -1}\n";
    assert_eq!(one(&text), ("wrong-type", "analysis.seed".into(), 7, 18));
    let text = doc("  t: {label: T, leaf: basic}\n")
        + "controls:\n  c: {label: C, cost: 1, enabled: yes, effects: []}\n";
    assert_eq!(
        one(&text),
        ("wrong-type", "controls.c.enabled".into(), 8, 35)
    );
}

#[test]
fn ids_are_checked_where_they_are_written() {
    let text = doc("  T: {label: T, leaf: basic}\n");
    let all = report(&text);
    assert_eq!(all[0], ("invalid-id", "nodes.T".into(), 6, 3));
    let text = doc("  t: {label: T, gate: or, children: [Not An Id]}\n");
    assert_eq!(
        one(&text),
        ("invalid-id", "nodes.t.children[0]".into(), 6, 38)
    );
}

#[test]
fn a_bad_expression_points_into_the_expression() {
    let text =
        doc("  t:\n    label: T\n    leaf: basic\n    ttc: \"Exponential(0.1) * Gamma(1, 2)\"\n");
    let (code, path, line, col) = one(&text);
    assert_eq!(
        (code, path.as_str(), line),
        ("expression", "nodes.t.ttc", 9)
    );
    assert!(col > 10, "inside the quotes, got col {col}");
    let text = doc("  t: {label: T, leaf: basic}\n")
        + "assets:\n  a: {label: A, loss: {c: \"Pert(1, 2)\"}}\n";
    assert_eq!(one(&text).0, "expression");
}

#[test]
fn yaml_this_format_does_not_speak() {
    let text = doc("  t: &anchor {label: T, leaf: basic}\n  u: *anchor\n");
    assert!(
        report(&text).iter().all(|d| d.0 == "unsupported"),
        "{:?}",
        report(&text)
    );
    assert!(!report(&text).is_empty());
    let text = doc("  t: {label: !!str T, leaf: basic}\n");
    assert_eq!(one(&text).0, "unsupported");
    let text = doc("  t: {label: T, leaf: basic}\n") + "---\nsecond: document\n";
    assert_eq!(one(&text).0, "unsupported");
}

#[test]
fn structural_findings_get_positions_too() {
    let text = doc(concat!(
        "  t:\n",
        "    label: T\n",
        "    gate: vote\n",
        "    k: 3\n",
        "    children: [a, ghost]\n",
        "  a: {label: A, leaf: basic, p: 1.5, cost: 3}\n",
        "  lonely: {label: L, leaf: basic}\n",
    ));
    let (model, diagnostics) = diagnose(&text);
    assert!(model.is_none());
    let got: Vec<_> = diagnostics.iter().map(summary).collect();
    assert!(
        got.contains(&("unknown-child", "nodes.t.children[1]".into(), 10, 19)),
        "{got:?}"
    );
    assert!(
        got.contains(&("vote-range", "nodes.t.k".into(), 9, 8)),
        "{got:?}"
    );
    assert!(
        got.contains(&("param-domain", "nodes.a.p".into(), 11, 33)),
        "{got:?}"
    );
    assert!(
        got.contains(&("profile-attribute", "nodes.a.cost".into(), 11, 44)),
        "{got:?}"
    );
    // A node as a whole is reported at its key.
    assert!(
        got.contains(&("unreachable", "nodes.lonely".into(), 12, 3)),
        "{got:?}"
    );
}

#[test]
fn warnings_do_not_stop_a_load() {
    let text = doc("  t: {label: T, leaf: basic}\n  spare: {label: S, leaf: basic}\n");
    let (model, diagnostics) = diagnose(&text);
    assert!(model.is_some());
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(diagnostics[0].severity, Severity::Warning);
    assert!(load(&text).is_ok());
}

#[test]
fn hostile_input_is_a_diagnostic_not_a_crash() {
    let nested = |depth: usize| {
        let (open, close) = ("[".repeat(depth), "]".repeat(depth));
        doc("  t: {label: T, leaf: basic}\n") + &format!("x-deep: {open}1{close}\n")
    };
    assert_eq!(report(&nested(60)), vec![]);
    assert_eq!(one(&nested(70)).0, "unsupported");
    // Deeper than the YAML parser itself will go.
    assert_eq!(one(&nested(100_000)).0, "syntax");
}

#[test]
fn one_pass_reports_every_problem() {
    let text = "effractor: 1\nprofile: tree\ntime_unit: weeks\nhorizon: long\ntop: t\nnodes:\n  t: {leaf: basic, p: high}\nanalysis: {seed: x}\n";
    let got: Vec<_> = report(text).into_iter().map(|d| (d.0, d.1)).collect();
    for want in [
        ("wrong-type", "profile"),
        ("missing-key", "name"),
        ("wrong-type", "time_unit"),
        ("wrong-type", "horizon"),
        ("missing-key", "nodes.t.label"),
        ("wrong-type", "nodes.t.p"),
        ("wrong-type", "analysis.seed"),
    ] {
        assert!(
            got.contains(&(want.0, want.1.to_owned())),
            "{want:?} not in {got:?}"
        );
    }
}
