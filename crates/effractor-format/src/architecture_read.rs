//! Tree → `Architecture`: the schema of `profile: architecture`. Every key an
//! architecture document may have is named here; anything else is an error
//! unless it starts with `x-`. Missing parameter slots and switches are
//! filled in as unknown, so the model always carries the full set its kinds
//! ask for and a save writes them out.

use effractor_core::architecture::{
    Architecture, Association, Attacker, AttackerProfile, Change, Defense, Defenses, Entity,
    EntityKind, Evidence, Factor, Flow, LibraryPin, Mode, Parameter, Privilege, Relation,
    RelationKind, Scenario, Slot, State, StateRef, Switch, Tool,
};
use effractor_core::{Code, Pos};
use indexmap::IndexMap;

use crate::lower::{Cx, TIME_UNITS};
use crate::tree::{Entry, Node};

pub const KINDS: [(&str, EntityKind); 11] = [
    ("network", EntityKind::Network),
    ("router", EntityKind::Router),
    ("firewall", EntityKind::Firewall),
    ("host", EntityKind::Host),
    ("application", EntityKind::Application),
    ("service", EntityKind::Service),
    ("product", EntityKind::Product),
    ("account", EntityKind::Account),
    ("credential", EntityKind::Credential),
    ("person", EntityKind::Person),
    ("data", EntityKind::Data),
];
pub const TOOLS: [(&str, Tool); 1] = [("nmap", Tool::Nmap)];
pub const RELATIONS: [(&str, RelationKind); 19] = [
    ("attached", RelationKind::Attached),
    ("hosts", RelationKind::Hosts),
    ("filters", RelationKind::Filters),
    ("stores", RelationKind::Stores),
    ("authenticates", RelationKind::Authenticates),
    ("authorizes", RelationKind::Authorizes),
    ("grants", RelationKind::Grants),
    ("administration", RelationKind::Administration),
    ("permits", RelationKind::Permits),
    ("instance-of", RelationKind::InstanceOf),
    ("runs-as", RelationKind::RunsAs),
    ("assumes", RelationKind::Assumes),
    ("knows", RelationKind::Knows),
    ("operates", RelationKind::Operates),
    ("delivers", RelationKind::Delivers),
    ("holds", RelationKind::Holds),
    ("accesses", RelationKind::Accesses),
    ("encrypted-with", RelationKind::EncryptedWith),
    ("reads", RelationKind::Reads),
];
pub const PRIVILEGES: [(&str, Privilege); 2] =
    [("user", Privilege::User), ("admin", Privilege::Admin)];
pub const STATES: [(&str, State); 9] = [
    ("access", State::Access),
    ("user", State::User),
    ("admin", State::Admin),
    ("control", State::Control),
    ("possessed", State::Possessed),
    ("contacted", State::Contacted),
    ("deceived", State::Deceived),
    ("read", State::Read),
    ("modified", State::Modified),
];
pub const SWITCHES: [(&str, Switch); 3] = [
    ("unknown", Switch::Unknown),
    ("true", Switch::On),
    ("false", Switch::Off),
];
pub const EVIDENCE: [(&str, Evidence); 4] = [
    ("unknown", Evidence::Unknown),
    ("illustrative", Evidence::Illustrative),
    ("assumed", Evidence::Assumed),
    ("calibrated", Evidence::Calibrated),
];
/// The fields an association may carry beside kind/from/to/description.
const EXTRAS: [&str; 6] = [
    "privilege",
    "allowed",
    "factor",
    "contained",
    "decrypts",
    "mode",
];
pub const MODES: [(&str, Mode); 2] = [("read", Mode::Read), ("write", Mode::Write)];
pub const BOOLS: [(&str, bool); 2] = [("true", true), ("false", false)];
pub const FACTORS: [(&str, Factor); 2] = [("first", Factor::First), ("second", Factor::Second)];
pub const SLOTS: [(&str, Slot); 14] = [
    ("connect", Slot::Connect),
    ("find-exploit", Slot::FindExploit),
    ("find-exploit-patched", Slot::FindExploitPatched),
    ("deploy-exploit", Slot::DeployExploit),
    ("login", Slot::Login),
    ("extract", Slot::Extract),
    ("extract-protected", Slot::ExtractProtected),
    ("admin-login", Slot::AdminLogin),
    ("escape", Slot::Escape),
    ("mfa-bypass", Slot::MfaBypass),
    ("phish", Slot::Phish),
    ("phish-trained", Slot::PhishTrained),
    ("take-over", Slot::TakeOver),
    ("take-over-guarded", Slot::TakeOverGuarded),
];
pub const DEFENSES: [(&str, Defense); 6] = [
    ("patched", Defense::Patched),
    ("protected", Defense::Protected),
    ("mfa", Defense::Mfa),
    ("trained", Defense::Trained),
    ("guarded", Defense::Guarded),
    ("encrypted", Defense::Encrypted),
];

