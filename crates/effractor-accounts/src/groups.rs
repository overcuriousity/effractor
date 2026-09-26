//! Groups and memberships (spec §5, §8).

use rusqlite::{Connection, Transaction, params};
use serde::Serialize;

use crate::folders::check_name;
use crate::{Error, Id, Result};

#[derive(Debug, Clone, Serialize)]
pub struct Member {
    pub id: Id,
    pub name: String,
    pub display_name: String,
    pub role: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub id: Id,
    pub name: String,
    pub admins_may_create_users: bool,
    pub members: Vec<Member>,
}

fn changed(n: usize) -> Result<()> {
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn create(t: &Transaction, name: &str) -> Result<Id> {
    let name = check_name(name)?;
    t.execute("INSERT INTO groups (name) VALUES (?1)", [name])
        .map_err(Error::exists_or)?;
    Ok(t.last_insert_rowid())
}

pub fn rename(t: &Transaction, id: Id, name: &str) -> Result<()> {
    let name = check_name(name)?;
    changed(
        t.execute(
            "UPDATE groups SET name = ?2 WHERE id = ?1",
            params![id, name],
        )
        .map_err(Error::exists_or)?,
    )
}

pub fn delete(t: &Transaction, id: Id) -> Result<()> {
    t.execute(
        "DELETE FROM shares WHERE grantee_kind = 'group' AND grantee_id = ?1",
        [id],
    )?;
    changed(t.execute("DELETE FROM groups WHERE id = ?1", [id])?)
}

pub fn set_flag(t: &Transaction, id: Id, on: bool) -> Result<()> {
    changed(t.execute(
        "UPDATE groups SET admins_may_create_users = ?2 WHERE id = ?1",
        params![id, on],
    )?)
}

pub fn flag(c: &Connection, id: Id) -> Result<bool> {
    c.query_row(
        "SELECT admins_may_create_users FROM groups WHERE id = ?1",
        [id],
        |r| r.get(0),
    )
    .map_err(|_| Error::NotFound)
}

pub fn set_member(t: &Transaction, group: Id, user: Id, role: &str) -> Result<()> {
    if role != "member" && role != "admin" {
        return Err(Error::Invalid("a member's role is member or admin".into()));
    }
    t.execute(
        "INSERT INTO memberships (group_id, user_id, role) VALUES (?1, ?2, ?3)
         ON CONFLICT (group_id, user_id) DO UPDATE SET role = excluded.role",
        params![group, user, role],
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

pub fn remove_member(t: &Transaction, group: Id, user: Id) -> Result<()> {
    changed(t.execute(
        "DELETE FROM memberships WHERE group_id = ?1 AND user_id = ?2",
        params![group, user],
    )?)
}

pub fn role_in(c: &Connection, group: Id, user: Id) -> Result<Option<String>> {
    use rusqlite::OptionalExtension;
    Ok(c.query_row(
        "SELECT role FROM memberships WHERE group_id = ?1 AND user_id = ?2",
        params![group, user],
        |r| r.get(0),
    )
    .optional()?)
}

pub fn administered(c: &Connection, user: Id) -> Result<Vec<Id>> {
    let mut s = c.prepare(
        "SELECT group_id FROM memberships WHERE user_id = ?1 AND role = 'admin' ORDER BY group_id",
    )?;
    let out = s
        .query_map([user], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    Ok(out)
}

pub fn list(c: &Connection, only: Option<&[Id]>) -> Result<Vec<Group>> {
    let mut s = c.prepare("SELECT id, name, admins_may_create_users FROM groups ORDER BY name")?;
    let mut groups: Vec<Group> = s
        .query_map([], |r| {
            Ok(Group {
                id: r.get(0)?,
                name: r.get(1)?,
                admins_may_create_users: r.get(2)?,
                members: vec![],
            })
        })?
        .collect::<rusqlite::Result<_>>()?;
    if let Some(only) = only {
        groups.retain(|g| only.contains(&g.id));
    }
    let mut m = c.prepare(
        "SELECT u.id, u.name, u.display_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.group_id = ?1 ORDER BY u.name",
    )?;
    for g in &mut groups {
        g.members = m
            .query_map([g.id], |r| {
                Ok(Member {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    display_name: r.get(2)?,
                    role: r.get(3)?,
                })
            })?
            .collect::<rusqlite::Result<_>>()?;
    }
    Ok(groups)
}
