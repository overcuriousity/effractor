//! The catalog says what the library can build and never what an attack costs.

use effractor_components::{RULES, catalog};
use serde_json::Value;

const RULE_IDS: [&str; 26] = [
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
    "credential-extract",
    "account-material",
    "mfa-policy",
    "mfa-second-factor",
    "mfa-bypass",
    "account-authenticated",
    "workload-identity",
    "assume-role",
    "service-login",
    "session-grant",
    "administration-login",
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
            "credential"
        ]
    );
    assert_eq!(ids(&c["associations"], "kind").len(), 12);
    assert_eq!(ids(&c["states"], "id").len(), 5);
    assert_eq!(ids(&c["parameters"], "slot").len(), 10);
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
