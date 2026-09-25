//! Tree ⇄ JSON. Both walks recurse, and both are bounded by
//! [`tree::MAX_DEPTH`]: a tree cannot be deeper, and deeper JSON is refused.

use effractor_core::{Code, Diagnostic, Pos};
use effractor_mal::number;
use serde_json::{Map, Number, Value as Json};

use crate::lower::parse_number;
use crate::tree::{Entry, MAX_DEPTH, Node, Value, fits_as_key, too_long_key};

/// The largest whole number JavaScript holds exactly: 2^53.
const JS_EXACT: u64 = 1 << 53;

pub fn image(node: &Node) -> Json {
    match &node.value {
        _ if node.is_null() => Json::Null,
        Value::Scalar { text, plain: true } => match text.as_str() {
            "true" => Json::Bool(true),
            "false" => Json::Bool(false),
            _ => bare(text),
        },
        Value::Scalar { text, plain: false } => Json::String(text.clone()),
        Value::Seq(items) => Json::Array(items.iter().map(image).collect()),
        Value::Map(entries) => Json::Object(
            entries
                .iter()
                .map(|e| (e.key.clone(), image(&e.value)))
                .collect(),
        ),
    }
}

/// An unquoted scalar that is not a keyword: a number if it comes back from
/// [`tree`] as the same text, else a string — `007`, `1.50` and a whole
/// number JavaScript cannot hold keep what they say.
fn bare(text: &str) -> Json {
    let exact = if text.bytes().all(|b| b.is_ascii_digit()) {
        text.parse::<u64>()
            .ok()
            .filter(|v| *v <= JS_EXACT && v.to_string() == text)
            .map(Number::from)
    } else {
        parse_number(text)
            .filter(|v| number(*v) == text)
            .and_then(Number::from_f64)
    };
    exact.map_or_else(|| Json::String(text.to_owned()), Json::Number)
}

pub fn tree(json: &Json) -> Result<Node, Diagnostic> {
    node(json, 0)
}

/// `depth` counts the maps and lists around `json`, as the text parser does:
/// the document is one, and at most [`MAX_DEPTH`] may be open at once.
fn node(json: &Json, depth: usize) -> Result<Node, Diagnostic> {
    if depth >= MAX_DEPTH && (json.is_array() || json.is_object()) {
        let message = format!("nested more than {MAX_DEPTH} levels deep");
        return Err(Diagnostic::error(Code::Unsupported, "", message));
    }
    let plain = |text: String| Value::Scalar { text, plain: true };
    let value = match json {
        Json::Null => plain("null".into()),
        Json::Bool(b) => plain(b.to_string()),
        Json::Number(n) => plain(match (n.as_u64(), n.as_f64()) {
            (Some(v), _) => v.to_string(),
            (None, Some(v)) => number(v),
            (None, None) => n.to_string(),
        }),
        Json::String(s) => Value::Scalar {
            text: s.clone(),
            plain: false,
        },
        Json::Array(items) => Value::Seq(
            items
                .iter()
                .map(|item| node(item, depth + 1))
                .collect::<Result<_, _>>()?,
        ),
        Json::Object(map) => Value::Map(entries(map, depth)?),
    };
    Ok(Node {
        value,
        pos: Pos { line: 0, col: 0 },
    })
}

fn entries(map: &Map<String, Json>, depth: usize) -> Result<Vec<Entry>, Diagnostic> {
    map.iter()
        .map(|(key, value)| {
            if !fits_as_key(key) {
                return Err(Diagnostic::error(Code::Unsupported, "", too_long_key()));
            }
            Ok(Entry {
                key: key.clone(),
                key_pos: Pos { line: 0, col: 0 },
                value: node(value, depth + 1)?,
            })
        })
        .collect()
}
