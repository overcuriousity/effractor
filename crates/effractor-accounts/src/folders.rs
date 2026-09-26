//! Folders (spec §4, §6.4). Only the owner changes a folder; the caller
//! passes the owner and a folder that is not theirs is NotFound.

use rusqlite::{OptionalExtension, Transaction, params};

use crate::perms::MAX_DEPTH;
use crate::{Error, Id, Result, Timestamp};

pub fn check_name(name: &str) -> Result<String> {
    let name = name.trim();
    if (1..=200).contains(&name.chars().count()) && !name.chars().any(char::is_control) {
        Ok(name.to_owned())
    } else {
        Err(Error::Invalid("a name is 1–200 characters".into()))
    }
}

/// A live folder of `owner`, or NotFound.
pub(crate) fn own(t: &Transaction, owner: Id, id: Id) -> Result<()> {
    let ok: Option<i64> = t
        .query_row(
            "SELECT 1 FROM folders WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NULL",
            params![id, owner],
            |r| r.get(0),
        )
        .optional()?;
    ok.map(|_| ()).ok_or(Error::NotFound)
}

/// How many folders deep `id` is: 1 at the root.
fn depth(t: &Transaction, id: Id) -> Result<i64> {
    Ok(t.query_row(
        "WITH RECURSIVE up(id, parent, n) AS (
           SELECT id, parent_id, 1 FROM folders WHERE id = ?1
           UNION ALL SELECT f.id, f.parent_id, up.n + 1 FROM folders f JOIN up ON f.id = up.parent WHERE up.n <= ?2)
         SELECT max(n) FROM up",
        params![id, MAX_DEPTH],
        |r| r.get(0),
    )?)
}

/// How many levels `id` and what is below it take: 1 for an empty folder.
fn height(t: &Transaction, id: Id) -> Result<i64> {
    Ok(t.query_row(
        "WITH RECURSIVE down(id, n) AS (
           SELECT id, 1 FROM folders WHERE id = ?1
           UNION ALL SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id
           WHERE f.deleted_at IS NULL AND down.n <= ?2)
         SELECT max(n) FROM down",
        params![id, MAX_DEPTH],
        |r| r.get(0),
    )?)
}

fn is_below(t: &Transaction, id: Id, maybe_ancestor: Id) -> Result<bool> {
    Ok(t.query_row(
        "WITH RECURSIVE up(id, parent, n) AS (
           SELECT id, parent_id, 0 FROM folders WHERE id = ?1
           UNION ALL SELECT f.id, f.parent_id, up.n + 1 FROM folders f JOIN up ON f.id = up.parent WHERE up.n < ?3)
         SELECT EXISTS (SELECT 1 FROM up WHERE id = ?2)",
        params![id, maybe_ancestor, MAX_DEPTH],
        |r| r.get(0),
    )?)
}

const TOO_DEEP: &str = "folders nest at most 32 deep";

pub fn create(t: &Transaction, owner: Id, parent: Option<Id>, name: &str) -> Result<Id> {
    let name = check_name(name)?;
    if let Some(p) = parent {
        own(t, owner, p)?;
        if depth(t, p)? + 1 > MAX_DEPTH {
            return Err(Error::Refused(TOO_DEEP));
        }
    }
    t.execute(
        "INSERT INTO folders (owner_id, parent_id, name, name_key) VALUES (?1, ?2, ?3, ?4)",
        params![owner, parent, name, crate::fold(&name)],
    )
    .map_err(Error::exists_or)?;
    Ok(t.last_insert_rowid())
}

pub fn rename(t: &Transaction, owner: Id, id: Id, name: &str) -> Result<()> {
    let name = check_name(name)?;
    own(t, owner, id)?;
    t.execute(
        "UPDATE folders SET name = ?2, name_key = ?3 WHERE id = ?1",
        params![id, name, crate::fold(&name)],
    )
    .map_err(Error::exists_or)?;
    Ok(())
}

