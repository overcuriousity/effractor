//! Where every generated step comes from, and what a scenario changes: ids
//! that survive reordering, relabelling and switches; durations that follow
//! the switch that selects them; source paths that exist in the document.

use std::collections::BTreeMap;
use std::str::FromStr;

use effractor_components::{
    GeneratedGraph, GeneratedKind, RULES, ResolvedGraph, ResolvedTtc, generate, graph_image,
    resolve,
};
use effractor_core::architecture::{
    Architecture, Change, Defense, Entity, EntityKind, Evidence, Parameter, Privilege, Relation,
    Scenario, Slot, Switch,
};
use effractor_core::{AssociationId, Code, Distribution, Document, EntityId, FlowId, ScenarioId};
use serde_json::Value;

const LECTURE: &str = include_str!("../../../docs/course/lecture-architecture.yaml");
const UNKNOWN: &str = include_str!("../../../docs/course/lecture-unknown.yaml");

fn architecture(text: &str) -> Architecture {
    match effractor_format::load_document(text) {
        Ok(Document::Architecture(model)) => model,
        other => panic!("not an architecture: {other:?}"),
    }
}

fn id<T: FromStr>(s: &str) -> T
where
    T::Err: std::fmt::Debug,
{
    s.parse().unwrap()
}

fn index(graph: &GeneratedGraph, id: &str) -> usize {
    graph
        .nodes
        .iter()
        .position(|n| n.id == id)
        .unwrap_or_else(|| panic!("no node {id}"))
}

/// Every node's id with its prerequisites' ids: what identity means.
fn shape(graph: &GeneratedGraph) -> BTreeMap<String, Vec<String>> {
    graph
        .nodes
        .iter()
        .map(|n| {
            let inputs = match &n.kind {
                GeneratedKind::Input => vec![],
                GeneratedKind::Any { inputs } | GeneratedKind::All { inputs } => {
                    inputs.iter().map(|&i| graph.nodes[i].id.clone()).collect()
                }
            };
            (n.id.clone(), inputs)
        })
        .collect()
}

