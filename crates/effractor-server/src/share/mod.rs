//! Sharing: opaque blobs, kept for a while, deletable by whoever made them.
//!
//! The browser encrypts a model and uploads ciphertext; the key travels in the
//! link's fragment and never reaches this process. So there is nothing here to
//! read, and nothing here reads: a share is bytes, an expiry, and the hash of a
//! token that permits deleting it.

mod api;
mod fs;
mod limiter;
mod memory;

use std::fmt;
use std::str::FromStr;

use async_trait::async_trait;
use axum::body::Bytes;
use serde::{Deserialize, Serialize};

pub use api::{Limits, Shares, routes};
pub use fs::FsStorage;
pub use memory::MemoryStorage;

/// Seconds since the Unix epoch.
pub type Timestamp = u64;

const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// 128 random bits as 22 characters of base64url, for ids and delete tokens.
pub(crate) fn random_token() -> String {
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

/// A share's name: 128 random bits, generated here, never chosen by a client.
/// Parsing accepts exactly the shape `random` produces, which is also what
/// makes an id safe to build a file name from.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct ShareId(String);

impl ShareId {
    pub fn random() -> Self {
        Self(random_token())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("not a share id")]
pub struct InvalidShareId;

impl FromStr for ShareId {
    type Err = InvalidShareId;
    fn from_str(s: &str) -> Result<Self, InvalidShareId> {
        if s.len() == 22 && s.bytes().all(|b| ALPHABET.contains(&b)) {
            Ok(Self(s.to_owned()))
        } else {
            Err(InvalidShareId)
        }
    }
}

impl fmt::Display for ShareId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ShareMeta {
    /// Fixed at creation, not sliding: predictable, and a read writes nothing.
    /// `None` never expires.
    pub expires_at: Option<Timestamp>,
    /// SHA-256 of the delete token, in hex. The token itself is not kept.
    pub delete_token_hash: String,
    pub size: u64,
}

impl ShareMeta {
    pub fn expired(&self, now: Timestamp) -> bool {
        self.expires_at.is_some_and(|at| at <= now)
    }
}

#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    /// A share is immutable; its id cannot be written again.
    #[error("a share with this id exists")]
    Exists,
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("unreadable share metadata: {0}")]
    Corrupt(#[from] serde_json::Error),
}

/// Where shares are kept. It keeps what it is given until told otherwise:
/// whether a share has expired is the caller's question on `get`, and `sweep`
/// is how the expired ones go. `tests/storage.rs` holds the contract; an
/// implementation is done when it passes.
#[async_trait]
pub trait Storage: Send + Sync + 'static {
    async fn put(&self, id: &ShareId, blob: Bytes, meta: ShareMeta) -> Result<(), StorageError>;
    async fn get(&self, id: &ShareId) -> Result<Option<(Bytes, ShareMeta)>, StorageError>;
    /// Whether there was something to delete.
    async fn delete(&self, id: &ShareId) -> Result<bool, StorageError>;
    /// Remove everything expired at `now`; how many shares that was.
    async fn sweep(&self, now: Timestamp) -> Result<u64, StorageError>;
}

/// How long a share may live. Ordered by length.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Ttl {
    Day1,
    Days30,
    Days90,
    Year1,
    Never,
}

impl Ttl {
    pub const DEFAULT: Ttl = Ttl::Days90;

    pub fn seconds(self) -> Option<u64> {
        const DAY: u64 = 86_400;
        match self {
            Self::Day1 => Some(DAY),
            Self::Days30 => Some(30 * DAY),
            Self::Days90 => Some(90 * DAY),
            Self::Year1 => Some(365 * DAY),
            Self::Never => None,
        }
    }
}

impl FromStr for Ttl {
    type Err = String;
    fn from_str(s: &str) -> Result<Self, String> {
        match s {
            "1d" => Ok(Self::Day1),
            "30d" => Ok(Self::Days30),
            "90d" => Ok(Self::Days90),
            "1y" => Ok(Self::Year1),
            "never" => Ok(Self::Never),
            _ => Err(format!("{s:?} is not a ttl: use 1d, 30d, 90d, 1y or never")),
        }
    }
}

impl fmt::Display for Ttl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Day1 => "1d",
            Self::Days30 => "30d",
            Self::Days90 => "90d",
            Self::Year1 => "1y",
            Self::Never => "never",
        })
    }
}
