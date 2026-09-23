//! The calls, as plain functions from JSON text to JSON text, so they are
//! tested natively and the wasm layer has nothing in it to test.
//!
//! Every answer is `{"ok": …, "diagnostics": […]}` — warnings ride along — or
//! `{"diagnostics": […]}` when the document has errors. `{"error": "…"}` is for
//! a caller's mistake, such as stepping a solve that was never begun.

use effractor_core::{Diagnostic, Document, Severity};
use effractor_solver::{Config, Solve, SolveError};
use serde_json::{Value, json};

use crate::graph_api::GraphRun;

pub use crate::graph_api::generate;

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

pub(crate) fn answer(ok: Option<Value>, diagnostics: &[Diagnostic]) -> String {
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
    let d = match effractor_format::expr::parse(expression) {
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
    solve: Option<Running>,
}

enum Running {
    Tree(Box<Solve>),
    Graph(Box<GraphRun>),
}

impl Session {
    /// A tree's exact results are in the answer: they are computed before any
    /// sampling and are there to be shown while the sampling runs. An
    /// architecture begins its baseline graph solve, as [`Session::begin_graph`]
    /// with no scenario and no revision.
    pub fn begin(&mut self, text: &str) -> String {
        self.solve = None;
        let (document, diagnostics) = effractor_format::diagnose_document(text);
        match document {
            Some(Document::Tree(model)) => {
                match Solve::begin(&model, &Config::from_model(&model)) {
                    Ok(solve) => {
                        let ok = json!({
                            "cut_sets": value(solve.cut_sets()),
                            "exact": value(solve.exact()),
                            "leaves": value(&solve.leaves()),
                            "progress": value(&solve.progress()),
                        });
                        self.solve = Some(Running::Tree(Box::new(solve)));
                        answer(Some(ok), &diagnostics)
                    }
                    Err(SolveError::Invalid(diagnostics)) => answer(None, &diagnostics),
                }
            }
            Some(Document::Architecture(_)) => self.begin_graph(text, "", ""),
            None => answer(None, &diagnostics),
        }
    }

    /// `{ok: {revision, source, progress}}`: an architecture's baseline, and
    /// `scenario` beside it on the same draws unless it is empty. There is no
    /// exact part; nothing is known before sampling.
    pub fn begin_graph(&mut self, text: &str, scenario: &str, revision: &str) -> String {
        self.solve = None;
        match crate::graph_api::begin(text, scenario, revision) {
            Ok((run, warnings)) => {
                let ok = json!({
                    "revision": run.revision,
                    "source": run.source,
                    "progress": value(&run.solve.progress()),
                });
                self.solve = Some(Running::Graph(Box::new(run)));
                answer(Some(ok), &warnings)
            }
            Err(diagnostics) => answer(None, &diagnostics),
        }
    }

    /// One chunk of samples.
    pub fn step(&mut self) -> String {
        let progress = match &mut self.solve {
            Some(Running::Tree(solve)) => solve.step(),
            Some(Running::Graph(run)) => run.solve.step(),
            None => return error("no solve in progress"),
        };
        answer(Some(value(&progress)), &[])
    }

    /// The results, after whatever sampling is still to do. A graph's come as
    /// `{revision, source, result}`.
    pub fn finish(&mut self) -> String {
        match self.solve.take() {
            Some(Running::Tree(solve)) => answer(Some(value(&solve.finish())), &[]),
            Some(Running::Graph(run)) => {
                let GraphRun {
                    solve,
                    revision,
                    source,
                } = *run;
                let ok = json!({
                    "revision": revision,
                    "source": source,
                    "result": value(&solve.finish()),
                });
                answer(Some(ok), &[])
            }
            None => error("no solve in progress"),
        }
    }

    pub fn cancel(&mut self) {
        self.solve = None;
    }
}
