//! An architecture: typed components, their relationships and what an attacker
//! starts with. No attack step is written here; they are generated from the
//! component library the document pins, and the generated graph is a derived
//! artifact, never a second source of truth.
//!
//! The vocabulary is small and closed on purpose: eleven entity kinds,
//! nineteen association kinds, nine states. What a kind may carry — which parameter
//! slots, which defence switches, which states — is answered by the methods
//! here, so the reader, the validator and the writer agree on one answer.

use indexmap::IndexMap;

use crate::{
    Analysis, AssociationId, ClusterId, Distribution, EntityId, FlowId, Model, ScenarioId, TimeUnit,
};

/// One or the other; a text says which with `profile`.
// One document is held at a time, so the size gap between the two costs
// nothing; boxing would only add a dereference at every use.
#[allow(clippy::large_enum_variant)]
#[derive(Debug, Clone, PartialEq)]
pub enum Document {
    Tree(Model),
    Architecture(Architecture),
}

/// The one library this build bundles. A document pins it by id and version;
/// any other pin is refused before anything is generated.
pub const LIBRARY_ID: &str = "core-components";
pub const LIBRARY_VERSION: u32 = 1;

/// Hard limits. The reader lowers what the text says and the validator counts
/// it; what bounds the reading itself is the YAML tree's own limits.
pub const MAX_ENTITIES: usize = 500;
/// Associations and flows together.
pub const MAX_RELATIONSHIPS: usize = 2_000;
pub const MAX_SCENARIOS: usize = 16;
pub const MAX_SAMPLES: u64 = 100_000;

#[derive(Debug, Clone, PartialEq)]
pub struct Architecture {
    pub name: String,
    pub time_unit: TimeUnit,
    /// "Compromised" means: within this many time units.
    pub horizon: f64,
    pub library: LibraryPin,
    pub entities: IndexMap<EntityId, Entity>,
    pub associations: IndexMap<AssociationId, Association>,
    pub flows: IndexMap<FlowId, Flow>,
    /// Components shown as one node (clustering spec §2). A way of looking:
    /// nothing generated reads it.
    pub clusters: IndexMap<ClusterId, Cluster>,
    pub attacker: Attacker,
    pub scenarios: IndexMap<ScenarioId, Scenario>,
    pub analysis: Analysis,
}

impl Architecture {
    /// The empty document a new architecture starts from.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            time_unit: TimeUnit::Days,
            horizon: 100.0,
            library: LibraryPin::bundled(),
            entities: IndexMap::new(),
            associations: IndexMap::new(),
            flows: IndexMap::new(),
            clusters: IndexMap::new(),
            attacker: Attacker::default(),
            scenarios: IndexMap::new(),
            analysis: Analysis::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LibraryPin {
    pub id: String,
    pub version: u32,
}

impl LibraryPin {
    pub fn bundled() -> Self {
        Self {
            id: LIBRARY_ID.into(),
            version: LIBRARY_VERSION,
        }
    }

    pub fn is_bundled(&self) -> bool {
        self.id == LIBRARY_ID && self.version == LIBRARY_VERSION
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum EntityKind {
    Network,
    Router,
    Firewall,
    Host,
    Application,
    Service,
    Product,
    Account,
    Credential,
    Person,
    Data,
    AccessControl,
    Ids,
    Ips,
}

impl EntityKind {
    pub const ALL: [EntityKind; 14] = [
        Self::Network,
        Self::Router,
        Self::Firewall,
        Self::Host,
        Self::Application,
        Self::Service,
        Self::Product,
        Self::Account,
        Self::Credential,
        Self::Person,
        Self::Data,
        Self::AccessControl,
        Self::Ids,
        Self::Ips,
    ];

    /// The kebab-case spelling a document uses.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Network => "network",
            Self::Router => "router",
            Self::Firewall => "firewall",
            Self::Host => "host",
            Self::Application => "application",
            Self::Service => "service",
            Self::Product => "product",
            Self::Account => "account",
            Self::Credential => "credential",
            Self::Person => "person",
            Self::Data => "data",
            Self::AccessControl => "access-control",
            Self::Ids => "ids",
            Self::Ips => "ips",
        }
    }

    /// The states an attacker can hold or aim at on this kind, in the order a
    /// document lists them. A firewall and an account have none: what the
    /// attacker gets from them is generated, never declared.
    pub fn states(self) -> &'static [State] {
        match self {
            Self::Network => &[State::Access],
            Self::Router => &[State::Admin],
            Self::Account => &[State::Held],
            Self::Firewall | Self::Product | Self::AccessControl | Self::Ids | Self::Ips => &[],
            Self::Host => &[
                State::User,
                State::Admin,
                State::Physical,
                State::Usb,
                State::Unavailable,
            ],
            Self::Application => &[State::Control],
            Self::Service => &[State::Control, State::Unavailable],
            Self::Credential => &[State::Possessed],
            Self::Person => &[State::Contacted, State::Deceived],
            Self::Data => &[State::Read, State::Modified],
        }
    }

