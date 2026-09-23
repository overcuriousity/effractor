//! The generated graph and its results are an interface, and must be the
//! same bits natively and as wasm. `UPDATE_SNAPSHOTS=1 cargo test` rewrites
//! the file; CI also runs this under wasmtime against the same file.

use effractor_components::{generate, graph_image, resolve};
use effractor_core::Document;
use effractor_core::architecture::Architecture;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};
use serde_json::json;

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");

fn lecture() -> Architecture {
    match effractor_format::load_document(LECTURE) {
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
    let got = serde_json::to_string_pretty(&json!({
        "graph": graph_image(&graph, &resolve(&model, &graph, None).unwrap()),
        "patch": solve(Some("patch")),
        "deny": solve(Some("deny")),
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