pub fn document(cx: &mut Cx, root: &Node) -> Option<Architecture> {
    let f = cx.fields(
        root,
        "",
        Pos { line: 1, col: 1 },
        &[
            "effractor",
            "profile",
            "name",
            "time_unit",
            "horizon",
            "library",
            "entities",
            "associations",
            "flows",
            "attacker",
            "scenarios",
            "analysis",
        ],
    )?;
    let name = cx
        .required(&f, "name")
        .and_then(|e| cx.string(&e.value, "name"));
    let library = cx.required(&f, "library").and_then(|e| library(cx, e));
    let entities = cx.id_map(f.get("entities"), "entities", entity);
    let associations = cx.id_map(f.get("associations"), "associations", association);
    let flows = cx.id_map(f.get("flows"), "flows", flow);
    let attacker = match f.get("attacker") {
        Some(e) => attacker(cx, e),
        None => Some(Attacker::default()),
    };
    let scenarios = cx.id_map(f.get("scenarios"), "scenarios", scenario);

    let time_unit = f
        .get("time_unit")
        .map(|e| cx.word(&e.value, "time_unit", &TIME_UNITS));
    let horizon = f.get("horizon").map(|e| cx.number(&e.value, "horizon"));
    let analysis = f.get("analysis").map(|e| cx.analysis(e));

    let mut m = Architecture::new(name?);
    m.library = library?;
    if let Some(v) = time_unit {
        m.time_unit = v?;
    }
    if let Some(v) = horizon {
        m.horizon = v?;
    }
    if let Some(v) = analysis {
        m.analysis = v?;
    }
    m.entities = entities?;
    m.associations = associations?;
    m.flows = flows?;
    m.attacker = attacker?;
    m.scenarios = scenarios?;
    Some(m)
}

fn library(cx: &mut Cx, entry: &Entry) -> Option<LibraryPin> {
    let f = cx.fields(&entry.value, "library", entry.key_pos, &["id", "version"])?;
    let id = cx
        .required(&f, "id")
        .and_then(|e| cx.string(&e.value, &f.path("id")));
    let version = cx.required(&f, "version").and_then(|e| {
        let path = f.path("version");
        let v = cx.integer(&e.value, &path)?;
        match u32::try_from(v) {
            Ok(v) => Some(v),
            Err(_) => {
                let message = format!("expected a library version, found {v}");
                cx.error(Code::WrongType, path, e.value.pos, message);
                None
            }
        }
    });
    Some(LibraryPin {
        id: id?,
        version: version?,
    })
}

fn entity(cx: &mut Cx, entry: &Entry, path: &str) -> Option<Entity> {
    let f = cx.fields(
        &entry.value,
        path,
        entry.key_pos,
        &[
            "kind",
            "label",
            "description",
            "addresses",
            "tool",
            "parameters",
            "defenses",
        ],
    )?;
    let kind = cx
        .required(&f, "kind")
        .and_then(|e| cx.word(&e.value, &f.path("kind"), &KINDS));
    let label = cx
        .required(&f, "label")
        .and_then(|e| cx.string(&e.value, &f.path("label")));
    let description = cx.optional_string(&f, "description");
    let kind = kind?;
    let addresses = match f.get("addresses") {
        Some(e) => addresses(cx, e, &f.path("addresses"), kind),
        None => Some(Vec::new()),
    };
    let tool = match f.get("tool") {
        Some(e) => tool(cx, e, &f.path("tool"), kind),
        None => Some(None),
    };
    let parameters = match f.get("parameters") {
        Some(e) => parameters(cx, e, &f.path("parameters"), kind.slots()),
        None => Some(IndexMap::new()),
    };
    let defenses = match f.get("defenses") {
        Some(e) => defenses(cx, e, &f.path("defenses"), kind),
        None => Some(Defenses::default()),
    };
    let mut entity = Entity {
        kind,
        label: label?,
        description: description?,
        addresses: addresses?,
        tool: tool?,
        parameters: parameters?,
        defenses: defenses?,
    };
    entity.materialize();
    Some(entity)
}