    /// The parameter slots this kind carries, in canonical order. Every one is
    /// written on a save, as `unknown` when the author has not said.
    pub fn slots(self) -> &'static [Slot] {
        match self {
            Self::Service => &[
                Slot::DeployExploit,
                Slot::DeployExploitAslr,
                Slot::DeployExploitDep,
                Slot::Deny,
                Slot::Login,
                Slot::TakeOver,
                Slot::TakeOverGuarded,
            ],
            Self::Application => &[Slot::DeployExploit, Slot::TakeOver, Slot::TakeOverGuarded],
            Self::Product => &[Slot::FindExploit, Slot::FindExploitPatched],
            Self::Credential => &[Slot::Extract, Slot::ExtractProtected],
            Self::Account => &[Slot::AdminLogin, Slot::MfaBypass],
            Self::Host => &[
                Slot::Escape,
                Slot::DeployExploit,
                Slot::DeployExploitAslr,
                Slot::DeployExploitDep,
                Slot::BypassAntimalware,
                Slot::Escalate,
                Slot::EscalateHardened,
                Slot::Physical,
                Slot::Usb,
                Slot::Deny,
            ],
            Self::Router => &[Slot::Escape],
            Self::Network => &[Slot::Poison],
            Self::Ids | Self::Ips => &[Slot::Bypass],
            Self::Person => &[Slot::Phish, Slot::PhishTrained],
            _ => &[],
        }
    }

    /// The defence switches this kind carries, in canonical order.
    pub fn defenses(self) -> &'static [Defense] {
        match self {
            Self::Product => &[Defense::Patched],
            Self::Account => &[Defense::Mfa],
            Self::Person => &[Defense::Trained],
            Self::Credential => &[Defense::Protected],
            Self::Application | Self::Service => &[Defense::Guarded],
            Self::Data => &[Defense::Encrypted],
            Self::Host => &[
                Defense::Aslr,
                Defense::AntiMalware,
                Defense::Dep,
                Defense::Hardened,
                Defense::HostFirewall,
                Defense::StaticArp,
            ],
            Self::Ids | Self::Ips => &[Defense::Enabled],
            _ => &[],
        }
    }

    /// Is this kind software — the `to` of `hosts`?
    pub fn is_executable(self) -> bool {
        matches!(self, Self::Application | Self::Service)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Privilege {
    User,
    Admin,
    /// Not known: only a host's `hosts` link to software may say so (what an
    /// nmap import writes). The steps that depend on it are unknown inputs.
    Unknown,
}

impl Privilege {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Admin => "admin",
            Self::Unknown => "unknown",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum State {
    Access,
    User,
    Admin,
    Control,
    Possessed,
    Contacted,
    Deceived,
    Read,
    Modified,
    Physical,
    Usb,
    Unavailable,
    Held,
}

impl State {
    /// Whether this state is optional on `kind`: added after files existed,
    /// its fact is drawn only where a foothold or the target names it or a
    /// step that produces it is drawn, so existing graphs keep their nodes.
    pub fn optional(self, kind: EntityKind) -> bool {
        matches!(
            (self, kind),
            (
                Self::Physical | Self::Usb | Self::Unavailable,
                EntityKind::Host
            ) | (Self::Unavailable, EntityKind::Service)
                | (Self::Held, EntityKind::Account)
        )
    }

    /// Whether a foothold may name it: everything but a denial, a goal only.
    pub fn may_start(self) -> bool {
        self != Self::Unavailable
    }

    /// Whether the target may name it: not an attacker input (being at the
    /// machine, plugged in, holding an account).
    pub fn may_aim(self) -> bool {
        !matches!(self, Self::Physical | Self::Usb | Self::Held)
    }

    pub const ALL: [State; 13] = [
        Self::Access,
        Self::User,
        Self::Admin,
        Self::Control,
        Self::Possessed,
        Self::Contacted,
        Self::Deceived,
        Self::Read,
        Self::Modified,
        Self::Physical,
        Self::Usb,
        Self::Unavailable,
        Self::Held,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Access => "access",
            Self::User => "user",
            Self::Admin => "admin",
            Self::Control => "control",
            Self::Possessed => "possessed",
            Self::Contacted => "contacted",
            Self::Deceived => "deceived",
            Self::Read => "read",
            Self::Modified => "modified",
            Self::Physical => "physical",
            Self::Usb => "usb",
            Self::Unavailable => "unavailable",
            Self::Held => "held",
        }
    }
}

/// A state of an entity: where an attacker starts, or what they are after.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct StateRef {
    pub entity: EntityId,
    pub state: State,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Attacker {
    pub footholds: Vec<StateRef>,
    pub target: Option<StateRef>,
}

/// A defence switch or a permission: on, off, or not said. "Not said" is not
/// a default of either; it makes the numbers that depend on it unavailable.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Switch {
    Unknown,
    On,
    Off,
}