fn reversed<K: std::hash::Hash + Eq + Clone, V: Clone>(
    map: &indexmap::IndexMap<K, V>,
) -> indexmap::IndexMap<K, V> {
    map.iter()
        .rev()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

#[test]
fn reordering_and_relabelling_keep_every_identity() {
    let model = architecture(LECTURE);
    let before = generate(&model).unwrap();
    let mut m = model.clone();
    m.entities = reversed(&m.entities);
    m.associations = reversed(&m.associations);
    m.flows = reversed(&m.flows);
    m.scenarios = reversed(&m.scenarios);
    m.attacker.footholds.reverse();
    for e in m.entities.values_mut() {
        e.label = format!("Renamed {}", e.label);
    }
    for f in m.flows.values_mut() {
        f.label = format!("Renamed {}", f.label);
    }
    let after = generate(&m).unwrap();
    assert_eq!(shape(&before), shape(&after));
    // Provenance too: an export does not change with the authoring order.
    for (b, a) in before.nodes.iter().zip(&after.nodes) {
        assert_eq!(b.origins, a.origins, "{}", b.id);
    }
    assert_eq!(before.target, after.target);
    assert_ne!(before.nodes[0].label, after.nodes[0].label);
}

/// The baseline with a scenario's switches written into it.
fn applied(model: &Architecture, scenario: &str) -> Architecture {
    let mut m = model.clone();
    for change in m.scenarios[&id::<ScenarioId>(scenario)].changes.clone() {
        match change {
            Change::EntityDefense {
                entity,
                defense,
                value,
            } => m.entities[&entity].defenses.set(defense, Some(value)),
            Change::Permission { association, value } => {
                if let Relation::Permits { allowed, .. } =
                    &mut m.associations[&association].relation
                {
                    *allowed = value;
                }
            }
        }
    }
    m
}

#[test]
fn switches_change_no_identity() {
    let model = architecture(LECTURE);
    let baseline = shape(&generate(&model).unwrap());
    for scenario in ["patch", "protect", "both", "deny"] {
        assert_eq!(
            shape(&generate(&applied(&model, scenario)).unwrap()),
            baseline,
            "{scenario}"
        );
    }
    let mut unknown = model.clone();
    unknown.entities[&id::<EntityId>("openssh")]
        .defenses
        .patched = Some(Switch::Unknown);
    assert_eq!(shape(&generate(&unknown).unwrap()), baseline);
}

/// The nodes whose resolved duration or source differs between two runs.
fn changed(graph: &GeneratedGraph, a: &ResolvedGraph, b: &ResolvedGraph) -> Vec<String> {
    (0..graph.nodes.len())
        .filter(|&i| a.ttc[i] != b.ttc[i] || a.paths[i] != b.paths[i])
        .map(|i| graph.nodes[i].id.clone())
        .collect()
}

#[test]
fn each_scenario_changes_only_what_it_names() {
    let model = architecture(LECTURE);
    let graph = generate(&model).unwrap();
    let base = resolve(&model, &graph, None).unwrap();
    let under = |s: &str| resolve(&model, &graph, Some(&id(s))).unwrap();

    let find = index(&graph, "action/product-find-exploit/openssh");
    let login = index(&graph, "action/service-login/server-account/sshd");
    let extract = index(&graph, "action/credential-extract/workstation/server-key");
    let policy = index(&graph, "input/flow-permission/filter/ssh");

    assert_eq!(
        base.ttc[find],
        ResolvedTtc::Known(Distribution::ExponentialMean(10.0))
    );
    assert_eq!(
        base.paths[find],
        [
            "entities.openssh.parameters.find-exploit",
            "entities.openssh.defenses.patched"
        ]
    );
    assert_eq!(base.ttc[policy], ResolvedTtc::Known(Distribution::Zero));

    let patch = under("patch");
    assert_eq!(
        changed(&graph, &base, &patch),
        ["action/product-find-exploit/openssh"]
    );
    assert_eq!(patch.ttc[find], ResolvedTtc::Known(Distribution::Infinity));
    assert_eq!(
        patch.paths[find],
        [
            "entities.openssh.parameters.find-exploit-patched",
            "scenarios.patch.changes[0]"
        ]
    );
    assert_eq!(patch.evidence[find][0].status, Evidence::Illustrative);
    assert_eq!(patch.ttc[login], base.ttc[login]);

    let protect = under("protect");
    assert_eq!(
        changed(&graph, &base, &protect),
        ["action/credential-extract/workstation/server-key"]
    );
    assert_eq!(
        protect.ttc[extract],
        ResolvedTtc::Known(Distribution::Infinity)
    );

    let both = under("both");
    assert_eq!(
        changed(&graph, &base, &both),
        [
            "action/credential-extract/workstation/server-key",
            "action/product-find-exploit/openssh"
        ]
    );

    let deny = under("deny");
    assert_eq!(
        changed(&graph, &base, &deny),
        ["input/flow-permission/filter/ssh"]
    );
    assert_eq!(deny.ttc[policy], ResolvedTtc::Known(Distribution::Infinity));
    assert_eq!(deny.paths[policy], ["scenarios.deny.changes[0]"]);
    // The router's management remains an alternative to the denied policy.
    let permission = &graph.nodes[index(&graph, "state/permission/filter/ssh")];
    let GeneratedKind::Any { inputs } = &permission.kind else {
        panic!("a permission is a fact");
    };
    assert!(inputs.contains(&index(&graph, "state/router/bridge/admin")));
}

#[test]
fn what_is_not_known_resolves_to_the_fields_to_fill_in() {
    // The fixture that leaves discovery unknown.
    let model = architecture(UNKNOWN);
    let graph = generate(&model).unwrap();
    let find = index(&graph, "action/product-find-exploit/openssh");
    let base = resolve(&model, &graph, None).unwrap();
    assert_eq!(
        base.ttc[find],
        ResolvedTtc::Unknown(vec!["entities.openssh.parameters.find-exploit".into()])
    );
    // Patching selects the replacement, which is known.
    let patch = resolve(&model, &graph, Some(&id("patch"))).unwrap();
    assert_eq!(patch.ttc[find], ResolvedTtc::Known(Distribution::Infinity));

    // A missing replacement makes only the scenario unknown.
    let mut m = architecture(LECTURE);
    m.entities[&id::<EntityId>("openssh")]
        .parameters
        .insert(Slot::FindExploitPatched, Parameter::unknown());
    let graph = generate(&m).unwrap();
    let find = index(&graph, "action/product-find-exploit/openssh");
    assert!(matches!(
        resolve(&m, &graph, None).unwrap().ttc[find],
        ResolvedTtc::Known(_)
    ));
    assert_eq!(
        resolve(&m, &graph, Some(&id("patch"))).unwrap().ttc[find],
        ResolvedTtc::Unknown(vec![
            "entities.openssh.parameters.find-exploit-patched".into()
        ])
    );

    // An unknown switch is not a default of either value.
    let mut m = architecture(LECTURE);
    m.entities[&id::<EntityId>("openssh")].defenses.patched = Some(Switch::Unknown);
    let r = resolve(&m, &graph, None).unwrap();
    assert_eq!(
        r.ttc[find],
        ResolvedTtc::Unknown(vec!["entities.openssh.defenses.patched".into()])
    );
    assert!(r.evidence[find].is_empty());

    // An unknown policy is an unknown branch, not a denial.
    let mut m = architecture(LECTURE);
    if let Relation::Permits { allowed, .. } =
        &mut m.associations[&id::<AssociationId>("allow-ssh")].relation
    {
        *allowed = Switch::Unknown;
    }
    let policy = index(&graph, "input/flow-permission/filter/ssh");
    assert_eq!(
        resolve(&m, &graph, None).unwrap().ttc[policy],
        ResolvedTtc::Unknown(vec!["associations.allow-ssh.allowed".into()])
    );

    let errors = resolve(&m, &graph, Some(&id("absent"))).unwrap_err();
    assert_eq!(errors[0].code, Code::UnknownReference);
}

/// The value at a provenance path — `a.b[0].c` — in the document image.
fn at<'a>(image: &'a Value, path: &str) -> Option<&'a Value> {
    let mut v = image;
    for part in path.split('.') {
        let (key, index) = match part.split_once('[') {
            Some((k, rest)) => (k, Some(rest.trim_end_matches(']').parse::<usize>().ok()?)),
            None => (part, None),
        };
        v = v.get(key)?;
        if let Some(i) = index {
            v = v.get(i)?;
        }
    }
    Some(v)
}

