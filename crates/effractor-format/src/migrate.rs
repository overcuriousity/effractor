//! The version gate and the migration chain.
//!
//! `effractor: <int>` is the first thing read, before any key is interpreted:
//! what the other keys mean depends on it. A document older than
//! [`CURRENT_VERSION`] is brought up to date in memory, one step per version,
//! and the next save writes it back upgraded. A newer one is refused — this
//! build cannot know what it says.

use effractor_core::{Code, Diagnostic, Pos};

use crate::architecture_read::ONLY_KEYS;
use crate::lower::ARCHITECTURE;
use crate::tree::{Node, Value};

pub const CURRENT_VERSION: u64 = 2;

/// Step `i` takes a version `i + 1` tree to version `i + 2`, so this holds
/// `CURRENT_VERSION - 1` steps. A step rewrites the tree — renames a key,
/// moves a value — and leaves positions as they are, so diagnostics still
/// point into the text the author has; or it refuses a document that claims
/// a version it cannot have been written by. Each comes with fixtures under
/// `tests/fixtures/migrations/v<N>/`.
const STEPS: [fn(Node) -> Result<Node, Diagnostic>; (CURRENT_VERSION - 1) as usize] = [v1_to_v2];

/// Version 2 adds `profile: architecture` and its keys and changes nothing
/// about a tree. A version 1 document has no architecture in it: one that
/// says so is not an old document but a mislabelled new one.
fn v1_to_v2(root: Node) -> Result<Node, Diagnostic> {
    let Value::Map(entries) = &root.value else {
        return Ok(root);
    };
    let profile = entries.iter().find(|e| e.key == "profile");
    if let Some(e) = profile
        && matches!(&e.value.value, Value::Scalar { text, .. } if text == ARCHITECTURE)
    {
        return Err(Diagnostic {
            pos: Some(e.value.pos),
            ..Diagnostic::error(
                Code::Version,
                "profile",
                "version 1 has no `architecture` profile; an architecture is `effractor: 2`",
            )
        });
    }
    if let Some(e) = entries.iter().find(|e| ONLY_KEYS.contains(&e.key.as_str())) {
        let message = format!(
            "`{}` belongs to an architecture, which version 1 has no room for; an architecture is `effractor: 2`",
            e.key
        );
        return Err(Diagnostic {
            pos: Some(e.key_pos),
            ..Diagnostic::error(Code::Version, e.key.clone(), message)
        });
    }
    Ok(root)
}

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
                format!("expected a map of keys, found {}", root.found()),
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
        let message = match &entry.value.value {
            Value::Scalar { text, plain: false } if text.bytes().all(|b| b.is_ascii_digit()) => {
                format!("the version is a number, written without quotes: `effractor: {text}`")
            }
            _ => format!("expected a version number, found {}", entry.value.found()),
        };
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
    let mut root = STEPS
        .iter()
        .skip(first)
        .try_fold(root, |tree, step| step(tree))?;
    // Migrated in memory is migrated in the image: the version says what the
    // rest of the tree now means.
    if version < CURRENT_VERSION
        && let Value::Map(entries) = &mut root.value
    {
        for e in entries.iter_mut().filter(|e| e.key == "effractor") {
            e.value.value = Value::Scalar {
                text: CURRENT_VERSION.to_string(),
                plain: true,
            };
        }
    }
    Ok(root)
}
