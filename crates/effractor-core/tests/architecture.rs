//! The architecture domain on its own: what a kind carries, what an id may
//! be, and what validation says about a model built in code.

use effractor_core::architecture::{
    Architecture, Association, Attacker, Change, Defense, Entity, EntityKind, Evidence, LibraryPin,
    Parameter, Privilege, Relation, Scenario, Slot, State, StateRef, Switch,
};
use effractor_core::{
    AssociationId, Code, Distribution, EntityId, Severity, validate_architecture,
};

fn id(s: &str) -> EntityId {
    s.parse().unwrap()
}

#[test]
fn architecture_ids_keep_the_grammar_and_need_a_non_digit() {
    assert!("constructor".parse::<EntityId>().is_ok());
    assert!("a1".parse::<EntityId>().is_ok());
    assert!("1a".parse::<EntityId>().is_ok());
    assert!("123".parse::<EntityId>().is_err());
    assert!("A".parse::<EntityId>().is_err());
    assert!("-a".parse::<EntityId>().is_err());
    // The tree's ids are not changed: all digits stays legal there.
    assert!("123".parse::<effractor_core::NodeId>().is_ok());
    let e = "123".parse::<EntityId>().unwrap_err().to_string();
    assert!(e.contains("letter"), "{e}");
}

#[test]
fn a_new_entity_carries_every_slot_and_switch_of_its_kind_as_unknown() {
    let product = Entity::new(EntityKind::Product, "P");
    let slots: Vec<Slot> = product.parameters.keys().copied().collect();
    assert_eq!(slots, [Slot::FindExploit, Slot::FindExploitPatched]);
    assert!(
        product
            .parameters
            .values()
            .all(|p| *p == Parameter::unknown())
    );
    assert_eq!(product.defenses.patched, Some(Switch::Unknown));
    assert_eq!(product.defenses.protected, None);
    let service = Entity::new(EntityKind::Service, "S");
    assert_eq!(service.defenses.patched, None);
    let network = Entity::new(EntityKind::Network, "N");
    assert!(network.parameters.is_empty());
    assert_eq!(network.defenses.patched, None);
    assert_eq!(EntityKind::Firewall.states(), &[]);
    assert_eq!(EntityKind::Host.states(), &[State::User, State::Admin]);
    assert_eq!(EntityKind::Credential.defense(), Some(Defense::Protected));
}

#[test]
fn an_empty_architecture_is_incomplete_but_not_wrong() {
    let m = Architecture::new("Untitled");
    assert_eq!(m.library, LibraryPin::bundled());
    let diagnostics = validate_architecture(&m);
    assert!(diagnostics.iter().all(|d| d.severity == Severity::Warning));
    let paths: Vec<&str> = diagnostics.iter().map(|d| d.path.as_str()).collect();
    assert_eq!(paths, ["attacker.target", "attacker.footholds"]);
}

#[test]
fn validation_names_the_field_that_is_wrong() {
    let mut m = Architecture::new("T");
    m.library.version = 2;
    m.entities
        .insert(id("net"), Entity::new(EntityKind::Network, "Net"));
    m.entities
        .insert(id("box"), Entity::new(EntityKind::Host, "Box"));
    let mut sshd = Entity::new(EntityKind::Service, "SSH");
    sshd.parameters.insert(
        Slot::Login,
        Parameter {
            status: Evidence::Calibrated,
            ttc: Some(Distribution::Exponential(1.0)),
            note: None,
        },
    );
    sshd.parameters.insert(Slot::Extract, Parameter::unknown());
    m.entities.insert(id("sshd"), sshd);
    m.entities
        .insert(id("openssh"), Entity::new(EntityKind::Product, "OpenSSH"));
    m.associations.insert(
        "runs".parse().unwrap(),
        Association {
            relation: Relation::Hosts {
                from: id("net"),
                to: id("sshd"),
                privilege: Privilege::Admin,
                contained: false,
            },
            description: None,
        },
    );
    m.attacker = Attacker {
        footholds: vec![StateRef {
            entity: id("net"),
            state: State::Admin,
        }],
        target: Some(StateRef {
            entity: id("box"),
            state: State::Admin,
        }),
    };
    m.scenarios.insert(
        "s".parse().unwrap(),
        Scenario {
            label: "S".into(),
            attacker: None,
            changes: vec![
                Change::EntityDefense {
                    entity: id("openssh"),
                    defense: Defense::Patched,
                    value: Switch::On,
                },
                Change::EntityDefense {
                    entity: id("openssh"),
                    defense: Defense::Patched,
                    value: Switch::Off,
                },
            ],
        },
    );
    let diagnostics = validate_architecture(&m);
    let got: Vec<(Code, &str)> = diagnostics
        .iter()
        .filter(|d| d.severity == Severity::Error)
        .map(|d| (d.code, d.path.as_str()))
        .collect();
    assert_eq!(
        got,
        [
            (Code::UnknownLibrary, "library"),
            (Code::MissingKey, "entities.sshd.parameters.login.note"),
            (Code::MisplacedKey, "entities.sshd.parameters.extract"),
            (Code::AssociationType, "associations.runs.from"),
            (Code::UnknownState, "attacker.footholds[0].state"),
            (Code::ConflictingChange, "scenarios.s.changes[1]"),
        ]
    );
}

