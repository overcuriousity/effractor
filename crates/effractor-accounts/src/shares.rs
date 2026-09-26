//! Shares of documents and folders with users and groups (spec §5).
//! No foreign keys (a target is one of two tables): whoever deletes a user,
//! group, document or folder deletes the shares naming it.

use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};
use serde::Serialize;

use crate::perms::Role;
use crate::{Error, Id, Result, Timestamp};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    Document(Id),
    Folder(Id),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Grantee {
    User(Id),
    Group(Id),
}

impl Target {
    fn parts(self) -> (&'static str, Id) {
        match self {
            Target::Document(id) => ("document", id),
            Target::Folder(id) => ("folder", id),
        }
    }
    fn owner(self, c: &Connection) -> Result<Id> {
        let (kind, id) = self.parts();
        let table = if kind == "document" {
            "documents"
        } else {
            "folders"
        };
        c.query_row(
            &format!("SELECT owner_id FROM {table} WHERE id = ?1"),
            [id],
            |r| r.get(0),
        )
        .optional()?
        .ok_or(Error::NotFound)
    }
}

impl Grantee {
    fn parts(self) -> (&'static str, Id) {
        match self {
            Grantee::User(id) => ("user", id),
            Grantee::Group(id) => ("group", id),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Share {
    pub id: Id,
    pub target_kind: String,
    pub target_id: Id,
    pub grantee_kind: String,
    pub grantee_id: Id,
    pub grantee_name: String,
    pub role: Role,
}

const SELECT: &str = "
SELECT s.id, s.target_kind, s.target_id, s.grantee_kind, s.grantee_id,
       CASE s.grantee_kind WHEN 'user' THEN (SELECT name FROM users WHERE id = s.grantee_id)
                           ELSE (SELECT name FROM groups WHERE id = s.grantee_id) END,
       s.role
FROM shares s";

fn row(r: &Row) -> rusqlite::Result<Share> {
    let role: String = r.get(6)?;
    Ok(Share {
        id: r.get(0)?,
        target_kind: r.get(1)?,
        target_id: r.get(2)?,
        grantee_kind: r.get(3)?,
        grantee_id: r.get(4)?,
        grantee_name: r.get::<_, Option<String>>(5)?.unwrap_or_default(),
        role: if role == "editor" {
            Role::Editor
        } else {
            Role::Viewer
        },
    })
}

pub fn grant(
    t: &Transaction,
    target: Target,
    grantee: Grantee,
    role: Role,
    now: Timestamp,
) -> Result<Id> {
    if role == Role::Owner {
        return Err(Error::Invalid("a role is viewer or editor".into()));
    }
    if grantee == Grantee::User(target.owner(t)?) {
        return Err(Error::Invalid("the owner has it already".into()));
    }
    let (tk, tid) = target.parts();
    let (gk, gid) = grantee.parts();
    t.execute(
        "INSERT INTO shares (target_kind, target_id, grantee_kind, grantee_id, role, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT (target_kind, target_id, grantee_kind, grantee_id) DO UPDATE SET role = excluded.role",
        params![tk, tid, gk, gid, role.as_str(), now],
    )?;
    Ok(t.query_row(
        "SELECT id FROM shares WHERE target_kind = ?1 AND target_id = ?2 AND grantee_kind = ?3 AND grantee_id = ?4",
        params![tk, tid, gk, gid],
        |r| r.get(0),
    )?)
}

pub fn get(c: &Connection, id: Id) -> Result<Option<Share>> {
    Ok(c.query_row(&format!("{SELECT} WHERE s.id = ?1"), [id], row)
        .optional()?)
}

pub fn revoke(t: &Transaction, id: Id) -> Result<()> {
    let n = t.execute("DELETE FROM shares WHERE id = ?1", [id])?;
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn list(c: &Connection, target: Target) -> Result<Vec<Share>> {
    let (tk, tid) = target.parts();
    let mut s = c.prepare(&format!(
        "{SELECT} WHERE s.target_kind = ?1 AND s.target_id = ?2 ORDER BY s.grantee_kind DESC, 6"
    ))?;
    let out = s
        .query_map(params![tk, tid], row)?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}

/// A user or group someone may share with.
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub kind: String,
    pub id: Id,
    pub name: String,
    pub display_name: String,
}

/// Suggestions for a name being typed, not a list of everybody: nothing for
/// nothing typed, and one letter finds only that very name (names may be one
/// letter long). Never `me`, never a disabled user; ten at most.
pub fn directory(c: &Connection, me: Id, q: &str) -> Result<Vec<Entry>> {
    let q = q.trim();
    if q.is_empty() {
        return Ok(vec![]);
    }
    let whole = q.chars().count() < 2;
    let mut s = c.prepare(
        "SELECT kind, id, name, display_name FROM (
           SELECT 'user' AS kind, id, name, display_name FROM users WHERE NOT disabled AND id != ?1
           UNION ALL SELECT 'group', id, name, '' FROM groups)
         WHERE CASE WHEN ?3 THEN fold(name) = fold(?2)
           ELSE instr(fold(name), fold(?2)) > 0 OR instr(fold(display_name), fold(?2)) > 0 END
         ORDER BY instr(fold(name), fold(?2)) != 1, name LIMIT 10",
    )?;
    let out = s
        .query_map(params![me, q, whole], |r| {
            Ok(Entry {
                kind: r.get(0)?,
                id: r.get(1)?,
                name: r.get(2)?,
                display_name: r.get(3)?,
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}
