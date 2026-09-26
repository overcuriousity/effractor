use std::io::Write;
use std::process::{Command, Stdio};

fn effractor(db: &std::path::Path, args: &[&str], stdin: &str) -> (bool, String, String) {
    let mut child = Command::new(env!("CARGO_BIN_EXE_effractor"))
        .arg("user")
        .args(args)
        .arg("--accounts")
        .arg(db)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(stdin.as_bytes())
        .unwrap();
    let out = child.wait_with_output().unwrap();
    (
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).into_owned(),
        String::from_utf8_lossy(&out.stderr).into_owned(),
    )
}

#[test]
fn a_fresh_server_is_set_up_from_the_shell() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("effractor.db");
    let (ok, _, err) = effractor(&db, &["add", "alice"], "correct horse battery\n");
    assert!(ok, "{err}");
    let (ok, _, err) = effractor(&db, &["promote", "Alice"], "");
    assert!(ok, "{err}");
    let (ok, out, _) = effractor(&db, &["list"], "");
    assert!(ok);
    let line = out
        .lines()
        .find(|l| l.starts_with("alice"))
        .expect("alice listed");
    assert!(line.contains("admin"), "{line}");
    assert!(line.contains("password"), "{line}");
}

#[test]
fn the_last_admin_cannot_be_demoted_and_short_passwords_are_refused() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("effractor.db");
    effractor(&db, &["add", "root"], "correct horse battery\n");
    effractor(&db, &["promote", "root"], "");
    let (ok, _, err) = effractor(&db, &["demote", "root"], "");
    assert!(!ok);
    assert!(err.contains("last admin"), "{err}");
    let (ok, _, err) = effractor(&db, &["add", "bob"], "short\n");
    assert!(!ok);
    assert!(err.contains("12"), "{err}");
    let (ok, _, err) = effractor(&db, &["promote", "nobody"], "");
    assert!(!ok);
    assert!(err.contains("no user"), "{err}");
}

#[test]
fn passwd_changes_the_password() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("effractor.db");
    effractor(&db, &["add", "root"], "correct horse battery\n");
    let (ok, _, err) = effractor(&db, &["passwd", "root"], "another long password\n");
    assert!(ok, "{err}");
    let db = effractor_accounts::Db::open(&db).unwrap();
    assert!(
        db.read(|c| effractor_accounts::users::login(c, "root", "another long password"))
            .unwrap()
            .is_some()
    );
}

/// OIDC needs the public url (the issuer sends people back to it) and a
/// secret; the server says so and does not start.
#[test]
fn oidc_without_a_public_url_or_a_secret_does_not_start() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("effractor.db");
    for (extra, why) in [
        (vec!["--oidc-client-id", "effractor"], "--public-url"),
        (
            vec![
                "--oidc-client-id",
                "effractor",
                "--public-url",
                "https://e.example",
            ],
            "secret",
        ),
    ] {
        let out = Command::new(env!("CARGO_BIN_EXE_effractor"))
            .args([
                "--bind",
                "127.0.0.1:0",
                "--oidc-issuer",
                "https://cloud.example",
            ])
            .args(&extra)
            .arg("--accounts")
            .arg(&db)
            .env_remove("EFFRACTOR_OIDC_SECRET")
            .output()
            .unwrap();
        assert!(!out.status.success(), "started without {why}");
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains(why), "{err}");
    }
}