/// A router can run on a host — a firewall appliance's box, a VM on a
/// hypervisor — but not on another router, and on one host at a time.
#[test]
fn a_router_runs_on_one_host_and_only_on_a_host() {
    let hosts = |from: &str, to: &str| Association {
        relation: Relation::Hosts {
            from: id(from),
            to: id(to),
            privilege: Privilege::Admin,
            contained: false,
        },
        description: None,
    };
    let errors = |m: &Architecture| -> Vec<(Code, String)> {
        validate_architecture(m)
            .into_iter()
            .filter(|d| d.severity == Severity::Error)
            .map(|d| (d.code, d.path))
            .collect()
    };
    let mut m = Architecture::new("T");
    m.entities
        .insert(id("hypervisor"), Entity::new(EntityKind::Host, "Box"));
    m.entities
        .insert(id("spare"), Entity::new(EntityKind::Host, "Spare"));
    m.entities
        .insert(id("edge"), Entity::new(EntityKind::Router, "Edge"));
    m.entities
        .insert(id("core"), Entity::new(EntityKind::Router, "Core"));
    m.associations
        .insert("vm".parse().unwrap(), hosts("hypervisor", "edge"));
    assert_eq!(errors(&m), []);

    m.associations
        .insert("nested".parse().unwrap(), hosts("edge", "core"));
    assert_eq!(
        errors(&m),
        [(Code::AssociationType, "associations.nested.from".to_owned())]
    );
    m.associations
        .shift_remove(&"nested".parse::<AssociationId>().unwrap());

    m.associations
        .insert("twice".parse().unwrap(), hosts("spare", "edge"));
    assert_eq!(
        errors(&m),
        [(Code::Cardinality, "associations.twice".to_owned())]
    );
}

/// A calibrated value names its source; an assumed or illustrative one may
/// say why, and need not.
#[test]
fn only_a_calibrated_value_must_say_what_it_rests_on() {
    for (status, refused) in [
        (Evidence::Calibrated, true),
        (Evidence::Assumed, false),
        (Evidence::Illustrative, false),
    ] {
        let mut m = Architecture::new("T");
        let mut sshd = Entity::new(EntityKind::Service, "SSH");
        sshd.parameters.insert(
            Slot::Login,
            Parameter {
                status,
                ttc: Some(Distribution::Exponential(1.0)),
                note: Some("  ".into()),
            },
        );
        m.entities.insert(id("sshd"), sshd);
        let missing = validate_architecture(&m)
            .iter()
            .any(|d| d.path == "entities.sshd.parameters.login.note");
        assert_eq!(missing, refused, "{status:?}");
    }
}

fn vm_model() -> Architecture {
    let mut m = Architecture::new("VMs");
    for (id, kind) in [
        ("hv", EntityKind::Host),
        ("vm", EntityKind::Host),
        ("ct", EntityKind::Host),
    ] {
        m.entities
            .insert(id.parse().unwrap(), Entity::new(kind, id));
    }
    let hosts = |from: &str, to: &str| Association {
        relation: Relation::Hosts {
            from: from.parse().unwrap(),
            to: to.parse().unwrap(),
            privilege: Privilege::User,
            contained: false,
        },
        description: None,
    };
    m.associations
        .insert("hv-vm".parse().unwrap(), hosts("hv", "vm"));
    m.associations
        .insert("vm-ct".parse().unwrap(), hosts("vm", "ct"));
    m
}

#[test]
fn a_host_may_run_on_a_host_and_nest() {
    let d = validate_architecture(&vm_model());
    assert!(
        d.iter()
            .all(|d| d.code != Code::AssociationType && d.code != Code::Cycle),
        "{d:?}"
    );
}

#[test]
fn every_host_and_router_carries_an_escape_slot() {
    assert_eq!(EntityKind::Host.slots(), &[Slot::Escape]);
    assert_eq!(EntityKind::Router.slots(), &[Slot::Escape]);
}

