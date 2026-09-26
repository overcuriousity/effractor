//! `Model` → canonical text. There is one writer, so there is one canonical
//! form: fixed key order, maps in the order they were authored, shorthands as
//! written, block style except for short lists and the small records
//! (consequences, effects, losses), and `x-` keys after the keys of the map
//! they came from.

use std::fmt::Write;

use effractor_core::{Distribution, Document, Gate, Model, NodeKind};
use effractor_mal::number;
use saphyr_parser::{Event, Parser, ScalarStyle};

use crate::CURRENT_VERSION;
use crate::architecture_write;
use crate::lower::{DIMS, Extras, LEAVES, PROFILES, TIME_UNITS};
use crate::tree::{Entry, Node, Value};

/// A list of ids stays on one line up to here, then goes block.
pub const WIDTH: usize = 80;

/// A tree's word for `value`. The tables name every value (a test holds them
/// to it); the architecture's words are its enums' own `as_str`.
pub fn word<T: PartialEq>(words: &[(&'static str, T)], value: &T) -> &'static str {
    words
        .iter()
        .find(|(_, v)| v == value)
        .map_or("", |(w, _)| w)
}

pub fn write(m: &Model, extras: &Extras) -> String {
    let mut w = Writer::new(extras);
    w.document(m);
    w.out
}

pub fn write_document(d: &Document, extras: &Extras) -> String {
    match d {
        Document::Tree(m) => write(m, extras),
        Document::Architecture(a) => architecture_write::write(a, extras),
    }
}

/// The lines, and the `x-` keys to put back among them. Both profiles write
/// through it, so both have the same idea of a line, a record and a string.
pub struct Writer<'a> {
    pub out: String,
    extras: &'a Extras,
}

impl<'a> Writer<'a> {
    pub fn new(extras: &'a Extras) -> Self {
        Self {
            out: String::new(),
            extras,
        }
    }
}

impl Writer<'_> {
    pub fn line(&mut self, indent: usize, key: &str, value: &str) {
        let _ = writeln!(self.out, "{:indent$}{key}: {value}", "");
    }

    pub fn open(&mut self, indent: usize, key: &str) {
        let _ = writeln!(self.out, "{:indent$}{key}:", "");
    }

    /// The `x-` entries of the map at `path`, one line each.
    pub fn extension_lines(&mut self, indent: usize, path: &str) {
        for e in self.extras.get(path).map_or(&[][..], Vec::as_slice) {
            let key = string(&e.key, Context::BlockKey);
            let value = flow(&e.value, Context::Block);
            self.line(indent, &key, &value);
        }
    }

    pub fn has_extensions(&self, path: &str) -> bool {
        self.extras.contains_key(path)
    }

    /// The same, as the tail of a `{…}` record.
    pub fn extension_fields(&self, path: &str, fields: &mut Vec<String>) {
        for e in self.extras.get(path).map_or(&[][..], Vec::as_slice) {
            fields.push(flow_entry(e));
        }
    }

    fn document(&mut self, m: &Model) {
        self.line(0, "effractor", &CURRENT_VERSION.to_string());
        self.line(0, "profile", word(&PROFILES, &m.profile));
        self.line(0, "name", &string(&m.name, Context::Block));
        self.line(0, "time_unit", word(&TIME_UNITS, &m.time_unit));
        self.line(0, "horizon", &number(m.horizon));
        self.line(0, "top", &reference(m.top.as_str()));

        self.out.push('\n');
        if m.nodes.is_empty() {
            self.line(0, "nodes", "{}");
        } else {
            self.open(0, "nodes");
        }
        for (id, node) in &m.nodes {
            let path = format!("nodes.{id}");
            self.open(2, id.as_str());
            self.line(4, "label", &string(&node.label, Context::Block));
            if let Some(d) = &node.description {
                self.line(4, "description", &string(d, Context::Block));
            }
            match &node.kind {
                NodeKind::Gate { gate, children } => {
                    let name = match gate {
                        Gate::Or => "or",
                        Gate::And => "and",
                        Gate::Vote { .. } => "vote",
                    };
                    self.line(4, "gate", name);
                    if let Gate::Vote { k } = gate {
                        self.line(4, "k", &k.to_string());
                    }
                    let ids: Vec<String> = children.iter().map(|c| reference(c.as_str())).collect();
                    let inline = format!("[{}]", ids.join(", "));
                    if "    children: ".len() + inline.len() <= WIDTH {
                        self.line(4, "children", &inline);
                    } else {
                        self.open(4, "children");
                        for id in ids {
                            let _ = writeln!(self.out, "      - {id}");
                        }
                    }
                }
                NodeKind::Leaf(leaf) => {
                    self.line(4, "leaf", word(&LEAVES, &leaf.leaf));
                    if let Some(ttc) = &leaf.ttc {
                        self.line(4, ttc.key(), &magnitude_or_quoted(ttc));
                    }
                    if let Some(v) = leaf.cost {
                        self.line(4, "cost", &number(v));
                    }
                    if let Some(v) = leaf.detection {
                        self.line(4, "detection", &number(v));
                    }
                }
            }
            if !node.consequences.is_empty() {
                self.open(4, "consequences");
            }
            for (i, c) in node.consequences.iter().enumerate() {
                let mut fields = vec![
                    format!("asset: {}", reference(c.asset.as_str())),
                    format!("dim: {}", word(&DIMS, &c.dim)),
                ];
                if c.fraction != 1.0 {
                    fields.push(format!("fraction: {}", number(c.fraction)));
                }
                self.extension_fields(&format!("{path}.consequences[{i}]"), &mut fields);
                let _ = writeln!(self.out, "      - {{{}}}", fields.join(", "));
            }
            self.extension_lines(4, &path);
        }

        if !m.assets.is_empty() {
            self.out.push('\n');
            self.open(0, "assets");
        }
        for (id, asset) in &m.assets {
            let path = format!("assets.{id}");
            self.open(2, id.as_str());
            self.line(4, "label", &string(&asset.label, Context::Block));
            if let Some(d) = &asset.description {
                self.line(4, "description", &string(d, Context::Block));
            }
            let mut fields = Vec::new();
            for (key, dim) in DIMS {
                if let Some(d) = asset.loss.get(dim) {
                    fields.push(format!("{key}: {}", expression(d)));
                }
            }
            self.extension_fields(&format!("{path}.loss"), &mut fields);
            self.line(4, "loss", &format!("{{{}}}", fields.join(", ")));
            self.extension_lines(4, &path);
        }

        if !m.controls.is_empty() {
            self.out.push('\n');
            self.open(0, "controls");
        }
        for (id, control) in &m.controls {
            let path = format!("controls.{id}");
            self.open(2, id.as_str());
            self.line(4, "label", &string(&control.label, Context::Block));
            if let Some(d) = &control.description {
                self.line(4, "description", &string(d, Context::Block));
            }
            self.line(4, "cost", &number(control.cost));
            self.line(4, "enabled", if control.enabled { "true" } else { "false" });
            if control.effects.is_empty() {
                self.line(4, "effects", "[]");
            } else {
                self.open(4, "effects");
            }
            for (i, e) in control.effects.iter().enumerate() {
                let mut fields = vec![
                    format!("node: {}", reference(e.node.as_str())),
                    format!("ttc: {}", expression(&e.ttc)),
                ];
                self.extension_fields(&format!("{path}.effects[{i}]"), &mut fields);
                let _ = writeln!(self.out, "      - {{{}}}", fields.join(", "));
            }
            self.extension_lines(4, &path);
        }

        self.out.push('\n');
        self.open(0, "analysis");
        self.line(2, "seed", &m.analysis.seed.to_string());
        self.line(2, "samples", &m.analysis.samples.to_string());
        self.line(2, "confidence", &number(m.analysis.confidence));
        self.extension_lines(2, "analysis");

        if self.has_extensions("") {
            self.out.push('\n');
            self.extension_lines(0, "");
        }
    }
}

/// `p` and `rate` are bare numbers; `ttc` is an expression.
fn magnitude_or_quoted(ttc: &effractor_core::Ttc) -> String {
    use effractor_core::Ttc;
    match ttc {
        Ttc::P(v) | Ttc::Rate(v) => number(*v),
        Ttc::Expr(d) => expression(d),
    }
}

/// Always quoted — an expression has commas, and half the places it appears in
/// are `{…}` records — except a constant, which is a number and looks like one.
pub fn expression(d: &Distribution) -> String {
    match d {
        Distribution::Const(v) => number(*v),
        _ => format!("\"{}\"", crate::expr::write(d)),
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Context {
    /// The value of `key: …` on a line of its own.
    Block,
    /// The key of such a line.
    BlockKey,
    /// Inside `[…]` or `{…}`, where `,` and brackets end a scalar.
    Flow,
    /// A key inside `{…}`, and the value after it.
    FlowKey,
    FlowValue,
}

/// Would YAML read `text`, written bare at this place, as exactly `text`?
/// Asking the parser is the one test that cannot disagree with the parser —
/// and the place matters: `|` is a word in `[|]` and the start of a block
/// scalar after `key: `.
fn reads_back_plain(text: &str, context: Context) -> bool {
    // Where the text goes, and which of the document's scalars it then is.
    let (document, index, count) = match context {
        Context::Block => (format!("k: {text}\n"), 1, 2),
        Context::BlockKey => (format!("{text}: v\n"), 0, 2),
        Context::Flow => (format!("[{text}]\n"), 0, 1),
        Context::FlowKey => (format!("{{{text}: v}}\n"), 0, 2),
        Context::FlowValue => (format!("{{k: {text}}}\n"), 1, 2),
    };
    let mut scalars = Vec::new();
    let mut collections = 0;
    for event in Parser::new_from_str(&document) {
        match event {
            Ok((Event::Scalar(value, style, 0, None), _)) => scalars.push((value, style)),
            Ok((Event::Scalar(..) | Event::Alias(_), _)) | Err(_) => return false,
            Ok((Event::SequenceStart(..) | Event::MappingStart(..), _)) => collections += 1,
            Ok(_) => {}
        }
    }
    collections == 1
        && scalars.len() == count
        && scalars[index].0 == text
        && scalars[index].1 == ScalarStyle::Plain
}

/// Would a bare `text` be read as something other than text — a number, a
/// boolean, nothing? Wider than YAML 1.2 asks for: `yes` and `on` are words to
/// this format but booleans to a YAML 1.1 reader, and a file should mean the
/// same to both.
pub(crate) fn looks_typed(text: &str) -> bool {
    const WORDS: [&str; 10] = [
        "~", "null", "true", "false", "yes", "no", "on", "off", "y", "n",
    ];
    let first = text.chars().next();
    first.is_none_or(|c| c.is_ascii_digit() || matches!(c, '.' | '-' | '+'))
        || WORDS.iter().any(|w| text.eq_ignore_ascii_case(w))
}

fn needs_escape(c: char) -> bool {
    c.is_control() || matches!(c, '\u{85}' | '\u{2028}' | '\u{2029}' | '\u{feff}')
}

/// How many characters `c` takes in [`quoted`] text.
pub(crate) fn written_width(c: char) -> usize {
    match c {
        '"' | '\\' | '\n' | '\t' | '\r' => 2,
        c if needs_escape(c) => 6,
        _ => 1,
    }
}

fn quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\t' => out.push_str("\\t"),
            '\r' => out.push_str("\\r"),
            c if needs_escape(c) => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// An id where it is a value. Its characters are safe anywhere; its words are
/// not: `null`, `yes`, `42` would be read back as something other than text.
pub fn reference(text: &str) -> String {
    if looks_typed(text) {
        quoted(text)
    } else {
        text.to_owned()
    }
}

/// Text, bare where that is unambiguous and quoted where it is not.
pub fn string(text: &str, context: Context) -> String {
    if !looks_typed(text) && !text.chars().any(needs_escape) && reads_back_plain(text, context) {
        text.to_owned()
    } else {
        quoted(text)
    }
}

fn flow_entry(e: &Entry) -> String {
    let value = flow(&e.value, Context::FlowValue);
    format!("{}: {value}", string(&e.key, Context::FlowKey))
}

/// An `x-` value, on one line. `context` is where that line puts it — a scalar
/// needs to know; a list or map brings its own brackets. Recursion is bounded
/// by `tree::MAX_DEPTH`.
fn flow(node: &Node, context: Context) -> String {
    match &node.value {
        _ if node.is_null() => "null".into(),
        // Written bare, it stays bare, so `42` does not become `"42"`.
        Value::Scalar { text, plain: true }
            if !text.chars().any(needs_escape) && reads_back_plain(text, context) =>
        {
            text.clone()
        }
        Value::Scalar { text, plain: true } => quoted(text),
        Value::Scalar { text, plain: false } => string(text, context),
        Value::Seq(items) => {
            let items: Vec<String> = items.iter().map(|i| flow(i, Context::Flow)).collect();
            format!("[{}]", items.join(", "))
        }
        Value::Map(entries) => {
            let entries: Vec<String> = entries.iter().map(flow_entry).collect();
            format!("{{{}}}", entries.join(", "))
        }
    }
}

#[cfg(test)]
mod tests {
    use effractor_core::{Dim, LeafKind, Profile, TimeUnit};

    use super::word;
    use crate::lower::{DIMS, LEAVES, PROFILES, TIME_UNITS};

    /// The matches stop compiling when a value is added, which sends whoever
    /// adds it to its table.
    #[test]
    fn every_value_has_a_word() {
        let profiles = [Profile::FaultTree, Profile::AttackTree].map(|p| match p {
            Profile::FaultTree | Profile::AttackTree => p,
        });
        let units = [TimeUnit::Hours, TimeUnit::Days, TimeUnit::Years].map(|u| match u {
            TimeUnit::Hours | TimeUnit::Days | TimeUnit::Years => u,
        });
        let leaves = [LeafKind::Basic, LeafKind::Undeveloped].map(|l| match l {
            LeafKind::Basic | LeafKind::Undeveloped => l,
        });
        let dims = [Dim::C, Dim::I, Dim::A].map(|d| match d {
            Dim::C | Dim::I | Dim::A => d,
        });
        assert!(profiles.iter().all(|v| !word(&PROFILES, v).is_empty()));
        assert!(units.iter().all(|v| !word(&TIME_UNITS, v).is_empty()));
        assert!(leaves.iter().all(|v| !word(&LEAVES, v).is_empty()));
        assert!(dims.iter().all(|v| !word(&DIMS, v).is_empty()));
    }
}
