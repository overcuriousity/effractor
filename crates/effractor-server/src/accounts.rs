//! The account system's state (spec 2026-09-26-accounts-design): the
//! database, what the cookie may claim, the login limiter. Absent when the
//! server runs without `--accounts`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use effractor_accounts::Db;

use crate::api::ApiError;
use crate::limiter::Limiter;

pub struct AccountsConfig {
    pub db: PathBuf,
    /// The origin people reach the server at, e.g. `https://effractor.example`.
    pub public_url: Option<String>,
}

struct Inner {
    db: Db,
    public_url: Option<String>,
    logins: Mutex<Limiter>,
}

#[derive(Clone)]
pub struct Accounts(Arc<Inner>);

/// Failed logins per address and hour (spec §7.1).
const LOGINS_PER_HOUR: u32 = 30;

impl Accounts {
    pub fn open(cfg: AccountsConfig) -> anyhow::Result<Accounts> {
        let db = Db::open(&cfg.db)?;
        Ok(Self::with_db(db, cfg.public_url))
    }

    pub fn with_db(db: Db, public_url: Option<String>) -> Accounts {
        let public_url = public_url.map(|u| u.trim_end_matches('/').to_owned());
        Accounts(Arc::new(Inner {
            db,
            public_url,
            logins: Mutex::new(Limiter::new(LOGINS_PER_HOUR)),
        }))
    }

    pub fn db(&self) -> &Db {
        &self.0.db
    }

    pub fn public_url(&self) -> Option<&str> {
        self.0.public_url.as_deref()
    }

    /// Passkeys need `--public-url` (the passkeys milestone fills this in).
    pub fn passkeys_enabled(&self) -> bool {
        false
    }

    /// The OIDC button's word, when an issuer is configured (the oidc milestone).
    pub fn oidc_label(&self) -> Option<String> {
        None
    }

    pub fn secure_cookie(&self) -> bool {
        self.public_url().is_some_and(|u| u.starts_with("https://"))
    }

    pub(crate) fn logins(&self) -> std::sync::MutexGuard<'_, Limiter> {
        self.0.logins.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Runs database work off the async threads.
    pub async fn blocking<T: Send + 'static>(
        &self,
        f: impl FnOnce(&Db) -> effractor_accounts::Result<T> + Send + 'static,
    ) -> Result<T, ApiError> {
        let me = self.clone();
        tokio::task::spawn_blocking(move || f(me.db()))
            .await
            .map_err(|e| ApiError::Internal(e.to_string()))?
            .map_err(ApiError::from)
    }
}
