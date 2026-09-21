//! The version gate and the migration chain.
//!
//! `effractor: <int>` is the first thing read, before any key is interpreted:
//! what the other keys mean depends on it. A document older than
//! [`CURRENT_VERSION`] is brought up to date in memory, one step per version,
//! and the next save writes it back upgraded. A newer one is refused — this
//! build cannot know what it says.

use effractor_core::{Code, Diagnostic, Pos};

use crate::tree::{Node, Value};

pub const CURRENT_VERSION: u64 = 1;

/// Step `i` takes a version `i + 1` tree to version `i + 2`, so this holds
/// `CURRENT_VERSION - 1` steps: none yet. A step rewrites the tree — renames a
/// key, moves a value — and leaves positions as they are, so diagnostics still
/// point into the text the author has. Each comes with fixtures under
/// `tests/fixtures/migrations/v<N>/`.
const STEPS: [fn(Node) -> Node; (CURRENT_VERSION - 1) as usize] = [];

pub fn migrate(root: Node) -> Result<Node, Diagnostic> {
    let error = |code, pos, message: String| Diagnostic {
        pos: Some(pos),
        ..Diagnostic::error(code, "effractor", message)
    };
    let Value::Map(entries) = &root.value else {
        return Err(Diagnostic {
            pos: Some(root.pos),
            ..Diagnostic::error(
                Code::WrongType,
                "",
                format!("expected a map of keys, found {}", root.kind()),
            )
        });
    };
    let Some(entry) = entries.iter().find(|e| e.key == "effractor") else {
        let message = format!("`effractor: {CURRENT_VERSION}`, the format version, is missing");
        return Err(error(Code::MissingKey, Pos { line: 1, col: 1 }, message));
    };
    let pos = entry.value.pos;
    let version = match &entry.value.value {
        Value::Scalar { text, plain: true } if text.bytes().all(|b| b.is_ascii_digit()) => {
            text.parse::<u64>().ok()
        }
        _ => None,
    };
    let Some(version) = version else {
        let message = format!("expected a version number, found {}", entry.value.kind());
        return Err(error(Code::WrongType, pos, message));
    };
    if version == 0 {
        return Err(error(Code::Version, pos, "versions start at 1".into()));
    }
    if version > CURRENT_VERSION {
        let message = format!(
            "this document is version {version}; this build reads up to version \
             {CURRENT_VERSION} — it was written by a newer effractor"
        );
        return Err(error(Code::Version, pos, message));
    }
    let first = usize::try_from(version - 1).unwrap_or(usize::MAX);
    Ok(STEPS.iter().skip(first).fold(root, |tree, step| step(tree)))
}