impl Switch {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::On => "true",
            Self::Off => "false",
        }
    }
}

/// What the author claims for a parameter's value. `Calibrated` is the
/// author's claim of evidence, not a certificate from the app.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Evidence {
    Unknown,
    Illustrative,
    Assumed,
    Calibrated,
}

impl Evidence {
    pub const ALL: [Evidence; 4] = [
        Self::Unknown,
        Self::Illustrative,
        Self::Assumed,
        Self::Calibrated,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Unknown => "unknown",
            Self::Illustrative => "illustrative",
            Self::Assumed => "assumed",
            Self::Calibrated => "calibrated",
        }
    }
}

/// A parameter slot: one of the durations a generated action draws from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Slot {
    Connect,
    FindExploit,
    FindExploitPatched,
    DeployExploit,
    Login,
    Extract,
    ExtractProtected,
    AdminLogin,
    Escape,
    MfaBypass,
    Phish,
    PhishTrained,
    TakeOver,
    TakeOverGuarded,
    DeployExploitAslr,
    DeployExploitDep,
    Bypass,
    BypassAntimalware,
    Escalate,
    EscalateHardened,
    Physical,
    Usb,
    Deny,
    Poison,
}

impl Slot {
    /// Whether this slot is optional on `kind`: absent from a file, its step
    /// is not drawn (unknown would draw it and withhold the number). Slots
    /// added to a kind after files already existed are optional there, so
    /// those files keep their graphs.
    pub fn optional(self, kind: EntityKind) -> bool {
        matches!(
            (self, kind),
            (
                Self::DeployExploit,
                EntityKind::Host | EntityKind::Application
            ) | (
                Self::DeployExploitAslr | Self::DeployExploitDep,
                EntityKind::Host | EntityKind::Service
            ) | (
                Self::BypassAntimalware
                    | Self::Escalate
                    | Self::EscalateHardened
                    | Self::Physical
                    | Self::Usb
                    | Self::Deny,
                EntityKind::Host
            ) | (Self::Deny, EntityKind::Service)
                | (Self::Poison, EntityKind::Network)
        )
    }

    pub const ALL: [Slot; 24] = [
        Self::Connect,
        Self::FindExploit,
        Self::FindExploitPatched,
        Self::DeployExploit,
        Self::Login,
        Self::Extract,
        Self::ExtractProtected,
        Self::AdminLogin,
        Self::Escape,
        Self::MfaBypass,
        Self::Phish,
        Self::PhishTrained,
        Self::TakeOver,
        Self::TakeOverGuarded,
        Self::DeployExploitAslr,
        Self::DeployExploitDep,
        Self::Bypass,
        Self::BypassAntimalware,
        Self::Escalate,
        Self::EscalateHardened,
        Self::Physical,
        Self::Usb,
        Self::Deny,
        Self::Poison,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Connect => "connect",
            Self::FindExploit => "find-exploit",
            Self::FindExploitPatched => "find-exploit-patched",
            Self::DeployExploit => "deploy-exploit",
            Self::Login => "login",
            Self::Extract => "extract",
            Self::ExtractProtected => "extract-protected",
            Self::AdminLogin => "admin-login",
            Self::Escape => "escape",
            Self::MfaBypass => "mfa-bypass",
            Self::Phish => "phish",
            Self::PhishTrained => "phish-trained",
            Self::TakeOver => "take-over",
            Self::TakeOverGuarded => "take-over-guarded",
            Self::DeployExploitAslr => "deploy-exploit-aslr",
            Self::DeployExploitDep => "deploy-exploit-dep",
            Self::Bypass => "bypass",
            Self::BypassAntimalware => "bypass-antimalware",
            Self::Escalate => "escalate",
            Self::EscalateHardened => "escalate-hardened",
            Self::Physical => "physical",
            Self::Usb => "usb",
            Self::Deny => "deny",
            Self::Poison => "poison",
        }
    }
}

