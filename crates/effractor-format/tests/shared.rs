//! A document already shared keeps opening. Links carry their YAML inline, so
//! a tree written in MAL's spelling before the readable notation is still out
//! there; it loads as it did then and saves in today's spelling.

use effractor_core::{Distribution as D, NodeId, NodeKind};
use effractor_format::{diagnose, load, save};

const SATELLITE: &str = include_str!("fixtures/shared/satellite-old-spelling.yaml");

#[test]
fn a_tree_shared_in_the_old_spelling_loads_and_saves_in_the_new() {
    let model = load(SATELLITE).unwrap();
    let id: NodeId = "radiation-damage".parse().unwrap();
    let NodeKind::Leaf(leaf) = &model.nodes[&id].kind else {
        panic!("radiation-damage is a leaf");
    };
    assert_eq!(
        leaf.ttc.as_ref().unwrap().distribution(),
        D::Product(0.08, Box::new(D::Exponential(0.004)))
    );
    let saved = save(&model);
    assert!(saved.contains("8% * Exponential(mean 250)"), "{saved}");
    assert!(!saved.contains("Bernoulli"), "{saved}");
}

#[test]
fn every_old_spelling_reads_in_a_document() {
    for (old, new) in [
        (
            "Bernoulli(0.5) * Exponential(0.1)",
            "50% * Exponential(mean 10)",
        ),
        ("Exponential(0.08)", "Exponential(mean 12.5)"),
        ("HardAndUncertain", "50% * Exponential(mean 10)"),
        ("Infinity", "Never"),
        ("Zero", "Immediate"),
    ] {
        let text = SATELLITE.replace(
            "\"Bernoulli(0.08) * Exponential(0.004)\"",
            &format!("\"{old}\""),
        );
        let (model, diagnostics) = diagnose(&text);
        assert!(diagnostics.is_empty(), "{old}: {diagnostics:?}");
        assert!(save(&model.unwrap()).contains(new), "{old}");
    }
}

#[test]
fn a_mistake_is_still_named_in_the_new_spelling() {
    let text = SATELLITE.replace(
        "\"Bernoulli(0.08) * Exponential(0.004)\"",
        "\"Exponential(5) * 50%\"",
    );
    let (_, diagnostics) = diagnose(&text);
    assert_eq!(diagnostics.len(), 1, "{diagnostics:?}");
    assert!(
        diagnostics[0].message.contains("mean"),
        "{}",
        diagnostics[0].message
    );
}

#[test]
fn the_page_opens_it_in_the_new_spelling() {
    let (image, diagnostics) = effractor_format::document(SATELLITE);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    let written = effractor_format::from_document(&image.unwrap()).unwrap();
    assert!(written.contains("8% * Exponential(mean 250)"), "{written}");
    assert!(!written.contains("Bernoulli"), "{written}");
}

#[test]
fn a_currency_written_before_costs_were_plain_numbers_is_read_and_forgotten() {
    assert!(SATELLITE.contains("\ncurrency: EUR\n"));
    let (model, diagnostics) = diagnose(SATELLITE);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    assert!(!save(&model.unwrap()).contains("currency"));
}
