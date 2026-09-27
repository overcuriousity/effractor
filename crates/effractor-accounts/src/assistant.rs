//! The agent chat's storage (spec 2026-09-27-assistant-chat-design §4.1):
//! settings, grants, shared sessions per document, their messages, the one
//! running turn per session, and reported token usage.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};

use crate::{Error, Id, Result, Timestamp};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Grantee {
    User(Id),
    Group(Id),
}

pub fn setting(c: &Connection, key: &str) -> Result<Option<String>> {
    Ok(
        c.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| {
            r.get(0)
        })
        .optional()?,
    )
}

/// `None` clears it.
pub fn set_setting(
    t: &Transaction,
    key: &str,
    value: Option<&str>,
    by: Id,
    now: Timestamp,
) -> Result<()> {
    match value {
        Some(v) => t.execute(
            "INSERT INTO settings (key, value, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT (key) DO UPDATE SET value = excluded.value,
               updated_by = excluded.updated_by, updated_at = excluded.updated_at",
            params![key, v, by, now],
        )?,
        None => t.execute("DELETE FROM settings WHERE key = ?1", [key])?,
    };
    Ok(())
}

/// Granted to them, or to a group they are in; never when disabled.
pub fn allowed(c: &Connection, user: Id) -> Result<bool> {
    Ok(c.query_row(
        "SELECT EXISTS (
           SELECT 1 FROM users u WHERE u.id = ?1 AND NOT u.disabled AND (
             EXISTS (SELECT 1 FROM assistant_grants g WHERE g.user_id = u.id)
             OR EXISTS (SELECT 1 FROM assistant_grants g JOIN memberships m
                        ON m.group_id = g.group_id WHERE m.user_id = u.id)))",
        [user],
        |r| r.get(0),
    )?)
}

pub fn grant(t: &Transaction, who: Grantee, by: Id, now: Timestamp) -> Result<()> {
    let (u, g) = match who {
        Grantee::User(u) => (Some(u), None),
        Grantee::Group(g) => (None, Some(g)),
    };
    t.execute(
        "INSERT OR IGNORE INTO assistant_grants (user_id, group_id, granted_by, granted_at)
         VALUES (?1, ?2, ?3, ?4)",
        params![u, g, by, now],
    )
    .map_err(|e| match e {
        rusqlite::Error::SqliteFailure(f, _)
            if f.code == rusqlite::ErrorCode::ConstraintViolation =>
        {
            Error::NotFound
        }
        other => Error::Sqlite(other),
    })?;
    Ok(())
}

pub fn revoke(t: &Transaction, who: Grantee) -> Result<()> {
    match who {
        Grantee::User(u) => t.execute("DELETE FROM assistant_grants WHERE user_id = ?1", [u])?,
        Grantee::Group(g) => t.execute("DELETE FROM assistant_grants WHERE group_id = ?1", [g])?,
    };
    Ok(())
}

