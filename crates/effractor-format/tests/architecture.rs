//! Architecture documents: schema 2, `profile: architecture`, strict typed
//! entities, associations, flows, attacker and scenarios, next to the trees.

use effractor_core::{Document, Severity};
use effractor_format::{canonicalize, document, from_document, load_document};

const EMPTY: &str = include_str!("fixtures/migrations/v2/empty-architecture.yaml");
const CANONICAL: &str = include_str!("fixtures/canonical/empty-architecture.yaml");

#[test]
fn an_empty_architecture_loads_and_canonicalizes() {
    assert!(matches!(
        load_document(EMPTY).unwrap(),
        Document::Architecture(_)
    ));
    let canonical = canonicalize(EMPTY).unwrap();
    assert_eq!(canonical, CANONICAL);
    assert_eq!(canonicalize(&canonical).unwrap(), canonical);
    let (image, diagnostics) = document(&canonical);
    assert!(!diagnostics.iter().any(|d| d.severity == Severity::Error));
    assert_eq!(from_document(&image.unwrap()).unwrap(), canonical);
}

#[test]
fn version_one_trees_migrate_by_version_alone_and_cannot_hold_an_architecture() {
    let old = include_str!("fixtures/migrations/v1/webserver.yaml");
    let migrated = canonicalize(old).unwrap();
    assert!(migrated.starts_with("effractor: 2\n"), "{migrated}");
    assert_eq!(
        effractor_format::load(old).unwrap(),
        effractor_format::load(&migrated).unwrap()
    );
    // The image is of the migrated document: it says 2 whatever the text said.
    assert_eq!(document(old).0.unwrap()["effractor"], serde_json::json!(2));

    // Version 1 has no architecture profile and no architecture keys.
    let architecture_v1 = EMPTY.replacen("effractor: 2", "effractor: 1", 1);
    let errors = load_document(&architecture_v1).unwrap_err();
    assert_eq!(errors[0].code, effractor_core::Code::Version);
    assert_eq!(errors[0].path, "profile");
    assert_eq!(errors[0].pos.map(|p| p.line), Some(2));
    let tree_with_entities = format!("{old}entities: {{}}\n");
    let errors = load_document(&tree_with_entities).unwrap_err();
    assert_eq!(errors[0].code, effractor_core::Code::Version);
    assert_eq!(errors[0].path, "entities");
    let tree_with_clusters = format!("{old}clusters: {{}}\n");
    let errors = load_document(&tree_with_clusters).unwrap_err();
    assert_eq!(errors[0].code, effractor_core::Code::Version);
    assert_eq!(errors[0].path, "clusters");

    // The tree-only readers say what an architecture is, not that it is wrong.
    let errors = effractor_format::load(EMPTY).unwrap_err();
    assert_eq!(errors[0].code, effractor_core::Code::Unsupported);
    assert_eq!(errors[0].path, "profile");
    assert_eq!(errors[0].pos.map(|p| p.line), Some(2));
    // Even when the architecture has errors of its own, that comes first.
    let broken = EMPTY.replacen("version: 1", "version: 9", 1);
    let errors = effractor_format::load(&broken).unwrap_err();
    assert_eq!(errors[0].code, effractor_core::Code::Unsupported);
    assert_eq!(errors[1].code, effractor_core::Code::UnknownLibrary);

    // The first `profile` is the one that counts, to the tree-only readers
    // too: a second is a duplicate, not an architecture.
    let webserver = include_str!("fixtures/canonical/webserver.yaml");
    let twice = webserver.replacen(
        "profile: fault-tree\n",
        "profile: fault-tree\nprofile: architecture\n",
        1,
    );
    let errors = effractor_format::load(&twice).unwrap_err();
    assert_eq!(
        errors[0].code,
        effractor_core::Code::DuplicateKey,
        "{errors:?}"
    );
    assert!(
        errors
            .iter()
            .all(|d| d.code != effractor_core::Code::Unsupported),
        "{errors:?}"
    );

    // A version this build does not know is refused, whatever the profile.
    let future = EMPTY.replacen("effractor: 2", "effractor: 3", 1);
    assert_eq!(
        load_document(&future).unwrap_err()[0].code,
        effractor_core::Code::Version
    );
}

const LECTURE: &str = include_str!("fixtures/canonical/lecture-architecture.yaml");

fn image(text: &str) -> serde_json::Value {
    let (image, diagnostics) = document(text);
    image.unwrap_or_else(|| panic!("{diagnostics:?}"))
}

/// `(code, path)` of every error in an edited image.
fn errors_of(image: &serde_json::Value) -> Vec<(&'static str, String)> {
    from_document(image)
        .unwrap_err()
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .map(|d| (d.code.as_str(), d.path.clone()))
        .collect()
}