/// A host's IP addresses or a network's CIDR ranges (nmap import spec §2.1).
fn addresses(cx: &mut Cx, entry: &Entry, path: &str, kind: EntityKind) -> Option<Vec<String>> {
    let cidr = match kind {
        EntityKind::Host => false,
        EntityKind::Network => true,
        _ => {
            let message = format!("`addresses` is not a field of a `{}`", kind.as_str());
            cx.error(Code::MisplacedKey, path, entry.key_pos, message);
            return None;
        }
    };
    let items = cx.list(&entry.value, path)?;
    let mut out = Vec::new();
    let mut ok = true;
    for (i, item) in items.iter().enumerate() {
        let at = format!("{path}[{i}]");
        let Some(text) = cx.string(item, &at) else {
            ok = false;
            continue;
        };
        let valid = if cidr {
            is_cidr(&text)
        } else {
            text.parse::<std::net::IpAddr>().is_ok()
        };
        if valid {
            out.push(text);
        } else {
            let want = if cidr {
                "a CIDR range such as 10.0.0.0/24"
            } else {
                "an IP address such as 10.0.0.5"
            };
            let message = format!("expected {want}, found {text:?}");
            cx.error(Code::WrongType, at, item.pos, message);
            ok = false;
        }
    }
    ok.then_some(out)
}

fn is_cidr(text: &str) -> bool {
    let Some((ip, bits)) = text.split_once('/') else {
        return false;
    };
    let Ok(ip) = ip.parse::<std::net::IpAddr>() else {
        return false;
    };
    let max = if ip.is_ipv4() { 32 } else { 128 };
    (1..=3).contains(&bits.len())
        && bits.bytes().all(|b| b.is_ascii_digit())
        && bits.parse::<u8>().is_ok_and(|b| b <= max)
}

/// Only an application names a tool.
fn tool(cx: &mut Cx, entry: &Entry, path: &str, kind: EntityKind) -> Option<Option<Tool>> {
    if kind != EntityKind::Application {
        let message = format!("`tool` is not a field of a `{}`", kind.as_str());
        cx.error(Code::MisplacedKey, path, entry.key_pos, message);
        return None;
    }
    cx.word(&entry.value, path, &TOOLS).map(Some)
}

/// The slots of one owner. What is written must be one of `allowed`; what is
/// not written is unknown.
fn parameters(
    cx: &mut Cx,
    entry: &Entry,
    path: &str,
    allowed: &[Slot],
) -> Option<IndexMap<Slot, Parameter>> {
    let names: Vec<&str> = allowed.iter().map(|s| s.as_str()).collect();
    let f = cx.fields(&entry.value, path, entry.key_pos, &names)?;
    let mut map = IndexMap::new();
    let mut ok = true;
    for e in &f.entries {
        let Some((_, slot)) = SLOTS.iter().find(|(w, _)| *w == e.key) else {
            continue;
        };
        match parameter(cx, e, &f.path(&e.key)) {
            Some(p) => {
                map.insert(*slot, p);
            }
            None => ok = false,
        }
    }
    ok.then_some(map)
}

fn parameter(cx: &mut Cx, entry: &Entry, path: &str) -> Option<Parameter> {
    let f = cx.fields(
        &entry.value,
        path,
        entry.key_pos,
        &["status", "ttc", "note"],
    )?;
    let status = cx
        .required(&f, "status")
        .and_then(|e| cx.word(&e.value, &f.path("status"), &EVIDENCE));
    let ttc = match f.get("ttc") {
        Some(e) => cx.expression(&e.value, &f.path("ttc")).map(Some),
        None => Some(None),
    };
    let note = cx.optional_string(&f, "note");
    Some(Parameter {
        status: status?,
        ttc: ttc?,
        note: note?,
    })
}