pub fn move_to(t: &Transaction, owner: Id, id: Id, parent: Option<Id>) -> Result<()> {
    own(t, owner, id)?;
    if let Some(p) = parent {
        own(t, owner, p)?;
        if p == id || is_below(t, p, id)? {
            return Err(Error::Refused("a folder cannot go into itself"));
        }
        if depth(t, p)? + height(t, id)? > MAX_DEPTH {
            return Err(Error::Refused(TOO_DEEP));
        }
    }
    t.execute(
        "UPDATE folders SET parent_id = ?2 WHERE id = ?1",
        params![id, parent],
    )
    .map_err(Error::exists_or)?;
    Ok(())
}

/// The folder, every live folder below it and every live document in them
/// get the same `deleted_at`, which is how `restore` finds them again.
pub fn delete(t: &Transaction, owner: Id, id: Id, now: Timestamp) -> Result<()> {
    own(t, owner, id)?;
    t.execute(
        "WITH RECURSIVE down(id, n) AS (
           SELECT ?1, 0 UNION ALL
           SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id
           WHERE f.deleted_at IS NULL AND down.n < ?3)
         UPDATE documents SET deleted_at = ?2 WHERE deleted_at IS NULL AND folder_id IN (SELECT id FROM down)",
        params![id, now, MAX_DEPTH],
    )?;
    t.execute(
        "WITH RECURSIVE down(id, n) AS (
           SELECT ?1, 0 UNION ALL
           SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id
           WHERE f.deleted_at IS NULL AND down.n < ?3)
         UPDATE folders SET deleted_at = ?2 WHERE id IN (SELECT id FROM down)",
        params![id, now, MAX_DEPTH],
    )?;
    Ok(())
}

/// `name`, or "name (2)", "name (3)" … whichever no live folder beside it has.
fn free_name(t: &Transaction, owner: Id, parent: Option<Id>, name: &str) -> Result<String> {
    let mut s = t.prepare(
        "SELECT 1 FROM folders WHERE owner_id = ?1 AND ifnull(parent_id, 0) = ifnull(?2, 0)
         AND name_key = ?3 AND deleted_at IS NULL",
    )?;
    let mut candidate = name.to_owned();
    // Ends: each taken name is a live sibling, and there are finitely many.
    for n in 2.. {
        if !s.exists(params![owner, parent, crate::fold(&candidate)])? {
            break;
        }
        candidate = format!("{name} ({n})");
    }
    Ok(candidate)
}

/// Brings back what went with this folder. If the folder it was in is gone
/// too, it comes back at the root; if its name was taken meanwhile, under a
/// free one.
pub fn restore(t: &Transaction, owner: Id, id: Id) -> Result<()> {
    let found: Option<(Timestamp, Option<Id>, String)> = t
        .query_row(
            "SELECT deleted_at, parent_id, name FROM folders WHERE id = ?1 AND owner_id = ?2 AND deleted_at IS NOT NULL",
            params![id, owner],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    let Some((at, parent, name)) = found else {
        return Err(Error::NotFound);
    };
    let parent = parent.filter(|&p| own(t, owner, p).is_ok());
    let name = free_name(t, owner, parent, &name)?;
    t.execute(
        "UPDATE folders SET parent_id = ?2, name = ?3, name_key = ?4 WHERE id = ?1",
        params![id, parent, name, crate::fold(&name)],
    )?;
    t.execute(
        "WITH RECURSIVE down(id, n) AS (
           SELECT ?1, 0 UNION ALL
           SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id
           WHERE f.deleted_at = ?2 AND down.n < ?3)
         UPDATE documents SET deleted_at = NULL WHERE deleted_at = ?2 AND folder_id IN (SELECT id FROM down)",
        params![id, at, MAX_DEPTH],
    )?;
    t.execute(
        "WITH RECURSIVE down(id, n) AS (
           SELECT ?1, 0 UNION ALL
           SELECT f.id, down.n + 1 FROM folders f JOIN down ON f.parent_id = down.id
           WHERE f.deleted_at = ?2 AND down.n < ?3)
         UPDATE folders SET deleted_at = NULL WHERE deleted_at = ?2 AND id IN (SELECT id FROM down)",
        params![id, at, MAX_DEPTH],
    )
    .map_err(Error::exists_or)?;
    Ok(())
}
