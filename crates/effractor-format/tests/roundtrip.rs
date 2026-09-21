//! Canonical form: what `save` writes, `load` reads back, and writing again
//! changes nothing.

use effractor_core::{
    AssetId, ControlId, Distribution as D, Gate, LeafKind, NodeId, NodeKind, Shorthand, Ttc,
};
use effractor_format::{canonicalize, load, save};

const WEBSERVER: &str = include_str!("fixtures/canonical/webserver.yaml");
const OFFICE: &str = include_str!("fixtures/canonical/office.yaml");

fn id(s: &str) -> NodeId {
    s.parse().unwrap()
}

#[test]
fn canonical_files_are_fixed_points() {
    for (name, text) in [("webserver", WEBSERVER), ("office", OFFICE)] {
        assert_eq!(canonicalize(text).unwrap(), text, "{name}");
    }
}

#[test]
fn save_after_load_is_the_identity_on_a_canonical_file() {
    assert_eq!(save(&load(WEBSERVER).unwrap()), WEBSERVER);
}

#[test]
fn without_extension_keys_both_writers_agree() {
    // `save` sees a Model and `canonicalize` sees the text; an `x-` key is
    // the only thing one of them can know and the other cannot.
    let stripped: String = OFFICE
        .lines()
        .filter(|l| !l.trim_start().starts_with("x-"))
        .map(|l| format!("{l}\n"))
        .collect::<String>()
        .replace(", x-note: FAIR-Workshop", "")
        .replace(", x-why: [Vier-Augen-Prinzip]", "");
    let canonical = canonicalize(&stripped).unwrap();
    assert_eq!(save(&load(&stripped).unwrap()), canonical);
}

#[test]
fn the_reference_tree_loads_as_written() {
    let m = load(WEBSERVER).unwrap();
    assert_eq!(m.name, "Mangelnde Verfügbarkeit Webserver");
    assert_eq!(m.top, id("mangelnde-verfuegbarkeit"));
    assert_eq!(m.nodes.len(), 9);
    // Authored order, not sorted.
    assert_eq!(m.nodes.keys().nth(3).unwrap(), &id("administration"));

    // The repeated event is one node with two parents.
    let parents = m
        .nodes
        .values()
        .filter(|n| matches!(&n.kind, NodeKind::Gate { children, .. } if children.contains(&id("ausfall-server"))))
        .count();
    assert_eq!(parents, 2);

    let NodeKind::Leaf(server) = &m.nodes[&id("ausfall-server")].kind else {
        panic!("a leaf")
    };
    assert_eq!(server.ttc, Some(Ttc::Rate(2.5e-6)));
    let NodeKind::Leaf(malware) = &m.nodes[&id("malware")].kind else {
        panic!("a leaf")
    };
    assert_eq!(
        (malware.leaf, &malware.ttc),
        (LeafKind::Undeveloped, &Some(Ttc::P(0.004)))
    );

    let asset = &m.assets[&"webserver".parse::<AssetId>().unwrap()];
    assert_eq!(asset.loss.c, Some(D::Const(20000.0)));
    assert_eq!(
        asset.loss.a,
        Some(D::Pert {
            min: 60000.0,
            mode: 120000.0,
            max: 400000.0
        })
    );
    let psu = &m.controls[&"redundant-psu".parse::<ControlId>().unwrap()];
    assert_eq!((psu.cost, psu.enabled), (1800.0, false));
    assert_eq!(psu.effects[0].ttc, D::Exponential(4e-7));
    assert_eq!(
        (m.analysis.seed, m.analysis.samples, m.analysis.confidence),
        (42, 10000, 0.95)
    );
}

#[test]
fn the_attack_tree_loads_as_written() {
    let m = load(OFFICE).unwrap();
    let NodeKind::Gate { gate, children } = &m.nodes[&id("physisch")].kind else {
        panic!("a gate")
    };
    assert_eq!((*gate, children.len()), (Gate::Vote { k: 2 }, 3));
    let NodeKind::Leaf(phishing) = &m.nodes[&id("phishing")].kind else {
        panic!("a leaf")
    };
    assert_eq!(
        phishing.ttc,
        Some(Ttc::Expr(D::Named(Shorthand::HardAndUncertain)))
    );
    assert_eq!(
        (phishing.cost, phishing.detection),
        (Some(200.0), Some(0.3))
    );
    // A label that looks like a boolean is still a label.
    assert_eq!(m.nodes[&id("schluessel")].label, "true");
    let NodeKind::Leaf(alarm) = &m.nodes[&id("alarm-aus")].kind else {
        panic!("a leaf")
    };
    assert_eq!(alarm.ttc, None);
    let top = &m.nodes[&id("fileserver")];
    assert_eq!(top.consequences[1].fraction, 0.25);
    assert!(top.description.as_deref().unwrap().contains('\n'));
}

#[test]
fn a_long_child_list_goes_block_and_stays_there() {
    let children: Vec<String> = (0..12)
        .map(|i| format!("ein-ziemlich-langer-name-{i}"))
        .collect();
    let mut text = String::from(
        "effractor: 1\nprofile: fault-tree\nname: Breit\ntop: t\nnodes:\n  t:\n    label: T\n    gate: or\n    children: [",
    );
    text += &children.join(", ");
    text += "]\n";
    for c in &children {
        text += &format!("  {c}: {{label: L, leaf: basic, p: 0.5}}\n");
    }
    let out = canonicalize(&text).unwrap();
    assert!(
        out.contains("    children:\n      - ein-ziemlich-langer-name-0\n"),
        "{out}"
    );
    assert!(out.lines().all(|l| l.chars().count() <= 80), "{out}");
    assert_eq!(canonicalize(&out).unwrap(), out);
}

/// The documents the app ships are canonical: what a user opens first is what
/// a save would write.
#[test]
fn shipped_examples_are_canonical() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/examples");
    let mut seen = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(canonicalize(&text).unwrap(), text, "{}", path.display());
        seen += 1;
    }
    assert!(seen > 0);
}
