//! Generated attack graphs: from an architecture's text to its graph and its
//! results, with the text and the caller's revision token, so an answer that
//! arrives after the document moved on can be recognised and dropped.

use effractor_components::GeneratedGraph;
use effractor_core::architecture::Architecture;
use effractor_core::{Code, Diagnostic, Document, ScenarioId, Severity};
use effractor_solver::graph_results::{GraphConfig, GraphSolve};
use effractor_solver::graph_support::GraphSupport;
use serde_json::{Value, json};

use crate::api::answer;

/// A graph solve under way, with what its answers hand back.
pub(crate) struct GraphRun {
    pub(crate) solve: GraphSolve,
    pub(crate) revision: String,
    pub(crate) source: String,
}

/// The architecture in `text` and its graph, with the reader's warnings; or
/// the diagnostics that stop generation, positioned where the reader could.
fn architecture_graph(
    text: &str,
) -> Result<(Architecture, GeneratedGraph, Vec<Diagnostic>), Vec<Diagnostic>> {
    let (document, mut diagnostics) = effractor_format::diagnose_document(text);
    let model = match document {
        Some(Document::Architecture(model)) => model,
        Some(Document::Tree(_)) => {
            return Err(vec![Diagnostic::error(
                Code::Unsupported,
                "profile",
                "attack graphs are generated from an architecture; this is a tree",
            )]);
        }
        None => return Err(diagnostics),
    };
    let graph = effractor_components::generate(&model).map_err(|blocking| {
        // The validator's diagnostics without positions stand in for the
        // reader's with them.
        blocking
            .iter()
            .map(|b| {
                diagnostics
                    .iter()
                    .find(|d| d.code == b.code && d.path == b.path)
                    .cloned()
                    .unwrap_or_else(|| b.clone())
            })
            .collect::<Vec<_>>()
    })?;
    diagnostics.retain(|d| d.severity == Severity::Warning);
    Ok((model, graph, diagnostics))
}

/// `{ok: {revision, source, graph, support}, diagnostics}`: the baseline graph
/// of the architecture `text`, and what can happen in it before any number
/// (`support`). `revision` is the caller's opaque token, handed back
/// unchanged; `source` is exactly the text the graph describes.
pub fn generate(text: &str, revision: &str) -> String {
    let (model, graph, warnings) = match architecture_graph(text) {
        Ok(generated) => generated,
        Err(diagnostics) => return answer(None, &diagnostics),
    };
    let resolved = match effractor_components::resolve(&model, &graph, None) {
        Ok(resolved) => resolved,
        Err(errors) => return answer(None, &errors),
    };
    let support = effractor_solver::graph_support::analyze(&graph, &resolved);
    let ok = json!({
        "revision": revision,
        "source": text,
        "graph": effractor_components::graph_image(&graph, &resolved),
        "support": support_image(&graph, &support),
    });
    answer(Some(ok), &warnings)
}

/// `{nodes: [{id, status, missing}], target_support: [id]}`, the nodes aligned
/// with the graph's: whether each step is seeded, possible, blocked or
/// unreachable, and which unknown source fields its time would rest on.
fn support_image(graph: &GeneratedGraph, support: &GraphSupport) -> Value {
    let nodes: Vec<Value> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            json!({
                "id": n.id,
                "status": support.status[i].as_str(),
                "missing": support.missing[i],
            })
        })
        .collect();
    let target: Vec<&str> = support
        .target_support
        .iter()
        .map(|&i| graph.nodes[i].id.as_str())
        .collect();
    json!({"nodes": nodes, "target_support": target})
}

/// A graph solve of `text`'s baseline, beside `scenario` unless that is
/// empty, with the document's analysis settings.
pub(crate) fn begin(
    text: &str,
    scenario: &str,
    revision: &str,
) -> Result<(GraphRun, Vec<Diagnostic>), Vec<Diagnostic>> {
    let (model, graph, warnings) = architecture_graph(text)?;
    let scenario = match scenario {
        "" => None,
        s => Some(s.parse::<ScenarioId>().map_err(|_| {
            vec![Diagnostic::error(
                Code::UnknownReference,
                "scenarios",
                format!("\"{s}\" is not a scenario"),
            )]
        })?),
    };
    let solve = GraphSolve::begin(
        &model,
        &graph,
        scenario.as_ref(),
        &GraphConfig::from_model(&model),
    )?;
    Ok((
        GraphRun {
            solve,
            revision: revision.to_owned(),
            source: text.to_owned(),
        },
        warnings,
    ))
}
