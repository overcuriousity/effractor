use effractor_accounts::{Db, Error, SCHEMA_VERSION};

fn temp() -> (tempfile::TempDir, std::path::PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("effractor.db");
    (dir, path)
}

#[test]
fn a_new_database_is_created_in_wal_with_the_schema() {
    let (_dir, path) = temp();
    let db = Db::open(&path).unwrap();
    let (mode, version, fk): (String, i64, i64) = db
        .read(|c| {
            Ok((
                c.query_row("PRAGMA journal_mode", [], |r| r.get(0))?,
                c.query_row("PRAGMA user_version", [], |r| r.get(0))?,
                c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?,
            ))
        })
        .unwrap();
    assert_eq!(mode, "wal");
    assert_eq!(version, SCHEMA_VERSION);
    assert_eq!(fk, 1);
    for table in [
        "users",
        "oidc_identities",
        "passkeys",
        "sessions",
        "groups",
        "memberships",
        "folders",
        "documents",
        "shares",
        "recent",
    ] {
        let n: i64 = db
            .read(|c| {
                Ok(c.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
                    [table],
                    |r| r.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(n, 1, "{table}");
    }
}

#[test]
fn opening_again_keeps_what_is_there() {
    let (_dir, path) = temp();
    Db::open(&path)
        .unwrap()
        .write(|t| {
            Ok(t.execute(
                "INSERT INTO groups (name, name_key) VALUES ('red', 'red')",
                [],
            )?)
        })
        .unwrap();
    let n: i64 = Db::open(&path)
        .unwrap()
        .read(|c| Ok(c.query_row("SELECT count(*) FROM groups", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 1);
}

#[test]
fn a_database_newer_than_this_build_is_refused() {
    let (_dir, path) = temp();
    Db::open(&path)
        .unwrap()
        .write(|t| Ok(t.pragma_update(None, "user_version", SCHEMA_VERSION + 1)?))
        .unwrap();
    assert!(matches!(Db::open(&path), Err(Error::TooNew { .. })));
}

#[test]
fn a_failed_write_leaves_nothing_behind() {
    let (_dir, path) = temp();
    let db = Db::open(&path).unwrap();
    let _ = db.write(|t| {
        t.execute(
            "INSERT INTO groups (name, name_key) VALUES ('red', 'red')",
            [],
        )?;
        Err::<(), _>(Error::Refused("no"))
    });
    let n: i64 = db
        .read(|c| Ok(c.query_row("SELECT count(*) FROM groups", [], |r| r.get(0))?))
        .unwrap();
    assert_eq!(n, 0);
}

#[test]
fn tokens_are_22_url_safe_characters_and_differ() {
    let a = effractor_accounts::token();
    let b = effractor_accounts::token();
    assert_eq!(a.len(), 22);
    assert!(
        a.bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    );
    assert_ne!(a, b);
    assert_eq!(effractor_accounts::hash_token(&a).len(), 64);
}

/// Made by root for a service that runs as another user: refused at once,
/// not a server whose every login fails.
#[cfg(unix)]
#[test]
fn a_database_this_user_cannot_write_is_refused_by_name() {
    use std::os::unix::fs::PermissionsExt;
    let (_dir, path) = temp();
    drop(Db::open(&path).unwrap());
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o444)).unwrap();
    if std::fs::OpenOptions::new().write(true).open(&path).is_ok() {
        return; // root writes anything
    }
    let err = Db::open(&path).err().expect("refused");
    assert!(matches!(err, Error::ReadOnly(_)), "{err:?}");
    assert!(err.to_string().contains(&path.display().to_string()));
    assert!(err.to_string().contains("sudo -u effractor"));
}
