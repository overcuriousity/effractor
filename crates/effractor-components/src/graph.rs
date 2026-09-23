//! The generated graph: state facts, the actions between them, and where each
//! one comes from. A derived artifact — regenerated from the architecture,
//! never edited — whose node ids are stable under relabelling, reordering and
//! defence switches, so a comparison pairs the same step with itself.

use effractor_core::architecture::{Defense, LibraryPin, Parameter, Slot, StateRef};
use effractor_core::{AssociationId, Distribution, EntityId, FlowId};

/// How the evaluator reads a generated graph: facts are a zero-time OR of
/// their producers, actions wait for ALL their prerequisites and then take
/// their own duration.
pub const SEMANTICS: &str = "sequential-1";

#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedGraph {
    pub library: LibraryPin,
    pub semantics: &'static str,
    /// Sorted by id bytes; an index into this is a node's sampling slot.
    pub nodes: Vec<GeneratedNode>,
    /// The index of the attacker's target fact.
    pub target: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GeneratedNode {
    /// `state/…`, `action/…` or `input/…`, built from a rule id and source ids.
    pub id: String,
    /// Built from source labels; user content, never identity.
    pub label: String,
    pub kind: GeneratedKind,
    /// Read only as the kind allows: an Any is always `Logical`, an All always
    /// a `Parameter`, an Input a foothold or a permission.
    pub duration: Binding,
    /// Every rule that produced this node, with what it bound.
    pub origins: Vec<Origin>,
}

/// Inputs are node indices, ascending.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GeneratedKind {
    /// Completes at zero or never: a declared foothold or a policy constant.
    Input,
    /// A fact: completes with its first producer. May have none.
    Any { inputs: Vec<usize> },
    /// An action: waits for every prerequisite, then takes its duration.
    All { inputs: Vec<usize> },
}

/// Which entity or flow owns a parameter slot.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Owner {
    Entity(EntityId),
    Flow(FlowId),
}

impl Owner {
    /// The document path of this owner's `slot`.
    pub fn slot_path(&self, slot: Slot) -> String {
        match self {
            Self::Entity(id) => format!("entities.{id}.parameters.{}", slot.as_str()),
            Self::Flow(id) => format!("flows.{id}.parameters.{}", slot.as_str()),
        }
    }
}

/// Where a node's time comes from, before any scenario is applied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Binding {
    /// Zero by rule definition.
    Logical,
    /// Zero: the attacker starts here.
    Foothold(StateRef),
    /// Zero if the permission allows, never if it denies.
    Permission(AssociationId),
    /// Drawn from `base`, or from the replacement slot when the owner's
    /// defence switch is on.
    Parameter {
        owner: Owner,
        base: Slot,
        replacement: Option<(Defense, Slot)>,
    },
    /// Unknown under every scenario: a flow whose route is still being drawn.
    /// `missing` holds the route paths the validator marked `unfinished`.
    Unfinished { flow: FlowId, missing: Vec<String> },
}

/// One rule application that produced a node.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Origin {
    pub rule: String,
    pub version: u32,
    pub entities: Vec<EntityId>,
    pub associations: Vec<AssociationId>,
    pub flows: Vec<FlowId>,
    /// Document paths of the values this step draws on: parameter slots,
    /// switches, permissions, footholds.
    pub paths: Vec<String>,
    pub assumptions: Vec<String>,
}

/// A node's duration under one scenario, or what is missing to know it.
#[derive(Debug, Clone, PartialEq)]
pub enum ResolvedTtc {
    Known(Distribution),
    /// The document paths that would have to be filled in.
    Unknown(Vec<String>),
}

/// The generated graph's durations under one scenario, aligned with its nodes.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedGraph {
    pub ttc: Vec<ResolvedTtc>,
    /// The parameter a node draws from under this scenario, if any.
    pub evidence: Vec<Vec<Parameter>>,
    /// The exact source fields that decided each node's duration.
    pub paths: Vec<Vec<String>>,
}
