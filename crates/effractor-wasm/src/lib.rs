//! Browser bindings for format and solver.
//!
//! The work is in [`api`]; this file is the wasm-bindgen skin over it. The
//! module runs in a Web Worker, one solve at a time, which is what makes a
//! thread-local session the whole of its state.

pub mod api;

use std::cell::RefCell;

use wasm_bindgen::prelude::*;

thread_local! {
    static SESSION: RefCell<api::Session> = RefCell::default();
}

#[wasm_bindgen]
extern "C" {
    /// Defined by the worker before the module is loaded.
    #[wasm_bindgen(js_name = effractorPanic)]
    fn report_panic(message: &str);
}

/// A panic is a bug, and wasm cannot unwind: the module is dead after one.
/// The hook gets the message out first, so the worker can report what happened
/// and be replaced.
#[wasm_bindgen(start)]
fn start() {
    std::panic::set_hook(Box::new(|info| report_panic(&info.to_string())));
}

#[wasm_bindgen]
pub fn validate(text: &str) -> String {
    api::validate(text)
}

#[wasm_bindgen]
pub fn parse(text: &str) -> String {
    api::parse(text)
}

#[wasm_bindgen]
pub fn serialize(document: &str) -> String {
    api::serialize(document)
}

#[wasm_bindgen]
pub fn component_catalog() -> String {
    api::component_catalog()
}

#[wasm_bindgen]
pub fn ttc_sketch(expression: &str, horizon: f64) -> String {
    api::ttc_sketch(expression, horizon)
}

#[wasm_bindgen]
pub fn solve_begin(text: &str) -> String {
    SESSION.with_borrow_mut(|s| s.begin(text))
}

#[wasm_bindgen]
pub fn solve_step() -> String {
    SESSION.with_borrow_mut(api::Session::step)
}

#[wasm_bindgen]
pub fn solve_finish() -> String {
    SESSION.with_borrow_mut(api::Session::finish)
}

#[wasm_bindgen]
pub fn solve_cancel() {
    SESSION.with_borrow_mut(api::Session::cancel);
}

/// Panics, on purpose: the only way to see that a crash is reported and the
/// worker replaced is to have one. The worker calls it for `{type: "crash"}`.
#[wasm_bindgen]
pub fn crash() {
    panic!("crash requested");
}
