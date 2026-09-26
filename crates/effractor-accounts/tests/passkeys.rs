mod fixture;
use effractor_accounts::{Error, passkeys, users};
use fixture::*;

#[test]
fn passkeys_are_kept_listed_found_by_handle_and_the_last_way_in_stays() {
    let (_d, db) = db();
    let alice = user(&db, "alice"); // no password
    let id = db
        .write(|t| passkeys::add(t, alice, b"cred-1", "{}", "Laptop", 5))
        .unwrap();
    assert_eq!(
        db.read(|c| passkeys::list(c, alice)).unwrap()[0].label,
        "Laptop"
    );
    let handle = db
        .read(|c| users::get(c, alice))
        .unwrap()
        .unwrap()
        .webauthn_id;
    assert_eq!(
        db.read(|c| passkeys::user_by_handle(c, &handle))
            .unwrap()
            .unwrap()
            .id,
        alice
    );
    assert!(matches!(
        db.write(|t| passkeys::remove(t, alice, id)),
        Err(Error::Refused(_))
    ));
    db.write(|t| users::set_password(t, alice, Some("correct horse battery")))
        .unwrap();
    db.write(|t| passkeys::remove(t, alice, id)).unwrap();
    assert!(
        db.write(|t| passkeys::add(t, alice, b"cred-1", "{}", "Again", 6))
            .is_ok()
    );
    assert!(matches!(
        db.write(|t| passkeys::add(t, alice, b"cred-1", "{}", "Twice", 7)),
        Err(Error::Exists)
    ));
}
