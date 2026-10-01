//! From an architecture to its potential attack graph, rule by rule, in the
//! order the catalog lists them. The graph is generated regardless of defence
//! switches and permission values — those are resolved afterwards — so a
//! blocked route stays in the graph with its reason, and every scenario of one
//! architecture shares one graph and one set of sampling slots.
//!
//! Matching goes through indices built once (hosting by executable, firewall
//! by router, grants by machine), never through a product of every entity with
//! every other. Nodes are counted as they are inserted, and generation stops at
//! the limit with no graph at all: a partial graph could be mistaken for
//! complete coverage.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use effractor_core::architecture::{
    Architecture, Change, Defense, EntityKind, Factor, Mode, Privilege, Relation, Slot, State,
    Switch,
};
use effractor_core::{
    AssociationId, Code, Diagnostic, EntityId, FlowId, Severity, validate_architecture,
};

use crate::catalog::{MAX_GENERATED_DEPENDENCIES, MAX_GENERATED_NODES, RULES, state_word};
use crate::graph::{
    Binding, GeneratedGraph, GeneratedKind, GeneratedNode, Origin, Owner, SEMANTICS,
};

/// The potential attack graph of a valid, complete architecture. Errors and
/// `incomplete` diagnostics are returned instead: what is not said is never
/// generated as a permissive default. An `unfinished` flow — a route still
/// being drawn — is generated with its connection unknown.
pub fn generate(model: &Architecture) -> Result<GeneratedGraph, Vec<Diagnostic>> {
    generate_within(model, MAX_GENERATED_NODES, MAX_GENERATED_DEPENDENCIES)
}

fn generate_within(
    model: &Architecture,
    max_nodes: usize,
    max_dependencies: usize,
) -> Result<GeneratedGraph, Vec<Diagnostic>> {
    let diagnostics = validate_architecture(model);
    let blocking: Vec<Diagnostic> = diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error || d.code == Code::Incomplete)
        .cloned()
        .collect();
    if !blocking.is_empty() {
        return Err(blocking);
    }
    // flow → the route paths still to be drawn
    let mut unfinished: HashMap<&FlowId, Vec<String>> = HashMap::new();
    for d in diagnostics.iter().filter(|d| d.code == Code::Unfinished) {
        let flow = d
            .path
            .strip_prefix("flows.")
            .and_then(|rest| rest.split_once(".route"))
            .and_then(|(fid, _)| model.flows.keys().find(|k| k.as_str() == fid));
        let Some(flow) = flow else {
            unreachable!("only a flow's route is unfinished: {}", d.path);
        };
        unfinished.entry(flow).or_default().push(d.path.clone());
    }
    let Some(target) = &model.attacker.target else {
        unreachable!("validation reports a missing target as incomplete");
    };
    let mut b = Builder::new(model, max_nodes, max_dependencies);
    b.unfinished = unfinished;
    b.states();
    b.footholds();
    b.admin_implies_user();
    b.hosting();
    b.zone_access();
    b.permissions();
    b.flows();
    b.operators();
    b.guards();
    b.escalations();
    b.host_access();
    b.denials();
    b.held();
    b.products();
    b.services();
    b.instances();
    b.credentials();
    b.accounts();
    b.identities();
    b.logins();
    b.administration();
    b.data();
    if let Some(d) = b.overflow.take() {
        return Err(vec![d]);
    }
    let target_id = b.state_id(&target.entity, target.state.as_str());
    Ok(b.finish(&target_id))
}

enum DraftKind {
    Input(Binding),
    Any,
    All(Binding),
}

struct Draft {
    label: String,
    kind: DraftKind,
    inputs: BTreeSet<String>,
    origins: Vec<Origin>,
}

/// A sensor on a flow's route: (router, sensor, watches association).
type Watch<'a> = (&'a EntityId, &'a EntityId, &'a AssociationId);

/// A grant on a machine, named directly or through its access control.
#[derive(Clone, Copy)]
struct Grant<'a> {
    privilege: Privilege,
    grants: &'a AssociationId,
    /// The access control and its `controls-access`, when the grant names it.
    via: Option<(&'a EntityId, &'a AssociationId)>,
}

impl Grant<'_> {
    fn associations(&self) -> Vec<AssociationId> {
        let mut out = vec![self.grants.clone()];
        out.extend(self.via.map(|(_, a)| a.clone()));
        out
    }
    fn entities(&self) -> Vec<EntityId> {
        self.via.map(|(e, _)| e.clone()).into_iter().collect()
    }
}

struct Builder<'a> {
    m: &'a Architecture,
    nodes: BTreeMap<String, Draft>,
    dependencies: usize,
    max_nodes: usize,
    max_dependencies: usize,
    overflow: Option<Diagnostic>,
    /// executable → (machine, privilege, hosts association)
    host_of: HashMap<&'a EntityId, (&'a EntityId, Privilege, &'a AssociationId)>,
    /// firewall → (router, filters association)
    router_of: HashMap<&'a EntityId, (&'a EntityId, &'a AssociationId)>,
    /// router → firewall
    firewall_of: HashMap<&'a EntityId, &'a EntityId>,
    /// (firewall, flow) → permits association
    permit: HashMap<(&'a EntityId, &'a FlowId), &'a AssociationId>,
    /// (account, machine) → the grant; the first way of saying it counts
    grant: HashMap<(&'a EntityId, &'a EntityId), Grant<'a>>,
    /// machine → [(account, grant)], in document order
    grants_on: HashMap<&'a EntityId, Vec<(&'a EntityId, Grant<'a>)>>,
    /// service → (product, instance-of association)
    product_of: HashMap<&'a EntityId, (&'a EntityId, &'a AssociationId)>,
    /// flow source → its flows, in document order
    flows_from: HashMap<&'a EntityId, Vec<&'a FlowId>>,
    /// flow → the route paths the validator marked `unfinished`
    unfinished: HashMap<&'a FlowId, Vec<String>>,
    /// Software that processes content: what a `delivers` or `reads` names.
    readers: BTreeSet<&'a EntityId>,
    /// (holder, data) → (decrypts, holds association)
    holdings: HashMap<(&'a EntityId, &'a EntityId), (bool, &'a AssociationId)>,
    /// account → [(service, authorizes association)], in document order
    authorized: HashMap<&'a EntityId, Vec<(&'a EntityId, &'a AssociationId)>>,
    /// machine → [(sensor, watches association)], in document order
    sensors_on: HashMap<&'a EntityId, Vec<(&'a EntityId, &'a AssociationId)>>,
    /// host → the facts an exploit used there or on its services needs
    /// first: each of its sensors got past, its anti-malware got past
    host_guards: HashMap<&'a EntityId, Vec<String>>,
    /// Services some watched flow reaches: their exploit reads `unseen`.
    unseen: BTreeSet<&'a EntityId>,
}

impl<'a> Builder<'a> {
    fn new(m: &'a Architecture, max_nodes: usize, max_dependencies: usize) -> Self {
        let mut b = Self {
            m,
            nodes: BTreeMap::new(),
            dependencies: 0,
            max_nodes,
            max_dependencies,
            overflow: None,
            host_of: HashMap::new(),
            router_of: HashMap::new(),
            firewall_of: HashMap::new(),
            permit: HashMap::new(),
            grant: HashMap::new(),
            grants_on: HashMap::new(),
            product_of: HashMap::new(),
            flows_from: HashMap::new(),
            unfinished: HashMap::new(),
            readers: BTreeSet::new(),
            holdings: HashMap::new(),
            authorized: HashMap::new(),
            sensors_on: HashMap::new(),
            host_guards: HashMap::new(),
            unseen: BTreeSet::new(),
        };
        for (fid, flow) in &m.flows {
            b.flows_from.entry(&flow.source).or_default().push(fid);
        }
        // An access control's machine, so a grant on it lands on the machine.
        let mut machine_of_access: HashMap<&EntityId, (&EntityId, &AssociationId)> = HashMap::new();
        for (id, a) in &m.associations {
            if let Relation::ControlsAccess { from, to } = &a.relation {
                machine_of_access.entry(to).or_insert((from, id));
            }
        }
        for (id, a) in &m.associations {
            match &a.relation {
                Relation::Hosts {
                    from,
                    to,
                    privilege,
                    ..
                } => {
                    b.host_of.insert(to, (from, *privilege, id));
                }
                Relation::InstanceOf { from, to } => {
                    b.product_of.insert(from, (to, id));
                }
                Relation::Delivers { to, .. } if m.entities[to].kind.is_executable() => {
                    b.readers.insert(to);
                }
                Relation::Reads { from, .. } => {
                    b.readers.insert(from);
                }
                // An unsaid `decrypts` is incomplete and never generated.
                Relation::Holds {
                    from, to, decrypts, ..
                } => {
                    b.holdings.insert((from, to), (*decrypts == Some(true), id));
                }
                Relation::Authorizes { from, to } => {
                    b.authorized.entry(from).or_default().push((to, id));
                }
                Relation::Watches { from, to } => {
                    b.sensors_on.entry(from).or_default().push((to, id));
                }
                Relation::Filters { from, to } => {
                    b.router_of.insert(to, (from, id));
                    b.firewall_of.insert(from, to);
                }
                Relation::Permits { from, to, .. } => {
                    b.permit.insert((from, to), id);
                }
                Relation::Grants {
                    from,
                    to,
                    privilege,
                } => {
                    let (machine, via) = match machine_of_access.get(to) {
                        Some(&(machine, controls)) => (machine, Some((to, controls))),
                        None => (to, None),
                    };
                    let grant = Grant {
                        privilege: *privilege,
                        grants: id,
                        via,
                    };
                    if let std::collections::hash_map::Entry::Vacant(e) =
                        b.grant.entry((from, machine))
                    {
                        e.insert(grant);
                        b.grants_on.entry(machine).or_default().push((from, grant));
                    }
                }
                _ => {}
            }
        }
        b
    }