/// A duration and where it comes from. `Unknown` has no `ttc`; every other
/// status has one. A `note` says why; `Calibrated` must name its source.
#[derive(Debug, Clone, PartialEq)]
pub struct Parameter {
    pub status: Evidence,
    pub ttc: Option<Distribution>,
    pub note: Option<String>,
}

impl Parameter {
    pub fn unknown() -> Self {
        Self {
            status: Evidence::Unknown,
            ttc: None,
            note: None,
        }
    }
}

impl Default for Parameter {
    fn default() -> Self {
        Self::unknown()
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Defenses {
    /// A product: `find-exploit-patched` stands in for `find-exploit`.
    pub patched: Option<Switch>,
    /// A credential: `extract-protected` stands in for `extract`.
    pub protected: Option<Switch>,
    /// An account: a first factor alone no longer authenticates.
    pub mfa: Option<Switch>,
    /// A person: `phish-trained` stands in for `phish`.
    pub trained: Option<Switch>,
    /// Software that processes content: `take-over-guarded` stands in for
    /// `take-over`.
    pub guarded: Option<Switch>,
    /// Data: encrypted at rest; a holder that does not decrypt then gives up
    /// plaintext only with the key.
    pub encrypted: Option<Switch>,
    /// A host: `deploy-exploit-aslr` stands in for `deploy-exploit` on it and
    /// on its services. Absent is off.
    pub aslr: Option<Switch>,
    /// A host: `deploy-exploit-dep` stands in, unless ASLR is on. Absent is off.
    pub dep: Option<Switch>,
    /// A host: an exploit used there, or on a service it runs, gets past the
    /// anti-malware first. Absent is off.
    pub anti_malware: Option<Switch>,
    /// An IDS or IPS: while on, an exploit it watches gets past it first.
    pub enabled: Option<Switch>,
    /// A host: `escalate-hardened` stands in for `escalate`. Absent is off.
    pub hardened: Option<Switch>,
    /// A host: a flow into a service it runs needs its permission too.
    /// Absent is off.
    pub host_firewall: Option<Switch>,
    /// A host: ARP cache poisoning does not reach a flow both of whose ends
    /// keep static tables. Absent is off.
    pub static_arp: Option<Switch>,
}

impl Defenses {
    pub fn get(&self, defense: Defense) -> Option<Switch> {
        match defense {
            Defense::Patched => self.patched,
            Defense::Protected => self.protected,
            Defense::Mfa => self.mfa,
            Defense::Trained => self.trained,
            Defense::Guarded => self.guarded,
            Defense::Encrypted => self.encrypted,
            Defense::Aslr => self.aslr,
            Defense::Dep => self.dep,
            Defense::AntiMalware => self.anti_malware,
            Defense::Enabled => self.enabled,
            Defense::Hardened => self.hardened,
            Defense::HostFirewall => self.host_firewall,
            Defense::StaticArp => self.static_arp,
        }
    }

    pub fn set(&mut self, defense: Defense, value: Option<Switch>) {
        match defense {
            Defense::Patched => self.patched = value,
            Defense::Protected => self.protected = value,
            Defense::Mfa => self.mfa = value,
            Defense::Trained => self.trained = value,
            Defense::Guarded => self.guarded = value,
            Defense::Encrypted => self.encrypted = value,
            Defense::Aslr => self.aslr = value,
            Defense::Dep => self.dep = value,
            Defense::AntiMalware => self.anti_malware = value,
            Defense::Enabled => self.enabled = value,
            Defense::Hardened => self.hardened = value,
            Defense::HostFirewall => self.host_firewall = value,
            Defense::StaticArp => self.static_arp = value,
        }
    }
}

/// What a special application is (nmap import spec §2.2): a scanner, one
/// tool each. It changes nothing in generation; it says which menus the
/// application offers.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tool {
    Nmap,
    Masscan,
    Greenbone,
    Nuclei,
}

impl Tool {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Nmap => "nmap",
            Self::Masscan => "masscan",
            Self::Greenbone => "greenbone",
            Self::Nuclei => "nuclei",
        }
    }
}

/// What scans have asked a host, each with the day of the last scan that
/// asked (scan workflow spec §3). Generation never reads it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Asked {
    pub ports: Option<String>,
    pub products: Option<String>,
    pub route: Option<String>,
    pub connections: Option<String>,
}

