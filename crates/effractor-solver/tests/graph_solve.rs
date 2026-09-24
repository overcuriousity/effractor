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

// The loop reads as the sampling convention does: slot by slot.
#[allow(clippy::needless_range_loop)]
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
        .find(|a| a["path"] == "entities.openssh.parameters.find-exploit")
        .unwrap();
    assert_eq!(find["status"], "illustrative");
    assert_eq!(find["expression"], "Exponential(mean 10)");
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
        "        ttc: \"Exponential(mean 0.5)\"",
        "        ttc: \"30%\"",
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
        serde_json::json!(["entities.openssh.parameters.find-exploit"])
    );
    assert!(!target["reason"].as_str().unwrap().is_empty());
    assert!(base["witness"].is_null());
    let find = node(base, "action/product-find-exploit/openssh");
    assert_eq!(find["status"], "possible");
    assert!(find["outcome"]["unavailable"].is_object());
    // The login route knows everything it needs.
    let session = node(base, "state/session/server-account/sshd");
    assert!(stats(&session["outcome"])["p"].as_f64().unwrap() > 0.5);
    let unknown = base["assumptions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["path"] == "entities.openssh.parameters.find-exploit")
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

fn with_scenario(text: &str, scenario: &str) -> String {
    text.replacen("\nanalysis:\n", &format!("{scenario}\nanalysis:\n"), 1)
}

fn delta(r: &Value) -> &Value {
    stats(&r["delta"])
}

fn p_target(report: &Value) -> f64 {
    stats(&report["outcome"])["p_target"].as_f64().unwrap()
}

#[test]
fn a_scenario_that_changes_nothing_differs_by_exactly_nothing() {
    let text = with_scenario(
        LECTURE,
        "  noop:\n    label: Nothing\n    changes:\n      - {entity: openssh, defense: patched, value: false}",
    );
    let r = solve(&text, Some("noop"), 10_000);
    assert_eq!(r["scenario"]["id"], "noop");
    assert_eq!(r["scenario"]["outcome"], r["baseline"]["outcome"]);
    assert_eq!(r["scenario"]["nodes"], r["baseline"]["nodes"]);
    let d = delta(&r);
    assert_eq!(d["mean"], 0.0);
    assert_eq!(d["ci"]["lo"], 0.0);
    assert_eq!(d["ci"]["hi"], 0.0);
}

#[test]
fn each_defence_leaves_the_other_route_and_both_leave_none() {
    let patch = solve(LECTURE, Some("patch"), 10_000);
    let s = &patch["scenario"];
    assert_eq!(
        node(s, "action/product-find-exploit/openssh")["status"],
        "blocked"
    );
    assert_eq!(
        node(s, "state/session/server-account/sshd")["status"],
        "possible"
    );
    assert!(p_target(s) > 0.5);
    // Steps the defence does not touch draw the same times on both sides.
    for id in [
        "action/service-login/server-account/sshd",
        "action/flow-connect/ssh",
    ] {
        assert_eq!(
            node(s, id)["outcome"],
            node(&patch["baseline"], id)["outcome"]
        );
    }

    let protect = solve(LECTURE, Some("protect"), 10_000);
    let s = &protect["scenario"];
    assert_eq!(
        node(s, "action/credential-extract/workstation/server-key")["status"],
        "blocked"
    );
    assert_eq!(node(s, "state/service/sshd/control")["status"], "possible");
    assert!(p_target(s) > 0.5);

    for scenario in ["both", "deny"] {
        let r = solve(LECTURE, Some(scenario), 10_000);
        assert_eq!(
            node(&r["scenario"], "state/host/server/admin")["status"],
            "unreachable"
        );
        assert_eq!(p_target(&r["scenario"]), 0.0);
        // Every baseline success is one the scenario takes away.
        assert_eq!(
            delta(&r)["mean"].as_f64().unwrap(),
            p_target(&r["baseline"])
        );
    }
}

#[test]
fn router_administration_defeats_a_denied_permission() {
    let text = LECTURE.replace(
        "    - {entity: workstation, state: admin}\n",
        "    - {entity: workstation, state: admin}\n    - {entity: admin-net, state: access}\n",
    );
    let r = solve(&text, Some("deny"), 10_000);
    let s = &r["scenario"];
    assert_eq!(node(s, "state/router/bridge/admin")["status"], "possible");
    assert_eq!(node(s, "state/permission/filter/ssh")["status"], "possible");
    assert!(p_target(s) > 0.5);
    let route: Vec<&str> = s["witness"]["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|n| n["id"].as_str().unwrap())
        .collect();
    assert!(route.contains(&"action/administration-login/admin-net/admin-account/bridge"));
    assert!(!route.contains(&"input/flow-permission/filter/ssh"));
}

#[test]
fn slower_finite_defences_move_the_curve_without_deleting_the_route() {
    let text = LECTURE
        .replace(
            "        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a patched",
            "        ttc: \"Exponential(mean 200)\"\n        note: \"Exercise assumption: perfect blocking, a patched",
        )
        .replace(
            "        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a protected",
            "        ttc: \"Exponential(mean 200)\"\n        note: \"Exercise assumption: perfect blocking, a protected",
        );
    let r = solve(&text, Some("both"), 10_000);
    let s = &r["scenario"];
    assert_eq!(node(s, "state/host/server/admin")["status"], "possible");
    let (base, scenario) = (p_target(&r["baseline"]), p_target(s));
    assert!(scenario > 0.0 && scenario < base, "{scenario} vs {base}");
    let d = delta(&r);
    assert!((d["mean"].as_f64().unwrap() - (base - scenario)).abs() < 1e-12);
    assert!(d["ci"]["lo"].as_f64().unwrap() > 0.0);
    assert_ne!(
        stats(&s["outcome"])["ttc_cdf"],
        stats(&r["baseline"]["outcome"])["ttc_cdf"]
    );
}

#[test]
fn a_defence_that_makes_things_worse_reports_a_negative_benefit() {
    // A baseline that finds no exploit, a "patch" that opens one, and a slow
    // login route beside it.
    let text = LECTURE
        .replace(
            "      find-exploit:\n        status: illustrative\n        ttc: \"Exponential(mean 10)\"",
            "      find-exploit:\n        status: illustrative\n        ttc: \"Never\"",
        )
        .replace(
            "        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a patched",
            "        ttc: \"Exponential(mean 2)\"\n        note: \"Exercise assumption: perfect blocking, a patched",
        )
        .replace(
            "      extract:\n        status: illustrative\n        ttc: \"Exponential(mean 5)\"\n        note: Exercise assumption; not calibrated to the lecture\n      extract-protected:\n        status: illustrative\n        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a protected store gives nothing up\"\n    defenses: {protected: false}\n  admin-key:",
            "      extract:\n        status: illustrative\n        ttc: \"Exponential(mean 100)\"\n        note: Exercise assumption; not calibrated to the lecture\n      extract-protected:\n        status: illustrative\n        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a protected store gives nothing up\"\n    defenses: {protected: false}\n  admin-key:",
        );
    let r = solve(&text, Some("patch"), 10_000);
    assert!(p_target(&r["scenario"]) > p_target(&r["baseline"]));
    let d = delta(&r);
    assert!(d["mean"].as_f64().unwrap() < 0.0);
    assert!(d["ci"]["hi"].as_f64().unwrap() < 0.0);
}

#[test]
fn an_unknown_replacement_costs_the_comparison_not_the_baseline() {
    let text = LECTURE.replace(
        "      find-exploit-patched:\n        status: illustrative\n        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a patched service has no exploit to find\"\n",
        "      find-exploit-patched:\n        status: unknown\n",
    );
    let r = solve(&text, Some("patch"), 4096);
    assert!(p_target(&r["baseline"]) > 0.5);
    let missing = serde_json::json!(["entities.openssh.parameters.find-exploit-patched"]);
    assert_eq!(r["scenario"]["outcome"]["unavailable"]["missing"], missing);
    assert_eq!(r["delta"]["unavailable"]["missing"], missing);
}

#[test]
fn one_paired_sample_has_a_difference_and_no_interval() {
    let r = solve(LECTURE, Some("deny"), 1);
    let d = delta(&r);
    assert!(d["ci"].is_null());
    assert!(!d["ci_reason"].as_str().unwrap().is_empty());
    let r = solve(LECTURE, Some("deny"), 2);
    assert!(delta(&r)["ci"].is_object());
}

fn assumption<'a>(report: &'a Value, path: &str) -> Option<&'a Value> {
    report["assumptions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["path"] == path)
}

#[test]
fn a_blocked_result_lists_the_inputs_that_block_it() {
    // Denied: the target's zero rests on the denial, and says so.
    let r = solve(LECTURE, Some("deny"), 4096);
    let denial = assumption(&r["scenario"], "scenarios.deny.changes[0]")
        .unwrap_or_else(|| panic!("{}", r["scenario"]["assumptions"]));
    assert_eq!(denial["status"], "policy");
    assert_eq!(denial["expression"], "denied");

    // Patched: the perfect-blocking replacement, and the switch that chose it.
    let r = solve(LECTURE, Some("patch"), 4096);
    let patched = assumption(
        &r["scenario"],
        "entities.openssh.parameters.find-exploit-patched",
    )
    .unwrap_or_else(|| panic!("{}", r["scenario"]["assumptions"]));
    assert_eq!(patched["status"], "illustrative");
    assert_eq!(patched["expression"], "Never");
    assert!(
        patched["paths"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("scenarios.patch.changes[0]"))
    );
    // The baseline's exploit rests on the switch as written.
    let found = assumption(&r["baseline"], "entities.openssh.parameters.find-exploit").unwrap();
    assert!(
        found["paths"]
            .as_array()
            .unwrap()
            .contains(&serde_json::json!("entities.openssh.defenses.patched"))
    );
}

/// The lecture with every average time halved: what an attacker twice as fast
/// meets, written out step by step.
fn halved(text: &str) -> String {
    [
        ("10", "5"),
        ("5", "2.5"),
        ("2", "1"),
        ("1", "0.5"),
        ("0.5", "0.25"),
    ]
    .iter()
    .fold(text.to_owned(), |t, (from, to)| {
        // Each average once, largest first, marked so it is not halved twice.
        t.replace(
            &format!("Exponential(mean {from})\""),
            &format!("Exponential(mean {to}~)\""),
        )
    })
    .replace("~)", ")")
}

#[test]
fn a_faster_attacker_takes_the_same_draws_in_less_time() {
    // A horizon short enough that speed decides.
    let lecture = LECTURE.replacen("horizon: 100\n", "horizon: 5\n", 1);
    let text = with_scenario(
        &lecture,
        "  fast:\n    label: Twice as fast\n    attacker: {speed: 2}\n    changes: []",
    );
    let r = solve(&text, Some("fast"), 10_000);
    let written_out = solve(&halved(&lecture), None, 10_000);
    // Scaling a draw by two is exact, so the scenario is the halved model's
    // baseline to the last bit.
    assert_eq!(r["scenario"]["outcome"], written_out["baseline"]["outcome"]);
    assert_eq!(r["scenario"]["nodes"], written_out["baseline"]["nodes"]);
    // A faster attacker only ever gets there sooner: a negative benefit.
    let d = delta(&r);
    assert!(d["mean"].as_f64().unwrap() < 0.0, "{d}");
    assert!(p_target(&r["scenario"]) > p_target(&r["baseline"]));
    // The scenario says its times were scaled; the baseline does not.
    let speed = assumption(&r["scenario"], "scenarios.fast.attacker.speed")
        .unwrap_or_else(|| panic!("{}", r["scenario"]["assumptions"]));
    assert_eq!(speed["status"], "attacker");
    assert_eq!(speed["expression"], "2 × faster");
    assert!(assumption(&r["baseline"], "scenarios.fast.attacker.speed").is_none());
}

#[test]
fn an_attacker_at_speed_one_changes_nothing() {
    let text = with_scenario(
        LECTURE,
        "  same:\n    label: Same\n    attacker: {speed: 1}\n    changes: []",
    );
    let r = solve(&text, Some("same"), 4096);
    assert_eq!(r["scenario"]["outcome"], r["baseline"]["outcome"]);
    assert_eq!(r["scenario"]["nodes"], r["baseline"]["nodes"]);
    assert_eq!(delta(&r)["mean"], 0.0);
}
