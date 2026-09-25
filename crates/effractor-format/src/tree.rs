//! A YAML text as a tree that remembers where everything was written.
//!
//! This is all of YAML the format speaks: one document of maps, lists and
//! scalars. Anchors, aliases, tags, complex keys and further documents are
//! reported as unsupported rather than half understood.

use effractor_core::{Code, Diagnostic, Pos};
use saphyr_parser::{Event, Parser, ScalarStyle, Span};

/// Nothing in the schema nests deeper than five; only an `x-` value can, and
/// this is as far as it may. It is what lets every walk over a tree recurse:
/// the depth is bounded here, not by the author.
pub const MAX_DEPTH: usize = 64;

/// Longer keys are legal YAML only in some positions; none is worth the risk of
/// writing a file that cannot be read back.
const MAX_KEY: usize = 256;

pub fn too_long_key() -> String {
    format!(
        "a key may be at most {MAX_KEY} characters long, and fewer if they are control characters"
    )
}

/// The same as written: a control character is written as six (`\u0001`), and
/// YAML reads no implicit key longer than 1024.
const MAX_WRITTEN_KEY: usize = 1000;

pub fn fits_as_key(text: &str) -> bool {
    text.chars().count() <= MAX_KEY
        && text.chars().map(crate::write::written_width).sum::<usize>() <= MAX_WRITTEN_KEY
}