impl Asked {
    /// The keys in the order the file writes them.
    pub const KEYS: [&'static str; 4] = ["ports", "products", "route", "connections"];

    pub fn get(&self, key: &str) -> Option<&str> {
        match key {
            "ports" => self.ports.as_deref(),
            "products" => self.products.as_deref(),
            "route" => self.route.as_deref(),
            "connections" => self.connections.as_deref(),
            _ => None,
        }
    }

    /// Sets a key of `KEYS`; any other is ignored.
    pub fn set(&mut self, key: &str, day: Option<String>) {
        match key {
            "ports" => self.ports = day,
            "products" => self.products = day,
            "route" => self.route = day,
            "connections" => self.connections = day,
            _ => {}
        }
    }

    pub fn is_empty(&self) -> bool {
        Self::KEYS.iter().all(|k| self.get(k).is_none())
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entity {
    pub kind: EntityKind,
    pub label: String,
    pub description: Option<String>,
    /// IP addresses of a host, CIDR ranges of a network; empty elsewhere.
    pub addresses: Vec<String>,
    /// DNS names of a host, in lower case (nuclei templates spec §8). Two
    /// hosts may bear one; empty elsewhere. Generation never reads them.
    pub names: Vec<String>,
    /// What identified a host in a scan: `mac:…`, `ssh-<keytype>:…` (nmap
    /// recipes spec §3.1). Two hosts may share one; empty elsewhere.
    pub identities: Vec<String>,
    /// The vendor nmap names for a host's MAC.
    pub vendor: Option<String>,
    /// `YYYY-MM-DD`: the start of the last scan that saw the host.
    pub seen: Option<String>,
    /// `YYYY-MM-DD`: a covered scan the host did not answer; gone once seen.
    pub missed: Option<String>,
    /// What scans have asked a host; empty elsewhere.
    pub asked: Asked,
    /// Only on an application.
    pub tool: Option<Tool>,
    pub parameters: IndexMap<Slot, Parameter>,
    pub defenses: Defenses,
}

impl Entity {
    /// An entity with every slot and switch its kind carries set to unknown.
    pub fn new(kind: EntityKind, label: impl Into<String>) -> Self {
        let mut entity = Self {
            kind,
            label: label.into(),
            description: None,
            addresses: Vec::new(),
            names: Vec::new(),
            identities: Vec::new(),
            vendor: None,
            seen: None,
            missed: None,
            asked: Asked::default(),
            tool: None,
            parameters: IndexMap::new(),
            defenses: Defenses::default(),
        };
        entity.materialize();
        entity
    }

    /// Fill in what the kind carries and the author left out, as unknown.
    pub fn materialize(&mut self) {
        for slot in self.kind.slots() {
            if !slot.optional(self.kind) {
                self.parameters.entry(*slot).or_default();
            }
        }
        for &defense in self.kind.defenses() {
            if !defense.optional(self.kind) && self.defenses.get(defense).is_none() {
                self.defenses.set(defense, Some(Switch::Unknown));
            }
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Association {
    pub relation: Relation,
    pub description: Option<String>,
}

/// A typed relationship. The extra field each kind carries is in its variant,
/// so a `hosts` without a privilege cannot exist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Relation {
    /// host/router → network: membership, not permission.
    Attached { from: EntityId, to: EntityId },
    /// host/router → application/service, at this privilege.
    Hosts {
        from: EntityId,
        to: EntityId,
        privilege: Privilege,
        /// Software only: controlling it does not control its machine (a
        /// sandbox, a locked-down container). False unless said.
        contained: bool,
    },
    /// router → firewall: a router has at most one, a firewall exactly one
    /// router. A router without one filters nothing.
    Filters { from: EntityId, to: EntityId },
    /// host/application → credential; a host at this privilege, an
    /// application always as user.
    Stores {
        from: EntityId,
        to: EntityId,
        privilege: Privilege,
    },
    /// credential → account: any one suffices.
    Authenticates {
        from: EntityId,
        to: EntityId,
        factor: Factor,
    },
    /// account → service: the service accepts this account.
    Authorizes { from: EntityId, to: EntityId },
    /// account → host/router/access control at this privilege; a router, or
    /// a router's access control, only as admin. A grant to an access
    /// control is a grant on the machine it controls access to.
    Grants {
        from: EntityId,
        to: EntityId,
        privilege: Privilege,
    },
    /// network → host/router: management access from that zone.
    Administration { from: EntityId, to: EntityId },
    /// firewall or host → flow: a named permission; a host's, for a flow
    /// into a service it runs, read while its host firewall is on.
    Permits {
        from: EntityId,
        to: FlowId,
        allowed: Switch,
    },
    /// service/host/application → product: which software version it runs
    /// (for a host, its operating system); at most one, exactly one for a
    /// service.
    InstanceOf { from: EntityId, to: EntityId },
    /// host/software → account: the workload's own identity; a host at this
    /// privilege, software as user.
    RunsAs {
        from: EntityId,
        to: EntityId,
        privilege: Privilege,
    },
    /// account → account: the first may become the second.
    Assumes { from: EntityId, to: EntityId },
    /// person → credential: what they could type into a fake login.
    Knows { from: EntityId, to: EntityId },
    /// person → application: the software they use.
    Operates { from: EntityId, to: EntityId },
    /// network → person/software: content from anyone in the zone reaches
    /// this reader.
    Delivers { from: EntityId, to: EntityId },
    /// host/software → data: where it lives, a host at this privilege,
    /// software as user; `decrypts` whether this holder sees plaintext. None
    /// is unsaid.
    Holds {
        from: EntityId,
        to: EntityId,
        privilege: Privilege,
        decrypts: Option<bool>,
    },
    /// account → data: what a session of the account may do with it.
    Accesses {
        from: EntityId,
        to: EntityId,
        mode: Mode,
    },
    /// data → credential: the key.
    EncryptedWith { from: EntityId, to: EntityId },
    /// software → data: content it reads, e.g. a retrieval corpus.
    Reads { from: EntityId, to: EntityId },
    /// host/router → access control: where accounts log in to the machine.
    /// One each way.
    ControlsAccess { from: EntityId, to: EntityId },
    /// host/router → IDS/IPS: a sensor on the machine's traffic — on a
    /// router the flows routed through it, on a host its own. Any number.
    Watches { from: EntityId, to: EntityId },
}

/// What an account may do with data.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Mode {
    Read,
    Write,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Read => "read",
            Self::Write => "write",
        }
    }
}

/// How a credential proves an account: alone, or as the second factor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Default)]
pub enum Factor {
    #[default]
    First,
    Second,
}

impl Factor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::First => "first",
            Self::Second => "second",
        }
    }
}