    /// Whether `entity` has `slot` to draw a step from: a required slot always
    /// (unknown when unsaid), an optional one only once the file gives it.
    fn has_slot(&self, entity: &EntityId, slot: Slot) -> bool {
        let e = &self.m.entities[entity];
        !slot.optional(e.kind) || e.parameters.contains_key(&slot)
    }

    /// How long using an exploit on `owner` takes: its `deploy-exploit`, or
    /// — where `host` says ASLR or DEP — the replacement that switch selects.
    /// A host that says neither keeps the plain binding, so existing files
    /// generate exactly as before. Returns the binding and the paths it reads.
    fn deploy_binding(&self, owner: &EntityId, host: Option<&EntityId>) -> (Binding, Vec<String>) {
        let o = Owner::Entity(owner.clone());
        // Said in the file, or switched by a scenario: either can select a
        // replacement, so then the step reads the host's switches.
        let said = host.filter(|h| {
            let e = &self.m.entities[*h];
            let switched = self.m.scenarios.values().any(|s| {
                s.changes.iter().any(|c| {
                    matches!(c, Change::EntityDefense { entity, defense: Defense::Aslr | Defense::Dep, .. } if entity == *h)
                })
            });
            e.kind == EntityKind::Host
                && (switched
                    || e.defenses.get(Defense::Aslr).is_some()
                    || e.defenses.get(Defense::Dep).is_some())
        });
        match said {
            None => (
                Binding::Parameter {
                    owner: o.clone(),
                    base: Slot::DeployExploit,
                    replacement: None,
                },
                vec![o.slot_path(Slot::DeployExploit)],
            ),
            Some(host) => (
                Binding::Hardened {
                    owner: o.clone(),
                    base: Slot::DeployExploit,
                    host: host.clone(),
                },
                vec![
                    o.slot_path(Slot::DeployExploit),
                    o.slot_path(Slot::DeployExploitAslr),
                    o.slot_path(Slot::DeployExploitDep),
                    format!("entities.{host}.defenses.aslr"),
                    format!("entities.{host}.defenses.dep"),
                ],
            ),
        }
    }

    /// `host.reachable` from each service the host runs (rule
    /// `host-reachable`); false, and no fact, for a host that runs none.
    fn host_reachable(&mut self, host: &'a EntityId) -> bool {
        let served: Vec<(&'a EntityId, &'a AssociationId)> = self
            .m
            .associations
            .iter()
            .filter_map(|(aid, a)| match &a.relation {
                Relation::Hosts { from, to, .. }
                    if from == host && self.kind(to) == EntityKind::Service =>
                {
                    Some((to, aid))
                }
                _ => None,
            })
            .collect();
        if served.is_empty() {
            return false;
        }
        let reachable = self.state_id(host, "reachable");
        self.fact(
            reachable.clone(),
            format!("Reachable · {}", self.label(host)),
        );
        for (sid, hosts) in served {
            let o = Origin {
                entities: vec![sid.clone(), host.clone()],
                associations: vec![hosts.clone()],
                ..origin("host-reachable")
            };
            let service_reachable = self.state_id(sid, "reachable");
            self.produce(&service_reachable, &reachable, o);
        }
        true
    }

    /// Whether a host's anti-malware is said: in the file (the switch or its
    /// time) or by a scenario. Absent everywhere, it is off and not drawn.
    fn antimalware_said(&self, host: &EntityId) -> bool {
        let e = &self.m.entities[host];
        e.defenses.get(Defense::AntiMalware).is_some()
            || e.parameters.contains_key(&Slot::BypassAntimalware)
            || self.m.scenarios.values().any(|s| {
                s.changes.iter().any(|c| {
                    matches!(c, Change::EntityDefense { entity, defense: Defense::AntiMalware, .. } if entity == host)
                })
            })
    }

    /// Whether a host's firewall is said: in the file or by a scenario.
    fn host_firewall_said(&self, host: &EntityId) -> bool {
        self.m.entities[host]
            .defenses
            .get(Defense::HostFirewall)
            .is_some()
            || self.m.scenarios.values().any(|s| {
                s.changes.iter().any(|c| {
                    matches!(c, Change::EntityDefense { entity, defense: Defense::HostFirewall, .. } if entity == host)
                })
            })
    }

    fn kind(&self, id: &EntityId) -> EntityKind {
        self.m.entities[id].kind
    }

