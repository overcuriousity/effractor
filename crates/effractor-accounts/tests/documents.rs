mod fixture;
use effractor_accounts::perms::{self, Role};
use effractor_accounts::shares::{self, Grantee, Target};
use effractor_accounts::{Error, documents, folders};
use fixture::*;

const DAY: u64 = 86_400;

#[test]
fn a_document_is_created_read_and_saved_with_a_version() {
    let (_d, db) = db();
    let alice = user(&db, "alice");
    let id = db
        .write(|t| documents::create(t, alice, None, "Web", "architecture", "effractor: 1\n", 10))
        .unwrap();
    let doc = db.read(|c| documents::get(c, id)).unwrap().unwrap();
    assert_eq!(
        (doc.version, doc.name.as_str(), doc.owner.as_str()),
        (1, "Web", "alice")
    );
    let v = db
        .write(|t| documents::save(t, id, alice, 1, "Web tier", "effractor: 1\nname: x\n", 20))
        .unwrap();
    assert_eq!(v, 2);
    let doc = db.read(|c| documents::get(c, id)).unwrap().unwrap();
    assert_eq!(
        (doc.name.as_str(), doc.updated_at, doc.updated_by.as_deref()),
        ("Web tier", 20, Some("alice"))
    );
}

#[test]
fn a_save_from_an_old_version_is_a_conflict_naming_who_and_when() {
    let (_d, db) = db();
    let (alice, bob) = (user(&db, "alice"), user(&db, "bob"));
    let id = db
        .write(|t| documents::create(t, alice, None, "W", "fault-tree", "a", 10))
        .unwrap();
    db.write(|t| documents::save(t, id, bob, 1, "W", "b", 20))
        .unwrap();
    match db.write(|t| documents::save(t, id, alice, 1, "W", "c", 30)) {
        Err(Error::Conflict(c)) => assert_eq!(
            (c.version, c.updated_by.as_str(), c.updated_at),
            (2, "bob", 20)
        ),
        other => panic!("{other:?}"),
    }
    assert_eq!(
        db.read(|c| documents::get(c, id)).unwrap().unwrap().body,
        "b",
        "nothing overwritten"
    );
}

#[test]
fn bodies_over_a_mebibyte_and_unknown_profiles_are_refused() {
    let (_d, db) = db();
    let alice = user(&db, "alice");
    let big = "x".repeat(documents::MAX_BODY + 1);
    assert!(matches!(
        db.write(|t| documents::create(t, alice, None, "B", "fault-tree", &big, 0)),
        Err(Error::Invalid(_))
    ));
    assert!(
        db.write(|t| documents::create(t, alice, None, "B", "poem", "x", 0))
            .is_err()
    );
}

#[test]
fn folders_nest_to_thirty_two_and_never_into_themselves() {
    let (_d, db) = db();
    let alice = user(&db, "alice");
    let mut parent = None;
    let mut ids = Vec::new();
    for i in 0..32 {
        let id = db
            .write(|t| folders::create(t, alice, parent, &format!("f{i}")))
            .unwrap();
        ids.push(id);
        parent = Some(id);
    }
    assert!(
        db.write(|t| folders::create(t, alice, parent, "too deep"))
            .is_err()
    );
    assert!(
        db.write(|t| folders::move_to(t, alice, ids[0], Some(ids[5])))
            .is_err(),
        "into its own inside"
    );
    let other = db
        .write(|t| folders::create(t, alice, None, "other"))
        .unwrap();
    assert!(
        db.write(|t| folders::move_to(t, alice, ids[0], Some(other)))
            .is_err(),
        "32 levels under a top folder are 33"
    );
    assert!(
        db.write(|t| folders::move_to(t, alice, ids[1], Some(other)))
            .is_ok(),
        "31 under a top folder are 32"
    );
}

#[test]
fn folder_names_are_unique_per_parent_and_only_the_owner_changes_them() {
    let (_d, db) = db();
    let (alice, bob) = (user(&db, "alice"), user(&db, "bob"));
    let a = db
        .write(|t| folders::create(t, alice, None, "Plans"))
        .unwrap();
    assert!(matches!(
        db.write(|t| folders::create(t, alice, None, "plans")),
        Err(Error::Exists)
    ));
    assert!(matches!(
        db.write(|t| folders::rename(t, bob, a, "Mine")),
        Err(Error::NotFound)
    ));
    assert!(
        db.write(|t| folders::create(t, bob, Some(a), "Inside alice's"))
            .is_err()
    );
}

#[test]
fn restoring_a_folder_restores_what_was_inside_and_its_shares() {
    let (_d, db) = db();
    let (alice, bob) = (user(&db, "alice"), user(&db, "bob"));
    let red = group(&db, "red", &[bob]);
    let a = db.write(|t| folders::create(t, alice, None, "A")).unwrap();
    let b = db
        .write(|t| folders::create(t, alice, Some(a), "B"))
        .unwrap();
    let d = db
        .write(|t| documents::create(t, alice, Some(b), "D", "fault-tree", "x", 0))
        .unwrap();
    db.write(|t| shares::grant(t, Target::Folder(a), Grantee::Group(red), Role::Editor, 0))
        .unwrap();
    db.write(|t| folders::delete(t, alice, a, 100)).unwrap();
    assert_eq!(db.read(|c| perms::document_role(c, bob, d)).unwrap(), None);
    assert!(
        db.read(|c| perms::visible(c, alice, None))
            .unwrap()
            .documents
            .is_empty()
    );
    db.write(|t| folders::restore(t, alice, a)).unwrap();
    assert_eq!(
        db.read(|c| perms::document_role(c, bob, d)).unwrap(),
        Some(Role::Editor)
    );
}

