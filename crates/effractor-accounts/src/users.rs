//! Users and their passwords (spec §4, §7.1, §8).

use std::sync::OnceLock;

use argon2::Argon2;
use argon2::{PasswordHasher, PasswordVerifier};
use rusqlite::{Connection, OptionalExtension, Row, Transaction, params};

use crate::{Error, Id, Result, Timestamp};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct User {
    pub id: Id,
    pub name: String,
    pub display_name: String,
    pub admin: bool,
    pub disabled: bool,
    pub has_password: bool,
    pub webauthn_id: Vec<u8>,
}

pub struct NewUser<'a> {
    pub name: &'a str,
    pub display_name: &'a str,
    pub password: Option<&'a str>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Methods {
    pub password: bool,
    pub passkeys: u32,
    pub oidc: bool,
}

const COLUMNS: &str =
    "id, name, display_name, admin, disabled, password_hash IS NOT NULL, webauthn_id";

fn row(r: &Row) -> rusqlite::Result<User> {
    Ok(User {
        id: r.get(0)?,
        name: r.get(1)?,
        display_name: r.get(2)?,
        admin: r.get(3)?,
        disabled: r.get(4)?,
        has_password: r.get(5)?,
        webauthn_id: r.get(6)?,
    })
}

/// A new name: plain ASCII, so that no two of them look alike. Names made
/// before this rule may hold any letter, and still log in and are found:
/// lookups fold case beyond ASCII (see `crate::fold`).
pub fn check_name(name: &str) -> Result<String> {
    let name = name.trim();
    let ok = (1..=64).contains(&name.len())
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c));
    if ok {
        Ok(name.to_owned())
    } else {
        Err(Error::Invalid(
            "a name is 1–64 letters a–z, digits, . _ -".into(),
        ))
    }
}

pub fn check_display_name(name: &str) -> Result<String> {
    let name = name.trim();
    if name.chars().count() > 100 {
        return Err(Error::Invalid("at most 100 characters".into()));
    }
    Ok(name.to_owned())
}

pub fn check_password(pw: &str) -> Result<()> {
    if pw.chars().count() >= 12 {
        Ok(())
    } else {
        Err(Error::Invalid("at least 12 characters".into()))
    }
}

fn hash(pw: &str) -> String {
    let mut salt = [0u8; 16];
    getrandom::fill(&mut salt).expect("the operating system has randomness");
    Argon2::default()
        .hash_password_with_salt(pw.as_bytes(), &salt)
        .expect("argon2 with default parameters hashes any input")
        .to_string()
}

/// Verified against when the name is unknown, so both cases take as long.
fn dummy() -> &'static str {
    static DUMMY: OnceLock<String> = OnceLock::new();
    DUMMY.get_or_init(|| hash("an unguessable dummy password"))
}

fn verify(pw: &str, stored: &str) -> bool {
    Argon2::default()
        .verify_password(pw.as_bytes(), stored)
        .is_ok()
}

pub fn create(t: &Transaction, new: &NewUser, now: Timestamp) -> Result<Id> {
    let name = check_name(new.name)?;
    let display_name = check_display_name(new.display_name)?;
    let hash = match new.password {
        Some(pw) => {
            check_password(pw)?;
            Some(hash(pw))
        }
        None => None,
    };
    let mut webauthn_id = [0u8; 16];
    getrandom::fill(&mut webauthn_id).expect("the operating system has randomness");
    t.execute(
        "INSERT INTO users (name, name_key, display_name, password_hash, webauthn_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            name,
            crate::fold(&name),
            display_name,
            hash,
            &webauthn_id[..],
            now
        ],
    )
    .map_err(Error::exists_or)?;
    Ok(t.last_insert_rowid())
}

pub fn get(c: &Connection, id: Id) -> Result<Option<User>> {
    Ok(c.query_row(
        &format!("SELECT {COLUMNS} FROM users WHERE id = ?1"),
        [id],
        row,
    )
    .optional()?)
}

pub fn by_name(c: &Connection, name: &str) -> Result<Option<User>> {
    Ok(c.query_row(
        &format!("SELECT {COLUMNS} FROM users WHERE name_key = ?1"),
        [crate::fold(name)],
        row,
    )
    .optional()?)
}

