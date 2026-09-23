//! What the generator makes of an architecture: which steps, what each one
//! needs, and that none of it depends on labels or the order a document lists
//! things in.

use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;

use effractor_components::{Binding, GeneratedGraph, GeneratedKind, RULES, generate, resolve};
use effractor_core::architecture::{
    Architecture, Association, Entity, EntityKind, Privilege, Relation,
};
use effractor_core::{AssociationId, Code, Document, FlowId};

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

fn lecture() -> Architecture {
    architecture(LECTURE)
}

#[test]
fn the_lecture_fixture_is_canonical_and_complete() {
    let (_, diagnostics) = effractor_format::diagnose_document(LECTURE);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    assert_eq!(effractor_format::canonicalize(LECTURE).unwrap(), LECTURE);
}

#[test]
fn the_lecture_generates_its_exploit_and_login_steps() {
    let model = lecture();
    let graph = generate(&model).unwrap();
    assert!(
        graph
            .nodes
            .iter()
            .any(|n| n.id == "action/service-login/server-account/sshd")
    );
    assert!(
        graph
            .nodes
            .iter()
            .any(|n| n.id == "action/service-deploy-exploit/sshd")
    );
    assert_eq!(graph.nodes[graph.target].id, "state/host/server/admin");
    assert_eq!(
        resolve(&model, &graph, None).unwrap().ttc.len(),
        graph.nodes.len()
    );
}

fn node<'a>(graph: &'a GeneratedGraph, id: &str) -> &'a effractor_components::GeneratedNode {
    graph
        .nodes
        .iter()
        .find(|n| n.id == id)
        .unwrap_or_else(|| panic!("no node {id}"))
}

fn inputs(graph: &GeneratedGraph, id: &str) -> Vec<String> {
    let n = node(graph, id);
    let ix = match &n.kind {
        GeneratedKind::Input => return vec![],
        GeneratedKind::Any { inputs } | GeneratedKind::All { inputs } => inputs,
    };
    ix.iter().map(|&i| graph.nodes[i].id.clone()).collect()
}

#[test]
fn nodes_are_sorted_by_id_bytes_and_inputs_by_index() {
    let graph = generate(&lecture()).unwrap();
    for pair in graph.nodes.windows(2) {
        assert!(pair[0].id.as_bytes() < pair[1].id.as_bytes());
    }
    for n in &graph.nodes {
        if let GeneratedKind::Any { inputs } | GeneratedKind::All { inputs } = &n.kind {
            assert!(inputs.windows(2).all(|w| w[0] < w[1]), "{}", n.id);
        }
        if let GeneratedKind::All { inputs } = &n.kind {
            assert!(!inputs.is_empty(), "{}", n.id);
            assert!(matches!(n.duration, Binding::Parameter { .. }), "{}", n.id);
        }
        if let GeneratedKind::Any { .. } = &n.kind {
            assert!(matches!(n.duration, Binding::Logical), "{}", n.id);
        }
    }
}

fn id<T: FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

fn relate(model: &mut Architecture, key: &str, relation: Relation) {
    model.associations.insert(
        id(key),
        Association {
            relation,
            description: None,
        },
    );
}

fn unrelate(model: &mut Architecture, key: &str) {
    assert!(
        model
            .associations
            .shift_remove(&id::<AssociationId>(key))
            .is_some(),
        "{key}"
    );
}

fn add(model: &mut Architecture, key: &str, kind: EntityKind) {
    model.entities.insert(id(key), Entity::new(kind, key));
}

