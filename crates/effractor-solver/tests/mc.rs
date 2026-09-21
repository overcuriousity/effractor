mod common;

use common::*;
use effractor_core::{Distribution as D, *};
use effractor_solver::bdd::Bdd;
use effractor_solver::dist::cdf;
use effractor_solver::mc::{Chunk, Sampled, Sampler};
use effractor_solver::plan::Plan;
use effractor_solver::scenario::{as_written, leaf_distributions};

fn timed(d: D) -> Node {
    Node::leaf("leaf", LeafKind::Basic, Some(Ttc::Expr(d)))
}

fn run(m: &Model, seed: u64, samples: u64) -> Sampled {
    let plan = Plan::build(m).unwrap();
    let dists = leaf_distributions(m, &plan, &as_written(m))
        .into_iter()
        .map(Option::unwrap)
        .collect();
    let s = Sampler::new(m, &plan, dists, seed, samples);
    let chunks: Vec<Chunk> = (0..s.chunks()).map(|c| s.run_chunk(c)).collect();
    s.merge(&chunks, 0.95)
}

fn exact(m: &Model, t: f64) -> f64 {
    let plan = Plan::build(m).unwrap();
    let bdd = Bdd::from_plan(&plan, 1_000_000).unwrap();
    let p: Vec<f64> = leaf_distributions(m, &plan, &as_written(m))
        .iter()
        .map(|d| cdf(d.as_ref().unwrap(), t))
        .collect();
    bdd.prob(bdd.root(), &p)
}

/// top = (a or s) and (b or s), over one year of hours.
fn shared() -> Model {
    let mut m = model(
        "top",
        vec![
            ("top", gate(Gate::And, &["left", "right"])),
            ("left", gate(Gate::Or, &["a", "s"])),
            ("right", gate(Gate::Or, &["b", "s"])),
            ("a", timed(D::Exponential(2e-4))),
            (
                "b",
                timed(D::Product(
                    0.6,
                    Box::new(D::Gamma {
                        shape: 2.0,
                        scale: 3000.0,
                    }),
                )),
            ),
            ("s", timed(D::Exponential(3e-5))),
        ],
    );
    m.horizon = 8760.0;
    m
}

#[test]
fn completion_times_follow_the_gates() {
    let m = model(
        "top",
        vec![
            ("top", gate(Gate::Vote { k: 2 }, &["any", "all", "c"])),
            ("any", gate(Gate::Or, &["a", "b"])),
            ("all", gate(Gate::And, &["a", "b"])),
            ("a", leaf(0.5)),
            ("b", leaf(0.5)),
            ("c", leaf(0.5)),
        ],
    );
    let plan = Plan::build(&m).unwrap();
    let at = |name: &str| plan.index[&id::<NodeId>(name)];
    let (mut out, mut scratch) = (vec![], vec![]);
    let inf = f64::INFINITY;
    // leaves in plan order: a, b, c
    plan.times(&[3.0, 7.0, 5.0], &mut out, &mut scratch);
    assert_eq!(
        (out[at("any")], out[at("all")], out[at("top")]),
        (3.0, 7.0, 5.0)
    );
    plan.times(&[3.0, inf, 5.0], &mut out, &mut scratch);
    assert_eq!(
        (out[at("any")], out[at("all")], out[at("top")]),
        (3.0, inf, 5.0)
    );
    plan.times(&[inf, inf, 5.0], &mut out, &mut scratch);
    assert_eq!(
        (out[at("any")], out[at("all")], out[at("top")]),
        (inf, inf, inf)
    );
}

#[test]
fn the_sample_agrees_with_the_exact_answer() {
    let m = shared();
    let s = run(&m, 42, 40_000);
    let want = exact(&m, m.horizon);
    assert_eq!(s.samples, 40_000);
    assert!(
        s.p_top_ci.lo <= want && want <= s.p_top_ci.hi,
        "{want} not in {:?}",
        s.p_top_ci
    );
    assert!(s.p_top_ci.hi - s.p_top_ci.lo < 0.01);
    // …and along the whole time axis, which is the exact TTC CDF's job to
    // match. An empirical CDF's errors are correlated along t, so the test is
    // Kolmogorov–Smirnov on the worst point, not a count of pointwise misses.
    let worst = s
        .ttc_cdf
        .iter()
        .map(|(t, f, _)| (f - exact(&m, *t)).abs())
        .fold(0.0, f64::max);
    assert!(
        worst < 1.63 / (s.samples as f64).sqrt(),
        "KS distance {worst}"
    );
    assert!(
        s.ttc_cdf
            .windows(2)
            .all(|w| w[0].1 <= w[1].1 && w[0].2.lo <= w[0].1 && w[0].1 <= w[0].2.hi)
    );
    assert_eq!(s.ttc_cdf.first().unwrap().0, 0.0);
    assert_eq!(s.ttc_cdf.last().unwrap().0, m.horizon);
    assert_eq!(s.ttc_cdf.last().unwrap().1, s.p_top);
}

