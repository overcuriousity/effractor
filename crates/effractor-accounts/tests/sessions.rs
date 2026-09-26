use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use effractor_accounts::users::{self, NewUser};
use effractor_accounts::{Db, sessions};

const DAY: u64 = 86_400;

fn setup() -> (tempfile::TempDir, Db, Arc<AtomicU64>, i64) {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(1_000_000));
    let c = clock.clone();
    let db = Db::open(&dir.path().join("a.db"))
        .unwrap()
        .with_clock(move || c.load(Ordering::Relaxed));
    let id = db
        .write(|t| {
            users::create(
                t,
                &NewUser {
                    name: "alice",
                    display_name: "",
                    password: None,
                },
                0,
            )
        })
        .unwrap();
    (dir, db, clock, id)
}

#[test]
fn a_session_finds_its_user_and_is_kept_only_as_a_hash() {
    let (_d, db, _c, id) = setup();
    let token = db.write(|t| sessions::create(t, id, db.now())).unwrap();
    assert_eq!(sessions::lookup(&db, &token).unwrap().unwrap().id, id);
    let stored: String = db
        .read(|c| Ok(c.query_row("SELECT token_hash FROM sessions", [], |r| r.get(0))?))
        .unwrap();
    assert_ne!(stored, token);
    assert!(sessions::lookup(&db, "not-a-token").unwrap().is_none());
}

#[test]
fn a_session_ends_after_seven_idle_days_or_thirty_days_in_all() {
    let (_d, db, clock, id) = setup();
    let token = db.write(|t| sessions::create(t, id, db.now())).unwrap();
    clock.fetch_add(6 * DAY, Ordering::Relaxed);
    assert!(
        sessions::lookup(&db, &token).unwrap().is_some(),
        "used within a week"
    );
    clock.fetch_add(6 * DAY, Ordering::Relaxed);
    assert!(
        sessions::lookup(&db, &token).unwrap().is_some(),
        "and again"
    );
    clock.fetch_add(8 * DAY, Ordering::Relaxed);
    assert!(
        sessions::lookup(&db, &token).unwrap().is_none(),
        "idle for eight days"
    );

    let token = db.write(|t| sessions::create(t, id, db.now())).unwrap();
    for _ in 0..6 {
        clock.fetch_add(5 * DAY, Ordering::Relaxed);
        let _ = sessions::lookup(&db, &token).unwrap();
    }
    assert!(
        sessions::lookup(&db, &token).unwrap().is_none(),
        "thirty days are the most"
    );
}

#[test]
fn a_disabled_user_has_no_session() {
    let (_d, db, _c, id) = setup();
    let token = db.write(|t| sessions::create(t, id, db.now())).unwrap();
    db.write(|t| Ok(t.execute("UPDATE users SET disabled = 1", [])?))
        .unwrap();
    assert!(sessions::lookup(&db, &token).unwrap().is_none());
}

#[test]
fn revoking_everything_else_keeps_this_session() {
    let (_d, db, _c, id) = setup();
    let this = db.write(|t| sessions::create(t, id, db.now())).unwrap();
    let other = db.write(|t| sessions::create(t, id, db.now())).unwrap();
    db.write(|t| sessions::revoke_all(t, id, Some(&this)))
        .unwrap();
    assert!(sessions::lookup(&db, &this).unwrap().is_some());
    assert!(sessions::lookup(&db, &other).unwrap().is_none());
    db.write(|t| sessions::revoke(t, &this)).unwrap();
    assert!(sessions::lookup(&db, &this).unwrap().is_none());
}

#[test]
fn the_sweep_removes_ended_sessions() {
    let (_d, db, clock, id) = setup();
    db.write(|t| sessions::create(t, id, db.now())).unwrap();
    clock.fetch_add(31 * DAY, Ordering::Relaxed);
    assert_eq!(db.write(|t| sessions::sweep(t, db.now())).unwrap(), 1);
}
