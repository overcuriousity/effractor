//! The generated graph and its results are an interface, and must be the
//! same bits natively and as wasm. `UPDATE_SNAPSHOTS=1 cargo test` rewrites
//! the file; CI also runs this under wasmtime against the same file.

use effractor_components::{generate, graph_image, resolve};
use effractor_core::Document;
use effractor_core::architecture::Architecture;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};
use serde_json::json;

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");

/// The lecture with finite, slower defences and a horizon the attack does not
/// always reach by: a comparison whose paired interval has width.
fn slower_text() -> String {
    LECTURE
        .replace("horizon: 100", "horizon: 10")
        .replace(
            "        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a patched",
            "        ttc: \"Exponential(mean 200)\"\n        note: \"Exercise assumption: perfect blocking, a patched",
        )
        .replace(
            "        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a protected",
            "        ttc: \"Exponential(mean 200)\"\n        note: \"Exercise assumption: perfect blocking, a protected",
        )
}

fn lecture() -> Architecture {
    architecture(LECTURE)
}

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

#[test]
fn lecture_graph_results_are_stable_and_identical_under_wasm() {
    let model = lecture();
    let graph = generate(&model).unwrap();
    let config = GraphConfig {
        samples: 8192,
        ..GraphConfig::from_model(&model)
    };
    let solve = |scenario: Option<&str>| {
        let scenario = scenario.map(|s| s.parse().unwrap());
        GraphSolve::begin(&model, &graph, scenario.as_ref(), &config)
            .unwrap()
            .finish()
    };
    let slower = architecture(&slower_text());
    let slower_graph = generate(&slower).unwrap();
    let slower_both = GraphSolve::begin(
        &slower,
        &slower_graph,
        Some(&"both".parse().unwrap()),
        &GraphConfig {
            samples: 8192,
            ..GraphConfig::from_model(&slower)
        },
    )
    .unwrap()
    .finish();
    let delta = serde_json::to_value(&slower_both.delta).unwrap();
    let ci = &delta["available"]["ci"];
    assert!(
        ci["lo"].as_f64().unwrap() < ci["hi"].as_f64().unwrap(),
        "{delta}"
    );
    let got = serde_json::to_string_pretty(&json!({
        "graph": graph_image(&graph, &resolve(&model, &graph, None).unwrap()),
        "patch": solve(Some("patch")),
        "deny": solve(Some("deny")),
        "slower-both": slower_both,
    }))
    .unwrap()
        + "\n";
    if std::env::var_os("UPDATE_SNAPSHOTS").is_some() {
        std::fs::write("tests/snapshots/lecture-graph.json", &got).unwrap();
    }
    assert!(
        got == include_str!("snapshots/lecture-graph.json"),
        "results changed; if intended, rerun with UPDATE_SNAPSHOTS=1 and review the diff"
    );
}