pub fn grants(c: &Connection) -> Result<Vec<Grantee>> {
    let mut s = c.prepare("SELECT user_id, group_id FROM assistant_grants ORDER BY granted_at")?;
    let out = s
        .query_map([], |r| {
            let u: Option<Id> = r.get(0)?;
            Ok(match u {
                Some(u) => Grantee::User(u),
                None => Grantee::Group(r.get(1)?),
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
pub struct SessionRow {
    pub id: Id,
    pub document_id: Id,
    pub profile: String,
    pub title: String,
    pub created_by: Option<Id>,
    pub created_by_name: String,
    pub created_at: Timestamp,
    pub updated_at: Timestamp,
    pub deleted_at: Option<Timestamp>,
}

const SESSION: &str = "SELECT s.id, s.document_id, s.profile, s.title, s.created_by,
    ifnull(u.name, ''), s.created_at, s.updated_at, s.deleted_at
    FROM assistant_sessions s LEFT JOIN users u ON u.id = s.created_by";

fn session_row(r: &rusqlite::Row) -> rusqlite::Result<SessionRow> {
    Ok(SessionRow {
        id: r.get(0)?,
        document_id: r.get(1)?,
        profile: r.get(2)?,
        title: r.get(3)?,
        created_by: r.get(4)?,
        created_by_name: r.get(5)?,
        created_at: r.get(6)?,
        updated_at: r.get(7)?,
        deleted_at: r.get(8)?,
    })
}

pub fn create_session(
    t: &Transaction,
    document: Id,
    profile: &str,
    by: Id,
    now: Timestamp,
) -> Result<Id> {
    t.execute(
        "INSERT INTO assistant_sessions (document_id, profile, created_by, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![document, profile, by, now],
    )?;
    Ok(t.last_insert_rowid())
}

/// Newest first; deleted ones are left out.
pub fn sessions(c: &Connection, document: Id) -> Result<Vec<SessionRow>> {
    let mut s = c.prepare(&format!(
        "{SESSION} WHERE s.document_id = ?1 AND s.deleted_at IS NULL ORDER BY s.updated_at DESC, s.id DESC"
    ))?;
    let out = s
        .query_map([document], session_row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}

pub fn session(c: &Connection, id: Id) -> Result<Option<SessionRow>> {
    Ok(
        c.query_row(&format!("{SESSION} WHERE s.id = ?1"), [id], session_row)
            .optional()?,
    )
}

fn changed(n: usize) -> Result<()> {
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn rename_session(t: &Transaction, id: Id, title: &str) -> Result<()> {
    let title: String = title.trim().chars().take(120).collect();
    changed(t.execute(
        "UPDATE assistant_sessions SET title = ?2 WHERE id = ?1",
        params![id, title],
    )?)
}

pub fn delete_session(t: &Transaction, id: Id, now: Timestamp) -> Result<()> {
    changed(t.execute(
        "UPDATE assistant_sessions SET deleted_at = ?2 WHERE id = ?1 AND deleted_at IS NULL",
        params![id, now],
    )?)
}

pub fn restore_session(t: &Transaction, id: Id) -> Result<()> {
    changed(t.execute(
        "UPDATE assistant_sessions SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL",
        [id],
    )?)
}

#[derive(Debug, Clone, Serialize)]
pub struct MessageRow {
    pub id: Id,
    pub seq: i64,
    pub turn: i64,
    pub role: String,
    pub author: Option<String>,
    pub content: String,
    pub input_tokens: Option<i64>,
    pub output_tokens: Option<i64>,
    pub created_at: Timestamp,
}

#[allow(clippy::too_many_arguments)]
pub fn append(
    t: &Transaction,
    session: Id,
    turn: i64,
    role: &str,
    author: Option<Id>,
    content: &str,
    tokens: Option<(i64, i64)>,
    now: Timestamp,
) -> Result<Id> {
    let seq: i64 = t.query_row(
        "SELECT ifnull(max(seq), 0) + 1 FROM assistant_messages WHERE session_id = ?1",
        [session],
        |r| r.get(0),
    )?;
    t.execute(
        "INSERT INTO assistant_messages
           (session_id, seq, turn, role, author_id, content, input_tokens, output_tokens, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![session, seq, turn, role, author, content, tokens.map(|t| t.0), tokens.map(|t| t.1), now],
    )?;
    t.execute(
        "UPDATE assistant_sessions SET updated_at = ?2 WHERE id = ?1",
        params![session, now],
    )?;
    Ok(t.last_insert_rowid())
}

pub fn messages(c: &Connection, session: Id) -> Result<Vec<MessageRow>> {
    let mut s = c.prepare(
        "SELECT m.id, m.seq, m.turn, m.role, u.name, m.content, m.input_tokens, m.output_tokens, m.created_at
         FROM assistant_messages m LEFT JOIN users u ON u.id = m.author_id
         WHERE m.session_id = ?1 ORDER BY m.seq",
    )?;
    let out = s
        .query_map([session], |r| {
            Ok(MessageRow {
                id: r.get(0)?,
                seq: r.get(1)?,
                turn: r.get(2)?,
                role: r.get(3)?,
                author: r.get(4)?,
                content: r.get(5)?,
                input_tokens: r.get(6)?,
                output_tokens: r.get(7)?,
                created_at: r.get(8)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}

#[derive(Debug, Clone)]
pub enum Claim {
    Claimed { turn: i64, released_stale: bool },
    Busy { by: String },
}

#[derive(Debug, Clone)]
pub struct Turn {
    pub by: Id,
    pub since: Timestamp,
    pub access: String,
    pub turn: i64,
    pub steps: i64,
}

pub fn turn(c: &Connection, session: Id) -> Result<Option<Turn>> {
    Ok(c.query_row(
        "SELECT turn_by, turn_since, turn_access, turn_no, turn_steps FROM assistant_sessions
         WHERE id = ?1 AND turn_since IS NOT NULL",
        [session],
        |r| {
            Ok(Turn {
                by: r.get::<_, Option<Id>>(0)?.unwrap_or(0),
                since: r.get(1)?,
                access: r.get(2)?,
                turn: r.get(3)?,
                steps: r.get(4)?,
            })
        },
    )
    .optional()?)
}

/// The session's next turn for `user`, unless one runs that is younger than
/// `stale_after` seconds. A stale one is released and said so.
pub fn claim(
    t: &Transaction,
    session: Id,
    user: Id,
    access: &str,
    now: Timestamp,
    stale_after: u64,
) -> Result<Claim> {
    let mut released_stale = false;
    if let Some(running) = turn(t, session)? {
        if now.saturating_sub(running.since) < stale_after {
            let by: String = t
                .query_row("SELECT name FROM users WHERE id = ?1", [running.by], |r| {
                    r.get(0)
                })
                .optional()?
                .unwrap_or_default();
            return Ok(Claim::Busy { by });
        }
        released_stale = true;
    }
    t.execute(
        "UPDATE assistant_sessions SET turn_by = ?2, turn_since = ?3, turn_access = ?4,
           turn_no = turn_no + 1, turn_steps = 0 WHERE id = ?1",
        params![session, user, now, access],
    )?;
    let turn: i64 = t.query_row(
        "SELECT turn_no FROM assistant_sessions WHERE id = ?1",
        [session],
        |r| r.get(0),
    )?;
    Ok(Claim::Claimed {
        turn,
        released_stale,
    })
}

pub fn release(t: &Transaction, session: Id) -> Result<()> {
    t.execute(
        "UPDATE assistant_sessions SET turn_by = NULL, turn_since = NULL, turn_access = NULL WHERE id = ?1",
        [session],
    )?;
    Ok(())
}

/// One more model request in this turn; returns how many there have been.
pub fn bump_steps(t: &Transaction, session: Id) -> Result<i64> {
    t.execute(
        "UPDATE assistant_sessions SET turn_steps = turn_steps + 1 WHERE id = ?1",
        [session],
    )?;
    Ok(t.query_row(
        "SELECT turn_steps FROM assistant_sessions WHERE id = ?1",
        [session],
        |r| r.get(0),
    )?)
}

/// Tokens as the provider reported them; `None` when it reported nothing.
pub fn record_usage(
    t: &Transaction,
    user: Id,
    session: Option<Id>,
    input: Option<i64>,
    output: Option<i64>,
    now: Timestamp,
) -> Result<()> {
    t.execute(
        "INSERT INTO assistant_usage (user_id, session_id, at, input_tokens, output_tokens)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![user, session, now, input, output],
    )?;
    Ok(())
}

pub fn used_since(c: &Connection, user: Id, since: Timestamp) -> Result<i64> {
    Ok(c.query_row(
        "SELECT ifnull(sum(ifnull(input_tokens, 0) + ifnull(output_tokens, 0)), 0)
         FROM assistant_usage WHERE user_id = ?1 AND at >= ?2",
        params![user, since],
        |r| r.get(0),
    )?)
}

#[derive(Debug, Clone, Serialize)]
pub struct UsageRow {
    pub user: String,
    /// Model requests, one per step.
    pub requests: i64,
    pub input: i64,
    pub output: i64,
    /// Requests the endpoint reported no counts for.
    pub unreported: i64,
}

pub fn usage(c: &Connection, since: Timestamp) -> Result<Vec<UsageRow>> {
    let mut s = c.prepare(
        "SELECT u.name, count(*), ifnull(sum(a.input_tokens), 0), ifnull(sum(a.output_tokens), 0),
                sum(a.input_tokens IS NULL AND a.output_tokens IS NULL)
         FROM assistant_usage a JOIN users u ON u.id = a.user_id
         WHERE a.at >= ?1 GROUP BY u.id ORDER BY u.name",
    )?;
    let out = s
        .query_map([since], |r| {
            Ok(UsageRow {
                user: r.get(0)?,
                requests: r.get(1)?,
                input: r.get(2)?,
                output: r.get(3)?,
                unreported: r.get(4)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}
