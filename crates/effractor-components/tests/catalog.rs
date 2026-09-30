//! The catalog says what the library can build and never what an attack costs.

use effractor_components::{RULES, catalog};
use serde_json::Value;

const RULE_IDS: [&str; 42] = [
    "foothold",
    "admin-implies-user",
    "host-execution",
    "execution-privilege",
    "hosted-router",
    "hosted-host",
    "guest-escape",
    "router-escape",
    "zone-access",
    "flow-permission",
    "flow-connect",
    "service-reachable",
    "product-reachable",
    "product-find-exploit",
    "service-deploy-exploit",
    "host-reachable",
    "application-reachable",
    "host-deploy-exploit",
    "application-deploy-exploit",
    "credential-extract",
    "account-material",
    "mfa-policy",
    "mfa-second-factor",
    "mfa-bypass",
    "account-authenticated",
    "workload-identity",
    "assume-role",
    "content-from-zone",
    "content-from-service",
    "phish",
    "person-disclose",
    "person-run",
    "take-over",
    "service-login",
    "session-grant",
    "administration-login",
    "holder-modify",
    "holder-read",
    "account-data",
    "data-policy",
    "data-key",
    "data-poisoning",
];

fn ids(list: &Value, key: &str) -> Vec<String> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|v| v[key].as_str().unwrap().to_owned())
        .collect()
}

#[test]
fn the_catalog_names_the_pin_every_kind_and_every_rule_once() {
    let c = catalog();
    assert_eq!(
        c["library"],
        serde_json::json!({"id": "core-components", "version": 1})
    );
    assert_eq!(
        ids(&c["entities"], "kind"),
        [
            "network",
            "router",
            "firewall",
            "host",
            "application",
            "service",
            "product",
            "account",
            "credential",
            "person",
            "data",
            "access-control"
        ]
    );
    assert_eq!(ids(&c["associations"], "kind").len(), 20);
    assert_eq!(ids(&c["states"], "id").len(), 9);
    assert_eq!(ids(&c["parameters"], "slot").len(), 14);
    let rules = ids(&c["rules"], "id");
    assert_eq!(rules, RULE_IDS);
    for rule in &RULES {
        assert_eq!(rule.version, 1);
        assert!(!rule.bindings.is_empty(), "{}", rule.id);
        assert!(!rule.assumptions.is_empty(), "{}", rule.id);
    }
    assert_eq!(c["limits"]["entities"], 500);
    assert_eq!(c["limits"]["generated_nodes"], 5000);
    // A product's exploit rule is the one patching replaces.
    let find = c["rules"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == "product-find-exploit")
        .unwrap();
    assert_eq!(find["duration"]["slot"], "find-exploit");
    assert_eq!(find["duration"]["replaced_by"]["defense"], "patched");
    assert_eq!(
        find["duration"]["replaced_by"]["slot"],
        "find-exploit-patched"
    );
    // A firewall's permission points at a flow, which is not an entity kind.
    let permits = &c["associations"][8];
    assert_eq!(permits["to"], serde_json::json!(["flow"]));
    assert_eq!(permits["fields"], serde_json::json!(["allowed"]));
}

/// Every string in the catalog, wherever it is.
fn strings(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) => out.push(s.clone()),
        Value::Array(items) => items.iter().for_each(|i| strings(i, out)),
        Value::Object(map) => map.values().for_each(|i| strings(i, out)),
        _ => {}
    }
}

#[test]
fn no_string_in_the_catalog_is_a_distribution() {
    let mut all = Vec::new();
    strings(&catalog(), &mut all);
    assert!(all.len() > 50);
    for s in all {
        assert!(
            effractor_format::expr::parse(&s).is_err(),
            "{s:?} reads as a TTC; the library has no numeric defaults"
        );
    }
}

/// The page's JavaScript is tested against this file; this keeps it the
/// catalog the wasm module really hands out.
#[test]
fn the_javascript_catalog_fixture_is_the_real_catalog() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let fixture = std::fs::read_to_string(root.join("scripts/fixtures/catalog.json")).unwrap();
    let fixture: serde_json::Value = serde_json::from_str(&fixture).unwrap();
    assert_eq!(effractor_components::catalog(), fixture);
}

/// What the page shows instead of an id: a few plain words, never markup.
fn plain(v: &Value, what: &str) -> String {
    let s = v.as_str().unwrap_or_else(|| panic!("{what} has no words"));
    assert!(!s.is_empty() && !s.contains('`'), "{what}: {s:?}");
    s.to_owned()
}

#[test]
fn every_kind_state_parameter_and_rule_has_plain_words() {
    let c = catalog();
    for e in c["entities"].as_array().unwrap() {
        plain(&e["meaning"], e["kind"].as_str().unwrap());
    }
    for s in c["states"].as_array().unwrap() {
        plain(&s["word"], s["id"].as_str().unwrap());
    }
    for p in c["parameters"].as_array().unwrap() {
        plain(&p["name"], p["slot"].as_str().unwrap());
    }
    for r in c["rules"].as_array().unwrap() {
        plain(&r["title"], r["id"].as_str().unwrap());
    }
    let meaning = |kind: &str| {
        let e = c["entities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e["kind"] == kind);
        plain(&e.unwrap()["meaning"], kind)
    };
    assert!(meaning("application").contains("makes connections"));
    assert!(meaning("service").contains("accepts connections"));
    let word = |id: &str| {
        let s = c["states"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["id"] == id);
        plain(&s.unwrap()["word"], id)
    };
    assert_eq!(word("admin"), "admin control");
    assert_eq!(word("possessed"), "held");
}

#[test]
fn the_catalog_describes_access_control() {
    let c = catalog();
    let e = c["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "access-control")
        .expect("the kind");
    assert_eq!(
        e["meaning"],
        "Where accounts log in to a machine: its user database, its login."
    );
    assert_eq!(e["states"], serde_json::json!([]));
    assert_eq!(e["parameters"], serde_json::json!([]));
    assert_eq!(e["defenses"], serde_json::json!([]));
    let a = c["associations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "controls-access")
        .expect("the link");
    assert_eq!(a["from"], serde_json::json!(["host", "router"]));
    assert_eq!(a["to"], serde_json::json!(["access-control"]));
    let grants = c["associations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["kind"] == "grants")
        .unwrap();
    assert_eq!(
        grants["to"],
        serde_json::json!(["host", "router", "access-control"])
    );
    assert!(
        grants["description"]
            .as_str()
            .unwrap()
            .contains("access control")
    );
}

#[test]
fn every_kind_lists_its_switches() {
    let c = catalog();
    for e in c["entities"].as_array().unwrap() {
        assert!(e["defenses"].is_array(), "{}", e["kind"]);
        assert!(
            e.get("defense").is_none(),
            "{}: one switch is a list now",
            e["kind"]
        );
    }
    let product = c["entities"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["kind"] == "product")
        .unwrap();
    assert_eq!(product["defenses"], serde_json::json!(["patched"]));
}

#[test]
fn every_kind_says_which_of_its_slots_are_optional() {
    for e in catalog()["entities"].as_array().unwrap() {
        let want = match e["kind"].as_str().unwrap() {
            "host" | "application" => serde_json::json!(["deploy-exploit"]),
            _ => serde_json::json!([]),
        };
        assert_eq!(e["optional"], want, "{}", e["kind"]);
    }
}