fn has(errors: &[(&'static str, String)], code: &str, path: &str) -> bool {
    errors.iter().any(|(c, p)| *c == code && p == path)
}

#[test]
fn the_reference_architecture_is_canonical_and_complete() {
    assert_eq!(canonicalize(LECTURE).unwrap(), LECTURE);
    let (doc, diagnostics) = effractor_format::diagnose_document(LECTURE);
    assert_eq!(
        diagnostics,
        vec![],
        "a complete architecture has nothing to say"
    );
    let Document::Architecture(a) = doc.unwrap() else {
        panic!("an architecture")
    };
    assert_eq!(a.entities.len(), 14);
    assert_eq!(a.associations.len(), 17);
    assert_eq!(a.flows.len(), 1);
    assert_eq!(a.scenarios.len(), 4);
    // Authored order survives.
    assert_eq!(a.entities.keys().nth(3).unwrap().as_str(), "bridge");
    assert_eq!(
        a.attacker.target.as_ref().unwrap().entity.as_str(),
        "server"
    );
    assert_eq!(
        effractor_format::save_document(&Document::Architecture(a)),
        LECTURE
    );
}

#[test]
fn partial_authoring_saves_with_unknowns_and_incomplete_warnings() {
    let mut image = image(EMPTY);
    image["entities"]["sshd"] = serde_json::json!({"kind": "service", "label": "SSH"});
    image["entities"]["openssh"] = serde_json::json!({"kind": "product", "label": "OpenSSH"});
    let text = from_document(&image).unwrap();
    assert!(
        text.contains("      find-exploit:\n        status: unknown\n"),
        "{text}"
    );
    assert!(
        text.contains("    defenses: {patched: unknown}\n"),
        "{text}"
    );
    // Saveable, and read back with `incomplete` warnings, not errors.
    let (doc, diagnostics) = effractor_format::diagnose_document(&text);
    assert!(matches!(doc, Some(Document::Architecture(_))));
    let incomplete: Vec<&str> = diagnostics
        .iter()
        .filter(|d| d.code == effractor_core::Code::Incomplete)
        .map(|d| d.path.as_str())
        .collect();
    assert_eq!(
        incomplete,
        // No host and no product yet: both are said.
        vec![
            "entities.sshd",
            "entities.sshd",
            "attacker.target",
            "attacker.footholds"
        ]
    );
    assert!(diagnostics.iter().all(|d| d.severity == Severity::Warning));
    assert!(diagnostics.iter().all(|d| d.pos.is_some()));

    image["associations"]["bad"] = serde_json::json!({
        "kind": "hosts", "from": "absent", "to": "sshd", "privilege": "admin"
    });
    let errors = errors_of(&image);
    assert!(
        has(&errors, "unknown-reference", "associations.bad.from"),
        "{errors:?}"
    );
}

#[test]
fn ids_need_a_letter_but_tree_nodes_do_not() {
    let mut image = image(EMPTY);
    image["entities"]["constructor"] = serde_json::json!({"kind": "network", "label": "Proto"});
    let text = from_document(&image).unwrap();
    assert!(text.contains("  constructor:\n"), "{text}");
    image["entities"]["123"] = serde_json::json!({"kind": "network", "label": "Digits"});
    assert!(has(&errors_of(&image), "invalid-id", "entities.123"));
    let tree = "effractor: 2\nprofile: fault-tree\nname: T\ntop: 123\nnodes:\n  123: {label: T, leaf: basic}\n";
    assert!(effractor_format::load(tree).is_ok());
}

#[test]
fn endpoint_kinds_are_checked_for_every_association() {
    let (right, wrong): (Vec<_>, Vec<_>) = [
        ("attached", "workstation", "client-net", "sshd", "server"),
        ("hosts", "server", "sshd", "client-net", "server-account"),
        ("filters", "bridge", "bridge-fw", "workstation", "sshd"),
        (
            "stores",
            "workstation",
            "server-credential",
            "sshd",
            "server-account",
        ),
        (
            "authenticates",
            "server-credential",
            "server-account",
            "server-account",
            "server-credential",
        ),
        (
            "authorizes",
            "server-account",
            "sshd",
            "sshd",
            "server-account",
        ),
        (
            "grants",
            "server-account",
            "server",
            "server",
            "server-account",
        ),
        (
            "administration",
            "admin-net",
            "server",
            "server",
            "admin-net",
        ),
    ]
    .into_iter()
    .map(|(kind, from, to, bad_from, bad_to)| {
        let extra = match kind {
            "hosts" | "stores" | "grants" => serde_json::json!("user"),
            _ => serde_json::Value::Null,
        };
        let record = |from: &str, to: &str| {
            let mut r = serde_json::json!({"kind": kind, "from": from, "to": to});
            if !extra.is_null() {
                r["privilege"] = extra.clone();
            }
            r
        };
        (
            record(from, to),
            (record(bad_from, to), record(from, bad_to)),
        )
    })
    .unzip();
    // Every kind accepts its own ends…
    let mut image = image(LECTURE);
    image["scenarios"] = serde_json::json!({});
    image["associations"] = serde_json::json!({});
    for (i, r) in right.iter().enumerate() {
        image["associations"][format!("ok-{i}")] = r.clone();
    }
    // …with what the one flow needs to be routable.
    for (i, (from, to)) in [
        ("server", "server-net"),
        ("bridge", "client-net"),
        ("bridge", "server-net"),
    ]
    .into_iter()
    .enumerate()
    {
        image["associations"][format!("net-{i}")] =
            serde_json::json!({"kind": "attached", "from": from, "to": to});
    }
    image["associations"]["ok-permits"] = serde_json::json!({"kind": "permits", "from": "bridge-fw", "to": "ssh", "allowed": "unknown"});
    let text = from_document(&image).unwrap_or_else(|d| panic!("{d:?}"));
    assert!(
        text.contains("  ok-permits:\n    kind: permits\n"),
        "{text}"
    );
    // …and rejects the wrong kind at either end, naming the end.
    for (i, (bad_from, bad_to)) in wrong.iter().enumerate() {
        let mut image = image.clone();
        image["associations"][format!("bad-{i}")] = bad_from.clone();
        assert!(
            has(
                &errors_of(&image),
                "association-type",
                &format!("associations.bad-{i}.from")
            ),
            "{i}"
        );
        let mut image = image.clone();
        image["associations"][format!("bad-{i}")] = bad_to.clone();
        assert!(
            has(
                &errors_of(&image),
                "association-type",
                &format!("associations.bad-{i}.to")
            ),
            "{i}"
        );
    }
    let mut image = image.clone();
    image["associations"]["bad-permits"] =
        serde_json::json!({"kind": "permits", "from": "bridge", "to": "ssh", "allowed": true});
    assert!(has(
        &errors_of(&image),
        "association-type",
        "associations.bad-permits.from"
    ));
    image["associations"]["bad-permits"] =
        serde_json::json!({"kind": "permits", "from": "bridge-fw", "to": "sshd", "allowed": true});
    assert!(has(
        &errors_of(&image),
        "unknown-reference",
        "associations.bad-permits.to"
    ));
}

#[test]
fn extra_fields_privileges_and_duplicates() {
    // The field a kind does not have, and the one it needs.
    let mut image = image(LECTURE);
    image["associations"]["bridge-filters"]["privilege"] = serde_json::json!("admin");
    assert!(has(
        &errors_of(&image),
        "misplaced-key",
        "associations.bridge-filters.privilege"
    ));
    let mut image = self::image(LECTURE);
    image["associations"]["server-runs-sshd"]
        .as_object_mut()
        .unwrap()
        .remove("privilege");
    assert!(has(
        &errors_of(&image),
        "missing-key",
        "associations.server-runs-sshd.privilege"
    ));
    // A router is granted admin only; an application stores as user only.
    let mut image = self::image(LECTURE);
    image["associations"]["router-user"] = serde_json::json!({"kind": "grants", "from": "admin-account", "to": "bridge", "privilege": "user"});
    assert!(has(
        &errors_of(&image),
        "association-type",
        "associations.router-user.privilege"
    ));
    let mut image = self::image(LECTURE);
    image["associations"]["router-runs-user"] = serde_json::json!({"kind": "hosts", "from": "bridge", "to": "ssh-client", "privilege": "user"});
    assert!(has(
        &errors_of(&image),
        "association-type",
        "associations.router-runs-user.privilege"
    ));
    let mut image = self::image(LECTURE);
    image["associations"]["client-stores"] = serde_json::json!({"kind": "stores", "from": "ssh-client", "to": "server-credential", "privilege": "admin"});
    assert!(has(
        &errors_of(&image),
        "association-type",
        "associations.client-stores.privilege"
    ));
    // The same thing said twice.
    let mut image = self::image(LECTURE);
    image["associations"]["again"] = image["associations"]["server-runs-sshd"].clone();
    let errors = errors_of(&image);
    assert!(
        has(&errors, "cardinality", "associations.again"),
        "{errors:?}"
    );
    let mut image = self::image(LECTURE);
    image["associations"]["second-host"] = serde_json::json!({"kind": "hosts", "from": "workstation", "to": "sshd", "privilege": "user"});
    assert!(has(
        &errors_of(&image),
        "cardinality",
        "associations.second-host"
    ));
    let mut image = self::image(LECTURE);
    image["associations"]["deny-too"] =
        serde_json::json!({"kind": "permits", "from": "bridge-fw", "to": "ssh", "allowed": false});
    assert!(has(
        &errors_of(&image),
        "cardinality",
        "associations.deny-too"
    ));
}

#[test]
fn routes_alternate_networks_and_routers_the_ends_are_in() {
    let mut image = image(LECTURE);
    let route = |image: &mut serde_json::Value, hops: &[&str]| {
        image["flows"]["ssh"]["route"] = serde_json::json!(hops);
    };
    route(&mut image, &["client-net", "server-net", "bridge"]);
    assert!(has(
        &errors_of(&image),
        "invalid-route",
        "flows.ssh.route[1]"
    ));
    route(&mut image, &["client-net", "bridge", "client-net"]);
    assert!(has(
        &errors_of(&image),
        "invalid-route",
        "flows.ssh.route[2]"
    ));
    route(&mut image, &["client-net", "bridge", "nowhere"]);
    assert!(has(
        &errors_of(&image),
        "unknown-reference",
        "flows.ssh.route[2]"
    ));
    route(&mut image, &["server-net"]);
    assert!(has(
        &errors_of(&image),
        "invalid-route",
        "flows.ssh.route[0]"
    ));
    // A router not on the network after it is wrong, whatever comes next.
    route(&mut image, &["client-net", "bridge", "admin-net"]);
    let errors = errors_of(&image);
    assert!(
        has(&errors, "invalid-route", "flows.ssh.route[1]"),
        "{errors:?}"
    );
    // A flow's ends are software, and its target a service.
    let mut image = self::image(LECTURE);
    image["flows"]["ssh"]["source"] = serde_json::json!("workstation");
    assert!(has(
        &errors_of(&image),
        "association-type",
        "flows.ssh.source"
    ));
    let mut image = self::image(LECTURE);
    image["flows"]["ssh"]["target"] = serde_json::json!("ssh-client");
    assert!(has(
        &errors_of(&image),
        "association-type",
        "flows.ssh.target"
    ));
    // No permission yet is unfinished, not denied — once nothing names it.
    let mut image = self::image(LECTURE);
    image["associations"]
        .as_object_mut()
        .unwrap()
        .remove("allow-ssh");
    assert!(has(
        &errors_of(&image),
        "unknown-reference",
        "scenarios.deny-ssh.changes[0].association"
    ));
    image["scenarios"]
        .as_object_mut()
        .unwrap()
        .remove("deny-ssh");
    let text = from_document(&image).unwrap();
    let (_, diagnostics) = effractor_format::diagnose_document(&text);
    assert_eq!(diagnostics.len(), 1);
    assert_eq!(
        (diagnostics[0].code, diagnostics[0].path.as_str()),
        (effractor_core::Code::Unfinished, "flows.ssh.route[1]")
    );
}

/// The route of `image`'s flow `ssh` set to `hops`: its errors, and the paths
/// of its `unfinished` warnings.
fn route_state(
    image: &serde_json::Value,
    hops: &[&str],
) -> (Vec<(&'static str, String)>, Vec<String>) {
    let mut image = image.clone();
    image["flows"]["ssh"]["route"] = serde_json::json!(hops);
    match from_document(&image) {
        Err(errors) => (
            errors
                .iter()
                .filter(|d| d.severity == Severity::Error)
                .map(|d| (d.code.as_str(), d.path.clone()))
                .collect(),
            Vec::new(),
        ),
        Ok(text) => {
            let (_, diagnostics) = effractor_format::diagnose_document(&text);
            (
                Vec::new(),
                diagnostics
                    .iter()
                    .filter(|d| d.code == effractor_core::Code::Unfinished)
                    .map(|d| d.path.clone())
                    .collect(),
            )
        }
    }
}

#[test]
fn a_route_built_or_shortened_hop_by_hop_is_unfinished_never_invalid() {
    let image = image(LECTURE);
    // A new flow has no route; each hop added in turn leaves a route that
    // has not arrived yet. None of these is wrong, only unfinished.
    for hops in [&[][..], &["client-net"], &["client-net", "bridge"]] {
        let (errors, unfinished) = route_state(&image, hops);
        assert_eq!(errors, vec![], "{hops:?}");
        assert!(
            unfinished.iter().any(|p| p.starts_with("flows.ssh.route")),
            "{hops:?}: {unfinished:?}"
        );
    }
    let (errors, unfinished) = route_state(&image, &["client-net", "bridge", "server-net"]);
    assert_eq!(errors, vec![]);
    assert!(unfinished.is_empty(), "{unfinished:?}");
    // Still wrong at once: a first network the source is not in, a hop of
    // the wrong kind, a router off the network before it.
    assert!(has(
        &route_state(&image, &["server-net"]).0,
        "invalid-route",
        "flows.ssh.route[0]"
    ));
    assert!(has(
        &route_state(&image, &["client-net", "server-net"]).0,
        "invalid-route",
        "flows.ssh.route[1]"
    ));
    assert!(has(
        &route_state(&image, &["server-net", "bridge"]).0,
        "invalid-route",
        "flows.ssh.route[0]"
    ));
}

#[test]
fn states_footholds_targets_and_scenarios_are_typed() {
    let mut image = image(LECTURE);
    image["attacker"]["target"] = serde_json::json!({"entity": "bridge-fw", "state": "admin"});
    assert!(has(
        &errors_of(&image),
        "unknown-state",
        "attacker.target.state"
    ));
    image["attacker"]["target"] = serde_json::json!({"entity": "server", "state": "control"});
    assert!(has(
        &errors_of(&image),
        "unknown-state",
        "attacker.target.state"
    ));
    image["attacker"]["target"] = serde_json::json!({"entity": "nobody", "state": "admin"});
    assert!(has(
        &errors_of(&image),
        "unknown-reference",
        "attacker.target.entity"
    ));
    image["attacker"]["target"] = serde_json::json!({"entity": "server", "state": "root"});
    assert!(has(
        &errors_of(&image),
        "wrong-type",
        "attacker.target.state"
    ));
    let mut image = self::image(LECTURE);
    image["attacker"]["footholds"] = serde_json::json!([{"entity": "workstation", "state": "admin"}, {"entity": "workstation", "state": "admin"}]);
    assert!(has(
        &errors_of(&image),
        "cardinality",
        "attacker.footholds[1]"
    ));

    let mut image = self::image(LECTURE);
    image["scenarios"]["twice"] = serde_json::json!({"label": "Twice", "changes": [
        {"entity": "sshd", "defense": "patched", "value": true},
        {"entity": "sshd", "defense": "patched", "value": false},
    ]});
    assert!(has(
        &errors_of(&image),
        "conflicting-change",
        "scenarios.twice.changes[1]"
    ));
    image["scenarios"]["twice"] = serde_json::json!({"label": "Twice", "changes": [
        {"association": "allow-ssh", "field": "allowed", "value": false},
        {"association": "allow-ssh", "field": "allowed", "value": false},
    ]});
    assert!(has(
        &errors_of(&image),
        "conflicting-change",
        "scenarios.twice.changes[1]"
    ));
    image["scenarios"]["twice"] = serde_json::json!({"label": "Wrong", "changes": [
        {"entity": "server", "defense": "patched", "value": true},
        {"entity": "server-credential", "defense": "patched", "value": true},
        {"association": "bridge-filters", "field": "allowed", "value": false},
        {"association": "nothing", "field": "allowed", "value": false},
    ]});
    let errors = errors_of(&image);
    assert!(
        has(
            &errors,
            "unknown-state",
            "scenarios.twice.changes[0].defense"
        ),
        "{errors:?}"
    );
    assert!(
        has(
            &errors,
            "unknown-state",
            "scenarios.twice.changes[1].defense"
        ),
        "{errors:?}"
    );
    assert!(
        has(
            &errors,
            "association-type",
            "scenarios.twice.changes[2].association"
        ),
        "{errors:?}"
    );
    assert!(
        has(
            &errors,
            "unknown-reference",
            "scenarios.twice.changes[3].association"
        ),
        "{errors:?}"
    );
    // What is not even the shape of a change is reported before any of that.
    image["scenarios"]["twice"] = serde_json::json!({"label": "Shape", "changes": [
        {"entity": "sshd", "association": "allow-ssh", "value": true},
        {"value": true},
        {"entity": "sshd", "field": "allowed", "value": true},
        {"association": "allow-ssh", "defense": "patched", "value": true},
    ]});
    let errors = errors_of(&image);
    assert!(
        has(
            &errors,
            "misplaced-key",
            "scenarios.twice.changes[0].association"
        ),
        "{errors:?}"
    );
    assert!(
        has(&errors, "missing-key", "scenarios.twice.changes[1]"),
        "{errors:?}"
    );
    assert!(
        has(&errors, "misplaced-key", "scenarios.twice.changes[2].field"),
        "{errors:?}"
    );
    assert!(
        has(
            &errors,
            "misplaced-key",
            "scenarios.twice.changes[3].defense"
        ),
        "{errors:?}"
    );
}

#[test]
fn parameters_say_where_their_numbers_come_from() {
    let mut image = image(LECTURE);
    image["entities"]["openssh"]["parameters"]["find-exploit"] =
        serde_json::json!({"status": "illustrative", "ttc": "Exponential(mean 10)"});
    let sshd = &mut image["entities"]["sshd"]["parameters"];
    sshd["login"] = serde_json::json!({"status": "unknown", "ttc": "Exponential(mean 1)"});
    sshd["deploy-exploit"] = serde_json::json!({"status": "assumed", "note": "no number"});
    image["flows"]["ssh"]["parameters"]["connect"] =
        serde_json::json!({"status": "calibrated", "ttc": "Pert(1, 2, 3)", "note": "measured"});
    let errors = errors_of(&image);
    // An illustrative value may go without saying why; a calibrated one may not.
    assert!(!has(
        &errors,
        "missing-key",
        "entities.openssh.parameters.find-exploit.note"
    ));
    for want in [
        ("param-domain", "entities.sshd.parameters.login.ttc"),
        ("missing-key", "entities.sshd.parameters.deploy-exploit.ttc"),
        ("distribution-role", "flows.ssh.parameters.connect.ttc"),
    ] {
        assert!(has(&errors, want.0, want.1), "{want:?} in {errors:?}");
    }
    // A slot or switch the kind does not have is not a key at all.
    let mut image = self::image(LECTURE);
    image["entities"]["sshd"]["parameters"]["extract"] = serde_json::json!({"status": "unknown"});
    image["entities"]["server"]["defenses"] = serde_json::json!({"patched": true});
    image["entities"]["server-credential"]["defenses"] = serde_json::json!({"protected": "maybe"});
    let errors = errors_of(&image);
    for want in [
        ("unknown-key", "entities.sshd.parameters.extract"),
        ("unknown-key", "entities.server.defenses.patched"),
        (
            "wrong-type",
            "entities.server-credential.defenses.protected",
        ),
    ] {
        assert!(has(&errors, want.0, want.1), "{want:?} in {errors:?}");
    }
    // A blank note is no note.
    let mut image = self::image(LECTURE);
    image["entities"]["sshd"]["parameters"]["login"]["status"] = serde_json::json!("calibrated");
    image["entities"]["sshd"]["parameters"]["login"]["note"] = serde_json::json!("  ");
    assert!(has(
        &errors_of(&image),
        "missing-key",
        "entities.sshd.parameters.login.note"
    ));
}

#[test]
fn library_pins_and_caps() {
    let mut image = image(EMPTY);
    image["library"]["version"] = serde_json::json!(2);
    assert!(has(&errors_of(&image), "unknown-library", "library"));
    image["library"] = serde_json::json!({"id": "other-components", "version": 1});
    assert!(has(&errors_of(&image), "unknown-library", "library"));
    image["library"] = serde_json::json!({"id": "core-components"});
    assert!(has(&errors_of(&image), "missing-key", "library.version"));
    image["library"] = serde_json::json!({"id": "core-components", "version": "99999999999"});
    let errors = errors_of(&image);
    assert!(has(&errors, "wrong-type", "library.version"), "{errors:?}");
    assert!(!has(&errors, "unknown-library", "library"), "{errors:?}");

    let mut image = self::image(EMPTY);
    image["analysis"]["seed"] = serde_json::json!("18446744073709551615");
    let text = from_document(&image).unwrap();
    assert!(text.contains("  seed: 18446744073709551615\n"));
    assert_eq!(canonicalize(&text).unwrap(), text);
    image["analysis"]["samples"] = serde_json::json!(100000);
    assert!(from_document(&image).is_ok());
    image["analysis"]["samples"] = serde_json::json!(100001);
    assert!(has(&errors_of(&image), "limit", "analysis.samples"));

    let mut image = self::image(EMPTY);
    for i in 0..500 {
        image["entities"][format!("n-{i}")] = serde_json::json!({"kind": "network", "label": "N"});
    }
    assert!(from_document(&image).is_ok());
    image["entities"]["n-500"] = serde_json::json!({"kind": "network", "label": "N"});
    assert!(has(&errors_of(&image), "limit", "entities"));
    let mut image = self::image(EMPTY);
    for i in 0..17 {
        image["scenarios"][format!("s-{i}")] = serde_json::json!({"label": "S", "changes": []});
    }
    assert!(has(&errors_of(&image), "limit", "scenarios"));
}

#[test]
fn extension_keys_ride_along_at_every_level() {
    let mut image = image(LECTURE);
    image["x-top"] = serde_json::json!({"a": [1, "two"]});
    image["library"]["x-pinned-by"] = serde_json::json!("owner");
    image["entities"]["sshd"]["x-cpe"] = serde_json::json!("cpe:/a:openbsd:openssh");
    image["entities"]["sshd"]["parameters"]["login"]["x-source"] = serde_json::json!("slide 12");
    image["entities"]["sshd"]["parameters"]["x-reviewed"] = serde_json::json!(true);
    image["entities"]["openssh"]["defenses"]["x-since"] = serde_json::json!("2026-01");
    image["associations"]["allow-ssh"]["x-rule"] = serde_json::json!(17);
    image["flows"]["ssh"]["x-port"] = serde_json::json!(22);
    image["flows"]["ssh"]["parameters"]["connect"]["x-note"] = serde_json::json!("lan");
    image["attacker"]["x-persona"] = serde_json::json!("insider");
    image["attacker"]["footholds"][0]["x-why"] = serde_json::json!("phished");
    image["attacker"]["target"]["x-value"] = serde_json::json!("high");
    image["scenarios"]["deny-ssh"]["x-cost"] = serde_json::json!(0);
    image["scenarios"]["deny-ssh"]["changes"][0]["x-ticket"] = serde_json::json!("FW-1");
    image["analysis"]["x-last-run"] = serde_json::json!("never");
    let text = from_document(&image).unwrap();
    assert_eq!(canonicalize(&text).unwrap(), text);
    let back = self::image(&text);
    for (path, want) in [
        ("x-top", serde_json::json!({"a": [1, "two"]})),
        ("library.x-pinned-by", serde_json::json!("owner")),
        (
            "entities.sshd.x-cpe",
            serde_json::json!("cpe:/a:openbsd:openssh"),
        ),
        (
            "entities.sshd.parameters.login.x-source",
            serde_json::json!("slide 12"),
        ),
        (
            "entities.sshd.parameters.x-reviewed",
            serde_json::json!(true),
        ),
        (
            "entities.openssh.defenses.x-since",
            serde_json::json!("2026-01"),
        ),
        ("associations.allow-ssh.x-rule", serde_json::json!(17)),
        ("flows.ssh.x-port", serde_json::json!(22)),
        (
            "flows.ssh.parameters.connect.x-note",
            serde_json::json!("lan"),
        ),
        ("attacker.x-persona", serde_json::json!("insider")),
        ("attacker.target.x-value", serde_json::json!("high")),
        ("scenarios.deny-ssh.x-cost", serde_json::json!(0)),
        ("analysis.x-last-run", serde_json::json!("never")),
    ] {
        let mut at = &back;
        for key in path.split('.') {
            at = &at[key];
        }
        assert_eq!(at, &want, "{path}");
    }
    assert_eq!(
        back["attacker"]["footholds"][0]["x-why"],
        serde_json::json!("phished")
    );
    assert_eq!(
        back["scenarios"]["deny-ssh"]["changes"][0]["x-ticket"],
        serde_json::json!("FW-1")
    );
    // An unknown key that is not an extension is still an error, wherever.
    image["entities"]["sshd"]["parameters"]["login"]["source"] = serde_json::json!("slide 12");
    assert!(has(
        &errors_of(&image),
        "unknown-key",
        "entities.sshd.parameters.login.source"
    ));
}

#[test]
fn diagnostics_have_positions_in_the_text() {
    let text = LECTURE.replace(
        "    to: sshd\n    privilege: admin",
        "    to: sshd\n    privilege: root",
    );
    let (_, diagnostics) = effractor_format::diagnose_document(&text);
    let d = &diagnostics[0];
    assert_eq!(
        (d.code.as_str(), d.path.as_str()),
        ("wrong-type", "associations.server-runs-sshd.privilege")
    );
    let pos = d.pos.unwrap();
    assert_eq!(
        text.lines().nth(pos.line - 1).unwrap().trim(),
        "privilege: root"
    );
    let text = LECTURE.replace(
        "from: bridge-fw\n    to: ssh\n",
        "from: bridge-fw\n    to: telnet\n",
    );
    let (_, diagnostics) = effractor_format::diagnose_document(&text);
    let d = &diagnostics[0];
    assert_eq!(
        (d.code.as_str(), d.path.as_str()),
        ("unknown-reference", "associations.allow-ssh.to")
    );
    assert_eq!(
        text.lines().nth(d.pos.unwrap().line - 1).unwrap().trim(),
        "to: telnet"
    );
}

#[test]
fn a_long_route_goes_block_and_stays_there() {
    let mut image = image(LECTURE);
    let zones: Vec<String> = (0..4)
        .map(|i| format!("ein-ziemlich-langes-netz-{i}"))
        .collect();
    let routers: Vec<String> = (0..3)
        .map(|i| format!("ein-ziemlich-langer-router-{i}"))
        .collect();
    let mut n = 0;
    for z in &zones {
        image["entities"][z] = serde_json::json!({"kind": "network", "label": "Z"});
    }
    for (i, r) in routers.iter().enumerate() {
        image["entities"][r] = serde_json::json!({"kind": "router", "label": "R"});
        image["entities"][format!("{r}-fw")] =
            serde_json::json!({"kind": "firewall", "label": "F"});
        image["associations"][format!("f-{i}")] =
            serde_json::json!({"kind": "filters", "from": r, "to": format!("{r}-fw")});
        image["associations"][format!("p-{i}")] = serde_json::json!({"kind": "permits", "from": format!("{r}-fw"), "to": "ssh", "allowed": true});
        for side in [&zones[i], &zones[i + 1]] {
            image["associations"][format!("a-{n}")] =
                serde_json::json!({"kind": "attached", "from": r, "to": side});
            n += 1;
        }
    }
    image["associations"]["ws-far"] =
        serde_json::json!({"kind": "attached", "from": "workstation", "to": zones[0]});
    image["associations"]["server-far"] =
        serde_json::json!({"kind": "attached", "from": "server", "to": zones[3]});
    let mut route = Vec::new();
    for i in 0..3 {
        route.push(zones[i].clone());
        route.push(routers[i].clone());
    }
    route.push(zones[3].clone());
    image["flows"]["ssh"]["route"] = serde_json::json!(route);
    // The bridge is off the new route: its permission, and the scenario that
    // denies it, would change nothing.
    image["associations"]
        .as_object_mut()
        .unwrap()
        .remove("allow-ssh");
    image["scenarios"]
        .as_object_mut()
        .unwrap()
        .remove("deny-ssh");
    let text = from_document(&image).unwrap_or_else(|d| panic!("{d:?}"));
    assert!(
        text.contains("    route:\n      - ein-ziemlich-langes-netz-0\n"),
        "{text}"
    );
    assert!(
        text.contains(
            "      - ein-ziemlich-langer-router-2\n      - ein-ziemlich-langes-netz-3\n    protocol"
        ),
        "{text}"
    );
    assert_eq!(canonicalize(&text).unwrap(), text);
    let (_, diagnostics) = effractor_format::diagnose_document(&text);
    assert_eq!(diagnostics, vec![]);
}

#[test]
fn a_product_and_its_instances_round_trip() {
    let text = CANONICAL
        .replace(
            "entities: {}",
            r#"entities:
  box:
    kind: host
    label: Box
    parameters:
      escape:
        status: unknown
  sshd:
    kind: service
    label: SSH server
    parameters:
      deploy-exploit:
        status: unknown
      login:
        status: unknown
      take-over:
        status: unknown
      take-over-guarded:
        status: unknown
    defenses: {guarded: unknown}
  openssh:
    kind: product
    label: OpenSSH
    parameters:
      find-exploit:
        status: illustrative
        ttc: "Exponential(mean 10)"
        note: Exercise assumption
      find-exploit-patched:
        status: unknown
    defenses: {patched: false}"#,
        )
        .replace(
            "associations: {}",
            r#"associations:
  sshd-hosting:
    kind: hosts
    from: box
    to: sshd
    privilege: admin
  sshd-instance:
    kind: instance-of
    from: sshd
    to: openssh"#,
        )
        .replace(
            "scenarios: {}",
            r#"scenarios:
  patch:
    label: Patch
    changes:
      - {entity: openssh, defense: patched, value: true}"#,
        );
    assert_eq!(canonicalize(&text).unwrap(), text);
    let Document::Architecture(m) = load_document(&text).unwrap() else {
        panic!("not an architecture");
    };
    assert!(matches!(
        m.associations[&"sshd-instance"
            .parse::<effractor_core::AssociationId>()
            .unwrap()]
            .relation,
        effractor_core::architecture::Relation::InstanceOf { .. }
    ));
    // Patching a service is no longer a thing: its switch is the product's.
    let service_patch = text.replace(
        "{entity: openssh, defense: patched",
        "{entity: sshd, defense: patched",
    );
    let (_, diagnostics) = effractor_format::diagnose_document(&service_patch);
    assert!(
        diagnostics
            .iter()
            .any(|d| d.code == effractor_core::Code::UnknownState
                && d.path == "scenarios.patch.changes[0].defense"),
        "{diagnostics:?}"
    );
}

/// Two accounts, a workload identity, a role one may become and a second factor.
fn identities(seed_factor: &str) -> String {
    CANONICAL
        .replace(
            "entities: {}",
            r#"entities:
  box:
    kind: host
    label: Box
    parameters:
      escape:
        status: unknown
  admin:
    kind: account
    label: Admin
    parameters:
      admin-login:
        status: unknown
      mfa-bypass:
        status: unknown
    defenses: {mfa: true}
  role:
    kind: account
    label: Role
    parameters:
      admin-login:
        status: unknown
      mfa-bypass:
        status: unknown
    defenses: {mfa: false}
  password:
    kind: credential
    label: Password
    parameters:
      extract:
        status: unknown
      extract-protected:
        status: unknown
    defenses: {protected: false}
  seed:
    kind: credential
    label: Seed
    parameters:
      extract:
        status: unknown
      extract-protected:
        status: unknown
    defenses: {protected: false}"#,
        )
        .replace(
            "associations: {}",
            &format!(
                r#"associations:
  password-auth:
    kind: authenticates
    from: password
    to: admin
  seed-auth:
    kind: authenticates
    from: seed
    to: admin{seed_factor}
  box-identity:
    kind: runs-as
    from: box
    to: role
    privilege: user
  admin-becomes-role:
    kind: assumes
    from: admin
    to: role"#
            ),
        )
}

#[test]
fn factors_workload_identities_and_roles_round_trip() {
    let text = identities("\n    factor: second");
    assert_eq!(canonicalize(&text).unwrap(), text);
    // A first factor is what an authentication is unless it says otherwise.
    let first = identities("\n    factor: first");
    assert_eq!(canonicalize(&first).unwrap(), identities(""));
    let (_, d) = effractor_format::diagnose_document(&identities("\n    factor: third"));
    assert!(
        d.iter()
            .any(|d| d.path == "associations.seed-auth.factor" && d.severity == Severity::Error),
        "{d:?}"
    );
    let misplaced = text.replace(
        "    to: role\n    privilege: user\n",
        "    to: role\n    privilege: user\n    factor: second\n",
    );
    let (_, d) = effractor_format::diagnose_document(&misplaced);
    assert!(
        d.iter()
            .any(|d| d.code == effractor_core::Code::MisplacedKey
                && d.path == "associations.box-identity.factor"),
        "{d:?}"
    );
}

/// A mail user reached from the internet.
fn people() -> String {
    CANONICAL
        .replace(
            "entities: {}",
            r#"entities:
  internet:
    kind: network
    label: Internet
  vm:
    kind: host
    label: VM
    parameters:
      escape:
        status: unknown
  mail:
    kind: application
    label: Mail
    parameters:
      take-over:
        status: unknown
      take-over-guarded:
        status: unknown
    defenses: {guarded: false}
  pw:
    kind: credential
    label: Password
    parameters:
      extract:
        status: unknown
      extract-protected:
        status: unknown
    defenses: {protected: false}
  ada:
    kind: person
    label: Ada
    parameters:
      phish:
        status: illustrative
        ttc: "Exponential(mean 7)"
        note: Exercise assumption
      phish-trained:
        status: unknown
    defenses: {trained: false}"#,
        )
        .replace(
            "associations: {}",
            r#"associations:
  vm-mail:
    kind: hosts
    from: vm
    to: mail
    privilege: user
    contained: true
  ada-pw:
    kind: knows
    from: ada
    to: pw
  ada-mail:
    kind: operates
    from: ada
    to: mail
  mail-ada:
    kind: delivers
    from: internet
    to: ada
  mail-mail:
    kind: delivers
    from: internet
    to: mail"#,
        )
}

#[test]
fn people_round_trip() {
    let text = people();
    assert_eq!(canonicalize(&text).unwrap(), text);
    let Document::Architecture(m) = load_document(&text).unwrap() else {
        panic!("not an architecture");
    };
    assert_eq!(
        m.entities[&"ada".parse::<effractor_core::EntityId>().unwrap()].kind,
        effractor_core::architecture::EntityKind::Person
    );
    let misplaced = text.replace(
        "    from: internet\n    to: ada\n",
        "    from: internet\n    to: ada\n    privilege: user\n",
    );
    let (_, d) = effractor_format::diagnose_document(&misplaced);
    assert!(
        d.iter()
            .any(|d| d.code == effractor_core::Code::MisplacedKey
                && d.path == "associations.mail-ada.privilege"),
        "{d:?}"
    );
}

#[test]
fn content_software_and_containment_round_trip() {
    let text = people();
    let Document::Architecture(m) = load_document(&text).unwrap() else {
        panic!("not an architecture");
    };
    assert!(matches!(
        m.associations[&"vm-mail".parse::<effractor_core::AssociationId>().unwrap()].relation,
        effractor_core::architecture::Relation::Hosts {
            contained: true,
            ..
        }
    ));
    // `false` is what an absent key says: a save drops it.
    let open = text.replace(
        "    contained: true
",
        "    contained: false
",
    );
    assert_eq!(
        canonicalize(&open).unwrap(),
        text.replace(
            "    contained: true
",
            ""
        )
    );
    let (_, d) = effractor_format::diagnose_document(&text.replace(
        "    contained: true
",
        "    contained: maybe
",
    ));
    assert!(
        d.iter()
            .any(|d| d.path == "associations.vm-mail.contained" && d.severity == Severity::Error),
        "{d:?}"
    );
    let (_, d) = effractor_format::diagnose_document(&text.replace(
        "    from: internet\n    to: ada\n",
        "    from: internet\n    to: ada\n    contained: true\n",
    ));
    assert!(
        d.iter()
            .any(|d| d.code == effractor_core::Code::MisplacedKey
                && d.path == "associations.mail-ada.contained"),
        "{d:?}"
    );
}

/// A bucket held by a storage service that sees ciphertext only, its key,
/// an account that may write it and a bot that reads it.
fn bucket() -> String {
    CANONICAL
        .replace(
            "entities: {}",
            r#"entities:
  store:
    kind: service
    label: Storage
    parameters:
      deploy-exploit:
        status: unknown
      login:
        status: unknown
      take-over:
        status: unknown
      take-over-guarded:
        status: unknown
    defenses: {guarded: unknown}
  bot:
    kind: application
    label: Bot
    parameters:
      take-over:
        status: unknown
      take-over-guarded:
        status: unknown
    defenses: {guarded: false}
  ops:
    kind: account
    label: Ops
    parameters:
      admin-login:
        status: unknown
      mfa-bypass:
        status: unknown
    defenses: {mfa: false}
  key:
    kind: credential
    label: Key
    parameters:
      extract:
        status: unknown
      extract-protected:
        status: unknown
    defenses: {protected: false}
  bucket:
    kind: data
    label: Bucket
    defenses: {encrypted: false}"#,
        )
        .replace(
            "associations: {}",
            r#"associations:
  store-bucket:
    kind: holds
    from: store
    to: bucket
    privilege: user
    decrypts: false
  ops-bucket:
    kind: accesses
    from: ops
    to: bucket
    mode: write
  bucket-key:
    kind: encrypted-with
    from: bucket
    to: key
  bot-bucket:
    kind: reads
    from: bot
    to: bucket"#,
        )
}

#[test]
fn data_holdings_access_keys_and_readers_round_trip() {
    let text = bucket();
    assert_eq!(canonicalize(&text).unwrap(), text);
    // An unsaid `decrypts` loads (it is incomplete, not unreadable).
    let unsaid = text.replace("    decrypts: false\n", "");
    assert_eq!(canonicalize(&unsaid).unwrap(), unsaid);
    // Quoted, as some links shared since 2026-09-24 may say it: read, and
    // written bare. (`closed` and `enabled` never took quotes.)
    let quoted = text.replace("    decrypts: false\n", "    decrypts: \"false\"\n");
    assert_ne!(quoted, text);
    assert_eq!(canonicalize(&quoted).unwrap(), text);
    for (from, to, path, code) in [
        (
            "mode: write",
            "mode: delete",
            "associations.ops-bucket.mode",
            None,
        ),
        (
            "    mode: write\n",
            "",
            "associations.ops-bucket.mode",
            Some(effractor_core::Code::MissingKey),
        ),
        (
            "    to: key\n",
            "    to: key\n    decrypts: true\n",
            "associations.bucket-key.decrypts",
            Some(effractor_core::Code::MisplacedKey),
        ),
    ] {
        let (_, d) = effractor_format::diagnose_document(&text.replace(from, to));
        assert!(
            d.iter().any(|d| d.path == path
                && d.severity == Severity::Error
                && code.is_none_or(|c| d.code == c)),
            "{to}: {d:?}"
        );
    }
}

#[test]
fn a_scenario_may_speed_the_attacker_up() {
    let mut image = image(LECTURE);
    image["scenarios"]["fast"] = serde_json::json!({
        "label": "AI-accelerated attacker",
        "attacker": {"speed": 4},
        "changes": [],
    });
    let text = from_document(&image).unwrap();
    assert!(
        text.contains(
            "  fast:\n    label: AI-accelerated attacker\n    attacker: {speed: 4}\n    changes: []\n"
        ),
        "{text}"
    );
    assert_eq!(canonicalize(&text).unwrap(), text);
    let Ok(Document::Architecture(a)) = load_document(&text) else {
        panic!("an architecture")
    };
    let scenario = |id: &str| &a.scenarios[&id.parse::<effractor_core::ScenarioId>().unwrap()];
    let fast = scenario("fast");
    assert_eq!(fast.attacker.as_ref().unwrap().speed, 4.0);
    // The other scenarios name no attacker and write none.
    assert!(scenario("patch-server").attacker.is_none());
    assert!(!LECTURE.contains("    attacker:"));

    // A speed is a positive finite number, and nothing else rides along.
    for (speed, code) in [
        (serde_json::json!(0), "param-domain"),
        (serde_json::json!(-2), "param-domain"),
        (serde_json::json!("fast"), "wrong-type"),
    ] {
        image["scenarios"]["fast"]["attacker"] = serde_json::json!({"speed": speed});
        let errors = errors_of(&image);
        assert!(
            has(&errors, code, "scenarios.fast.attacker.speed"),
            "{speed}: {errors:?}"
        );
    }
    image["scenarios"]["fast"]["attacker"] = serde_json::json!({"speed": 2, "skill": 3});
    assert!(has(
        &errors_of(&image),
        "unknown-key",
        "scenarios.fast.attacker.skill"
    ));
    image["scenarios"]["fast"]["attacker"] = serde_json::json!({});
    assert!(has(
        &errors_of(&image),
        "missing-key",
        "scenarios.fast.attacker.speed"
    ));
}

#[test]
fn hosts_and_networks_carry_addresses_and_an_application_may_be_nmap() {
    let mut image = image(LECTURE);
    image["entities"]["server"]["addresses"] = serde_json::json!(["10.0.1.5", "fd00::5"]);
    image["entities"]["server-net"]["addresses"] = serde_json::json!(["10.0.1.0/24", "fd00::/64"]);
    image["entities"]["ssh-client"]["tool"] = serde_json::json!("nmap");
    let text = from_document(&image).unwrap();
    assert!(
        text.contains("    label: Server\n    addresses: ["),
        "{text}"
    );
    assert!(
        text.contains("    label: SSH client\n    tool: nmap\n"),
        "{text}"
    );
    assert_eq!(canonicalize(&text).unwrap(), text);
    let back = self::image(&text);
    assert_eq!(
        back["entities"]["server"]["addresses"],
        serde_json::json!(["10.0.1.5", "fd00::5"])
    );
    assert_eq!(
        back["entities"]["server-net"]["addresses"],
        serde_json::json!(["10.0.1.0/24", "fd00::/64"])
    );
    assert_eq!(
        back["entities"]["ssh-client"]["tool"],
        serde_json::json!("nmap")
    );
    // Absent is absent: the reference file does not change.
    assert_eq!(canonicalize(LECTURE).unwrap(), LECTURE);
}

#[test]
fn addresses_and_tool_are_refused_where_they_do_not_belong() {
    let cases: [(&str, &str, serde_json::Value, &str, &str); 7] = [
        (
            "sshd",
            "addresses",
            serde_json::json!(["10.0.1.5"]),
            "misplaced-key",
            "entities.sshd.addresses",
        ),
        (
            "server",
            "tool",
            serde_json::json!("nmap"),
            "misplaced-key",
            "entities.server.tool",
        ),
        (
            "ssh-client",
            "tool",
            serde_json::json!("wireshark"),
            "wrong-type",
            "entities.ssh-client.tool",
        ),
        (
            "server",
            "addresses",
            serde_json::json!(["10.0.1.0/24"]),
            "wrong-type",
            "entities.server.addresses[0]",
        ),
        (
            "server",
            "addresses",
            serde_json::json!(["10.0.1.5", "srv-01"]),
            "wrong-type",
            "entities.server.addresses[1]",
        ),
        (
            "server-net",
            "addresses",
            serde_json::json!(["10.0.1.5"]),
            "wrong-type",
            "entities.server-net.addresses[0]",
        ),
        (
            "server-net",
            "addresses",
            serde_json::json!(["10.0.1.0/33"]),
            "wrong-type",
            "entities.server-net.addresses[0]",
        ),
    ];
    for (entity, key, value, code, path) in cases {
        let mut image = image(LECTURE);
        image["entities"][entity][key] = value;
        let errors = errors_of(&image);
        assert!(has(&errors, code, path), "{entity}.{key}: {errors:?}");
    }
    let mut image = image(LECTURE);
    image["entities"]["server"]["addresses"] = serde_json::json!("10.0.1.5");
    assert!(!errors_of(&image).is_empty(), "a list, not one text");
}

#[test]
fn a_hosting_privilege_may_be_unknown_only_where_a_host_runs_software() {
    let mut doc = image(LECTURE);
    doc["associations"]["server-runs-sshd"]["privilege"] = serde_json::json!("unknown");
    let text = from_document(&doc).unwrap_or_else(|d| panic!("{d:?}"));
    assert!(text.contains("    privilege: unknown\n"), "{text}");
    assert_eq!(canonicalize(&text).unwrap(), text);
    assert_eq!(
        image(&text)["associations"]["server-runs-sshd"]["privilege"],
        serde_json::json!("unknown")
    );
    // Anywhere else it is refused: other relations, and a router or guest
    // on a box, whose escape needs a known privilege.
    let mut grants = image(LECTURE);
    let key = grants["associations"]
        .as_object()
        .unwrap()
        .iter()
        .find(|(_, a)| a["kind"] == "grants")
        .map(|(k, _)| k.clone())
        .unwrap();
    grants["associations"][&key]["privilege"] = serde_json::json!("unknown");
    let path = format!("associations.{key}.privilege");
    assert!(
        has(&errors_of(&grants), "wrong-type", &path),
        "{:?}",
        errors_of(&grants)
    );
    let mut router = image(LECTURE);
    router["entities"]["box"] = serde_json::json!({"kind": "host", "label": "Box"});
    router["associations"]["box-runs-router"] = serde_json::json!({
        "kind": "hosts", "from": "box", "to": "bridge", "privilege": "unknown"
    });
    assert!(
        has(
            &errors_of(&router),
            "association-type",
            "associations.box-runs-router.privilege"
        ),
        "{:?}",
        errors_of(&router)
    );
}

fn clustered(image: &mut serde_json::Value) {
    image["clusters"] = serde_json::json!({
        "client-box": {
            "label": "Client box",
            "members": ["workstation", "ssh-client"],
            "closed": true,
            "x-note": "kept"
        },
        "servers": {"members": ["server", "sshd"], "closed": false}
    });
}

#[test]
fn clusters_are_written_after_flows_and_read_back() {
    let mut image = image(LECTURE);
    clustered(&mut image);
    let text = from_document(&image).unwrap();
    assert!(
        text.contains(
            "\nclusters:\n  client-box:\n    label: Client box\n    members: [workstation, ssh-client]\n    closed: true\n    x-note: kept\n  servers:\n    members: [server, sshd]\n    closed: false\n\nattacker:\n"
        ),
        "{text}"
    );
    assert_eq!(canonicalize(&text).unwrap(), text);
    let back = self::image(&text);
    assert_eq!(back["clusters"], image["clusters"]);
    let Document::Architecture(a) = load_document(&text).unwrap() else {
        panic!("an architecture")
    };
    assert_eq!(a.clusters.len(), 2);
    // The model holds no `x-` keys; the text does, and keeps them.
    assert_eq!(
        effractor_format::save_document(&Document::Architecture(a)),
        text.replace("    x-note: kept\n", "")
    );
    // Absent is absent: a file without clusters does not change.
    assert_eq!(canonicalize(LECTURE).unwrap(), LECTURE);
    assert!(self::image(LECTURE).get("clusters").is_none());
}

#[test]
fn clusters_are_refused_where_they_do_not_hold() {
    let cases: [(serde_json::Value, &str, &str); 6] = [
        (
            serde_json::json!({"c": {"members": ["workstation", "nowhere"], "closed": true}}),
            "unknown-reference",
            "clusters.c.members[1]",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation"], "closed": true}}),
            "cardinality",
            "clusters.c.members",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation", "workstation"], "closed": true}}),
            "cardinality",
            "clusters.c.members[1]",
        ),
        (
            serde_json::json!({
                "c": {"members": ["workstation", "server"], "closed": true},
                "d": {"members": ["sshd", "server"], "closed": true}
            }),
            "cardinality",
            "clusters.d.members[1]",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation", "server"]}}),
            "missing-key",
            "clusters.c.closed",
        ),
        (
            serde_json::json!({"c": {"members": ["workstation", "server"], "closed": "yes"}}),
            "wrong-type",
            "clusters.c.closed",
        ),
    ];
    for (clusters, code, path) in cases {
        let mut image = image(LECTURE);
        image["clusters"] = clusters;
        let errors = errors_of(&image);
        assert!(has(&errors, code, path), "{code} at {path}: {errors:?}");
    }
    // An unknown key in a cluster is an error like anywhere else.
    let mut image = image(LECTURE);
    image["clusters"] = serde_json::json!({"c": {"members": ["workstation", "server"], "closed": true, "open": false}});
    assert!(has(&errors_of(&image), "unknown-key", "clusters.c.open"));
}

#[test]
fn a_closed_cluster_may_show_members_beside_it() {
    let mut image = image(LECTURE);
    image["clusters"] = serde_json::json!({
        "box": {"members": ["workstation", "ssh-client", "server"], "shown": ["ssh-client"], "closed": true}
    });
    let text = from_document(&image).unwrap();
    assert!(
        text.contains("    members: [workstation, ssh-client, server]\n    shown: [ssh-client]\n    closed: true\n"),
        "{text}"
    );
    assert_eq!(canonicalize(&text).unwrap(), text);
    assert_eq!(self::image(&text)["clusters"], image["clusters"]);
    // Only members, once each.
    for (shown, path) in [
        (serde_json::json!(["sshd"]), "clusters.box.shown[0]"),
        (
            serde_json::json!(["server", "server"]),
            "clusters.box.shown[1]",
        ),
    ] {
        let mut image = image.clone();
        image["clusters"]["box"]["shown"] = shown;
        let errors = errors_of(&image);
        assert!(has(&errors, "cardinality", path), "{path}: {errors:?}");
    }
}

/// Every id in `image` renamed, keys and values alike.
fn renamed(image: &serde_json::Value, names: &[(&str, &str)]) -> serde_json::Value {
    let mut json = image.to_string();
    for (old, new) in names {
        json = json.replace(&format!("\"{old}\""), &format!("\"{new}\""));
    }
    serde_json::from_str(&json).unwrap()
}

#[test]
fn ids_that_yaml_would_read_as_something_else_are_quoted_where_they_are_values() {
    // `slug("Null")` is `null`: a valid id, and nothing at all when bare.
    let mut image = image(LECTURE);
    clustered(&mut image);
    let image = renamed(
        &image,
        &[
            ("allow-ssh", "null"),
            ("openssh", "yes"),
            ("ssh-client", "on"),
            ("sshd", "off"),
            ("bridge-fw", "true"),
            ("bridge", "y"),
            ("ssh", "false"),
            ("workstation", "n"),
            ("server", "no"),
        ],
    );
    let text = from_document(&image).unwrap();
    for line in [
        "    to: \"yes\"\n",
        "    to: \"false\"\n",
        "    from: \"true\"\n",
        "    source: \"on\"\n",
        "    target: \"off\"\n",
        "    route: [client-net, \"y\", server-net]\n",
        "    members: [\"n\", \"on\"]\n",
        "    - {entity: \"n\", state: admin}\n",
        "  target: {entity: \"no\", state: admin}\n",
        "      - {association: \"null\", field: allowed, value: false}\n",
    ] {
        assert!(text.contains(line), "{line:?} in {text}");
    }
    // Keys stay bare: a key is text whatever it looks like.
    assert!(text.contains("\n  null:\n    kind: permits\n"), "{text}");
    load_document(&text).unwrap();
    assert_eq!(canonicalize(&text).unwrap(), text);
    assert_eq!(self::image(&text), image);
}

#[test]
fn extensions_survive_where_a_kind_has_no_parameters_or_defence() {
    // A network has neither: its maps hold only what an editor put there.
    let mut image = image(LECTURE);
    image["entities"]["client-net"]["parameters"] = serde_json::json!({"x-a": 1});
    image["entities"]["client-net"]["defenses"] = serde_json::json!({"x-b": 2});
    let text = from_document(&image).unwrap();
    assert!(
        text.contains(
            "    label: Client network\n    parameters:\n      x-a: 1\n    defenses: {x-b: 2}\n"
        ),
        "{text}"
    );
    assert_eq!(canonicalize(&text).unwrap(), text);
    assert_eq!(self::image(&text), image);
}

#[test]
fn every_problem_in_one_association_is_reported_at_once() {
    let cases = [
        (
            serde_json::json!({"kind": "linked", "from": "server", "to": "Bad Id"}),
            vec![("wrong-type", "kind"), ("invalid-id", "to")],
        ),
        (
            serde_json::json!({"kind": "attached", "from": "Bad Id", "to": "Also Bad"}),
            vec![("invalid-id", "from"), ("invalid-id", "to")],
        ),
        (
            serde_json::json!({"kind": "attached", "from": "Bad Id", "to": "server-net", "mode": "read"}),
            vec![("invalid-id", "from"), ("misplaced-key", "mode")],
        ),
        (
            serde_json::json!({"kind": "permits", "from": "Bad Id", "to": "Bad Flow", "allowed": true}),
            vec![("invalid-id", "from"), ("invalid-id", "to")],
        ),
        (
            serde_json::json!({"kind": "hosts", "from": "server", "privilege": "root"}),
            vec![("missing-key", "to"), ("wrong-type", "privilege")],
        ),
    ];
    for (association, want) in cases {
        let mut image = image(LECTURE);
        image["associations"]["a"] = association;
        let errors = errors_of(&image);
        for (code, key) in want {
            let path = format!("associations.a.{key}");
            assert!(has(&errors, code, &path), "{code} at {path}: {errors:?}");
        }
    }
}

#[test]
fn a_kind_without_parameters_or_defence_says_so() {
    let mut image = image(LECTURE);
    image["entities"]["client-net"]["parameters"] =
        serde_json::json!({"login": {"status": "unknown"}});
    image["entities"]["client-net"]["defenses"] = serde_json::json!({"patched": true});
    let errors = from_document(&image).unwrap_err();
    let message = |path: &str| {
        errors
            .iter()
            .find(|d| d.path == path)
            .map(|d| d.message.clone())
            .unwrap_or_else(|| panic!("{path}: {errors:?}"))
    };
    assert_eq!(
        message("entities.client-net.parameters.login"),
        "`login` is not a key here; a network has no parameters"
    );
    assert_eq!(
        message("entities.client-net.defenses.patched"),
        "`patched` is not a key here; a network has no defence"
    );
}

/// What is said but leads nowhere is warned at the association that says it,
/// never refused: a permission on a firewall the flow does not cross,
/// management access to a machine no account is granted on, an account's
/// access to data no service it logs in to holds.
#[test]
fn what_changes_nothing_is_a_warning_where_it_is_said() {
    let mut image = image(LECTURE);
    image["entities"]["spare"] = serde_json::json!({"kind": "router", "label": "Spare"});
    image["entities"]["spare-fw"] = serde_json::json!({"kind": "firewall", "label": "Spare FW"});
    image["entities"]["notes"] = serde_json::json!({"kind": "data", "label": "Notes"});
    image["associations"]["spare-filters"] =
        serde_json::json!({"kind": "filters", "from": "spare", "to": "spare-fw"});
    image["associations"]["spare-permit"] =
        serde_json::json!({"kind": "permits", "from": "spare-fw", "to": "ssh", "allowed": true});
    image["associations"]["manage-workstation"] =
        serde_json::json!({"kind": "administration", "from": "admin-net", "to": "workstation"});
    image["associations"]["reads-notes"] = serde_json::json!({"kind": "accesses", "from": "server-account", "to": "notes", "mode": "read"});
    let text = from_document(&image).unwrap_or_else(|d| panic!("{d:?}"));
    let (_, diagnostics) = effractor_format::diagnose_document(&text);
    let got: Vec<(Severity, &str, &str)> = diagnostics
        .iter()
        .map(|d| (d.severity, d.code.as_str(), d.path.as_str()))
        .collect();
    assert_eq!(
        got,
        [
            (
                Severity::Warning,
                "ineffective",
                "associations.spare-permit"
            ),
            (
                Severity::Warning,
                "ineffective",
                "associations.manage-workstation"
            ),
            (Severity::Warning, "ineffective", "associations.reads-notes"),
        ],
        "{diagnostics:?}"
    );
}