#[test]
fn a_hosting_cycle_is_an_error() {
    let mut m = vm_model();
    m.associations.insert(
        "ct-hv".parse().unwrap(),
        Association {
            relation: Relation::Hosts {
                from: "ct".parse().unwrap(),
                to: "hv".parse().unwrap(),
                privilege: Privilege::User,
                contained: false,
            },
            description: None,
        },
    );
    let cycles: Vec<_> = validate_architecture(&m)
        .into_iter()
        .filter(|d| d.code == Code::Cycle)
        .collect();
    assert_eq!(cycles.len(), 1, "{cycles:?}");
    assert!(cycles[0].message.contains("hv") && cycles[0].message.contains("ct"));
}

#[test]
fn a_router_cannot_host_a_host() {
    let mut m = vm_model();
    m.entities
        .insert("r".parse().unwrap(), Entity::new(EntityKind::Router, "R"));
    m.associations.insert(
        "r-vm2".parse().unwrap(),
        Association {
            relation: Relation::Hosts {
                from: "r".parse().unwrap(),
                to: "hv".parse().unwrap(),
                privilege: Privilege::Admin,
                contained: false,
            },
            description: None,
        },
    );
    let d = validate_architecture(&m);
    assert!(
        d.iter()
            .any(|d| d.code == Code::AssociationType && d.path == "associations.r-vm2.from"),
        "{d:?}"
    );
}

#[test]
fn a_service_without_a_product_is_incomplete_and_two_are_an_error() {
    let mut m = Architecture::new("P");
    m.entities
        .insert("s".parse().unwrap(), Entity::new(EntityKind::Service, "S"));
    let d = validate_architecture(&m);
    assert!(
        d.iter().any(|d| d.code == Code::Incomplete
            && d.path == "entities.s"
            && d.message.contains("product")),
        "{d:?}"
    );
    for p in ["p1", "p2"] {
        m.entities
            .insert(p.parse().unwrap(), Entity::new(EntityKind::Product, p));
        m.associations.insert(
            format!("s-{p}").parse().unwrap(),
            Association {
                relation: Relation::InstanceOf {
                    from: "s".parse().unwrap(),
                    to: p.parse().unwrap(),
                },
                description: None,
            },
        );
    }
    let d = validate_architecture(&m);
    assert!(
        d.iter()
            .any(|d| d.code == Code::Cardinality && d.path == "associations.s-p2"),
        "{d:?}"
    );
}

#[test]
fn patching_belongs_to_the_product() {
    assert_eq!(EntityKind::Product.defense(), Some(Defense::Patched));
    assert_eq!(EntityKind::Service.defense(), Some(Defense::Guarded));
    assert_eq!(
        EntityKind::Product.slots(),
        &[Slot::FindExploit, Slot::FindExploitPatched]
    );
    assert_eq!(
        EntityKind::Service.slots(),
        &[
            Slot::DeployExploit,
            Slot::Login,
            Slot::TakeOver,
            Slot::TakeOverGuarded
        ]
    );
}

#[test]
fn accounts_carry_mfa_and_its_bypass() {
    assert_eq!(EntityKind::Account.defense(), Some(Defense::Mfa));
    assert_eq!(
        EntityKind::Account.slots(),
        &[Slot::AdminLogin, Slot::MfaBypass]
    );
}

#[test]
fn an_account_cannot_assume_itself_and_software_runs_as_user() {
    let mut m = Architecture::new("I");
    m.entities
        .insert("a".parse().unwrap(), Entity::new(EntityKind::Account, "A"));
    m.entities.insert(
        "app".parse().unwrap(),
        Entity::new(EntityKind::Application, "App"),
    );
    m.associations.insert(
        "self".parse().unwrap(),
        Association {
            relation: Relation::Assumes {
                from: "a".parse().unwrap(),
                to: "a".parse().unwrap(),
            },
            description: None,
        },
    );
    m.associations.insert(
        "run".parse().unwrap(),
        Association {
            relation: Relation::RunsAs {
                from: "app".parse().unwrap(),
                to: "a".parse().unwrap(),
                privilege: Privilege::Admin,
            },
            description: None,
        },
    );
    let d = validate_architecture(&m);
    assert!(
        d.iter()
            .any(|d| d.code == Code::AssociationType && d.path == "associations.self.to"),
        "{d:?}"
    );
    assert!(
        d.iter()
            .any(|d| d.code == Code::AssociationType && d.path == "associations.run.privilege"),
        "{d:?}"
    );
}

