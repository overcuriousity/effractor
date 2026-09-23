//! The surface the browser sees, exercised natively: every call takes and
//! returns JSON text, `{ok, diagnostics}` or `{diagnostics}`.

use effractor_wasm::api;
use serde_json::{Value, json};

const WEBSERVER: &str =
    include_str!("../../effractor-format/tests/fixtures/canonical/webserver.yaml");
const ARCHITECTURE: &str =
    include_str!("../../effractor-format/tests/fixtures/canonical/lecture-architecture.yaml");

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
    assert_eq!(d["path"], "nodes.no-function.children[0]");
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
    // Importance is exact too: the canvas can be coloured before sampling.
    let leaves = begun["ok"]["leaves"].as_array().unwrap();
    assert!(!leaves.is_empty(), "{begun}");
    assert!(leaves[0]["fussell_vesely"].as_f64().is_some(), "{begun}");
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
    // The early leaves are the final ones.
    assert_eq!(begun["ok"]["leaves"], call(finished)["ok"]["leaves"]);
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
        let id: effractor_core::NodeId = "server-outage".parse().unwrap();
        let effractor_core::NodeKind::Leaf(leaf) = &model.nodes[&id].kind else {
            panic!("a leaf")
        };
        assert_eq!(leaf.ttc, Some(effractor_core::Ttc::Rate(rate)), "{rate:e}");
    }
}

#[test]
fn a_ttc_is_sketched_or_refused() {
    let out = call(api::ttc_sketch("Exponential(2.5e-6)", 8760.0));
    let cdf = out["ok"]["cdf"].as_array().unwrap();
    assert_eq!(cdf.len(), 33);
    assert_eq!(cdf[0], json!(0.0));
    assert!((out["ok"]["p_horizon"].as_f64().unwrap() - 0.021_661_936).abs() < 1e-9);
    assert!(call(api::ttc_sketch("Exponential(", 1.0))["error"].is_string());
    assert!(call(api::ttc_sketch("Exponential(-1)", 1.0))["error"].is_string());
    assert!(call(api::ttc_sketch("Pert(1, 2, 3)", 1.0))["error"].is_string());
    assert!(call(api::ttc_sketch("Zero", 0.0))["error"].is_string());
}

#[test]
fn an_architecture_validates_parses_and_serializes_but_does_not_solve_as_a_tree() {
    assert_eq!(
        call(api::validate(ARCHITECTURE)),
        json!({"ok": true, "diagnostics": []})
    );
    let parsed = call(api::parse(ARCHITECTURE));
    assert_eq!(parsed["ok"]["profile"], "architecture");
    assert_eq!(parsed["ok"]["entities"]["sshd"]["kind"], "service");
    assert_eq!(parsed["ok"]["attacker"]["target"]["state"], "admin");
    let text = call(api::serialize(&parsed["ok"].to_string()));
    assert_eq!(text["ok"], json!(ARCHITECTURE));

    // An edit that breaks a typed reference comes back as a diagnostic with a path.
    let mut edited = parsed["ok"].clone();
    edited["associations"]["allow-ssh"]["to"] = json!("telnet");
    let out = call(api::serialize(&edited.to_string()));
    assert_eq!(out["diagnostics"][0]["code"], "unknown-reference");
    assert_eq!(out["diagnostics"][0]["path"], "associations.allow-ssh.to");

    // The tree solver is not for an architecture, and says which it got.
    let mut session = api::Session::default();
    let begun = call(session.begin(ARCHITECTURE));
    assert!(begun.get("ok").is_none());
    assert_eq!(begun["diagnostics"][0]["code"], "unsupported");
    assert_eq!(begun["diagnostics"][0]["path"], "profile");
    assert_eq!(begun["diagnostics"][0]["line"], json!(2));
    assert_eq!(call(session.step())["error"], "no solve in progress");
}

