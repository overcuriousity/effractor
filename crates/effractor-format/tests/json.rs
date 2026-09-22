//! The document as JSON: what the browser edits. It is an image of the YAML
//! tree, not of the `Model`, so an `x-` key rides along without anyone having
//! to know it is there.

use effractor_format::{canonicalize, document, from_document};
use serde_json::{Value, json};

const OFFICE: &str = include_str!("fixtures/canonical/office.yaml");
const WEBSERVER: &str = include_str!("fixtures/canonical/webserver.yaml");

fn doc(text: &str) -> Value {
    let (doc, diagnostics) = document(text);
    doc.unwrap_or_else(|| panic!("{diagnostics:?}"))
}

#[test]
fn the_image_has_the_documents_shape_and_types() {
    let d = doc(WEBSERVER);
    assert_eq!(d["effractor"], json!(2));
    assert_eq!(d["horizon"], json!(8760));
    assert_eq!(d["nodes"]["server-outage"]["rate"], json!(2.5e-6));
    assert_eq!(
        d["nodes"]["no-access"]["children"][2],
        json!("server-outage")
    );
    assert_eq!(d["controls"]["redundant-psu"]["enabled"], json!(false));
    assert_eq!(
        d["assets"]["webserver"]["loss"]["a"],
        json!("Pert(60000, 120000, 400000)")
    );
    // Authored order survives: it is the order of the canvas and of the diff.
    let ids: Vec<&String> = d["nodes"].as_object().unwrap().keys().collect();
    assert_eq!(ids[0], "loss-of-availability");
    assert_eq!(ids[3], "administration");
}

#[test]
fn there_and_back_is_the_identity_on_canonical_text() {
    assert_eq!(from_document(&doc(WEBSERVER)).unwrap(), WEBSERVER);
    // But for one thing. JSON cannot say "this string was written bare", so an
    // `x-` string that could be taken for another type comes back quoted: the
    // same string to every reader, and the safe side of what a YAML 1.1 reader
    // would make of a bare date.
    let quoted = OFFICE.replace("x-last-run: 2026-09-01", "x-last-run: \"2026-09-01\"");
    assert_eq!(from_document(&doc(OFFICE)).unwrap(), quoted);
    assert_eq!(from_document(&doc(&quoted)).unwrap(), quoted);
}

#[test]
fn a_quoted_scalar_is_a_string_and_stays_one() {
    let d = doc(OFFICE);
    assert_eq!(d["nodes"]["key"]["label"], json!("true"));
    assert_eq!(d["x-tags"], json!(["course", "example, with comma"]));
    assert_eq!(d["nodes"]["physical"]["x-source"]["pages"], json!([4, 5]));
    assert_eq!(d["analysis"]["x-last-run"], json!("2026-09-01"));
}

#[test]
fn an_edit_in_json_is_an_edit_in_the_text() {
    let mut d = doc(WEBSERVER);
    d["analysis"]["samples"] = json!(500000);
    d["controls"]["redundant-psu"]["enabled"] = json!(true);
    d["nodes"]["malware"]["x-note"] = json!({"seen": [2024, 2025], "by": "SOC"});
    let text = from_document(&d).unwrap();
    assert!(text.contains("  samples: 500000\n"));
    assert!(text.contains("    enabled: true\n"));
    assert!(text.contains("    x-note: {seen: [2024, 2025], by: SOC}\n"));
    assert_eq!(canonicalize(&text).unwrap(), text);
}

#[test]
fn a_bad_edit_comes_back_as_diagnostics_with_paths() {
    let mut d = doc(WEBSERVER);
    d["nodes"]["no-access"]["children"][0] = json!("nobody");
    d["nodes"]["malware"]["p"] = json!("often");
    d["colour"] = json!("red");
    let diagnostics = from_document(&d).unwrap_err();
    let got: Vec<_> = diagnostics
        .iter()
        .map(|d| (d.code.as_str(), d.path.as_str(), d.pos))
        .collect();
    assert!(
        got.contains(&("wrong-type", "nodes.malware.p", None)),
        "{got:?}"
    );
    assert!(got.contains(&("unknown-key", "colour", None)), "{got:?}");

    let mut d = doc(WEBSERVER);
    d["nodes"]["no-access"]["children"][0] = json!("nobody");
    let diagnostics = from_document(&d).unwrap_err();
    assert_eq!(diagnostics[0].code.as_str(), "unknown-child");
    assert_eq!(diagnostics[0].path, "nodes.no-access.children[0]");
}

#[test]
fn whole_numbers_too_big_for_javascript_travel_as_strings() {
    // A seed is any u64; a JS number is exact only to 2^53.
    let text = WEBSERVER.replace("seed: 42", "seed: 18446744073709551615");
    let d = doc(&text);
    assert_eq!(d["analysis"]["seed"], json!("18446744073709551615"));
    assert_eq!(from_document(&d).unwrap(), text);
    let text = WEBSERVER.replace("seed: 42", "seed: 9007199254740992");
    assert_eq!(doc(&text)["analysis"]["seed"], json!(9007199254740992u64));
}

#[test]
fn an_invalid_text_has_no_image() {
    let (d, diagnostics) = document("effractor: 1\nprofile: fault-tree\n");
    assert!(d.is_none());
    assert!(!diagnostics.is_empty());
}

#[test]
fn json_this_format_cannot_hold() {
    assert!(from_document(&json!([1, 2])).is_err());
    assert!(from_document(&json!(null)).is_err());
    let mut deep = json!(1);
    for _ in 0..100 {
        deep = json!([deep]);
    }
    let mut d = doc(WEBSERVER);
    d["x-deep"] = deep;
    assert_eq!(
        from_document(&d).unwrap_err()[0].code.as_str(),
        "unsupported"
    );
}

/// The page's JavaScript is tested against this file; this keeps the file
/// what `document` really returns for the reference tree.
#[test]
fn the_javascript_fixture_is_the_real_image() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let text = std::fs::read_to_string(
        root.join("crates/effractor-format/tests/fixtures/canonical/webserver.yaml"),
    )
    .unwrap();
    let fixture =
        std::fs::read_to_string(root.join("scripts/fixtures/webserver.doc.json")).unwrap();
    let fixture: Value = serde_json::from_str(&fixture).unwrap();
    assert_eq!(doc(&text), fixture);
    // Key order is part of it: it is the order of the canvas.
    assert_eq!(doc(&text).to_string(), fixture.to_string());
}