fn defenses(cx: &mut Cx, entry: &Entry, path: &str, kind: EntityKind) -> Option<Defenses> {
    let allowed: Vec<&str> = kind.defense().map(|d| d.as_str()).into_iter().collect();
    let f = cx.fields(&entry.value, path, entry.key_pos, &allowed)?;
    let mut defenses = Defenses::default();
    for (word, defense) in DEFENSES {
        if let Some(e) = f.get(word) {
            let value = cx.word(&e.value, &f.path(word), &SWITCHES)?;
            defenses.set(defense, Some(value));
        }
    }
    Some(defenses)
}

fn association(cx: &mut Cx, entry: &Entry, path: &str) -> Option<Association> {
    let f = cx.fields(
        &entry.value,
        path,
        entry.key_pos,
        &[
            "kind",
            "from",
            "to",
            "privilege",
            "allowed",
            "factor",
            "contained",
            "decrypts",
            "mode",
            "description",
        ],
    )?;
    let kind = cx
        .required(&f, "kind")
        .and_then(|e| cx.word(&e.value, &f.path("kind"), &RELATIONS));
    let description = cx.optional_string(&f, "description");
    let from = cx
        .required(&f, "from")
        .and_then(|e| cx.id_value(&e.value, &f.path("from")));
    let to = cx.required(&f, "to");
    let kind = kind?;

    // The fields the kind has, and the ones it does not.
    let mut misplaced = false;
    for key in EXTRAS {
        if !kind.fields().contains(&key)
            && let Some(e) = f.get(key)
        {
            let message = format!(
                "`{key}` is not a field of a `{}` association",
                kind.as_str()
            );
            cx.error(Code::MisplacedKey, f.path(key), e.key_pos, message);
            misplaced = true;
        }
    }
    let privilege = if kind.has_privilege() {
        cx.required(&f, "privilege")
            .and_then(|e| cx.word(&e.value, &f.path("privilege"), &PRIVILEGES))
    } else {
        None
    };
    let allowed = if kind == RelationKind::Permits {
        cx.required(&f, "allowed")
            .and_then(|e| cx.word(&e.value, &f.path("allowed"), &SWITCHES))
    } else {
        None
    };
    // Absent is a first factor; canonical text writes only a second.
    let factor = match f.get("factor") {
        Some(e) if kind == RelationKind::Authenticates => {
            cx.word(&e.value, &f.path("factor"), &FACTORS)
        }
        _ => Some(Factor::First),
    };
    // Absent is not contained; canonical text writes only `true`. The
    // validator decides whether the hosted kind is software.
    let contained = match f.get("contained") {
        Some(e) if kind == RelationKind::Hosts => cx.word(&e.value, &f.path("contained"), &BOOLS),
        _ => Some(false),
    };
    // Unsaid is `incomplete`, which the validator reports.
    let decrypts = match f.get("decrypts") {
        Some(e) if kind == RelationKind::Holds => {
            cx.word(&e.value, &f.path("decrypts"), &BOOLS).map(Some)
        }
        _ => Some(None),
    };
    let mode = if kind == RelationKind::Accesses {
        cx.required(&f, "mode")
            .and_then(|e| cx.word(&e.value, &f.path("mode"), &MODES))
    } else {
        None
    };
    let relation = match kind {
        RelationKind::Permits => Relation::Permits {
            from: from?,
            to: cx.id_value(&to?.value, &f.path("to"))?,
            allowed: allowed?,
        },
        _ => {
            let from = from?;
            let to = cx.id_value(&to?.value, &f.path("to"))?;
            match kind {
                RelationKind::Attached => Relation::Attached { from, to },
                RelationKind::Hosts => Relation::Hosts {
                    from,
                    to,
                    privilege: privilege?,
                    contained: contained?,
                },
                RelationKind::Filters => Relation::Filters { from, to },
                RelationKind::Stores => Relation::Stores {
                    from,
                    to,
                    privilege: privilege?,
                },
                RelationKind::Authenticates => Relation::Authenticates {
                    from,
                    to,
                    factor: factor?,
                },
                RelationKind::Authorizes => Relation::Authorizes { from, to },
                RelationKind::Grants => Relation::Grants {
                    from,
                    to,
                    privilege: privilege?,
                },
                RelationKind::Administration => Relation::Administration { from, to },
                RelationKind::InstanceOf => Relation::InstanceOf { from, to },
                RelationKind::RunsAs => Relation::RunsAs {
                    from,
                    to,
                    privilege: privilege?,
                },
                RelationKind::Assumes => Relation::Assumes { from, to },
                RelationKind::Knows => Relation::Knows { from, to },
                RelationKind::Operates => Relation::Operates { from, to },
                RelationKind::Delivers => Relation::Delivers { from, to },
                RelationKind::Holds => Relation::Holds {
                    from,
                    to,
                    privilege: privilege?,
                    decrypts: decrypts?,
                },
                RelationKind::Accesses => Relation::Accesses {
                    from,
                    to,
                    mode: mode?,
                },
                RelationKind::EncryptedWith => Relation::EncryptedWith { from, to },
                RelationKind::Reads => Relation::Reads { from, to },
                RelationKind::Permits => unreachable!("handled above"),
            }
        }
    };
    (!misplaced).then_some(Association {
        relation,
        description: description?,
    })
}

