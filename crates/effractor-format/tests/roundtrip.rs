//! Canonical form: what `save` writes, `load` reads back, and writing again
//! changes nothing.

use effractor_core::{
    AssetId, ControlId, Distribution as D, Gate, LeafKind, NodeId, NodeKind, Ttc,
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
        .replace(", x-note: FAIR workshop", "")
        .replace(", x-why: [four-eyes principle]", "");
    let canonical = canonicalize(&stripped).unwrap();
    assert_eq!(save(&load(&stripped).unwrap()), canonical);
}

#[test]
fn the_reference_tree_loads_as_written() {
    let m = load(WEBSERVER).unwrap();
    assert_eq!(m.name, "Web server unavailable");
    assert_eq!(m.top, id("loss-of-availability"));
    assert_eq!(m.nodes.len(), 9);
    // Authored order, not sorted.
    assert_eq!(m.nodes.keys().nth(3).unwrap(), &id("administration"));

    // The repeated event is one node with two parents.
    let parents = m
        .nodes
        .values()
        .filter(|n| matches!(&n.kind, NodeKind::Gate { children, .. } if children.contains(&id("server-outage"))))
        .count();
    assert_eq!(parents, 2);

    let NodeKind::Leaf(server) = &m.nodes[&id("server-outage")].kind else {
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
    assert_eq!(psu.effects[0].ttc, D::ExponentialMean(2500000.0));
    assert_eq!(
        (m.analysis.seed, m.analysis.samples, m.analysis.confidence),
        (42, 10000, 0.95)
    );
}

#[test]
fn the_attack_tree_loads_as_written() {
    let m = load(OFFICE).unwrap();
    let NodeKind::Gate { gate, children } = &m.nodes[&id("physical")].kind else {
        panic!("a gate")
    };
    assert_eq!((*gate, children.len()), (Gate::Vote { k: 2 }, 3));
    let NodeKind::Leaf(phishing) = &m.nodes[&id("phishing")].kind else {
        panic!("a leaf")
    };
    assert_eq!(
        phishing.ttc,
        Some(Ttc::Expr(D::Product(
            0.5,
            Box::new(D::ExponentialMean(10.0))
        )))
    );
    assert_eq!(
        (phishing.cost, phishing.detection),
        (Some(200.0), Some(0.3))
    );
    // A label that looks like a boolean is still a label.
    assert_eq!(m.nodes[&id("key")].label, "true");
    let NodeKind::Leaf(alarm) = &m.nodes[&id("alarm-off")].kind else {
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

/// The empty documents the app opens on are canonical: what a user starts from
/// is what a save would write.
#[test]
fn shipped_templates_are_canonical() {
    let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/templates");
    let mut seen = 0;
    for entry in std::fs::read_dir(dir).unwrap() {
        let path = entry.unwrap().path();
        let text = std::fs::read_to_string(&path).unwrap();
        assert_eq!(canonicalize(&text).unwrap(), text, "{}", path.display());
        seen += 1;
    }
    assert!(seen > 0);
}

#[test]
fn ids_that_yaml_would_read_as_something_else_are_quoted_where_they_are_values() {
    let text = WEBSERVER
        .replace("top: loss-of-availability", "top: \"null\"")
        .replace("loss-of-availability", "null")
        .replace("no-access", "yes")
        .replace("[administration", "[\"true\"")
        .replace("  administration:", "  true:")
        .replace("webserver", "off")
        .replace("hardware", "n");
    let canonical = canonicalize(&text).unwrap();
    for line in [
        "top: \"null\"\n",
        "    children: [\"yes\", no-function]\n",
        "    children: [\"true\", network, server-outage]\n",
        "      - {asset: \"off\", dim: a}\n",
        "      - {node: \"n\", ttc: \"Exponential(mean 2500000)\"}\n",
    ] {
        assert!(canonical.contains(line), "{line:?} in {canonical}");
    }
    assert!(canonical.contains("\n  null:\n"), "{canonical}");
    assert_eq!(save(&load(&canonical).unwrap()), canonical);
    assert_eq!(canonicalize(&canonical).unwrap(), canonical);
}