#[test]
fn the_component_catalog_is_an_ok_answer() {
    let out = call(api::component_catalog());
    assert_eq!(out["diagnostics"], json!([]));
    assert_eq!(out["ok"]["library"]["version"], 1);
    assert_eq!(out["ok"]["rules"].as_array().unwrap().len(), 15);
    assert_eq!(out["ok"]["entities"][5]["kind"], "service");
}

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");

#[test]
fn an_architecture_generates_its_graph_with_the_source_it_describes() {
    let out = call(api::generate(LECTURE, "rev-7"));
    assert_eq!(out["diagnostics"], json!([]));
    let ok = &out["ok"];
    assert_eq!(ok["revision"], "rev-7");
    assert_eq!(ok["source"], json!(LECTURE));
    let graph = &ok["graph"];
    assert_eq!(graph["effractor-graph"], 1);
    assert_eq!(graph["semantics"], "sequential-1");
    assert_eq!(
        graph["library"],
        json!({"id": "core-components", "version": 1})
    );
    assert_eq!(graph["target"], "state/host/server/admin");
    let nodes = graph["nodes"].as_array().unwrap();
    let node = |g: &Value, id: &str| {
        g["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|n| n["id"] == id)
            .cloned()
            .unwrap()
    };
    let login = node(graph, "action/service-login/server-account/sshd");
    assert_eq!(login["timing"]["expression"], "Exponential(1)");
    assert_eq!(
        login["timing"]["paths"],
        json!(["entities.sshd.parameters.login"])
    );

    // Edit through the document image, serialize, regenerate: the same steps,
    // the new value and its source.
    let mut image = call(api::parse(LECTURE))["ok"].clone();
    image["entities"]["sshd"]["parameters"]["login"]["ttc"] = json!("Exponential(3)");
    image["entities"]["sshd"]["label"] = json!("OpenSSH");
    let text = call(api::serialize(&image.to_string()))["ok"]
        .as_str()
        .unwrap()
        .to_owned();
    let again = call(api::generate(&text, "rev-8"));
    assert_eq!(again["ok"]["revision"], "rev-8");
    assert_eq!(again["ok"]["source"], json!(text));
    let regenerated = &again["ok"]["graph"];
    let ids = |g: &Value| -> Vec<Value> {
        g["nodes"]
            .as_array()
            .unwrap()
            .iter()
            .map(|n| n["id"].clone())
            .collect()
    };
    assert_eq!(ids(regenerated), ids(graph));
    assert_eq!(regenerated["nodes"].as_array().unwrap().len(), nodes.len());
    let login = node(regenerated, "action/service-login/server-account/sshd");
    assert_eq!(login["timing"]["expression"], "Exponential(3)");
    assert!(login["label"].as_str().unwrap().contains("OpenSSH"));
}

#[test]
fn generation_refuses_what_is_not_a_complete_architecture() {
    // A tree is not generated from.
    let out = call(api::generate(WEBSERVER, "r"));
    assert!(out.get("ok").is_none());
    assert_eq!(out["diagnostics"][0]["code"], "unsupported");
    assert_eq!(out["diagnostics"][0]["path"], "profile");

    // An incomplete architecture says what is missing.
    let mut image = call(api::parse(LECTURE))["ok"].clone();
    image["associations"]
        .as_object_mut()
        .unwrap()
        .remove("allow-ssh");
    // The scenario that names the permission goes with it.
    image["scenarios"].as_object_mut().unwrap().remove("deny");
    let text = call(api::serialize(&image.to_string()))["ok"]
        .as_str()
        .unwrap()
        .to_owned();
    let out = call(api::generate(&text, "r"));
    assert!(out.get("ok").is_none());
    assert_eq!(out["diagnostics"][0]["code"], "incomplete");
    assert_eq!(out["diagnostics"][0]["path"], "flows.ssh.route[1]");

    // Text that does not parse is answered with its diagnostics.
    let out = call(api::generate("effractor: 2\nprofile: [", "r"));
    assert!(out.get("ok").is_none());
    assert!(!out["diagnostics"].as_array().unwrap().is_empty());
}
