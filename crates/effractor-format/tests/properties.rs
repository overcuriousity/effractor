//! Any valid model survives a save and a load unchanged, whatever its labels
//! contain, and writing is a fixed point.

use effractor_core::{
    Analysis, Asset, AssetId, Consequence, Control, ControlId, Dim, Distribution as D, Effect,
    Gate, Leaf, LeafKind, Loss, Model, Node, NodeKind, Profile, TimeUnit, Ttc, validate,
};
use effractor_format::{canonicalize, load, save};
use proptest::prelude::*;

// The helpers return boxed strategies: composed unboxed, the model strategy is
// a type large enough to overflow a test thread's stack in a debug build.

/// Text that goes looking for trouble: YAML's indicators, things that read as
/// other types, quotes, escapes, line breaks, and whatever else a `char` can be.
fn text() -> BoxedStrategy<String> {
    let nasty = prop::sample::select(vec![
        "",
        " ",
        "~",
        "null",
        "true",
        "No",
        "on",
        "42",
        "-1",
        "1e3",
        ".5",
        ".inf",
        "0x1f",
        "2026-09-01",
        "a: b",
        "a:",
        ":a",
        "a #b",
        "#a",
        "- a",
        "-",
        "?",
        "? a",
        "[a]",
        "{a: b}",
        "a, b",
        "a]",
        "&a",
        "*a",
        "!a",
        "|",
        ">",
        "%a",
        "@a",
        "`a",
        "'a'",
        "\"a\"",
        "a\\b",
        " a",
        "a ",
        "a\nb",
        "a\n",
        "\ta",
        "a\tb",
        "a\r\nb",
        "\u{feff}a",
        "a\u{85}b",
        "a\u{2028}b",
        "\u{0}",
        "\u{7f}",
        "x-a",
        "ü",
        "日本語",
        "🔥",
        "---",
        "...",
        "<<",
    ])
    .prop_map(str::to_owned);
    prop_oneof![
        2 => nasty,
        2 => "[ -~äöüß]{0,24}",
        1 => any::<String>(),
    ]
    .boxed()
}

fn positive() -> BoxedStrategy<f64> {
    prop_oneof![
        1e-12..1e12f64,
        Just(1.0),
        Just(2.5e-6),
        Just(f64::MIN_POSITIVE),
        Just(1e300)
    ]
    .boxed()
}

fn probability() -> BoxedStrategy<f64> {
    prop_oneof![0.0..=1.0f64, Just(0.0), Just(1.0)].boxed()
}

fn time() -> BoxedStrategy<D> {
    prop_oneof![
        positive().prop_map(D::ExponentialMean),
        (positive(), positive()).prop_map(|(shape, scale)| D::Gamma { shape, scale }),
        (-50.0..50.0f64, positive()).prop_map(|(mu, sigma)| D::LogNormal { mu, sigma }),
        (positive(), positive()).prop_map(|(xm, alpha)| D::Pareto { xm, alpha }),
        (-50.0..50.0f64, positive()).prop_map(|(mean, sd)| D::TruncatedNormal { mean, sd }),
        Just(D::Zero),
        Just(D::Infinity),
    ]
    .boxed()
}

fn ttc_distribution() -> BoxedStrategy<D> {
    prop_oneof![
        time(),
        probability().prop_map(D::Bernoulli),
        (probability(), time()).prop_map(|(p, d)| D::Product(p, Box::new(d))),
    ]
    .boxed()
}

fn ttc() -> BoxedStrategy<Option<Ttc>> {
    prop_oneof![
        Just(None),
        probability().prop_map(|p| Some(Ttc::P(p))),
        positive().prop_map(|r| Some(Ttc::Rate(r))),
        ttc_distribution().prop_map(|d| Some(Ttc::Expr(d))),
    ]
    .boxed()
}

fn magnitude() -> BoxedStrategy<Option<D>> {
    prop_oneof![
        Just(None),
        prop_oneof![Just(0.0), positive()].prop_map(|v| Some(D::Const(v))),
        (0.0..1e6f64, 0.0..1e6f64, 1.0..1e6f64).prop_map(|(min, d1, d2)| Some(D::Pert {
            min,
            mode: min + d1,
            max: min + d1 + d2
        })),
        (positive(), positive()).prop_map(|(shape, scale)| Some(D::Gamma { shape, scale })),
    ]
    .boxed()
}

fn id<T: std::str::FromStr>(prefix: &str, i: usize) -> T
where
    T::Err: std::fmt::Debug,
{
    format!("{prefix}-{i}").parse().unwrap()
}

prop_compose! {
    fn leaf(attack: bool)(
        label in text(),
        description in prop::option::of(text()),
        undeveloped in any::<bool>(),
        ttc in ttc(),
        cost in prop::option::of(0.0..1e9f64),
        detection in prop::option::of(probability()),
    ) -> Node {
        let leaf = if undeveloped { LeafKind::Undeveloped } else { LeafKind::Basic };
        Node {
            label,
            description,
            kind: NodeKind::Leaf(Leaf {
                leaf,
                ttc,
                cost: cost.filter(|_| attack),
                detection: detection.filter(|_| attack),
            }),
            consequences: vec![],
        }
    }
}

