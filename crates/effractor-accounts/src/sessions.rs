//! Sessions (spec §7.3): a random token in the cookie, its hash here.

use rusqlite::{OptionalExtension, Transaction, params};

use crate::users::{self, User};
use crate::{Db, Id, Result, Timestamp, hash_token, token};

pub const LIFETIME: u64 = 30 * 86_400;
pub const IDLE: u64 = 7 * 86_400;
/// `last_seen_at` is written at most this often, not on every request.
const TOUCH_EVERY: u64 = 60;

pub fn create(t: &Transaction, user: Id, now: Timestamp) -> Result<String> {
    let token = token();
    t.execute(
        "INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at)
         VALUES (?1, ?2, ?3, ?3, ?4)",
        params![hash_token(&token), user, now, now + LIFETIME],
    )?;
    Ok(token)
}

pub fn lookup(db: &Db, token: &str) -> Result<Option<User>> {
    let now = db.now();
    let hash = hash_token(token);
    let found: Option<(Id, Timestamp)> = db.read(|c| {
        Ok(c.query_row(
            "SELECT s.user_id, s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = ?1 AND s.expires_at > ?2 AND s.last_seen_at + ?3 > ?2
               AND NOT u.disabled",
            params![hash, now, IDLE],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?)
    })?;
    let Some((user, seen)) = found else {
        return Ok(None);
    };
    if now.saturating_sub(seen) >= TOUCH_EVERY {
        db.write(|t| {
            Ok(t.execute(
                "UPDATE sessions SET last_seen_at = ?2 WHERE token_hash = ?1",
                params![hash, now],
            )?)
        })?;
    }
    db.read(|c| users::get(c, user))
}

/// When the session was made, i.e. when its user last logged in.
pub fn created_at(c: &rusqlite::Connection, token: &str) -> Result<Option<Timestamp>> {
    Ok(c.query_row(
        "SELECT created_at FROM sessions WHERE token_hash = ?1",
        [hash_token(token)],
        |r| r.get(0),
    )
    .optional()?)
}

pub fn revoke(t: &Transaction, token: &str) -> Result<()> {
    t.execute(
        "DELETE FROM sessions WHERE token_hash = ?1",
        [hash_token(token)],
    )?;
    Ok(())
}

pub fn revoke_all(t: &Transaction, user: Id, except: Option<&str>) -> Result<()> {
    let keep = except.map(hash_token).unwrap_or_default();
    t.execute(
        "DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2",
        params![user, keep],
    )?;
    Ok(())
}

pub fn sweep(t: &Transaction, now: Timestamp) -> Result<u64> {
    let n = t.execute(
        "DELETE FROM sessions WHERE expires_at <= ?1 OR last_seen_at + ?2 <= ?1",
        params![now, IDLE],
    )?;
    Ok(n as u64)
}
