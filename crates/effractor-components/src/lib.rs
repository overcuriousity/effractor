//! `core-components@1`: the one component library this build bundles.
//!
//! What it knows is in the catalog ([`catalog`]): the entity and association
//! kinds, the states, the parameter slots and the rules that generate attack
//! steps from an architecture, each with a stable id and version, what it
//! binds, what it requires and produces, and what it assumes. The rules are
//! described here and instantiated by the generator; a change to what a rule
//! means is a new library version, so a saved model keeps meaning what it
//! meant. Pure Rust, no I/O, compiles to wasm.

mod catalog;

pub use catalog::{LIBRARY_ID, LIBRARY_VERSION, RULES, Rule, catalog};