fn flow(cx: &mut Cx, entry: &Entry, path: &str) -> Option<Flow> {
    let f = cx.fields(
        &entry.value,
        path,
        entry.key_pos,
        &[
            "label",
            "source",
            "target",
            "route",
            "protocol",
            "parameters",
        ],
    )?;
    let label = cx
        .required(&f, "label")
        .and_then(|e| cx.string(&e.value, &f.path("label")));
    let source = cx
        .required(&f, "source")
        .and_then(|e| cx.id_value(&e.value, &f.path("source")));
    let target = cx
        .required(&f, "target")
        .and_then(|e| cx.id_value(&e.value, &f.path("target")));
    let route = cx.required(&f, "route").and_then(|e| {
        let path = f.path("route");
        let items = cx.list(&e.value, &path)?;
        let ids: Vec<_> = items
            .iter()
            .enumerate()
            .map(|(i, item)| cx.id_value(item, &format!("{path}[{i}]")))
            .collect();
        ids.into_iter().collect::<Option<Vec<_>>>()
    });
    let protocol = cx.optional_string(&f, "protocol");
    let connect = match f.get("parameters") {
        Some(e) => parameters(cx, e, &f.path("parameters"), &[Slot::Connect])
            .map(|mut p| p.shift_remove(&Slot::Connect).unwrap_or_default()),
        None => Some(Parameter::unknown()),
    };
    Some(Flow {
        label: label?,
        source: source?,
        target: target?,
        route: route?,
        protocol: protocol?,
        connect: connect?,
    })
}

fn state_ref(cx: &mut Cx, node: &Node, path: &str, at: Pos) -> Option<StateRef> {
    let f = cx.fields(node, path, at, &["entity", "state"])?;
    let entity = cx
        .required(&f, "entity")
        .and_then(|e| cx.id_value(&e.value, &f.path("entity")));
    let state = cx
        .required(&f, "state")
        .and_then(|e| cx.word(&e.value, &f.path("state"), &STATES));
    Some(StateRef {
        entity: entity?,
        state: state?,
    })
}

fn attacker(cx: &mut Cx, entry: &Entry) -> Option<Attacker> {
    let f = cx.fields(
        &entry.value,
        "attacker",
        entry.key_pos,
        &["footholds", "target"],
    )?;
    let footholds = match f.get("footholds") {
        None => Some(vec![]),
        Some(e) => {
            let path = f.path("footholds");
            cx.list(&e.value, &path).and_then(|items| {
                let all: Vec<_> = items
                    .iter()
                    .enumerate()
                    .map(|(i, item)| state_ref(cx, item, &format!("{path}[{i}]"), item.pos))
                    .collect();
                all.into_iter().collect::<Option<Vec<_>>>()
            })
        }
    };
    let target = match f.get("target") {
        None => Some(None),
        Some(e) => state_ref(cx, &e.value, &f.path("target"), e.key_pos).map(Some),
    };
    Some(Attacker {
        footholds: footholds?,
        target: target?,
    })
}

