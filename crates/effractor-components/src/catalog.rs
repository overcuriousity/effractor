//! The machine-readable description of `core-components@1`. The UI reads it
//! through wasm to know what can be built and what each generated step rests
//! on; nothing in it is a number an attack takes — a library has no invented
//! durations, only the slots an author fills.

use effractor_core::architecture::{
    self, Defense, EntityKind, MAX_ENTITIES, MAX_RELATIONSHIPS, MAX_SAMPLES, MAX_SCENARIOS,
    RelationKind, Slot, State,
};
use serde_json::{Value, json};

pub use architecture::{LIBRARY_ID, LIBRARY_VERSION};

/// The graph's own limits: counted before a node is allocated.
pub const MAX_GENERATED_NODES: usize = 5_000;
pub const MAX_GENERATED_DEPENDENCIES: usize = 20_000;

/// How long a rule's step takes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Duration {
    /// Zero by definition: the attacker's declared start.
    Zero,
    /// Zero by rule definition: a logical consequence, not an estimate.
    Logical,
    /// Drawn from an authored slot; `replaced_by` names the slot a defence
    /// switch selects instead, and the switch that does so.
    Slot {
        slot: Slot,
        replaced_by: Option<(Defense, Slot)>,
    },
}

/// One rule of the library: what it binds, what it needs, what it yields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Rule {
    pub id: &'static str,
    /// What the page calls it.
    pub title: &'static str,
    pub version: u32,
    /// The source ids a generated step's identity is built from, in order.
    pub bindings: &'static [&'static str],
    pub prerequisites: &'static str,
    pub output: &'static str,
    pub duration: Duration,
    /// One action per what: the sampling scope.
    pub scope: &'static str,
    pub assumptions: &'static [&'static str],
}

use Duration as D;

