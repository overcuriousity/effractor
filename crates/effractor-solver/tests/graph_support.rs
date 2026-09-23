//! What can happen at all, before any number: which steps are possible, which
//! a known defence or denial blocks, and which unknown inputs a result would
//! rest on. An unknown on a blocked route costs nothing; an unknown on a
//! possible alternative costs the number.

use effractor_components::{GeneratedGraph, ResolvedGraph, generate, resolve};
use effractor_core::architecture::Architecture;
use effractor_core::{Distribution, Document, ScenarioId, Shorthand};
use effractor_solver::graph_support::{GraphSupport, Status, analyze, never};

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");
const UNKNOWN: &str =
    include_str!("../../effractor-components/tests/fixtures/lecture-unknown.yaml");
const TARGET: &str = "state/host/server/admin";
const FIND: &str = "entities.sshd.parameters.find-exploit";

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

struct Analyzed {
    graph: GeneratedGraph,
    support: GraphSupport,
}

impl Analyzed {
    fn of(text: &str, scenario: Option<&str>) -> Self {
        let model = architecture(text);
        let graph = generate(&model).unwrap();
        let scenario = scenario.map(|s| s.parse::<ScenarioId>().unwrap());
        let resolved: ResolvedGraph = resolve(&model, &graph, scenario.as_ref()).unwrap();
        let support = analyze(&graph, &resolved);
        Self { graph, support }
    }

    fn index(&self, id: &str) -> usize {
        self.graph
            .nodes
            .iter()
            .position(|n| n.id == id)
            .unwrap_or_else(|| panic!("no node {id}"))
    }

    fn status(&self, id: &str) -> Status {
        self.support.status[self.index(id)]
    }

    fn missing(&self, id: &str) -> &[String] {
        &self.support.missing[self.index(id)]
    }

    fn in_support(&self, id: &str) -> bool {
        self.support.target_support.contains(&self.index(id))
    }
}

fn with(text: &str, before: &str, insert: &str) -> String {
    assert!(text.contains(before), "no {before:?}");
    text.replacen(before, &format!("{insert}{before}"), 1)
}

#[test]
fn the_lecture_target_is_possible_on_known_inputs_only() {
    let a = Analyzed::of(LECTURE, None);
    assert_eq!(a.status(TARGET), Status::Possible);
    assert!(a.missing(TARGET).is_empty());
    assert!(a.in_support("action/service-login/server-account/sshd"));
    assert!(a.in_support("action/service-find-exploit/sshd"));
    // The foothold and everything it gives at once are seeded.
    assert_eq!(a.status("state/host/workstation/user"), Status::Seeded);
    assert!(a.support.zero[a.index("state/network/client-net/access")]);
    // Nothing reaches the isolated administration network.
    assert_eq!(
        a.status("state/network/admin-net/access"),
        Status::Unreachable
    );
    assert!(!a.in_support("action/administration-login/admin-net/admin-account/bridge"));
}

#[test]
fn an_unknown_on_a_possible_alternative_costs_the_target_its_number() {
    let a = Analyzed::of(UNKNOWN, None);
    assert_eq!(a.status(TARGET), Status::Possible);
    assert_eq!(a.missing(TARGET), [FIND]);
    // Each step for its own support: the login route knows everything.
    assert!(
        a.missing("action/service-login/server-account/sshd")
            .is_empty()
    );
    assert!(a.missing("state/session/server-account/sshd").is_empty());
    assert_eq!(a.missing("action/service-find-exploit/sshd"), [FIND]);
    assert_eq!(a.missing("state/service/sshd/exploit-ready"), [FIND]);
    // The unknown step itself is still possible: qualitative, not a number.
    assert_eq!(
        a.status("action/service-find-exploit/sshd"),
        Status::Possible
    );
}

#[test]
fn a_denied_flow_makes_the_target_unreachable_not_unknown() {
    let a = Analyzed::of(UNKNOWN, Some("deny"));
    assert_eq!(
        a.status("input/flow-permission/filter/ssh"),
        Status::Blocked
    );
    assert_eq!(a.status(TARGET), Status::Unreachable);
    assert!(a.missing(TARGET).is_empty());
    assert!(a.missing("action/service-find-exploit/sshd").is_empty());
    assert!(a.support.target_support.is_empty());
}

#[test]
fn a_known_perfect_defence_blocks_its_step_and_leaves_the_rest() {
    let a = Analyzed::of(LECTURE, Some("patch"));
    assert_eq!(
        a.status("action/service-find-exploit/sshd"),
        Status::Blocked
    );
    assert_eq!(
        a.status("state/service/sshd/exploit-ready"),
        Status::Unreachable
    );
    assert_eq!(a.status(TARGET), Status::Possible);
    let both = Analyzed::of(LECTURE, Some("both"));
    assert_eq!(
        both.status("action/credential-extract/workstation/server-key"),
        Status::Blocked
    );
    assert_eq!(both.status(TARGET), Status::Unreachable);
}

