//! Tree → `Model`: the schema. Every key this format knows is named here, and
//! anything else is an error unless it starts with `x-`.
//!
//! Lowering reports everything it finds rather than stopping at the first
//! problem, so it keeps going with whatever it could read; the caller discards
//! the model if any error was reported.

use std::collections::HashMap;
use std::str::FromStr;

use effractor_core::{
    Analysis, Asset, Code, Consequence, Control, Diagnostic, Dim, Distribution, Document, Effect,
    Gate, Leaf, LeafKind, Loss, Model, Node as ModelNode, NodeKind, Pos, Profile, TimeUnit, Ttc,
};
use indexmap::IndexMap;

use crate::architecture_read;
use crate::tree::{Entry, Node, Value};

/// The `x-` entries of every map, by the path of the map they were found in
/// (`""` for the document itself). The model has no place for them and no use;
/// the writer puts them back.
pub type Extras = HashMap<String, Vec<Entry>>;

pub const PROFILES: [(&str, Profile); 2] = [
    ("fault-tree", Profile::FaultTree),
    ("attack-tree", Profile::AttackTree),
];
/// The profile that is not a tree: it selects the other reader entirely.
pub const ARCHITECTURE: &str = "architecture";
pub const TIME_UNITS: [(&str, TimeUnit); 3] = [
    ("h", TimeUnit::Hours),
    ("d", TimeUnit::Days),
    ("y", TimeUnit::Years),
];
pub const GATES: [(&str, Option<Gate>); 3] = [
    ("or", Some(Gate::Or)),
    ("and", Some(Gate::And)),
    // `k` is another key; `None` says "read it".
    ("vote", None),
];
pub const LEAVES: [(&str, LeafKind); 2] = [
    ("basic", LeafKind::Basic),
    ("undeveloped", LeafKind::Undeveloped),
];
pub const DIMS: [(&str, Dim); 3] = [("c", Dim::C), ("i", Dim::I), ("a", Dim::A)];

const LEAF_ONLY: [&str; 5] = ["p", "rate", "ttc", "cost", "detection"];
const GATE_ONLY: [&str; 2] = ["k", "children"];

pub struct Lowered {
    pub document: Document,
    pub extras: Extras,
}

pub fn lower(root: &Node) -> Result<Lowered, Vec<Diagnostic>> {
    let mut cx = Cx::default();
    let document = cx.document(root);
    match document {
        Some(document) if cx.out.is_empty() => Ok(Lowered {
            document,
            extras: cx.extras,
        }),
        _ => Err(cx.out),
    }
}

pub fn join(path: &str, key: &str) -> String {
    if path.is_empty() {
        key.to_owned()
    } else {
        format!("{path}.{key}")
    }
}

/// The entries of one map, checked against the keys it may have.
pub struct Fields<'a> {
    pub entries: Vec<&'a Entry>,
    pub path: String,
    /// Where to say that a key is missing: the map has no position of its own
    /// worth pointing at, its key in the parent does.
    pub at: Pos,
}

impl<'a> Fields<'a> {
    pub fn get(&self, key: &str) -> Option<&'a Entry> {
        self.entries.iter().find(|e| e.key == key).copied()
    }

    pub fn path(&self, key: &str) -> String {
        join(&self.path, key)
    }
}

/// The reading context both profiles share: diagnostics, `x-` keys, and the
/// primitives — a string, a number, a word, an id, a map keyed by id.
#[derive(Default)]
pub struct Cx {
    pub out: Vec<Diagnostic>,
    pub extras: Extras,
}

impl Cx {
    pub fn error(
        &mut self,
        code: Code,
        path: impl Into<String>,
        pos: Pos,
        message: impl Into<String>,
    ) {
        self.out.push(Diagnostic {
            pos: Some(pos),
            ..Diagnostic::error(code, path, message)
        });
    }

    pub fn wrong_type(&mut self, node: &Node, path: &str, want: &str) {
        let message = format!("expected {want}, found {}", node.kind());
        self.error(Code::WrongType, path, node.pos, message);
    }

