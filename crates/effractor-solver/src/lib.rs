//! Pure analyses: BDD, cut sets, Monte Carlo, importance, loss exceedance.
//!
//! `(Model, Config) -> Results`, and nothing else: no I/O, no clock, no global
//! state. The same code runs natively and as wasm in the browser and must give
//! the same bits in both, which is why every transcendental function in this
//! crate comes from `libm` and none from `std`.

pub mod attacker;
pub mod bdd;
pub mod dist;
pub mod graph_plan;
pub mod graph_support;
pub mod importance;
pub mod mc;
pub mod mcs;
pub mod plan;
pub mod results;
pub mod scenario;
mod special;

pub use results::{Config, Progress, Results, Solve, SolveError, solve};