#[test]
fn every_source_path_exists_in_the_document() {
    let (image, _) = effractor_format::document(LECTURE);
    let image = image.unwrap();
    let model = architecture(LECTURE);
    let graph = generate(&model).unwrap();
    let mut seen = 0;
    for n in &graph.nodes {
        for o in &n.origins {
            for p in &o.paths {
                assert!(at(&image, p).is_some(), "{}: {p}", n.id);
                seen += 1;
            }
            for e in &o.entities {
                assert!(at(&image, &format!("entities.{e}")).is_some());
            }
            for a in &o.associations {
                assert!(at(&image, &format!("associations.{a}")).is_some());
            }
            for f in &o.flows {
                assert!(at(&image, &format!("flows.{f}")).is_some());
            }
        }
    }
    assert!(seen > 10);
    for scenario in [
        None,
        Some("patch"),
        Some("protect"),
        Some("both"),
        Some("deny"),
    ] {
        let r = resolve(&model, &graph, scenario.map(id).as_ref()).unwrap();
        for (n, paths) in graph.nodes.iter().zip(&r.paths) {
            for p in paths {
                assert!(at(&image, p).is_some(), "{scenario:?} {}: {p}", n.id);
            }
        }
    }
}

#[test]
fn every_origin_names_a_catalog_rule_at_its_version() {
    let graph = generate(&architecture(LECTURE)).unwrap();
    for n in &graph.nodes {
        // Only a fact nothing produces lacks an origin: no rule made it.
        if n.origins.is_empty() {
            assert_eq!(n.kind, GeneratedKind::Any { inputs: vec![] }, "{}", n.id);
        }
        for o in &n.origins {
            let rule = RULES.iter().find(|r| r.id == o.rule).expect("catalog rule");
            assert_eq!(rule.version, o.version);
            let assumptions: Vec<&str> = o.assumptions.iter().map(String::as_str).collect();
            assert_eq!(assumptions, rule.assumptions);
        }
    }
}