/// What could complete if every duration were finite and every policy
/// allowed: the qualitative closure from the inputs. Iterative, like the
/// evaluator will be.
fn possible(graph: &GeneratedGraph) -> BTreeSet<String> {
    let mut done = vec![false; graph.nodes.len()];
    loop {
        let mut changed = false;
        for (i, n) in graph.nodes.iter().enumerate() {
            if done[i] {
                continue;
            }
            let now = match &n.kind {
                GeneratedKind::Input => true,
                GeneratedKind::Any { inputs } => inputs.iter().any(|&j| done[j]),
                GeneratedKind::All { inputs } => inputs.iter().all(|&j| done[j]),
            };
            if now {
                done[i] = true;
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
    graph
        .nodes
        .iter()
        .zip(done)
        .filter(|(_, d)| *d)
        .map(|(n, _)| n.id.clone())
        .collect()
}

fn table(graph: &GeneratedGraph) -> BTreeMap<String, Vec<String>> {
    graph
        .nodes
        .iter()
        .map(|n| (n.id.clone(), inputs(graph, &n.id)))
        .collect()
}

#[test]
fn every_lecture_step_has_exactly_its_prerequisites() {
    let graph = generate(&lecture()).unwrap();
    let expected: &[(&str, &[&str])] = &[
        (
            "action/administration-login/admin-net/admin-account/bridge",
            &[
                "state/account/admin-account/material",
                "state/network/admin-net/access",
            ],
        ),
        (
            "action/credential-extract/workstation/admin-key",
            &["state/host/workstation/admin"],
        ),
        (
            "action/credential-extract/workstation/server-key",
            &["state/host/workstation/user"],
        ),
        (
            "action/flow-connect/ssh",
            &[
                "state/application/ssh-client/control",
                "state/permission/filter/ssh",
            ],
        ),
        (
            "action/service-deploy-exploit/sshd",
            &["state/service/sshd/exploit-ready"],
        ),
        (
            "action/service-find-exploit/sshd",
            &["state/service/sshd/reachable"],
        ),
        (
            "action/service-login/server-account/sshd",
            &[
                "state/account/server-account/material",
                "state/service/sshd/reachable",
            ],
        ),
        ("input/flow-permission/filter/ssh", &[]),
        ("input/foothold/workstation/admin", &[]),
        (
            "state/account/admin-account/material",
            &["state/credential/admin-key/possessed"],
        ),
        (
            "state/account/server-account/material",
            &["state/credential/server-key/possessed"],
        ),
        (
            "state/application/ssh-client/control",
            &["state/host/workstation/user"],
        ),
        (
            "state/credential/admin-key/possessed",
            &["action/credential-extract/workstation/admin-key"],
        ),
        (
            "state/credential/server-key/possessed",
            &["action/credential-extract/workstation/server-key"],
        ),
        ("state/flow/ssh/connected", &["action/flow-connect/ssh"]),
        (
            "state/host/server/admin",
            &[
                "state/service/sshd/control",
                "state/session/server-account/sshd",
            ],
        ),
        ("state/host/server/user", &["state/host/server/admin"]),
        (
            "state/host/workstation/admin",
            &["input/foothold/workstation/admin"],
        ),
        (
            "state/host/workstation/user",
            &[
                "state/application/ssh-client/control",
                "state/host/workstation/admin",
            ],
        ),
        ("state/network/admin-net/access", &[]),
        (
            "state/network/client-net/access",
            &["state/host/workstation/user", "state/router/bridge/admin"],
        ),
        (
            "state/network/server-net/access",
            &["state/host/server/user", "state/router/bridge/admin"],
        ),
        (
            "state/permission/filter/ssh",
            &[
                "input/flow-permission/filter/ssh",
                "state/router/bridge/admin",
            ],
        ),
        (
            "state/router/bridge/admin",
            &["action/administration-login/admin-net/admin-account/bridge"],
        ),
        (
            "state/service/sshd/control",
            &[
                "action/service-deploy-exploit/sshd",
                "state/host/server/admin",
            ],
        ),
        (
            "state/service/sshd/exploit-ready",
            &["action/service-find-exploit/sshd"],
        ),
        (
            "state/service/sshd/reachable",
            &["state/flow/ssh/connected"],
        ),
        (
            "state/session/server-account/sshd",
            &["action/service-login/server-account/sshd"],
        ),
    ];
    let expected: BTreeMap<String, Vec<String>> = expected
        .iter()
        .map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect()))
        .collect();
    assert_eq!(table(&graph), expected);
}

#[test]
fn every_rule_is_used_by_the_lecture_and_names_what_it_bound() {
    let graph = generate(&lecture()).unwrap();
    let used: BTreeSet<&str> = graph
        .nodes
        .iter()
        .flat_map(|n| n.origins.iter().map(|o| o.rule.as_str()))
        .collect();
    let all: BTreeSet<&str> = RULES.iter().map(|r| r.id).collect();
    assert_eq!(used, all);

    let rules = |id: &str| -> BTreeSet<String> {
        node(&graph, id)
            .origins
            .iter()
            .map(|o| o.rule.clone())
            .collect()
    };
    // A logical fact lists every rule that produces it.
    assert_eq!(
        rules("state/host/server/admin"),
        ["execution-privilege", "session-grant"]
            .map(String::from)
            .into()
    );
    assert_eq!(
        rules("state/permission/filter/ssh"),
        ["flow-permission"].map(String::from).into()
    );
    let grant = node(&graph, "state/host/server/admin")
        .origins
        .iter()
        .find(|o| o.rule == "session-grant")
        .unwrap();
    let names: Vec<&str> = grant.associations.iter().map(|a| a.as_str()).collect();
    assert_eq!(names, ["ssh-authorizes", "server-grant", "service-hosting"]);
    let login = &node(&graph, "action/service-login/server-account/sshd").origins[0];
    assert_eq!(login.paths, ["entities.sshd.parameters.login"]);
    assert!(!login.assumptions.is_empty());
}

#[test]
fn the_lecture_target_has_an_exploit_and_a_login_route() {
    let model = lecture();
    let graph = generate(&model).unwrap();
    let reached = possible(&graph);
    assert!(reached.contains("state/host/server/admin"));
    assert!(reached.contains("action/service-deploy-exploit/sshd"));
    assert!(reached.contains("action/service-login/server-account/sshd"));
    // The administration zone is isolated: the admin key alone crosses nothing.
    assert!(reached.contains("state/account/admin-account/material"));
    assert!(!reached.contains("state/network/admin-net/access"));
    assert!(!reached.contains("state/router/bridge/admin"));
}

/// The target with one relationship changed: which of the two routes remain.
fn routes(model: &Architecture) -> (bool, bool, bool) {
    let graph = generate(model).unwrap();
    let reached = possible(&graph);
    let has = |id: &str| reached.contains(id);
    (
        has("state/host/server/admin"),
        has("action/service-deploy-exploit/sshd"),
        has("state/session/server-account/sshd")
            && node(&graph, "state/host/server/admin")
                .origins
                .iter()
                .any(|o| o.rule == "session-grant"),
    )
}

#[test]
fn one_relationship_removed_removes_its_route() {
    assert_eq!(routes(&lecture()), (true, true, true));

    // Without authorization there is no login; the exploit remains.
    let mut m = lecture();
    unrelate(&mut m, "ssh-authorizes");
    assert_eq!(routes(&m), (true, true, false));
    assert!(
        !generate(&m)
            .unwrap()
            .nodes
            .iter()
            .any(|n| n.id.starts_with("action/service-login/"))
    );

    // Without the key's authentication, the material is never there.
    let mut m = lecture();
    unrelate(&mut m, "server-auth");
    let graph = generate(&m).unwrap();
    assert!(!possible(&graph).contains("state/account/server-account/material"));
    assert!(!possible(&graph).contains("action/service-login/server-account/sshd"));

    // Without the grant the session is a session and nothing more.
    let mut m = lecture();
    unrelate(&mut m, "server-grant");
    assert_eq!(routes(&m), (true, true, false));

    // A grant on another machine does not turn this login into that control.
    let mut m = lecture();
    unrelate(&mut m, "server-grant");
    relate(
        &mut m,
        "server-grant",
        Relation::Grants {
            from: id("server-account"),
            to: id("workstation"),
            privilege: Privilege::Admin,
        },
    );
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "state/host/workstation/admin"),
        ["input/foothold/workstation/admin"]
    );
    assert_eq!(routes(&m), (true, true, false));

    // A user grant gives the login route server.user, not the target.
    let mut m = lecture();
    let a = m
        .associations
        .get_mut(&id::<AssociationId>("server-grant"))
        .unwrap();
    a.relation = Relation::Grants {
        from: id("server-account"),
        to: id("server"),
        privilege: Privilege::User,
    };
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "state/host/server/user"),
        [
            "state/host/server/admin",
            "state/session/server-account/sshd"
        ]
    );
    assert_eq!(routes(&m), (true, true, false));

    // Without the permission the flow is neither allowed nor denied: the
    // model is incomplete and nothing is generated.
    let mut m = lecture();
    unrelate(&mut m, "allow-ssh");
    let errors = generate(&m).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|d| d.code == Code::Incomplete && d.path == "flows.ssh.route[1]")
    );
}