pub const RULES: [Rule; 20] = [
    Rule {
        id: "foothold",
        title: "The attacker starts here",
        version: 1,
        bindings: &["entity", "state"],
        prerequisites: "a declared foothold",
        output: "the named state, attained at time zero",
        duration: D::Zero,
        scope: "one per declared foothold",
        assumptions: &[
            "A foothold is an attacker input, never an estimate of an initial compromise.",
        ],
    },
    Rule {
        id: "admin-implies-user",
        title: "Admin control includes user control",
        version: 1,
        bindings: &["host"],
        prerequisites: "host.admin",
        output: "host.user",
        duration: D::Logical,
        scope: "one per host",
        assumptions: &["Administrative control of a host includes everything a user can do on it."],
    },
    Rule {
        id: "host-execution",
        title: "Controlling a machine controls its software",
        version: 1,
        bindings: &["hosts"],
        prerequisites: "the hosting machine at the executable's declared privilege (admin also satisfies user)",
        output: "executable.control",
        duration: D::Logical,
        scope: "one per hosts association",
        assumptions: &[
            "Controlling a machine at the privilege software runs with is controlling that software.",
            "Router-hosted executables run as admin: this library has no router user state.",
        ],
    },
    Rule {
        id: "execution-privilege",
        title: "Controlled software acts with its privilege",
        version: 1,
        bindings: &["hosts"],
        prerequisites: "executable.control",
        output: "the hosting machine at the executable's declared privilege",
        duration: D::Logical,
        scope: "one per hosts association",
        assumptions: &[
            "Controlling software yields the privilege it runs with and no more: user software never alone grants admin.",
        ],
    },
    Rule {
        id: "hosted-router",
        title: "Controlling the host controls its router",
        version: 1,
        bindings: &["hosts"],
        prerequisites: "the hosting host at the router's declared privilege (admin also satisfies user)",
        output: "router.admin",
        duration: D::Logical,
        scope: "one per hosts association naming a router",
        assumptions: &[
            "Whoever controls the machine a router runs on, at the privilege it runs with, controls the router.",
            "Leaving the router for its host is its own timed step, the router's escape.",
        ],
    },
    Rule {
        id: "hosted-host",
        title: "Controlling the host controls its guests",
        version: 1,
        bindings: &["hosts"],
        prerequisites: "the hosting host at the guest's declared privilege (admin also satisfies user)",
        output: "guest host.admin",
        duration: D::Logical,
        scope: "one per hosts association naming a host",
        assumptions: &[
            "Whoever controls a hypervisor or container host at the privilege a guest runs with controls the guest.",
        ],
    },
    Rule {
        id: "guest-escape",
        title: "Escape to the host",
        version: 1,
        bindings: &["hosts"],
        prerequisites: "guest host.admin",
        output: "the hosting host at the guest's declared privilege",
        duration: D::Slot {
            slot: Slot::Escape,
            replaced_by: None,
        },
        scope: "one per guest host",
        assumptions: &[
            "Breaking out of a virtual machine or container is one timed step; hardening it is an edit of that time.",
        ],
    },
    Rule {
        id: "router-escape",
        title: "Escape from the router to its host",
        version: 1,
        bindings: &["hosts"],
        prerequisites: "router.admin, for a router that runs on a host",
        output: "the hosting host at the router's declared privilege",
        duration: D::Slot {
            slot: Slot::Escape,
            replaced_by: None,
        },
        scope: "one per hosted router",
        assumptions: &["Leaving a router VM or appliance for its host is one timed step."],
    },
    Rule {
        id: "zone-access",
        title: "A controlled machine reaches its networks",
        version: 1,
        bindings: &["attached"],
        prerequisites: "host.user or router.admin, for a machine attached to the network",
        output: "network.access",
        duration: D::Logical,
        scope: "one per attached association",
        assumptions: &[
            "Access to a network is the capability to originate traffic in it, not control of its members.",
        ],
    },
    Rule {
        id: "flow-permission",
        title: "The firewall lets the flow through",
        version: 1,
        bindings: &["permits"],
        prerequisites: "the permission's policy allows the flow, or the managing router is under admin control",
        output: "the flow's permission at that firewall, satisfied",
        duration: D::Logical,
        scope: "one per permits association",
        assumptions: &[
            "A router's admin can bypass its firewall for an explicitly modelled flow.",
            "An unknown policy is an unknown branch, not a denial.",
        ],
    },
    Rule {
        id: "flow-connect",
        title: "Connect along the flow",
        version: 1,
        bindings: &["flow"],
        prerequisites: "source.control and every permission along the route",
        output: "flow.connected",
        duration: D::Slot {
            slot: Slot::Connect,
            replaced_by: None,
        },
        scope: "one per flow",
        assumptions: &[
            "The route is checked statically; there is no discovery of IP routes, NAT or transitive trust.",
        ],
    },
    Rule {
        id: "service-reachable",
        title: "A connection reaches the service",
        version: 1,
        bindings: &["service"],
        prerequisites: "any inbound flow.connected",
        output: "service.reachable",
        duration: D::Logical,
        scope: "one per service",
        assumptions: &["Reaching a service is not controlling it."],
    },
    Rule {
        id: "product-reachable",
        title: "An instance is reachable",
        version: 1,
        bindings: &["instance-of"],
        prerequisites: "service.reachable, for any instance of the product",
        output: "product.reachable",
        duration: D::Logical,
        scope: "one per instance-of association",
        assumptions: &["Any one reachable instance is enough to study the software version."],
    },
    Rule {
        id: "product-find-exploit",
        title: "Find an exploit",
        version: 1,
        bindings: &["product"],
        prerequisites: "product.reachable",
        output: "product.exploit-ready",
        duration: D::Slot {
            slot: Slot::FindExploit,
            replaced_by: Some((Defense::Patched, Slot::FindExploitPatched)),
        },
        scope: "one per product",
        assumptions: &[
            "Patching selects the authored replacement distribution; it does not by itself eliminate every exploit.",
            "An exploit found through one instance works on every instance of the same version; a partly patched fleet is two products.",
        ],
    },
    Rule {
        id: "service-deploy-exploit",
        title: "Use the exploit",
        version: 1,
        bindings: &["service"],
        prerequisites: "product.exploit-ready and the service's own reachable",
        output: "service.control",
        duration: D::Slot {
            slot: Slot::DeployExploit,
            replaced_by: None,
        },
        scope: "one per service",
        assumptions: &[
            "Deployment includes whatever bypass of detection or protection the author assumed in its note; there is no unreported extra success factor.",
        ],
    },
    Rule {
        id: "credential-extract",
        title: "Extract a credential",
        version: 1,
        bindings: &["stores"],
        prerequisites: "the storing host at the store's privilege, or the storing application under control",
        output: "credential.possessed",
        duration: D::Slot {
            slot: Slot::Extract,
            replaced_by: Some((Defense::Protected, Slot::ExtractProtected)),
        },
        scope: "one per stores association",
        assumptions: &[
            "Protection selects the authored replacement distribution, not a guarantee.",
            "Possession requires an extraction action even from a controlled store.",
        ],
    },
    Rule {
        id: "account-material",
        title: "A held credential unlocks its account",
        version: 1,
        bindings: &["authenticates"],
        prerequisites: "credential.possessed",
        output: "account.material",
        duration: D::Logical,
        scope: "one per authenticates association",
        assumptions: &[
            "Any one authenticating credential suffices; multi-factor authentication is outside this library.",
            "Material alone grants no access.",
        ],
    },
    Rule {
        id: "service-login",
        title: "Log in to a service",
        version: 1,
        bindings: &["authorizes"],
        prerequisites: "service.reachable and account.material, for an account the service authorizes",
        output: "account.session at that service",
        duration: D::Slot {
            slot: Slot::Login,
            replaced_by: None,
        },
        scope: "one per account and service",
        assumptions: &["Retries and account lockout are outside this library."],
    },
    Rule {
        id: "session-grant",
        title: "A login gives the account's rights",
        version: 1,
        bindings: &["authorizes", "grants"],
        prerequisites: "account.session at a service, and a grant on the machine that hosts that service",
        output: "the hosting machine at the granted privilege",
        duration: D::Logical,
        scope: "one per matching session and grant",
        assumptions: &[
            "A grant is used only on the machine the service actually runs on; a login on one machine is never control of another.",
        ],
    },
    Rule {
        id: "administration-login",
        title: "Admin login from a network",
        version: 1,
        bindings: &["administration", "grants"],
        prerequisites: "access to the administering network and account.material, for an account granted on the managed machine",
        output: "the managed machine at the granted privilege",
        duration: D::Slot {
            slot: Slot::AdminLogin,
            replaced_by: None,
        },
        scope: "one per administration and grant pair",
        assumptions: &[
            "An administration association is explicit permission to attempt management authentication, not a successful login.",
            "An isolated administration zone is not reached just because it administers something.",
        ],
    },
];

