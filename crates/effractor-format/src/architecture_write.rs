//! `Architecture` → canonical text. The same conventions as a tree: fixed key
//! order, maps in the order they were authored, block style except for the
//! small records (the library pin, a defence switch, a state, a change), and
//! `x-` keys after the keys of the map they came from. Every parameter slot
//! and switch a kind carries is written, `unknown` where nothing was said.

use std::fmt::Write;

use effractor_core::EntityId;
use effractor_core::architecture::{Architecture, Change, Factor, Parameter, Relation, Switch};

use crate::CURRENT_VERSION;
use crate::architecture_read::{
    BOOLS, DEFENSES, EVIDENCE, FACTORS, KINDS, PRIVILEGES, RELATIONS, STATES, SWITCHES,
};
use crate::lower::{ARCHITECTURE, Extras, TIME_UNITS};
use crate::write::{Context, WIDTH, Writer, expression, string, word};

pub fn write(m: &Architecture, extras: &Extras) -> String {
    let mut w = Writer::new(extras);
    document(&mut w, m);
    w.out
}

fn parameter(w: &mut Writer, indent: usize, key: &str, p: &Parameter, path: &str) {
    w.open(indent, key);
    w.line(indent + 2, "status", word(&EVIDENCE, &p.status));
    if let Some(d) = &p.ttc {
        w.line(indent + 2, "ttc", &expression(d));
    }
    if let Some(note) = &p.note {
        w.line(indent + 2, "note", &string(note, Context::Block));
    }
    w.extension_lines(indent + 2, path);
}

fn ids(ids: &[EntityId]) -> Vec<&str> {
    ids.iter().map(|id| id.as_str()).collect()
}

