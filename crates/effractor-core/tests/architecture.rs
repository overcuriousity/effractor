//! The architecture domain on its own: what a kind carries, what an id may
//! be, and what validation says about a model built in code.

use effractor_core::architecture::{
    Architecture, Association, Attacker, Change, Defense, Entity, EntityKind, Evidence, LibraryPin,
    Parameter, Privilege, Relation, Scenario, Slot, State, StateRef, Switch,
};
use effractor_core::{Code, Distribution, EntityId, Severity, validate_architecture};

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
    let service = Entity::new(EntityKind::Service, "S");
    let slots: Vec<Slot> = service.parameters.keys().copied().collect();
    assert_eq!(
        slots,
        [
            Slot::FindExploit,
            Slot::FindExploitPatched,
            Slot::DeployExploit,
            Slot::Login
        ]
    );
    assert!(
        service
            .parameters
            .values()
            .all(|p| *p == Parameter::unknown())
    );
    assert_eq!(service.defenses.patched, Some(Switch::Unknown));
    assert_eq!(service.defenses.protected, None);
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
            status: Evidence::Assumed,
            ttc: Some(Distribution::Exponential(1.0)),
            note: None,
        },
    );
    sshd.parameters.insert(Slot::Extract, Parameter::unknown());
    m.entities.insert(id("sshd"), sshd);
    m.associations.insert(
        "runs".parse().unwrap(),
        Association {
            relation: Relation::Hosts {
                from: id("net"),
                to: id("sshd"),
                privilege: Privilege::Admin,
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
            changes: vec![
                Change::EntityDefense {
                    entity: id("sshd"),
                    defense: Defense::Patched,
                    value: Switch::On,
                },
                Change::EntityDefense {
                    entity: id("sshd"),
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
