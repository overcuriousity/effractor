//! Stored passkeys (spec §7.1): webauthn-rs's serialized credential, its id
//! for uniqueness, a label. Any account may add them.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;

use crate::users::{self, User};
use crate::{Error, Id, Result, Timestamp};

#[derive(Debug, Clone, Serialize)]
pub struct Row {
    pub id: Id,
    pub label: String,
    pub created_at: Timestamp,
    pub last_used_at: Option<Timestamp>,
}

fn label(l: &str) -> Result<String> {
    let l = l.trim();
    if (1..=60).contains(&l.chars().count()) {
        Ok(l.to_owned())
    } else {
        Err(Error::Invalid("a label is 1–60 characters".into()))
    }
}

pub fn add(
    t: &Transaction,
    user: Id,
    credential_id: &[u8],
    credential: &str,
    name: &str,
    now: Timestamp,
) -> Result<Id> {
    t.execute(
        "INSERT INTO passkeys (user_id, credential_id, credential, label, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user, credential_id, credential, label(name)?, now],
    )
    .map_err(Error::exists_or)?;
    Ok(t.last_insert_rowid())
}

pub fn list(c: &Connection, user: Id) -> Result<Vec<Row>> {
    let mut s = c.prepare("SELECT id, label, created_at, last_used_at FROM passkeys WHERE user_id = ?1 ORDER BY created_at")?;
    let out = s
        .query_map([user], |r| {
            Ok(Row {
                id: r.get(0)?,
                label: r.get(1)?,
                created_at: r.get(2)?,
                last_used_at: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}

pub fn credentials(c: &Connection, user: Id) -> Result<Vec<(Id, String)>> {
    let mut s = c.prepare("SELECT id, credential FROM passkeys WHERE user_id = ?1")?;
    let out = s
        .query_map([user], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}

pub fn update(t: &Transaction, id: Id, credential: &str, now: Timestamp) -> Result<()> {
    t.execute(
        "UPDATE passkeys SET credential = ?2, last_used_at = ?3 WHERE id = ?1",
        params![id, credential, now],
    )?;
    Ok(())
}

pub fn rename(t: &Transaction, user: Id, id: Id, name: &str) -> Result<()> {
    let n = t.execute(
        "UPDATE passkeys SET label = ?3 WHERE id = ?1 AND user_id = ?2",
        params![id, user, label(name)?],
    )?;
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn remove(t: &Transaction, user: Id, id: Id) -> Result<()> {
    let m = users::login_methods(t, user)?;
    if m.passkeys <= 1 && !m.password && !m.oidc {
        return Err(Error::Refused("the last way to log in stays"));
    }
    let n = t.execute(
        "DELETE FROM passkeys WHERE id = ?1 AND user_id = ?2",
        params![id, user],
    )?;
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn user_by_handle(c: &Connection, handle: &[u8]) -> Result<Option<User>> {
    let id: Option<Id> = c
        .query_row(
            "SELECT id FROM users WHERE webauthn_id = ?1",
            [handle],
            |r| r.get(0),
        )
        .optional()?;
    match id {
        Some(id) => users::get(c, id),
        None => Ok(None),
    }
}