fn kind_description(kind: EntityKind) -> &'static str {
    match kind {
        EntityKind::Network => {
            "A network or security zone. `access` means an attacker can originate traffic there, not that every member is compromised."
        }
        EntityKind::Router => {
            "A forwarding and management device. `admin` means administrative control."
        }
        EntityKind::Firewall => {
            "The filter managed by one router. Its permissions apply to named flows."
        }
        EntityKind::Host => "A workstation or server. `user` and `admin` control are distinct.",
        EntityKind::Application => "Client-side software running on a host or router.",
        EntityKind::Service => {
            "A reachable service running on a host or router, with exploit and login routes."
        }
        EntityKind::Product => {
            "One software version, e.g. OpenSSH 9.6. Its services share one exploit discovery; patching is set here."
        }
        EntityKind::Account => {
            "An identity with explicit authentication and grants; no implicit global privileges."
        }
        EntityKind::Credential => {
            "A description of authentication material; `possessed` is the attacker holding it. Never the secret itself."
        }
    }
}

fn relation_description(kind: RelationKind) -> &'static str {
    match kind {
        RelationKind::Attached => {
            "Membership of a network; a machine can be attached to several. Implies no flow permission."
        }
        RelationKind::Hosts => {
            "The machine an executable, a router or a guest host runs on, at `privilege: user | admin`. Each has one host; a router or a guest runs only on a host."
        }
        RelationKind::Filters => "The firewall a router manages: one each way.",
        RelationKind::Stores => {
            "Where a credential is kept: a host at `privilege: user | admin`, an application as `user`. Possession still takes an extraction."
        }
        RelationKind::Authenticates => {
            "A credential that authenticates an account; any one suffices."
        }
        RelationKind::Authorizes => "A service that accepts this account for login.",
        RelationKind::Grants => {
            "What an account gets on a host (`user | admin`) or router (`admin` only)."
        }
        RelationKind::Administration => {
            "Management access to a machine from a network, independent of ordinary forwarding."
        }
        RelationKind::Permits => {
            "A firewall's named permission for a flow: `allowed: true | false | unknown`."
        }
        RelationKind::InstanceOf => "The software version a service runs: exactly one product.",
    }
}

