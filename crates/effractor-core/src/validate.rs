use std::collections::{HashMap, HashSet};

use indexmap::IndexMap;

use crate::architecture::MAX_SAMPLES;
use crate::distribution::probability;
use crate::{Code, ControlId, Diagnostic, Distribution, Gate, Model, NodeId, NodeKind, Profile};

/// Everything that can be wrong with a model that parsed. Errors mean the
/// solver must not run; warnings mean it will, and the author should look.
pub fn validate(model: &Model) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    header(model, &mut out);
    nodes(model, &mut out);
    assets(model, &mut out);
    controls(model, &mut out);
    graph(model, &mut out);
    out
}

fn param(out: &mut Vec<Diagnostic>, path: String, check: Result<(), String>) {
    if let Err(msg) = check {
        out.push(Diagnostic::error(Code::ParamDomain, path, msg));
    }
}

fn non_negative(name: &str, v: f64) -> Result<(), String> {
    if v.is_finite() && v >= 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be >= 0, got {v}"))
    }
}

fn header(m: &Model, out: &mut Vec<Diagnostic>) {
    if !m.nodes.contains_key(&m.top) {
        out.push(Diagnostic::error(
            Code::UnknownTop,
            "top",
            format!("top names \"{}\", which is not a node", m.top),
        ));
    }
    let horizon = if m.horizon.is_finite() && m.horizon > 0.0 {
        Ok(())
    } else {
        Err(format!("horizon must be > 0, got {}", m.horizon))
    };
    param(out, "horizon".into(), horizon);
    let samples = if m.analysis.samples > 0 {
        Ok(())
    } else {
        Err("samples must be > 0".into())
    };
    param(out, "analysis.samples".into(), samples);
    // The sampler holds every draw: the cap is the architecture's.
    if m.analysis.samples > MAX_SAMPLES {
        out.push(Diagnostic::error(
            Code::Limit,
            "analysis.samples",
            format!("at most {MAX_SAMPLES} samples, got {}", m.analysis.samples),
        ));
    }
    let c = m.analysis.confidence;
    let confidence = if c > 0.0 && c < 1.0 {
        Ok(())
    } else {
        Err(format!("confidence must be in (0, 1), got {c}"))
    };
    param(out, "analysis.confidence".into(), confidence);
}

fn ttc(out: &mut Vec<Diagnostic>, path: String, d: &Distribution) {
    match d.check_ttc() {
        Err(msg) => out.push(Diagnostic::error(Code::DistributionRole, path, msg)),
        Ok(()) => param(out, path, d.check_params()),
    }
}

fn nodes(m: &Model, out: &mut Vec<Diagnostic>) {
    for (id, node) in &m.nodes {
        let at = format!("nodes.{id}");
        match &node.kind {
            NodeKind::Gate { gate, children } => {
                if children.is_empty() {
                    out.push(Diagnostic::error(
                        Code::EmptyGate,
                        format!("{at}.children"),
                        "a gate needs at least one child",
                    ));
                }
                let mut seen = HashSet::new();
                for (i, child) in children.iter().enumerate() {
                    let at = format!("{at}.children[{i}]");
                    if !m.nodes.contains_key(child) {
                        out.push(Diagnostic::error(
                            Code::UnknownChild,
                            at,
                            format!("\"{child}\" is not a node"),
                        ));
                    } else if !seen.insert(child) {
                        // One proposition, one input: listing it twice would
                        // let a single event count as two votes.
                        out.push(Diagnostic::error(
                            Code::DuplicateChild,
                            at,
                            format!("\"{child}\" is already a child of this gate"),
                        ));
                    }
                }
                if let Gate::Vote { k } = *gate
                    && !children.is_empty()
                    && !(1..=children.len()).contains(&k)
                {
                    out.push(Diagnostic::error(
                        Code::VoteRange,
                        format!("{at}.k"),
                        format!("k must be between 1 and {}, got {k}", children.len()),
                    ));
                }
            }
            NodeKind::Leaf(leaf) => {
                if let Some(t) = &leaf.ttc {
                    ttc(out, format!("{at}.{}", t.key()), &t.distribution());
                }
                for (key, value, check) in [
                    (
                        "cost",
                        leaf.cost,
                        non_negative as fn(&str, f64) -> Result<(), String>,
                    ),
                    ("detection", leaf.detection, probability),
                ] {
                    let Some(v) = value else { continue };
                    if m.profile == Profile::AttackTree {
                        param(out, format!("{at}.{key}"), check(key, v));
                    } else {
                        out.push(Diagnostic::warning(
                            Code::ProfileAttribute,
                            format!("{at}.{key}"),
                            format!("`{key}` is an attack-tree attribute; this profile ignores it"),
                        ));
                    }
                }
            }
        }
        for (i, c) in node.consequences.iter().enumerate() {
            let at = format!("{at}.consequences[{i}]");
            match m.assets.get(&c.asset) {
                None => out.push(Diagnostic::error(Code::UnknownAsset, format!("{at}.asset"), format!("\"{}\" is not an asset", c.asset))),
                Some(asset) if asset.loss.get(c.dim).is_none() => out.push(Diagnostic::error(
                    Code::NoMagnitude,
                    format!("{at}.dim"),
                    format!("asset \"{}\" declares no `{}` loss, so this consequence would lose nothing", c.asset, c.dim.key()),
                )),
                Some(_) => {}
            }
            if !(c.fraction > 0.0 && c.fraction <= 1.0) {
                out.push(Diagnostic::error(
                    Code::FractionRange,
                    format!("{at}.fraction"),
                    format!("fraction must be in (0, 1], got {}", c.fraction),
                ));
            }
        }
    }
}