/// A folder whose name was taken while it was deleted comes back under a
/// free one, with what was in it, instead of not at all.
#[test]
fn a_folder_whose_name_was_taken_comes_back_under_a_free_one() {
    let (_d, db) = db();
    let alice = user(&db, "alice");
    let name_of = |id| {
        db.read(|c| perms::visible(c, alice, None))
            .unwrap()
            .folders
            .into_iter()
            .find(|f| f.id == id)
            .map(|f| (f.name, f.parent))
    };
    let a = db
        .write(|t| folders::create(t, alice, None, "Projects"))
        .unwrap();
    let d = db
        .write(|t| documents::create(t, alice, Some(a), "D", "fault-tree", "x", 0))
        .unwrap();
    db.write(|t| folders::delete(t, alice, a, 100)).unwrap();
    db.write(|t| folders::create(t, alice, None, "projects"))
        .unwrap();
    db.write(|t| folders::create(t, alice, None, "Projects (2)"))
        .unwrap();
    db.write(|t| folders::restore(t, alice, a)).unwrap();
    assert_eq!(name_of(a), Some(("Projects (3)".into(), None)));
    assert!(db.read(|c| documents::get(c, d)).unwrap().is_some());

    // A subfolder whose folder is gone lands at the root, where the name
    // may be taken too.
    let p = db.write(|t| folders::create(t, alice, None, "P")).unwrap();
    let b = db
        .write(|t| folders::create(t, alice, Some(p), "Projects"))
        .unwrap();
    db.write(|t| folders::delete(t, alice, b, 200)).unwrap();
    db.write(|t| folders::delete(t, alice, p, 300)).unwrap();
    db.write(|t| folders::restore(t, alice, b)).unwrap();
    assert_eq!(name_of(b), Some(("Projects (4)".into(), None)));
}

#[test]
fn a_document_deleted_on_its_own_stays_deleted_when_its_folder_comes_back() {
    let (_d, db) = db();
    let alice = user(&db, "alice");
    let a = db.write(|t| folders::create(t, alice, None, "A")).unwrap();
    let d = db
        .write(|t| documents::create(t, alice, Some(a), "D", "fault-tree", "x", 0))
        .unwrap();
    db.write(|t| documents::delete(t, alice, d, 50)).unwrap();
    db.write(|t| folders::delete(t, alice, a, 100)).unwrap();
    db.write(|t| folders::restore(t, alice, a)).unwrap();
    assert!(db.read(|c| documents::get(c, d)).unwrap().is_none());
}

#[test]
fn deleted_items_are_purged_after_seven_days_with_their_shares() {
    let (_d, db) = db();
    let (alice, bob) = (user(&db, "alice"), user(&db, "bob"));
    let d = db
        .write(|t| documents::create(t, alice, None, "D", "fault-tree", "x", 0))
        .unwrap();
    db.write(|t| shares::grant(t, Target::Document(d), Grantee::User(bob), Role::Viewer, 0))
        .unwrap();
    db.write(|t| documents::delete(t, alice, d, 1_000)).unwrap();
    assert_eq!(
        db.write(|t| documents::purge(t, 1_000 + 7 * DAY - 1))
            .unwrap(),
        0
    );
    assert_eq!(
        db.write(|t| documents::purge(t, 1_000 + 7 * DAY)).unwrap(),
        1
    );
    let left: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM shares", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(left, 0);
    assert!(db.write(|t| documents::restore(t, alice, d)).is_err());
}

#[test]
fn recent_keeps_the_last_five_opened() {
    let (_d, db) = db();
    let alice = user(&db, "alice");
    let ids: Vec<_> = (0..7)
        .map(|i| {
            db.write(|t| documents::create(t, alice, None, &format!("d{i}"), "fault-tree", "x", 0))
                .unwrap()
        })
        .collect();
    for (i, id) in ids.iter().enumerate() {
        db.write(|t| documents::opened(t, alice, *id, i as u64))
            .unwrap();
    }
    db.write(|t| documents::opened(t, alice, ids[0], 100))
        .unwrap();
    assert_eq!(
        db.read(|c| documents::recent(c, alice)).unwrap(),
        vec![ids[0], ids[6], ids[5], ids[4], ids[3]]
    );
}

#[test]
fn folder_names_and_search_fold_case_beyond_ascii() {
    let (_d, db) = db();
    let alice = user(&db, "alice");
    db.write(|t| folders::create(t, alice, None, "Äpfel"))
        .unwrap();
    assert!(matches!(
        db.write(|t| folders::create(t, alice, None, "äpfel")),
        Err(Error::Exists)
    ));
    let d = db
        .write(|t| documents::create(t, alice, None, "Übersicht", "fault-tree", "Straße", 0))
        .unwrap();
    let hit = |q: &str| {
        db.read(|c| perms::visible(c, alice, Some(q)))
            .unwrap()
            .documents
            .iter()
            .map(|x| x.id)
            .collect::<Vec<_>>()
    };
    assert_eq!(hit("ÜBERSICHT"), vec![d], "names");
    assert_eq!(hit("STRASSE").len(), 0, "no ß→ss folding promised");
    assert_eq!(hit("STRAßE"), vec![d], "content");
}
