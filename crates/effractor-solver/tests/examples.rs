//! The shipped sample collection (`assets/examples/`) opens cleanly, is
//! canonical, and solves. Formats change in place (no versioning), so a shipped
//! example could otherwise rot silently when the schema moves; this catches it.
//! Files are embedded, not read, so the test runs the same natively and under
//! wasmtime.

use effractor_components::generate;
use effractor_core::Document;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};

/// Small sample count: this is a smoke test of loading and solving, not a
/// numerical check — those live beside each behaviour.
const SAMPLES: u64 = 1024;

macro_rules! examples {
    ($($name:literal),+ $(,)?) => {
        [$(($name, include_str!(concat!("../../../assets/examples/", $name)))),+]
    };
}

const EXAMPLES: &[(&str, &str)] = &examples![
    "01-relay-mast-fault.yaml",
    "02-cred-switch-fault.yaml",
    "03-ai-core-fault.yaml",
    "04-drone-payout-attack.yaml",
    "05-cyberware-telemetry-attack.yaml",
    "06-simstim-leak-attack.yaml",
    "07-noodle-stall-architecture.yaml",
    "08-chrome-clinic-architecture.yaml",
    "09-arcology-life-support-architecture.yaml",
    "10-data-broker-architecture.yaml",
    "11-ops-construct-architecture.yaml",
    "12-identity-vault-architecture.yaml",
];

#[test]
fn every_example_is_canonical_loads_and_solves() {
    for (name, text) in EXAMPLES {
        let (_, diagnostics) = effractor_format::diagnose_document(text);
        assert!(diagnostics.is_empty(), "{name}: {diagnostics:?}");
        assert_eq!(
            effractor_format::canonicalize(text).unwrap().as_str(),
            *text,
            "{name} is not in canonical form"
        );
        match effractor_format::load_document(text) {
            Ok(Document::Tree(model)) => {
                let config = effractor_solver::Config {
                    samples: SAMPLES,
                    ..effractor_solver::Config::from_model(&model)
                };
                effractor_solver::solve(&model, &config)
                    .unwrap_or_else(|e| panic!("{name} does not solve: {e:?}"));
            }
            Ok(Document::Architecture(model)) => {
                let graph =
                    generate(&model).unwrap_or_else(|e| panic!("{name} does not generate: {e:?}"));
                let config = GraphConfig {
                    samples: SAMPLES,
                    ..GraphConfig::from_model(&model)
                };
                // The baseline and every scenario the file declares.
                let mut sides: Vec<Option<String>> = vec![None];
                sides.extend(model.scenarios.keys().map(|k| Some(k.to_string())));
                for side in sides {
                    let scenario = side.as_ref().map(|s| s.parse().unwrap());
                    GraphSolve::begin(&model, &graph, scenario.as_ref(), &config)
                        .unwrap_or_else(|e| panic!("{name} does not solve ({side:?}): {e:?}"))
                        .finish();
                }
            }
            Err(diagnostics) => panic!("{name} does not load: {diagnostics:?}"),
        }
    }
}
