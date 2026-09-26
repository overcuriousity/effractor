//! OIDC identities (spec §7.2). An identity is (issuer, subject), never a name
//! or an email: an account is linked only by its owner, while logged in.

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::users::{self, NewUser};
use crate::{Error, Id, Result, Timestamp};

pub fn find(c: &Connection, issuer: &str, subject: &str) -> Result<Option<Id>> {
    Ok(c.query_row(
        "SELECT user_id FROM oidc_identities WHERE issuer = ?1 AND subject = ?2",
        params![issuer, subject],
        |r| r.get(0),
    )
    .optional()?)
}

pub fn link(t: &Transaction, user: Id, issuer: &str, subject: &str) -> Result<()> {
    if let Some(other) = find(t, issuer, subject)? {
        return if other == user {
            Ok(())
        } else {
            Err(Error::Exists)
        };
    }
    t.execute(
        "DELETE FROM oidc_identities WHERE user_id = ?1 AND issuer = ?2",
        params![user, issuer],
    )?;
    t.execute(
        "INSERT INTO oidc_identities (issuer, subject, user_id) VALUES (?1, ?2, ?3)",
        params![issuer, subject, user],
    )?;
    Ok(())
}

pub fn unlink(t: &Transaction, user: Id) -> Result<()> {
    let m = users::login_methods(t, user)?;
    if !m.password && m.passkeys == 0 {
        return Err(Error::Refused("the last way to log in stays"));
    }
    t.execute("DELETE FROM oidc_identities WHERE user_id = ?1", [user])?;
    Ok(())
}

pub fn name_from(preferred: Option<&str>) -> String {
    let cleaned: String = preferred
        .unwrap_or("")
        .chars()
        .filter(|c| c.is_alphanumeric() || "._-@".contains(*c))
        .take(60)
        .collect();
    if cleaned.is_empty() {
        "user".to_owned()
    } else {
        cleaned
    }
}

pub fn provision(
    t: &Transaction,
    issuer: &str,
    subject: &str,
    preferred: Option<&str>,
    display: &str,
    now: Timestamp,
) -> Result<Id> {
    let base = name_from(preferred);
    let mut n = 1;
    let id = loop {
        let name = if n == 1 {
            base.clone()
        } else {
            format!("{base}-{n}")
        };
        match users::create(
            t,
            &NewUser {
                name: &name,
                display_name: display,
                password: None,
            },
            now,
        ) {
            Ok(id) => break id,
            Err(Error::Exists) if n < 1000 => n += 1,
            Err(e) => return Err(e),
        }
    };
    link(t, id, issuer, subject)?;
    Ok(id)
}
