//! YAML document format: load, canonical save, migrations.
//!
//! A text becomes a positioned tree ([`tree`]), is migrated to the current
//! version ([`migrate`]), and is lowered to a [`Model`] ([`lower`]) — which is
//! where the schema lives. One writer ([`write`]) turns a model back into text,
//! so there is one canonical form. `x-` keys are not part of the model; they
//! are carried beside it from the reader to the writer.

#[cfg(test)]
mod extension_tests;
mod lower;
mod migrate;
mod tree;
mod write;

use effractor_core::{Diagnostic, Model, Severity, validate};

use lower::{Extras, Lowered};
pub use migrate::CURRENT_VERSION;

fn read(text: &str) -> (Option<Lowered>, Vec<Diagnostic>) {
    let root = match tree::parse(text) {
        Ok(root) => root,
        Err(diagnostics) => return (None, diagnostics),
    };
    let root = match migrate::migrate(root) {
        Ok(root) => root,
        Err(diagnostic) => return (None, vec![diagnostic]),
    };
    let lowered = match lower::lower(&root) {
        Ok(lowered) => lowered,
        Err(diagnostics) => return (None, diagnostics),
    };
    // The model knows paths; only the text knows where they are.
    let mut diagnostics = validate(&lowered.model);
    for d in &mut diagnostics {
        d.pos = Some(tree::locate(&root, &d.path));
    }
    let failed = diagnostics.iter().any(|d| d.severity == Severity::Error);
    ((!failed).then_some(lowered), diagnostics)
}

/// Everything there is to say about a text, each with its line and column, and
/// the model if nothing said was an error.
pub fn diagnose(text: &str) -> (Option<Model>, Vec<Diagnostic>) {
    let (lowered, diagnostics) = read(text);
    (lowered.map(|l| l.model), diagnostics)
}

/// The model a text describes. Warnings do not stop a load — [`diagnose`]
/// returns them; on failure this returns errors and warnings alike.
pub fn load(text: &str) -> Result<Model, Vec<Diagnostic>> {
    match diagnose(text) {
        (Some(model), _) => Ok(model),
        (None, diagnostics) => Err(diagnostics),
    }
}

/// The canonical text of a model.
pub fn save(model: &Model) -> String {
    write::write(model, &Extras::new())
}

/// A text rewritten in canonical form: what `save(&load(text)?)` gives, with
/// the `x-` keys a model cannot hold kept where they were. Comments do not
/// survive. Idempotent.
pub fn canonicalize(text: &str) -> Result<String, Vec<Diagnostic>> {
    match read(text) {
        (Some(l), _) => Ok(write::write(&l.model, &l.extras)),
        (None, diagnostics) => Err(diagnostics),
    }
}
