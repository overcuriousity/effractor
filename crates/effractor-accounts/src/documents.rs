//! Stored documents (spec §6): the YAML text, a version for the conflict
//! check, soft delete with a 7-day purge, and what each user opened last.

use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::Serialize;

use crate::folders::{self, check_name};
use crate::{Conflict, Error, Id, Result, Timestamp};

pub const MAX_BODY: usize = 1 << 20;
pub const PURGE_AFTER: u64 = 7 * 86_400;
const RECENT: i64 = 5;
const PROFILES: [&str; 3] = ["fault-tree", "attack-tree", "architecture"];

#[derive(Debug, Clone, Serialize)]
pub struct Doc {
    pub id: Id,
    pub owner: String,
    pub folder: Option<Id>,
    pub name: String,
    pub profile: String,
    pub body: String,
    pub version: i64,
    pub updated_at: Timestamp,
    pub updated_by: Option<String>,
}

fn check_body(body: &str) -> Result<()> {
    if body.len() > MAX_BODY {
        Err(Error::Invalid("a document is at most 1 MiB".into()))
    } else {
        Ok(())
    }
}

pub fn create(
    t: &Transaction,
    owner: Id,
    folder: Option<Id>,
    name: &str,
    profile: &str,
    body: &str,
    now: Timestamp,
) -> Result<Id> {
    let name = check_name(name)?;
    check_body(body)?;
    if !PROFILES.contains(&profile) {
        return Err(Error::Invalid("unknown profile".into()));
    }
    if let Some(f) = folder {
        folders::own(t, owner, f)?;
    }
    t.execute(
        "INSERT INTO documents (owner_id, folder_id, name, profile, body, version, updated_at, updated_by)
         VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?1)",
        params![owner, folder, name, profile, body, now],
    )?;
    Ok(t.last_insert_rowid())
}

pub fn get(c: &Connection, id: Id) -> Result<Option<Doc>> {
    Ok(c.query_row(
        "SELECT d.id, u.name, d.folder_id, d.name, d.profile, d.body, d.version, d.updated_at, ub.name
         FROM documents d JOIN users u ON u.id = d.owner_id LEFT JOIN users ub ON ub.id = d.updated_by
         WHERE d.id = ?1 AND d.deleted_at IS NULL",
        [id],
        |r| {
            Ok(Doc {
                id: r.get(0)?,
                owner: r.get(1)?,
                folder: r.get(2)?,
                name: r.get(3)?,
                profile: r.get(4)?,
                body: r.get(5)?,
                version: r.get(6)?,
                updated_at: r.get(7)?,
                updated_by: r.get(8)?,
            })
        },
    )
    .optional()?)
}

/// Saved only on top of the version it was based on (spec §6.2).
pub fn save(
    t: &Transaction,
    id: Id,
    by: Id,
    base: i64,
    name: &str,
    body: &str,
    now: Timestamp,
) -> Result<i64> {
    let name = check_name(name)?;
    check_body(body)?;
    let n = t.execute(
        "UPDATE documents SET name = ?4, body = ?5, version = version + 1, updated_at = ?6, updated_by = ?2
         WHERE id = ?1 AND version = ?3 AND deleted_at IS NULL",
        params![id, by, base, name, body, now],
    )?;
    if n == 1 {
        return Ok(base + 1);
    }
    let current = get(t, id)?.ok_or(Error::NotFound)?;
    Err(Error::Conflict(Conflict {
        version: current.version,
        updated_by: current.updated_by.unwrap_or_default(),
        updated_at: current.updated_at,
    }))
}

fn own(t: &Transaction, owner: Id, id: Id) -> Result<()> {
    let ok: Option<i64> = t
        .query_row(
            "SELECT 1 FROM documents WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
            params![id, owner],
            |r| r.get(0),
        )
        .optional()?;
    ok.map(|_| ()).ok_or(Error::NotFound)
}

pub fn move_to(t: &Transaction, owner: Id, id: Id, folder: Option<Id>) -> Result<()> {
    own(t, owner, id)?;
    if let Some(f) = folder {
        folders::own(t, owner, f)?;
    }
    t.execute(
        "UPDATE documents SET folder_id = ?2 WHERE id = ?1",
        params![id, folder],
    )?;
    Ok(())
}

pub fn delete(t: &Transaction, owner: Id, id: Id, now: Timestamp) -> Result<()> {
    own(t, owner, id)?;
    t.execute(
        "UPDATE documents SET deleted_at = ?2 WHERE id = ?1",
        params![id, now],
    )?;
    Ok(())
}

/// Back where it was, or at the root if its folder is gone.
pub fn restore(t: &Transaction, owner: Id, id: Id) -> Result<()> {
    let folder: Option<Option<Id>> = t
        .query_row(
            "SELECT folder_id FROM documents WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NOT NULL",
            params![id, owner],
            |r| r.get(0),
        )
        .optional()?;
    let Some(folder) = folder else {
        return Err(Error::NotFound);
    };
    let keep = match folder {
        Some(f) => folders::own(t, owner, f).is_ok(),
        None => true,
    };
    t.execute(
        "UPDATE documents SET deleted_at = NULL, folder_id = CASE WHEN ?2 THEN folder_id ELSE NULL END WHERE id = ?1",
        params![id, keep],
    )?;
    Ok(())
}

/// What was deleted PURGE_AFTER ago or longer, and the shares naming it.
pub fn purge(t: &Transaction, now: Timestamp) -> Result<u64> {
    let cutoff = now.saturating_sub(PURGE_AFTER);
    t.execute(
        "DELETE FROM shares WHERE
           (target_kind = 'document' AND target_id IN (SELECT id FROM documents WHERE deleted_at <= ?1))
        OR (target_kind = 'folder' AND target_id IN (SELECT id FROM folders WHERE deleted_at <= ?1))",
        [cutoff],
    )?;
    let docs = t.execute("DELETE FROM documents WHERE deleted_at <= ?1", [cutoff])?;
    let dirs = t.execute("DELETE FROM folders WHERE deleted_at <= ?1", [cutoff])?;
    Ok((docs + dirs) as u64)
}

pub fn opened(t: &Transaction, user: Id, id: Id, now: Timestamp) -> Result<()> {
    t.execute(
        "INSERT INTO recent (user_id, document_id, opened_at) VALUES (?1, ?2, ?3)
         ON CONFLICT (user_id, document_id) DO UPDATE SET opened_at = excluded.opened_at",
        params![user, id, now],
    )?;
    t.execute(
        "DELETE FROM recent WHERE user_id = ?1 AND document_id NOT IN
           (SELECT document_id FROM recent WHERE user_id = ?1 ORDER BY opened_at DESC LIMIT ?2)",
        params![user, RECENT],
    )?;
    Ok(())
}

/// How many live documents `owner` keeps.
pub fn count(c: &Connection, owner: Id) -> Result<i64> {
    Ok(c.query_row(
        "SELECT count(*) FROM documents WHERE owner_id = ?1 AND deleted_at IS NULL",
        [owner],
        |r| r.get(0),
    )?)
}

pub fn recent(c: &Connection, user: Id) -> Result<Vec<Id>> {
    let mut s =
        c.prepare("SELECT document_id FROM recent WHERE user_id = ?1 ORDER BY opened_at DESC")?;
    let out = s
        .query_map([user], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}
