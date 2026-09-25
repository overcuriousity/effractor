//! The architecture fixtures (once the shipped examples) open cleanly, are
//! canonical, and show what each was built to show.

use effractor_components::generate;
use effractor_core::Document;
use effractor_core::architecture::Architecture;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};
use serde_json::Value;

const BRANCH: &str =
    include_str!("../../effractor-components/tests/fixtures/architectures/branch-office.yaml");
const SHOP: &str =
    include_str!("../../effractor-components/tests/fixtures/architectures/web-shop.yaml");
const CLINIC: &str =
    include_str!("../../effractor-components/tests/fixtures/architectures/clinic-records.yaml");
const CLOUD: &str = include_str!(
    "../../effractor-components/tests/fixtures/architectures/cloud-support-agent.yaml"
);
const NEXTCLOUD: &str = include_str!(
    "../../effractor-components/tests/fixtures/architectures/self-hosted-nextcloud.yaml"
);

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

fn witness(r: &Value) -> Vec<String> {
    r["scenario"]["witness"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap().to_owned())
        .collect()
}

/// Every entity defence a scenario sets, applied to the model itself: the
/// graph must not change.
fn switches_never_change_the_graph(m: &Architecture) {
    let ids = |g: &effractor_components::GeneratedGraph| {
        g.nodes.iter().map(|n| n.id.clone()).collect::<Vec<_>>()
    };
    let base = ids(&generate(m).unwrap());
    for (sid, scenario) in &m.scenarios {
        let mut s = m.clone();
        for change in &scenario.changes {
            if let effractor_core::architecture::Change::EntityDefense {
                entity,
                defense,
                value,
            } = change
            {
                s.entities[entity].defenses.set(*defense, Some(*value));
            }
        }
        assert_eq!(ids(&generate(&s).unwrap()), base, "{sid}");
    }
}

#[test]
fn cloud_support_agent_no_single_defence_closes_every_route() {
    let m = open(CLOUD);
    let base = p(&solve(&m, None)["baseline"]["outcome"]);
    println!("cloud baseline {base}");
    assert!(base > 0.5, "{base}");
    for scenario in ["guardrails", "mfa", "training", "patch", "encrypt"] {
        let left = p(&solve(&m, Some(scenario))["scenario"]["outcome"]);
        println!("cloud {scenario} {left}");
        // The same samples under a stronger defence never finish sooner.
        assert!(left <= base, "{scenario}: {left} > {base}");
        assert!(left > 0.0, "{scenario} closed every route");
    }
    switches_never_change_the_graph(&m);
}

#[test]
fn cloud_support_agent_encryption_leaves_the_key_route() {
    let m = open(CLOUD);
    let route = witness(&solve(&m, Some("encrypt")));
    assert!(
        route.contains(&"state/credential/bucket-key/possessed".to_owned()),
        "{route:?}"
    );
}

#[test]
fn nextcloud_haproxy_is_the_chokepoint_and_the_app_route_is_the_fast_one() {
    let m = open(NEXTCLOUD);
    let base = p(&solve(&m, None)["baseline"]["outcome"]);
    assert!(base > 0.4, "{base}");
    // Patching the internet-facing reverse proxy closes every route: both the
    // application pivot and the infrastructure escape start by taking over
    // HAProxy.
    assert_eq!(
        p(&solve(&m, Some("patch-haproxy"))["scenario"]["outcome"]),
        0.0
    );
    assert_eq!(
        p(&solve(&m, Some("patch-web-stack"))["scenario"]["outcome"]),
        0.0
    );
    // Patching Nextcloud closes the fast application route; the slower
    // hypervisor-escape route to the volume on disk remains.
    let patched = p(&solve(&m, Some("patch-nextcloud"))["scenario"]["outcome"]);
    assert!(patched > 0.0 && patched < base, "{patched} vs {base}");
    let route = witness(&solve(&m, Some("patch-nextcloud")));
    assert!(
        route.contains(&"state/host/app-vm/admin".to_owned()),
        "{route:?}"
    );
    assert!(
        route.contains(&"action/holder-read/app-vm/the-file".to_owned()),
        "{route:?}"
    );
    // Encrypting the volume at rest does not stop the running application from
    // serving the file: the number is unchanged.
    assert_eq!(
        p(&solve(&m, Some("encrypt-at-rest"))["scenario"]["outcome"]),
        base
    );
    switches_never_change_the_graph(&m);
}
