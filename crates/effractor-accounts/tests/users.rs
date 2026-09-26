use effractor_accounts::users::{self, NewUser};
use effractor_accounts::{Db, Error};

fn db() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(&dir.path().join("a.db"))
        .unwrap()
        .with_clock(|| 1_000);
    (dir, db)
}

fn add(db: &Db, name: &str, pw: Option<&str>) -> i64 {
    db.write(|t| {
        users::create(
            t,
            &NewUser {
                name,
                display_name: "",
                password: pw,
            },
            1_000,
        )
    })
    .unwrap()
}

const PW: &str = "correct horse battery";

#[test]
fn a_user_logs_in_with_their_password_and_not_another() {
    let (_d, db) = db();
    add(&db, "alice", Some(PW));
    assert!(db.read(|c| users::login(c, "alice", PW)).unwrap().is_some());
    assert!(
        db.read(|c| users::login(c, "alice", "wrong password!!"))
            .unwrap()
            .is_none()
    );
    assert!(
        db.read(|c| users::login(c, "nobody", PW))
            .unwrap()
            .is_none()
    );
}

#[test]
fn names_are_one_user_whatever_their_case() {
    let (_d, db) = db();
    add(&db, "Alice", Some(PW));
    assert!(db.read(|c| users::login(c, "alice", PW)).unwrap().is_some());
    assert!(db.read(|c| users::by_name(c, "ALICE")).unwrap().is_some());
    let again = db.write(|t| {
        users::create(
            t,
            &NewUser {
                name: "alice",
                display_name: "",
                password: None,
            },
            1,
        )
    });
    assert!(matches!(again, Err(Error::Exists)));
}

#[test]
fn the_password_is_stored_as_argon2id_never_as_given() {
    let (_d, db) = db();
    let id = add(&db, "alice", Some(PW));
    let hash: String = db
        .read(|c| {
            Ok(
                c.query_row("SELECT password_hash FROM users WHERE id = ?1", [id], |r| {
                    r.get(0)
                })?,
            )
        })
        .unwrap();
    assert!(hash.starts_with("$argon2id$"), "{hash}");
    assert!(!hash.contains(PW));
}

#[test]
fn short_passwords_and_odd_names_are_refused() {
    assert!(users::check_password("eleven chars").is_ok());
    assert!(matches!(
        users::check_password("elevenchars"),
        Err(Error::Invalid(_))
    ));
    assert_eq!(users::check_name("  bob ").unwrap(), "bob");
    for bad in ["", "a b", "x/y", &"n".repeat(65)] {
        assert!(users::check_name(bad).is_err(), "{bad:?}");
    }
}

#[test]
fn a_disabled_user_cannot_log_in() {
    let (_d, db) = db();
    let id = add(&db, "alice", Some(PW));
    add(&db, "root", Some(PW));
    db.write(|t| users::set_admin(t, id + 1, true)).unwrap();
    db.write(|t| users::set_disabled(t, id, true)).unwrap();
    assert!(db.read(|c| users::login(c, "alice", PW)).unwrap().is_none());
}

#[test]
fn the_last_admin_stays_an_admin() {
    let (_d, db) = db();
    let a = add(&db, "a", None);
    let b = add(&db, "b", None);
    db.write(|t| users::set_admin(t, a, true)).unwrap();
    for refused in [
        db.write(|t| users::set_admin(t, a, false)),
        db.write(|t| users::set_disabled(t, a, true)),
        db.write(|t| users::delete(t, a)),
    ] {
        assert!(matches!(refused, Err(Error::Refused(_))));
    }
    db.write(|t| users::set_admin(t, b, true)).unwrap();
    db.write(|t| users::set_admin(t, a, false)).unwrap();
}

#[test]
fn a_user_without_a_password_cannot_log_in_with_one() {
    let (_d, db) = db();
    add(&db, "oidc-only", None);
    assert!(
        db.read(|c| users::login(c, "oidc-only", ""))
            .unwrap()
            .is_none()
    );
    let m = db.read(|c| users::login_methods(c, 1)).unwrap();
    assert!(!m.password);
}

#[test]
fn names_fold_case_beyond_ascii() {
    let (_d, db) = db();
    add(&db, "Ärger", Some(PW));
    assert!(db.read(|c| users::login(c, "ärger", PW)).unwrap().is_some());
    assert!(db.read(|c| users::by_name(c, "ÄRGER")).unwrap().is_some());
    let again = db.write(|t| {
        users::create(
            t,
            &NewUser {
                name: "ärger",
                display_name: "",
                password: None,
            },
            1,
        )
    });
    assert!(matches!(again, Err(Error::Exists)));
}
