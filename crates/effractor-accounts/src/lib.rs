//! Accounts, stored documents and sharing (spec 2026-09-26-accounts-design).
//!
//! Synchronous and HTTP-free: the server calls it on `spawn_blocking`. One
//! writer connection behind a mutex, readers from a small pool; WAL lets them
//! read while the writer writes. Every function takes the connection or
//! transaction it runs on, and `now` where time matters, so tests own both.

pub mod documents;
pub mod folders;
pub mod groups;
pub mod oidc;
pub mod passkeys;
pub mod perms;
pub mod sessions;
pub mod shares;
pub mod users;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

pub use rusqlite;
pub use rusqlite::{Connection, Transaction};
use sha2::{Digest, Sha256};

pub type Timestamp = u64;
pub type Id = i64;
pub type Result<T> = std::result::Result<T, Error>;

/// Embedded, applied in order; `PRAGMA user_version` counts how many ran.
const MIGRATIONS: &[&str] = &[include_str!("migrations/001.sql")];
pub const SCHEMA_VERSION: i64 = MIGRATIONS.len() as i64;

/// Readers kept for reuse; more are opened when all are busy.
const POOL: usize = 4;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Conflict {
    pub version: i64,
    pub updated_by: String,
    pub updated_at: Timestamp,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Invalid(String),
    #[error("{0}")]
    Refused(&'static str),
    #[error("exists")]
    Exists,
    #[error("changed since it was loaded")]
    Conflict(Conflict),
    #[error("the database is schema {found}; this effractor knows up to {known}")]
    TooNew { found: i64, known: i64 },
    /// Typically made by root for a service that runs as another user.
    #[error(
        "{0} cannot be written by this user; it must belong to the user the server runs as \
         (for the systemd service: sudo -u effractor effractor user … or chown effractor)"
    )]
    ReadOnly(String),
    #[error(transparent)]
    Sqlite(#[from] rusqlite::Error),
}

impl Error {
    /// A unique constraint failed: the name is taken.
    pub(crate) fn exists_or(err: rusqlite::Error) -> Error {
        match err {
            rusqlite::Error::SqliteFailure(e, _)
                if e.code == rusqlite::ErrorCode::ConstraintViolation =>
            {
                Error::Exists
            }
            other => Error::Sqlite(other),
        }
    }
}

type Clock = Arc<dyn Fn() -> Timestamp + Send + Sync>;

pub struct Db {
    path: PathBuf,
    writer: Mutex<Connection>,
    readers: Mutex<Vec<Connection>>,
    clock: Clock,
}

/// Case folded beyond ASCII, for names that must be unique whatever their
/// case and for search. SQLite's own NOCASE and lower() know ASCII only.
pub fn fold(s: &str) -> String {
    s.trim().to_lowercase()
}

fn connect(path: &Path) -> Result<Connection> {
    let c = Connection::open(path)?;
    c.create_scalar_function(
        "fold",
        1,
        rusqlite::functions::FunctionFlags::SQLITE_UTF8
            | rusqlite::functions::FunctionFlags::SQLITE_DETERMINISTIC,
        |ctx| Ok(ctx.get::<Option<String>>(0)?.map(|s| s.to_lowercase())),
    )?;
    c.pragma_update(None, "journal_mode", "WAL")?;
    c.pragma_update(None, "foreign_keys", "ON")?;
    c.pragma_update(None, "synchronous", "NORMAL")?;
    c.busy_timeout(std::time::Duration::from_secs(5))?;
    Ok(c)
}

impl Db {
    /// Opens or creates the database and brings its schema up to date. A
    /// database from a newer effractor is refused rather than guessed at.
    pub fn open(path: &Path) -> Result<Db> {
        let mut writer = connect(path)?;
        // SQLite opens a file it may not write read-only, quietly; every
        // login would then fail. Better not to start.
        if writer.is_readonly(rusqlite::MAIN_DB)? {
            return Err(Error::ReadOnly(path.display().to_string()));
        }
        let found: i64 = writer.query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if found > SCHEMA_VERSION {
            return Err(Error::TooNew {
                found,
                known: SCHEMA_VERSION,
            });
        }
        for (i, sql) in MIGRATIONS.iter().enumerate().skip(found as usize) {
            let tx = writer.transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", i as i64 + 1)?;
            tx.commit()?;
        }
        Ok(Db {
            path: path.to_owned(),
            writer: Mutex::new(writer),
            readers: Mutex::new(Vec::new()),
            clock: Arc::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |d| d.as_secs())
            }),
        })
    }

    /// Tests own the time.
    pub fn with_clock(mut self, clock: impl Fn() -> Timestamp + Send + Sync + 'static) -> Db {
        self.clock = Arc::new(clock);
        self
    }

    pub fn now(&self) -> Timestamp {
        (self.clock)()
    }

    pub fn read<T>(&self, f: impl FnOnce(&Connection) -> Result<T>) -> Result<T> {
        let pooled = self.readers.lock().unwrap_or_else(|e| e.into_inner()).pop();
        let conn = match pooled {
            Some(c) => c,
            None => connect(&self.path)?,
        };
        let out = f(&conn);
        let mut pool = self.readers.lock().unwrap_or_else(|e| e.into_inner());
        if pool.len() < POOL {
            pool.push(conn);
        }
        out
    }

    /// One transaction: committed when `f` succeeds, rolled back otherwise.
    pub fn write<T>(&self, f: impl FnOnce(&Transaction) -> Result<T>) -> Result<T> {
        let mut conn = self.writer.lock().unwrap_or_else(|e| e.into_inner());
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let out = f(&tx)?;
        tx.commit()?;
        Ok(out)
    }
}

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// 128 random bits as 22 characters of base64url: session tokens and ceremony ids.
pub fn token() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the operating system has randomness");
    let mut out = String::with_capacity(22);
    for chunk in bytes.chunks(3) {
        let n = chunk.iter().fold(0u32, |n, b| n << 8 | u32::from(*b)) << (8 * (3 - chunk.len()));
        for i in 0..=chunk.len() {
            out.push(ALPHABET[(n >> (18 - 6 * i) & 63) as usize] as char);
        }
    }
    out
}

/// What the database keeps instead of a token.
pub fn hash_token(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