/// The association kinds, as a document spells them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum RelationKind {
    Attached,
    Hosts,
    Filters,
    Stores,
    Authenticates,
    Authorizes,
    Grants,
    Administration,
    Permits,
    InstanceOf,
    RunsAs,
    Assumes,
    Knows,
    Operates,
    Delivers,
    Holds,
    Accesses,
    EncryptedWith,
    Reads,
    ControlsAccess,
    Watches,
}

impl RelationKind {
    pub const ALL: [RelationKind; 21] = [
        Self::Attached,
        Self::Hosts,
        Self::Filters,
        Self::Stores,
        Self::Authenticates,
        Self::Authorizes,
        Self::Grants,
        Self::Administration,
        Self::Permits,
        Self::InstanceOf,
        Self::RunsAs,
        Self::Assumes,
        Self::Knows,
        Self::Operates,
        Self::Delivers,
        Self::Holds,
        Self::Accesses,
        Self::EncryptedWith,
        Self::Reads,
        Self::ControlsAccess,
        Self::Watches,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Attached => "attached",
            Self::Hosts => "hosts",
            Self::Filters => "filters",
            Self::Stores => "stores",
            Self::Authenticates => "authenticates",
            Self::Authorizes => "authorizes",
            Self::Grants => "grants",
            Self::Administration => "administration",
            Self::Permits => "permits",
            Self::InstanceOf => "instance-of",
            Self::RunsAs => "runs-as",
            Self::Assumes => "assumes",
            Self::Knows => "knows",
            Self::Operates => "operates",
            Self::Delivers => "delivers",
            Self::Holds => "holds",
            Self::Accesses => "accesses",
            Self::EncryptedWith => "encrypted-with",
            Self::Reads => "reads",
            Self::ControlsAccess => "controls-access",
            Self::Watches => "watches",
        }
    }

    /// Which kinds may stand at `from`.
    pub fn from_kinds(self) -> &'static [EntityKind] {
        use EntityKind as K;
        match self {
            Self::Attached | Self::Hosts | Self::ControlsAccess | Self::Watches => {
                &[K::Host, K::Router]
            }
            Self::Filters => &[K::Router],
            Self::Stores => &[K::Host, K::Application],
            Self::Authenticates => &[K::Credential],
            Self::Authorizes | Self::Grants => &[K::Account],
            Self::Administration => &[K::Network],
            Self::Permits => &[K::Firewall, K::Host],
            Self::InstanceOf => &[K::Service, K::Host, K::Application],
            Self::RunsAs => &[K::Host, K::Application, K::Service],
            Self::Assumes => &[K::Account],
            Self::Knows | Self::Operates => &[K::Person],
            Self::Delivers => &[K::Network],
            Self::Holds => &[K::Host, K::Application, K::Service],
            Self::Accesses => &[K::Account],
            Self::EncryptedWith => &[K::Data],
            Self::Reads => &[K::Application, K::Service],
        }
    }

    /// Which kinds may stand at `to`; `permits` points at a flow instead.
    pub fn to_kinds(self) -> &'static [EntityKind] {
        use EntityKind as K;
        match self {
            Self::Attached => &[K::Network],
            // A router or a guest host runs on a host too: an appliance's box, a VM, a container.
            Self::Hosts => &[K::Application, K::Service, K::Router, K::Host],
            Self::Filters => &[K::Firewall],
            Self::Stores => &[K::Credential],
            Self::Authenticates => &[K::Account],
            Self::Authorizes => &[K::Service],
            Self::Grants => &[K::Host, K::Router, K::AccessControl],
            Self::Administration => &[K::Host, K::Router],
            Self::ControlsAccess => &[K::AccessControl],
            Self::Watches => &[K::Ids, K::Ips],
            Self::Permits => &[],
            Self::InstanceOf => &[K::Product],
            Self::RunsAs | Self::Assumes => &[K::Account],
            Self::Knows => &[K::Credential],
            Self::Operates => &[K::Application],
            Self::Delivers => &[K::Person, K::Application, K::Service],
            Self::Holds | Self::Accesses | Self::Reads => &[K::Data],
            Self::EncryptedWith => &[K::Credential],
        }
    }

    /// The fields beside kind/from/to/description this kind of association has.
    pub fn fields(self) -> &'static [&'static str] {
        match self {
            Self::Permits => &["allowed"],
            Self::Authenticates => &["factor"],
            Self::Hosts => &["privilege", "contained"],
            Self::Holds => &["privilege", "decrypts"],
            Self::Accesses => &["mode"],
            k if k.has_privilege() => &["privilege"],
            _ => &[],
        }
    }

    pub fn has_privilege(self) -> bool {
        matches!(
            self,
            Self::Hosts | Self::Stores | Self::Grants | Self::RunsAs | Self::Holds
        )
    }
}

