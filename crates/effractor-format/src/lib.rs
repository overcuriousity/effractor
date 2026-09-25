//! YAML document format: load, canonical save, migrations.
//!
//! A text becomes a positioned tree ([`tree`]), is migrated to the current
//! version ([`migrate`]), and is lowered to a [`Model`] ([`lower`]) — which is
//! where the schema lives. One writer ([`write`]) turns a model back into text,
//! so there is one canonical form. `x-` keys are not part of the model; they
//! are carried beside it from the reader to the writer.

//!
//! Two profiles, one pipeline: a tree lowers to a [`Model`], an architecture
//! to an [`effractor_core::Architecture`], and [`Document`] is whichever the
//! text said. The tree-only functions (`load`, `diagnose`, `save`) stay for the
//! callers that only know trees; handed an architecture, they say so.

mod architecture_read;
mod architecture_write;
pub mod expr;
#[cfg(test)]
mod extension_tests;
mod json;
mod lower;
mod migrate;
mod tree;
mod write;

use effractor_core::{
    Code, Diagnostic, Document, Model, Severity, validate, validate_architecture,
};

use lower::{Extras, Lowered};
pub use migrate::CURRENT_VERSION;

/// What a text says: the migrated tree, and what it lowers to.
struct Read {
    root: tree::Node,
    lowered: Lowered,
}

fn read(text: &str) -> (Option<Read>, Vec<Diagnostic>) {
    match tree::parse(text) {
        Ok(root) => read_tree(root, true),
        Err(diagnostics) => (None, diagnostics),
    }
}

/// `positioned` says whether the tree came from a text, and so whether a path
/// is somewhere.
fn read_tree(root: tree::Node, positioned: bool) -> (Option<Read>, Vec<Diagnostic>) {
    let nowhere = |mut diagnostics: Vec<Diagnostic>| {
        for d in diagnostics.iter_mut().filter(|_| !positioned) {
            d.pos = None;
        }
        diagnostics
    };
    let root = match migrate::migrate(root) {
        Ok(root) => root,
        Err(diagnostic) => return (None, nowhere(vec![diagnostic])),
    };
    let lowered = match lower::lower(&root) {
        Ok(lowered) => lowered,
        Err(diagnostics) => return (None, nowhere(diagnostics)),
    };
    // The model knows paths; only the text knows where they are.
    let mut diagnostics = match &lowered.document {
        Document::Tree(model) => validate(model),
        Document::Architecture(architecture) => validate_architecture(architecture),
    };
    for d in diagnostics.iter_mut().filter(|_| positioned) {
        d.pos = Some(tree::locate(&root, &d.path));
    }
    let failed = diagnostics.iter().any(|d| d.severity == Severity::Error);
    ((!failed).then_some(Read { root, lowered }), diagnostics)
}

/// Everything there is to say about a text, each with its line and column, and
/// the document if nothing said was an error.
pub fn diagnose_document(text: &str) -> (Option<Document>, Vec<Diagnostic>) {
    let (read, diagnostics) = read(text);
    (read.map(|r| r.lowered.document), diagnostics)
}

/// The document a text describes. Warnings do not stop a load —
/// [`diagnose_document`] returns them; on failure this returns errors and
/// warnings alike.
pub fn load_document(text: &str) -> Result<Document, Vec<Diagnostic>> {
    match diagnose_document(text) {
        (Some(document), _) => Ok(document),
        (None, diagnostics) => Err(diagnostics),
    }
}

/// The canonical text of a document.
pub fn save_document(document: &Document) -> String {
    write::write_document(document, &Extras::new())
}

/// What a tree-only caller is told when the text is an architecture: it is
/// not wrong, it is the other kind of document.
fn not_a_tree(text: &str) -> Diagnostic {
    let mut d = Diagnostic::error(
        Code::Unsupported,
        "profile",
        "this is an architecture; this analysis reads a fault tree or an attack tree",
    );
    if let Ok(root) = tree::parse(text) {
        d.pos = Some(tree::locate(&root, "profile"));
    }
    d
}

/// Everything there is to say about a text, each with its line and column, and
/// the model if nothing said was an error. Trees only: an architecture is
/// reported as one, not read.
pub fn diagnose(text: &str) -> (Option<Model>, Vec<Diagnostic>) {
    match diagnose_document(text) {
        (Some(Document::Tree(model)), diagnostics) => (Some(model), diagnostics),
        (Some(Document::Architecture(_)), mut diagnostics) => {
            diagnostics.insert(0, not_a_tree(text));
            (None, diagnostics)
        }
        // Valid or not, an architecture is first of all not a tree.
        (None, mut diagnostics) => {
            if says_architecture(text) {
                diagnostics.insert(0, not_a_tree(text));
            }
            (None, diagnostics)
        }
    }
}

fn says_architecture(text: &str) -> bool {
    tree::parse(text).is_ok_and(|root| lower::is_architecture(&root))
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
        (Some(r), _) => Ok(write::write_document(
            &r.lowered.document,
            &r.lowered.extras,
        )),
        (None, diagnostics) => Err(diagnostics),
    }
}

/// A text as JSON, for an editor that is not written in Rust: an image of the
/// document — the same maps, lists and keys, `x-` keys included, migrated to the
/// current version and in canonical form — and not of the `Model`, which has no place for what it
/// does not understand. `None` if the text has errors.
///
/// A whole number above 2^53 is a string in the image, because its reader is
/// JavaScript; [`from_document`] takes it back either way.
pub fn document(text: &str) -> (Option<serde_json::Value>, Vec<Diagnostic>) {
    let (read, diagnostics) = read(text);
    // Of the canonical text: every number in it is written the one way that
    // comes back from JSON as written, and every text that could be taken
    // for a number is quoted.
    let image = read.map(|r| {
        let canonical = write::write_document(&r.lowered.document, &r.lowered.extras);
        tree::parse(&canonical).map_or_else(|_| json::image(&r.root), |root| json::image(&root))
    });
    (image, diagnostics)
}

/// The canonical text of an edited [`document`]. It is read exactly as a text
/// would be, so whatever an edit broke comes back as diagnostics — with paths,
/// and without positions, since there is no text for them to be in.
pub fn from_document(document: &serde_json::Value) -> Result<String, Vec<Diagnostic>> {
    let root = json::tree(document).map_err(|d| vec![d])?;
    match read_tree(root, false) {
        (Some(r), _) => Ok(write::write_document(
            &r.lowered.document,
            &r.lowered.extras,
        )),
        (None, diagnostics) => Err(diagnostics),
    }
}
