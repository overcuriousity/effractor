//! Everything that can be wrong with an architecture that parsed. Errors mean
//! nothing may be generated or solved; `incomplete` warnings mean the model is
//! saveable but not yet ready — a missing host, a missing permission, no
//! target. What is not said is never filled in with a permissive default.

use std::collections::{HashMap, HashSet};

use crate::architecture::{
    Architecture, Change, Defense, Entity, EntityKind, Evidence, Flow, MAX_ENTITIES,
    MAX_RELATIONSHIPS, MAX_SAMPLES, MAX_SCENARIOS, Parameter, Privilege, Relation, RelationKind,
    StateRef,
};
use crate::{AssociationId, ClusterId, Code, Diagnostic, EntityId, FlowId};

pub fn validate_architecture(model: &Architecture) -> Vec<Diagnostic> {
    let mut cx = Cx {
        m: model,
        out: Vec::new(),
    };
    cx.header();
    cx.limits();
    cx.entities();
    cx.associations();
    cx.flows();
    cx.clusters();
    cx.attacker();
    cx.scenarios();
    cx.out
}

struct Cx<'a> {
    m: &'a Architecture,
    out: Vec<Diagnostic>,
}

impl Cx<'_> {
    fn error(&mut self, code: Code, path: impl Into<String>, message: impl Into<String>) {
        self.out.push(Diagnostic::error(code, path, message));
    }

    fn warning(&mut self, code: Code, path: impl Into<String>, message: impl Into<String>) {
        self.out.push(Diagnostic::warning(code, path, message));
    }

    fn incomplete(&mut self, path: impl Into<String>, message: impl Into<String>) {
        self.warning(Code::Incomplete, path, message);
    }

    /// A flow's route still being drawn: the graph is generated regardless,
    /// with the flow's connection unknown.
    fn unfinished(&mut self, path: impl Into<String>, message: impl Into<String>) {
        self.warning(Code::Unfinished, path, message);
    }

    fn kind_of(&self, id: &EntityId) -> Option<EntityKind> {
        self.m.entities.get(id).map(|e| e.kind)
    }

    /// The entity at `path`, or an `unknown-reference` error.
    fn entity(&mut self, id: &EntityId, path: &str) -> Option<&'_ Entity> {
        if self.m.entities.contains_key(id) {
            self.m.entities.get(id)
        } else {
            self.error(
                Code::UnknownReference,
                path,
                format!("\"{id}\" is not an entity"),
            );
            None
        }
    }

    /// The entity at `path`, which must be one of `kinds`.
    fn entity_of(&mut self, id: &EntityId, path: &str, kinds: &[EntityKind]) -> Option<EntityKind> {
        let kind = self.entity(id, path)?.kind;
        if kinds.contains(&kind) {
            return Some(kind);
        }
        let names: Vec<&str> = kinds.iter().map(|k| k.as_str()).collect();
        self.error(
            Code::AssociationType,
            path,
            format!(
                "\"{id}\" is a {}; expected {}",
                kind.as_str(),
                names.join(" or ")
            ),
        );
        None
    }

    fn header(&mut self) {
        let m = self.m;
        if !(m.horizon.is_finite() && m.horizon > 0.0) {
            self.error(
                Code::ParamDomain,
                "horizon",
                format!("horizon must be > 0, got {}", m.horizon),
            );
        }
        if m.analysis.samples == 0 {
            self.error(Code::ParamDomain, "analysis.samples", "samples must be > 0");
        } else if m.analysis.samples > MAX_SAMPLES {
            self.error(
                Code::Limit,
                "analysis.samples",
                format!("at most {MAX_SAMPLES} samples, got {}", m.analysis.samples),
            );
        }
        let c = m.analysis.confidence;
        if !(c > 0.0 && c < 1.0) {
            self.error(
                Code::ParamDomain,
                "analysis.confidence",
                format!("confidence must be in (0, 1), got {c}"),
            );
        }
        if !m.library.is_bundled() {
            self.error(
                Code::UnknownLibrary,
                "library",
                format!(
                    "this build bundles {}@{}; \"{}\" version {} is not available",
                    crate::architecture::LIBRARY_ID,
                    crate::architecture::LIBRARY_VERSION,
                    m.library.id,
                    m.library.version
                ),
            );
        }
    }

    fn limits(&mut self) {
        let m = self.m;
        if m.entities.len() > MAX_ENTITIES {
            self.error(
                Code::Limit,
                "entities",
                format!("at most {MAX_ENTITIES} entities, got {}", m.entities.len()),
            );
        }
        let relationships = m.associations.len().saturating_add(m.flows.len());
        if relationships > MAX_RELATIONSHIPS {
            self.error(
                Code::Limit,
                "associations",
                format!(
                    "at most {MAX_RELATIONSHIPS} associations and flows together, got {relationships}"
                ),
            );
        }
        if m.scenarios.len() > MAX_SCENARIOS {
            self.error(
                Code::Limit,
                "scenarios",
                format!(
                    "at most {MAX_SCENARIOS} scenarios, got {}",
                    m.scenarios.len()
                ),
            );
        }
    }

    fn parameter(&mut self, p: &Parameter, path: &str) {
        match (p.status, &p.ttc) {
            (Evidence::Unknown, Some(_)) => self.error(
                Code::ParamDomain,
                format!("{path}.ttc"),
                "an unknown parameter has no `ttc`; give it a status that says where the value comes from",
            ),
            (Evidence::Unknown, None) => {}
            (_, None) => self.error(
                Code::MissingKey,
                format!("{path}.ttc"),
                format!("`{}` needs a `ttc`", p.status.as_str()),
            ),
            (_, Some(d)) => {
                let at = format!("{path}.ttc");
                match d.check_ttc() {
                    Err(msg) => self.error(Code::DistributionRole, at, msg),
                    Ok(()) => {
                        if let Err(msg) = d.check_params() {
                            self.error(Code::ParamDomain, at, msg);
                        }
                    }
                }
            }
        }
        // A calibration claim names its source; an assumed or illustrative
        // value may say why, and a missing reason shows as one.
        if p.status == Evidence::Calibrated && p.note.as_deref().is_none_or(|n| n.trim().is_empty())
        {
            self.error(
                Code::MissingKey,
                format!("{path}.note"),
                "`calibrated` needs a nonempty `note` naming its source",
            );
        }
    }

    fn entities(&mut self) {
        let m = self.m;
        for (id, entity) in &m.entities {
            let at = format!("entities.{id}");
            let slots = entity.kind.slots();
            for (slot, p) in &entity.parameters {
                let path = format!("{at}.parameters.{}", slot.as_str());
                if !slots.contains(slot) {
                    self.error(
                        Code::MisplacedKey,
                        &path,
                        format!(
                            "`{}` is not a parameter of a {}",
                            slot.as_str(),
                            entity.kind.as_str()
                        ),
                    );
                    continue;
                }
                self.parameter(p, &path);
            }
            for defense in Defense::ALL {
                if entity.defenses.get(defense).is_some() && entity.kind.defense() != Some(defense)
                {
                    self.error(
                        Code::MisplacedKey,
                        format!("{at}.defenses.{}", defense.as_str()),
                        format!(
                            "`{}` is not a defence of a {}",
                            defense.as_str(),
                            entity.kind.as_str()
                        ),
                    );
                }
            }
        }
    }

    fn associations(&mut self) {
        let m = self.m;
        // Semantic duplicates: same kind, same ends.
        let mut seen: HashMap<(RelationKind, &EntityId, String), &AssociationId> = HashMap::new();
        let mut hosts_of: HashMap<&EntityId, Vec<&AssociationId>> = HashMap::new();
        let mut instances_of: HashMap<&EntityId, Vec<&AssociationId>> = HashMap::new();
        let mut filters_from: HashMap<&EntityId, Vec<&AssociationId>> = HashMap::new();
        let mut filters_to: HashMap<&EntityId, Vec<&AssociationId>> = HashMap::new();

        for (id, association) in &m.associations {
            let at = format!("associations.{id}");
            let r = &association.relation;
            let kind = r.kind();
            let from = self.entity_of(r.from(), &format!("{at}.from"), kind.from_kinds());
            let to = match r {
                Relation::Permits { to, .. } => {
                    if !m.flows.contains_key(to) {
                        self.error(
                            Code::UnknownReference,
                            format!("{at}.to"),
                            format!("\"{to}\" is not a flow"),
                        );
                    }
                    None
                }
                _ => r
                    .to_entity()
                    .and_then(|to| self.entity_of(to, &format!("{at}.to"), kind.to_kinds())),
            };
            self.association_rules(r, from, to, &at);
            if let (
                Relation::Hosts {
                    contained: true, ..
                },
                Some(k),
            ) = (r, to)
                && !k.is_executable()
            {
                self.error(
                    Code::MisplacedKey,
                    format!("{at}.contained"),
                    "`contained` says whether controlled software reaches its machine; this runs no software",
                );
            }

            let to_key = match r {
                Relation::Permits { to, .. } => to.to_string(),
                _ => r.to_entity().map(ToString::to_string).unwrap_or_default(),
            };
            if let Some(first) = seen.insert((kind, r.from(), to_key), id) {
                let what = match kind {
                    RelationKind::Permits => "a permission for this flow on this firewall",
                    _ => "this association",
                };
                self.error(
                    Code::Cardinality,
                    &at,
                    format!("{what} is already declared by \"{first}\""),
                );
            }
            match r {
                Relation::Hosts { to, .. } => hosts_of.entry(to).or_default().push(id),
                Relation::InstanceOf { from, .. } => instances_of.entry(from).or_default().push(id),
                Relation::Filters { from, to } => {
                    filters_from.entry(from).or_default().push(id);
                    filters_to.entry(to).or_default().push(id);
                }
                _ => {}
            }
        }

        for (what, by, one) in [
            (
                "an executable, router or guest host has one host",
                hosts_of,
                "hosts",
            ),
            ("a router manages one firewall", filters_from, "filters"),
            ("a firewall is managed by one router", filters_to, "filters"),
            (
                "a service is an instance of one product",
                instances_of,
                "instance-of",
            ),
        ] {
            let mut by: Vec<_> = by.into_iter().filter(|(_, ids)| ids.len() > 1).collect();
            by.sort_by_key(|(entity, _)| (*entity).clone());
            for (entity, ids) in by {
                let names: Vec<&str> = ids.iter().map(|i| i.as_str()).collect();
                self.error(
                    Code::Cardinality,
                    format!("associations.{}", ids[1]),
                    format!(
                        "{what}; \"{entity}\" has `{one}` associations {}",
                        names.join(", ")
                    ),
                );
            }
        }

        // What is missing, once: the executable without a host, the firewall
        // without a router. A router without a firewall filters nothing.
        let hosted: HashSet<&EntityId> = m
            .associations
            .values()
            .filter_map(|a| match &a.relation {
                Relation::Hosts { to, .. } => Some(to),
                _ => None,
            })
            .collect();
        let instances: HashSet<&EntityId> = m
            .associations
            .values()
            .filter_map(|a| match &a.relation {
                Relation::InstanceOf { from, .. } => Some(from),
                _ => None,
            })
            .collect();
        let filtered: HashSet<&EntityId> = m
            .associations
            .values()
            .filter_map(|a| match &a.relation {
                Relation::Filters { to, .. } => Some(to),
                _ => None,
            })
            .collect();
        for (id, entity) in &m.entities {
            let at = format!("entities.{id}");
            // A service may lack its host and its product at once: both are said.
            if entity.kind == EntityKind::Service && !instances.contains(id) {
                self.incomplete(
                    at.clone(),
                    format!(
                        "\"{id}\" is an instance of no product yet: no `instance-of` association names the software it runs"
                    ),
                );
            }
            match entity.kind {
                k if k.is_executable() && !hosted.contains(id) => self.incomplete(
                    at,
                    format!("\"{id}\" runs nowhere yet: no `hosts` association names it"),
                ),
                EntityKind::Firewall if !filtered.contains(id) => self.incomplete(
                    at,
                    format!("\"{id}\" belongs to no router yet: no `filters` association names it"),
                ),
                _ => {}
            }
        }
        self.hosting_cycles();
    }

    /// What an association's kinds and fields cannot say together. Each rule
    /// is its own: one broken does not hide another.
    fn association_rules(
        &mut self,
        r: &Relation,
        from: Option<EntityKind>,
        to: Option<EntityKind>,
        at: &str,
    ) {
        let privilege = r.privilege();
        let router = Some(EntityKind::Router);
        // Unknown only where a host runs software: a router's or a guest's
        // escape needs the privilege it lands at.
        if let (Relation::Hosts { .. }, Some(from), Some(to)) = (r, from, to)
            && privilege == Some(Privilege::Unknown)
            && (from != EntityKind::Host
                || !matches!(to, EntityKind::Application | EntityKind::Service))
        {
            self.error(
                Code::AssociationType,
                format!("{at}.privilege"),
                "only a host's software may run at an unknown privilege; say `user` or `admin`",
            );
        }
        if matches!(r, Relation::Grants { .. })
            && privilege == Some(Privilege::User)
            && to == router
        {
            self.error(
                Code::AssociationType,
                format!("{at}.privilege"),
                "a router has no user privilege; an account on a router is granted `admin`",
            );
        }
        if matches!(r, Relation::Hosts { .. })
            && privilege == Some(Privilege::User)
            && from == router
        {
            self.error(
                Code::AssociationType,
                format!("{at}.privilege"),
                "a router has no user privilege; what it runs, it runs as `admin`",
            );
        }
        if let (
            Relation::Hosts { .. },
            Some(from),
            Some(to @ (EntityKind::Router | EntityKind::Host)),
        ) = (r, from, to)
            && from != EntityKind::Host
        {
            let message = if to == EntityKind::Router {
                "a router runs on a host, not on another router"
            } else {
                "a host runs on a host, not on a router"
            };
            self.error(Code::AssociationType, format!("{at}.from"), message);
        }
        if let Relation::Assumes { from, to } = r
            && from == to
        {
            self.error(
                Code::AssociationType,
                format!("{at}.to"),
                "an account does not assume itself",
            );
        }
        if matches!(r, Relation::RunsAs { .. })
            && privilege == Some(Privilege::Admin)
            && from.is_some_and(|k| k != EntityKind::Host)
        {
            self.error(
                Code::AssociationType,
                format!("{at}.privilege"),
                "software uses its identity as `user`; only a host names `admin`",
            );
        }
        if matches!(r, Relation::Holds { .. })
            && privilege == Some(Privilege::Admin)
            && from.is_some_and(|k| k != EntityKind::Host)
        {
            self.error(
                Code::AssociationType,
                format!("{at}.privilege"),
                "software holds data as `user`; only a host holds it as `admin`",
            );
        }
        if let Relation::Holds {
            decrypts: None,
            from,
            to,
            ..
        } = r
        {
            self.incomplete(
                at,
                format!(
                    "say whether \"{from}\" sees \"{to}\" in plaintext: `decrypts: true | false`"
                ),
            );
        }
        if matches!(r, Relation::Stores { .. })
            && privilege == Some(Privilege::Admin)
            && from == Some(EntityKind::Application)
        {
            self.error(
                Code::AssociationType,
                format!("{at}.privilege"),
                "an application stores a credential as `user`; only a host stores one as `admin`",
            );
        }
    }

    /// Guest hosts follow their host upwards; returning to the start is a cycle,
    /// reported once, at the association that closes it from its first member.
    fn hosting_cycles(&mut self) {
        let m = self.m;
        let mut up: HashMap<&EntityId, (&EntityId, &AssociationId)> = HashMap::new();
        for (id, a) in &m.associations {
            if let Relation::Hosts { from, to, .. } = &a.relation
                && self.kind_of(to) == Some(EntityKind::Host)
            {
                up.entry(to).or_insert((from, id));
            }
        }
        let mut guests: Vec<&EntityId> = up.keys().copied().collect();
        guests.sort();
        let mut reported: HashSet<&EntityId> = HashSet::new();
        for start in guests {
            if reported.contains(start) {
                continue;
            }
            let mut chain = vec![start];
            let mut at = start;
            while let Some(&(host, _)) = up.get(at) {
                if host == start {
                    let names: Vec<&str> = chain.iter().map(|e| e.as_str()).collect();
                    let association = up[start].1;
                    self.error(
                        Code::Cycle,
                        format!("associations.{association}"),
                        format!("hosting runs in a circle: {} → {start}", names.join(" → ")),
                    );
                    reported.extend(chain.iter().copied());
                    break;
                }
                if chain.contains(&host) {
                    break;
                }
                chain.push(host);
                at = host;
            }
        }
    }

    /// The machine an executable runs on, if any.
    fn host_of(&self, executable: &EntityId) -> Option<&EntityId> {
        self.m
            .associations
            .values()
            .find_map(|a| match &a.relation {
                Relation::Hosts { from, to, .. } if to == executable => Some(from),
                _ => None,
            })
    }

    fn is_attached(&self, machine: &EntityId, network: &EntityId) -> bool {
        self.m.associations.values().any(|a| {
            matches!(&a.relation, Relation::Attached { from, to } if from == machine && to == network)
        })
    }

    fn firewall_of(&self, router: &EntityId) -> Option<&EntityId> {
        self.m
            .associations
            .values()
            .find_map(|a| match &a.relation {
                Relation::Filters { from, to } if from == router => Some(to),
                _ => None,
            })
    }

    fn permits(&self, firewall: &EntityId, flow: &FlowId) -> bool {
        self.m.associations.values().any(|a| {
            matches!(&a.relation, Relation::Permits { from, to, .. } if from == firewall && to == flow)
        })
    }

    fn flows(&mut self) {
        let m = self.m;
        for (id, flow) in &m.flows {
            let at = format!("flows.{id}");
            self.parameter(&flow.connect, &format!("{at}.parameters.connect"));
            let source = self.entity_of(
                &flow.source,
                &format!("{at}.source"),
                &[EntityKind::Application, EntityKind::Service],
            );
            let target = self.entity_of(
                &flow.target,
                &format!("{at}.target"),
                &[EntityKind::Service],
            );
            self.route(id, flow, &at, source.is_some(), target.is_some());
        }
    }

    fn route(&mut self, id: &FlowId, flow: &Flow, at: &str, source_ok: bool, target_ok: bool) {
        let route = &flow.route;
        let path = format!("{at}.route");
        // A route is built hop by hop: one that has not arrived yet is
        // unfinished, not wrong. Only a hop that cannot be right is an error.
        if route.is_empty() {
            self.unfinished(
                &path,
                "no route yet: name the networks and routers it crosses, starting where its source runs",
            );
            return;
        }
        let arrived = !route.len().is_multiple_of(2);
        if !arrived {
            self.unfinished(
                &path,
                "the route ends at a router: the network after it is still to come",
            );
        }
        let mut ok = true;
        let mut seen = HashSet::new();
        for (i, hop) in route.iter().enumerate() {
            let want = if i.is_multiple_of(2) {
                EntityKind::Network
            } else {
                EntityKind::Router
            };
            let here = format!("{path}[{i}]");
            match self.kind_of(hop) {
                None => {
                    self.error(
                        Code::UnknownReference,
                        here,
                        format!("\"{hop}\" is not an entity"),
                    );
                    ok = false;
                }
                Some(kind) if kind != want => {
                    self.error(
                        Code::InvalidRoute,
                        here,
                        format!(
                            "\"{hop}\" is a {}; this hop is a {}",
                            kind.as_str(),
                            want.as_str()
                        ),
                    );
                    ok = false;
                }
                Some(_) => {}
            }
            if !seen.insert(hop) {
                self.error(
                    Code::InvalidRoute,
                    format!("{path}[{i}]"),
                    format!(
                        "\"{hop}\" is already on this route; a different route is a different flow"
                    ),
                );
                ok = false;
            }
        }
        if !ok {
            return;
        }

        // The ends: the source's host in the first network, the target's in
        // the last. No host yet is incomplete. A source that does not run in
        // the first network is an error; a route that has not yet reached the
        // target's network is only unfinished.
        for (end, entity, index, ok) in [
            ("source", &flow.source, 0, source_ok),
            (
                "target",
                &flow.target,
                route.len() - 1,
                target_ok && arrived,
            ),
        ] {
            if !ok {
                continue;
            }
            let network = &route[index];
            match self.host_of(entity) {
                None => self.incomplete(
                    format!("{at}.{end}"),
                    format!(
                        "\"{entity}\" runs nowhere yet, so this flow cannot start or end at it"
                    ),
                ),
                Some(host) if !self.is_attached(host, network) && end == "source" => self.error(
                    Code::InvalidRoute,
                    format!("{path}[{index}]"),
                    format!(
                        "\"{host}\", which runs \"{entity}\", is not attached to \"{network}\""
                    ),
                ),
                Some(host) if !self.is_attached(host, network) => self.unfinished(
                    format!("{path}[{index}]"),
                    format!(
                        "the route has not reached \"{host}\", which runs \"{entity}\", yet: it ends at \"{network}\""
                    ),
                ),
                Some(_) => {}
            }
        }

        // Every router on the route sits on both networks around it (the one
        // after it, once there is one); one with a firewall has a permission
        // for this flow, one without lets it through.
        for i in (1..route.len()).step_by(2) {
            let router = &route[i];
            for side in [i - 1, i + 1] {
                let Some(network) = route.get(side) else {
                    continue;
                };
                if !self.is_attached(router, network) {
                    self.error(
                        Code::InvalidRoute,
                        format!("{path}[{i}]"),
                        format!("\"{router}\" is not attached to \"{network}\""),
                    );
                }
            }
            match self.firewall_of(router) {
                Some(firewall) if !self.permits(firewall, id) => self.unfinished(
                    format!("{path}[{i}]"),
                    format!(
                        "\"{firewall}\" has no `permits` association for this flow; it is neither allowed nor denied"
                    ),
                ),
                _ => {}
            }
        }
    }

    fn state_ref(&mut self, r: &StateRef, path: &str) {
        let Some(kind) = self
            .entity(&r.entity, &format!("{path}.entity"))
            .map(|e| e.kind)
        else {
            return;
        };
        if !kind.states().contains(&r.state) {
            let names: Vec<&str> = kind.states().iter().map(|s| s.as_str()).collect();
            let expected = if names.is_empty() {
                "it has no state an attacker holds".to_owned()
            } else {
                format!("expected {}", names.join(" or "))
            };
            self.error(
                Code::UnknownState,
                format!("{path}.state"),
                format!(
                    "\"{}\" is a {} and has no `{}` state; {expected}",
                    r.entity,
                    kind.as_str(),
                    r.state.as_str()
                ),
            );
        }
    }

    /// Every member an entity, in one cluster only, two or more a cluster.
    fn clusters(&mut self) {
        let m = self.m;
        let mut owner: HashMap<&EntityId, &ClusterId> = HashMap::new();
        for (id, cluster) in &m.clusters {
            let at = format!("clusters.{id}");
            if cluster.members.len() < 2 {
                self.error(
                    Code::Cardinality,
                    format!("{at}.members"),
                    "a cluster needs two members or more",
                );
            }
            for (i, member) in cluster.members.iter().enumerate() {
                let path = format!("{at}.members[{i}]");
                if self.entity(member, &path).is_none() {
                    continue;
                }
                if let Some(first) = owner.insert(member, id) {
                    let message = if first == id {
                        format!("\"{member}\" is listed twice")
                    } else {
                        format!("\"{member}\" is already in cluster \"{first}\"")
                    };
                    self.error(Code::Cardinality, path, message);
                }
            }
            let mut seen = HashSet::new();
            for (i, member) in cluster.shown.iter().enumerate() {
                let path = format!("{at}.shown[{i}]");
                if !cluster.members.contains(member) {
                    self.error(
                        Code::Cardinality,
                        path,
                        format!("\"{member}\" is not a member of this cluster"),
                    );
                } else if !seen.insert(member) {
                    self.error(
                        Code::Cardinality,
                        path,
                        format!("\"{member}\" is listed twice"),
                    );
                }
            }
        }
    }

    fn attacker(&mut self) {
        let m = self.m;
        let mut seen = HashSet::new();
        for (i, foothold) in m.attacker.footholds.iter().enumerate() {
            let at = format!("attacker.footholds[{i}]");
            self.state_ref(foothold, &at);
            if !seen.insert(foothold) {
                self.error(
                    Code::Cardinality,
                    at,
                    format!(
                        "{}.{} is already a foothold",
                        foothold.entity,
                        foothold.state.as_str()
                    ),
                );
            }
        }
        match &m.attacker.target {
            Some(target) => self.state_ref(target, "attacker.target"),
            None => self.incomplete(
                "attacker.target",
                "no target yet: nothing says which compromise to measure",
            ),
        }
        if m.attacker.footholds.is_empty() {
            self.incomplete(
                "attacker.footholds",
                "no foothold yet: the attacker starts nowhere",
            );
        }
    }

    fn scenarios(&mut self) {
        let m = self.m;
        for (id, scenario) in &m.scenarios {
            if let Some(profile) = &scenario.attacker
                && !(profile.speed.is_finite() && profile.speed > 0.0)
            {
                self.error(
                    Code::ParamDomain,
                    format!("scenarios.{id}.attacker.speed"),
                    "an attacker's speed is a number above 0: 2 is twice as fast, 0.5 half",
                );
            }
            let mut set: HashMap<String, usize> = HashMap::new();
            for (i, change) in scenario.changes.iter().enumerate() {
                let at = format!("scenarios.{id}.changes[{i}]");
                let key = match change {
                    Change::EntityDefense {
                        entity, defense, ..
                    } => {
                        if let Some(kind) =
                            self.entity(entity, &format!("{at}.entity")).map(|e| e.kind)
                            && kind.defense() != Some(*defense)
                        {
                            let has = kind
                                .defense()
                                .map_or("no defence".to_owned(), |d| format!("`{}`", d.as_str()));
                            self.error(
                                Code::UnknownState,
                                format!("{at}.defense"),
                                format!(
                                    "\"{entity}\" is a {} and has {has}, not `{}`",
                                    kind.as_str(),
                                    defense.as_str()
                                ),
                            );
                        }
                        format!("entities.{entity}.defenses.{}", defense.as_str())
                    }
                    Change::Permission { association, .. } => {
                        match m.associations.get(association).map(|a| a.relation.kind()) {
                            None => self.error(
                                Code::UnknownReference,
                                format!("{at}.association"),
                                format!("\"{association}\" is not an association"),
                            ),
                            Some(RelationKind::Permits) => {}
                            Some(kind) => self.error(
                                Code::AssociationType,
                                format!("{at}.association"),
                                format!(
                                    "\"{association}\" is a `{}` association; only `permits` has `allowed`",
                                    kind.as_str()
                                ),
                            ),
                        }
                        format!("associations.{association}.allowed")
                    }
                };
                if let Some(first) = set.insert(key.clone(), i) {
                    self.error(
                        Code::ConflictingChange,
                        at,
                        format!("`{key}` is already set by changes[{first}]; one scenario sets a switch once"),
                    );
                }
            }
        }
    }
}

// Keep the slot list honest: every slot belongs to some kind or to a flow.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::architecture::Slot;

    #[test]
    fn every_slot_has_an_owner() {
        for slot in Slot::ALL {
            let owned =
                slot == Slot::Connect || EntityKind::ALL.iter().any(|k| k.slots().contains(&slot));
            assert!(owned, "{}", slot.as_str());
        }
    }
}
