//! Domain model and structural validation. No I/O, no document format.
//!
//! Fault trees, attack trees and attack graphs are one structure here: an
//! AND/OR DAG of propositions with weighted leaves. A [`Profile`] selects what
//! a document may say and which analyses apply; it never changes the structure.

mod diagnostic;
mod distribution;
mod id;
mod model;
mod validate;

pub use diagnostic::{Code, Diagnostic, Pos, Severity};
pub use distribution::{Distribution, Shorthand};
pub use id::{AssetId, ControlId, IdError, NodeId};
pub use model::{
    Analysis, Asset, Consequence, Control, Dim, Effect, Gate, Leaf, LeafKind, Loss, Model, Node,
    NodeKind, Profile, TimeUnit, Ttc,
};
pub use validate::validate;
