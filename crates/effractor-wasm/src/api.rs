//! The calls, as plain functions from JSON text to JSON text, so they are
//! tested natively and the wasm layer has nothing in it to test.
//!
//! Every answer is `{"ok": …, "diagnostics": […]}` — warnings ride along — or
//! `{"diagnostics": […]}` when the document has errors. `{"error": "…"}` is for
//! a caller's mistake, such as stepping a solve that was never begun.

use effractor_core::{Diagnostic, Severity};
use effractor_solver::{Config, Solve, SolveError};
use serde_json::{Value, json};

fn diagnostic(d: &Diagnostic) -> Value {
    json!({
        "severity": match d.severity {
            Severity::Error => "error",
            Severity::Warning => "warning",
        },
        "code": d.code.as_str(),
        "message": d.message,
        "path": d.path,
        "line": d.pos.map(|p| p.line),
        "col": d.pos.map(|p| p.col),
    })
}

fn answer(ok: Option<Value>, diagnostics: &[Diagnostic]) -> String {
    let diagnostics: Vec<Value> = diagnostics.iter().map(diagnostic).collect();
    match ok {
        Some(ok) => json!({"ok": ok, "diagnostics": diagnostics}),
        None => json!({"diagnostics": diagnostics}),
    }
    .to_string()
}

fn error(message: &str) -> String {
    json!({"error": message}).to_string()
}

fn value(v: &impl serde::Serialize) -> Value {
    serde_json::to_value(v).expect("results hold only finite numbers, strings and lists")
}

/// Is this text a document — a tree or an architecture? `ok` is `true` or
/// absent.
pub fn validate(text: &str) -> String {
    let (document, diagnostics) = effractor_format::diagnose_document(text);
    answer(document.map(|_| Value::Bool(true)), &diagnostics)
}

/// The bundled component library's catalog: what an architecture can be
/// built from, and what each generated step will rest on.
pub fn component_catalog() -> String {
    answer(Some(effractor_components::catalog()), &[])
}

/// The document as JSON, for an editor to change and hand to [`serialize`].
pub fn parse(text: &str) -> String {
    let (document, diagnostics) = effractor_format::document(text);
    answer(document, &diagnostics)
}

/// The canonical text of a document's JSON.
pub fn serialize(document: &str) -> String {
    let document: Value = match serde_json::from_str(document) {
        Ok(v) => v,
        Err(e) => {
            let d = Diagnostic::error(effractor_core::Code::Syntax, "", format!("not JSON: {e}"));
            return answer(None, &[d]);
        }
    };
    match effractor_format::from_document(&document) {
        Ok(text) => answer(Some(Value::String(text)), &[]),
        Err(diagnostics) => answer(None, &diagnostics),
    }
}

/// A time-to-compromise as the property panel sketches it: `P(T ≤ horizon)` and
/// the CDF at 33 points from 0 to the horizon. `{"error"}` if the expression
/// does not parse or is not a TTC — the panel shows that next to the field.
pub fn ttc_sketch(expression: &str, horizon: f64) -> String {
    let d = match effractor_mal::parse_expr(expression) {
        Ok(d) => d,
        Err(e) => return error(&e.message),
    };
    if let Err(message) = d.check_ttc().and_then(|()| d.check_params()) {
        return error(&message);
    }
    if !(horizon.is_finite() && horizon > 0.0) {
        return error("the horizon must be > 0");
    }
    let cdf: Vec<f64> = (0..=32)
        .map(|i| effractor_solver::dist::cdf(&d, horizon * f64::from(i) / 32.0))
        .collect();
    json!({"ok": {"p_horizon": cdf[32], "cdf": cdf}}).to_string()
}

/// One solve at a time: begun, stepped a chunk at a time so the caller can
/// show progress and stop between chunks, finished.
#[derive(Default)]
pub struct Session {
    solve: Option<Solve>,
}

impl Session {
    /// Everything exact is in the answer: it is computed before any sampling
    /// and is there to be shown while the sampling runs. Trees only: an
    /// architecture is answered with the diagnostic that says so.
    pub fn begin(&mut self, text: &str) -> String {
        self.solve = None;
        let (model, diagnostics) = effractor_format::diagnose(text);
        let Some(model) = model else {
            return answer(None, &diagnostics);
        };
        match Solve::begin(&model, &Config::from_model(&model)) {
            Ok(solve) => {
                let ok = json!({
                    "cut_sets": value(solve.cut_sets()),
                    "exact": value(solve.exact()),
                    "leaves": value(&solve.leaves()),
                    "progress": value(&solve.progress()),
                });
                self.solve = Some(solve);
                answer(Some(ok), &diagnostics)
            }
            Err(SolveError::Invalid(diagnostics)) => answer(None, &diagnostics),
        }
    }

    /// One chunk of samples.
    pub fn step(&mut self) -> String {
        match &mut self.solve {
            Some(solve) => answer(Some(value(&solve.step())), &[]),
            None => error("no solve in progress"),
        }
    }

    /// The results, after whatever sampling is still to do.
    pub fn finish(&mut self) -> String {
        match self.solve.take() {
            Some(solve) => answer(Some(value(&solve.finish())), &[]),
            None => error("no solve in progress"),
        }
    }

    pub fn cancel(&mut self) {
        self.solve = None;
    }
}
