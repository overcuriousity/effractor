mod fixture;
use effractor_accounts::perms::Role;
use effractor_accounts::shares::{self, Grantee, Target};
use effractor_accounts::{Error, groups};
use fixture::*;

#[test]
fn groups_hold_members_with_roles_and_names_are_unique() {
    let (_d, db) = db();
    let (a, b) = (user(&db, "alice"), user(&db, "bob"));
    let g = db.write(|t| groups::create(t, "Red team")).unwrap();
    assert!(matches!(
        db.write(|t| groups::create(t, "red TEAM")),
        Err(Error::Exists)
    ));
    db.write(|t| groups::set_member(t, g, a, "admin")).unwrap();
    db.write(|t| groups::set_member(t, g, b, "member")).unwrap();
    db.write(|t| groups::set_member(t, g, b, "member")).unwrap();
    assert!(db.write(|t| groups::set_member(t, g, b, "owner")).is_err());
    let list = db.read(|c| groups::list(c, None)).unwrap();
    assert_eq!(
        list[0]
            .members
            .iter()
            .map(|m| (m.name.as_str(), m.role.as_str()))
            .collect::<Vec<_>>(),
        vec![("alice", "admin"), ("bob", "member")]
    );
    assert_eq!(db.read(|c| groups::administered(c, a)).unwrap(), vec![g]);
    assert!(db.read(|c| groups::administered(c, b)).unwrap().is_empty());
}

#[test]
fn deleting_a_group_ends_its_shares() {
    let (_d, db) = db();
    let (a, b) = (user(&db, "alice"), user(&db, "bob"));
    let g = db.write(|t| groups::create(t, "red")).unwrap();
    db.write(|t| groups::set_member(t, g, b, "member")).unwrap();
    let d = doc(&db, a, None, "x");
    db.write(|t| shares::grant(t, Target::Document(d), Grantee::Group(g), Role::Viewer, 0))
        .unwrap();
    db.write(|t| groups::delete(t, g)).unwrap();
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM shares", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn group_names_fold_case_beyond_ascii() {
    let (_d, db) = db();
    db.write(|t| groups::create(t, "Öffentlich")).unwrap();
    assert!(matches!(
        db.write(|t| groups::create(t, "öffentlich")),
        Err(Error::Exists)
    ));
}