#[test]
fn the_graph_image_carries_timing_and_provenance() {
    let model = architecture(LECTURE);
    let graph = generate(&model).unwrap();
    let image = graph_image(&graph, &resolve(&model, &graph, Some(&id("deny"))).unwrap());
    assert_eq!(image["effractor-graph"], 1);
    assert_eq!(image["library"]["id"], "core-components");
    assert_eq!(image["library"]["version"], 1);
    assert_eq!(image["semantics"], "sequential-1");
    assert_eq!(image["target"], "state/host/server/admin");
    let nodes = image["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), graph.nodes.len());
    let node = |id: &str| nodes.iter().find(|n| n["id"] == id).unwrap();

    let login = node("action/service-login/server-account/sshd");
    assert_eq!(login["kind"], "all");
    assert_eq!(
        login["inputs"],
        serde_json::json!([
            "state/account/server-account/authenticated",
            "state/service/sshd/reachable"
        ])
    );
    assert_eq!(login["timing"]["status"], "illustrative");
    assert_eq!(login["timing"]["expression"], "Exponential(mean 1)");
    assert_eq!(
        login["timing"]["note"],
        "Exercise assumption; not calibrated to the lecture"
    );
    assert_eq!(login["origins"][0]["rule"], "service-login");

    let policy = node("input/flow-permission/filter/ssh");
    assert_eq!(policy["kind"], "input");
    assert_eq!(policy["timing"]["status"], "policy");
    assert_eq!(policy["timing"]["expression"], "denied");
    assert_eq!(
        policy["timing"]["paths"],
        serde_json::json!(["scenarios.deny.changes[0]"])
    );

    let fact = node("state/host/server/admin");
    assert_eq!(fact["kind"], "any");
    assert_eq!(fact["timing"]["status"], "logical");

    let foothold = node("input/foothold/workstation/admin");
    assert_eq!(foothold["timing"]["status"], "foothold");
    assert_eq!(
        foothold["timing"]["paths"],
        serde_json::json!(["attacker.footholds[0]"])
    );

    // Unknown says what to fill in.
    let model = architecture(UNKNOWN);
    let graph = generate(&model).unwrap();
    let image = graph_image(&graph, &resolve(&model, &graph, None).unwrap());
    let find = image["nodes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|n| n["id"] == "action/product-find-exploit/openssh")
        .unwrap();
    assert_eq!(find["timing"]["status"], "unknown");
    assert_eq!(find["timing"]["expression"], Value::Null);
    assert_eq!(
        find["timing"]["missing"],
        serde_json::json!(["entities.openssh.parameters.find-exploit"])
    );
}

/// `n` networks each administering `m` machines, each machine granting `a`
/// accounts: `n·a·m` management logins from `n·m + a·m` associations.
fn management_mesh(n: usize, a: usize, m: usize) -> Architecture {
    let mut model = architecture(LECTURE);
    for i in 0..n {
        let e: EntityId = id(&format!("zone-{i}"));
        model
            .entities
            .insert(e, Entity::new(EntityKind::Network, "zone"));
    }
    for i in 0..a {
        let e: EntityId = id(&format!("account-{i}"));
        model
            .entities
            .insert(e, Entity::new(EntityKind::Account, "account"));
    }
    for j in 0..m {
        let machine = format!("machine-{j}");
        model
            .entities
            .insert(id(&machine), Entity::new(EntityKind::Host, "machine"));
        for i in 0..n {
            model.associations.insert(
                id(&format!("manage-{i}-{j}")),
                effractor_core::architecture::Association {
                    relation: Relation::Administration {
                        from: id(&format!("zone-{i}")),
                        to: id(&machine),
                    },
                    description: None,
                },
            );
        }
        for i in 0..a {
            model.associations.insert(
                id(&format!("grant-{i}-{j}")),
                effractor_core::architecture::Association {
                    relation: Relation::Grants {
                        from: id(&format!("account-{i}")),
                        to: id(&machine),
                        privilege: Privilege::Admin,
                    },
                    description: None,
                },
            );
        }
    }
    model
}

#[test]
fn a_graph_over_the_node_limit_is_refused_whole() {
    // 20·20·20 = 8,000 logins from 800 associations and 60 entities: the
    // document is within its own limits, its graph is not.
    let model = management_mesh(20, 20, 20);
    assert!(
        !effractor_core::validate_architecture(&model)
            .iter()
            .any(|d| d.severity == effractor_core::Severity::Error)
    );
    let errors = generate(&model).unwrap_err();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].code, Code::Limit);
    assert!(errors[0].message.contains("5000"), "{}", errors[0].message);

    // A mesh below the limit generates every pair.
    let graph = generate(&management_mesh(5, 5, 5)).unwrap();
    let logins = graph
        .nodes
        .iter()
        .filter(|n| n.id.starts_with("action/administration-login/zone-"))
        .count();
    assert_eq!(logins, 125);
}