fn scenario(cx: &mut Cx, entry: &Entry, path: &str) -> Option<Scenario> {
    let f = cx.fields(
        &entry.value,
        path,
        entry.key_pos,
        &["label", "attacker", "changes"],
    )?;
    let label = cx
        .required(&f, "label")
        .and_then(|e| cx.string(&e.value, &f.path("label")));
    let attacker = match f.get("attacker") {
        None => Some(None),
        Some(e) => attacker_profile(cx, &e.value, &f.path("attacker"), e.key_pos).map(Some),
    };
    let changes = match f.get("changes") {
        None => Some(vec![]),
        Some(e) => {
            let path = f.path("changes");
            cx.list(&e.value, &path).and_then(|items| {
                let all: Vec<_> = items
                    .iter()
                    .enumerate()
                    .map(|(i, item)| change(cx, item, &format!("{path}[{i}]")))
                    .collect();
                all.into_iter().collect::<Option<Vec<_>>>()
            })
        }
    };
    Some(Scenario {
        label: label?,
        attacker: attacker?,
        changes: changes?,
    })
}

/// `{speed: n}`; whether n is a usable speed is the validator's to say.
fn attacker_profile(cx: &mut Cx, node: &Node, path: &str, pos: Pos) -> Option<AttackerProfile> {
    let f = cx.fields(node, path, pos, &["speed"])?;
    let speed = cx
        .required(&f, "speed")
        .and_then(|e| cx.number(&e.value, &f.path("speed")))?;
    Some(AttackerProfile { speed })
}

/// `{entity, defense, value}` or `{association, field: allowed, value}`.
fn change(cx: &mut Cx, node: &Node, path: &str) -> Option<Change> {
    let f = cx.fields(
        node,
        path,
        node.pos,
        &["entity", "defense", "association", "field", "value"],
    )?;
    let value = cx
        .required(&f, "value")
        .and_then(|e| cx.word(&e.value, &f.path("value"), &SWITCHES));
    match (f.get("entity"), f.get("association")) {
        (Some(_), Some(association)) => {
            let message =
                "a change is to an entity's defence or to an association's permission, not both";
            cx.error(
                Code::MisplacedKey,
                f.path("association"),
                association.key_pos,
                message,
            );
            None
        }
        (None, None) => {
            let message = "a change names an `entity` or an `association`";
            cx.error(Code::MissingKey, path, node.pos, message);
            None
        }
        (Some(entity), None) => {
            let mut misplaced = false;
            if let Some(e) = f.get("field") {
                let message = "`field` belongs to a change of an association; an entity change names its `defense`";
                cx.error(Code::MisplacedKey, f.path("field"), e.key_pos, message);
                misplaced = true;
            }
            let entity = cx.id_value(&entity.value, &f.path("entity"));
            let defense = cx
                .required(&f, "defense")
                .and_then(|e| cx.word(&e.value, &f.path("defense"), &DEFENSES));
            (!misplaced).then_some(Change::EntityDefense {
                entity: entity?,
                defense: defense?,
                value: value?,
            })
        }
        (None, Some(association)) => {
            let mut misplaced = false;
            if let Some(e) = f.get("defense") {
                let message = "`defense` belongs to a change of an entity; an association change sets `field: allowed`";
                cx.error(Code::MisplacedKey, f.path("defense"), e.key_pos, message);
                misplaced = true;
            }
            let association = cx.id_value(&association.value, &f.path("association"));
            let field = cx
                .required(&f, "field")
                .and_then(|e| cx.word(&e.value, &f.path("field"), &[("allowed", ())]));
            (!misplaced).then_some(Change::Permission {
                association: association?,
                value: field.and(value)?,
            })
        }
    }
}

/// The keys only an architecture has: what version 1, which had no
/// architecture profile, may not contain.
pub const ONLY_KEYS: [&str; 6] = [
    "library",
    "entities",
    "associations",
    "flows",
    "attacker",
    "scenarios",
];
