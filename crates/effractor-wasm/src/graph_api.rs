//! Generated attack graphs: from an architecture's text to its graph, with
//! the text and the caller's revision token, so an answer that arrives after
//! the document moved on can be recognised and dropped.

use effractor_core::{Code, Diagnostic, Document, Severity};
use serde_json::json;

use crate::api::answer;

/// `{ok: {revision, source, graph}, diagnostics}`: the baseline graph of the
/// architecture `text`. `revision` is the caller's opaque token, handed back
/// unchanged; `source` is exactly the text the graph describes.
pub fn generate(text: &str, revision: &str) -> String {
    let (document, mut diagnostics) = effractor_format::diagnose_document(text);
    let model = match document {
        Some(Document::Architecture(model)) => model,
        Some(Document::Tree(_)) => {
            let d = Diagnostic::error(
                Code::Unsupported,
                "profile",
                "attack graphs are generated from an architecture; this is a tree",
            );
            return answer(None, &[d]);
        }
        None => return answer(None, &diagnostics),
    };
    let graph = match effractor_components::generate(&model) {
        Ok(graph) => graph,
        Err(blocking) => {
            // The validator's diagnostics without positions stand in for the
            // reader's with them.
            let located: Vec<Diagnostic> = blocking
                .iter()
                .map(|b| {
                    diagnostics
                        .iter()
                        .find(|d| d.code == b.code && d.path == b.path)
                        .cloned()
                        .unwrap_or_else(|| b.clone())
                })
                .collect();
            return answer(None, &located);
        }
    };
    let resolved = match effractor_components::resolve(&model, &graph, None) {
        Ok(resolved) => resolved,
        Err(errors) => return answer(None, &errors),
    };
    diagnostics.retain(|d| d.severity == Severity::Warning);
    let ok = json!({
        "revision": revision,
        "source": text,
        "graph": effractor_components::graph_image(&graph, &resolved),
    });
    answer(Some(ok), &diagnostics)
}
