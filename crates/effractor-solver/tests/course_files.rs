//! The course's three architecture files, read as a student downloads them
//! (lecture spec §11): the exercise, the same with one input unknown, and the
//! same with defences that slow an attacker down instead of stopping one.

use effractor_components::generate;
use effractor_core::Document;
use effractor_core::ScenarioId;
use effractor_core::architecture::Architecture;
use effractor_solver::graph_results::{GraphConfig, GraphSolve};
use serde_json::Value;

// Compiled in, as the solver's other fixtures are: the same tests run under
// wasmtime, which is given no directory above the crate's.
fn course(name: &str) -> &'static str {
    match name {
        "lecture-architecture.yaml" => {
            include_str!("../../../docs/course/lecture-architecture.yaml")
        }
        "lecture-unknown.yaml" => include_str!("../../../docs/course/lecture-unknown.yaml"),
        "lecture-partial-defenses.yaml" => {
            include_str!("../../../docs/course/lecture-partial-defenses.yaml")
        }
        "README.md" => include_str!("../../../docs/course/README.md"),
        other => panic!("no course file {other}"),
    }
}

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

fn solve(text: &str, scenario: Option<&str>) -> Value {
    let model = architecture(text);
    let graph = generate(&model).unwrap();
    let scenario = scenario.map(|s| s.parse::<ScenarioId>().unwrap());
    let config = GraphConfig::from_model(&model);
    let solve = GraphSolve::begin(&model, &graph, scenario.as_ref(), &config).unwrap();
    serde_json::to_value(solve.finish()).unwrap()
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

fn p_target(report: &Value) -> f64 {
    stats(&report["outcome"])["p_target"].as_f64().unwrap()
}

fn assumption<'a>(report: &'a Value, path: &str) -> &'a Value {
    report["assumptions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["path"] == path)
        .unwrap_or_else(|| panic!("no assumption {path}"))
}

/// The exercise with `from` written as `to`, which has to be there `times` times.
fn rewritten(text: &str, from: &str, to: &str, times: usize) -> String {
    assert_eq!(text.matches(from).count(), times, "{from}");
    text.replace(from, to)
}

const NAME: &str = "name: SSH server behind a router\n";
const NEVER_PATCHED: &str = "        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a patched service has no exploit to find\"\n";
const NEVER_PROTECTED: &str = "        ttc: \"Never\"\n        note: \"Exercise assumption: perfect blocking, a protected store gives nothing up\"\n";

#[test]
fn the_unknown_file_is_the_exercise_with_discovery_unknown() {
    let exercise = course("lecture-architecture.yaml");
    let expected = rewritten(
        &rewritten(
            exercise,
            NAME,
            "name: SSH server behind a router, discovery unknown\n",
            1,
        ),
        "      find-exploit:\n        status: illustrative\n        ttc: \"Exponential(mean 10)\"\n        note: Exercise assumption; not calibrated to the lecture\n",
        "      find-exploit:\n        status: unknown\n",
        1,
    );
    let text = course("lecture-unknown.yaml");
    assert_eq!(text, expected);
    let r = solve(text, None);
    assert_eq!(
        r["baseline"]["outcome"]["unavailable"]["missing"],
        serde_json::json!(["entities.openssh.parameters.find-exploit"])
    );
    // The route is still drawn; only its number is withheld.
    assert_eq!(
        node(&r["baseline"], "action/product-find-exploit/openssh")["status"],
        "possible"
    );
}

#[test]
fn the_partial_file_changes_only_what_a_defence_is_replaced_by() {
    let exercise = course("lecture-architecture.yaml");
    let expected = rewritten(
        &rewritten(
            &rewritten(
                exercise,
                NAME,
                "name: SSH server behind a router, partial defences\n",
                1,
            ),
            NEVER_PATCHED,
            "        ttc: \"Exponential(mean 100)\"\n        note: \"Exercise assumption: a patch leaves flaws nobody has reported yet, ten times harder to find\"\n",
            1,
        ),
        NEVER_PROTECTED,
        "        ttc: \"Exponential(mean 50)\"\n        note: \"Exercise assumption: a protected store gives the key up to patience, ten times slower\"\n",
        2,
    );
    let text = course("lecture-partial-defenses.yaml");
    assert_eq!(text, expected);
    assert!(!text.contains("Never"), "a partial defence never stops one");

    // With no defence on, it is the exercise.
    let partial = solve(text, None);
    assert_eq!(
        partial["baseline"]["outcome"],
        solve(exercise, None)["baseline"]["outcome"]
    );
}

