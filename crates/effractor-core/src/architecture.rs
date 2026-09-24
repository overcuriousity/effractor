//! An architecture: typed components, their relationships and what an attacker
//! starts with. No attack step is written here; they are generated from the
//! component library the document pins, and the generated graph is a derived
//! artifact, never a second source of truth.
//!
//! The vocabulary is small and closed on purpose: ten entity kinds, fifteen
//! association kinds, seven states. What a kind may carry — which parameter
//! slots, which defence switches, which states — is answered by the methods
//! here, so the reader, the validator and the writer agree on one answer.

use indexmap::IndexMap;

use crate::{Analysis, AssociationId, Distribution, EntityId, FlowId, Model, ScenarioId, TimeUnit};

/// One or the other; a text says which with `profile`.
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
}

impl EntityKind {
    pub const ALL: [EntityKind; 10] = [
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
        }
    }

    /// The states an attacker can hold or aim at on this kind, in the order a
    /// document lists them. A firewall and an account have none: what the
    /// attacker gets from them is generated, never declared.
    pub fn states(self) -> &'static [State] {
        match self {
            Self::Network => &[State::Access],
            Self::Router => &[State::Admin],
            Self::Firewall | Self::Account | Self::Product => &[],
            Self::Host => &[State::User, State::Admin],
            Self::Application | Self::Service => &[State::Control],
            Self::Credential => &[State::Possessed],
            Self::Person => &[State::Contacted, State::Deceived],
        }
    }

    /// The parameter slots this kind carries, in canonical order. Every one is
    /// written on a save, as `unknown` when the author has not said.
    pub fn slots(self) -> &'static [Slot] {
        match self {
            Self::Service => &[
                Slot::DeployExploit,
                Slot::Login,
                Slot::TakeOver,
                Slot::TakeOverGuarded,
            ],
            Self::Application => &[Slot::TakeOver, Slot::TakeOverGuarded],
            Self::Product => &[Slot::FindExploit, Slot::FindExploitPatched],
            Self::Credential => &[Slot::Extract, Slot::ExtractProtected],
            Self::Account => &[Slot::AdminLogin, Slot::MfaBypass],
            Self::Host | Self::Router => &[Slot::Escape],
            Self::Person => &[Slot::Phish, Slot::PhishTrained],
            _ => &[],
        }
    }

    /// The defence switch this kind carries, if any.
    pub fn defense(self) -> Option<Defense> {
        match self {
            Self::Product => Some(Defense::Patched),
            Self::Account => Some(Defense::Mfa),
            Self::Person => Some(Defense::Trained),
            Self::Credential => Some(Defense::Protected),
            Self::Application | Self::Service => Some(Defense::Guarded),
            _ => None,
        }
    }

    /// Can this kind run software — be the `from` of `hosts`?
    pub fn is_machine(self) -> bool {
        matches!(self, Self::Host | Self::Router)
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
}

impl Privilege {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::User => "user",
            Self::Admin => "admin",
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
}

impl State {
    pub const ALL: [State; 7] = [
        Self::Access,
        Self::User,
        Self::Admin,
        Self::Control,
        Self::Possessed,
        Self::Contacted,
        Self::Deceived,
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
}

impl Slot {
    pub const ALL: [Slot; 14] = [
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
}

impl Defenses {
    pub fn get(&self, defense: Defense) -> Option<Switch> {
        match defense {
            Defense::Patched => self.patched,
            Defense::Protected => self.protected,
            Defense::Mfa => self.mfa,
            Defense::Trained => self.trained,
            Defense::Guarded => self.guarded,
        }
    }

