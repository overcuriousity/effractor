//! Sampling a generated graph: the probability that the target has happened
//! by each time, how sure the sampling is, and a sample route — for the
//! baseline, and paired with one defence scenario on the same draws.

use effractor_components::generate;
use effractor_core::architecture::Architecture;
use effractor_core::{Distribution, Document, ScenarioId};
use effractor_solver::dist::{chunk_rng, sample};
use effractor_solver::graph_plan::{EventPlan, GraphOp::*};
use effractor_solver::graph_results::{GraphConfig, GraphSolve};
use serde_json::Value;

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");
const UNKNOWN: &str =
    include_str!("../../effractor-components/tests/fixtures/lecture-unknown.yaml");

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

fn run(model: &Architecture, scenario: Option<&str>, samples: u64) -> Value {
    let graph = generate(model).unwrap();
    let scenario = scenario.map(|s| s.parse::<ScenarioId>().unwrap());
    let config = GraphConfig {
        samples,
        ..GraphConfig::from_model(model)
    };
    let solve = GraphSolve::begin(model, &graph, scenario.as_ref(), &config).unwrap();
    serde_json::to_value(solve.finish()).unwrap()
}

fn solve(text: &str, scenario: Option<&str>, samples: u64) -> Value {
    run(&architecture(text), scenario, samples)
}

fn node<'a>(report: &'a Value, id: &str) -> &'a Value {
    report["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == id)
        .unwrap_or_else(|| panic!("no node {id}"))
}

fn stats(outcome: &Value) -> &Value {
    outcome
        .get("available")
        .unwrap_or_else(|| panic!("unavailable: {outcome}"))
}

#[test]
fn a_chain_is_a_sum_of_draws_not_a_product_of_cdfs() {
    let plan = EventPlan::new(vec![Input, All(vec![0]), All(vec![1])]).unwrap();
    let n = 100_000_u64;
    let mut hits = 0_u64;
    let t = 2.0;
    for chunk in 0..n.div_ceil(4096) {
        let mut rng = chunk_rng(42, chunk);
        for iteration in 0..(n - chunk * 4096).min(4096) {
            let mut durations = [0.0; 3];
            for slot in 1..3 {
                rng.set_word_pos(256 * (u128::from(iteration) * 3 + slot as u128));
                durations[slot] = sample(&Distribution::Exponential(1.0), &mut rng);
            }
            hits += u64::from(plan.times(&durations).unwrap()[2] <= t);
        }
    }
    let observed = hits as f64 / n as f64;
    let expected = 1.0 - libm::exp(-t) * (1.0 + t);
    assert!(
        (observed - expected).abs() < 0.008,
        "{observed} vs {expected}"
    );
    // What a tree's AND of the same two steps would say instead.
    let tree = (1.0 - libm::exp(-t)) * (1.0 - libm::exp(-t));
    assert!((observed - tree).abs() > 0.1);
}