/// One line a newcomer can tell the kinds apart by.
fn kind_meaning(kind: EntityKind) -> &'static str {
    match kind {
        EntityKind::Network => {
            "A network or zone. Being in it means the attacker can send traffic there."
        }
        EntityKind::Router => "Forwards traffic between networks and can be administered.",
        EntityKind::Firewall => "A router's filter: which flows it lets through.",
        EntityKind::Host => {
            "A machine: a workstation, a server, a virtual machine or a container. It may run on another host."
        }
        EntityKind::Application => {
            "Software that makes connections, e.g. a browser or mail client. Reached only through what it opens."
        }
        EntityKind::Service => {
            "Software that accepts connections, e.g. a web server or SSH. Exploited or logged into over the network."
        }
        EntityKind::Product => {
            "A software version. Every service that is an instance of it shares its vulnerabilities."
        }
        EntityKind::Account => "An identity that services accept and that has rights on machines.",
        EntityKind::Credential => {
            "What proves an account, e.g. a password or key. Must be extracted from where it is kept."
        }
    }
}

/// A state as the page and generated labels say it.
pub(crate) fn state_word(state: State) -> &'static str {
    match state {
        State::Access => "access",
        State::User => "user control",
        State::Admin => "admin control",
        State::Control => "controlled",
        State::Possessed => "held",
    }
}

/// A parameter as the page names it.
fn slot_name(slot: Slot) -> &'static str {
    match slot {
        Slot::Connect => "Connect",
        Slot::FindExploit => "Find an exploit",
        Slot::FindExploitPatched => "Find an exploit (patched)",
        Slot::DeployExploit => "Use the exploit",
        Slot::Login => "Log in",
        Slot::Extract => "Extract",
        Slot::ExtractProtected => "Extract (protected)",
        Slot::AdminLogin => "Admin login",
        Slot::Escape => "Escape to the host",
    }
}

fn state_description(state: State) -> &'static str {
    match state {
        State::Access => "Traffic can be originated in this network.",
        State::User => "User-level control of this machine.",
        State::Admin => "Administrative control of this machine.",
        State::Control => "This software does what the attacker says.",
        State::Possessed => "The attacker holds this credential.",
    }
}