#[test]
fn flows_and_scenarios_use_their_own_ids() {
    let model = architecture(LECTURE);
    let graph = generate(&model).unwrap();
    let connect = &graph.nodes[index(&graph, "action/flow-connect/ssh")];
    let flows: Vec<&FlowId> = connect.origins[0].flows.iter().collect();
    assert_eq!(flows, [&id::<FlowId>("ssh")]);
    assert_eq!(connect.origins[0].paths, ["flows.ssh.parameters.connect"]);
}

#[test]
fn mfa_resolves_as_a_policy_on_its_switch() {
    let mut m = architecture(LECTURE);
    m.scenarios.insert(
        id("mfa"),
        Scenario {
            label: "MFA".into(),
            attacker: None,
            changes: vec![Change::EntityDefense {
                entity: id("server-account"),
                defense: Defense::Mfa,
                value: Switch::On,
            }],
        },
    );
    m.entities[&id::<EntityId>("server-account")].defenses.mfa = Some(Switch::Off);
    let g = generate(&m).unwrap();
    let i = index(&g, "input/policy/server-account/mfa");
    let base = resolve(&m, &g, None).unwrap();
    assert_eq!(base.ttc[i], ResolvedTtc::Known(Distribution::Zero));
    assert_eq!(base.paths[i], ["entities.server-account.defenses.mfa"]);
    let on = resolve(&m, &g, Some(&id("mfa"))).unwrap();
    assert_eq!(on.ttc[i], ResolvedTtc::Known(Distribution::Infinity));
    assert_eq!(on.paths[i], ["scenarios.mfa.changes[0]"]);
    m.entities[&id::<EntityId>("server-account")].defenses.mfa = Some(Switch::Unknown);
    let unknown = resolve(&m, &g, None).unwrap();
    assert_eq!(
        unknown.ttc[i],
        ResolvedTtc::Unknown(vec!["entities.server-account.defenses.mfa".into()])
    );
}

#[test]
fn switches_never_change_the_graph() {
    let model = architecture(LECTURE);
    let baseline = shape(&generate(&model).unwrap());
    for value in [Switch::On, Switch::Off, Switch::Unknown] {
        let mut m = model.clone();
        for e in m.entities.values_mut() {
            for &defense in e.kind.defenses() {
                e.defenses.set(defense, Some(value));
            }
        }
        assert_eq!(shape(&generate(&m).unwrap()), baseline, "{value:?}");
    }
}

#[test]
fn operator_switches_never_change_the_graph() {
    let mut model = architecture(LECTURE);
    for (key, kind) in [
        ("internet", EntityKind::Network),
        ("ada", EntityKind::Person),
    ] {
        model.entities.insert(id(key), Entity::new(kind, key));
    }
    // Ada reads mail, and so does the SSH client: content-processing software.
    for (key, to) in [("mail-ada", "ada"), ("mail-client", "ssh-client")] {
        model.associations.insert(
            id(key),
            effractor_core::architecture::Association {
                relation: Relation::Delivers {
                    from: id("internet"),
                    to: id(to),
                },
                description: None,
            },
        );
    }
    let baseline = shape(&generate(&model).unwrap());
    for value in [Switch::On, Switch::Off, Switch::Unknown] {
        let mut m = model.clone();
        for e in m.entities.values_mut() {
            for &defense in e.kind.defenses() {
                e.defenses.set(defense, Some(value));
            }
        }
        assert_eq!(shape(&generate(&m).unwrap()), baseline, "{value:?}");
    }
    assert!(baseline.contains_key("action/phish/ada"));
    assert!(baseline.contains_key("action/take-over/ssh-client"));
}