#[test]
fn user_software_never_grants_admin_and_root_software_does() {
    let graph = generate(&lecture()).unwrap();
    // The SSH client runs as user: of the machine's states, its control
    // yields workstation.user only.
    let from_client: Vec<&str> = graph
        .nodes
        .iter()
        .filter(|n| n.id.starts_with("state/"))
        .filter(|n| {
            inputs(&graph, &n.id)
                .iter()
                .any(|i| i == "state/application/ssh-client/control")
        })
        .map(|n| n.id.as_str())
        .collect();
    assert_eq!(from_client, ["state/host/workstation/user"]);

    // Hosting the service as user takes the exploit route's admin away.
    let mut m = lecture();
    let a = m
        .associations
        .get_mut(&id::<AssociationId>("service-hosting"))
        .unwrap();
    a.relation = Relation::Hosts {
        from: id("server"),
        to: id("sshd"),
        privilege: Privilege::User,
    };
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "state/host/server/admin"),
        ["state/session/server-account/sshd"]
    );
    assert_eq!(
        inputs(&graph, "state/service/sshd/control"),
        [
            "action/service-deploy-exploit/sshd",
            "state/host/server/user"
        ]
    );
}

#[test]
fn router_software_runs_as_admin() {
    let mut m = lecture();
    add(&mut m, "router-web", EntityKind::Service);
    relate(
        &mut m,
        "router-hosts-web",
        Relation::Hosts {
            from: id("bridge"),
            to: id("router-web"),
            privilege: Privilege::Admin,
        },
    );
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "state/service/router-web/control"),
        [
            "action/service-deploy-exploit/router-web",
            "state/router/bridge/admin"
        ]
    );
    assert!(
        inputs(&graph, "state/router/bridge/admin")
            .contains(&"state/service/router-web/control".to_owned())
    );
}

