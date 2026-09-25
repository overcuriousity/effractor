//! What the generator makes of an architecture: which steps, what each one
//! needs, and that none of it depends on labels or the order a document lists
//! things in.

use std::collections::{BTreeMap, BTreeSet};
use std::str::FromStr;

use effractor_components::{
    Binding, GeneratedGraph, GeneratedKind, RULES, ResolvedTtc, generate, resolve,
};
use effractor_core::architecture::{
    Architecture, Association, Defense, Entity, EntityKind, Factor, Mode, Privilege, Relation, Slot,
};
use effractor_core::{AssociationId, Code, Document, FlowId, ScenarioId};

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
            // Timed, or a join that takes no time.
            assert!(
                matches!(n.duration, Binding::Parameter { .. } | Binding::Logical),
                "{}",
                n.id
            );
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
                "state/account/admin-account/authenticated",
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
            "action/product-find-exploit/openssh",
            &["state/product/openssh/reachable"],
        ),
        (
            "action/service-deploy-exploit/sshd",
            &[
                "state/product/openssh/exploit-ready",
                "state/service/sshd/reachable",
            ],
        ),
        (
            "action/service-login/server-account/sshd",
            &[
                "state/account/server-account/authenticated",
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
            "state/product/openssh/exploit-ready",
            &["action/product-find-exploit/openssh"],
        ),
        (
            "state/product/openssh/reachable",
            &["state/service/sshd/reachable"],
        ),
        (
            "state/service/sshd/reachable",
            &["state/flow/ssh/connected"],
        ),
        (
            "state/session/server-account/sshd",
            &["action/service-login/server-account/sshd"],
        ),
        (
            "state/account/server-account/mfa-satisfied",
            &[
                "action/mfa-bypass/server-account",
                "input/policy/server-account/mfa",
            ],
        ),
        (
            "state/account/server-account/authenticated",
            &["action/account-authenticated/server-account"],
        ),
        (
            "action/account-authenticated/server-account",
            &[
                "state/account/server-account/material",
                "state/account/server-account/mfa-satisfied",
            ],
        ),
        (
            "action/mfa-bypass/server-account",
            &["state/account/server-account/material"],
        ),
        ("input/policy/server-account/mfa", &[]),
        (
            "state/account/admin-account/mfa-satisfied",
            &[
                "action/mfa-bypass/admin-account",
                "input/policy/admin-account/mfa",
            ],
        ),
        (
            "state/account/admin-account/authenticated",
            &["action/account-authenticated/admin-account"],
        ),
        (
            "action/account-authenticated/admin-account",
            &[
                "state/account/admin-account/material",
                "state/account/admin-account/mfa-satisfied",
            ],
        ),
        (
            "action/mfa-bypass/admin-account",
            &["state/account/admin-account/material"],
        ),
        ("input/policy/admin-account/mfa", &[]),
    ];
    let expected: BTreeMap<String, Vec<String>> = expected
        .iter()
        .map(|(k, v)| (k.to_string(), v.iter().map(|s| s.to_string()).collect()))
        .collect();
    assert_eq!(table(&graph), expected);
}

#[test]
fn every_rule_is_used_by_a_fixture_and_names_what_it_bound() {
    const FIXTURES: [&str; 5] = [
        include_str!("fixtures/architectures/branch-office.yaml"),
        include_str!("fixtures/architectures/web-shop.yaml"),
        include_str!("fixtures/architectures/clinic-records.yaml"),
        include_str!("fixtures/architectures/cloud-support-agent.yaml"),
        include_str!("fixtures/architectures/self-hosted-nextcloud.yaml"),
    ];
    let mut used: BTreeSet<String> = BTreeSet::new();
    for text in std::iter::once(LECTURE).chain(FIXTURES) {
        let g = generate(&architecture(text)).unwrap();
        used.extend(
            g.nodes
                .iter()
                .flat_map(|n| n.origins.iter().map(|o| o.rule.clone())),
        );
    }
    let all: BTreeSet<String> = RULES.iter().map(|r| r.id.to_owned()).collect();
    assert_eq!(used, all);

    let graph = generate(&lecture()).unwrap();

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

    // Without the permission the flow is neither allowed nor denied: it is
    // unfinished, so the graph is generated with its connection unknown.
    let mut m = lecture();
    unrelate(&mut m, "allow-ssh");
    m.scenarios.shift_remove(&id::<ScenarioId>("deny"));
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "action/flow-connect/ssh"),
        ["state/application/ssh-client/control"]
    );
    assert_eq!(
        connect_ttc(&m, &graph),
        ResolvedTtc::Unknown(vec!["flows.ssh.route[1]".to_owned()])
    );
}