/// The lecture with the router administrator granted through the router's
/// access control (extract Fig. 5.19) instead of on the router.
fn through_access_control() -> Architecture {
    let text = LECTURE
        .replacen(
            "\nassociations:\n",
            "  bridge-login:\n    kind: access-control\n    label: Router login\n\nassociations:\n  bridge-access:\n    kind: controls-access\n    from: bridge\n    to: bridge-login\n",
            1,
        )
        .replacen(
            "  router-grant:\n    kind: grants\n    from: admin-account\n    to: bridge\n",
            "  router-grant:\n    kind: grants\n    from: admin-account\n    to: bridge-login\n",
            1,
        );
    assert_ne!(text, LECTURE);
    architecture(&text)
}

#[test]
fn a_grant_through_an_access_control_generates_the_same_graph() {
    let direct = generate(&architecture(LECTURE)).unwrap();
    let through = generate(&through_access_control()).unwrap();
    assert_eq!(shape(&direct), shape(&through));
}

#[test]
fn a_login_through_an_access_control_names_both_links() {
    let g = generate(&through_access_control()).unwrap();
    let step = &g.nodes[index(
        &g,
        "action/administration-login/admin-net/admin-account/bridge",
    )];
    let o = step
        .origins
        .iter()
        .find(|o| o.rule == "administration-login")
        .unwrap();
    let names: Vec<&str> = o.associations.iter().map(|a| a.as_str()).collect();
    assert!(names.contains(&"router-grant"), "{names:?}");
    assert!(names.contains(&"bridge-access"), "{names:?}");
    assert!(o.entities.iter().any(|e| e.as_str() == "bridge-login"));
}

#[test]
fn a_grant_through_access_control_and_on_the_machine_is_refused() {
    let mut m = through_access_control();
    m.associations.insert(
        id("router-grant-direct"),
        effractor_core::architecture::Association {
            relation: Relation::Grants {
                from: id("admin-account"),
                to: id("bridge"),
                privilege: Privilege::Admin,
            },
            ..m.associations[&id::<AssociationId>("router-grant")].clone()
        },
    );
    let refused = generate(&m).unwrap_err();
    assert!(
        refused
            .iter()
            .any(|d| d.code == Code::Cardinality && d.path == "associations.router-grant-direct"),
        "{refused:?}"
    );
}

#[test]
fn a_session_through_an_access_control_names_both_links() {
    // The server account's grant routed through the server's access control.
    let text = LECTURE
        .replacen(
            "\nassociations:\n",
            "  server-login:\n    kind: access-control\n    label: Server login\n\nassociations:\n  server-access:\n    kind: controls-access\n    from: server\n    to: server-login\n",
            1,
        )
        .replacen(
            "  server-grant:\n    kind: grants\n    from: server-account\n    to: server\n",
            "  server-grant:\n    kind: grants\n    from: server-account\n    to: server-login\n",
            1,
        );
    let direct = generate(&architecture(LECTURE)).unwrap();
    let g = generate(&architecture(&text)).unwrap();
    assert_eq!(shape(&direct), shape(&g));
    let admin = &g.nodes[index(&g, "state/host/server/admin")];
    let o = admin
        .origins
        .iter()
        .find(|o| o.rule == "session-grant")
        .unwrap();
    let names: Vec<&str> = o.associations.iter().map(|a| a.as_str()).collect();
    assert!(
        names.contains(&"server-grant") && names.contains(&"server-access"),
        "{names:?}"
    );
    assert!(o.entities.iter().any(|e| e.as_str() == "server-login"));
}

/// The lecture with Ubuntu Linux on the server (extract Fig. 5.28, 5.35).
fn with_os(deploy: &str) -> Architecture {
    let text = LECTURE
        .replacen(
            "\nassociations:\n",
            "  ubuntu:\n    kind: product\n    label: Ubuntu Linux\n    parameters:\n      find-exploit:\n        status: illustrative\n        ttc: \"Exponential(mean 20)\"\n        note: exercise\n      find-exploit-patched:\n        status: illustrative\n        ttc: \"Never\"\n        note: exercise\n    defenses: {patched: false}\n\nassociations:\n  server-os:\n    kind: instance-of\n    from: server\n    to: ubuntu\n",
            1,
        )
        .replacen(
            "  server:\n    kind: host\n    label: Server\n    parameters:\n",
            &format!("  server:\n    kind: host\n    label: Server\n    parameters:\n{deploy}"),
            1,
        );
    architecture(&text)
}