pub fn all(c: &Connection) -> Result<Vec<User>> {
    let mut s = c.prepare(&format!("SELECT {COLUMNS} FROM users ORDER BY name"))?;
    let users = s.query_map([], row)?.collect::<rusqlite::Result<_>>()?;
    Ok(users)
}

/// None for an unknown name, a wrong password, no password and a disabled
/// user alike, and the hash is checked in every case.
pub fn login(c: &Connection, name: &str, password: &str) -> Result<Option<User>> {
    let found: Option<(User, Option<String>)> = c
        .query_row(
            &format!("SELECT {COLUMNS}, password_hash FROM users WHERE name_key = ?1"),
            [crate::fold(name)],
            |r| Ok((row(r)?, r.get(7)?)),
        )
        .optional()?;
    let stored = found
        .as_ref()
        .and_then(|(_, h)| h.as_deref())
        .unwrap_or(dummy());
    let matches = verify(password, stored);
    Ok(found
        .filter(|(u, h)| matches && h.is_some() && !u.disabled)
        .map(|(u, _)| u))
}

pub fn set_password(t: &Transaction, id: Id, pw: Option<&str>) -> Result<()> {
    let hash = match pw {
        Some(pw) => {
            check_password(pw)?;
            Some(hash(pw))
        }
        None => None,
    };
    let n = t.execute(
        "UPDATE users SET password_hash = ?2 WHERE id = ?1",
        params![id, hash],
    )?;
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn set_display_name(t: &Transaction, id: Id, name: &str) -> Result<()> {
    let name = check_display_name(name)?;
    let n = t.execute(
        "UPDATE users SET display_name = ?2 WHERE id = ?1",
        params![id, name],
    )?;
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

/// Whether `id` is the only enabled admin.
fn last_admin(t: &Transaction, id: Id) -> Result<bool> {
    let (is_admin, others): (bool, i64) = t.query_row(
        "SELECT (SELECT admin AND NOT disabled FROM users WHERE id = ?1),
                (SELECT count(*) FROM users WHERE admin AND NOT disabled AND id != ?1)",
        [id],
        |r| Ok((r.get::<_, Option<bool>>(0)?.unwrap_or(false), r.get(1)?)),
    )?;
    Ok(is_admin && others == 0)
}

const LAST_ADMIN: &str = "the last admin stays";

pub fn set_admin(t: &Transaction, id: Id, admin: bool) -> Result<()> {
    if !admin && last_admin(t, id)? {
        return Err(Error::Refused(LAST_ADMIN));
    }
    let n = t.execute(
        "UPDATE users SET admin = ?2 WHERE id = ?1",
        params![id, admin],
    )?;
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn set_disabled(t: &Transaction, id: Id, disabled: bool) -> Result<()> {
    if disabled && last_admin(t, id)? {
        return Err(Error::Refused(LAST_ADMIN));
    }
    let n = t.execute(
        "UPDATE users SET disabled = ?2 WHERE id = ?1",
        params![id, disabled],
    )?;
    if n == 0 {
        return Err(Error::NotFound);
    }
    if disabled {
        t.execute("DELETE FROM sessions WHERE user_id = ?1", [id])?;
    }
    Ok(())
}

/// The user, what they own (folders and documents cascade), and every share
/// to them or to what they owned (the schema's triggers).
pub fn delete(t: &Transaction, id: Id) -> Result<()> {
    if last_admin(t, id)? {
        return Err(Error::Refused(LAST_ADMIN));
    }
    let n = t.execute("DELETE FROM users WHERE id = ?1", [id])?;
    if n == 0 { Err(Error::NotFound) } else { Ok(()) }
}

pub fn login_methods(c: &Connection, id: Id) -> Result<Methods> {
    c.query_row(
        "SELECT password_hash IS NOT NULL,
                (SELECT count(*) FROM passkeys WHERE user_id = ?1),
                EXISTS (SELECT 1 FROM oidc_identities WHERE user_id = ?1)
         FROM users WHERE id = ?1",
        [id],
        |r| {
            Ok(Methods {
                password: r.get(0)?,
                passkeys: r.get(1)?,
                oidc: r.get(2)?,
            })
        },
    )
    .optional()?
    .ok_or(Error::NotFound)
}
