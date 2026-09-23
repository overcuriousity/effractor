//! A generated graph's durations under the baseline or one scenario. The graph
//! does not change; only which slot, switch or permission value each node
//! reads. An unknown switch or an unknown active slot resolves to `Unknown`
//! with the fields that would have to be filled in, never to a guess.

use std::collections::HashMap;

use effractor_core::architecture::{
    Architecture, Change, Defense, Evidence, Parameter, Relation, Slot, Switch,
};
use effractor_core::{AssociationId, Code, Diagnostic, Distribution, EntityId, ScenarioId};

use crate::graph::{Binding, GeneratedGraph, Owner, ResolvedGraph, ResolvedTtc};

/// A switch value and the path that set it.
type Setting = (Switch, String);

struct Overlay<'a> {
    defenses: HashMap<(&'a EntityId, Defense), Setting>,
    permissions: HashMap<&'a AssociationId, Setting>,
}

pub fn resolve(
    model: &Architecture,
    graph: &GeneratedGraph,
    scenario: Option<&ScenarioId>,
) -> Result<ResolvedGraph, Vec<Diagnostic>> {
    let mut overlay = Overlay {
        defenses: HashMap::new(),
        permissions: HashMap::new(),
    };
    if let Some(sid) = scenario {
        let Some(s) = model.scenarios.get(sid) else {
            return Err(vec![Diagnostic::error(
                Code::UnknownReference,
                "scenarios",
                format!("\"{sid}\" is not a scenario"),
            )]);
        };
        for (i, change) in s.changes.iter().enumerate() {
            let path = format!("scenarios.{sid}.changes[{i}]");
            match change {
                Change::EntityDefense {
                    entity,
                    defense,
                    value,
                } => {
                    overlay.defenses.insert((entity, *defense), (*value, path));
                }
                Change::Permission { association, value } => {
                    overlay.permissions.insert(association, (*value, path));
                }
            }
        }
    }

    let n = graph.nodes.len();
    let mut out = ResolvedGraph {
        ttc: Vec::with_capacity(n),
        evidence: Vec::with_capacity(n),
        paths: Vec::with_capacity(n),
    };
    for node in &graph.nodes {
        let (ttc, evidence, paths) = match &node.duration {
            Binding::Logical => (
                ResolvedTtc::Known(Distribution::Zero),
                Vec::new(),
                Vec::new(),
            ),
            Binding::Foothold(_) => {
                let paths = node
                    .origins
                    .iter()
                    .filter(|o| o.rule == "foothold")
                    .flat_map(|o| o.paths.iter().cloned())
                    .collect();
                (ResolvedTtc::Known(Distribution::Zero), Vec::new(), paths)
            }
            Binding::Permission(aid) => {
                let (value, path) = match overlay.permissions.get(aid) {
                    Some((v, p)) => (*v, p.clone()),
                    None => (allowed(model, aid), format!("associations.{aid}.allowed")),
                };
                let ttc = match value {
                    Switch::On => ResolvedTtc::Known(Distribution::Zero),
                    Switch::Off => ResolvedTtc::Known(Distribution::Infinity),
                    Switch::Unknown => ResolvedTtc::Unknown(vec![path.clone()]),
                };
                (ttc, Vec::new(), vec![path])
            }
            Binding::Unfinished { flow, missing } => {
                let mut paths = missing.clone();
                let connect = parameter(model, &Owner::Flow(flow.clone()), Slot::Connect);
                if connect.status == Evidence::Unknown || connect.ttc.is_none() {
                    paths.push(Owner::Flow(flow.clone()).slot_path(Slot::Connect));
                }
                (ResolvedTtc::Unknown(paths.clone()), Vec::new(), paths)
            }
            Binding::Parameter {
                owner,
                base,
                replacement,
            } => {
                let mut paths = Vec::new();
                let slot = match (owner, replacement) {
                    (Owner::Entity(eid), Some((defense, replaced))) => {
                        let (value, path) = match overlay.defenses.get(&(eid, *defense)) {
                            Some((v, p)) => (*v, p.clone()),
                            None => (
                                model
                                    .entities
                                    .get(eid)
                                    .and_then(|e| e.defenses.get(*defense))
                                    .unwrap_or(Switch::Unknown),
                                format!("entities.{eid}.defenses.{}", defense.as_str()),
                            ),
                        };
                        paths.push(path);
                        match value {
                            Switch::Off => Some(*base),
                            Switch::On => Some(*replaced),
                            Switch::Unknown => None,
                        }
                    }
                    _ => Some(*base),
                };
                match slot {
                    None => (ResolvedTtc::Unknown(paths.clone()), Vec::new(), paths),
                    Some(slot) => {
                        let parameter = parameter(model, owner, slot);
                        let path = owner.slot_path(slot);
                        paths.insert(0, path.clone());
                        let ttc = match (&parameter.status, &parameter.ttc) {
                            (Evidence::Unknown, _) | (_, None) => ResolvedTtc::Unknown(vec![path]),
                            (_, Some(d)) => ResolvedTtc::Known(d.clone()),
                        };
                        (ttc, vec![parameter], paths)
                    }
                }
            }
        };
        out.ttc.push(ttc);
        out.evidence.push(evidence);
        out.paths.push(paths);
    }
    Ok(out)
}

fn allowed(model: &Architecture, aid: &AssociationId) -> Switch {
    match model.associations.get(aid).map(|a| &a.relation) {
        Some(Relation::Permits { allowed, .. }) => *allowed,
        _ => Switch::Unknown,
    }
}

fn parameter(model: &Architecture, owner: &Owner, slot: Slot) -> Parameter {
    let p = match owner {
        Owner::Entity(eid) => model
            .entities
            .get(eid)
            .and_then(|e| e.parameters.get(&slot)),
        Owner::Flow(fid) => model.flows.get(fid).map(|f| &f.connect),
    };
    p.cloned().unwrap_or_default()
}