    /// A map's entries with duplicates reported and dropped.
    pub fn entries<'a>(
        &mut self,
        node: &'a Node,
        path: &str,
        want: &str,
    ) -> Option<Vec<&'a Entry>> {
        let Value::Map(entries) = &node.value else {
            self.wrong_type(node, path, want);
            return None;
        };
        let mut seen: Vec<&Entry> = Vec::with_capacity(entries.len());
        for entry in entries {
            if seen.iter().any(|e| e.key == entry.key) {
                let message = format!("`{}` is written twice", entry.key);
                self.error(
                    Code::DuplicateKey,
                    join(path, &entry.key),
                    entry.key_pos,
                    message,
                );
            } else {
                seen.push(entry);
            }
        }
        Some(seen)
    }

    pub fn fields<'a>(
        &mut self,
        node: &'a Node,
        path: &str,
        at: Pos,
        allowed: &[&str],
    ) -> Option<Fields<'a>> {
        let all = self.entries(node, path, "a map")?;
        let mut entries = Vec::new();
        let mut extra = Vec::new();
        for entry in all {
            if entry.key.starts_with("x-") {
                self.extension(&entry.value, &join(path, &entry.key));
                extra.push(entry.clone());
            } else if allowed.contains(&entry.key.as_str()) {
                entries.push(entry);
            } else {
                let message = format!(
                    "`{}` is not a key here; expected one of: {}",
                    entry.key,
                    allowed.join(", ")
                );
                self.error(
                    Code::UnknownKey,
                    join(path, &entry.key),
                    entry.key_pos,
                    message,
                );
            }
        }
        if !extra.is_empty() {
            self.extras.insert(path.to_owned(), extra);
        }
        Some(Fields {
            entries,
            path: path.to_owned(),
            at,
        })
    }

    /// An `x-` value may be anything, but a key written twice in it is still
    /// one value lost. Recursion is bounded by `tree::MAX_DEPTH`.
    fn extension(&mut self, node: &Node, path: &str) {
        match &node.value {
            Value::Scalar { .. } => {}
            Value::Seq(items) => {
                for (i, item) in items.iter().enumerate() {
                    self.extension(item, &format!("{path}[{i}]"));
                }
            }
            Value::Map(_) => {
                for entry in self.entries(node, path, "a map").unwrap_or_default() {
                    self.extension(&entry.value, &join(path, &entry.key));
                }
            }
        }
    }

    pub fn required<'a>(&mut self, f: &Fields<'a>, key: &str) -> Option<&'a Entry> {
        let entry = f.get(key);
        if entry.is_none() {
            self.error(
                Code::MissingKey,
                f.path(key),
                f.at,
                format!("`{key}` is missing"),
            );
        }
        entry
    }

    pub fn string(&mut self, node: &Node, path: &str) -> Option<String> {
        match &node.value {
            Value::Scalar { text, .. } if !node.is_null() => Some(text.clone()),
            _ => {
                self.wrong_type(node, path, "text");
                None
            }
        }
    }

    /// `Some(None)` is "not written", `None` is "written wrongly".
    pub fn optional_string(&mut self, f: &Fields, key: &str) -> Option<Option<String>> {
        match f.get(key) {
            Some(e) => self.string(&e.value, &f.path(key)).map(Some),
            None => Some(None),
        }
    }

    pub fn number(&mut self, node: &Node, path: &str) -> Option<f64> {
        if let Value::Scalar { text, plain: true } = &node.value
            && let Some(v) = parse_number(text)
        {
            return Some(v);
        }
        self.wrong_type(node, path, "a number");
        None
    }

    /// Quoted digits count too: that is how a whole number above 2^53 comes
    /// back from JavaScript, which cannot hold it as a number.
    pub fn integer(&mut self, node: &Node, path: &str) -> Option<u64> {
        if let Value::Scalar { text, .. } = &node.value
            && !text.is_empty()
            && text.bytes().all(|b| b.is_ascii_digit())
            && let Ok(v) = text.parse()
        {
            return Some(v);
        }
        self.wrong_type(node, path, "a whole number, 0 or more");
        None
    }

    pub fn boolean(&mut self, node: &Node, path: &str) -> Option<bool> {
        if let Value::Scalar { text, plain: true } = &node.value {
            match text.as_str() {
                "true" => return Some(true),
                "false" => return Some(false),
                _ => {}
            }
        }
        self.wrong_type(node, path, "`true` or `false`");
        None
    }

    pub fn word<T: Copy>(&mut self, node: &Node, path: &str, words: &[(&str, T)]) -> Option<T> {
        if let Value::Scalar { text, .. } = &node.value
            && let Some((_, v)) = words.iter().find(|(w, _)| w == text)
        {
            return Some(*v);
        }
        let names: Vec<&str> = words.iter().map(|(w, _)| *w).collect();
        self.wrong_type(node, path, &format!("one of: {}", names.join(", ")));
        None
    }

    pub fn id<T: FromStr>(&mut self, text: &str, path: &str, pos: Pos) -> Option<T>
    where
        T::Err: std::fmt::Display,
    {
        match text.parse() {
            Ok(id) => Some(id),
            Err(e) => {
                self.error(Code::InvalidId, path, pos, e.to_string());
                None
            }
        }
    }

    pub fn id_value<T: FromStr>(&mut self, node: &Node, path: &str) -> Option<T>
    where
        T::Err: std::fmt::Display,
    {
        let text = self.string(node, path)?;
        self.id(&text, path, node.pos)
    }

    /// A loss magnitude: a bare number, or an expression.
    fn magnitude(&mut self, node: &Node, path: &str) -> Option<Distribution> {
        if let Value::Scalar { text, plain: true } = &node.value
            && let Some(v) = parse_number(text)
        {
            return Some(Distribution::Const(v));
        }
        self.expression(node, path)
    }

    pub fn expression(&mut self, node: &Node, path: &str) -> Option<Distribution> {
        let Value::Scalar { text, plain } = &node.value else {
            self.wrong_type(node, path, "a distribution expression");
            return None;
        };
        match effractor_mal::parse_expr(text) {
            Ok(d) => Some(d),
            Err(e) => {
                // Into the expression: past the opening quote if there is one.
                let col = node.pos.col + e.col - 1 + usize::from(!plain);
                let pos = Pos {
                    line: node.pos.line,
                    col,
                };
                self.error(Code::Expression, path, pos, e.message);
                None
            }
        }
    }

    /// A map keyed by id, in the order it was written. Every key is an id:
    /// there are no `x-` extensions at this level, in either profile, so
    /// that an id can never be mistaken for one.
    pub fn id_map<K, V>(
        &mut self,
        entry: Option<&Entry>,
        path: &str,
        mut item: impl FnMut(&mut Self, &Entry, &str) -> Option<V>,
    ) -> Option<IndexMap<K, V>>
    where
        K: FromStr + std::hash::Hash + Eq,
        K::Err: std::fmt::Display,
    {
        let mut map = IndexMap::new();
        let Some(entry) = entry else { return Some(map) };
        let mut ok = true;
        for e in self.entries(&entry.value, path, "a map keyed by id")? {
            let at = join(path, &e.key);
            let id = self.id::<K>(&e.key, &at, e.key_pos);
            let value = item(self, e, &at);
            match (id, value) {
                (Some(id), Some(value)) => {
                    map.insert(id, value);
                }
                _ => ok = false,
            }
        }
        ok.then_some(map)
    }

    pub fn list<'a>(&mut self, node: &'a Node, path: &str) -> Option<&'a [Node]> {
        match &node.value {
            Value::Seq(items) => Some(items),
            _ => {
                self.wrong_type(node, path, "a list");
                None
            }
        }
    }

    fn document(&mut self, root: &Node) -> Option<Document> {
        // `profile` decides which keys the rest of the document may have, so
        // it is read before any of them. A tree is the default only for
        // the diagnostics: a missing profile is still reported as missing.
        if let Value::Map(entries) = &root.value
            && let Some(profile) = entries.iter().find(|e| e.key == "profile")
            && matches!(&profile.value.value, Value::Scalar { text, .. } if text == ARCHITECTURE)
        {
            return architecture_read::document(self, root).map(Document::Architecture);
        }
        self.tree(root).map(Document::Tree)
    }

    fn tree(&mut self, root: &Node) -> Option<Model> {
        let f = self.fields(
            root,
            "",
            Pos { line: 1, col: 1 },
            &[
                "effractor",
                "profile",
                "name",
                "time_unit",
                "horizon",
                "currency",
                "top",
                "nodes",
                "assets",
                "controls",
                "analysis",
            ],
        )?;
        let profile = self.required(&f, "profile").and_then(|e| {
            let words: Vec<(&str, Option<Profile>)> = PROFILES
                .iter()
                .map(|(w, p)| (*w, Some(*p)))
                .chain([(ARCHITECTURE, None)])
                .collect();
            // `architecture` was dispatched above; here it can only be the
            // value of a second, duplicate `profile` key.
            self.word(&e.value, "profile", &words).flatten()
        });
        let name = self
            .required(&f, "name")
            .and_then(|e| self.string(&e.value, "name"));
        let top = self
            .required(&f, "top")
            .and_then(|e| self.id_value(&e.value, "top"));
        let nodes = match self.required(&f, "nodes") {
            Some(e) => self.id_map(Some(e), "nodes", Self::node),
            None => None,
        };
        let assets = self.id_map(f.get("assets"), "assets", Self::asset);
        let controls = self.id_map(f.get("controls"), "controls", Self::control);

        // Everything is read before anything is given up on, so one pass
        // reports every problem. `Some(None)` is "not written".
        let time_unit = f
            .get("time_unit")
            .map(|e| self.word(&e.value, "time_unit", &TIME_UNITS));
        let horizon = f.get("horizon").map(|e| self.number(&e.value, "horizon"));
        let currency = f.get("currency").map(|e| self.string(&e.value, "currency"));
        let analysis = f.get("analysis").map(|e| self.analysis(e));

        let mut model = Model::new(name?, profile?, top?);
        if let Some(v) = time_unit {
            model.time_unit = v?;
        }
        if let Some(v) = horizon {
            model.horizon = v?;
        }
        if let Some(v) = currency {
            model.currency = v?;
        }
        if let Some(v) = analysis {
            model.analysis = v?;
        }
        model.nodes = nodes?;
        model.assets = assets?;
        model.controls = controls?;
        Some(model)
    }

    pub fn analysis(&mut self, entry: &Entry) -> Option<Analysis> {
        let f = self.fields(
            &entry.value,
            "analysis",
            entry.key_pos,
            &["seed", "samples", "confidence"],
        )?;
        let mut a = Analysis::default();
        let seed = f
            .get("seed")
            .map(|e| self.integer(&e.value, "analysis.seed"));
        let samples = f
            .get("samples")
            .map(|e| self.integer(&e.value, "analysis.samples"));
        let confidence = f
            .get("confidence")
            .map(|e| self.number(&e.value, "analysis.confidence"));
        if let Some(v) = seed {
            a.seed = v?;
        }
        if let Some(v) = samples {
            a.samples = v?;
        }
        if let Some(v) = confidence {
            a.confidence = v?;
        }
        Some(a)
    }

    fn node(&mut self, entry: &Entry, path: &str) -> Option<ModelNode> {
        let f = self.fields(
            &entry.value,
            path,
            entry.key_pos,
            &[
                "label",
                "description",
                "gate",
                "k",
                "children",
                "leaf",
                "p",
                "rate",
                "ttc",
                "cost",
                "detection",
                "consequences",
            ],
        )?;
        let label = self
            .required(&f, "label")
            .and_then(|e| self.string(&e.value, &f.path("label")));
        let description = self.optional_string(&f, "description");
        let consequences = match f.get("consequences") {
            Some(e) => self.consequences(e, &f.path("consequences")),
            None => Some(vec![]),
        };

        let kind = match (f.get("gate"), f.get("leaf")) {
            (Some(_), Some(leaf)) => {
                let message = "a node is a gate or a leaf, not both";
                self.error(Code::MisplacedKey, f.path("leaf"), leaf.key_pos, message);
                None
            }
            (None, None) => {
                let message = "a node needs `gate` or `leaf`";
                self.error(Code::MissingKey, path, entry.key_pos, message);
                None
            }
            (Some(gate), None) => self.gate(&f, gate),
            (None, Some(leaf)) => self.leaf(&f, leaf),
        };
        Some(ModelNode {
            label: label?,
            description: description?,
            kind: kind?,
            consequences: consequences?,
        })
    }

    fn misplaced(&mut self, f: &Fields, keys: &[&str], why: &str) -> bool {
        let mut any = false;
        for e in f.entries.iter().filter(|e| keys.contains(&e.key.as_str())) {
            let message = format!("`{}` {why}", e.key);
            self.error(Code::MisplacedKey, f.path(&e.key), e.key_pos, message);
            any = true;
        }
        any
    }

    fn gate(&mut self, f: &Fields, gate: &Entry) -> Option<NodeKind> {
        let misplaced = self.misplaced(f, &LEAF_ONLY, "belongs to a leaf; this node is a gate");
        let word = self.word(&gate.value, &f.path("gate"), &GATES);
        let children = self.required(f, "children").and_then(|e| {
            let path = f.path("children");
            let items = self.list(&e.value, &path)?;
            let ids: Vec<_> = items
                .iter()
                .enumerate()
                .map(|(i, item)| self.id_value(item, &format!("{path}[{i}]")))
                .collect();
            ids.into_iter().collect::<Option<Vec<_>>>()
        });
        let gate = match word? {
            Some(gate) => {
                if self.misplaced(f, &["k"], "belongs to a `vote` gate") {
                    return None;
                }
                gate
            }
            None => {
                let k = self.required(f, "k")?;
                let k = self.integer(&k.value, &f.path("k"))?;
                Gate::Vote {
                    k: usize::try_from(k).unwrap_or(usize::MAX),
                }
            }
        };
        (!misplaced).then_some(NodeKind::Gate {
            gate,
            children: children?,
        })
    }

    fn leaf(&mut self, f: &Fields, leaf: &Entry) -> Option<NodeKind> {
        let misplaced = self.misplaced(f, &GATE_ONLY, "belongs to a gate; this node is a leaf");
        let kind = self.word(&leaf.value, &f.path("leaf"), &LEAVES);

        // In the order written: the first says what the leaf is, the rest are
        // the mistake.
        let mut written = f
            .entries
            .iter()
            .filter(|e| ["p", "rate", "ttc"].contains(&e.key.as_str()));
        let first = written.next();
        let mut conflict = false;
        for e in written {
            let message = format!(
                "`{}` and `{}` both say how likely this leaf is; keep one",
                first.map_or("", |f| f.key.as_str()),
                e.key
            );
            self.error(Code::MisplacedKey, f.path(&e.key), e.key_pos, message);
            conflict = true;
        }
        let ttc = match first {
            None => Some(None),
            Some(e) => {
                let path = f.path(&e.key);
                match e.key.as_str() {
                    "p" => self.number(&e.value, &path).map(Ttc::P),
                    "rate" => self.number(&e.value, &path).map(Ttc::Rate),
                    _ => self.expression(&e.value, &path).map(Ttc::Expr),
                }
                .map(Some)
            }
        };
        let optional = |cx: &mut Self, key: &str| match f.get(key) {
            Some(e) => cx.number(&e.value, &f.path(key)).map(Some),
            None => Some(None),
        };
        let cost = optional(self, "cost");
        let detection = optional(self, "detection");
        (!misplaced && !conflict).then_some(())?;
        Some(NodeKind::Leaf(Leaf {
            leaf: kind?,
            ttc: ttc?,
            cost: cost?,
            detection: detection?,
        }))
    }

    fn consequences(&mut self, entry: &Entry, path: &str) -> Option<Vec<Consequence>> {
        let items = self.list(&entry.value, path)?;
        let all: Vec<_> = items
            .iter()
            .enumerate()
            .map(|(i, item)| {
                let path = format!("{path}[{i}]");
                let f = self.fields(item, &path, item.pos, &["asset", "dim", "fraction"])?;
                let asset = self
                    .required(&f, "asset")
                    .and_then(|e| self.id_value(&e.value, &f.path("asset")));
                let dim = self
                    .required(&f, "dim")
                    .and_then(|e| self.word(&e.value, &f.path("dim"), &DIMS));
                let fraction = match f.get("fraction") {
                    Some(e) => self.number(&e.value, &f.path("fraction")),
                    None => Some(1.0),
                };
                Some(Consequence {
                    asset: asset?,
                    dim: dim?,
                    fraction: fraction?,
                })
            })
            .collect();
        all.into_iter().collect()
    }

    fn asset(&mut self, entry: &Entry, path: &str) -> Option<Asset> {
        let f = self.fields(
            &entry.value,
            path,
            entry.key_pos,
            &["label", "description", "loss"],
        )?;
        let label = self
            .required(&f, "label")
            .and_then(|e| self.string(&e.value, &f.path("label")));
        let description = self.optional_string(&f, "description");
        let loss = match f.get("loss") {
            None => Some(Loss::default()),
            Some(e) => {
                let path = f.path("loss");
                self.fields(&e.value, &path, e.key_pos, &["c", "i", "a"])
                    .and_then(|f| {
                        let dim = |cx: &mut Self, key: &str| match f.get(key) {
                            Some(e) => cx.magnitude(&e.value, &f.path(key)).map(Some),
                            None => Some(None),
                        };
                        let (c, i, a) = (dim(self, "c"), dim(self, "i"), dim(self, "a"));
                        Some(Loss {
                            c: c?,
                            i: i?,
                            a: a?,
                        })
                    })
            }
        };
        Some(Asset {
            label: label?,
            description: description?,
            loss: loss?,
        })
    }

    fn control(&mut self, entry: &Entry, path: &str) -> Option<Control> {
        let f = self.fields(
            &entry.value,
            path,
            entry.key_pos,
            &["label", "description", "cost", "enabled", "effects"],
        )?;
        let label = self
            .required(&f, "label")
            .and_then(|e| self.string(&e.value, &f.path("label")));
        let description = self.optional_string(&f, "description");
        let cost = self
            .required(&f, "cost")
            .and_then(|e| self.number(&e.value, &f.path("cost")));
        let enabled = self
            .required(&f, "enabled")
            .and_then(|e| self.boolean(&e.value, &f.path("enabled")));
        let effects = match f.get("effects") {
            None => Some(vec![]),
            Some(e) => {
                let path = f.path("effects");
                self.list(&e.value, &path).and_then(|items| {
                    let all: Vec<_> = items
                        .iter()
                        .enumerate()
                        .map(|(i, item)| {
                            let path = format!("{path}[{i}]");
                            let f = self.fields(item, &path, item.pos, &["node", "ttc"])?;
                            let node = self
                                .required(&f, "node")
                                .and_then(|e| self.id_value(&e.value, &f.path("node")));
                            let ttc = self
                                .required(&f, "ttc")
                                .and_then(|e| self.expression(&e.value, &f.path("ttc")));
                            Some(Effect {
                                node: node?,
                                ttc: ttc?,
                            })
                        })
                        .collect();
                    all.into_iter().collect::<Option<Vec<_>>>()
                })
            }
        };
        Some(Control {
            label: label?,
            description: description?,
            cost: cost?,
            enabled: enabled?,
            effects: effects?,
        })
    }
}

/// A finite decimal number. Rust's parser is close to what a person means, but
/// it also reads `inf`, `nan` and `infinity`, which here are words.
pub fn parse_number(text: &str) -> Option<f64> {
    let numeric = text
        .bytes()
        .all(|b| b.is_ascii_digit() || matches!(b, b'.' | b'-' | b'+' | b'e' | b'E'));
    let v: f64 = numeric.then(|| text.parse().ok())??;
    v.is_finite().then_some(v)
}