#[test]
fn an_unknown_service_elsewhere_does_not_cost_the_known_target() {
    let text = with(
        UNKNOWN,
        "\nassociations:\n",
        "  db-host:
    kind: host
    label: Database host
  db:
    kind: service
    label: Database
    parameters:
      find-exploit: {status: unknown}
      find-exploit-patched: {status: unknown}
      deploy-exploit: {status: unknown}
      login: {status: unknown}
    defenses: {patched: false}
",
    );
    let text = with(
        &text,
        "\nflows:\n",
        "  db-net:
    kind: attached
    from: db-host
    to: server-net
  db-hosting:
    kind: hosts
    from: db-host
    to: db
    privilege: admin
  allow-db:
    kind: permits
    from: filter
    to: sql
    allowed: true
",
    );
    let text = with(
        &text,
        "\nattacker:\n",
        "  sql:
    label: SQL from the workstation
    source: ssh-client
    target: db
    route: [client-net, bridge, server-net]
    parameters:
      connect: {status: illustrative, ttc: \"Exponential(2)\", note: test}
",
    );
    let a = Analyzed::of(&text, None);
    assert_eq!(a.status("state/service/db/reachable"), Status::Possible);
    assert!(a.missing("state/service/db/reachable").is_empty());
    assert_eq!(
        a.missing("action/service-find-exploit/db"),
        ["entities.db.parameters.find-exploit"]
    );
    assert_eq!(a.status("state/host/db-host/admin"), Status::Possible);
    assert!(!a.missing("state/host/db-host/admin").is_empty());
    // The server's own unknown still counts, and only it.
    assert_eq!(a.missing(TARGET), [FIND]);

    // With discovery known, the server target needs nothing from the database.
    let known = text.replace(
        "      find-exploit:\n        status: unknown\n",
        "      find-exploit:\n        status: illustrative\n        ttc: \"Exponential(0.1)\"\n        note: test\n",
    );
    let b = Analyzed::of(&known, None);
    assert!(b.missing(TARGET).is_empty());
    assert!(!b.in_support("state/service/db/reachable"));
    assert!(!b.missing("action/service-find-exploit/db").is_empty());
}

#[test]
fn a_seeded_target_needs_nothing_else() {
    let text = UNKNOWN.replace(
        "    - {entity: workstation, state: admin}\n",
        "    - {entity: workstation, state: admin}\n    - {entity: server, state: admin}\n",
    );
    let a = Analyzed::of(&text, None);
    assert_eq!(a.status(TARGET), Status::Seeded);
    assert!(a.missing(TARGET).is_empty());
    assert!(a.support.zero[a.index(TARGET)]);
    assert_eq!(a.support.target_support, vec![a.index(TARGET)]);
}

#[test]
fn an_unknown_policy_beside_a_management_route_is_shown_unresolved() {
    let text = LECTURE
        .replace(
            "    to: ssh\n    allowed: true\n",
            "    to: ssh\n    allowed: unknown\n",
        )
        .replace(
            "    - {entity: workstation, state: admin}\n",
            "    - {entity: workstation, state: admin}\n    - {entity: admin-net, state: access}\n",
        );
    let a = Analyzed::of(&text, None);
    assert_eq!(a.status("state/router/bridge/admin"), Status::Possible);
    assert!(a.missing("state/router/bridge/admin").is_empty());
    assert_eq!(
        a.status("input/flow-permission/filter/ssh"),
        Status::Possible
    );
    let unresolved = ["associations.allow-ssh.allowed"];
    assert_eq!(a.missing("state/permission/filter/ssh"), unresolved);
    assert_eq!(a.missing(TARGET), unresolved);
    // Denying it leaves the management route, fully known.
    let denied = Analyzed::of(&text, Some("deny"));
    assert_eq!(denied.status(TARGET), Status::Possible);
    assert!(denied.missing(TARGET).is_empty());
}

#[test]
fn impossible_durations_are_recognised_by_meaning_not_spelling() {
    use Distribution as D;
    for d in [
        D::Infinity,
        D::Bernoulli(0.0),
        D::Product(0.0, Box::new(D::Exponential(1.0))),
        D::Product(0.5, Box::new(D::Infinity)),
        D::Product(0.5, Box::new(D::Named(Shorthand::Enabled))),
        D::Named(Shorthand::Enabled),
    ] {
        assert!(never(&d), "{d:?}");
    }
    for d in [
        D::Zero,
        D::Bernoulli(0.5),
        D::Exponential(1.0),
        D::Product(0.5, Box::new(D::Exponential(1.0))),
        D::Named(Shorthand::Disabled),
        D::Named(Shorthand::HardAndUncertain),
    ] {
        assert!(!never(&d), "{d:?}");
    }
}

#[test]
fn an_unknown_on_a_route_a_known_step_blocks_costs_the_target_nothing() {
    // Discovery unknown, deployment known never: the exploit route is closed
    // after the unknown, and the login route is fully known.
    let text = UNKNOWN.replace(
        "        ttc: \"Exponential(0.5)\"\n        note: Exercise assumption; includes",
        "        ttc: \"Infinity\"\n        note: Exercise assumption; includes",
    );
    let a = Analyzed::of(&text, None);
    assert_eq!(
        a.status("action/service-find-exploit/sshd"),
        Status::Possible
    );
    assert_eq!(a.missing("action/service-find-exploit/sshd"), [FIND]);
    assert_eq!(
        a.status("action/service-deploy-exploit/sshd"),
        Status::Blocked
    );
    assert_eq!(a.status(TARGET), Status::Possible);
    assert!(a.missing(TARGET).is_empty());
    assert!(!a.in_support("action/service-find-exploit/sshd"));

    // Deployment unknown behind a known-never discovery: the same.
    let text = LECTURE
        .replace(
            "      find-exploit:\n        status: illustrative\n        ttc: \"Exponential(0.1)\"",
            "      find-exploit:\n        status: illustrative\n        ttc: \"Infinity\"",
        )
        .replace(
            "      deploy-exploit:\n        status: illustrative\n        ttc: \"Exponential(0.5)\"\n        note: Exercise assumption; includes any IDS or antimalware bypass on the server, which is not modelled separately\n",
            "      deploy-exploit:\n        status: unknown\n",
        );
    let b = Analyzed::of(&text, None);
    assert_eq!(
        b.status("action/service-deploy-exploit/sshd"),
        Status::Unreachable
    );
    assert!(b.missing("action/service-deploy-exploit/sshd").is_empty());
    assert!(b.missing(TARGET).is_empty());
}