fn connect_ttc(model: &Architecture, graph: &GeneratedGraph) -> ResolvedTtc {
    let at = graph
        .nodes
        .iter()
        .position(|n| n.id == "action/flow-connect/ssh")
        .unwrap();
    resolve(model, graph, None).unwrap().ttc[at].clone()
}

fn route(model: &mut Architecture, hops: &[&str]) {
    model.flows.get_mut(&id::<FlowId>("ssh")).unwrap().route = hops.iter().map(|h| id(h)).collect();
}

/// A flow still being drawn does not stop the graph: its connection is an
/// unknown whose missing fields are where the route stops, it keeps the
/// permissions of the routers already on it, and a finished route restores
/// exactly the complete graph.
#[test]
fn an_unfinished_route_generates_with_an_unknown_connection() {
    let complete = generate(&lecture()).unwrap();
    for (hops, missing, permission) in [
        (&[][..], "flows.ssh.route", false),
        (&["client-net"][..], "flows.ssh.route[0]", false),
        (&["client-net", "bridge"][..], "flows.ssh.route", true),
    ] {
        let mut m = lecture();
        route(&mut m, hops);
        let graph = generate(&m).unwrap_or_else(|e| panic!("{hops:?}: {e:?}"));
        assert_eq!(
            graph.nodes.iter().map(|n| &n.id).collect::<Vec<_>>(),
            complete.nodes.iter().map(|n| &n.id).collect::<Vec<_>>(),
            "{hops:?}"
        );
        let mut expected = vec!["state/application/ssh-client/control".to_owned()];
        if permission {
            expected.push("state/permission/filter/ssh".to_owned());
        }
        assert_eq!(
            inputs(&graph, "action/flow-connect/ssh"),
            expected,
            "{hops:?}"
        );
        match connect_ttc(&m, &graph) {
            ResolvedTtc::Unknown(paths) => {
                assert!(paths.contains(&missing.to_owned()), "{hops:?}: {paths:?}")
            }
            known => panic!("{hops:?}: {known:?}"),
        }
    }
    let mut m = lecture();
    route(&mut m, &["client-net", "bridge", "server-net"]);
    assert_eq!(generate(&m).unwrap(), complete);
}

/// A router with no firewall filters nothing: the graph is generated, and a
/// flow crosses it with no permission and a known time to connect.
#[test]
fn a_router_without_a_firewall_lets_its_flows_through() {
    let mut m = lecture();
    m.scenarios.shift_remove(&id::<ScenarioId>("deny"));
    unrelate(&mut m, "allow-ssh");
    unrelate(&mut m, "bridge-filter");
    m.entities
        .shift_remove(&id::<effractor_core::EntityId>("filter"));
    let diagnostics = effractor_core::validate_architecture(&m);
    assert!(diagnostics.is_empty(), "{diagnostics:?}");
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "action/flow-connect/ssh"),
        ["state/application/ssh-client/control"]
    );
    assert!(
        !matches!(connect_ttc(&m, &graph), ResolvedTtc::Unknown(_)),
        "{:?}",
        connect_ttc(&m, &graph)
    );
}