impl Relation {
    pub fn kind(&self) -> RelationKind {
        match self {
            Self::Attached { .. } => RelationKind::Attached,
            Self::Hosts { .. } => RelationKind::Hosts,
            Self::Filters { .. } => RelationKind::Filters,
            Self::Stores { .. } => RelationKind::Stores,
            Self::Authenticates { .. } => RelationKind::Authenticates,
            Self::Authorizes { .. } => RelationKind::Authorizes,
            Self::Grants { .. } => RelationKind::Grants,
            Self::Administration { .. } => RelationKind::Administration,
            Self::Permits { .. } => RelationKind::Permits,
            Self::InstanceOf { .. } => RelationKind::InstanceOf,
            Self::RunsAs { .. } => RelationKind::RunsAs,
            Self::Assumes { .. } => RelationKind::Assumes,
            Self::Knows { .. } => RelationKind::Knows,
            Self::Operates { .. } => RelationKind::Operates,
            Self::Delivers { .. } => RelationKind::Delivers,
            Self::Holds { .. } => RelationKind::Holds,
            Self::Accesses { .. } => RelationKind::Accesses,
            Self::EncryptedWith { .. } => RelationKind::EncryptedWith,
            Self::Reads { .. } => RelationKind::Reads,
            Self::ControlsAccess { .. } => RelationKind::ControlsAccess,
            Self::Watches { .. } => RelationKind::Watches,
        }
    }

    pub fn from(&self) -> &EntityId {
        match self {
            Self::Attached { from, .. }
            | Self::Hosts { from, .. }
            | Self::Filters { from, .. }
            | Self::Stores { from, .. }
            | Self::Authenticates { from, .. }
            | Self::Authorizes { from, .. }
            | Self::Grants { from, .. }
            | Self::Administration { from, .. }
            | Self::Permits { from, .. }
            | Self::InstanceOf { from, .. }
            | Self::RunsAs { from, .. }
            | Self::Assumes { from, .. }
            | Self::Knows { from, .. }
            | Self::Operates { from, .. }
            | Self::Delivers { from, .. }
            | Self::Holds { from, .. }
            | Self::Accesses { from, .. }
            | Self::EncryptedWith { from, .. }
            | Self::Reads { from, .. }
            | Self::ControlsAccess { from, .. }
            | Self::Watches { from, .. } => from,
        }
    }