const DEPLOY_UNKNOWN: &str = "      deploy-exploit:\n        status: unknown\n";

#[test]
fn a_host_is_reachable_through_the_services_it_runs_and_not_by_being_near() {
    let g = generate(&with_os(DEPLOY_UNKNOWN)).unwrap();
    let s = shape(&g);
    assert_eq!(
        s["state/host/server/reachable"],
        ["state/service/sshd/reachable"]
    );
    assert_eq!(
        s["state/product/ubuntu/reachable"],
        ["state/host/server/reachable"]
    );
    assert!(
        !s.contains_key("state/host/workstation/reachable"),
        "a host that is no instance of a product gets no reachability"
    );
}

#[test]
fn an_os_exploit_is_not_drawn_until_the_host_says_how_long_using_it_takes() {
    let absent = shape(&generate(&with_os("")).unwrap());
    assert!(!absent.contains_key("action/host-deploy-exploit/server"));
    assert!(
        absent.contains_key("action/product-find-exploit/ubuntu"),
        "the product's step is drawn"
    );
    let g = generate(&with_os(DEPLOY_UNKNOWN)).unwrap();
    let s = shape(&g);
    assert_eq!(
        s["action/host-deploy-exploit/server"],
        [
            "state/host/server/reachable",
            "state/product/ubuntu/exploit-ready"
        ]
    );
    assert!(s["state/host/server/admin"].contains(&"action/host-deploy-exploit/server".to_owned()));
    let step = &g.nodes[index(&g, "action/host-deploy-exploit/server")];
    assert!(step.origins.iter().any(|o| o.rule == "host-deploy-exploit"
        && o.associations.iter().any(|a| a.as_str() == "server-os")));
}

#[test]
fn a_product_shared_by_host_and_service_is_found_once() {
    let mut m = with_os(DEPLOY_UNKNOWN);
    // sshd from the distribution: an instance of Ubuntu Linux too.
    m.associations
        .get_mut(&id::<AssociationId>("sshd-instance"))
        .unwrap()
        .relation = Relation::InstanceOf {
        from: id("sshd"),
        to: id("ubuntu"),
    };
    let s = shape(&generate(&m).unwrap());
    assert_eq!(
        s.keys()
            .filter(|k| k.starts_with("action/product-find-exploit/"))
            .count(),
        2,
        "openssh keeps its step, ubuntu has one"
    );
    for step in [
        "action/service-deploy-exploit/sshd",
        "action/host-deploy-exploit/server",
    ] {
        assert!(
            s[step].contains(&"state/product/ubuntu/exploit-ready".to_owned()),
            "{step}"
        );
    }
}

#[test]
fn an_application_is_reached_through_content_in_front_of_it() {
    let text = LECTURE
        .replacen(
            "\nassociations:\n",
            "  putty-product:\n    kind: product\n    label: putty\n    parameters:\n      find-exploit:\n        status: unknown\n      find-exploit-patched:\n        status: unknown\n    defenses: {patched: false}\n\nassociations:\n  putty-version:\n    kind: instance-of\n    from: ssh-client\n    to: putty-product\n  client-net-delivers:\n    kind: delivers\n    from: client-net\n    to: ssh-client\n",
            1,
        )
        .replacen(
            "  ssh-client:\n    kind: application\n    label: SSH client\n    parameters:\n",
            "  ssh-client:\n    kind: application\n    label: SSH client\n    parameters:\n      deploy-exploit:\n        status: unknown\n",
            1,
        );
    let s = shape(&generate(&architecture(&text)).unwrap());
    assert_eq!(
        s["state/application/ssh-client/reachable"],
        ["state/application/ssh-client/contacted"]
    );
    assert_eq!(
        s["action/application-deploy-exploit/ssh-client"],
        [
            "state/application/ssh-client/reachable",
            "state/product/putty-product/exploit-ready"
        ]
    );
}
