//! A cluster is a way of looking (clustering spec §1): the same model with
//! components clustered generates the same graph and the same results.

use effractor_components::{generate, graph_image, resolve};
use effractor_core::Document;
use effractor_core::architecture::Architecture;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

/// The lecture with two clusters, one closed and one open.
fn clustered() -> String {
    LECTURE.replacen(
        "\nattacker:\n",
        "\nclusters:\n  client-box:\n    members: [workstation, ssh-client]\n    closed: true\n  servers:\n    label: Servers\n    members: [server, sshd]\n    closed: false\n\nattacker:\n",
        1,
    )
}

fn solved(model: &Architecture, scenario: Option<&str>) -> serde_json::Value {
    let graph = generate(model).unwrap();
    let scenario = scenario.map(|s| s.parse().unwrap());
    let config = GraphConfig {
        samples: 2048,
        ..GraphConfig::from_model(model)
    };
    let r = GraphSolve::begin(model, &graph, scenario.as_ref(), &config)
        .unwrap()
        .finish();
    serde_json::to_value(r).unwrap()
}

#[test]
fn clustering_changes_neither_the_graph_nor_the_results() {
    let text = clustered();
    let (_, diagnostics) = effractor_format::diagnose_document(&text);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    let plain = architecture(LECTURE);
    let folded = architecture(&text);
    assert_eq!(folded.clusters.len(), 2);

    let (a, b) = (generate(&plain).unwrap(), generate(&folded).unwrap());
    let (ra, rb) = (
        resolve(&plain, &a, None).unwrap(),
        resolve(&folded, &b, None).unwrap(),
    );
    assert_eq!(graph_image(&a, &ra), graph_image(&b, &rb));
    for scenario in [None, Some("patch"), Some("deny")] {
        assert_eq!(
            solved(&plain, scenario),
            solved(&folded, scenario),
            "{scenario:?}"
        );
    }
}