#[test]
fn the_interval_covers_at_its_nominal_rate() {
    let m = shared();
    let want = exact(&m, m.horizon);
    let runs = 100;
    let covered = (0..runs)
        .filter(|seed| {
            let s = run(&m, *seed, 2_000);
            s.p_top_ci.lo <= want && want <= s.p_top_ci.hi
        })
        .count();
    // 95% nominal. A correct interval covers 86 or fewer of 100 runs once in
    // 2000 tries; one that really covers 85% fails here three times in four.
    // That is all this test is for — a wrong z or a lost square root — and
    // more runs only buy resolution nothing here needs.
    assert!(covered > 86, "covered {covered} of {runs}");
}

#[test]
fn chunks_can_be_computed_in_any_order_and_a_part_chunk_is_fine() {
    let m = shared();
    let plan = Plan::build(&m).unwrap();
    let dists: Vec<D> = leaf_distributions(&m, &plan, &as_written(&m))
        .into_iter()
        .map(Option::unwrap)
        .collect();
    let s = Sampler::new(&m, &plan, dists, 7, 10_000);
    assert_eq!(s.chunks(), 3);
    let forward: Vec<Chunk> = (0..3).map(|c| s.run_chunk(c)).collect();
    let mut backward: Vec<Chunk> = (0..3).rev().map(|c| s.run_chunk(c)).collect();
    backward.reverse();
    assert_eq!(s.merge(&forward, 0.95), s.merge(&backward, 0.95));
    assert_eq!(s.merge(&forward, 0.95).samples, 10_000);
}

#[test]
fn a_leafs_draws_do_not_depend_on_its_neighbours() {
    // Swap one leaf for a sampler that consumes a different, variable number
    // of random numbers. The other leaves must not notice.
    let before = shared();
    let mut after = shared();
    after.nodes.insert(
        id("a"),
        timed(D::Gamma {
            shape: 0.3,
            scale: 9000.0,
        }),
    );
    let plan = Plan::build(&before).unwrap();
    let (x, y) = (run(&before, 42, 8192), run(&after, 42, 8192));
    for name in ["b", "s", "right"] {
        let i = plan.index[&id::<NodeId>(name)];
        assert_eq!(x.p_step[i], y.p_step[i], "{name}");
    }
    assert_ne!(
        x.p_step[plan.index[&id::<NodeId>("a")]],
        y.p_step[plan.index[&id::<NodeId>("a")]]
    );
}

fn with_asset(mut m: Model, loss: Loss) -> Model {
    m.assets.insert(
        id("web"),
        Asset {
            label: "Web".into(),
            description: None,
            loss,
        },
    );
    m
}

fn consequence(m: &mut Model, node: &str, dim: Dim, fraction: f64) {
    m.nodes[&id::<NodeId>(node)].consequences.push(Consequence {
        asset: id("web"),
        dim,
        fraction,
    });
}

#[test]
fn a_fixed_magnitude_gives_probability_times_magnitude() {
    let mut m = with_asset(
        shared(),
        Loss {
            c: None,
            i: None,
            a: Some(D::Const(1000.0)),
        },
    );
    consequence(&mut m, "top", Dim::A, 1.0);
    let s = run(&m, 42, 40_000);
    let loss = s.loss.unwrap();
    assert_eq!(loss.mean, s.p_top * 1000.0);
    let want = exact(&m, m.horizon) * 1000.0;
    assert!(
        loss.mean_ci.lo <= want && want <= loss.mean_ci.hi,
        "{want} not in {:?}",
        loss.mean_ci
    );
    // Two outcomes only, so every quantile is one of them.
    assert_eq!(loss.p50, if s.p_top >= 0.5 { 1000.0 } else { 0.0 });
    assert_eq!(loss.p99, 1000.0);
    assert_eq!(loss.curve, [(0.0, 1.0), (1000.0, s.p_top)]);
    assert_eq!(loss.by_asset, [(id("web"), Dim::A, loss.mean)]);
}