prop_compose! {
    /// Gate `g` draws its children from the nodes after it, so the graph is
    /// acyclic by construction; `n-0` is the top.
    fn model()(attack in any::<bool>(), gates in 1..6usize, leaves in 1..8usize)(
        name in text(),
        unit in prop::sample::select(vec![TimeUnit::Hours, TimeUnit::Days, TimeUnit::Years]),
        horizon in positive(),
        gate_parts in prop::collection::vec(
            (text(), 0..3u8, prop::collection::vec(any::<prop::sample::Index>(), 1..14), any::<prop::sample::Index>()),
            gates,
        ),
        leaf_nodes in prop::collection::vec(leaf(attack), leaves),
        losses in prop::collection::vec((text(), prop::option::of(text()), magnitude(), magnitude(), magnitude()), 0..3),
        consequences in prop::collection::vec((any::<prop::sample::Index>(), any::<prop::sample::Index>(), 0..3u8, prop_oneof![Just(1.0), 0.001..=1.0f64]), 0..6),
        controls in prop::collection::vec(
            (text(), prop::option::of(text()), 0.0..1e7f64, any::<bool>(), prop::collection::vec((any::<prop::sample::Index>(), ttc_distribution()), 0..3)),
            0..3,
        ),
        analysis in (any::<u64>(), 1..=effractor_core::architecture::MAX_SAMPLES, 0.001..0.999f64),
        attack in Just(attack),
    ) -> Model {
        let total = gate_parts.len() + leaf_nodes.len();
        let profile = if attack { Profile::AttackTree } else { Profile::FaultTree };
        let mut m = Model::new(name, profile, id("n", 0));
        (m.time_unit, m.horizon) = (unit, horizon);
        m.analysis = Analysis { seed: analysis.0, samples: analysis.1, confidence: analysis.2 };

        let gates = gate_parts.len();
        for (g, (label, kind, picks, k)) in gate_parts.into_iter().enumerate() {
            let mut children: Vec<usize> =
                picks.iter().map(|p| g + 1 + p.index(total - g - 1)).collect();
            children.sort_unstable();
            children.dedup();
            let gate = match kind {
                0 => Gate::Or,
                1 => Gate::And,
                _ => Gate::Vote { k: 1 + k.index(children.len()) },
            };
            let children = children.into_iter().map(|c| id("n", c)).collect();
            m.nodes.insert(id("n", g), Node::gate(label, gate, children));
        }
        for (l, node) in leaf_nodes.into_iter().enumerate() {
            m.nodes.insert(id("n", gates + l), node);
        }

        for (a, (label, description, c, i, a_loss)) in losses.into_iter().enumerate() {
            let loss = Loss { c, i, a: a_loss };
            m.assets.insert(id::<AssetId>("asset", a), Asset { label, description, loss });
        }
        for (node, asset, dim, fraction) in consequences {
            if m.assets.is_empty() {
                break;
            }
            let (asset_id, asset) = m.assets.get_index(asset.index(m.assets.len())).unwrap();
            let dim = [Dim::C, Dim::I, Dim::A][dim as usize];
            if asset.loss.get(dim).is_some() {
                let c = Consequence { asset: asset_id.clone(), dim, fraction };
                let at = node.index(total);
                m.nodes[at].consequences.push(c);
            }
        }
        for (c, (label, description, cost, enabled, effects)) in controls.into_iter().enumerate() {
            let effects = effects
                .into_iter()
                .map(|(leaf, ttc)| Effect { node: id("n", gates + leaf.index(total - gates)), ttc })
                .collect();
            let control = Control { label, description, cost, enabled, effects };
            m.controls.insert(id::<ControlId>("control", c), control);
        }
        m
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]

    #[test]
    fn save_then_load_gives_the_model_back(m in model()) {
        // The generator's promise, checked: warnings only.
        let errors: Vec<_> = validate(&m)
            .into_iter()
            .filter(|d| d.severity == effractor_core::Severity::Error)
            .collect();
        prop_assert!(errors.is_empty(), "{errors:?}");

        let text = save(&m);
        let back = load(&text).map_err(|d| TestCaseError::fail(format!("{d:?}\n{text}")))?;
        prop_assert_eq!(&back, &m, "{}", text);
        // And the text is already canonical, by either road.
        prop_assert_eq!(&save(&back), &text);
        prop_assert_eq!(canonicalize(&text).unwrap(), text);
    }

    #[test]
    fn no_text_makes_the_reader_panic(text in any::<String>()) {
        let _ = effractor_format::diagnose(&text);
    }

    #[test]
    fn nor_does_a_damaged_document(cut in any::<prop::sample::Index>(), insert in text()) {
        let good = include_str!("fixtures/canonical/office.yaml");
        let mut at = cut.index(good.len());
        while !good.is_char_boundary(at) {
            at -= 1;
        }
        let damaged = format!("{}{insert}{}", &good[..at], &good[at..]);
        if let Ok(once) = canonicalize(&damaged) {
            prop_assert_eq!(canonicalize(&once).unwrap(), once);
        }
    }
}