#[test]
fn a_partial_defence_slows_its_route_and_leaves_it_open() {
    let text = course("lecture-partial-defenses.yaml");
    for (scenario, step, path, written) in [
        (
            "patch",
            "action/product-find-exploit/openssh",
            "entities.openssh.parameters.find-exploit-patched",
            "Exponential(mean 100)",
        ),
        (
            "protect",
            "action/credential-extract/workstation/server-key",
            "entities.server-key.parameters.extract-protected",
            "Exponential(mean 50)",
        ),
    ] {
        let r = solve(text, Some(scenario));
        let s = &r["scenario"];
        assert_eq!(node(s, step)["status"], "possible", "{scenario}");
        assert_eq!(node(s, "state/host/server/admin")["status"], "possible");
        let a = assumption(s, path);
        assert_eq!(a["status"], "illustrative", "{scenario}");
        assert_eq!(a["expression"], written, "{scenario}");
        // The other route is as fast as before, so the target barely moves
        // by the horizon; the step itself is slower.
        let slowed = stats(&node(s, step)["outcome"])["p"].as_f64().unwrap();
        let before = stats(&node(&r["baseline"], step)["outcome"])["p"]
            .as_f64()
            .unwrap();
        assert!(slowed < before, "{scenario}: {slowed} vs {before}");
        assert_ne!(
            stats(&s["outcome"])["ttc_cdf"],
            stats(&r["baseline"]["outcome"])["ttc_cdf"],
            "{scenario}"
        );
    }
}

#[test]
fn both_partial_defences_lower_the_target_without_closing_it() {
    let r = solve(course("lecture-partial-defenses.yaml"), Some("both"));
    let s = &r["scenario"];
    assert_eq!(node(s, "state/host/server/admin")["status"], "possible");
    let (base, scenario) = (p_target(&r["baseline"]), p_target(s));
    assert!(scenario > 0.0 && scenario < base, "{scenario} vs {base}");
    let d = stats(&r["delta"]);
    assert!((d["mean"].as_f64().unwrap() - (base - scenario)).abs() < 1e-12);
    assert!(d["ci"]["lo"].as_f64().unwrap() > 0.0, "{d}");
}

#[test]
fn a_denied_flow_still_closes_the_partial_file() {
    let r = solve(course("lecture-partial-defenses.yaml"), Some("deny"));
    assert_eq!(
        node(&r["scenario"], "state/host/server/admin")["status"],
        "unreachable"
    );
    assert_eq!(p_target(&r["scenario"]), 0.0);
}

/// The course text's table of what to expect: every row is what the solver
/// says for that file and scenario, at the days the columns name.
#[test]
fn the_course_text_quotes_what_the_solver_says() {
    let readme = course("README.md");
    let rows: Vec<Vec<&str>> = readme
        .lines()
        .filter(|l| l.starts_with("| `lecture-"))
        .map(|l| l.trim_matches('|').split('|').map(str::trim).collect())
        .collect();
    assert_eq!(rows.len(), 8, "two files, the baseline and three scenarios");
    for row in rows {
        let file = row[0].trim_matches('`');
        let scenario = row[1].trim_matches('`');
        let r = solve(course(file), (scenario != "baseline").then_some(scenario));
        let side = if scenario == "baseline" {
            &r["baseline"]
        } else {
            &r["scenario"]
        };
        let cdf = stats(&side["outcome"])["ttc_cdf"].as_array().unwrap();
        for (cell, day) in row[2..].iter().zip([12.5, 25.0, 50.0, 100.0]) {
            let point = cdf
                .iter()
                .find(|p| p[0].as_f64() == Some(day))
                .unwrap_or_else(|| panic!("no point at {day}"));
            assert_eq!(
                point[1].as_f64().unwrap(),
                cell.parse::<f64>().unwrap(),
                "{file} {scenario} by {day} d"
            );
        }
    }
}

/// Spec §8: the course file draws what the extract draws — access controls
/// on the router and the server, the operating systems and putty as
/// products, the server's IDS and anti-malware got past before its software
/// is exploited, root on the router through its access control.
#[test]
fn the_course_file_draws_the_extract() {
    let model = architecture(course("lecture-architecture.yaml"));
    let graph = generate(&model).unwrap();
    let inputs = |id: &str| -> Vec<String> {
        let n = graph
            .nodes
            .iter()
            .find(|n| n.id == id)
            .unwrap_or_else(|| panic!("no node {id}"));
        match &n.kind {
            effractor_components::GeneratedKind::Any { inputs }
            | effractor_components::GeneratedKind::All { inputs } => {
                inputs.iter().map(|&i| graph.nodes[i].id.clone()).collect()
            }
            effractor_components::GeneratedKind::Input => Vec::new(),
        }
    };
    let deploy = inputs("action/service-deploy-exploit/sshd");
    assert!(
        deploy.contains(&"state/ids/server-ids/passed".to_owned()),
        "{deploy:?}"
    );
    assert!(
        deploy.contains(&"state/host/server/malware-cleared".to_owned()),
        "{deploy:?}"
    );
    let login = graph
        .nodes
        .iter()
        .find(|n| n.id == "action/administration-login/admin-net/admin-account/bridge")
        .expect("the router's administration login");
    assert!(
        login.origins[0]
            .associations
            .iter()
            .any(|a| a.as_str() == "bridge-access"),
        "through the router's access control"
    );
    // The SSH flow is encrypted (spec §8): ARP cache poisoning on its way
    // would take nothing off it.
    let ssh = model.flows.values().find(|f| f.label.starts_with("SSH")).unwrap();
    assert!(ssh.encrypted, "the SSH flow is encrypted");
    for product in ["ubuntu", "windows-7", "putty"] {
        assert!(
            graph
                .nodes
                .iter()
                .any(|n| n.id == format!("state/product/{product}/reachable")),
            "{product}"
        );
    }
}
