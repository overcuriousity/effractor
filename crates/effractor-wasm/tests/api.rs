//! The surface the browser sees, exercised natively: every call takes and
//! returns JSON text, `{ok, diagnostics}` or `{diagnostics}`.

use effractor_wasm::api;
use serde_json::{Value, json};

const WEBSERVER: &str =
    include_str!("../../effractor-format/tests/fixtures/canonical/webserver.yaml");

fn call(out: String) -> Value {
    serde_json::from_str(&out).unwrap()
}

#[test]
fn validate_reports_positions() {
    let out = call(api::validate(WEBSERVER));
    assert_eq!(out, json!({"ok": true, "diagnostics": []}));

    let broken = WEBSERVER.replace("children: [hardware,", "children: [hardwear,");
    let out = call(api::validate(&broken));
    assert!(out.get("ok").is_none());
    let d = &out["diagnostics"][0];
    assert_eq!(d["severity"], "error");
    assert_eq!(d["code"], "unknown-child");
    assert_eq!(d["path"], "nodes.ohne-funktion.children[0]");
    assert_eq!(
        (d["line"].as_u64(), d["col"].as_u64()),
        (Some(23), Some(16))
    );
    // `hardware` is now unreachable, which is only a warning, and listed too.
    assert!(
        out["diagnostics"]
            .as_array()
            .unwrap()
            .iter()
            .any(|d| d["severity"] == "warning")
    );
}

#[test]
fn parse_and_serialize_are_inverse_on_canonical_text() {
    let parsed = call(api::parse(WEBSERVER));
    assert_eq!(parsed["ok"]["nodes"]["malware"]["p"], json!(0.004));
    let text = call(api::serialize(&parsed["ok"].to_string()));
    assert_eq!(text["ok"], json!(WEBSERVER));
}

#[test]
fn serialize_refuses_what_it_cannot_read() {
    let out = call(api::serialize("{not json"));
    assert_eq!(out["diagnostics"][0]["code"], "syntax");
    assert!(out["diagnostics"][0]["line"].is_null());
    let out = call(api::serialize(r#"{"effractor": 1}"#));
    assert_eq!(out["diagnostics"][0]["code"], "missing-key");
}

#[test]
fn a_solve_is_begun_stepped_and_finished() {
    let text = WEBSERVER.replace("samples: 10000", "samples: 9000");
    let mut session = api::Session::default();

    let begun = call(session.begin(&text));
    // Exact results are there before a single sample is drawn.
    let exact = &begun["ok"]["exact"]["available"];
    assert!(exact["p_top"].as_f64().unwrap() > 0.0, "{begun}");
    assert!(begun["ok"]["cut_sets"]["available"].is_object());
    let total = begun["ok"]["progress"]["total"].as_u64().unwrap();
    assert_eq!(begun["ok"]["progress"]["done"], json!(0));
    // Three chunks of 4096 for the baseline and again for the one control.
    assert_eq!(total, 6);

    for done in 1..=total {
        let step = call(session.step());
        assert_eq!(step["ok"], json!({"done": done, "total": total}));
    }
    let finished = session.finish();
    assert_eq!(call(finished.clone())["ok"]["effractor-results"], json!(1));

    // The same results as the one-shot solver, to the last digit — compared as
    // text, because that is what crosses to JavaScript (and because reading
    // JSON back into Rust is not exact in the last bit of a float).
    let model = effractor_format::load(&text).unwrap();
    let config = effractor_solver::Config::from_model(&model);
    let whole = effractor_solver::solve(&model, &config).unwrap();
    let want = format!(
        r#"{{"ok":{},"diagnostics":[]}}"#,
        serde_json::to_string(&whole).unwrap()
    );
    assert_eq!(finished, want);
}

#[test]
fn finishing_early_does_the_rest() {
    let mut session = api::Session::default();
    call(session.begin(WEBSERVER));
    call(session.step());
    assert_eq!(call(session.finish())["ok"]["effractor-results"], json!(1));
}

#[test]
fn out_of_order_calls_are_errors_not_panics() {
    let mut session = api::Session::default();
    assert_eq!(call(session.step())["error"], "no solve in progress");
    assert_eq!(call(session.finish())["error"], "no solve in progress");
    call(session.begin(WEBSERVER));
    session.cancel();
    assert_eq!(call(session.step())["error"], "no solve in progress");
}

#[test]
fn an_invalid_model_does_not_begin() {
    let mut session = api::Session::default();
    let out = call(session.begin("effractor: 1\n"));
    assert!(out.get("ok").is_none());
    assert_eq!(out["diagnostics"][0]["code"], "missing-key");
    assert_eq!(call(session.step())["error"], "no solve in progress");
}

#[test]
fn numbers_survive_the_trip_through_json_to_the_bit() {
    // A spread of awkward floats, from a fixed little generator.
    let mut x: u64 = 0x9e37_79b9_7f4a_7c15;
    for _ in 0..2000 {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        let rate = f64::from_bits((x >> 12) | 0x3000_0000_0000_0000) * 1e-3;
        let text = WEBSERVER.replace("rate: 2.5e-6", &format!("rate: {rate:e}"));
        let text = call(api::serialize(&call(api::parse(&text))["ok"].to_string()));
        let model = effractor_format::load(text["ok"].as_str().unwrap()).unwrap();
        let id: effractor_core::NodeId = "ausfall-server".parse().unwrap();
        let effractor_core::NodeKind::Leaf(leaf) = &model.nodes[&id].kind else {
            panic!("a leaf")
        };
        assert_eq!(leaf.ttc, Some(effractor_core::Ttc::Rate(rate)), "{rate:e}");
    }
}