    fn label(&self, id: &EntityId) -> &'a str {
        &self.m.entities[id].label
    }

    /// `state/<kind>/<entity>/<state>`.
    fn state_id(&self, entity: &EntityId, state: &str) -> String {
        format!("state/{}/{entity}/{state}", self.kind(entity).as_str())
    }

    /// A machine at a privilege: a router has only `admin`.
    fn machine_id(&self, machine: &EntityId, privilege: Privilege) -> String {
        let privilege = match self.kind(machine) {
            EntityKind::Router => Privilege::Admin,
            _ => privilege,
        };
        self.state_id(machine, privilege.as_str())
    }

    /// The fact that a machine's user-level capabilities rest on: a host's
    /// `user` (which its `admin` implies), a router's `admin`.
    fn machine_user_id(&self, machine: &EntityId) -> String {
        self.machine_id(machine, Privilege::User)
    }

    fn full(&self) -> bool {
        self.overflow.is_some()
    }

    fn insert(&mut self, id: String, label: String, kind: DraftKind) {
        if self.full() || self.nodes.contains_key(&id) {
            return;
        }
        if self.nodes.len() >= self.max_nodes {
            self.overflow = Some(Diagnostic::error(
                Code::Limit,
                "",
                format!(
                    "the generated graph would have more than {} steps",
                    self.max_nodes
                ),
            ));
            return;
        }
        self.nodes.insert(
            id,
            Draft {
                label,
                kind,
                inputs: BTreeSet::new(),
                origins: Vec::new(),
            },
        );
    }

    fn fact(&mut self, id: String, label: String) {
        self.insert(id, label, DraftKind::Any);
    }

    fn originate(&mut self, id: &str, origin: Origin) {
        if let Some(d) = self.nodes.get_mut(id)
            && !d.origins.contains(&origin)
        {
            d.origins.push(origin);
        }
    }

    /// `from` is a prerequisite of `to`.
    fn edge(&mut self, from: &str, to: &str) {
        if self.full() {
            return;
        }
        debug_assert!(self.nodes.contains_key(from), "{from} is not a node");
        let Some(d) = self.nodes.get_mut(to) else {
            return;
        };
        if d.inputs.contains(from) {
            return;
        }
        if self.dependencies >= self.max_dependencies {
            self.overflow = Some(Diagnostic::error(
                Code::Limit,
                "",
                format!(
                    "the generated graph would have more than {} dependencies",
                    self.max_dependencies
                ),
            ));
            return;
        }
        d.inputs.insert(from.to_owned());
        self.dependencies += 1;
    }

    /// A logical rule: `from` produces the fact `to`.
    fn produce(&mut self, from: &str, to: &str, origin: Origin) {
        self.edge(from, to);
        self.originate(to, origin);
    }

    /// An action with its prerequisites and its one output fact.
    fn action(
        &mut self,
        id: String,
        label: String,
        binding: Binding,
        prerequisites: &[String],
        output: &str,
        origin: Origin,
    ) {
        self.insert(id.clone(), label, DraftKind::All(binding));
        for p in prerequisites {
            self.edge(p, &id);
        }
        let produced = Origin {
            paths: Vec::new(),
            ..origin.clone()
        };
        self.originate(&id, origin);
        self.produce(&id, output, produced);
    }

    /// Every state an entity kind declares, whether anything reaches it or
    /// not: a fact nothing produces is shown as unreachable, not left out.
    fn states(&mut self) {
        for (id, entity) in &self.m.entities {
            for state in entity.kind.states() {
                // An optional state only where the attacker names it; the
                // step that produces it draws it otherwise.
                if state.optional(entity.kind) && !self.named(id, *state) {
                    continue;
                }
                let fid = self.state_id(id, state.as_str());
                self.fact(fid, format!("{} · {}", entity.label, state_word(*state)));
            }
            // Content reaching software is generated, as `reachable` is.
            if self.readers.contains(id) {
                let fid = self.state_id(id, State::Contacted.as_str());
                let word = state_word(State::Contacted);
                self.fact(fid, format!("{} · {word}", entity.label));
            }
            match entity.kind {
                EntityKind::Service => {
                    let fid = self.state_id(id, "reachable");
                    self.fact(fid, format!("{} · reachable", entity.label));
                }
                EntityKind::Product => {
                    for (state, word) in [
                        ("reachable", "reachable"),
                        ("exploit-ready", "exploit ready"),
                    ] {
                        let fid = self.state_id(id, state);
                        self.fact(fid, format!("{} · {word}", entity.label));
                    }
                }
                EntityKind::Data => {
                    let fid = self.state_id(id, "plaintext");
                    self.fact(fid, format!("{} · in plaintext", entity.label));
                }
                EntityKind::Account => {
                    for (state, word) in [
                        ("material", "credential held"),
                        ("mfa-satisfied", "second factor no obstacle"),
                        ("authenticated", "can log in"),
                    ] {
                        let fid = self.state_id(id, state);
                        self.fact(fid, format!("{} · {word}", entity.label));
                    }
                }
                _ => {}
            }
        }
    }

    fn footholds(&mut self) {
        for (i, f) in self.m.attacker.footholds.iter().enumerate() {
            let id = format!("input/foothold/{}/{}", f.entity, f.state.as_str());
            let label = format!(
                "Foothold · {} · {}",
                self.label(&f.entity),
                state_word(f.state)
            );
            self.insert(
                id.clone(),
                label,
                DraftKind::Input(Binding::Foothold(f.clone())),
            );
            let o = Origin {
                entities: vec![f.entity.clone()],
                paths: vec![format!("attacker.footholds[{i}]")],
                ..origin("foothold")
            };
            self.originate(&id, o.clone());
            let fact = self.state_id(&f.entity, f.state.as_str());
            self.produce(&id, &fact, o);
        }
    }

    fn admin_implies_user(&mut self) {
        for (id, entity) in &self.m.entities {
            if entity.kind == EntityKind::Host {
                let o = Origin {
                    entities: vec![id.clone()],
                    ..origin("admin-implies-user")
                };
                let admin = self.state_id(id, State::Admin.as_str());
                let user = self.state_id(id, State::User.as_str());
                self.produce(&admin, &user, o);
            }
        }
    }

    fn hosting(&mut self) {
        for (aid, a) in &self.m.associations {
            let Relation::Hosts {
                from,
                to,
                privilege,
                contained,
            } = &a.relation
            else {
                continue;
            };
            let machine = match privilege {
                // Only software may say it (the validator); never a node.
                Privilege::Unknown => String::new(),
                known => self.machine_id(from, *known),
            };
            let bound = |rule| Origin {
                entities: vec![from.clone(), to.clone()],
                associations: vec![aid.clone()],
                ..origin(rule)
            };
            match self.kind(to) {
                // A router on a host: the box controls it; leaving it is an escape.
                EntityKind::Router => {
                    let admin = self.state_id(to, State::Admin.as_str());
                    self.produce(&machine, &admin, bound("hosted-router"));
                    self.escape("router-escape", to, from, *privilege, aid);
                }
                // A guest on its host: the same, as the guest's admin.
                EntityKind::Host => {
                    let admin = self.state_id(to, State::Admin.as_str());
                    self.produce(&machine, &admin, bound("hosted-host"));
                    self.escape("guest-escape", to, from, *privilege, aid);
                }
                // Software whose privilege is unknown: admin on the host runs
                // it and it is at least user there, for certain; user to it
                // and it to admin hold only at one privilege each, so they
                // are steps of unknown time, pointing at the link.
                _ if *privilege == Privilege::Unknown => {
                    let control = self.state_id(to, State::Control.as_str());
                    let user = self.machine_id(from, Privilege::User);
                    let admin = self.machine_id(from, Privilege::Admin);
                    let path = format!("associations.{aid}.privilege");
                    let unknown = |rule| Origin {
                        paths: vec![path.clone()],
                        ..bound(rule)
                    };
                    self.produce(&admin, &control, bound("host-execution"));
                    self.action(
                        format!("action/host-execution/{from}/{to}"),
                        format!("Runs as user? · {} on {}", self.label(to), self.label(from)),
                        Binding::UnknownPrivilege(aid.clone()),
                        std::slice::from_ref(&user),
                        &control,
                        unknown("host-execution"),
                    );
                    if !*contained {
                        self.produce(&control, &user, bound("execution-privilege"));
                        self.action(
                            format!("action/execution-privilege/{to}/{from}"),
                            format!(
                                "Runs as admin? · {} on {}",
                                self.label(to),
                                self.label(from)
                            ),
                            Binding::UnknownPrivilege(aid.clone()),
                            std::slice::from_ref(&control),
                            &admin,
                            unknown("execution-privilege"),
                        );
                    }
                }
                // Software; contained software does not reach its machine.
                _ => {
                    let control = self.state_id(to, State::Control.as_str());
                    self.produce(&machine, &control, bound("host-execution"));
                    if !*contained {
                        self.produce(&control, &machine, bound("execution-privilege"));
                    }
                }
            }
        }
    }

    /// Out of a guest or a hosted router to its host, as the host's privilege.
    fn escape(
        &mut self,
        rule: &str,
        guest: &'a EntityId,
        host: &'a EntityId,
        privilege: Privilege,
        hosts: &'a AssociationId,
    ) {
        let owner = Owner::Entity(guest.clone());
        // The step is the guest's: its escape time, last as an action's object.
        let o = Origin {
            entities: vec![host.clone(), guest.clone()],
            associations: vec![hosts.clone()],
            paths: vec![owner.slot_path(Slot::Escape)],
            ..origin(rule)
        };
        let admin = self.state_id(guest, State::Admin.as_str());
        let machine = self.machine_id(host, privilege);
        self.action(
            format!("action/{rule}/{guest}"),
            format!("Escape · {} to {}", self.label(guest), self.label(host)),
            Binding::Parameter {
                owner,
                base: Slot::Escape,
                replacement: None,
            },
            &[admin],
            &machine,
            o,
        );
    }

    fn zone_access(&mut self) {
        for (aid, a) in &self.m.associations {
            let Relation::Attached { from, to } = &a.relation else {
                continue;
            };
            let machine = self.machine_user_id(from);
            let access = self.state_id(to, State::Access.as_str());
            let o = Origin {
                entities: vec![from.clone(), to.clone()],
                associations: vec![aid.clone()],
                ..origin("zone-access")
            };
            self.produce(&machine, &access, o);
        }
    }

    fn permission_id(firewall: &EntityId, flow: &FlowId) -> String {
        format!("state/permission/{firewall}/{flow}")
    }

    fn permissions(&mut self) {
        for (aid, a) in &self.m.associations {
            let Relation::Permits { from, to, .. } = &a.relation else {
                continue;
            };
            let flow = &self.m.flows[to];
            let firewall = self.label(from);
            let input = format!("input/flow-permission/{from}/{to}");
            let fact = Self::permission_id(from, to);
            self.insert(
                input.clone(),
                format!("Firewall rule · {firewall} · {}", flow.label),
                DraftKind::Input(Binding::Permission(aid.clone())),
            );
            self.fact(
                fact.clone(),
                format!("Let through · {firewall} · {}", flow.label),
            );
            let policy = Origin {
                entities: vec![from.clone()],
                associations: vec![aid.clone()],
                flows: vec![to.clone()],
                paths: vec![format!("associations.{aid}.allowed")],
                ..origin("flow-permission")
            };
            self.originate(&input, policy.clone());
            self.produce(&input, &fact, policy);
            if let Some(&(router, filters)) = self.router_of.get(from) {
                let bypass = Origin {
                    entities: vec![router.clone(), from.clone()],
                    associations: vec![filters.clone(), aid.clone()],
                    flows: vec![to.clone()],
                    ..origin("flow-permission")
                };
                let admin = self.state_id(router, State::Admin.as_str());
                self.produce(&admin, &fact, bypass);
            }
        }
    }

    fn flows(&mut self) {
        for (fid, flow) in &self.m.flows {
            let mut prerequisites = vec![self.state_id(&flow.source, State::Control.as_str())];
            let mut entities = vec![flow.source.clone(), flow.target.clone()];
            let mut associations = Vec::new();
            // A router with no firewall lets the flow through. An unfinished
            // route may cross one with no permission yet: that hop is part
            // of what is unknown.
            for router in flow.route.iter().skip(1).step_by(2) {
                let Some(&firewall) = self.firewall_of.get(router) else {
                    continue;
                };
                let Some(&permit) = self.permit.get(&(firewall, fid)) else {
                    continue;
                };
                prerequisites.push(Self::permission_id(firewall, fid));
                entities.extend([router.clone(), firewall.clone()]);
                associations.push(permit.clone());
            }
            // The target's host, last: its firewall's permission where its
            // host firewall is said, in the file or a scenario, or it permits.
            if let Some(&(host, _, _)) = self.host_of.get(&flow.target)
                && self.kind(host) == EntityKind::Host
                && (self.host_firewall_said(host) || self.permit.contains_key(&(host, fid)))
                // Said on or unsaid in the file with no permission: the flow
                // is unfinished (validator), its connection unknown, as at a
                // router's firewall — not denied.
                && (self.permit.contains_key(&(host, fid))
                    || !matches!(
                        self.m.entities[host].defenses.get(Defense::HostFirewall),
                        Some(Switch::On | Switch::Unknown)
                    ))
            {
                let fact = Self::permission_id(host, fid);
                self.fact(
                    fact.clone(),
                    format!("Let through · {} · {}", self.label(host), flow.label),
                );
                let input = format!("input/host-firewall-off/{host}");
                let policy = Origin {
                    entities: vec![host.clone()],
                    paths: vec![format!("entities.{host}.defenses.host-firewall")],
                    ..origin("host-firewall-off")
                };
                self.insert(
                    input.clone(),
                    format!("Host firewall off · {}", self.label(host)),
                    DraftKind::Input(Binding::Policy {
                        entity: host.clone(),
                        defense: Defense::HostFirewall,
                    }),
                );
                self.originate(&input, policy.clone());
                self.produce(
                    &input,
                    &fact,
                    Origin {
                        flows: vec![fid.clone()],
                        ..policy
                    },
                );
                prerequisites.push(fact);
                entities.push(host.clone());
                if let Some(&permit) = self.permit.get(&(host, fid)) {
                    associations.push(permit.clone());
                }
            }
            let owner = Owner::Flow(fid.clone());
            let duration = match self.unfinished.get(fid) {
                Some(missing) => Binding::Unfinished {
                    flow: fid.clone(),
                    missing: missing.clone(),
                },
                None => Binding::Parameter {
                    owner: owner.clone(),
                    base: Slot::Connect,
                    replacement: None,
                },
            };
            let o = Origin {
                entities,
                associations,
                flows: vec![fid.clone()],
                paths: vec![owner.slot_path(Slot::Connect)],
                ..origin("flow-connect")
            };
            let connected = format!("state/flow/{fid}/connected");
            self.fact(connected.clone(), format!("{} · connected", flow.label));
            self.action(
                format!("action/flow-connect/{fid}"),
                format!("Connect · {}", flow.label),
                duration,
                &prerequisites,
                &connected,
                o,
            );
            let reachable = self.state_id(&flow.target, "reachable");
            let r = Origin {
                entities: vec![flow.target.clone()],
                flows: vec![fid.clone()],
                ..origin("service-reachable")
            };
            self.produce(&connected, &reachable, r);
        }
    }

    /// Content reaches people and software from zones and from controlled
    /// services; a deceived person discloses and runs, software is taken over.
    fn operators(&mut self) {
        for (aid, a) in &self.m.associations {
            match &a.relation {
                Relation::Delivers { from, to } => {
                    let access = self.state_id(from, State::Access.as_str());
                    let contacted = self.state_id(to, State::Contacted.as_str());
                    let o = bound("content-from-zone", &[from, to], &[aid], &[]);
                    self.produce(&access, &contacted, o);
                }
                Relation::Knows { from, to } => {
                    let deceived = self.state_id(from, State::Deceived.as_str());
                    let possessed = self.state_id(to, State::Possessed.as_str());
                    let o = bound("person-disclose", &[from, to], &[aid], &[]);
                    self.produce(&deceived, &possessed, o);
                }
                Relation::Operates { from, to } => {
                    let deceived = self.state_id(from, State::Deceived.as_str());
                    let control = self.state_id(to, State::Control.as_str());
                    let o = bound("person-run", &[from, to], &[aid], &[]);
                    self.produce(&deceived, &control, o);
                    let contacted = self.state_id(from, State::Contacted.as_str());
                    for fid in self.flows_from.get(to).cloned().unwrap_or_default() {
                        let target = &self.m.flows[fid].target;
                        let served = self.state_id(target, State::Control.as_str());
                        let o = bound("content-from-service", &[from, to, target], &[aid], &[fid]);
                        self.produce(&served, &contacted, o);
                    }
                }
                _ => {}
            }
        }
        for (eid, entity) in &self.m.entities {
            if entity.kind != EntityKind::Person {
                continue;
            }
            let owner = Owner::Entity(eid.clone());
            let contacted = self.state_id(eid, State::Contacted.as_str());
            let o = Origin {
                paths: vec![
                    owner.slot_path(Slot::Phish),
                    owner.slot_path(Slot::PhishTrained),
                    format!("entities.{eid}.defenses.trained"),
                ],
                ..bound("phish", &[eid], &[], &[])
            };
            let deceived = self.state_id(eid, State::Deceived.as_str());
            self.action(
                format!("action/phish/{eid}"),
                format!("Deceive · {}", entity.label),
                Binding::Parameter {
                    owner,
                    base: Slot::Phish,
                    replacement: Some((Defense::Trained, Slot::PhishTrained)),
                },
                &[contacted],
                &deceived,
                o,
            );
        }
        for eid in self.readers.clone() {
            let contacted = self.state_id(eid, State::Contacted.as_str());
            for fid in self.flows_from.get(eid).cloned().unwrap_or_default() {
                let target = &self.m.flows[fid].target;
                let served = self.state_id(target, State::Control.as_str());
                let o = bound("content-from-service", &[eid, target], &[], &[fid]);
                self.produce(&served, &contacted, o);
            }
            let owner = Owner::Entity(eid.clone());
            let o = Origin {
                paths: vec![
                    owner.slot_path(Slot::TakeOver),
                    owner.slot_path(Slot::TakeOverGuarded),
                    format!("entities.{eid}.defenses.guarded"),
                ],
                ..bound("take-over", &[eid], &[], &[])
            };
            let control = self.state_id(eid, State::Control.as_str());
            self.action(
                format!("action/take-over/{eid}"),
                format!("Take over through content · {}", self.label(eid)),
                Binding::Parameter {
                    owner,
                    base: Slot::TakeOver,
                    replacement: Some((Defense::Guarded, Slot::TakeOverGuarded)),
                },
                &[contacted],
                &control,
                o,
            );
        }
    }

    /// What an exploit gets past first (extract Fig. 5.18, 5.36): the IDS or
    /// IPS a router on its route or its host watches with, and its host's
    /// anti-malware. Each is one step however many exploits it guards, beside
    /// a policy input that lets the exploit through while the guard is off —
    /// so every scenario shares the graph. Nothing guarded, nothing drawn.
    fn guards(&mut self) {
        let mut passed_of: HashMap<&'a EntityId, String> = HashMap::new();
        let mut machines: Vec<&'a EntityId> = self.sensors_on.keys().copied().collect();
        machines.sort();
        for machine in machines {
            let watched = self.sensors_on[machine].clone();
            // What reaches a sensor on this machine: on a router the flows
            // routed through it, on a host the host itself.
            let reach: Vec<(String, Option<&'a FlowId>)> =
                if self.kind(machine) == EntityKind::Router {
                    self.m
                        .flows
                        .iter()
                        .filter(|(_, f)| f.route.iter().skip(1).step_by(2).any(|r| r == machine))
                        .map(|(fid, _)| (format!("state/flow/{fid}/connected"), Some(fid)))
                        .collect()
                } else if self.host_reachable(machine) {
                    vec![(self.state_id(machine, "reachable"), None)]
                } else {
                    Vec::new()
                };
            if reach.is_empty() {
                continue;
            }
            for (sensor, watches) in watched {
                let passed = self.sensor(sensor);
                let reached = self.state_id(sensor, "reached");
                for (from, flow) in &reach {
                    let o = Origin {
                        entities: vec![machine.clone(), sensor.clone()],
                        associations: vec![watches.clone()],
                        flows: flow.iter().map(|&f| f.clone()).collect(),
                        ..origin("sensor-reached")
                    };
                    self.produce(from, &reached, o);
                }
                if self.kind(machine) == EntityKind::Host {
                    self.host_guards
                        .entry(machine)
                        .or_default()
                        .push(passed.clone());
                }
                passed_of.insert(sensor, passed);
            }
        }
        // A flow through a watched router: the exploit over it reaches its
        // service unseen only past each of those sensors.
        let mut watched_into: BTreeMap<&'a EntityId, Vec<(&'a FlowId, Vec<Watch<'a>>)>> =
            BTreeMap::new();
        for (fid, flow) in &self.m.flows {
            let mut on_route = Vec::new();
            for router in flow.route.iter().skip(1).step_by(2) {
                for &(sensor, watches) in self
                    .sensors_on
                    .get(router)
                    .map(Vec::as_slice)
                    .unwrap_or(&[])
                {
                    on_route.push((router, sensor, watches));
                }
            }
            watched_into
                .entry(&flow.target)
                .or_default()
                .push((fid, on_route));
        }
        for (service, flows) in watched_into {
            if flows.iter().all(|(_, on)| on.is_empty())
                || self.kind(service) != EntityKind::Service
            {
                continue;
            }
            self.unseen.insert(service);
            let unseen = self.state_id(service, "unseen");
            self.fact(
                unseen.clone(),
                format!("{} · reached unseen", self.label(service)),
            );
            for (fid, on_route) in flows {
                let connected = format!("state/flow/{fid}/connected");
                let mut o = Origin {
                    entities: vec![service.clone()],
                    flows: vec![fid.clone()],
                    ..origin("watched-flow")
                };
                if on_route.is_empty() {
                    self.produce(&connected, &unseen, o);
                    continue;
                }
                let mut prerequisites = vec![connected];
                for (router, sensor, watches) in on_route {
                    o.entities.extend([router.clone(), sensor.clone()]);
                    o.associations.push(watches.clone());
                    prerequisites.push(passed_of[sensor].clone());
                }
                self.action(
                    format!("action/watched-flow/{fid}"),
                    format!("Past the sensors · {}", self.m.flows[fid].label),
                    Binding::Logical,
                    &prerequisites,
                    &unseen,
                    o,
                );
            }
        }
        // Anti-malware, where a host says it and runs something to guard.
        let hosts: Vec<&'a EntityId> = self
            .m
            .entities
            .iter()
            .filter(|(id, e)| e.kind == EntityKind::Host && self.antimalware_said(id))
            .map(|(id, _)| id)
            .collect();
        for host in hosts {
            if !self.host_reachable(host) {
                continue;
            }
            let cleared = self.state_id(host, "malware-cleared");
            self.fact(
                cleared.clone(),
                format!("{} · past the anti-malware", self.label(host)),
            );
            let input = format!("input/antimalware-off/{host}");
            let policy = Origin {
                entities: vec![host.clone()],
                paths: vec![format!("entities.{host}.defenses.anti-malware")],
                ..origin("antimalware-off")
            };
            self.insert(
                input.clone(),
                format!("Anti-malware off · {}", self.label(host)),
                DraftKind::Input(Binding::Policy {
                    entity: host.clone(),
                    defense: Defense::AntiMalware,
                }),
            );
            self.originate(&input, policy.clone());
            self.produce(&input, &cleared, policy);
            let owner = Owner::Entity(host.clone());
            let o = Origin {
                entities: vec![host.clone()],
                paths: vec![owner.slot_path(Slot::BypassAntimalware)],
                ..origin("antimalware-bypass")
            };
            let reachable = self.state_id(host, "reachable");
            self.action(
                format!("action/antimalware-bypass/{host}"),
                format!("Get past the anti-malware · {}", self.label(host)),
                Binding::Parameter {
                    owner,
                    base: Slot::BypassAntimalware,
                    replacement: None,
                },
                &[reachable],
                &cleared,
                o,
            );
            self.host_guards.entry(host).or_default().push(cleared);
        }
    }

    /// Where a watched flow reaches one of a host's services, the host is
    /// reached unseen only as its services are: `host.unseen` from each
    /// service's `unseen` (or `reachable` where nothing watches it). None
    /// when no flow into the host is watched.
    fn host_unseen(&mut self, host: &'a EntityId) -> Option<String> {
        let served: Vec<(&'a EntityId, &'a AssociationId)> = self
            .m
            .associations
            .iter()
            .filter_map(|(aid, a)| match &a.relation {
                Relation::Hosts { from, to, .. }
                    if from == host && self.kind(to) == EntityKind::Service =>
                {
                    Some((to, aid))
                }
                _ => None,
            })
            .collect();
        if !served.iter().any(|(sid, _)| self.unseen.contains(sid)) {
            return None;
        }
        let unseen = self.state_id(host, "unseen");
        self.fact(
            unseen.clone(),
            format!("{} · reached unseen", self.label(host)),
        );
        for (sid, hosts) in served {
            let from = if self.unseen.contains(sid) {
                self.state_id(sid, "unseen")
            } else {
                self.state_id(sid, "reachable")
            };
            let o = Origin {
                entities: vec![sid.clone(), host.clone()],
                associations: vec![hosts.clone()],
                ..origin("watched-flow")
            };
            self.produce(&from, &unseen, o);
        }
        Some(unseen)
    }

    /// Whether a foothold or the target names `entity` at `state`.
    fn named(&self, entity: &EntityId, state: State) -> bool {
        let a = &self.m.attacker;
        a.footholds
            .iter()
            .chain(a.target.iter())
            .any(|r| &r.entity == entity && r.state == state)
    }

    /// An optional state's fact, drawn once.
    fn optional_state(&mut self, entity: &EntityId, state: State) -> String {
        let fid = self.state_id(entity, state.as_str());
        self.fact(
            fid.clone(),
            format!("{} · {}", self.label(entity), state_word(state)),
        );
        fid
    }

    /// Standing at a host or plugging into it (extract Fig. 5.33): attacker
    /// inputs only, each a step once the host says how long it takes.
    fn host_access(&mut self) {
        for (hid, entity) in &self.m.entities {
            if entity.kind != EntityKind::Host {
                continue;
            }
            for (slot, state, rule, word, gives) in [
                (
                    Slot::Physical,
                    State::Physical,
                    "physical-access",
                    "Physical access",
                    State::Admin,
                ),
                (
                    Slot::Usb,
                    State::Usb,
                    "usb-access",
                    "USB access",
                    State::User,
                ),
            ] {
                if !self.has_slot(hid, slot) {
                    continue;
                }
                let from = self.optional_state(hid, state);
                let owner = Owner::Entity(hid.clone());
                let o = Origin {
                    entities: vec![hid.clone()],
                    paths: vec![owner.slot_path(slot)],
                    ..origin(rule)
                };
                let to = self.state_id(hid, gives.as_str());
                self.action(
                    format!("action/{rule}/{hid}"),
                    format!("{word} · {}", entity.label),
                    Binding::Parameter {
                        owner,
                        base: slot,
                        replacement: None,
                    },
                    &[from],
                    &to,
                    o,
                );
            }
        }
    }

    /// Taking a host or service out of service (extract Fig. 5.34): a goal
    /// only, once it says how long that takes and something reaches it.
    fn denials(&mut self) {
        for (id, entity) in &self.m.entities {
            if !matches!(entity.kind, EntityKind::Host | EntityKind::Service)
                || !self.has_slot(id, Slot::Deny)
            {
                continue;
            }
            if entity.kind == EntityKind::Host && !self.host_reachable(id) {
                continue;
            }
            let reachable = self.state_id(id, "reachable");
            let unavailable = self.optional_state(id, State::Unavailable);
            let owner = Owner::Entity(id.clone());
            let o = Origin {
                entities: vec![id.clone()],
                paths: vec![owner.slot_path(Slot::Deny)],
                ..origin("deny-service")
            };
            self.action(
                format!("action/deny-service/{id}"),
                format!("Denial of service · {}", entity.label),
                Binding::Parameter {
                    owner,
                    base: Slot::Deny,
                    replacement: None,
                },
                &[reachable],
                &unavailable,
                o,
            );
        }
    }

    /// An account the attacker starts out holding gives what logs it in
    /// (extract Fig. 5.33); the account's own rules do the rest.
    fn held(&mut self) {
        for f in &self.m.attacker.footholds {
            if f.state != State::Held {
                continue;
            }
            let held = self.state_id(&f.entity, State::Held.as_str());
            let material = self.state_id(&f.entity, "material");
            let o = Origin {
                entities: vec![f.entity.clone()],
                ..origin("account-held")
            };
            self.produce(&held, &material, o);
        }
    }

    /// User to admin on a host (extract Fig. 5.33), once the host says how
    /// long it takes; `escalate-hardened` while it is hardened.
    fn escalations(&mut self) {
        for (hid, entity) in &self.m.entities {
            if entity.kind != EntityKind::Host || !self.has_slot(hid, Slot::Escalate) {
                continue;
            }
            let owner = Owner::Entity(hid.clone());
            let o = Origin {
                entities: vec![hid.clone()],
                paths: vec![
                    owner.slot_path(Slot::Escalate),
                    owner.slot_path(Slot::EscalateHardened),
                    format!("entities.{hid}.defenses.hardened"),
                ],
                ..origin("escalate")
            };
            let user = self.state_id(hid, State::User.as_str());
            let admin = self.state_id(hid, State::Admin.as_str());
            self.action(
                format!("action/escalate/{hid}"),
                format!("Escalate privilege · {}", entity.label),
                Binding::Parameter {
                    owner,
                    base: Slot::Escalate,
                    replacement: Some((Defense::Hardened, Slot::EscalateHardened)),
                },
                &[user],
                &admin,
                o,
            );
        }
    }

    /// A sensor's `passed` fact, its bypass and its off input, once.
    fn sensor(&mut self, sensor: &'a EntityId) -> String {
        let passed = self.state_id(sensor, "passed");
        if self.nodes.contains_key(&passed) {
            return passed;
        }
        let word = match self.kind(sensor) {
            EntityKind::Ips => "IPS",
            _ => "IDS",
        };
        let label = self.label(sensor);
        self.fact(passed.clone(), format!("{label} · got past"));
        let reached = self.state_id(sensor, "reached");
        self.fact(reached.clone(), format!("{label} · reached"));
        let input = format!("input/sensor-off/{sensor}");
        let policy = Origin {
            entities: vec![sensor.clone()],
            paths: vec![format!("entities.{sensor}.defenses.enabled")],
            ..origin("sensor-off")
        };
        self.insert(
            input.clone(),
            format!("{word} off · {label}"),
            DraftKind::Input(Binding::Policy {
                entity: sensor.clone(),
                defense: Defense::Enabled,
            }),
        );
        self.originate(&input, policy.clone());
        self.produce(&input, &passed, policy);
        let owner = Owner::Entity(sensor.clone());
        let o = Origin {
            entities: vec![sensor.clone()],
            paths: vec![owner.slot_path(Slot::Bypass)],
            ..origin("sensor-bypass")
        };
        self.action(
            format!("action/sensor-bypass/{sensor}"),
            format!("Get past the {word} · {label}"),
            Binding::Parameter {
                owner,
                base: Slot::Bypass,
                replacement: None,
            },
            &[reached],
            &passed,
            o,
        );
        passed
    }

    fn products(&mut self) {
        for (pid, entity) in &self.m.entities {
            if entity.kind != EntityKind::Product {
                continue;
            }
            let owner = Owner::Entity(pid.clone());
            let o = Origin {
                entities: vec![pid.clone()],
                paths: vec![
                    owner.slot_path(Slot::FindExploit),
                    owner.slot_path(Slot::FindExploitPatched),
                    format!("entities.{pid}.defenses.patched"),
                ],
                ..origin("product-find-exploit")
            };
            let reachable = self.state_id(pid, "reachable");
            let ready = self.state_id(pid, "exploit-ready");
            self.action(
                format!("action/product-find-exploit/{pid}"),
                format!("Find an exploit · {}", entity.label),
                Binding::Parameter {
                    owner,
                    base: Slot::FindExploit,
                    replacement: Some((Defense::Patched, Slot::FindExploitPatched)),
                },
                &[reachable],
                &ready,
                o,
            );
        }
    }

    /// Each instance makes its product reachable; the product's exploit is
    /// deployed on each instance the attacker reaches.
    fn services(&mut self) {
        for (sid, entity) in &self.m.entities {
            if entity.kind != EntityKind::Service {
                continue;
            }
            // Generation refuses a service without a product: it is incomplete.
            let (pid, instance) = self.product_of[sid];
            let reachable = self.state_id(sid, "reachable");
            let product_reachable = self.state_id(pid, "reachable");
            let r = Origin {
                entities: vec![sid.clone(), pid.clone()],
                associations: vec![instance.clone()],
                ..origin("product-reachable")
            };
            self.produce(&reachable, &product_reachable, r);
            // The step is the service's: the product's exploit, used on it.
            let host = self.host_of.get(sid).map(|&(machine, _, _)| machine);
            let (binding, paths) = self.deploy_binding(sid, host);
            let deploy = Origin {
                entities: vec![pid.clone(), sid.clone()],
                associations: vec![instance.clone()],
                paths,
                ..origin("service-deploy-exploit")
            };
            let ready = self.state_id(pid, "exploit-ready");
            let control = self.state_id(sid, State::Control.as_str());
            let reached = if self.unseen.contains(sid) {
                self.state_id(sid, "unseen")
            } else {
                reachable
            };
            let mut prerequisites = vec![ready, reached];
            if let Some(host) = host {
                prerequisites.extend(self.host_guards.get(host).cloned().unwrap_or_default());
            }
            self.action(
                format!("action/service-deploy-exploit/{sid}"),
                format!("Use the exploit · {}", entity.label),
                binding,
                &prerequisites,
                &control,
                deploy,
            );
        }
    }

    /// A host's operating system and an application's version (extract Fig.
    /// 5.28, 5.35): reached through the services the host runs, or through
    /// content in front of the application; exploited once the file says how
    /// long using the exploit takes (an optional slot).
    fn instances(&mut self) {
        for (eid, entity) in &self.m.entities {
            if !matches!(entity.kind, EntityKind::Host | EntityKind::Application) {
                continue;
            }
            let Some(&(pid, instance)) = self.product_of.get(eid) else {
                continue;
            };
            let reachable = self.state_id(eid, "reachable");
            let mut reached = false;
            if entity.kind == EntityKind::Host {
                reached = self.host_reachable(eid);
            } else if self.readers.contains(eid) {
                self.fact(reachable.clone(), format!("Reachable · {}", entity.label));
                let o = Origin {
                    entities: vec![eid.clone()],
                    ..origin("application-reachable")
                };
                let contacted = self.state_id(eid, State::Contacted.as_str());
                self.produce(&contacted, &reachable, o);
                reached = true;
            }
            if !reached {
                continue;
            }
            let product_reachable = self.state_id(pid, "reachable");
            let r = Origin {
                entities: vec![eid.clone(), pid.clone()],
                associations: vec![instance.clone()],
                ..origin("product-reachable")
            };
            self.produce(&reachable, &product_reachable, r);
            if !self.has_slot(eid, Slot::DeployExploit) {
                continue;
            }
            let host = (entity.kind == EntityKind::Host).then_some(eid);
            let (binding, paths) = self.deploy_binding(eid, host);
            let (rule, word, output) = if entity.kind == EntityKind::Host {
                (
                    "host-deploy-exploit",
                    "Use the exploit",
                    self.state_id(eid, State::Admin.as_str()),
                )
            } else {
                (
                    "application-deploy-exploit",
                    "Use the exploit",
                    self.state_id(eid, State::Control.as_str()),
                )
            };
            let deploy = Origin {
                entities: vec![pid.clone(), eid.clone()],
                associations: vec![instance.clone()],
                paths,
                ..origin(rule)
            };
            let ready = self.state_id(pid, "exploit-ready");
            let reached = if entity.kind == EntityKind::Host {
                self.host_unseen(eid).unwrap_or(reachable)
            } else {
                reachable
            };
            let mut prerequisites = vec![ready, reached];
            if entity.kind == EntityKind::Host {
                prerequisites.extend(self.host_guards.get(eid).cloned().unwrap_or_default());
            }
            self.action(
                format!("action/{rule}/{eid}"),
                format!("{word} · {}", entity.label),
                binding,
                &prerequisites,
                &output,
                deploy,
            );
        }
    }

    fn credentials(&mut self) {
        for (aid, a) in &self.m.associations {
            match &a.relation {
                Relation::Stores {
                    from,
                    to,
                    privilege,
                } => {
                    let holder = match self.kind(from) {
                        EntityKind::Application => self.state_id(from, State::Control.as_str()),
                        _ => self.machine_id(from, *privilege),
                    };
                    let owner = Owner::Entity(to.clone());
                    let o = Origin {
                        entities: vec![from.clone(), to.clone()],
                        associations: vec![aid.clone()],
                        paths: vec![
                            owner.slot_path(Slot::Extract),
                            owner.slot_path(Slot::ExtractProtected),
                            format!("entities.{to}.defenses.protected"),
                        ],
                        ..origin("credential-extract")
                    };
                    let possessed = self.state_id(to, State::Possessed.as_str());
                    self.action(
                        format!("action/credential-extract/{from}/{to}"),
                        format!("Extract · {} · {}", self.label(to), self.label(from)),
                        Binding::Parameter {
                            owner,
                            base: Slot::Extract,
                            replacement: Some((Defense::Protected, Slot::ExtractProtected)),
                        },
                        &[holder],
                        &possessed,
                        o,
                    );
                }
                Relation::Authenticates { from, to, factor } => {
                    let (rule, fact) = match factor {
                        Factor::First => ("account-material", "material"),
                        Factor::Second => ("mfa-second-factor", "mfa-satisfied"),
                    };
                    let o = Origin {
                        entities: vec![from.clone(), to.clone()],
                        associations: vec![aid.clone()],
                        ..origin(rule)
                    };
                    let possessed = self.state_id(from, State::Possessed.as_str());
                    let reached = self.state_id(to, fact);
                    self.produce(&possessed, &reached, o);
                }
                _ => {}
            }
        }
    }

    /// Per account: the MFA switch as a policy, the bypass, and the join of
    /// material and second factor into a login.
    fn accounts(&mut self) {
        for (aid, entity) in &self.m.entities {
            if entity.kind != EntityKind::Account {
                continue;
            }
            let owner = Owner::Entity(aid.clone());
            let material = self.state_id(aid, "material");
            let satisfied = self.state_id(aid, "mfa-satisfied");
            let authenticated = self.state_id(aid, "authenticated");

            let input = format!("input/policy/{aid}/mfa");
            let policy = Origin {
                entities: vec![aid.clone()],
                paths: vec![format!("entities.{aid}.defenses.mfa")],
                ..origin("mfa-policy")
            };
            self.insert(
                input.clone(),
                format!("Multi-factor login off · {}", entity.label),
                DraftKind::Input(Binding::Policy {
                    entity: aid.clone(),
                    defense: Defense::Mfa,
                }),
            );
            self.originate(&input, policy.clone());
            self.produce(&input, &satisfied, policy);

            let bypass = Origin {
                entities: vec![aid.clone()],
                paths: vec![owner.slot_path(Slot::MfaBypass)],
                ..origin("mfa-bypass")
            };
            self.action(
                format!("action/mfa-bypass/{aid}"),
                format!("Get past multi-factor login · {}", entity.label),
                Binding::Parameter {
                    owner,
                    base: Slot::MfaBypass,
                    replacement: None,
                },
                std::slice::from_ref(&material),
                &satisfied,
                bypass,
            );

            let join = Origin {
                entities: vec![aid.clone()],
                ..origin("account-authenticated")
            };
            self.action(
                format!("action/account-authenticated/{aid}"),
                format!("Log in as · {}", entity.label),
                Binding::Logical,
                &[material, satisfied],
                &authenticated,
                join,
            );
        }
    }

    /// Workloads authenticate as the accounts they run as; an account that may
    /// become another is authenticated as it too. Cycles are ordinary facts.
    fn identities(&mut self) {
        for (id, a) in &self.m.associations {
            match &a.relation {
                Relation::RunsAs {
                    from,
                    to,
                    privilege,
                } => {
                    let workload = match self.kind(from) {
                        EntityKind::Host => self.machine_id(from, *privilege),
                        _ => self.state_id(from, State::Control.as_str()),
                    };
                    let o = Origin {
                        entities: vec![from.clone(), to.clone()],
                        associations: vec![id.clone()],
                        ..origin("workload-identity")
                    };
                    let authenticated = self.state_id(to, "authenticated");
                    self.produce(&workload, &authenticated, o);
                }
                Relation::Assumes { from, to } => {
                    let o = Origin {
                        entities: vec![from.clone(), to.clone()],
                        associations: vec![id.clone()],
                        ..origin("assume-role")
                    };
                    let source = self.state_id(from, "authenticated");
                    let target = self.state_id(to, "authenticated");
                    self.produce(&source, &target, o);
                }
                _ => {}
            }
        }
    }

    fn logins(&mut self) {
        for (aid, a) in &self.m.associations {
            let Relation::Authorizes { from, to } = &a.relation else {
                continue;
            };
            let owner = Owner::Entity(to.clone());
            let o = Origin {
                entities: vec![from.clone(), to.clone()],
                associations: vec![aid.clone()],
                paths: vec![owner.slot_path(Slot::Login)],
                ..origin("service-login")
            };
            let session = format!("state/session/{from}/{to}");
            self.fact(
                session.clone(),
                format!("Logged in · {} · {}", self.label(from), self.label(to)),
            );
            let prerequisites = [
                self.state_id(to, "reachable"),
                self.state_id(from, "authenticated"),
            ];
            self.action(
                format!("action/service-login/{from}/{to}"),
                format!("Log in · {} · {}", self.label(from), self.label(to)),
                Binding::Parameter {
                    owner,
                    base: Slot::Login,
                    replacement: None,
                },
                &prerequisites,
                &session,
                o,
            );
            let (machine, _, hosts) = self.host_of[to];
            if let Some(&grant) = self.grant.get(&(from, machine)) {
                let mut entities = vec![from.clone(), to.clone(), machine.clone()];
                entities.extend(grant.entities());
                let mut associations = vec![aid.clone()];
                associations.extend(grant.associations());
                associations.push(hosts.clone());
                let g = Origin {
                    entities,
                    associations,
                    ..origin("session-grant")
                };
                let granted = self.machine_id(machine, grant.privilege);
                self.produce(&session, &granted, g);
            }
        }
    }

    fn administration(&mut self) {
        for (aid, a) in &self.m.associations {
            let Relation::Administration { from, to } = &a.relation else {
                continue;
            };
            let Some(grants) = self.grants_on.get(to).cloned() else {
                continue;
            };
            for (account, grant) in grants {
                if self.full() {
                    return;
                }
                let owner = Owner::Entity(account.clone());
                let mut entities = vec![from.clone(), account.clone(), to.clone()];
                entities.extend(grant.entities());
                let mut associations = vec![aid.clone()];
                associations.extend(grant.associations());
                let o = Origin {
                    entities,
                    associations,
                    paths: vec![owner.slot_path(Slot::AdminLogin)],
                    ..origin("administration-login")
                };
                let prerequisites = [
                    self.state_id(from, State::Access.as_str()),
                    self.state_id(account, "authenticated"),
                ];
                let granted = self.machine_id(to, grant.privilege);
                self.action(
                    format!("action/administration-login/{from}/{account}/{to}"),
                    format!(
                        "Admin login · {} · {} from {}",
                        self.label(account),
                        self.label(to),
                        self.label(from)
                    ),
                    Binding::Parameter {
                        owner,
                        base: Slot::AdminLogin,
                        replacement: None,
                    },
                    &prerequisites,
                    &granted,
                    o,
                );
            }
        }
    }

    /// Holders read and change their data, sessions use their access, keys and
    /// the switch give plaintext, and changed content reaches its readers.
    fn data(&mut self) {
        for (id, entity) in &self.m.entities {
            if entity.kind != EntityKind::Data {
                continue;
            }
            let input = format!("input/policy/{id}/encrypted");
            let o = Origin {
                paths: vec![format!("entities.{id}.defenses.encrypted")],
                ..bound("data-policy", &[id], &[], &[])
            };
            self.insert(
                input.clone(),
                format!("Not encrypted · {}", entity.label),
                DraftKind::Input(Binding::Policy {
                    entity: id.clone(),
                    defense: Defense::Encrypted,
                }),
            );
            self.originate(&input, o.clone());
            let plaintext = self.state_id(id, "plaintext");
            self.produce(&input, &plaintext, o);
        }
        for (aid, a) in &self.m.associations {
            if self.full() {
                return;
            }
            match &a.relation {
                Relation::Holds {
                    from,
                    to,
                    privilege,
                    ..
                } => {
                    let holder = match self.kind(from) {
                        EntityKind::Host => self.machine_id(from, *privilege),
                        _ => self.state_id(from, State::Control.as_str()),
                    };
                    let modified = self.state_id(to, State::Modified.as_str());
                    let o = bound("holder-modify", &[from, to], &[aid], &[]);
                    self.produce(&holder, &modified, o);
                    let decrypts = self.holdings[&(from, to)].0;
                    self.read(
                        format!("action/holder-read/{from}/{to}"),
                        format!("Read · {} · {}", self.label(to), self.label(from)),
                        &holder,
                        to,
                        decrypts,
                        bound("holder-read", &[from, to], &[aid], &[]),
                    );
                }
                Relation::Accesses { from, to, mode } => {
                    let services = self.authorized.get(from).cloned().unwrap_or_default();
                    for (service, authorizes) in services {
                        let Some(&(decrypts, holds)) = self.holdings.get(&(service, to)) else {
                            continue;
                        };
                        let session = format!("state/session/{from}/{service}");
                        let o = bound(
                            "account-data",
                            &[from, service, to],
                            &[aid, authorizes, holds],
                            &[],
                        );
                        self.read(
                            format!("action/account-data/{from}/{service}/{to}"),
                            format!("Read · {} · as {}", self.label(to), self.label(from)),
                            &session,
                            to,
                            decrypts,
                            o.clone(),
                        );
                        if *mode == Mode::Write {
                            let modified = self.state_id(to, State::Modified.as_str());
                            self.produce(&session, &modified, o);
                        }
                    }
                }
                Relation::EncryptedWith { from, to } => {
                    let key = self.state_id(to, State::Possessed.as_str());
                    let plaintext = self.state_id(from, "plaintext");
                    self.produce(
                        &key,
                        &plaintext,
                        bound("data-key", &[from, to], &[aid], &[]),
                    );
                }
                Relation::Reads { from, to } => {
                    let modified = self.state_id(to, State::Modified.as_str());
                    let contacted = self.state_id(from, State::Contacted.as_str());
                    let o = bound("data-poisoning", &[from, to], &[aid], &[]);
                    self.produce(&modified, &contacted, o);
                }
                _ => {}
            }
        }
    }

    /// `data.read` from `source`: directly where the holder decrypts, else a
    /// zero-time join with the data's plaintext.
    fn read(
        &mut self,
        join: String,
        label: String,
        source: &str,
        data: &EntityId,
        decrypts: bool,
        o: Origin,
    ) {
        let read = self.state_id(data, State::Read.as_str());
        if decrypts {
            self.produce(source, &read, o);
            return;
        }
        let plaintext = self.state_id(data, "plaintext");
        self.action(
            join,
            label,
            Binding::Logical,
            &[source.to_owned(), plaintext],
            &read,
            o,
        );
    }

    /// Ids to indices, once, after expansion: the map is already in id-byte
    /// order, so an input's index order is its id order.
    fn finish(self, target: &str) -> GeneratedGraph {
        let index: HashMap<&str, usize> = self
            .nodes
            .keys()
            .enumerate()
            .map(|(i, id)| (id.as_str(), i))
            .collect();
        let target = index[target];
        let inputs = |d: &Draft| -> Vec<usize> {
            let mut v: Vec<usize> = d.inputs.iter().map(|id| index[id.as_str()]).collect();
            v.sort_unstable();
            v
        };
        let nodes = self
            .nodes
            .iter()
            .map(|(id, d)| {
                let (kind, duration) = match &d.kind {
                    DraftKind::Input(b) => (GeneratedKind::Input, b.clone()),
                    DraftKind::Any => (GeneratedKind::Any { inputs: inputs(d) }, Binding::Logical),
                    DraftKind::All(b) => (GeneratedKind::All { inputs: inputs(d) }, b.clone()),
                };
                // Origins in a canonical order, not the document's: an export
                // does not change when the author reorders a map.
                let mut origins = d.origins.clone();
                origins.sort_by(|a, b| {
                    (&a.rule, &a.entities, &a.associations, &a.flows, &a.paths).cmp(&(
                        &b.rule,
                        &b.entities,
                        &b.associations,
                        &b.flows,
                        &b.paths,
                    ))
                });
                GeneratedNode {
                    id: id.clone(),
                    label: d.label.clone(),
                    kind,
                    duration,
                    origins,
                }
            })
            .collect();
        GeneratedGraph {
            library: self.m.library.clone(),
            semantics: SEMANTICS,
            nodes,
            target,
        }
    }
}

