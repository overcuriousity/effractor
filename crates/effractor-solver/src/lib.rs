//! Pure analyses: BDD, cut sets, Monte Carlo, importance, loss exceedance.
//!
//! `(Model, Config) -> Results`, and nothing else: no I/O, no clock, no global
//! state. The same code runs natively and as wasm in the browser and must give
//! the same bits in both, which is why every transcendental function in this
//! crate comes from `libm` and none from `std`.

pub mod dist;
mod special;
