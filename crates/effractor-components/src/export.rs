//! The generated graph as JSON, for the browser and for export: every node
//! with its prerequisites, where it comes from and what its time rests on
//! under the resolved scenario.

use serde_json::{Value, json};

use crate::graph::{Binding, GeneratedGraph, GeneratedKind, Origin, ResolvedGraph, ResolvedTtc};

/// `{effractor-graph: 1, library, semantics, target, nodes}`; a node is
/// `{id, label, kind, inputs, origins, timing}` with prerequisites by id.
pub fn graph_image(graph: &GeneratedGraph, resolved: &ResolvedGraph) -> Value {
    assert_eq!(
        resolved.ttc.len(),
        graph.nodes.len(),
        "a resolution of another graph"
    );
    let nodes: Vec<Value> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let (kind, inputs) = match &n.kind {
                GeneratedKind::Input => ("input", &[][..]),
                GeneratedKind::Any { inputs } => ("any", &inputs[..]),
                GeneratedKind::All { inputs } => ("all", &inputs[..]),
            };
            let inputs: Vec<&str> = inputs.iter().map(|&j| graph.nodes[j].id.as_str()).collect();
            json!({
                "id": n.id,
                "label": n.label,
                "kind": kind,
                "inputs": inputs,
                "origins": n.origins.iter().map(origin).collect::<Vec<_>>(),
                "timing": timing(&n.duration, resolved, i),
            })
        })
        .collect();
    json!({
        "effractor-graph": 1,
        "library": {"id": graph.library.id, "version": graph.library.version},
        "semantics": graph.semantics,
        "target": graph.nodes[graph.target].id,
        "nodes": nodes,
    })
}

fn origin(o: &Origin) -> Value {
    json!({
        "rule": o.rule,
        "version": o.version,
        "entities": o.entities.iter().map(|e| e.as_str()).collect::<Vec<_>>(),
        "associations": o.associations.iter().map(|a| a.as_str()).collect::<Vec<_>>(),
        "flows": o.flows.iter().map(|f| f.as_str()).collect::<Vec<_>>(),
        "paths": o.paths,
        "assumptions": o.assumptions,
    })
}

/// `{status, expression, note, paths}`. `status` is `logical`, `foothold`,
/// `policy`, `unknown` or the active parameter's evidence; `expression` is
/// canonical TTC text, or `allowed`/`denied` for a policy.
fn timing(binding: &Binding, resolved: &ResolvedGraph, i: usize) -> Value {
    let paths = &resolved.paths[i];
    let ttc = &resolved.ttc[i];
    let (status, expression, note) = match (binding, ttc) {
        (Binding::Logical, _) => ("logical", None, None),
        (_, ResolvedTtc::Unknown(_)) | (Binding::Unfinished { .. }, _) => ("unknown", None, None),
        (Binding::Foothold(_), _) => ("foothold", None, None),
        (Binding::Permission(_), ResolvedTtc::Known(d)) => {
            let allowed = !matches!(d, effractor_core::Distribution::Infinity);
            (
                "policy",
                Some(if allowed { "allowed" } else { "denied" }.to_owned()),
                None,
            )
        }
        (Binding::Parameter { .. }, ResolvedTtc::Known(d)) => {
            let p = resolved.evidence[i].first();
            (
                p.map_or("unknown", |p| p.status.as_str()),
                Some(effractor_format::expr::write(d)),
                p.and_then(|p| p.note.clone()),
            )
        }
    };
    let missing = match ttc {
        ResolvedTtc::Unknown(m) => m.clone(),
        ResolvedTtc::Known(_) => Vec::new(),
    };
    json!({
        "status": status,
        "expression": expression,
        "note": note,
        "paths": paths,
        "missing": missing,
    })
}
