//! The shipped architecture examples open cleanly, are canonical, and show
//! what the examples README says they show.

use effractor_components::generate;
use effractor_core::Document;
use effractor_core::architecture::Architecture;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};
use serde_json::Value;

const BRANCH: &str = include_str!("../../../assets/examples/14-branch-office-architecture.yaml");
const SHOP: &str = include_str!("../../../assets/examples/15-web-shop-architecture.yaml");
const CLINIC: &str = include_str!("../../../assets/examples/16-clinic-records-architecture.yaml");

fn open(text: &str) -> Architecture {
    let (_, diagnostics) = effractor_format::diagnose_document(text);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    assert_eq!(effractor_format::canonicalize(text).unwrap(), text);
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

/// The scenario side's target outcome, and the delta.
fn solve(model: &Architecture, scenario: Option<&str>) -> Value {
    let graph = generate(model).unwrap();
    let scenario = scenario.map(|s| s.parse().unwrap());
    let config = GraphConfig {
        samples: 4096,
        ..GraphConfig::from_model(model)
    };
    let r = GraphSolve::begin(model, &graph, scenario.as_ref(), &config)
        .unwrap()
        .finish();
    serde_json::to_value(r).unwrap()
}

fn p(outcome: &Value) -> f64 {
    outcome["available"]["p_target"]
        .as_f64()
        .unwrap_or_else(|| panic!("no number: {outcome}"))
}

#[test]
fn branch_office_a_router_on_its_appliance_defeats_a_denied_flow() {
    let m = open(BRANCH);
    let base = solve(&m, None);
    assert!(p(&base["baseline"]["outcome"]) > 0.5);
    // Denied at the gateway, the file share is still reached through the
    // appliance the gateway runs on.
    let denied = solve(&m, Some("deny-smb"));
    let left = p(&denied["scenario"]["outcome"]);
    assert!(left > 0.1 && left < p(&denied["baseline"]["outcome"]));
    let route: Vec<&str> = denied["scenario"]["witness"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap())
        .collect();
    assert!(route.contains(&"state/router/gateway/admin"));
    assert!(route.contains(&"state/host/appliance/admin"));
    // Patch the appliance too, and nothing is left.
    let both = solve(&m, Some("deny-and-patch-appliance"));
    assert_eq!(p(&both["scenario"]["outcome"]), 0.0);
}

#[test]
fn web_shop_each_defence_leaves_the_other_route() {
    let m = open(SHOP);
    let base = p(&solve(&m, None)["baseline"]["outcome"]);
    let mut left = Vec::new();
    for scenario in ["update-shop", "vault-password", "both"] {
        let r = solve(&m, Some(scenario));
        let scenario = p(&r["scenario"]["outcome"]);
        assert!(scenario < base);
        assert!(r["delta"]["available"]["mean"].as_f64().unwrap() > 0.0);
        left.push(scenario);
    }
    assert!(left[0] > 0.0 && left[1] > 0.0);
    assert!(left[2] < left[0] && left[2] < left[1]);
    // One value is assumed without a reason, and says so by having none.
    let r = solve(&m, None);
    let db = r["baseline"]["assumptions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["path"] == "entities.db-software.parameters.find-exploit")
        .unwrap();
    assert_eq!(db["status"], "assumed");
    assert!(db["note"].is_null());
}

#[test]
fn clinic_records_an_unknown_alternative_costs_the_number_until_patched() {
    let m = open(CLINIC);
    let base = solve(&m, None);
    assert_eq!(
        base["baseline"]["outcome"]["unavailable"]["missing"],
        serde_json::json!(["entities.records-software.parameters.find-exploit"])
    );
    let patched = solve(&m, Some("vendor-patch"));
    assert!(p(&patched["scenario"]["outcome"]) > 0.0);
    assert!(patched["delta"]["unavailable"].is_object());
    let tokens = solve(&m, Some("short-tokens"));
    assert!(tokens["scenario"]["outcome"]["unavailable"].is_object());
}