fn slot_description(slot: Slot) -> (&'static str, &'static str) {
    match slot {
        Slot::Connect => (
            "flow",
            "Time to establish the flow once its source is controlled and its route permitted.",
        ),
        Slot::FindExploit => (
            "product",
            "Time to find a usable exploit for a software version, once an instance is reachable.",
        ),
        Slot::FindExploitPatched => (
            "product",
            "The same, once the product is patched; selected by `defenses.patched`.",
        ),
        Slot::DeployExploit => (
            "service",
            "Time to turn a found exploit into control of the service.",
        ),
        Slot::Login => (
            "service",
            "Time to log in with an account's material, once the service is reachable.",
        ),
        Slot::Extract => (
            "credential",
            "Time to extract the credential from a store the attacker controls.",
        ),
        Slot::ExtractProtected => (
            "credential",
            "The same, once the store is protected; selected by `defenses.protected`.",
        ),
        Slot::AdminLogin => (
            "account",
            "Time to authenticate to a machine's management from an administering network.",
        ),
        Slot::Escape => (
            "host or router",
            "Time to break out of a virtual machine, container or appliance to the host it runs on, once in admin control of it.",
        ),
    }
}

fn duration(d: Duration) -> Value {
    match d {
        D::Zero => json!({"kind": "zero"}),
        D::Logical => json!({"kind": "logical"}),
        D::Slot { slot, replaced_by } => json!({
            "kind": "slot",
            "slot": slot.as_str(),
            "replaced_by": replaced_by.map(|(defense, slot)| json!({
                "defense": defense.as_str(),
                "slot": slot.as_str(),
            })),
        }),
    }
}

/// The catalog as JSON: `library`, `entities`, `associations`, `states`,
/// `parameters`, `rules` and `limits`.
pub fn catalog() -> Value {
    let entities: Vec<Value> = EntityKind::ALL
        .iter()
        .map(|&kind| {
            json!({
                "kind": kind.as_str(),
                "description": kind_description(kind),
                "meaning": kind_meaning(kind),
                "states": kind.states().iter().map(|s| s.as_str()).collect::<Vec<_>>(),
                "parameters": kind.slots().iter().map(|s| s.as_str()).collect::<Vec<_>>(),
                "defense": kind.defense().map(Defense::as_str),
            })
        })
        .collect();
    let associations: Vec<Value> = RelationKind::ALL
        .iter()
        .map(|&kind| {
            let field = if kind.has_privilege() {
                Some("privilege")
            } else if kind == RelationKind::Permits {
                Some("allowed")
            } else {
                None
            };
            json!({
                "kind": kind.as_str(),
                "from": kind.from_kinds().iter().map(|k| k.as_str()).collect::<Vec<_>>(),
                "to": if kind == RelationKind::Permits {
                    json!(["flow"])
                } else {
                    json!(kind.to_kinds().iter().map(|k| k.as_str()).collect::<Vec<_>>())
                },
                "field": field,
                "description": relation_description(kind),
            })
        })
        .collect();
    let states: Vec<Value> = State::ALL
        .iter()
        .map(|&s| json!({"id": s.as_str(), "word": state_word(s), "description": state_description(s)}))
        .collect();
    let parameters: Vec<Value> = Slot::ALL
        .iter()
        .map(|&slot| {
            let (owner, description) = slot_description(slot);
            json!({"slot": slot.as_str(), "name": slot_name(slot), "owner": owner, "description": description})
        })
        .collect();
    let rules: Vec<Value> = RULES
        .iter()
        .map(|r| {
            json!({
                "id": r.id,
                "title": r.title,
                "version": r.version,
                "bindings": r.bindings,
                "prerequisites": r.prerequisites,
                "output": r.output,
                "duration": duration(r.duration),
                "scope": r.scope,
                "assumptions": r.assumptions,
            })
        })
        .collect();
    json!({
        "library": {"id": LIBRARY_ID, "version": LIBRARY_VERSION},
        "entities": entities,
        "associations": associations,
        "states": states,
        "parameters": parameters,
        "rules": rules,
        "limits": {
            "entities": MAX_ENTITIES,
            "relationships": MAX_RELATIONSHIPS,
            "generated_nodes": MAX_GENERATED_NODES,
            "generated_dependencies": MAX_GENERATED_DEPENDENCIES,
            "samples": MAX_SAMPLES,
            "scenarios": MAX_SCENARIOS,
        },
    })
}
