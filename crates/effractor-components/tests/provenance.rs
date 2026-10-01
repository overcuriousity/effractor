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

const LECTURE: &str = include_str!(
    "../../effractor-components/tests/fixtures/architectures/lecture-before-extract.yaml"
);
const UNKNOWN: &str = include_str!(
    "../../effractor-components/tests/fixtures/architectures/lecture-unknown-before-extract.yaml"
);

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

/// No switch value changes the graph. An optional switch the file leaves out
/// is not said at all — saying it (anti-malware) may draw what it guards —
/// so its three values are compared with each other.
fn assert_switch_values_keep_the_graph(model: &Architecture) {
    let set = |optional: bool, value: Switch| {
        let mut m = model.clone();
        for e in m.entities.values_mut() {
            let kind = e.kind;
            for &defense in kind.defenses() {
                // Said on in a file without a permission, a host firewall
                // leaves its flows unfinished (spec §4), as drawing a
                // firewall on a router does: the file's own property.
                if defense == Defense::HostFirewall {
                    continue;
                }
                if defense.optional(kind) == optional {
                    e.defenses.set(defense, Some(value));
                }
            }
        }
        shape(&generate(&m).unwrap())
    };
    let baseline = shape(&generate(model).unwrap());
    let said = set(true, Switch::Off);
    for value in [Switch::On, Switch::Off, Switch::Unknown] {
        assert_eq!(set(false, value), baseline, "{value:?}");
        assert_eq!(set(true, value), said, "optional {value:?}");
    }
}

