#![allow(dead_code)]
use effractor_accounts::users::{self, NewUser};
use effractor_accounts::{Db, Id};

pub fn db() -> (tempfile::TempDir, Db) {
    let dir = tempfile::tempdir().unwrap();
    let db = Db::open(&dir.path().join("a.db"))
        .unwrap()
        .with_clock(|| 1_000_000);
    (dir, db)
}

pub fn user(db: &Db, name: &str) -> Id {
    db.write(|t| {
        users::create(
            t,
            &NewUser {
                name,
                display_name: "",
                password: None,
            },
            0,
        )
    })
    .unwrap()
}

pub fn group(db: &Db, name: &str, members: &[Id]) -> Id {
    db.write(|t| {
        t.execute(
            "INSERT INTO groups (name, name_key) VALUES (?1, ?1)",
            [name],
        )?;
        let g = t.last_insert_rowid();
        for m in members {
            t.execute(
                "INSERT INTO memberships (group_id, user_id, role) VALUES (?1, ?2, 'member')",
                [g, *m],
            )?;
        }
        Ok(g)
    })
    .unwrap()
}

/// Straight into the table: the folder and document functions come later.
pub fn folder(db: &Db, owner: Id, parent: Option<Id>, name: &str) -> Id {
    db.write(|t| {
        t.execute(
            "INSERT INTO folders (owner_id, parent_id, name, name_key) VALUES (?1, ?2, ?3, ?3)",
            effractor_accounts::rusqlite::params![owner, parent, name],
        )?;
        Ok(t.last_insert_rowid())
    })
    .unwrap()
}

pub fn doc(db: &Db, owner: Id, folder: Option<Id>, name: &str) -> Id {
    db.write(|t| {
        t.execute(
            "INSERT INTO documents (owner_id, folder_id, name, profile, body, version, updated_at, updated_by)
             VALUES (?1, ?2, ?3, 'fault-tree', 'effractor: 1', 1, 0, ?1)",
            effractor_accounts::rusqlite::params![owner, folder, name],
        )?;
        Ok(t.last_insert_rowid())
    })
    .unwrap()
}