/// A rule's origin with what it bound.
fn bound(
    rule: &str,
    entities: &[&EntityId],
    associations: &[&AssociationId],
    flows: &[&FlowId],
) -> Origin {
    Origin {
        entities: entities.iter().map(|&e| e.clone()).collect(),
        associations: associations.iter().map(|&a| a.clone()).collect(),
        flows: flows.iter().map(|&f| f.clone()).collect(),
        ..origin(rule)
    }
}

/// A rule's provenance skeleton: id, version and assumptions from the catalog.
fn origin(rule: &str) -> Origin {
    let r = RULES
        .iter()
        .find(|r| r.id == rule)
        .expect("every generated rule is in the catalog");
    Origin {
        rule: r.id.to_owned(),
        version: r.version,
        entities: Vec::new(),
        associations: Vec::new(),
        flows: Vec::new(),
        paths: Vec::new(),
        assumptions: r.assumptions.iter().map(|&a| a.to_owned()).collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use effractor_core::Document;

    fn lecture() -> Architecture {
        let text = include_str!("../../../docs/course/lecture-architecture.yaml");
        match effractor_format::load_document(text) {
            Ok(Document::Architecture(m)) => m,
            other => panic!("{other:?}"),
        }
    }

    fn dependencies(g: &GeneratedGraph) -> usize {
        g.nodes
            .iter()
            .map(|n| match &n.kind {
                GeneratedKind::Input => 0,
                GeneratedKind::Any { inputs } | GeneratedKind::All { inputs } => inputs.len(),
            })
            .sum()
    }

    #[test]
    fn both_limits_hold_at_their_boundary() {
        let m = lecture();
        let g = generate(&m).unwrap();
        let (nodes, deps) = (g.nodes.len(), dependencies(&g));
        assert_eq!(generate_within(&m, nodes, deps).unwrap(), g);
        for (n, d, what) in [
            (nodes - 1, deps, "steps"),
            (nodes, deps - 1, "dependencies"),
        ] {
            let errors = generate_within(&m, n, d).unwrap_err();
            assert_eq!(errors.len(), 1);
            assert_eq!(errors[0].code, Code::Limit);
            assert!(errors[0].message.ends_with(what), "{}", errors[0].message);
        }
    }
}