#[test]
fn switches_never_change_the_graph() {
    let model = architecture(LECTURE);
    assert_switch_values_keep_the_graph(&model);
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
    assert_switch_values_keep_the_graph(&model);
    let baseline = shape(&generate(&model).unwrap());
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

/// The lecture with the server's ASLR and DEP said, and sshd's times for
/// using its exploit under each (extract Fig. 5.37).
fn hardened(aslr: &str, dep: &str) -> Architecture {
    let text = LECTURE
        .replacen(
            "  server:\n    kind: host\n    label: Server\n",
            &format!("  server:\n    kind: host\n    label: Server\n    defenses: {{aslr: {aslr}, dep: {dep}}}\n"),
            1,
        )
        .replacen(
            "  sshd:\n    kind: service\n    label: SSH server\n    parameters:\n",
            "  sshd:\n    kind: service\n    label: SSH server\n    parameters:\n      deploy-exploit-aslr:\n        status: illustrative\n        ttc: \"Exponential(mean 20)\"\n        note: exercise\n      deploy-exploit-dep:\n        status: illustrative\n        ttc: \"Exponential(mean 8)\"\n        note: exercise\n",
            1,
        );
    architecture(&text)
}

fn deploy_ttc(model: &Architecture) -> ResolvedTtc {
    let g = generate(model).unwrap();
    let r = resolve(model, &g, None).unwrap();
    r.ttc[index(&g, "action/service-deploy-exploit/sshd")].clone()
}

#[test]
fn aslr_and_dep_said_off_change_no_step_and_no_time() {
    let before = generate(&architecture(LECTURE)).unwrap();
    let after = generate(&hardened("false", "false")).unwrap();
    assert_eq!(shape(&before), shape(&after));
    assert_eq!(
        deploy_ttc(&hardened("false", "false")),
        deploy_ttc(&architecture(LECTURE))
    );
    assert_eq!(
        deploy_ttc(&architecture(LECTURE)),
        ResolvedTtc::Known(Distribution::ExponentialMean(2.0))
    );
}

#[test]
fn aslr_on_the_host_replaces_the_time_of_using_an_exploit_on_its_service() {
    assert_eq!(
        deploy_ttc(&hardened("true", "false")),
        ResolvedTtc::Known(Distribution::ExponentialMean(20.0))
    );
    assert_eq!(
        deploy_ttc(&hardened("false", "true")),
        ResolvedTtc::Known(Distribution::ExponentialMean(8.0))
    );
    // With both on, ASLR's time is read.
    assert_eq!(
        deploy_ttc(&hardened("true", "true")),
        ResolvedTtc::Known(Distribution::ExponentialMean(20.0))
    );
    match deploy_ttc(&hardened("unknown", "false")) {
        ResolvedTtc::Unknown(paths) => {
            assert_eq!(paths, ["entities.server.defenses.aslr"])
        }
        other => panic!("{other:?}"),
    }
    let g = generate(&hardened("true", "false")).unwrap();
    let step = &g.nodes[index(&g, "action/service-deploy-exploit/sshd")];
    let paths: Vec<&str> = step.origins[0].paths.iter().map(String::as_str).collect();
    assert!(
        paths.contains(&"entities.server.defenses.aslr"),
        "{paths:?}"
    );
}

#[test]
fn a_scenario_turning_aslr_on_changes_a_host_that_never_said_it() {
    // The server says nothing of ASLR; sshd has its time under it.
    let text = LECTURE
        .replacen(
            "  sshd:\n    kind: service\n    label: SSH server\n    parameters:\n",
            "  sshd:\n    kind: service\n    label: SSH server\n    parameters:\n      deploy-exploit-aslr:\n        status: illustrative\n        ttc: \"Exponential(mean 20)\"\n        note: exercise\n",
            1,
        )
        .replacen(
            "\nanalysis:\n",
            "  aslr:\n    label: ASLR on the server\n    changes:\n      - {entity: server, defense: aslr, value: true}\n\nanalysis:\n",
            1,
        );
    let model = architecture(&text);
    let g = generate(&model).unwrap();
    let i = index(&g, "action/service-deploy-exploit/sshd");
    let base = resolve(&model, &g, None).unwrap();
    assert_eq!(
        base.ttc[i],
        ResolvedTtc::Known(Distribution::ExponentialMean(2.0))
    );
    let on = resolve(&model, &g, Some(&id("aslr"))).unwrap();
    assert_eq!(
        on.ttc[i],
        ResolvedTtc::Known(Distribution::ExponentialMean(20.0))
    );
}

#[test]
fn an_unknown_dep_is_named_first_and_the_host_step_reads_aslr_too() {
    let m = hardened("false", "unknown");
    let g = generate(&m).unwrap();
    let r = resolve(&m, &g, None).unwrap();
    let i = index(&g, "action/service-deploy-exploit/sshd");
    assert_eq!(
        r.ttc[i],
        ResolvedTtc::Unknown(vec!["entities.server.defenses.dep".to_owned()])
    );
    assert_eq!(
        r.paths[i][0], "entities.server.defenses.dep",
        "the assumption list names the first path"
    );

    // The host's own step, with Ubuntu on it and ASLR on.
    let text = LECTURE
        .replacen(
            "\nassociations:\n",
            "  ubuntu:\n    kind: product\n    label: Ubuntu Linux\n    parameters:\n      find-exploit:\n        status: illustrative\n        ttc: \"Exponential(mean 20)\"\n        note: exercise\n      find-exploit-patched:\n        status: illustrative\n        ttc: \"Never\"\n        note: exercise\n    defenses: {patched: false}\n\nassociations:\n  server-os:\n    kind: instance-of\n    from: server\n    to: ubuntu\n",
            1,
        )
        .replacen(
            "  server:\n    kind: host\n    label: Server\n    parameters:\n",
            "  server:\n    kind: host\n    label: Server\n    defenses: {aslr: true}\n    parameters:\n      deploy-exploit:\n        status: illustrative\n        ttc: \"Exponential(mean 3)\"\n        note: exercise\n      deploy-exploit-aslr:\n        status: illustrative\n        ttc: \"Exponential(mean 30)\"\n        note: exercise\n",
            1,
        );
    let m = architecture(&text);
    let g = generate(&m).unwrap();
    let r = resolve(&m, &g, None).unwrap();
    let h = index(&g, "action/host-deploy-exploit/server");
    assert_eq!(
        r.ttc[h],
        ResolvedTtc::Known(Distribution::ExponentialMean(30.0))
    );
}

/// The lecture with an IDS a machine watches with (extract Fig. 5.18): its
/// switch said `enabled`, its bypass time Exponential(mean `bypass`).
fn with_ids(machine: &str, enabled: &str, bypass: &str) -> Architecture {
    let text = LECTURE
        .replacen(
            "\nassociations:\n",
            &format!("  sensor:\n    kind: ids\n    label: IDS\n    parameters:\n      bypass:\n        status: illustrative\n        ttc: \"Exponential(mean {bypass})\"\n        note: exercise\n    defenses: {{enabled: {enabled}}}\n\nassociations:\n  sensor-watch:\n    kind: watches\n    from: {machine}\n    to: sensor\n"),
            1,
        );
    architecture(&text)
}

fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn an_ids_on_the_route_is_got_past_before_the_exploit_is_used_fig_5_18() {
    let g = generate(&with_ids("bridge", "true", "2")).unwrap();
    let s = shape(&g);
    assert_eq!(
        s["action/service-deploy-exploit/sshd"],
        strings(&[
            "state/product/openssh/exploit-ready",
            "state/service/sshd/unseen"
        ])
    );
    assert_eq!(
        s["state/service/sshd/unseen"],
        strings(&["action/watched-flow/ssh"])
    );
    assert_eq!(
        s["action/watched-flow/ssh"],
        strings(&["state/flow/ssh/connected", "state/ids/sensor/passed"])
    );
    assert_eq!(
        s["state/ids/sensor/passed"],
        strings(&["action/sensor-bypass/sensor", "input/sensor-off/sensor"])
    );
    assert_eq!(
        s["action/sensor-bypass/sensor"],
        strings(&["state/ids/sensor/reached"])
    );
    assert_eq!(
        s["state/ids/sensor/reached"],
        strings(&["state/flow/ssh/connected"])
    );
    // A login over the same flow is not watched for.
    assert_eq!(
        s["action/service-login/server-account/sshd"],
        strings(&[
            "state/account/server-account/authenticated",
            "state/service/sshd/reachable"
        ])
    );
    let step = &g.nodes[index(&g, "action/watched-flow/ssh")];
    let o = &step.origins[0];
    assert_eq!(o.rule, "watched-flow");
    assert!(o.associations.iter().any(|a| a.as_str() == "sensor-watch"));
    assert!(o.entities.iter().any(|e| e.as_str() == "bridge"));
    let reached = &g.nodes[index(&g, "state/ids/sensor/reached")].origins[0];
    assert_eq!(reached.rule, "sensor-reached");
    assert_eq!(reached.flows[0].as_str(), "ssh");
}

#[test]
fn a_sensor_off_the_route_guards_nothing() {
    // The workstation runs no service: nothing reaches its sensor, and an
    // exploit on sshd never ends there.
    let lecture = shape(&generate(&architecture(LECTURE)).unwrap());
    let s = shape(&generate(&with_ids("workstation", "true", "2")).unwrap());
    assert_eq!(
        s["action/service-deploy-exploit/sshd"],
        lecture["action/service-deploy-exploit/sshd"]
    );
    assert!(!s.contains_key("state/service/sshd/unseen"));
    for (id, inputs) in &lecture {
        assert_eq!(&s[id], inputs, "{id}");
    }
}

#[test]
fn a_sensor_on_a_router_off_the_route_guards_nothing() {
    // A second router between the administration and server networks: no
    // flow is routed through it, so its IDS watches nothing.
    let text = LECTURE.replacen(
        "\nassociations:\n",
        "  r2:\n    kind: router\n    label: Second router\n    parameters:\n      escape:\n        status: unknown\n  sensor:\n    kind: ids\n    label: IDS\n    parameters:\n      bypass:\n        status: unknown\n    defenses: {enabled: true}\n\nassociations:\n  r2-admin:\n    kind: attached\n    from: r2\n    to: admin-net\n  r2-server:\n    kind: attached\n    from: r2\n    to: server-net\n  sensor-watch:\n    kind: watches\n    from: r2\n    to: sensor\n",
        1,
    );
    let lecture = shape(&generate(&architecture(LECTURE)).unwrap());
    let s = shape(&generate(&architecture(&text)).unwrap());
    assert!(
        s.keys().all(|k| !k.contains("/sensor/")),
        "no sensor step: {:?}",
        s.keys()
            .filter(|k| k.contains("sensor"))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        s["action/service-deploy-exploit/sshd"],
        lecture["action/service-deploy-exploit/sshd"]
    );
}

#[test]
fn a_sensor_on_the_server_guards_its_service() {
    let s = shape(&generate(&with_ids("server", "true", "2")).unwrap());
    assert_eq!(
        s["action/service-deploy-exploit/sshd"],
        strings(&[
            "state/ids/sensor/passed",
            "state/product/openssh/exploit-ready",
            "state/service/sshd/reachable"
        ])
    );
    assert_eq!(
        s["state/ids/sensor/reached"],
        strings(&["state/host/server/reachable"])
    );
    assert_eq!(
        s["state/host/server/reachable"],
        strings(&["state/service/sshd/reachable"])
    );
}

#[test]
fn a_sensor_resolves_on_its_switch() {
    let ttc = |enabled: &str| {
        let m = with_ids("bridge", enabled, "2");
        let g = generate(&m).unwrap();
        let r = resolve(&m, &g, None).unwrap();
        r.ttc[index(&g, "input/sensor-off/sensor")].clone()
    };
    assert_eq!(ttc("false"), ResolvedTtc::Known(Distribution::Zero));
    assert_eq!(ttc("true"), ResolvedTtc::Known(Distribution::Infinity));
    assert_eq!(
        ttc("unknown"),
        ResolvedTtc::Unknown(vec!["entities.sensor.defenses.enabled".to_owned()])
    );
}

/// The lecture with Ubuntu Linux on the server and its anti-malware said.
fn with_antimalware(switch: &str, bypass: &str) -> Architecture {
    let deploy = format!("{DEPLOY_UNKNOWN}{bypass}");
    let m = with_os(&deploy);
    let text = effractor_format::save_document(&Document::Architecture(m)).replacen(
        "  server:\n    kind: host\n    label: Server\n",
        &format!("  server:\n    kind: host\n    label: Server\n    defenses: {{anti-malware: {switch}}}\n"),
        1,
    );
    architecture(&text)
}

const BYPASS_AM: &str = "      bypass-antimalware:\n        status: illustrative\n        ttc: \"Exponential(mean 4)\"\n        note: exercise\n";

#[test]
fn anti_malware_on_the_server_guards_sshd_and_the_os() {
    let m = with_antimalware("true", BYPASS_AM);
    let s = shape(&generate(&m).unwrap());
    for step in [
        "action/service-deploy-exploit/sshd",
        "action/host-deploy-exploit/server",
    ] {
        assert!(
            s[step].contains(&"state/host/server/malware-cleared".to_owned()),
            "{step}: {:?}",
            s[step]
        );
    }
    assert_eq!(
        s["state/host/server/malware-cleared"],
        strings(&[
            "action/antimalware-bypass/server",
            "input/antimalware-off/server"
        ])
    );
    assert_eq!(
        s["action/antimalware-bypass/server"],
        strings(&["state/host/server/reachable"])
    );
}

#[test]
fn an_unknown_switch_with_nothing_to_guard_costs_nothing() {
    let text = LECTURE.replacen(
        "  workstation:\n    kind: host\n    label: Workstation\n",
        "  workstation:\n    kind: host\n    label: Workstation\n    defenses: {anti-malware: unknown}\n",
        1,
    );
    let lecture = shape(&generate(&architecture(LECTURE)).unwrap());
    assert_eq!(shape(&generate(&architecture(&text)).unwrap()), lecture);
}

#[test]
fn anti_malware_on_without_a_time_withholds_and_names_the_slot() {
    let m = with_antimalware("true", "");
    let g = generate(&m).unwrap();
    let r = resolve(&m, &g, None).unwrap();
    assert_eq!(
        r.ttc[index(&g, "action/antimalware-bypass/server")],
        ResolvedTtc::Unknown(vec![
            "entities.server.parameters.bypass-antimalware".to_owned()
        ])
    );
}

#[test]
fn a_scenario_turning_anti_malware_on_guards_a_host_that_never_said_it() {
    let m = with_os(&format!("{DEPLOY_UNKNOWN}{BYPASS_AM}"));
    let text = effractor_format::save_document(&Document::Architecture(m)).replacen(
        "\nanalysis:\n",
        "  am:\n    label: Anti-malware on the server\n    changes:\n      - {entity: server, defense: anti-malware, value: true}\n\nanalysis:\n",
        1,
    );
    let m = architecture(&text);
    let g = generate(&m).unwrap();
    let off = index(&g, "input/antimalware-off/server");
    assert_eq!(
        resolve(&m, &g, None).unwrap().ttc[off],
        ResolvedTtc::Known(Distribution::Zero),
        "absent is off"
    );
    assert_eq!(
        resolve(&m, &g, Some(&id("am"))).unwrap().ttc[off],
        ResolvedTtc::Known(Distribution::Infinity)
    );
}

#[test]
fn an_ids_on_the_route_guards_the_exploit_against_the_host_too() {
    // Fig. 5.18 with Ubuntu Linux on the server: the OS exploit travels the
    // same watched flow as the one against sshd.
    let m = with_os(DEPLOY_UNKNOWN);
    let text = effractor_format::save_document(&Document::Architecture(m)).replacen(
        "\nassociations:\n",
        "  sensor:\n    kind: ids\n    label: IDS\n    parameters:\n      bypass:\n        status: unknown\n    defenses: {enabled: true}\n\nassociations:\n  sensor-watch:\n    kind: watches\n    from: bridge\n    to: sensor\n",
        1,
    );
    let s = shape(&generate(&architecture(&text)).unwrap());
    assert_eq!(
        s["action/host-deploy-exploit/server"],
        strings(&[
            "state/host/server/unseen",
            "state/product/ubuntu/exploit-ready"
        ])
    );
    assert_eq!(
        s["state/host/server/unseen"],
        strings(&["state/service/sshd/unseen"])
    );
    // The host stays reachable as before: what finds its exploit is not watched.
    assert_eq!(
        s["state/product/ubuntu/reachable"],
        strings(&["state/host/server/reachable"])
    );
}

/// The lecture with the server's escalation time given (extract Fig. 5.33).
fn with_escalation(hardened: &str) -> Architecture {
    let text = LECTURE.replacen(
        "  server:\n    kind: host\n    label: Server\n    parameters:\n",
        &format!("  server:\n    kind: host\n    label: Server\n{hardened}    parameters:\n      escalate:\n        status: illustrative\n        ttc: \"Exponential(mean 3)\"\n        note: exercise\n      escalate-hardened:\n        status: illustrative\n        ttc: \"Exponential(mean 30)\"\n        note: exercise\n"),
        1,
    );
    architecture(&text)
}

#[test]
fn escalation_is_absent_until_a_host_says_how_long_it_takes_fig_5_33() {
    let s = shape(&generate(&architecture(LECTURE)).unwrap());
    assert!(!s.contains_key("action/escalate/server"));
    let s = shape(&generate(&with_escalation("")).unwrap());
    assert_eq!(
        s["action/escalate/server"],
        strings(&["state/host/server/user"])
    );
    assert!(s["state/host/server/admin"].contains(&"action/escalate/server".to_owned()));
}

#[test]
fn escalation_is_drawn_and_hardened_replaces_its_time() {
    let ttc = |m: &Architecture| {
        let g = generate(m).unwrap();
        resolve(m, &g, None).unwrap().ttc[index(&g, "action/escalate/server")].clone()
    };
    assert_eq!(
        ttc(&with_escalation("")),
        ResolvedTtc::Known(Distribution::ExponentialMean(3.0)),
        "absent is not hardened"
    );
    assert_eq!(
        ttc(&with_escalation("    defenses: {hardened: true}\n")),
        ResolvedTtc::Known(Distribution::ExponentialMean(30.0))
    );
    assert_eq!(
        ttc(&with_escalation("    defenses: {hardened: unknown}\n")),
        ResolvedTtc::Unknown(vec!["entities.server.defenses.hardened".to_owned()])
    );
}

fn edited(text: &str, pairs: &[(&str, &str)]) -> Architecture {
    let mut t = text.to_owned();
    for (from, to) in pairs {
        assert_eq!(t.matches(from).count(), 1, "{from}");
        t = t.replacen(from, to, 1);
    }
    architecture(&t)
}

const SERVER: &str = "  server:\n    kind: host\n    label: Server\n    parameters:\n";
const FOOTHOLDS: &str = "  footholds:\n    - {entity: workstation, state: admin}\n";

#[test]
fn physical_access_is_drawn_only_once_a_host_says_how_long_it_takes_fig_5_33() {
    let s = shape(&generate(&architecture(LECTURE)).unwrap());
    assert!(!s.contains_key("action/physical-access/server"));
    assert!(
        !s.contains_key("state/host/server/physical"),
        "an optional state is not drawn for nothing"
    );
    let m = edited(
        LECTURE,
        &[(
            SERVER,
            &format!("{SERVER}      physical:\n        status: unknown\n"),
        )],
    );
    let g = generate(&m).unwrap();
    let s = shape(&g);
    assert_eq!(
        s["action/physical-access/server"],
        strings(&["state/host/server/physical"])
    );
    assert!(
        s["state/host/server/physical"].is_empty(),
        "nothing but a foothold"
    );
    assert!(s["state/host/server/admin"].contains(&"action/physical-access/server".to_owned()));
    let r = resolve(&m, &g, None).unwrap();
    assert_eq!(
        r.ttc[index(&g, "action/physical-access/server")],
        ResolvedTtc::Unknown(vec!["entities.server.parameters.physical".to_owned()])
    );
}

#[test]
fn a_usb_foothold_reaches_user_through_its_step() {
    let m = edited(
        LECTURE,
        &[
            (
                SERVER,
                &format!(
                    "{SERVER}      usb:\n        status: illustrative\n        ttc: \"Exponential(mean 1)\"\n        note: exercise\n"
                ),
            ),
            (
                FOOTHOLDS,
                &format!("{FOOTHOLDS}    - {{entity: server, state: usb}}\n"),
            ),
        ],
    );
    let s = shape(&generate(&m).unwrap());
    assert_eq!(
        s["state/host/server/usb"],
        strings(&["input/foothold/server/usb"])
    );
    assert!(s["state/host/server/user"].contains(&"action/usb-access/server".to_owned()));
}

#[test]
fn denial_of_service_is_drawn_once_deny_is_given_and_rests_on_reach_fig_5_34() {
    const SSHD: &str = "  sshd:\n    kind: service\n    label: SSH server\n    parameters:\n";
    let m = edited(
        LECTURE,
        &[
            (
                SSHD,
                &format!("{SSHD}      deny:\n        status: unknown\n"),
            ),
            (
                "  target: {entity: server, state: admin}\n",
                "  target: {entity: sshd, state: unavailable}\n",
            ),
        ],
    );
    let s = shape(&generate(&m).unwrap());
    assert_eq!(
        s["action/deny-service/sshd"],
        strings(&["state/service/sshd/reachable"])
    );
    assert_eq!(
        s["state/service/sshd/unavailable"],
        strings(&["action/deny-service/sshd"])
    );
    assert!(!s.contains_key("state/host/server/unavailable"));
}

#[test]
fn a_host_that_runs_nothing_cannot_be_denied() {
    const WS: &str = "  workstation:\n    kind: host\n    label: Workstation\n    parameters:\n";
    let m = edited(
        LECTURE,
        &[
            (WS, &format!("{WS}      deny:\n        status: unknown\n")),
            (
                "  target: {entity: server, state: admin}\n",
                "  target: {entity: workstation, state: unavailable}\n",
            ),
        ],
    );
    let s = shape(&generate(&m).unwrap());
    assert!(!s.contains_key("action/deny-service/workstation"));
    assert!(s["state/host/workstation/unavailable"].is_empty());
}

#[test]
fn a_held_account_gives_what_logs_it_in_fig_5_33() {
    let m = edited(
        LECTURE,
        &[(
            FOOTHOLDS,
            "  footholds:\n    - {entity: server-account, state: held}\n",
        )],
    );
    let s = shape(&generate(&m).unwrap());
    assert_eq!(
        s["state/account/server-account/held"],
        strings(&["input/foothold/server-account/held"])
    );
    assert!(
        s["state/account/server-account/material"]
            .contains(&"state/account/server-account/held".to_owned())
    );
    let lecture = shape(&generate(&architecture(LECTURE)).unwrap());
    assert!(!lecture.contains_key("state/account/server-account/held"));
}

fn host_firewall(switch: &str) -> Architecture {
    edited(
        LECTURE,
        &[
            (
                "  server:\n    kind: host\n    label: Server\n",
                &format!(
                    "  server:\n    kind: host\n    label: Server\n    defenses: {{host-firewall: {switch}}}\n"
                ),
            ),
            (
                "\nflows:\n",
                "  server-allows-ssh:\n    kind: permits\n    from: server\n    to: ssh\n    allowed: true\n\nflows:\n",
            ),
        ],
    )
}

#[test]
fn a_host_firewall_lets_a_flow_in_only_with_its_permission_fig_5_37() {
    let m = host_firewall("true");
    let g = generate(&m).unwrap();
    let s = shape(&g);
    assert!(s["action/flow-connect/ssh"].contains(&"state/permission/server/ssh".to_owned()));
    assert_eq!(
        s["state/permission/server/ssh"],
        strings(&[
            "input/flow-permission/server/ssh",
            "input/host-firewall-off/server"
        ])
    );
    let r = resolve(&m, &g, None).unwrap();
    assert_eq!(
        r.ttc[index(&g, "input/host-firewall-off/server")],
        ResolvedTtc::Known(Distribution::Infinity)
    );
    let off = host_firewall("false");
    let g = generate(&off).unwrap();
    assert_eq!(
        resolve(&off, &g, None).unwrap().ttc[index(&g, "input/host-firewall-off/server")],
        ResolvedTtc::Known(Distribution::Zero),
        "off: the flow passes whatever the permission says"
    );
}

#[test]
fn a_host_firewall_said_on_without_a_permission_leaves_the_flow_unfinished() {
    // Spec §4: as at a router's firewall — unfinished, not denied.
    for switch in ["true", "unknown"] {
        let m = edited(
            LECTURE,
            &[(
                "  server:\n    kind: host\n    label: Server\n",
                &format!(
                    "  server:\n    kind: host\n    label: Server\n    defenses: {{host-firewall: {switch}}}\n"
                ),
            )],
        );
        let g = generate(&m).unwrap();
        let s = shape(&g);
        assert!(
            !s["action/flow-connect/ssh"].contains(&"state/permission/server/ssh".to_owned()),
            "{switch}"
        );
        match &resolve(&m, &g, None).unwrap().ttc[index(&g, "action/flow-connect/ssh")] {
            ResolvedTtc::Unknown(paths) => {
                assert!(paths.iter().any(|p| p == "flows.ssh.route"), "{paths:?}")
            }
            other => panic!("{switch}: {other:?}"),
        }
    }
}

const CLIENT_NET: &str = "  client-net:\n    kind: network\n    label: Client network\n";
const SSH_PROTOCOL: &str = "    protocol: tcp/22\n";
const WORKSTATION: &str = "  workstation:\n    kind: host\n    label: Workstation\n";

/// The lecture with the client network's ARP caches poisonable and the SSH
/// flow saying `flow_fields` after its protocol (extract Fig. 5.33).
fn poisonable(flow_fields: &str, more: &[(&str, &str)]) -> Architecture {
    let mut pairs = vec![
        (
            CLIENT_NET.to_owned(),
            format!(
                "{CLIENT_NET}    parameters:\n      poison:\n        status: illustrative\n        ttc: \"Exponential(mean 1)\"\n"
            ),
        ),
        (
            SSH_PROTOCOL.to_owned(),
            format!("{SSH_PROTOCOL}{flow_fields}"),
        ),
    ];
    pairs.extend(more.iter().map(|(a, b)| (a.to_string(), b.to_string())));
    let pairs: Vec<(&str, &str)> = pairs
        .iter()
        .map(|(a, b)| (a.as_str(), b.as_str()))
        .collect();
    edited(LECTURE, &pairs)
}

#[test]
fn arp_poisoning_takes_a_carried_credential_off_a_plain_flow_fig_5_33() {
    let lecture = shape(&generate(&architecture(LECTURE)).unwrap());
    assert!(
        !lecture
            .keys()
            .any(|k| k.contains("arp-poison") || k.contains("intercept")),
        "nothing drawn for a file that says none of it"
    );
    let m = poisonable("    carries: [server-key]\n", &[]);
    let g = generate(&m).unwrap();
    let s = shape(&g);
    assert_eq!(
        s["action/arp-poison/client-net"],
        strings(&["state/network/client-net/access"])
    );
    assert_eq!(
        s["state/network/client-net/poisoned"],
        strings(&["action/arp-poison/client-net"])
    );
    assert_eq!(
        s["state/flow/ssh/overheard"],
        strings(&["state/network/client-net/poisoned"])
    );
    assert_eq!(
        s["action/flow-intercept/ssh"],
        strings(&["state/flow/ssh/overheard"]),
        "neither end says static ARP tables: nothing closes it"
    );
    assert_eq!(
        s["state/flow/ssh/intercepted"],
        strings(&["action/flow-intercept/ssh"])
    );
    assert!(
        s["state/credential/server-key/possessed"]
            .contains(&"state/flow/ssh/intercepted".to_owned())
    );
    let node = &g.nodes[index(&g, "action/arp-poison/client-net")];
    assert_eq!(node.origins[0].rule, "arp-poison");
    assert_eq!(
        node.origins[0].paths,
        ["entities.client-net.parameters.poison"]
    );
    let taken = &g.nodes[index(&g, "state/credential/server-key/possessed")];
    assert!(
        taken
            .origins
            .iter()
            .any(|o| o.rule == "intercepted-credential"
                && o.flows.iter().any(|f| f.as_str() == "ssh")
                && o.paths == ["flows.ssh.carries[0]"])
    );
    // A network that does not say how long poisoning takes draws nothing.
    let unsaid = edited(
        LECTURE,
        &[(
            SSH_PROTOCOL,
            "    protocol: tcp/22\n    carries: [server-key]\n",
        )],
    );
    let s = shape(&generate(&unsaid).unwrap());
    assert!(
        !s.keys()
            .any(|k| k.contains("arp-poison") || k.contains("intercept"))
    );
}

#[test]
fn a_flow_that_carries_nothing_is_not_intercepted() {
    let s = shape(&generate(&poisonable("", &[])).unwrap());
    assert!(s.contains_key("action/arp-poison/client-net"));
    assert!(
        !s.keys()
            .any(|k| k.contains("/ssh/") && k.contains("intercept"))
    );
    assert!(!s.contains_key("state/flow/ssh/overheard"));
}

#[test]
fn an_encrypted_flow_gives_nothing_away_fig_5_33() {
    let s = shape(
        &generate(&poisonable(
            "    encrypted: true\n    carries: [server-key]\n",
            &[],
        ))
        .unwrap(),
    );
    assert!(!s.contains_key("action/flow-intercept/ssh"));
    assert!(
        !s["state/credential/server-key/possessed"]
            .contains(&"state/flow/ssh/intercepted".to_owned())
    );
}

#[test]
fn a_carried_credential_that_logs_in_nowhere_the_flow_ends_is_not_taken() {
    let s = shape(&generate(&poisonable("    carries: [admin-key]\n", &[])).unwrap());
    assert!(
        !s["state/credential/admin-key/possessed"]
            .contains(&"state/flow/ssh/intercepted".to_owned())
    );
}

#[test]
fn static_arp_on_both_ends_closes_interception_and_on_one_does_not_fig_5_37() {
    let with = |server: &str, workstation: &str| {
        poisonable(
            "    carries: [server-key]\n",
            &[
                (
                    "  server:\n    kind: host\n    label: Server\n",
                    &format!(
                        "  server:\n    kind: host\n    label: Server\n    defenses: {{static-arp: {server}}}\n"
                    ),
                ),
                (
                    WORKSTATION,
                    &format!("{WORKSTATION}    defenses: {{static-arp: {workstation}}}\n"),
                ),
            ],
        )
    };
    let both = with("true", "true");
    let g = generate(&both).unwrap();
    let s = shape(&g);
    assert_eq!(
        s["state/flow/ssh/exposed"],
        strings(&[
            "input/static-arp-off/server",
            "input/static-arp-off/workstation"
        ])
    );
    assert_eq!(
        s["action/flow-intercept/ssh"],
        strings(&["state/flow/ssh/exposed", "state/flow/ssh/overheard"])
    );
    let r = resolve(&both, &g, None).unwrap();
    for host in ["server", "workstation"] {
        assert_eq!(
            r.ttc[index(&g, &format!("input/static-arp-off/{host}"))],
            ResolvedTtc::Known(Distribution::Infinity),
            "{host}: on"
        );
    }
    let one = with("true", "false");
    let g = generate(&one).unwrap();
    let r = resolve(&one, &g, None).unwrap();
    assert_eq!(
        r.ttc[index(&g, "input/static-arp-off/workstation")],
        ResolvedTtc::Known(Distribution::Zero),
        "one end without static tables leaves the flow exposed"
    );
    // Said on one end only, the other end's absence reads as off.
    let only = poisonable(
        "    carries: [server-key]\n",
        &[(
            "  server:\n    kind: host\n    label: Server\n",
            "  server:\n    kind: host\n    label: Server\n    defenses: {static-arp: true}\n",
        )],
    );
    let g = generate(&only).unwrap();
    let r = resolve(&only, &g, None).unwrap();
    assert_eq!(
        r.ttc[index(&g, "input/static-arp-off/workstation")],
        ResolvedTtc::Known(Distribution::Zero)
    );
}

#[test]
fn a_scenario_may_keep_static_arp_tables_where_the_file_says_none() {
    let m = poisonable(
        "    carries: [server-key]\n",
        &[(
            "scenarios:\n",
            "scenarios:\n  static:\n    label: Static ARP tables everywhere\n    changes:\n      - {entity: server, defense: static-arp, value: true}\n      - {entity: workstation, defense: static-arp, value: true}\n",
        )],
    );
    let g = generate(&m).unwrap();
    assert!(shape(&g)["action/flow-intercept/ssh"].contains(&"state/flow/ssh/exposed".to_owned()));
    let as_written = resolve(&m, &g, None).unwrap();
    assert_eq!(
        as_written.ttc[index(&g, "input/static-arp-off/server")],
        ResolvedTtc::Known(Distribution::Zero)
    );
    let scenario: ScenarioId = id("static");
    let switched = resolve(&m, &g, Some(&scenario)).unwrap();
    assert_eq!(
        switched.ttc[index(&g, "input/static-arp-off/server")],
        ResolvedTtc::Known(Distribution::Infinity)
    );
}

/// The lecture with Ubuntu Linux on the server, the server's switches
/// `defenses` and only the host times `times` given (a deferred minor).
fn host_os(defenses: &str, times: &[&str]) -> Architecture {
    let mut parameters = String::new();
    for t in times {
        parameters.push_str(&format!(
            "      {t}:\n        status: illustrative\n        ttc: \"Exponential(mean 30)\"\n        note: exercise\n"
        ));
    }
    edited(
        LECTURE,
        &[
            (
                "\nassociations:\n",
                "  ubuntu:\n    kind: product\n    label: Ubuntu Linux\n    parameters:\n      find-exploit:\n        status: illustrative\n        ttc: \"Exponential(mean 20)\"\n        note: exercise\n      find-exploit-patched:\n        status: illustrative\n        ttc: \"Never\"\n        note: exercise\n    defenses: {patched: false}\n\nassociations:\n  server-os:\n    kind: instance-of\n    from: server\n    to: ubuntu\n",
            ),
            (
                SERVER,
                &format!(
                    "  server:\n    kind: host\n    label: Server\n    defenses: {{{defenses}}}\n    parameters:\n{parameters}"
                ),
            ),
        ],
    )
}

#[test]
fn a_host_step_is_drawn_from_the_one_replacement_time_that_applies() {
    // ASLR on and only its time given: drawn, with that time.
    let m = host_os("aslr: true", &["deploy-exploit-aslr"]);
    let g = generate(&m).unwrap();
    let r = resolve(&m, &g, None).unwrap();
    assert_eq!(
        r.ttc[index(&g, "action/host-deploy-exploit/server")],
        ResolvedTtc::Known(Distribution::ExponentialMean(30.0))
    );
    // DEP on and only its time given: drawn too.
    let m = host_os("dep: true", &["deploy-exploit-dep"]);
    let g = generate(&m).unwrap();
    let r = resolve(&m, &g, None).unwrap();
    assert_eq!(
        r.ttc[index(&g, "action/host-deploy-exploit/server")],
        ResolvedTtc::Known(Distribution::ExponentialMean(30.0))
    );
    // A replacement time whose switch is never said, or said off with no
    // scenario turning it on, cannot apply: not drawn.
    for defenses in ["hardened: false", "aslr: false"] {
        let m = host_os(defenses, &["deploy-exploit-aslr"]);
        let s = shape(&generate(&m).unwrap());
        assert!(
            !s.contains_key("action/host-deploy-exploit/server"),
            "{defenses}"
        );
    }
}