#[test]
fn the_lecture_baseline_is_sampled_with_its_curve_and_route() {
    let r = solve(LECTURE, None, 10_000);
    assert_eq!(r["effractor-graph-results"], 1);
    assert_eq!(r["semantics"], "sequential-1");
    assert_eq!(r["library"]["id"], "core-components");
    assert_eq!(r["target"], "state/host/server/admin");
    assert_eq!(r["time_unit"], "d");
    assert_eq!(r["horizon"], 100.0);
    assert_eq!(r["seed"], "42");
    assert_eq!(r["samples"], 10_000);
    assert!(r["scenario"].is_null());
    assert!(r["delta"]["unavailable"].is_object());

    let base = &r["baseline"];
    assert!(base["id"].is_null());
    let target = stats(&base["outcome"]);
    assert_eq!(target["method"], "sampled");
    assert_eq!(target["samples"], 10_000);
    let p = target["p_target"].as_f64().unwrap();
    assert!(p > 0.9, "{p}");
    let cdf = target["ttc_cdf"].as_array().unwrap();
    assert_eq!(cdf.len(), 65);
    assert_eq!(cdf[0][0], 0.0);
    assert_eq!(cdf[0][1], 0.0);
    assert_eq!(cdf[64][0], 100.0);
    assert_eq!(cdf[64][1].as_f64().unwrap(), p);
    assert_eq!(cdf[32][0], 50.0);
    let mut last = 0.0;
    for row in cdf {
        let [_, p, lo, hi] = [0, 1, 2, 3].map(|k| row[k].as_f64().unwrap());
        assert!(p >= last && lo <= p && p <= hi);
        last = p;
    }

    let login = node(base, "action/service-login/server-account/sshd");
    assert_eq!(login["status"], "possible");
    assert!(stats(&login["outcome"])["p"].as_f64().unwrap() > 0.5);
    let foothold = stats(&node(base, "input/foothold/workstation/admin")["outcome"]);
    assert_eq!(foothold["p"], 1.0);
    assert_eq!(foothold["ci"]["lo"], 1.0);
    let isolated = node(base, "state/network/admin-net/access");
    assert_eq!(isolated["status"], "unreachable");
    assert_eq!(stats(&isolated["outcome"])["ci"]["hi"], 0.0);

    // The first sample that reached the target, whole.
    let witness = &base["witness"];
    assert_eq!(witness["sample"], 0);
    let ids: Vec<&str> = witness["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap())
        .collect();
    // Ties at zero in id order: the permission input, then the foothold.
    assert_eq!(
        ids[..2],
        [
            "input/flow-permission/filter/ssh",
            "input/foothold/workstation/admin"
        ]
    );
    assert!(ids.contains(&"state/host/server/admin"));
    let target_time = witness["target_time"].as_f64().unwrap();
    for n in witness["nodes"].as_array().unwrap() {
        assert!(n["time"].as_f64().unwrap() <= target_time);
    }
    for e in witness["edges"].as_array().unwrap() {
        assert!(ids.contains(&e["prerequisite"].as_str().unwrap()));
        assert!(ids.contains(&e["dependent"].as_str().unwrap()));
    }

    // What the numbers rest on, with the words the file gave them.
    let assumptions = base["assumptions"].as_array().unwrap();
    let find = assumptions
        .iter()
        .find(|a| a["path"] == "entities.sshd.parameters.find-exploit")
        .unwrap();
    assert_eq!(find["status"], "illustrative");
    assert_eq!(find["expression"], "Exponential(0.1)");
    assert_eq!(
        find["note"],
        "Exercise assumption; not calibrated to the lecture"
    );
    assert!(
        assumptions
            .iter()
            .any(|a| a["path"] == "associations.allow-ssh.allowed" && a["status"] == "policy")
    );
    assert!(
        !assumptions
            .iter()
            .any(|a| a["path"] == "entities.admin-account.parameters.admin-login")
    );
}

#[test]
fn a_failed_attempt_counts_and_the_curve_is_not_renormalized() {
    let text = LECTURE.replace(
        "        ttc: \"Exponential(2)\"",
        "        ttc: \"Bernoulli(0.3)\"",
    );
    let r = solve(&text, None, 20_000);
    let target = stats(&r["baseline"]["outcome"]);
    let p = target["p_target"].as_f64().unwrap();
    assert!((p - 0.3).abs() < 0.02, "{p}");
    assert_eq!(target["ttc_cdf"][64][1].as_f64().unwrap(), p);
}

#[test]
fn a_seeded_or_unreachable_target_is_structural() {
    let seeded = LECTURE.replace(
        "    - {entity: workstation, state: admin}\n",
        "    - {entity: workstation, state: admin}\n    - {entity: server, state: admin}\n",
    );
    let r = solve(&seeded, None, 4096);
    let target = stats(&r["baseline"]["outcome"]);
    assert_eq!(target["method"], "structural");
    assert_eq!(target["samples"], 0);
    assert_eq!(target["p_target"], 1.0);
    for row in target["ttc_cdf"].as_array().unwrap() {
        assert_eq!(row.as_array().unwrap()[1..], [1.0, 1.0, 1.0]);
    }

    let r = solve(LECTURE, Some("both"), 4096);
    let target = stats(&r["scenario"]["outcome"]);
    assert_eq!(target["method"], "structural");
    assert_eq!(target["p_target"], 0.0);
    assert_eq!(target["ci"]["hi"], 0.0);
    assert!(r["scenario"]["witness"].is_null());
    for row in target["ttc_cdf"].as_array().unwrap() {
        assert_eq!(row.as_array().unwrap()[1..], [0.0, 0.0, 0.0]);
    }
}

#[test]
fn unknown_inputs_cost_exactly_the_numbers_that_rest_on_them() {
    let r = solve(UNKNOWN, None, 4096);
    let base = &r["baseline"];
    let target = &base["outcome"]["unavailable"];
    assert_eq!(
        target["missing"],
        serde_json::json!(["entities.sshd.parameters.find-exploit"])
    );
    assert!(!target["reason"].as_str().unwrap().is_empty());
    assert!(base["witness"].is_null());
    let find = node(base, "action/service-find-exploit/sshd");
    assert_eq!(find["status"], "possible");
    assert!(find["outcome"]["unavailable"].is_object());
    // The login route knows everything it needs.
    let session = node(base, "state/session/server-account/sshd");
    assert!(stats(&session["outcome"])["p"].as_f64().unwrap() > 0.5);
    let unknown = base["assumptions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["path"] == "entities.sshd.parameters.find-exploit")
        .unwrap();
    assert_eq!(unknown["status"], "unknown");
    assert!(unknown["expression"].is_null());
}

#[test]
fn sample_counts_around_a_chunk_are_all_counted() {
    for (samples, chunks) in [(1, 1), (4095, 1), (4096, 1), (4097, 2)] {
        let model = architecture(LECTURE);
        let graph = generate(&model).unwrap();
        let config = GraphConfig {
            samples,
            ..GraphConfig::from_model(&model)
        };
        let solve = GraphSolve::begin(&model, &graph, None, &config).unwrap();
        assert_eq!(solve.progress().total, chunks);
        assert_eq!(solve.progress().done, 0);
        let r = serde_json::to_value(solve.finish()).unwrap();
        let target = stats(&r["baseline"]["outcome"]);
        assert_eq!(target["samples"], samples);
        let hits = target["p_target"].as_f64().unwrap() * samples as f64;
        assert_eq!(hits, hits.round(), "{samples}");
    }
}

#[test]
fn a_huge_horizon_keeps_every_number_finite() {
    let mut model = architecture(LECTURE);
    model.horizon = 1e308;
    let r = run(&model, None, 4096);
    let cdf = stats(&r["baseline"]["outcome"])["ttc_cdf"].clone();
    assert_eq!(cdf[64][0], 1e308);
    assert_eq!(cdf[32][0], 5e307);
    assert_eq!(cdf[64][1], 1.0);
    let text = serde_json::to_string(&r).unwrap();
    assert!(!text.contains("inf") && !text.contains("NaN"));
}

#[test]
fn a_solve_is_stepped_and_can_be_dropped_between_chunks() {
    let model = architecture(LECTURE);
    let graph = generate(&model).unwrap();
    let config = GraphConfig {
        samples: 3 * 4096,
        ..GraphConfig::from_model(&model)
    };
    let whole = GraphSolve::begin(&model, &graph, None, &config)
        .unwrap()
        .finish();
    let mut stepped = GraphSolve::begin(&model, &graph, None, &config).unwrap();
    assert_eq!(stepped.step().done, 1);
    assert_eq!(stepped.step().done, 2);
    // Finishing does what is left.
    assert_eq!(stepped.finish(), whole);
    let mut dropped = GraphSolve::begin(&model, &graph, None, &config).unwrap();
    dropped.step();
    drop(dropped);
    let mut done = GraphSolve::begin(&model, &graph, None, &config).unwrap();
    for _ in 0..5 {
        done.step();
    }
    assert_eq!(done.progress().done, 3);
}

#[test]
fn a_solve_refuses_what_it_cannot_sample() {
    let model = architecture(LECTURE);
    let graph = generate(&model).unwrap();
    for samples in [0, 100_001] {
        let config = GraphConfig {
            samples,
            ..GraphConfig::from_model(&model)
        };
        assert!(GraphSolve::begin(&model, &graph, None, &config).is_err());
    }
    let missing: ScenarioId = "nope".parse().unwrap();
    let config = GraphConfig::from_model(&model);
    assert!(GraphSolve::begin(&model, &graph, Some(&missing), &config).is_err());
}