#[test]
fn two_paths_to_the_same_breach_are_one_breach() {
    // `left` and `top` both cost availability. When both occur that is one
    // outage at the larger fraction, not two.
    let mut m = with_asset(
        shared(),
        Loss {
            c: Some(D::Const(50.0)),
            i: None,
            a: Some(D::Const(1000.0)),
        },
    );
    consequence(&mut m, "left", Dim::A, 0.4);
    consequence(&mut m, "top", Dim::A, 1.0);
    consequence(&mut m, "top", Dim::C, 1.0);
    let s = run(&m, 42, 20_000);
    let plan = Plan::build(&m).unwrap();
    let (p_left, p_top) = (s.p_step[plan.index[&id::<NodeId>("left")]], s.p_top);
    let loss = s.loss.unwrap();
    // top implies left, so: 1050 when top, 400 when only left, else 0.
    let want = p_top * 1050.0 + (p_left - p_top) * 400.0;
    assert!((loss.mean - want).abs() < 1e-9, "{} vs {want}", loss.mean);
    let levels: Vec<f64> = loss.curve.iter().map(|(x, _)| *x).collect();
    assert_eq!(
        levels,
        [0.0, 400.0, 1050.0],
        "never 1400: the fractions do not add"
    );
}

#[test]
fn a_sampled_magnitude_has_the_right_mean_and_its_own_draws() {
    let mut m = with_asset(
        shared(),
        Loss {
            c: None,
            i: None,
            a: Some(D::Pert {
                min: 100.0,
                mode: 200.0,
                max: 900.0,
            }),
        },
    );
    consequence(&mut m, "top", Dim::A, 0.5);
    let s = run(&m, 42, 60_000);
    let want = s.p_top * 0.5 * (100.0 + 4.0 * 200.0 + 900.0) / 6.0; // Pert mean
    let loss = s.loss.unwrap();
    assert!(
        (loss.mean - want).abs() / want < 0.02,
        "{} vs {want}",
        loss.mean
    );
    assert!(loss.p99 >= loss.p95 && loss.p95 >= loss.p90 && loss.p90 >= loss.p50);
    assert!(
        loss.curve.len() <= 200
            && loss
                .curve
                .windows(2)
                .all(|w| w[0].0 < w[1].0 && w[0].1 >= w[1].1)
    );
    // Adding losses must not disturb the fault process: same seed, same top.
    assert_eq!(s.p_top, run(&shared(), 42, 60_000).p_top);
}

#[test]
fn no_assets_no_loss() {
    assert_eq!(run(&shared(), 42, 1000).loss, None);
}

#[test]
fn an_enabled_control_replaces_the_leaf_and_the_strongest_effect_wins() {
    let mut m = shared();
    let control = |enabled, rate| Control {
        label: "c".into(),
        description: None,
        cost: 1.0,
        enabled,
        effects: vec![Effect {
            node: id("s"),
            ttc: D::Exponential(rate),
        }],
    };
    m.controls.insert(id("weak"), control(true, 2e-5));
    m.controls.insert(id("strong"), control(true, 1e-6));
    m.controls.insert(id("off"), control(false, 1e-9));
    let plan = Plan::build(&m).unwrap();
    let s = plan.leaves.iter().position(|l| l.as_str() == "s").unwrap();
    assert_eq!(
        leaf_distributions(&m, &plan, &as_written(&m))[s],
        Some(D::Exponential(1e-6))
    );
    assert_eq!(
        leaf_distributions(&m, &plan, &[false, false, false])[s],
        Some(D::Exponential(3e-5))
    );
    assert_eq!(
        leaf_distributions(&m, &plan, &[true, false, true])[s],
        Some(D::Exponential(1e-9))
    );
}

/// The reproducibility contract for a whole run; see `dist.rs` for why.
#[test]
fn a_run_is_bit_identical_everywhere() {
    let mut m = with_asset(
        shared(),
        Loss {
            c: None,
            i: None,
            a: Some(D::LogNormal {
                mu: 6.0,
                sigma: 1.0,
            }),
        },
    );
    consequence(&mut m, "top", Dim::A, 1.0);
    let s = run(&m, 42, 10_000);
    let loss = s.loss.unwrap();
    let got = [
        s.p_top.to_bits(),
        loss.mean.to_bits(),
        loss.p99.to_bits(),
        s.ttc_cdf[32].1.to_bits(),
    ];
    let want: [u64; 4] = include!("mc_fingerprint.in");
    assert_eq!(got, want);
}
