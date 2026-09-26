//! Who may do what (spec §5): the owner, else the strongest share on the item
//! or any folder above it, to the user or a group they are in. The folder
//! chain is walked in SQL, never by recursion in Rust, and at most MAX_DEPTH up.

use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;

use crate::{Error, Id, Result, Timestamp};

pub const MAX_DEPTH: i64 = 32;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    Viewer = 1,
    Editor = 2,
    Owner = 3,
}

impl Role {
    pub fn from_rank(rank: i64) -> Option<Role> {
        match rank {
            1 => Some(Role::Viewer),
            2 => Some(Role::Editor),
            3 => Some(Role::Owner),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Role::Viewer => "viewer",
            Role::Editor => "editor",
            Role::Owner => "owner",
        }
    }
    /// What can be granted: viewer or editor.
    pub fn parse(s: &str) -> Result<Role> {
        match s {
            "viewer" => Ok(Role::Viewer),
            "editor" => Ok(Role::Editor),
            _ => Err(Error::Invalid("a role is viewer or editor".into())),
        }
    }
}

/// The strongest share on the folders from `seed` up, plus `extra_doc`, for `user`.
const SHARED_RANK: &str = "
WITH RECURSIVE
  mine(id) AS (SELECT group_id FROM memberships WHERE user_id = :user),
  up(id, parent, depth) AS (
    SELECT id, parent_id, 0 FROM folders WHERE id = :seed
    UNION ALL
    SELECT f.id, f.parent_id, up.depth + 1 FROM folders f JOIN up ON f.id = up.parent
    WHERE up.depth < :max
  )
SELECT max(CASE s.role WHEN 'editor' THEN 2 ELSE 1 END) FROM shares s
WHERE ((s.target_kind = 'document' AND s.target_id = :doc)
    OR (s.target_kind = 'folder' AND s.target_id IN (SELECT id FROM up)))
  AND ((s.grantee_kind = 'user' AND s.grantee_id = :user)
    OR (s.grantee_kind = 'group' AND s.grantee_id IN (SELECT id FROM mine)))";

fn shared(c: &Connection, user: Id, seed: Option<Id>, doc: Option<Id>) -> Result<Option<Role>> {
    let rank: Option<i64> = c.query_row(
        SHARED_RANK,
        rusqlite::named_params! { ":user": user, ":seed": seed, ":doc": doc, ":max": MAX_DEPTH },
        |r| r.get(0),
    )?;
    Ok(rank.and_then(Role::from_rank))
}

