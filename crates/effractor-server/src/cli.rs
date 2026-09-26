//! `effractor user …`: the shell's way in (spec §3). Safe beside a running
//! server: SQLite in WAL takes a second writer in turn.

use std::io::{BufRead, IsTerminal};
use std::path::Path;

use anyhow::{Context, bail};
use clap::Subcommand;
use effractor_accounts::users::{self, NewUser};
use effractor_accounts::{Db, Error, groups};

#[derive(Subcommand)]
pub enum UserCommand {
    /// Every user: name, login methods, admin, disabled, groups.
    List,
    /// A new password user; asks for the password.
    Add { name: String },
    /// Make an admin.
    Promote { name: String },
    /// No longer an admin; never the last one.
    Demote { name: String },
    /// Set a new password; asks for it.
    Passwd { name: String },
}

fn password() -> anyhow::Result<String> {
    if !std::io::stdin().is_terminal() {
        let mut line = String::new();
        std::io::stdin().lock().read_line(&mut line)?;
        return Ok(line.trim_end_matches(['\r', '\n']).to_owned());
    }
    let first = rpassword::prompt_password("Password: ")?;
    let again = rpassword::prompt_password("Again: ")?;
    if first != again {
        bail!("the two passwords differ");
    }
    Ok(first)
}

fn find(db: &Db, name: &str) -> anyhow::Result<users::User> {
    db.read(|c| users::by_name(c, name))?
        .with_context(|| format!("no user {name:?}"))
}

fn plain(err: Error) -> anyhow::Error {
    match err {
        Error::Refused(why) => anyhow::anyhow!("{why}"),
        Error::Invalid(why) => anyhow::anyhow!("{why}"),
        Error::Exists => anyhow::anyhow!("that name is taken"),
        other => other.into(),
    }
}

/// Made by root in a directory the service owns, the database is read-only
/// for the service: every login would fail.
#[cfg(unix)]
fn warn_on_owner(path: &Path) {
    use std::os::unix::fs::MetadataExt;
    let dir = match path.parent() {
        Some(p) if !p.as_os_str().is_empty() => p,
        _ => Path::new("."),
    };
    if let (Ok(file), Ok(dir_meta)) = (std::fs::metadata(path), std::fs::metadata(dir))
        && file.uid() != dir_meta.uid()
    {
        eprintln!(
            "warning: {} belongs to user id {}, its directory to user id {}; \
             a server running as the directory's owner cannot write it \
             (run this as that user, e.g. sudo -u effractor)",
            path.display(),
            file.uid(),
            dir_meta.uid()
        );
    }
}

#[cfg(not(unix))]
fn warn_on_owner(_: &Path) {}

pub fn run_user(path: &Path, command: UserCommand) -> anyhow::Result<()> {
    // A mistyped path must not quietly become a new, empty database.
    let creating = !path.exists();
    if creating && !matches!(command, UserCommand::Add { .. }) {
        bail!("no database at {}", path.display());
    }
    let db = Db::open(path).with_context(|| format!("opening {}", path.display()))?;
    if creating {
        println!("created {}", path.display());
    }
    warn_on_owner(path);
    match command {
        UserCommand::List => {
            let rows: Vec<(users::User, users::Methods, Vec<String>)> = db.read(|c| {
                let mut out = Vec::new();
                for u in users::all(c)? {
                    let m = users::login_methods(c, u.id)?;
                    let groups = groups::of_user(c, u.id)?
                        .into_iter()
                        .map(|g| match g.role.as_str() {
                            "admin" => format!("{} (admin)", g.name),
                            _ => g.name,
                        })
                        .collect();
                    out.push((u, m, groups));
                }
                Ok(out)
            })?;
            for (u, m, groups) in rows {
                let mut methods = Vec::new();
                if m.password {
                    methods.push("password".to_owned());
                }
                if m.passkeys > 0 {
                    methods.push(format!("{} passkey(s)", m.passkeys));
                }
                if m.oidc {
                    methods.push("oidc".to_owned());
                }
                let flags = [u.admin.then_some("admin"), u.disabled.then_some("disabled")]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" ");
                println!(
                    "{}\t{}\t{}\t{}",
                    u.name,
                    methods.join(", "),
                    flags,
                    groups.join(", ")
                );
            }
        }
        UserCommand::Add { name } => {
            let pw = password()?;
            let now = db.now();
            db.write(|t| {
                users::create(
                    t,
                    &NewUser {
                        name: &name,
                        display_name: "",
                        password: Some(&pw),
                    },
                    now,
                )
            })
            .map_err(plain)?;
            println!("added {name}");
        }
        UserCommand::Promote { name } => {
            let u = find(&db, &name)?;
            db.write(|t| users::set_admin(t, u.id, true))
                .map_err(plain)?;
            println!("{} is an admin", u.name);
        }
        UserCommand::Demote { name } => {
            let u = find(&db, &name)?;
            db.write(|t| users::set_admin(t, u.id, false))
                .map_err(plain)?;
            println!("{} is no longer an admin", u.name);
        }
        UserCommand::Passwd { name } => {
            let u = find(&db, &name)?;
            let pw = password()?;
            db.write(|t| {
                users::set_password(t, u.id, Some(&pw))?;
                effractor_accounts::sessions::revoke_all(t, u.id, None)
            })
            .map_err(plain)?;
            println!("password changed; {} is logged out everywhere", u.name);
        }
    }
    Ok(())
}