fn document(w: &mut Writer, m: &Architecture) {
    w.line(0, "effractor", &CURRENT_VERSION.to_string());
    w.line(0, "profile", ARCHITECTURE);
    w.line(0, "name", &string(&m.name, Context::Block));
    w.line(0, "time_unit", word(&TIME_UNITS, &m.time_unit));
    w.line(0, "horizon", &effractor_mal::number(m.horizon));
    let mut fields = vec![
        format!("id: {}", string(&m.library.id, Context::FlowValue)),
        format!("version: {}", m.library.version),
    ];
    w.extension_fields("library", &mut fields);
    w.line(0, "library", &format!("{{{}}}", fields.join(", ")));

    w.out.push('\n');
    if m.entities.is_empty() {
        w.line(0, "entities", "{}");
    } else {
        w.open(0, "entities");
    }
    for (id, entity) in &m.entities {
        let path = format!("entities.{id}");
        w.open(2, id.as_str());
        w.line(4, "kind", word(&KINDS, &entity.kind));
        w.line(4, "label", &string(&entity.label, Context::Block));
        if let Some(d) = &entity.description {
            w.line(4, "description", &string(d, Context::Block));
        }
        let slots = entity.kind.slots();
        if !slots.is_empty() {
            w.open(4, "parameters");
            for slot in slots {
                let unknown = Parameter::unknown();
                let p = entity.parameters.get(slot).unwrap_or(&unknown);
                let at = format!("{path}.parameters.{}", slot.as_str());
                parameter(w, 6, slot.as_str(), p, &at);
            }
            w.extension_lines(6, &format!("{path}.parameters"));
        }
        if let Some(defense) = entity.kind.defense() {
            let value = entity.defenses.get(defense).unwrap_or(Switch::Unknown);
            let mut fields = vec![format!(
                "{}: {}",
                word(&DEFENSES, &defense),
                word(&SWITCHES, &value)
            )];
            w.extension_fields(&format!("{path}.defenses"), &mut fields);
            w.line(4, "defenses", &format!("{{{}}}", fields.join(", ")));
        }
        w.extension_lines(4, &path);
    }

    w.out.push('\n');
    if m.associations.is_empty() {
        w.line(0, "associations", "{}");
    } else {
        w.open(0, "associations");
    }
    for (id, association) in &m.associations {
        let path = format!("associations.{id}");
        let r = &association.relation;
        w.open(2, id.as_str());
        w.line(4, "kind", word(&RELATIONS, &r.kind()));
        w.line(4, "from", r.from().as_str());
        match r {
            Relation::Permits { to, allowed, .. } => {
                w.line(4, "to", to.as_str());
                w.line(4, "allowed", word(&SWITCHES, allowed));
            }
            _ => {
                if let Some(to) = r.to_entity() {
                    w.line(4, "to", to.as_str());
                }
                if let Some(privilege) = r.privilege() {
                    w.line(4, "privilege", word(&PRIVILEGES, &privilege));
                }
                if let Relation::Hosts {
                    shell: Some(shell), ..
                } = r
                {
                    w.line(4, "shell", word(&BOOLS, shell));
                }
                if let Relation::Authenticates {
                    factor: Factor::Second,
                    ..
                } = r
                {
                    w.line(4, "factor", word(&FACTORS, &Factor::Second));
                }
            }
        }
        if let Some(d) = &association.description {
            w.line(4, "description", &string(d, Context::Block));
        }
        w.extension_lines(4, &path);
    }

    w.out.push('\n');
    if m.flows.is_empty() {
        w.line(0, "flows", "{}");
    } else {
        w.open(0, "flows");
    }
    for (id, flow) in &m.flows {
        let path = format!("flows.{id}");
        w.open(2, id.as_str());
        w.line(4, "label", &string(&flow.label, Context::Block));
        w.line(4, "source", flow.source.as_str());
        w.line(4, "target", flow.target.as_str());
        let route = ids(&flow.route);
        let inline = format!("[{}]", route.join(", "));
        if "    route: ".len() + inline.len() <= WIDTH {
            w.line(4, "route", &inline);
        } else {
            w.open(4, "route");
            for id in route {
                let _ = writeln!(w.out, "      - {id}");
            }
        }
        if let Some(p) = &flow.protocol {
            w.line(4, "protocol", &string(p, Context::Block));
        }
        w.open(4, "parameters");
        parameter(
            w,
            6,
            "connect",
            &flow.connect,
            &format!("{path}.parameters.connect"),
        );
        w.extension_lines(6, &format!("{path}.parameters"));
        w.extension_lines(4, &path);
    }

    w.out.push('\n');
    w.open(0, "attacker");
    if m.attacker.footholds.is_empty() {
        w.line(2, "footholds", "[]");
    } else {
        w.open(2, "footholds");
    }
    for (i, foothold) in m.attacker.footholds.iter().enumerate() {
        let mut fields = vec![
            format!("entity: {}", foothold.entity),
            format!("state: {}", word(&STATES, &foothold.state)),
        ];
        w.extension_fields(&format!("attacker.footholds[{i}]"), &mut fields);
        let _ = writeln!(w.out, "    - {{{}}}", fields.join(", "));
    }
    if let Some(target) = &m.attacker.target {
        let mut fields = vec![
            format!("entity: {}", target.entity),
            format!("state: {}", word(&STATES, &target.state)),
        ];
        w.extension_fields("attacker.target", &mut fields);
        w.line(2, "target", &format!("{{{}}}", fields.join(", ")));
    }
    w.extension_lines(2, "attacker");

    w.out.push('\n');
    if m.scenarios.is_empty() {
        w.line(0, "scenarios", "{}");
    } else {
        w.open(0, "scenarios");
    }
    for (id, scenario) in &m.scenarios {
        let path = format!("scenarios.{id}");
        w.open(2, id.as_str());
        w.line(4, "label", &string(&scenario.label, Context::Block));
        if scenario.changes.is_empty() {
            w.line(4, "changes", "[]");
        } else {
            w.open(4, "changes");
        }
        for (i, change) in scenario.changes.iter().enumerate() {
            let mut fields = match change {
                Change::EntityDefense {
                    entity,
                    defense,
                    value,
                } => vec![
                    format!("entity: {entity}"),
                    format!("defense: {}", word(&DEFENSES, defense)),
                    format!("value: {}", word(&SWITCHES, value)),
                ],
                Change::Permission { association, value } => vec![
                    format!("association: {association}"),
                    "field: allowed".to_owned(),
                    format!("value: {}", word(&SWITCHES, value)),
                ],
            };
            w.extension_fields(&format!("{path}.changes[{i}]"), &mut fields);
            let _ = writeln!(w.out, "      - {{{}}}", fields.join(", "));
        }
        w.extension_lines(4, &path);
    }

    w.out.push('\n');
    w.open(0, "analysis");
    w.line(2, "seed", &m.analysis.seed.to_string());
    w.line(2, "samples", &m.analysis.samples.to_string());
    w.line(
        2,
        "confidence",
        &effractor_mal::number(m.analysis.confidence),
    );
    w.extension_lines(2, "analysis");

    if w.has_extensions("") {
        w.out.push('\n');
        w.extension_lines(0, "");
    }
}
