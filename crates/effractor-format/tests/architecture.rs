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
    assert_eq!(a.entities.len(), 13);
    assert_eq!(a.associations.len(), 16);
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
        vec!["entities.sshd", "attacker.target", "attacker.footholds"]
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
        ("hosts", "server", "sshd", "client-net", "workstation"),
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
    // No permission yet is incomplete, not denied — once nothing names it.
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
        (effractor_core::Code::Incomplete, "flows.ssh.route[1]")
    );
}

/// The route of `image`'s flow `ssh` set to `hops`: its errors, and the paths
/// of its `incomplete` warnings.
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
                    .filter(|d| d.code == effractor_core::Code::Incomplete)
                    .map(|d| d.path.clone())
                    .collect(),
            )
        }
    }
}

#[test]
fn a_route_built_or_shortened_hop_by_hop_is_incomplete_never_invalid() {
    let image = image(LECTURE);
    // A new flow has no route; each hop added in turn leaves a route that
    // has not arrived yet. None of these is wrong, only unfinished.
    for hops in [&[][..], &["client-net"], &["client-net", "bridge"]] {
        let (errors, incomplete) = route_state(&image, hops);
        assert_eq!(errors, vec![], "{hops:?}");
        assert!(
            incomplete.iter().any(|p| p.starts_with("flows.ssh.route")),
            "{hops:?}: {incomplete:?}"
        );
    }
    let (errors, incomplete) = route_state(&image, &["client-net", "bridge", "server-net"]);
    assert_eq!(errors, vec![]);
    assert!(!incomplete.iter().any(|p| p.starts_with("flows.ssh.route")));
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
    let sshd = &mut image["entities"]["sshd"]["parameters"];
    sshd["find-exploit"] = serde_json::json!({"status": "illustrative", "ttc": "Exponential(0.1)"});
    sshd["login"] = serde_json::json!({"status": "unknown", "ttc": "Exponential(1)"});
    sshd["deploy-exploit"] = serde_json::json!({"status": "assumed", "note": "no number"});
    image["flows"]["ssh"]["parameters"]["connect"] =
        serde_json::json!({"status": "calibrated", "ttc": "Pert(1, 2, 3)", "note": "measured"});
    let errors = errors_of(&image);
    // An illustrative value may go without saying why; a calibrated one may not.
    assert!(!has(
        &errors,
        "missing-key",
        "entities.sshd.parameters.find-exploit.note"
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
    image["entities"]["sshd"]["defenses"]["x-since"] = serde_json::json!("2026-01");
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
            "entities.sshd.defenses.x-since",
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