    /// The entity at `to`; `None` for `permits`, whose `to` is a flow.
    pub fn to_entity(&self) -> Option<&EntityId> {
        match self {
            Self::Attached { to, .. }
            | Self::Hosts { to, .. }
            | Self::Filters { to, .. }
            | Self::Stores { to, .. }
            | Self::Authenticates { to, .. }
            | Self::Authorizes { to, .. }
            | Self::Grants { to, .. }
            | Self::Administration { to, .. }
            | Self::InstanceOf { to, .. }
            | Self::RunsAs { to, .. }
            | Self::Assumes { to, .. }
            | Self::Knows { to, .. }
            | Self::Operates { to, .. }
            | Self::Delivers { to, .. }
            | Self::Holds { to, .. }
            | Self::Accesses { to, .. }
            | Self::EncryptedWith { to, .. }
            | Self::Reads { to, .. }
            | Self::ControlsAccess { to, .. }
            | Self::Watches { to, .. } => Some(to),
            Self::Permits { .. } => None,
        }
    }

    pub fn privilege(&self) -> Option<Privilege> {
        match self {
            Self::Hosts { privilege, .. }
            | Self::Stores { privilege, .. }
            | Self::Grants { privilege, .. }
            | Self::RunsAs { privilege, .. }
            | Self::Holds { privilege, .. } => Some(*privilege),
            _ => None,
        }
    }
}

/// One direction of traffic: from software on one machine to a service, over
/// a declared route of networks and routers.
#[derive(Debug, Clone, PartialEq)]
pub struct Flow {
    pub label: String,
    pub source: EntityId,
    pub target: EntityId,
    /// Odd length, alternating network and router: `[zone]` within one zone.
    pub route: Vec<EntityId>,
    /// Descriptive only, such as `tcp/22`: it infers nothing.
    pub protocol: Option<String>,
    /// Encrypted on the wire: interception gives nothing away. False unless
    /// said; written only when true.
    pub encrypted: bool,
    /// Credentials the flow carries, which ARP cache poisoning on its route
    /// can take; empty unless said, and then not written.
    pub carries: Vec<EntityId>,
    pub connect: Parameter,
}

/// Components drawn as one node, open or closed. Each entity is in at most
/// one cluster; a cluster has two members or more.
#[derive(Debug, Clone, PartialEq)]
pub struct Cluster {
    pub label: Option<String>,
    pub members: Vec<EntityId>,
    /// Members of a closed cluster drawn beside it, inside its outline.
    pub shown: Vec<EntityId>,
    pub closed: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Defense {
    Patched,
    Protected,
    Mfa,
    Trained,
    Guarded,
    Encrypted,
    Aslr,
    Dep,
    AntiMalware,
    Enabled,
    Hardened,
    HostFirewall,
    StaticArp,
}

impl Defense {
    /// Whether this switch is optional on `kind`: absent from a file it is
    /// off, and it is neither filled in nor written. Switches added to a kind
    /// after files already existed are optional there, so those files keep
    /// their graphs and numbers.
    pub fn optional(self, kind: EntityKind) -> bool {
        matches!(
            (self, kind),
            (
                Self::Aslr
                    | Self::Dep
                    | Self::AntiMalware
                    | Self::Hardened
                    | Self::HostFirewall
                    | Self::StaticArp,
                EntityKind::Host
            )
        )
    }

    pub const ALL: [Defense; 13] = [
        Self::Patched,
        Self::Protected,
        Self::Mfa,
        Self::Trained,
        Self::Guarded,
        Self::Encrypted,
        Self::Aslr,
        Self::Dep,
        Self::AntiMalware,
        Self::Enabled,
        Self::Hardened,
        Self::HostFirewall,
        Self::StaticArp,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Patched => "patched",
            Self::Protected => "protected",
            Self::Mfa => "mfa",
            Self::Trained => "trained",
            Self::Guarded => "guarded",
            Self::Encrypted => "encrypted",
            Self::Aslr => "aslr",
            Self::Dep => "dep",
            Self::AntiMalware => "anti-malware",
            Self::Enabled => "enabled",
            Self::Hardened => "hardened",
            Self::HostFirewall => "host-firewall",
            Self::StaticArp => "static-arp",
        }
    }
}

/// One switch set to one value, on top of the architecture as written.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Change {
    EntityDefense {
        entity: EntityId,
        defense: Defense,
        value: Switch,
    },
    Permission {
        association: AssociationId,
        value: Switch,
    },
}

/// A named overlay of changes; scenarios do not inherit from one another.
#[derive(Debug, Clone, PartialEq)]
pub struct Scenario {
    pub label: String,
    /// Who attacks, when not the attacker the parameters were written for.
    pub attacker: Option<AttackerProfile>,
    pub changes: Vec<Change>,
}

/// An attacker who does every timed step `speed` times as fast: each sampled
/// time is divided by it. Which steps exist, their chances of success and the
/// steps that take no time stay as they are.
#[derive(Debug, Clone, PartialEq)]
pub struct AttackerProfile {
    pub speed: f64,
}
