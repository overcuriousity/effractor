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
    Architecture, Defense, EntityKind, Factor, Privilege, Relation, Slot, State,
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
    b.products();
    b.services();
    b.credentials();
    b.accounts();
    b.identities();
    b.logins();
    b.administration();
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
    /// (account, machine) → (privilege, grants association)
    grant: HashMap<(&'a EntityId, &'a EntityId), (Privilege, &'a AssociationId)>,
    /// machine → [(account, privilege, grants association)], in document order
    grants_on: HashMap<&'a EntityId, Vec<(&'a EntityId, Privilege, &'a AssociationId)>>,
    /// service → (product, instance-of association)
    product_of: HashMap<&'a EntityId, (&'a EntityId, &'a AssociationId)>,
    /// flow → the route paths the validator marked `unfinished`
    unfinished: HashMap<&'a FlowId, Vec<String>>,
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
            unfinished: HashMap::new(),
        };
        for (id, a) in &m.associations {
            match &a.relation {
                Relation::Hosts {
                    from,
                    to,
                    privilege,
                } => {
                    b.host_of.insert(to, (from, *privilege, id));
                }
                Relation::InstanceOf { from, to } => {
                    b.product_of.insert(from, (to, id));
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
                    b.grant.insert((from, to), (*privilege, id));
                    b.grants_on
                        .entry(to)
                        .or_default()
                        .push((from, *privilege, id));
                }
                _ => {}
            }
        }
        b
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
                let fid = self.state_id(id, state.as_str());
                self.fact(fid, format!("{} · {}", entity.label, state_word(*state)));
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
            } = &a.relation
            else {
                continue;
            };
            let machine = self.machine_id(from, *privilege);
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
                _ => {
                    let control = self.state_id(to, State::Control.as_str());
                    self.produce(&machine, &control, bound("host-execution"));
                    self.produce(&control, &machine, bound("execution-privilege"));
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
            // An unfinished route may cross a router with no firewall or no
            // permission yet: that hop is part of what is unknown.
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
            let owner = Owner::Entity(sid.clone());
            // The step is the service's: the product's exploit, used on it.
            let deploy = Origin {
                entities: vec![pid.clone(), sid.clone()],
                associations: vec![instance.clone()],
                paths: vec![owner.slot_path(Slot::DeployExploit)],
                ..origin("service-deploy-exploit")
            };
            let ready = self.state_id(pid, "exploit-ready");
            let control = self.state_id(sid, State::Control.as_str());
            self.action(
                format!("action/service-deploy-exploit/{sid}"),
                format!("Use the exploit · {}", entity.label),
                Binding::Parameter {
                    owner,
                    base: Slot::DeployExploit,
                    replacement: None,
                },
                &[ready, reachable],
                &control,
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
            if let Some(&(privilege, grant)) = self.grant.get(&(from, machine)) {
                let g = Origin {
                    entities: vec![from.clone(), to.clone(), machine.clone()],
                    associations: vec![aid.clone(), grant.clone(), hosts.clone()],
                    ..origin("session-grant")
                };
                let granted = self.machine_id(machine, privilege);
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
            for (account, privilege, grant) in grants {
                if self.full() {
                    return;
                }
                let owner = Owner::Entity(account.clone());
                let o = Origin {
                    entities: vec![from.clone(), account.clone(), to.clone()],
                    associations: vec![aid.clone(), grant.clone()],
                    paths: vec![owner.slot_path(Slot::AdminLogin)],
                    ..origin("administration-login")
                };
                let prerequisites = [
                    self.state_id(from, State::Access.as_str()),
                    self.state_id(account, "authenticated"),
                ];
                let granted = self.machine_id(to, privilege);
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