#[derive(Debug, Clone, PartialEq)]
pub struct Node {
    pub value: Value,
    pub pos: Pos,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    /// `plain` is "written without quotes": the difference between `42` and
    /// `"42"`, which an `x-` value must keep.
    Scalar {
        text: String,
        plain: bool,
    },
    Seq(Vec<Node>),
    Map(Vec<Entry>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Entry {
    pub key: String,
    pub key_pos: Pos,
    pub value: Node,
}

impl Node {
    pub fn is_null(&self) -> bool {
        matches!(&self.value, Value::Scalar { text, plain: true }
            if matches!(text.as_str(), "" | "~" | "null" | "Null" | "NULL"))
    }

    pub fn kind(&self) -> &'static str {
        match &self.value {
            _ if self.is_null() => "nothing",
            Value::Scalar { .. } => "a scalar",
            Value::Seq(_) => "a list",
            Value::Map(_) => "a map",
        }
    }
}

enum Frame {
    Seq(Vec<Node>, Pos),
    Map(Vec<Entry>, Option<(String, Pos)>, Pos),
}

fn pos(span: &Span) -> Pos {
    Pos {
        line: span.start.line(),
        col: span.start.col() + 1,
    }
}

fn at(code: Code, pos: Pos, message: impl Into<String>) -> Diagnostic {
    Diagnostic {
        pos: Some(pos),
        ..Diagnostic::error(code, "", message)
    }
}

pub fn parse(text: &str) -> Result<Node, Vec<Diagnostic>> {
    let mut out = Vec::new();
    let mut stack: Vec<Frame> = Vec::new();
    let mut root: Option<Node> = None;
    let mut documents = 0;
    let mut parser = Parser::new_from_str(text);

    let unsupported = |out: &mut Vec<Diagnostic>, pos, what: &str| {
        out.push(at(
            Code::Unsupported,
            pos,
            format!("{what} are not part of this format"),
        ));
    };

    while let Some(event) = parser.next_event() {
        let (event, span) = match event {
            Ok(e) => e,
            Err(e) => {
                let m = e.marker();
                let pos = Pos {
                    line: m.line().max(1),
                    col: m.col() + 1,
                };
                return Err(vec![at(Code::Syntax, pos, e.info().to_owned())]);
            }
        };
        let here = pos(&span);
        let done = match event {
            Event::DocumentStart(_) => {
                documents += 1;
                if documents == 2 {
                    unsupported(&mut out, here, "further documents in one file");
                    break;
                }
                None
            }
            Event::Alias(_) => {
                unsupported(&mut out, here, "aliases");
                Some(Node {
                    value: Value::Scalar {
                        text: String::new(),
                        plain: true,
                    },
                    pos: here,
                })
            }
            Event::Scalar(text, style, anchor, tag) => {
                if anchor != 0 {
                    unsupported(&mut out, here, "anchors");
                }
                if tag.is_some() {
                    unsupported(&mut out, here, "tags");
                }
                let plain = style == ScalarStyle::Plain;
                Some(Node {
                    value: Value::Scalar {
                        text: text.into_owned(),
                        plain,
                    },
                    pos: here,
                })
            }
            Event::SequenceStart(anchor, ref tag) | Event::MappingStart(anchor, ref tag) => {
                if stack.len() >= MAX_DEPTH {
                    let message = format!("nested more than {MAX_DEPTH} levels deep");
                    out.push(at(Code::Unsupported, here, message));
                    return Err(out);
                }
                if anchor != 0 {
                    unsupported(&mut out, here, "anchors");
                }
                if tag.is_some() {
                    unsupported(&mut out, here, "tags");
                }
                stack.push(match event {
                    Event::SequenceStart(..) => Frame::Seq(vec![], here),
                    _ => Frame::Map(vec![], None, here),
                });
                None
            }
            Event::SequenceEnd | Event::MappingEnd => match stack.pop() {
                Some(Frame::Seq(items, pos)) => Some(Node {
                    value: Value::Seq(items),
                    pos,
                }),
                Some(Frame::Map(entries, _, pos)) => Some(Node {
                    value: Value::Map(entries),
                    pos,
                }),
                None => None,
            },
            _ => None,
        };
        let Some(node) = done else { continue };
        match stack.last_mut() {
            None => root = Some(node),
            Some(Frame::Seq(items, _)) => items.push(node),
            Some(Frame::Map(entries, pending, _)) => match pending.take() {
                Some((key, key_pos)) => entries.push(Entry {
                    key,
                    key_pos,
                    value: node,
                }),
                None => {
                    let key = match node.value {
                        Value::Scalar { text, .. } if fits_as_key(&text) => text,
                        Value::Scalar { .. } => {
                            out.push(at(Code::Unsupported, node.pos, too_long_key()));
                            String::new()
                        }
                        _ => {
                            unsupported(&mut out, node.pos, "maps and lists as keys");
                            String::new()
                        }
                    };
                    *pending = Some((key, node.pos));
                }
            },
        }
    }

    if !out.is_empty() {
        return Err(out);
    }
    root.ok_or_else(|| {
        vec![at(
            Code::Syntax,
            Pos { line: 1, col: 1 },
            "the document is empty",
        )]
    })
}

/// Where `path` (`nodes.top.children[2]`) was written. A scalar is reported
/// where its value is; a map or list at its key, because that is the line a
/// person thinks of as "this node". A path that is not in the text — a missing
/// key — resolves to the nearest thing around it that is.
pub fn locate(root: &Node, path: &str) -> Pos {
    let mut node = root;
    let mut found = Pos { line: 1, col: 1 };
    if path.is_empty() {
        return found;
    }
    for segment in path.split('.') {
        let (key, indices) = match segment.find('[') {
            Some(i) => (&segment[..i], &segment[i..]),
            None => (segment, ""),
        };
        let Value::Map(entries) = &node.value else {
            return found;
        };
        let Some(entry) = entries.iter().find(|e| e.key == key) else {
            return found;
        };
        node = &entry.value;
        found = match node.value {
            Value::Scalar { .. } => node.pos,
            _ => entry.key_pos,
        };
        for index in indices.split(['[', ']']).filter(|s| !s.is_empty()) {
            let Value::Seq(items) = &node.value else {
                return found;
            };
            let Some(item) = index.parse().ok().and_then(|i: usize| items.get(i)) else {
                return found;
            };
            node = item;
            found = node.pos;
        }
    }
    found
}