/// What the rest of the model leaves out still stops generation: a flow from
/// software that runs nowhere.
#[test]
fn missing_hosting_still_blocks_generation() {
    let mut m = lecture();
    let hosting = m
        .associations
        .iter()
        .find(|(_, a)| matches!(&a.relation, Relation::Hosts { to, .. } if to.as_str() == "ssh-client"))
        .map(|(k, _)| k.to_string())
        .unwrap();
    unrelate(&mut m, &hosting);
    let errors = generate(&m).unwrap_err();
    assert!(
        errors
            .iter()
            .any(|d| d.code == Code::Incomplete && d.path == "entities.ssh-client"),
        "{errors:?}"
    );
    assert!(
        errors.iter().all(|d| d.code != Code::Unfinished),
        "{errors:?}"
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
        contained: false,
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
fn a_router_on_a_host_is_controlled_from_it_and_left_by_an_escape() {
    let mut m = lecture();
    add(&mut m, "hypervisor", EntityKind::Host);
    relate(
        &mut m,
        "hypervisor-net",
        Relation::Attached {
            from: id("hypervisor"),
            to: id("admin-net"),
        },
    );
    relate(
        &mut m,
        "router-vm",
        Relation::Hosts {
            from: id("hypervisor"),
            to: id("bridge"),
            privilege: Privilege::Admin,
            contained: false,
        },
    );
    let graph = generate(&m).unwrap();
    assert_eq!(
        inputs(&graph, "state/router/bridge/admin"),
        [
            "action/administration-login/admin-net/admin-account/bridge",
            "state/host/hypervisor/admin"
        ]
    );
    let origin = node(&graph, "state/router/bridge/admin")
        .origins
        .iter()
        .find(|o| o.rule == "hosted-router")
        .unwrap();
    let names: Vec<&str> = origin.associations.iter().map(|a| a.as_str()).collect();
    assert_eq!(names, ["router-vm"]);
    // The router's admin is not the hypervisor's: the way out of the VM is
    // its own timed step.
    let out = inputs(&graph, "state/host/hypervisor/admin");
    assert!(!out.contains(&"state/router/bridge/admin".to_owned()));
    assert!(
        out.contains(&"action/router-escape/bridge".to_owned()),
        "{out:?}"
    );
    assert!(
        !graph
            .nodes
            .iter()
            .any(|n| n.id == "state/router/bridge/control")
    );

    // Run as a user on the box, a user on the box is enough.
    unrelate(&mut m, "router-vm");
    relate(
        &mut m,
        "router-vm",
        Relation::Hosts {
            from: id("hypervisor"),
            to: id("bridge"),
            privilege: Privilege::User,
            contained: false,
        },
    );
    let graph = generate(&m).unwrap();
    assert!(
        inputs(&graph, "state/router/bridge/admin")
            .contains(&"state/host/hypervisor/user".to_owned())
    );
}

#[test]
fn router_software_runs_as_admin() {
    let mut m = lecture();
    add(&mut m, "router-web", EntityKind::Service);
    add(&mut m, "router-web-software", EntityKind::Product);
    relate(
        &mut m,
        "router-web-instance",
        Relation::InstanceOf {
            from: id("router-web"),
            to: id("router-web-software"),
        },
    );
    relate(
        &mut m,
        "router-hosts-web",
        Relation::Hosts {
            from: id("bridge"),
            to: id("router-web"),
            privilege: Privilege::Admin,
            contained: false,
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
fn extraction_is_per_store_and_discovery_per_product() {
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
            contained: false,
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
    assert_eq!(count("action/product-find-exploit/"), 1);
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

#[test]
fn a_hypervisor_controls_its_guests_and_a_guest_escapes_by_a_timed_step() {
    let mut m = lecture();
    add(&mut m, "hv", EntityKind::Host);
    relate(
        &mut m,
        "hv-server",
        Relation::Hosts {
            from: id("hv"),
            to: id("server"),
            privilege: Privilege::User,
            contained: false,
        },
    );
    let g = generate(&m).unwrap();
    // Host control at the guest's privilege is guest admin, logically.
    assert!(inputs(&g, "state/host/server/admin").contains(&"state/host/hv/user".to_owned()));
    // Back out: guest admin, then the escape, then the host at that privilege.
    assert_eq!(
        inputs(&g, "action/guest-escape/server"),
        vec!["state/host/server/admin"]
    );
    assert!(inputs(&g, "state/host/hv/user").contains(&"action/guest-escape/server".to_owned()));
    assert!(matches!(
        node(&g, "action/guest-escape/server").duration,
        Binding::Parameter {
            base: Slot::Escape,
            replacement: None,
            ..
        }
    ));
}

#[test]
fn a_router_on_a_host_escapes_to_it_by_a_timed_step() {
    let mut m = lecture();
    add(&mut m, "box", EntityKind::Host);
    relate(
        &mut m,
        "box-bridge",
        Relation::Hosts {
            from: id("box"),
            to: id("bridge"),
            privilege: Privilege::Admin,
            contained: false,
        },
    );
    let g = generate(&m).unwrap();
    assert!(inputs(&g, "state/router/bridge/admin").contains(&"state/host/box/admin".to_owned()));
    assert_eq!(
        inputs(&g, "action/router-escape/bridge"),
        vec!["state/router/bridge/admin"]
    );
    assert!(inputs(&g, "state/host/box/admin").contains(&"action/router-escape/bridge".to_owned()));
}

#[test]
fn an_unhosted_host_has_no_escape_step() {
    let g = generate(&lecture()).unwrap();
    assert!(g.nodes.iter().all(|n| !n.id.contains("escape")));
}

#[test]
fn two_instances_share_one_discovery_and_deploy_separately() {
    let mut m = lecture();
    add(&mut m, "sshd2", EntityKind::Service);
    relate(
        &mut m,
        "sshd2-hosting",
        Relation::Hosts {
            from: id("server"),
            to: id("sshd2"),
            privilege: Privilege::User,
            contained: false,
        },
    );
    relate(
        &mut m,
        "sshd2-openssh",
        Relation::InstanceOf {
            from: id("sshd2"),
            to: id("openssh"),
        },
    );
    let g = generate(&m).unwrap();
    let mut reach = inputs(&g, "state/product/openssh/reachable");
    reach.sort();
    assert_eq!(
        reach,
        vec![
            "state/service/sshd/reachable",
            "state/service/sshd2/reachable"
        ]
    );
    assert_eq!(
        inputs(&g, "action/product-find-exploit/openssh"),
        vec!["state/product/openssh/reachable"]
    );
    assert_eq!(
        inputs(&g, "action/service-deploy-exploit/sshd2"),
        vec![
            "state/product/openssh/exploit-ready",
            "state/service/sshd2/reachable"
        ]
    );
    assert!(
        g.nodes
            .iter()
            .all(|n| n.id != "action/service-find-exploit/sshd")
    );
    assert!(matches!(
        node(&g, "action/product-find-exploit/openssh").duration,
        Binding::Parameter {
            base: Slot::FindExploit,
            replacement: Some((Defense::Patched, Slot::FindExploitPatched)),
            ..
        }
    ));
}

#[test]
fn an_action_names_the_component_whose_time_it_takes_last() {
    let mut m = lecture();
    add(&mut m, "hv", EntityKind::Host);
    relate(
        &mut m,
        "hv-server",
        Relation::Hosts {
            from: id("hv"),
            to: id("server"),
            privilege: Privilege::User,
            contained: false,
        },
    );
    let g = generate(&m).unwrap();
    let last = |step: &str| {
        node(&g, step).origins[0]
            .entities
            .last()
            .unwrap()
            .to_string()
    };
    assert_eq!(last("action/service-deploy-exploit/sshd"), "sshd");
    assert_eq!(last("action/guest-escape/server"), "server");
}

#[test]
fn a_login_needs_the_account_authenticated_and_mfa_joins_material() {
    let g = generate(&lecture()).unwrap();
    assert_eq!(
        inputs(&g, "action/service-login/server-account/sshd"),
        vec![
            "state/account/server-account/authenticated",
            "state/service/sshd/reachable"
        ]
    );
    assert_eq!(
        inputs(&g, "action/account-authenticated/server-account"),
        vec![
            "state/account/server-account/material",
            "state/account/server-account/mfa-satisfied"
        ]
    );
    assert_eq!(
        node(&g, "action/account-authenticated/server-account").duration,
        Binding::Logical
    );
    let mut mfa = inputs(&g, "state/account/server-account/mfa-satisfied");
    mfa.sort();
    assert_eq!(
        mfa,
        vec![
            "action/mfa-bypass/server-account",
            "input/policy/server-account/mfa"
        ]
    );
    assert_eq!(
        node(&g, "input/policy/server-account/mfa").duration,
        Binding::Policy {
            entity: id("server-account"),
            defense: Defense::Mfa
        }
    );
    assert_eq!(
        inputs(&g, "action/mfa-bypass/server-account"),
        vec!["state/account/server-account/material"]
    );
    assert!(matches!(
        node(&g, "action/mfa-bypass/server-account").duration,
        Binding::Parameter {
            base: Slot::MfaBypass,
            replacement: None,
            ..
        }
    ));
}

#[test]
fn a_second_factor_satisfies_mfa_and_gives_no_material() {
    let mut m = lecture();
    add(&mut m, "seed", EntityKind::Credential);
    relate(
        &mut m,
        "seed-auth",
        Relation::Authenticates {
            from: id("seed"),
            to: id("server-account"),
            factor: Factor::Second,
        },
    );
    let g = generate(&m).unwrap();
    assert!(
        inputs(&g, "state/account/server-account/mfa-satisfied")
            .contains(&"state/credential/seed/possessed".to_owned())
    );
    assert!(
        !inputs(&g, "state/account/server-account/material")
            .contains(&"state/credential/seed/possessed".to_owned())
    );
}

#[test]
fn a_workload_uses_its_identity_and_roles_chain_finitely() {
    let mut m = lecture();
    add(&mut m, "role-a", EntityKind::Account);
    add(&mut m, "role-b", EntityKind::Account);
    relate(
        &mut m,
        "sshd-runs-as",
        Relation::RunsAs {
            from: id("sshd"),
            to: id("role-a"),
            privilege: Privilege::User,
        },
    );
    relate(
        &mut m,
        "server-runs-as",
        Relation::RunsAs {
            from: id("server"),
            to: id("role-b"),
            privilege: Privilege::Admin,
        },
    );
    relate(
        &mut m,
        "a-to-b",
        Relation::Assumes {
            from: id("role-a"),
            to: id("role-b"),
        },
    );
    relate(
        &mut m,
        "b-to-a",
        Relation::Assumes {
            from: id("role-b"),
            to: id("role-a"),
        },
    );
    let g = generate(&m).unwrap();
    let a = inputs(&g, "state/account/role-a/authenticated");
    assert!(
        a.contains(&"state/service/sshd/control".to_owned()),
        "{a:?}"
    );
    assert!(
        a.contains(&"state/account/role-b/authenticated".to_owned()),
        "{a:?}"
    );
    let b = inputs(&g, "state/account/role-b/authenticated");
    assert!(b.contains(&"state/host/server/admin".to_owned()), "{b:?}");
    assert!(
        b.contains(&"state/account/role-a/authenticated".to_owned()),
        "{b:?}"
    );
}

#[test]
fn role_cycles_are_finite() {
    let mut m = lecture();
    add(&mut m, "role-a", EntityKind::Account);
    add(&mut m, "role-b", EntityKind::Account);
    relate(
        &mut m,
        "a-to-b",
        Relation::Assumes {
            from: id("role-a"),
            to: id("role-b"),
        },
    );
    relate(
        &mut m,
        "b-to-a",
        Relation::Assumes {
            from: id("role-b"),
            to: id("role-a"),
        },
    );
    let g = generate(&m).unwrap();
    // The cycle is in the graph…
    assert!(
        inputs(&g, "state/account/role-b/authenticated")
            .contains(&"state/account/role-a/authenticated".to_owned())
    );
    assert!(
        inputs(&g, "state/account/role-a/authenticated")
            .contains(&"state/account/role-b/authenticated".to_owned())
    );
    let reached = possible(&g);
    // …but A→B→A with nothing seeding it is not a derivation.
    assert!(!reached.contains("state/account/role-a/authenticated"));
    assert!(!reached.contains("state/account/role-b/authenticated"));
}

/// The lecture with a phishable administrator who uses the SSH client and
/// knows the server key.
fn operators() -> Architecture {
    let mut m = lecture();
    add(&mut m, "internet", EntityKind::Network);
    add(&mut m, "ada", EntityKind::Person);
    relate(
        &mut m,
        "mail-ada",
        Relation::Delivers {
            from: id("internet"),
            to: id("ada"),
        },
    );
    relate(
        &mut m,
        "ada-key",
        Relation::Knows {
            from: id("ada"),
            to: id("server-key"),
        },
    );
    relate(
        &mut m,
        "ada-client",
        Relation::Operates {
            from: id("ada"),
            to: id("ssh-client"),
        },
    );
    m
}

#[test]
fn content_reaches_people_and_deceit_follows_by_a_timed_step() {
    let g = generate(&operators()).unwrap();
    assert!(
        inputs(&g, "state/person/ada/contacted")
            .contains(&"state/network/internet/access".to_owned())
    );
    assert_eq!(
        inputs(&g, "action/phish/ada"),
        vec!["state/person/ada/contacted"]
    );
    assert!(matches!(
        node(&g, "action/phish/ada").duration,
        Binding::Parameter {
            base: Slot::Phish,
            replacement: Some((Defense::Trained, Slot::PhishTrained)),
            ..
        }
    ));
    assert!(
        inputs(&g, "state/credential/server-key/possessed")
            .contains(&"state/person/ada/deceived".to_owned())
    );
    assert!(
        inputs(&g, "state/application/ssh-client/control")
            .contains(&"state/person/ada/deceived".to_owned())
    );
}

#[test]
fn a_controlled_service_reaches_the_people_whose_software_it_serves() {
    // The lecture's SSH client flows to sshd: whoever controls sshd reaches
    // the client's operator.
    let g = generate(&operators()).unwrap();
    let mut contacted = inputs(&g, "state/person/ada/contacted");
    contacted.sort();
    assert_eq!(
        contacted,
        vec![
            "state/network/internet/access",
            "state/service/sshd/control"
        ]
    );
}

/// The lecture's SSH client also reads what arrives from the internet: it
/// processes content.
fn reader() -> Architecture {
    let mut m = lecture();
    add(&mut m, "internet", EntityKind::Network);
    relate(
        &mut m,
        "mail-client",
        Relation::Delivers {
            from: id("internet"),
            to: id("ssh-client"),
        },
    );
    m
}

#[test]
fn content_reaches_software_and_takes_it_over_by_a_timed_step() {
    let g = generate(&reader()).unwrap();
    let mut contacted = inputs(&g, "state/application/ssh-client/contacted");
    contacted.sort();
    // From the zone, and from the service its own flow targets.
    assert_eq!(
        contacted,
        vec![
            "state/network/internet/access",
            "state/service/sshd/control"
        ]
    );
    assert_eq!(
        inputs(&g, "action/take-over/ssh-client"),
        vec!["state/application/ssh-client/contacted"]
    );
    assert!(matches!(
        node(&g, "action/take-over/ssh-client").duration,
        Binding::Parameter {
            base: Slot::TakeOver,
            replacement: Some((Defense::Guarded, Slot::TakeOverGuarded)),
            ..
        }
    ));
    assert!(
        inputs(&g, "state/application/ssh-client/control")
            .contains(&"action/take-over/ssh-client".to_owned())
    );
}

#[test]
fn software_no_content_reaches_has_no_take_over() {
    let g = generate(&lecture()).unwrap();
    assert!(
        !g.nodes
            .iter()
            .any(|n| n.id.ends_with("/contacted") || n.id.starts_with("action/take-over/")),
        "only software that content is said to reach processes it"
    );
}

#[test]
fn contained_software_does_not_control_its_machine() {
    let mut m = reader();
    let hosting = m
        .associations
        .get_mut(&id::<AssociationId>("client-hosting"))
        .unwrap();
    let Relation::Hosts { contained, .. } = &mut hosting.relation else {
        panic!("client-hosting hosts");
    };
    assert!(!*contained);
    let open = generate(&m).unwrap();
    assert!(
        inputs(&open, "state/host/workstation/user")
            .contains(&"state/application/ssh-client/control".to_owned())
    );
    let Relation::Hosts { contained, .. } = &mut m
        .associations
        .get_mut(&id::<AssociationId>("client-hosting"))
        .unwrap()
        .relation
    else {
        unreachable!()
    };
    *contained = true;
    let closed = generate(&m).unwrap();
    assert!(
        !inputs(&closed, "state/host/workstation/user")
            .contains(&"state/application/ssh-client/control".to_owned())
    );
    // The machine still controls the software.
    assert!(
        inputs(&closed, "state/application/ssh-client/control")
            .contains(&"state/host/workstation/user".to_owned())
    );
}

/// The lecture's SSH server holds a customer table; the server account may
/// write it through a login, the server's key encrypts it.
fn with_data(decrypts: bool) -> Architecture {
    let mut m = lecture();
    add(&mut m, "table", EntityKind::Data);
    relate(
        &mut m,
        "sshd-table",
        Relation::Holds {
            from: id("sshd"),
            to: id("table"),
            privilege: Privilege::User,
            decrypts: Some(decrypts),
        },
    );
    relate(
        &mut m,
        "account-table",
        Relation::Accesses {
            from: id("server-account"),
            to: id("table"),
            mode: Mode::Write,
        },
    );
    relate(
        &mut m,
        "table-key",
        Relation::EncryptedWith {
            from: id("table"),
            to: id("server-key"),
        },
    );
    m
}

#[test]
fn a_decrypting_holder_reads_and_modifies_its_data() {
    let g = generate(&with_data(true)).unwrap();
    for state in ["read", "modified"] {
        let into = inputs(&g, &format!("state/data/table/{state}"));
        assert!(
            into.contains(&"state/service/sshd/control".to_owned()),
            "{into:?}"
        );
        assert!(
            into.contains(&"state/session/server-account/sshd".to_owned()),
            "{into:?}"
        );
    }
}

#[test]
fn a_holder_that_does_not_decrypt_needs_plaintext_to_read() {
    let g = generate(&with_data(false)).unwrap();
    let mut read = inputs(&g, "state/data/table/read");
    read.sort();
    assert_eq!(
        read,
        vec![
            "action/account-data/server-account/sshd/table",
            "action/holder-read/sshd/table"
        ]
    );
    assert_eq!(
        inputs(&g, "action/holder-read/sshd/table"),
        vec!["state/data/table/plaintext", "state/service/sshd/control"]
    );
    assert_eq!(
        node(&g, "action/holder-read/sshd/table").duration,
        Binding::Logical
    );
    assert_eq!(
        inputs(&g, "action/account-data/server-account/sshd/table"),
        vec![
            "state/data/table/plaintext",
            "state/session/server-account/sshd"
        ]
    );
    // Encryption does not stop modification.
    assert!(
        inputs(&g, "state/data/table/modified").contains(&"state/service/sshd/control".to_owned())
    );
    let mut plain = inputs(&g, "state/data/table/plaintext");
    plain.sort();
    assert_eq!(
        plain,
        vec![
            "input/policy/table/encrypted",
            "state/credential/server-key/possessed"
        ]
    );
    assert_eq!(
        node(&g, "input/policy/table/encrypted").duration,
        Binding::Policy {
            entity: id("table"),
            defense: Defense::Encrypted
        }
    );
}

#[test]
fn read_access_never_modifies() {
    let mut m = with_data(true);
    relate(
        &mut m,
        "account-table",
        Relation::Accesses {
            from: id("server-account"),
            to: id("table"),
            mode: Mode::Read,
        },
    );
    let g = generate(&m).unwrap();
    assert!(
        !inputs(&g, "state/data/table/modified")
            .contains(&"state/session/server-account/sshd".to_owned())
    );
}

#[test]
fn changed_content_reaches_the_software_that_reads_it_and_cycles_stay_finite() {
    let mut m = with_data(true);
    // The server itself reads the table it holds: a cycle through the data.
    relate(
        &mut m,
        "sshd-reads",
        Relation::Reads {
            from: id("sshd"),
            to: id("table"),
        },
    );
    let g = generate(&m).unwrap();
    assert!(
        inputs(&g, "state/service/sshd/contacted")
            .contains(&"state/data/table/modified".to_owned())
    );
    assert_eq!(
        inputs(&g, "action/take-over/sshd"),
        vec!["state/service/sshd/contacted"]
    );
    // Nothing seeds sshd → table → sshd when the attacker has no way in.
    m.attacker.footholds.clear();
    m.attacker
        .footholds
        .push(effractor_core::architecture::StateRef {
            entity: id("admin-net"),
            state: effractor_core::architecture::State::Access,
        });
    let reached = possible(&generate(&m).unwrap());
    assert!(!reached.contains("state/service/sshd/control"));
}

#[test]
fn data_can_be_the_target() {
    let mut m = with_data(true);
    m.attacker.target = Some(effractor_core::architecture::StateRef {
        entity: id("table"),
        state: effractor_core::architecture::State::Read,
    });
    let g = generate(&m).unwrap();
    assert_eq!(g.nodes[g.target].id, "state/data/table/read");
}

/// A hosting whose privilege nobody knows (what an nmap import writes):
/// what holds either way stays certain — admin on the host runs the service,
/// the service is at least user on it — and the two steps that depend on the
/// privilege are unknown inputs pointing at it, never a guess.
#[test]
fn an_unknown_hosting_privilege_is_an_unknown_step_not_a_guess() {
    let mut m = lecture();
    let a = m
        .associations
        .get_mut(&id::<AssociationId>("service-hosting"))
        .unwrap();
    a.relation = Relation::Hosts {
        from: id("server"),
        to: id("sshd"),
        privilege: Privilege::Unknown,
        contained: false,
    };
    let graph = generate(&m).unwrap_or_else(|e| panic!("{e:?}"));
    let has = |node: &str, input: &str| inputs(&graph, node).iter().any(|i| i == input);
    // Certain either way.
    assert!(has("state/service/sshd/control", "state/host/server/admin"));
    assert!(has("state/host/server/user", "state/service/sshd/control"));
    // Unknown: the service's control to the host's admin, and the host's
    // user to the service's control.
    assert_eq!(
        inputs(&graph, "action/execution-privilege/sshd/server"),
        ["state/service/sshd/control"]
    );
    assert!(has(
        "state/host/server/admin",
        "action/execution-privilege/sshd/server"
    ));
    assert!(!has(
        "state/host/server/admin",
        "state/service/sshd/control"
    ));
    assert_eq!(
        inputs(&graph, "action/host-execution/server/sshd"),
        ["state/host/server/user"]
    );
    assert!(has(
        "state/service/sshd/control",
        "action/host-execution/server/sshd"
    ));
    assert!(!has("state/service/sshd/control", "state/host/server/user"));
    let resolved = resolve(&m, &graph, None).unwrap();
    for step in [
        "action/execution-privilege/sshd/server",
        "action/host-execution/server/sshd",
    ] {
        let at = graph.nodes.iter().position(|n| n.id == step).unwrap();
        assert_eq!(
            resolved.ttc[at],
            ResolvedTtc::Unknown(vec!["associations.service-hosting.privilege".to_owned()]),
            "{step}"
        );
    }
}
