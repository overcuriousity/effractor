mod fixture;
use effractor_accounts::perms::{self, Role};
use effractor_accounts::shares::{self, Grantee, Target};
use fixture::*;

#[test]
fn the_permission_table() {
    let (_d, db) = db();
    let (alice, bob, carol, dave) = (
        user(&db, "alice"),
        user(&db, "bob"),
        user(&db, "carol"),
        user(&db, "dave"),
    );
    let red = group(&db, "red", &[carol]);
    let a = folder(&db, alice, None, "A");
    let b = folder(&db, alice, Some(a), "B");
    let c = folder(&db, alice, Some(b), "C");
    let d1 = doc(&db, alice, Some(c), "deep");
    let d2 = doc(&db, alice, None, "loose");
    db.write(|t| {
        shares::grant(t, Target::Folder(a), Grantee::User(bob), Role::Viewer, 0)?;
        shares::grant(t, Target::Document(d1), Grantee::User(bob), Role::Editor, 0)?;
        shares::grant(t, Target::Folder(b), Grantee::Group(red), Role::Editor, 0)
    })
    .unwrap();
    let role = |u, d| db.read(|c| perms::document_role(c, u, d)).unwrap();
    let cases = [
        (alice, d1, Some(Role::Owner), "the owner"),
        (
            bob,
            d1,
            Some(Role::Editor),
            "a direct share beats the folder's viewer",
        ),
        (bob, d2, None, "nothing shared"),
        (
            carol,
            d1,
            Some(Role::Editor),
            "through a group, two folders up",
        ),
        (dave, d1, None, "in no group, no share"),
    ];
    for (u, d, want, why) in cases {
        assert_eq!(role(u, d), want, "{why}");
    }
    assert_eq!(
        db.read(|c| perms::folder_role(c, bob, c_id(c, "C")))
            .unwrap(),
        Some(Role::Viewer)
    );

    db.write(|t| Ok(t.execute("UPDATE documents SET deleted_at = 1 WHERE id = ?1", [d1])?))
        .unwrap();
    assert_eq!(role(bob, d1), None, "deleted is gone for everyone else");
    assert_eq!(
        role(alice, d1),
        Some(Role::Owner),
        "the owner may restore it"
    );
}

fn c_id(c: &effractor_accounts::Connection, name: &str) -> i64 {
    c.query_row("SELECT id FROM folders WHERE name = ?1", [name], |r| {
        r.get(0)
    })
    .unwrap()
}

#[test]
fn a_disabled_owners_documents_stay_shared() {
    let (_d, db) = db();
    let (alice, bob) = (user(&db, "alice"), user(&db, "bob"));
    let d = doc(&db, alice, None, "x");
    db.write(|t| shares::grant(t, Target::Document(d), Grantee::User(bob), Role::Viewer, 0))
        .unwrap();
    db.write(|t| Ok(t.execute("UPDATE users SET disabled = 1 WHERE id = ?1", [alice])?))
        .unwrap();
    assert_eq!(
        db.read(|c| perms::document_role(c, bob, d)).unwrap(),
        Some(Role::Viewer)
    );
}

#[test]
fn visible_lists_own_and_shared_with_the_strongest_role_and_searches() {
    let (_d, db) = db();
    let (alice, bob) = (user(&db, "alice"), user(&db, "bob"));
    let team = group(&db, "team", &[bob]);
    let a = folder(&db, alice, None, "Plans");
    let inner = folder(&db, alice, Some(a), "Inner");
    let d = doc(&db, alice, Some(inner), "Web tier");
    let mine = doc(&db, bob, None, "Bob's own");
    db.write(|t| {
        shares::grant(t, Target::Folder(a), Grantee::User(bob), Role::Viewer, 0)?;
        shares::grant(t, Target::Folder(a), Grantee::Group(team), Role::Editor, 0)
    })
    .unwrap();
    let v = db.read(|c| perms::visible(c, bob, None)).unwrap();
    let names: Vec<_> = v
        .folders
        .iter()
        .map(|f| (f.name.as_str(), f.role))
        .collect();
    assert!(names.contains(&("Plans", Role::Editor)));
    assert!(
        names.contains(&("Inner", Role::Editor)),
        "a shared folder's inside is shared"
    );
    let docs: Vec<_> = v
        .documents
        .iter()
        .map(|x| (x.id, x.role, x.owner.as_str()))
        .collect();
    assert!(docs.contains(&(d, Role::Editor, "alice")));
    assert!(docs.contains(&(mine, Role::Owner, "bob")));

    let hit = db.read(|c| perms::visible(c, bob, Some("WEB"))).unwrap();
    assert_eq!(
        hit.documents.iter().map(|x| x.id).collect::<Vec<_>>(),
        vec![d],
        "case-insensitive, names"
    );
    db.write(|t| {
        Ok(t.execute(
            "UPDATE documents SET body = 'firewall: dmz' WHERE id = ?1",
            [mine],
        )?)
    })
    .unwrap();
    let hit = db.read(|c| perms::visible(c, bob, Some("dmz"))).unwrap();
    assert_eq!(
        hit.documents.iter().map(|x| x.id).collect::<Vec<_>>(),
        vec![mine],
        "and content"
    );
    let none = db
        .read(|c| perms::visible(c, user(&db, "eve"), Some("web")))
        .unwrap();
    assert!(
        none.documents.is_empty(),
        "search never reaches what one cannot read"
    );
}

#[test]
fn a_share_changes_role_in_place_and_owner_is_not_grantable() {
    let (_d, db) = db();
    let (alice, bob) = (user(&db, "alice"), user(&db, "bob"));
    let d = doc(&db, alice, None, "x");
    let s1 = db
        .write(|t| shares::grant(t, Target::Document(d), Grantee::User(bob), Role::Viewer, 0))
        .unwrap();
    let s2 = db
        .write(|t| shares::grant(t, Target::Document(d), Grantee::User(bob), Role::Editor, 0))
        .unwrap();
    assert_eq!(s1, s2);
    assert_eq!(
        db.read(|c| shares::list(c, Target::Document(d))).unwrap()[0].role,
        Role::Editor
    );
    assert!(
        db.write(|t| shares::grant(t, Target::Document(d), Grantee::User(bob), Role::Owner, 0))
            .is_err()
    );
    assert!(
        db.write(|t| shares::grant(
            t,
            Target::Document(d),
            Grantee::User(alice),
            Role::Viewer,
            0
        ))
        .is_err()
    );
    db.write(|t| shares::revoke(t, s1)).unwrap();
    assert_eq!(db.read(|c| perms::document_role(c, bob, d)).unwrap(), None);
}