fn assets(m: &Model, out: &mut Vec<Diagnostic>) {
    for (id, asset) in &m.assets {
        for (key, loss) in [
            ("c", &asset.loss.c),
            ("i", &asset.loss.i),
            ("a", &asset.loss.a),
        ] {
            let Some(d) = loss else { continue };
            let at = format!("assets.{id}.loss.{key}");
            match d.check_magnitude() {
                Err(msg) => out.push(Diagnostic::error(Code::DistributionRole, at, msg)),
                Ok(()) => param(out, at, d.check_params()),
            }
        }
    }
}

fn controls(m: &Model, out: &mut Vec<Diagnostic>) {
    let mut touched: IndexMap<&NodeId, Vec<&ControlId>> = IndexMap::new();
    for (id, control) in &m.controls {
        param(
            out,
            format!("controls.{id}.cost"),
            non_negative("cost", control.cost),
        );
        for (i, effect) in control.effects.iter().enumerate() {
            let at = format!("controls.{id}.effects[{i}]");
            match m.nodes.get(&effect.node).map(|n| &n.kind) {
                None => out.push(Diagnostic::error(
                    Code::UnknownEffectNode,
                    format!("{at}.node"),
                    format!("\"{}\" is not a node", effect.node),
                )),
                Some(NodeKind::Gate { .. }) => out.push(Diagnostic::error(
                    Code::EffectOnGate,
                    format!("{at}.node"),
                    format!(
                        "\"{}\" is a gate; a control replaces the TTC of a leaf",
                        effect.node
                    ),
                )),
                Some(NodeKind::Leaf(_)) => {
                    let by = touched.entry(&effect.node).or_default();
                    if !by.contains(&id) {
                        by.push(id);
                    }
                }
            }
            ttc(out, format!("{at}.ttc"), &effect.ttc);
        }
    }
    for (node, by) in touched {
        if by.len() > 1 {
            let names: Vec<_> = by.iter().map(|c| c.as_str()).collect();
            out.push(Diagnostic::warning(
                Code::OverlappingEffects,
                format!("nodes.{node}"),
                format!("controls {} all affect this leaf; when several are enabled, the strongest effect applies, not their sum", names.join(", ")),
            ));
        }
    }
}

fn children<'a>(m: &'a Model, id: &NodeId) -> &'a [NodeId] {
    match m.nodes.get(id).map(|n| &n.kind) {
        Some(NodeKind::Gate { children, .. }) => children,
        _ => &[],
    }
}

/// Cycles and reachability. Iterative on purpose: a model is user input, and a
/// deep enough chain would turn a recursive walk into a stack overflow, which
/// is an abort, not a diagnostic.
fn graph(m: &Model, out: &mut Vec<Diagnostic>) {
    #[derive(Clone, Copy, PartialEq)]
    enum Mark {
        OnPath,
        Done,
    }
    let mut mark: HashMap<&NodeId, Mark> = HashMap::new();

    // Start at `top` so a cycle is described the way the author would walk
    // into it, then cover whatever `top` does not reach.
    let roots = m
        .nodes
        .get_key_value(&m.top)
        .map(|(k, _)| k)
        .into_iter()
        .chain(m.nodes.keys());
    for root in roots {
        if mark.contains_key(root) {
            continue;
        }
        let mut path: Vec<(&NodeId, usize)> = vec![(root, 0)];
        mark.insert(root, Mark::OnPath);
        while let Some((id, next)) = path.last_mut() {
            let kids = children(m, id);
            if *next == kids.len() {
                mark.insert(id, Mark::Done);
                path.pop();
                continue;
            }
            let child = &kids[*next];
            *next += 1;
            let Some((child, _)) = m.nodes.get_key_value(child) else {
                continue;
            };
            match mark.get(child) {
                Some(Mark::Done) => {}
                Some(Mark::OnPath) => {
                    let start = path.iter().position(|(n, _)| *n == child).unwrap_or(0);
                    let mut names: Vec<&str> =
                        path[start..].iter().map(|(n, _)| n.as_str()).collect();
                    names.push(child.as_str());
                    out.push(Diagnostic::error(
                        Code::Cycle,
                        format!("nodes.{child}"),
                        format!("cycle: {}", names.join(" -> ")),
                    ));
                }
                None => {
                    mark.insert(child, Mark::OnPath);
                    path.push((child, 0));
                }
            }
        }
    }

    if !m.nodes.contains_key(&m.top) {
        return; // nothing is reachable from a top that does not exist; one error is enough
    }
    let mut reached: HashSet<&NodeId> = HashSet::new();
    let mut queue = vec![&m.top];
    while let Some(id) = queue.pop() {
        if reached.insert(id) {
            queue.extend(children(m, id));
        }
    }
    for id in m.nodes.keys().filter(|id| !reached.contains(id)) {
        out.push(Diagnostic::warning(
            Code::Unreachable,
            format!("nodes.{id}"),
            format!("\"{id}\" is not reachable from top \"{}\"", m.top),
        ));
    }
}
