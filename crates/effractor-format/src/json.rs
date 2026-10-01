//! Tree ⇄ JSON. Both walks recurse, and both are bounded by
//! [`tree::MAX_DEPTH`]: a tree cannot be deeper, and deeper JSON is refused.

use std::cell::RefCell;
use std::fmt;

use effractor_core::{Code, Diagnostic, Pos};
use effractor_mal::number;
use serde::de::{self, DeserializeSeed, Deserializer, MapAccess, SeqAccess, Visitor};
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
        return Err(too_deep());
    }
    let value = match json {
        Json::Null => plain("null".into()),
        Json::Bool(b) => plain(b.to_string()),
        Json::Number(n) => plain(match (n.as_u64(), n.as_f64()) {
            (Some(v), _) => v.to_string(),
            (None, Some(v)) => number(v),
            (None, None) => n.to_string(),
        }),
        Json::String(s) => quoted(s.clone()),
        Json::Array(items) => Value::Seq(
            items
                .iter()
                .map(|item| node(item, depth + 1))
                .collect::<Result<_, _>>()?,
        ),
        Json::Object(map) => Value::Map(entries(map, depth)?),
    };
    Ok(nowhere(value))
}

fn entries(map: &Map<String, Json>, depth: usize) -> Result<Vec<Entry>, Diagnostic> {
    map.iter()
        .map(|(key, value)| {
            Ok(Entry {
                key: as_key(key.clone())?,
                key_pos: Pos { line: 0, col: 0 },
                value: node(value, depth + 1)?,
            })
        })
        .collect()
}

fn plain(text: String) -> Value {
    Value::Scalar { text, plain: true }
}

fn quoted(text: String) -> Value {
    Value::Scalar { text, plain: false }
}

fn nowhere(value: Value) -> Node {
    Node {
        value,
        pos: Pos { line: 0, col: 0 },
        verbatim: false,
    }
}

fn too_deep() -> Diagnostic {
    let message = format!("nested more than {MAX_DEPTH} levels deep");
    Diagnostic::error(Code::Unsupported, "", message)
}

fn as_key(key: String) -> Result<String, Diagnostic> {
    if fits_as_key(&key) {
        Ok(key)
    } else {
        Err(Diagnostic::error(Code::Unsupported, "", too_long_key()))
    }
}

/// A JSON text as a tree, as [`tree`] makes one of a [`Json`] — but with each
/// key as written: one said twice is there twice, for the reader to report
/// as it does in a YAML text, where a [`Json`] would keep the last. The walk
/// recurses, bounded as [`tree`]'s is.
pub fn read(text: &str) -> Result<Node, Diagnostic> {
    let refused = RefCell::new(None);
    let mut json = serde_json::Deserializer::from_str(text);
    let seed = Seed {
        depth: 0,
        refused: &refused,
    };
    let read = seed.deserialize(&mut json).and_then(|node| {
        json.end()?;
        Ok(node)
    });
    match (read, refused.into_inner()) {
        (_, Some(diagnostic)) => Err(diagnostic),
        (Ok(node), None) => Ok(node),
        (Err(e), None) => Err(Diagnostic::error(
            Code::Syntax,
            "",
            format!("not JSON: {e}"),
        )),
    }
}

/// What is read at `depth`; what the format cannot hold is put in `refused`
/// and stops the read.
#[derive(Clone, Copy)]
struct Seed<'r> {
    depth: usize,
    refused: &'r RefCell<Option<Diagnostic>>,
}

impl Seed<'_> {
    fn refuse<E: de::Error>(self, diagnostic: Diagnostic) -> E {
        let message = diagnostic.message.clone();
        *self.refused.borrow_mut() = Some(diagnostic);
        E::custom(message)
    }

    /// The seed for what is inside a map or list read with this one.
    fn inside<E: de::Error>(self) -> Result<Self, E> {
        if self.depth >= MAX_DEPTH {
            return Err(self.refuse(too_deep()));
        }
        Ok(Self {
            depth: self.depth + 1,
            ..self
        })
    }
}

impl<'de> DeserializeSeed<'de> for Seed<'_> {
    type Value = Node;

    fn deserialize<D: Deserializer<'de>>(self, json: D) -> Result<Node, D::Error> {
        json.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Seed<'_> {
    type Value = Node;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_unit<E: de::Error>(self) -> Result<Node, E> {
        Ok(nowhere(plain("null".into())))
    }

    fn visit_bool<E: de::Error>(self, v: bool) -> Result<Node, E> {
        Ok(nowhere(plain(v.to_string())))
    }

    fn visit_u64<E: de::Error>(self, v: u64) -> Result<Node, E> {
        Ok(nowhere(plain(v.to_string())))
    }

    /// As a [`Number`] has it: a whole number below zero is read as a float.
    fn visit_i64<E: de::Error>(self, v: i64) -> Result<Node, E> {
        match u64::try_from(v) {
            Ok(v) => self.visit_u64(v),
            Err(_) => self.visit_f64(v as f64),
        }
    }

    fn visit_f64<E: de::Error>(self, v: f64) -> Result<Node, E> {
        Ok(nowhere(plain(number(v))))
    }

    fn visit_str<E: de::Error>(self, v: &str) -> Result<Node, E> {
        Ok(nowhere(quoted(v.to_owned())))
    }

    fn visit_string<E: de::Error>(self, v: String) -> Result<Node, E> {
        Ok(nowhere(quoted(v)))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Node, A::Error> {
        let inside = self.inside()?;
        let mut items = Vec::new();
        while let Some(item) = seq.next_element_seed(inside)? {
            items.push(item);
        }
        Ok(nowhere(Value::Seq(items)))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Node, A::Error> {
        let inside = self.inside()?;
        let mut entries = Vec::new();
        while let Some(key) = map.next_key::<String>()? {
            let key = as_key(key).map_err(|d| self.refuse(d))?;
            entries.push(Entry {
                key,
                key_pos: Pos { line: 0, col: 0 },
                value: map.next_value_seed(inside)?,
            });
        }
        Ok(nowhere(Value::Map(entries)))
    }
}
