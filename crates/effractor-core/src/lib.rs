//! Domain model and structural validation. No I/O, no document format.
//!
//! Fault trees, attack trees and attack graphs are one structure here: an
//! AND/OR DAG of propositions with weighted leaves. A [`Profile`] selects what
//! a document may say and which analyses apply; it never changes the structure.

//!
//! An architecture ([`architecture`]) is the other kind of document: typed
//! components and their relationships, from which a graph of attack steps is
//! generated rather than drawn. [`Document`] is one or the other.

pub mod architecture;
mod architecture_validate;
mod diagnostic;
mod distribution;
mod id;
mod model;
mod validate;

pub use architecture::{Architecture, Document};
pub use architecture_validate::validate_architecture;
pub use diagnostic::{Code, Diagnostic, Pos, Severity};
pub use distribution::{Distribution, Shorthand};
pub use id::{
    ArchitectureIdError, AssetId, AssociationId, ClusterId, ControlId, DigitsOnly, EntityId,
    FlowId, IdError, NodeId, ScenarioId,
};
pub use model::{
    Analysis, Asset, Consequence, Control, Dim, Effect, Gate, Leaf, LeafKind, Loss, Model, Node,
    NodeKind, Profile, TimeUnit, Ttc,
};
pub use validate::validate;