pub fn document_role(c: &Connection, user: Id, doc: Id) -> Result<Option<Role>> {
    let found: Option<(Id, Option<Id>, bool)> = c
        .query_row(
            "SELECT owner_id, folder_id, deleted_at IS NOT NULL FROM documents WHERE id = ?1",
            [doc],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;
    match found {
        None => Ok(None),
        Some((owner, _, _)) if owner == user => Ok(Some(Role::Owner)),
        Some((_, _, true)) => Ok(None),
        Some((_, folder, false)) => shared(c, user, folder, Some(doc)),
    }
}

pub fn folder_role(c: &Connection, user: Id, folder: Id) -> Result<Option<Role>> {
    let found: Option<(Id, bool)> = c
        .query_row(
            "SELECT owner_id, deleted_at IS NOT NULL FROM folders WHERE id = ?1",
            [folder],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    match found {
        None => Ok(None),
        Some((owner, _)) if owner == user => Ok(Some(Role::Owner)),
        Some((_, true)) => Ok(None),
        Some((_, false)) => shared(c, user, Some(folder), None),
    }
}

#[derive(Debug, Serialize)]
pub struct FolderItem {
    pub id: Id,
    pub parent: Option<Id>,
    pub name: String,
    pub owner: String,
    pub role: Role,
}

#[derive(Debug, Serialize)]
pub struct DocItem {
    pub id: Id,
    pub folder: Option<Id>,
    pub name: String,
    pub profile: String,
    pub version: i64,
    pub updated_at: Timestamp,
    pub updated_by: Option<String>,
    pub owner: String,
    pub role: Role,
}

#[derive(Debug, Default, Serialize)]
pub struct Visible {
    pub folders: Vec<FolderItem>,
    pub documents: Vec<DocItem>,
}

/// Shared folders and everything below them, with the strongest role that
/// reaches each; then shared documents, directly or through such a folder.
const SHARED_ITEMS: &str = "
WITH RECURSIVE
  mine(id) AS (SELECT group_id FROM memberships WHERE user_id = :user),
  granted(kind, id, rank) AS (
    SELECT target_kind, target_id, CASE role WHEN 'editor' THEN 2 ELSE 1 END FROM shares
    WHERE (grantee_kind = 'user' AND grantee_id = :user)
       OR (grantee_kind = 'group' AND grantee_id IN (SELECT id FROM mine))
  ),
  down(id, rank, depth) AS (
    SELECT f.id, g.rank, 0 FROM granted g JOIN folders f ON g.kind = 'folder' AND f.id = g.id
    WHERE f.deleted_at IS NULL AND f.owner_id != :user
    UNION ALL
    SELECT f.id, down.rank, down.depth + 1 FROM folders f JOIN down ON f.parent_id = down.id
    WHERE f.deleted_at IS NULL AND down.depth < :max
  ),
  sf(id, rank) AS (SELECT id, max(rank) FROM down GROUP BY id),
  sd(id, rank) AS (
    SELECT id, max(rank) FROM (
      SELECT id, rank FROM granted WHERE kind = 'document'
      UNION ALL
      SELECT d.id, sf.rank FROM documents d JOIN sf ON d.folder_id = sf.id
    ) GROUP BY id
  )";

pub fn visible(c: &Connection, user: Id, query: Option<&str>) -> Result<Visible> {
    let q = query.map(str::trim).filter(|q| !q.is_empty());
    let mut out = Visible::default();

    let mut s = c.prepare(&format!(
        "{SHARED_ITEMS}
         SELECT f.id, f.parent_id, f.name, u.name, 3 FROM folders f JOIN users u ON u.id = f.owner_id
         WHERE f.owner_id = :user AND f.deleted_at IS NULL
         UNION ALL
         SELECT f.id, f.parent_id, f.name, u.name, sf.rank FROM sf
         JOIN folders f ON f.id = sf.id JOIN users u ON u.id = f.owner_id"
    ))?;
    let rows = s.query_map(
        rusqlite::named_params! { ":user": user, ":max": MAX_DEPTH },
        |r| {
            Ok(FolderItem {
                id: r.get(0)?,
                parent: r.get(1)?,
                name: r.get(2)?,
                owner: r.get(3)?,
                role: Role::from_rank(r.get(4)?).unwrap_or(Role::Viewer),
            })
        },
    )?;
    for f in rows {
        out.folders.push(f?);
    }

    // SQLite's lower() folds ASCII only: enough for the simple search of
    // spec §6.5, and no extension to ship.
    let matches = "(:q IS NULL OR instr(lower(d.name), lower(:q)) > 0 OR instr(lower(d.body), lower(:q)) > 0)";
    let mut s = c.prepare(&format!(
        "{SHARED_ITEMS}
         SELECT d.id, d.folder_id, d.name, d.profile, d.version, d.updated_at, ub.name, u.name, 3
         FROM documents d JOIN users u ON u.id = d.owner_id LEFT JOIN users ub ON ub.id = d.updated_by
         WHERE d.owner_id = :user AND d.deleted_at IS NULL AND {matches}
         UNION ALL
         SELECT d.id, d.folder_id, d.name, d.profile, d.version, d.updated_at, ub.name, u.name, sd.rank
         FROM sd JOIN documents d ON d.id = sd.id JOIN users u ON u.id = d.owner_id
         LEFT JOIN users ub ON ub.id = d.updated_by
         WHERE d.owner_id != :user AND d.deleted_at IS NULL AND {matches}"
    ))?;
    let rows = s.query_map(
        rusqlite::named_params! { ":user": user, ":max": MAX_DEPTH, ":q": q },
        |r| {
            Ok(DocItem {
                id: r.get(0)?,
                folder: r.get(1)?,
                name: r.get(2)?,
                profile: r.get(3)?,
                version: r.get(4)?,
                updated_at: r.get(5)?,
                updated_by: r.get(6)?,
                owner: r.get(7)?,
                role: Role::from_rank(r.get(8)?).unwrap_or(Role::Viewer),
            })
        },
    )?;
    for d in rows {
        out.documents.push(d?);
    }
    Ok(out)
}
