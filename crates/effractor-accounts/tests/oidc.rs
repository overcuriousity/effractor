mod fixture;
use effractor_accounts::{Error, oidc, users};
use fixture::*;

const ISS: &str = "https://cloud.example";

#[test]
fn a_first_login_provisions_a_user_in_no_group_and_a_taken_name_gets_a_number() {
    let (_d, db) = db();
    user(&db, "alice"); // a password user who happens to be called alice
    let id = db
        .write(|t| oidc::provision(t, ISS, "sub-1", Some("alice"), "Alice N.", 0))
        .unwrap();
    let u = db.read(|c| users::get(c, id)).unwrap().unwrap();
    assert_eq!(
        u.name, "alice-2",
        "never linked to the existing alice by name"
    );
    assert_eq!(u.display_name, "Alice N.");
    assert!(!u.has_password);
    let groups: i64 = db
        .read(|c| {
            Ok(c.query_row(
                "SELECT count(*) FROM memberships WHERE user_id = ?1",
                [id],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(groups, 0);
    assert_eq!(db.read(|c| oidc::find(c, ISS, "sub-1")).unwrap(), Some(id));
    let again = db
        .write(|t| oidc::provision(t, ISS, "sub-2", Some("alice"), "", 0))
        .unwrap();
    assert_eq!(
        db.read(|c| users::get(c, again)).unwrap().unwrap().name,
        "alice-3"
    );
}

#[test]
fn odd_usernames_become_allowed_names() {
    assert_eq!(oidc::name_from(Some("Jörg Müller")), "JörgMüller");
    assert_eq!(oidc::name_from(Some("  ")), "user");
    assert_eq!(oidc::name_from(None), "user");
    assert_eq!(oidc::name_from(Some(&"x".repeat(100))).chars().count(), 60);
}

#[test]
fn linking_takes_an_identity_once_and_the_last_way_in_stays() {
    let (_d, db) = db();
    let (a, b) = (user(&db, "a"), user(&db, "b"));
    db.write(|t| oidc::link(t, a, ISS, "sub-a")).unwrap();
    assert!(matches!(
        db.write(|t| oidc::link(t, b, ISS, "sub-a")),
        Err(Error::Exists)
    ));
    assert!(
        matches!(db.write(|t| oidc::unlink(t, a)), Err(Error::Refused(_))),
        "a has no password"
    );
    db.write(|t| users::set_password(t, a, Some("correct horse battery")))
        .unwrap();
    db.write(|t| oidc::unlink(t, a)).unwrap();
    assert_eq!(db.read(|c| oidc::find(c, ISS, "sub-a")).unwrap(), None);
}
