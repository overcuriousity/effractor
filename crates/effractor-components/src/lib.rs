//! `core-components@1`: the one component library this build bundles.
//!
//! What it knows is in the catalog ([`catalog`]): the entity and association
//! kinds, the states, the parameter slots and the rules that generate attack
//! steps from an architecture, each with a stable id and version, what it
//! binds, what it requires and produces, and what it assumes. [`generate`]
//! instantiates those rules into a graph of facts and actions, [`resolve`]
//! reads its durations under the baseline or a scenario, and [`graph_image`]
//! is the graph as JSON. A change to what a rule means is a new library
//! version, so a saved model keeps meaning what it meant. Pure Rust, no I/O,
//! compiles to wasm.

mod catalog;
mod export;
mod generate;
mod graph;
mod resolve;

pub use catalog::{
    LIBRARY_ID, LIBRARY_VERSION, MAX_GENERATED_DEPENDENCIES, MAX_GENERATED_NODES, RULES, Rule,
    catalog,
};
pub use export::{graph_image, timing_status};
pub use generate::generate;
pub use graph::{
    Binding, GeneratedGraph, GeneratedKind, GeneratedNode, Origin, Owner, ResolvedGraph,
    ResolvedTtc, SEMANTICS,
};
pub use resolve::resolve;