    pub fn set(&mut self, defense: Defense, value: Option<Switch>) {
        match defense {
            Defense::Patched => self.patched = value,
            Defense::Protected => self.protected = value,
            Defense::Mfa => self.mfa = value,
            Defense::Trained => self.trained = value,
            Defense::Guarded => self.guarded = value,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entity {
    pub kind: EntityKind,
    pub label: String,
    pub description: Option<String>,
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
            parameters: IndexMap::new(),
            defenses: Defenses::default(),
        };
        entity.materialize();
        entity
    }

    /// Fill in what the kind carries and the author left out, as unknown.
    pub fn materialize(&mut self) {
        for slot in self.kind.slots() {
            self.parameters.entry(*slot).or_default();
        }
        if let Some(defense) = self.kind.defense()
            && self.defenses.get(defense).is_none()
        {
            self.defenses.set(defense, Some(Switch::Unknown));
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
    /// router → firewall: one each way.
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
    /// account → host/router at this privilege; a router only as admin.
    Grants {
        from: EntityId,
        to: EntityId,
        privilege: Privilege,
    },
    /// network → host/router: management access from that zone.
    Administration { from: EntityId, to: EntityId },
    /// firewall → flow: a named permission.
    Permits {
        from: EntityId,
        to: FlowId,
        allowed: Switch,
    },
    /// service → product: which software version it runs; exactly one.
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

/// The nine association kinds, as a document spells them.
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
}

impl RelationKind {
    pub const ALL: [RelationKind; 15] = [
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
        }
    }

    /// Which kinds may stand at `from`.
    pub fn from_kinds(self) -> &'static [EntityKind] {
        use EntityKind as K;
        match self {
            Self::Attached | Self::Hosts => &[K::Host, K::Router],
            Self::Filters => &[K::Router],
            Self::Stores => &[K::Host, K::Application],
            Self::Authenticates => &[K::Credential],
            Self::Authorizes | Self::Grants => &[K::Account],
            Self::Administration => &[K::Network],
            Self::Permits => &[K::Firewall],
            Self::InstanceOf => &[K::Service],
            Self::RunsAs => &[K::Host, K::Application, K::Service],
            Self::Assumes => &[K::Account],
            Self::Knows | Self::Operates => &[K::Person],
            Self::Delivers => &[K::Network],
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
            Self::Grants | Self::Administration => &[K::Host, K::Router],
            Self::Permits => &[],
            Self::InstanceOf => &[K::Product],
            Self::RunsAs | Self::Assumes => &[K::Account],
            Self::Knows => &[K::Credential],
            Self::Operates => &[K::Application],
            Self::Delivers => &[K::Person, K::Application, K::Service],
        }
    }

    /// The fields beside kind/from/to/description this kind of association has.
    pub fn fields(self) -> &'static [&'static str] {
        match self {
            Self::Permits => &["allowed"],
            Self::Authenticates => &["factor"],
            Self::Hosts => &["privilege", "contained"],
            k if k.has_privilege() => &["privilege"],
            _ => &[],
        }
    }

    pub fn has_privilege(self) -> bool {
        matches!(
            self,
            Self::Hosts | Self::Stores | Self::Grants | Self::RunsAs
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
            | Self::Delivers { from, .. } => from,
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
            | Self::Delivers { to, .. } => Some(to),
            Self::Permits { .. } => None,
        }
    }

    pub fn privilege(&self) -> Option<Privilege> {
        match self {
            Self::Hosts { privilege, .. }
            | Self::Stores { privilege, .. }
            | Self::Grants { privilege, .. }
            | Self::RunsAs { privilege, .. } => Some(*privilege),
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
    pub connect: Parameter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Defense {
    Patched,
    Protected,
    Mfa,
    Trained,
    Guarded,
}

impl Defense {
    pub const ALL: [Defense; 5] = [
        Self::Patched,
        Self::Protected,
        Self::Mfa,
        Self::Trained,
        Self::Guarded,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Patched => "patched",
            Self::Protected => "protected",
            Self::Mfa => "mfa",
            Self::Trained => "trained",
            Self::Guarded => "guarded",
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Scenario {
    pub label: String,
    pub changes: Vec<Change>,
}