#[test]
fn people_carry_their_training_switch() {
    assert_eq!(
        EntityKind::Person.states(),
        &[State::Contacted, State::Deceived]
    );
    assert_eq!(
        EntityKind::Person.slots(),
        &[Slot::Phish, Slot::PhishTrained]
    );
    assert_eq!(EntityKind::Person.defense(), Some(Defense::Trained));
}

#[test]
fn a_person_nothing_reaches_is_complete() {
    let mut m = Architecture::new("P");
    m.entities
        .insert("p".parse().unwrap(), Entity::new(EntityKind::Person, "P"));
    assert!(
        validate_architecture(&m)
            .iter()
            .all(|d| d.path != "entities.p")
    );
}

#[test]
fn software_carries_its_take_over_and_guard() {
    for kind in [EntityKind::Application, EntityKind::Service] {
        assert!(
            kind.slots()
                .ends_with(&[Slot::TakeOver, Slot::TakeOverGuarded])
        );
        assert_eq!(kind.defense(), Some(Defense::Guarded));
    }
    assert_eq!(
        effractor_core::architecture::RelationKind::Delivers.to_kinds(),
        &[
            EntityKind::Person,
            EntityKind::Application,
            EntityKind::Service
        ]
    );
}

#[test]
fn only_software_is_contained() {
    let mut m = Architecture::new("C");
    for (key, kind) in [
        ("hv", EntityKind::Host),
        ("vm", EntityKind::Host),
        ("app", EntityKind::Application),
    ] {
        m.entities.insert(id(key), Entity::new(kind, key));
    }
    for (key, to) in [("hv-vm", "vm"), ("vm-app", "app")] {
        m.associations.insert(
            key.parse().unwrap(),
            Association {
                relation: Relation::Hosts {
                    from: id(if to == "vm" { "hv" } else { "vm" }),
                    to: id(to),
                    privilege: Privilege::User,
                    contained: true,
                },
                description: None,
            },
        );
    }
    let d = validate_architecture(&m);
    assert!(
        d.iter()
            .any(|d| d.code == Code::MisplacedKey && d.path == "associations.hv-vm.contained"),
        "{d:?}"
    );
    assert!(
        d.iter().all(|d| !d.path.starts_with("associations.vm-app")),
        "{d:?}"
    );
}

#[test]
fn data_is_a_target_with_an_encryption_switch() {
    assert_eq!(EntityKind::Data.states(), &[State::Read, State::Modified]);
    assert_eq!(EntityKind::Data.slots(), &[] as &[Slot]);
    assert_eq!(EntityKind::Data.defense(), Some(Defense::Encrypted));
}

fn bucket_model(decrypts: Option<bool>, privilege: Privilege) -> Architecture {
    let mut m = Architecture::new("D");
    for (key, kind) in [
        ("h", EntityKind::Host),
        ("app", EntityKind::Application),
        ("d", EntityKind::Data),
    ] {
        m.entities.insert(id(key), Entity::new(kind, key));
    }
    m.associations.insert(
        "h-app".parse().unwrap(),
        Association {
            relation: Relation::Hosts {
                from: id("h"),
                to: id("app"),
                privilege: Privilege::User,
                contained: false,
            },
            description: None,
        },
    );
    m.associations.insert(
        "app-d".parse().unwrap(),
        Association {
            relation: Relation::Holds {
                from: id("app"),
                to: id("d"),
                privilege,
                decrypts,
            },
            description: None,
        },
    );
    m
}

#[test]
fn a_holding_must_say_whether_it_decrypts_and_software_holds_as_user() {
    let d = validate_architecture(&bucket_model(None, Privilege::User));
    assert!(
        d.iter().any(|d| d.code == Code::Incomplete
            && d.path == "associations.app-d"
            && d.message.contains("decrypts")),
        "{d:?}"
    );
    let d = validate_architecture(&bucket_model(Some(true), Privilege::Admin));
    assert!(
        d.iter()
            .any(|d| d.code == Code::AssociationType && d.path == "associations.app-d.privilege"),
        "{d:?}"
    );
    let d = validate_architecture(&bucket_model(Some(false), Privilege::User));
    assert!(
        d.iter().all(|d| !d.path.starts_with("associations.app-d")),
        "{d:?}"
    );
}

#[test]
fn data_nothing_holds_is_complete() {
    let mut m = Architecture::new("D");
    m.entities
        .insert(id("d"), Entity::new(EntityKind::Data, "D"));
    assert!(
        validate_architecture(&m)
            .iter()
            .all(|d| d.path != "entities.d")
    );
}