#[test]
fn network_access_creates_no_flow() {
    let graph = generate(&lecture()).unwrap();
    let uses_access: Vec<&str> = graph
        .nodes
        .iter()
        .filter(|n| {
            inputs(&graph, &n.id)
                .iter()
                .any(|i| i.starts_with("state/network/"))
        })
        .map(|n| n.id.as_str())
        .collect();
    // Only management logins start from a zone; a flow is declared or absent.
    assert_eq!(
        uses_access,
        ["action/administration-login/admin-net/admin-account/bridge"]
    );
}

#[test]
fn an_administrator_foothold_opens_the_management_route() {
    let mut m = lecture();
    relate(
        &mut m,
        "workstation-admin-net",
        Relation::Attached {
            from: id("workstation"),
            to: id("admin-net"),
        },
    );
    let reached = possible(&generate(&m).unwrap());
    assert!(reached.contains("state/network/admin-net/access"));
    assert!(reached.contains("state/router/bridge/admin"));
}

#[test]
fn extraction_is_per_store_and_discovery_per_service() {
    let mut m = lecture();
    // The same key kept in a second place: two extractions, one possession.
    add(&mut m, "laptop", EntityKind::Host);
    relate(
        &mut m,
        "laptop-key-store",
        Relation::Stores {
            from: id("laptop"),
            to: id("server-key"),
            privilege: Privilege::User,
        },
    );
    // A second client reaching the same service: one discovery, one
    // deployment; a second account on it: its own login.
    add(&mut m, "backup-client", EntityKind::Application);
    relate(
        &mut m,
        "backup-hosting",
        Relation::Hosts {
            from: id("workstation"),
            to: id("backup-client"),
            privilege: Privilege::User,
        },
    );
    m.flows.insert(id("backup"), {
        let mut f = m.flows[&id::<FlowId>("ssh")].clone();
        f.source = id("backup-client");
        f.label = "Backup".into();
        f
    });
    relate(
        &mut m,
        "allow-backup",
        Relation::Permits {
            from: id("filter"),
            to: id("backup"),
            allowed: effractor_core::architecture::Switch::On,
        },
    );
    relate(
        &mut m,
        "admin-ssh",
        Relation::Authorizes {
            from: id("admin-account"),
            to: id("sshd"),
        },
    );
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "state/credential/server-key/possessed"),
        [
            "action/credential-extract/laptop/server-key",
            "action/credential-extract/workstation/server-key"
        ]
    );
    assert_eq!(
        inputs(&graph, "state/service/sshd/reachable"),
        ["state/flow/backup/connected", "state/flow/ssh/connected"]
    );
    let count = |prefix: &str| {
        graph
            .nodes
            .iter()
            .filter(|n| n.id.starts_with(prefix))
            .count()
    };
    assert_eq!(count("action/service-find-exploit/"), 1);
    assert_eq!(count("action/service-deploy-exploit/"), 1);
    assert_eq!(count("action/service-login/"), 2);
    assert_eq!(count("action/flow-connect/"), 2);
}

#[test]
fn a_hosting_cycle_is_finite_and_stays_a_cycle() {
    let graph = generate(&lecture()).unwrap();
    // workstation.user → ssh-client.control → workstation.user
    assert!(
        inputs(&graph, "state/application/ssh-client/control")
            .contains(&"state/host/workstation/user".to_owned())
    );
    assert!(
        inputs(&graph, "state/host/workstation/user")
            .contains(&"state/application/ssh-client/control".to_owned())
    );
    // server.admin → sshd.control → server.admin
    assert!(
        inputs(&graph, "state/service/sshd/control")
            .contains(&"state/host/server/admin".to_owned())
    );
    assert!(
        inputs(&graph, "state/host/server/admin")
            .contains(&"state/service/sshd/control".to_owned())
    );
    // An unseeded cycle is not a derivation: without the foothold nothing completes.
    let mut m = lecture();
    m.attacker.footholds.clear();
    m.attacker
        .footholds
        .push(effractor_core::architecture::StateRef {
            entity: id("admin-net"),
            state: effractor_core::architecture::State::Access,
        });
    let reached = possible(&generate(&m).unwrap());
    assert!(!reached.contains("state/host/workstation/user"));
    assert!(!reached.contains("state/host/server/admin"));
}
