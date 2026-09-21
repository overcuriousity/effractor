//! `x-` values round-trip untouched: whatever YAML value goes in, an equal one
//! comes out, and the second write is the first.

use std::fmt::Write;

use proptest::prelude::*;

use crate::tree::{self, Node, Value};
use crate::{canonicalize, write};

#[derive(Debug, Clone)]
enum Json {
    Bare(String),
    Text(String),
    List(Vec<Json>),
    Map(Vec<(String, Json)>),
}

fn json() -> impl Strategy<Value = Json> {
    let text = prop_oneof![
        any::<String>(),
        "[ -~]{0,12}",
        prop::sample::select(vec![
            "", "null", "true", "42", "a: b", "a, b", "[", "#", "x-y"
        ])
        .prop_map(str::to_owned),
    ];
    let leaf = prop_oneof![
        prop::sample::select(vec!["null", "true", "false"]).prop_map(|s| Json::Bare(s.into())),
        any::<i64>().prop_map(|v| Json::Bare(v.to_string())),
        (-1e9..1e9f64).prop_map(|v| Json::Bare(format!("{v:e}"))),
        text.clone().prop_map(Json::Text),
    ];
    leaf.prop_recursive(4, 32, 6, move |inner| {
        prop_oneof![
            prop::collection::vec(inner.clone(), 0..6).prop_map(Json::List),
            prop::collection::vec((text.clone(), inner), 0..6).prop_map(|mut entries| {
                let mut seen = std::collections::HashSet::new();
                entries.retain(|(k, _)| seen.insert(k.clone()));
                Json::Map(entries)
            }),
        ]
    })
}

fn render(j: &Json, out: &mut String) {
    let string = |s: &str, out: &mut String| {
        out.push('"');
        for c in s.chars() {
            match c {
                '"' | '\\' => {
                    out.push('\\');
                    out.push(c);
                }
                c if c.is_control() || "\u{85}\u{2028}\u{2029}\u{feff}".contains(c) => {
                    let _ = write!(out, "\\u{:04x}", c as u32);
                }
                c => out.push(c),
            }
        }
        out.push('"');
    };
    match j {
        Json::Bare(s) => out.push_str(s),
        Json::Text(s) => string(s, out),
        Json::List(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                out.push_str(if i > 0 { ", " } else { "" });
                render(item, out);
            }
            out.push(']');
        }
        Json::Map(entries) => {
            out.push('{');
            for (i, (k, v)) in entries.iter().enumerate() {
                out.push_str(if i > 0 { ", " } else { "" });
                string(k, out);
                out.push_str(": ");
                render(v, out);
            }
            out.push('}');
        }
    }
}

/// Equal as YAML values: positions and quoting style aside, but a string stays
/// a string and a bare `42` stays bare.
fn same(a: &Node, b: &Node) -> bool {
    let is_text = |text: &str, plain: bool| !plain || !write::looks_typed(text);
    match (&a.value, &b.value) {
        _ if a.is_null() || b.is_null() => a.is_null() && b.is_null(),
        (Value::Scalar { text: s, plain: p }, Value::Scalar { text: t, plain: q }) => {
            s == t && is_text(s, *p) == is_text(t, *q)
        }
        (Value::Seq(x), Value::Seq(y)) => {
            x.len() == y.len() && x.iter().zip(y).all(|(a, b)| same(a, b))
        }
        (Value::Map(x), Value::Map(y)) => {
            x.len() == y.len()
                && x.iter()
                    .zip(y)
                    .all(|(a, b)| a.key == b.key && same(&a.value, &b.value))
        }
        _ => false,
    }
}

fn extension(text: &str) -> Node {
    let root = tree::parse(text).unwrap();
    let Value::Map(entries) = root.value else {
        panic!("a map")
    };
    entries
        .into_iter()
        .find(|e| e.key == "x-data")
        .unwrap()
        .value
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn any_value_survives(j in json()) {
        let mut text = String::from(
            "effractor: 1\nprofile: fault-tree\nname: T\ntop: t\nnodes:\n  t: {label: T, leaf: basic}\nx-data: ",
        );
        render(&j, &mut text);
        text.push('\n');
        let once = canonicalize(&text).map_err(|d| TestCaseError::fail(format!("{d:?}\n{text}")))?;
        prop_assert!(same(&extension(&text), &extension(&once)), "{}\n{}", text, once);
        prop_assert_eq!(canonicalize(&once).unwrap(), once);
    }
}
