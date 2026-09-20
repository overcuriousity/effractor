use indexmap::IndexMap;

use crate::{AssetId, ControlId, Distribution, NodeId};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile {
    FaultTree,
    AttackTree,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TimeUnit {
    Hours,
    Days,
    Years,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    pub name: String,
    pub profile: Profile,
    pub time_unit: TimeUnit,
    /// "Occurs" means: completes within this many time units.
    pub horizon: f64,
    pub currency: String,
    pub top: NodeId,
    pub nodes: IndexMap<NodeId, Node>,
    pub assets: IndexMap<AssetId, Asset>,
    pub controls: IndexMap<ControlId, Control>,
    pub analysis: Analysis,
}

impl Model {
    pub fn new(name: impl Into<String>, profile: Profile, top: NodeId) -> Self {
        Self {
            name: name.into(),
            profile,
            time_unit: TimeUnit::Hours,
            horizon: 8760.0,
            currency: "EUR".into(),
            top,
            nodes: IndexMap::new(),
            assets: IndexMap::new(),
            controls: IndexMap::new(),
            analysis: Analysis::default(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub label: String,
    pub description: Option<String>,
    pub kind: NodeKind,
    /// Gates and leaves alike: a consequence attaches to a proposition.
    pub consequences: Vec<Consequence>,
}

impl Node {
    pub fn gate(label: impl Into<String>, gate: Gate, children: Vec<NodeId>) -> Self {
        Self {
            label: label.into(),
            description: None,
            kind: NodeKind::Gate { gate, children },
            consequences: vec![],
        }
    }

    pub fn leaf(label: impl Into<String>, leaf: LeafKind, ttc: Option<Ttc>) -> Self {
        let kind = NodeKind::Leaf(Leaf {
            leaf,
            ttc,
            cost: None,
            detection: None,
        });
        Self {
            label: label.into(),
            description: None,
            kind,
            consequences: vec![],
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum NodeKind {
    Gate { gate: Gate, children: Vec<NodeId> },
    Leaf(Leaf),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Gate {
    And,
    Or,
    /// k-of-n.
    Vote {
        k: usize,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Leaf {
    pub leaf: LeafKind,
    /// `None` is legal: qualitative analyses need no numbers, and the solver
    /// reports the quantitative ones as unavailable.
    pub ttc: Option<Ttc>,
    /// Attacker cost, attack-tree profile.
    pub cost: Option<f64>,
    /// Probability the step is detected, attack-tree profile.
    pub detection: Option<f64>,
}

/// Same semantics; the difference is what the author is saying about the model
/// and which symbol is drawn.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LeafKind {
    Basic,
    Undeveloped,
}

/// How the document wrote it, kept so a save writes it back the same way.
#[derive(Debug, Clone, PartialEq)]
pub enum Ttc {
    /// `p:` — a static probability.
    P(f64),
    /// `rate:` — a constant failure rate.
    Rate(f64),
    /// `ttc:` — an expression.
    Expr(Distribution),
}

impl Ttc {
    pub fn distribution(&self) -> Distribution {
        match self {
            Self::P(p) => Distribution::Bernoulli(*p),
            Self::Rate(rate) => Distribution::Exponential(*rate),
            Self::Expr(d) => d.clone(),
        }
    }

    /// The document key this was written under.
    pub fn key(&self) -> &'static str {
        match self {
            Self::P(_) => "p",
            Self::Rate(_) => "rate",
            Self::Expr(_) => "ttc",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Dim {
    C,
    I,
    A,
}

impl Dim {
    pub fn key(self) -> &'static str {
        match self {
            Self::C => "c",
            Self::I => "i",
            Self::A => "a",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Consequence {
    pub asset: AssetId,
    pub dim: Dim,
    /// Share of the magnitude lost, in (0, 1].
    pub fraction: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Asset {
    pub label: String,
    pub description: Option<String>,
    pub loss: Loss,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Loss {
    pub c: Option<Distribution>,
    pub i: Option<Distribution>,
    pub a: Option<Distribution>,
}

impl Loss {
    pub fn get(&self, dim: Dim) -> Option<&Distribution> {
        match dim {
            Dim::C => self.c.as_ref(),
            Dim::I => self.i.as_ref(),
            Dim::A => self.a.as_ref(),
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Control {
    pub label: String,
    pub description: Option<String>,
    /// Defender cost per horizon.
    pub cost: f64,
    /// The as-is state.
    pub enabled: bool,
    pub effects: Vec<Effect>,
}

/// While the control is enabled, this leaf's TTC is replaced.
#[derive(Debug, Clone, PartialEq)]
pub struct Effect {
    pub node: NodeId,
    pub ttc: Distribution,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Analysis {
    pub seed: u64,
    pub samples: u64,
    pub confidence: f64,
}

impl Default for Analysis {
    fn default() -> Self {
        Self {
            seed: 42,
            samples: 10_000,
            confidence: 0.95,
        }
    }
}
