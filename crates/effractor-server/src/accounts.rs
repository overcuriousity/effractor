//! The account system's state (spec 2026-09-26-accounts-design): the
//! database, what the cookie may claim, the login limiter. Absent when the
//! server runs without `--accounts`.

use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use effractor_accounts::Db;

use crate::api::ApiError;
use crate::limiter::Limiter;

/// The operator's OIDC issuer (spec §7.1), e.g. their Nextcloud.
#[derive(Clone)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub secret: String,
    /// The login button's word.
    pub label: String,
}

pub struct AccountsConfig {
    pub db: PathBuf,
    /// The origin people reach the server at, e.g. `https://effractor.example`.
    pub public_url: Option<String>,
}

struct Inner {
    db: Db,
    public_url: Option<String>,
    logins: Mutex<Limiter>,
    oidc: std::sync::OnceLock<crate::auth::oidc::Oidc>,
    passkeys: Option<crate::auth::passkey::Passkeys>,
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
        // Passkeys are bound to the origin people use, so only with one.
        let passkeys = public_url.as_deref().and_then(
            |u| match crate::auth::passkey::Passkeys::new(u) {
                Ok(p) => Some(p),
                Err(err) => {
                    tracing::error!(%err, "passkeys are off: --public-url is not usable for them");
                    None
                }
            },
        );
        Accounts(Arc::new(Inner {
            db,
            public_url,
            logins: Mutex::new(Limiter::new(LOGINS_PER_HOUR)),
            oidc: std::sync::OnceLock::new(),
            passkeys,
        }))
    }

    pub fn db(&self) -> &Db {
        &self.0.db
    }

    pub fn public_url(&self) -> Option<&str> {
        self.0.public_url.as_deref()
    }

    /// Passkeys need `--public-url`.
    pub fn passkeys_enabled(&self) -> bool {
        self.passkeys().is_some()
    }

    pub(crate) fn passkeys(&self) -> Option<&crate::auth::passkey::Passkeys> {
        self.0.passkeys.as_ref()
    }

    /// The OIDC button's word, when an issuer is configured.
    pub fn oidc_label(&self) -> Option<String> {
        self.oidc().map(|o| o.label().to_owned())
    }

    /// OIDC needs the public url: the issuer sends people back to it. Set
    /// once, at startup (tests set it on a running app's state).
    pub fn with_oidc(&self, cfg: OidcConfig) -> anyhow::Result<()> {
        let public = self
            .public_url()
            .ok_or_else(|| anyhow::anyhow!("--oidc-issuer needs --public-url"))?;
        let oidc = crate::auth::oidc::Oidc::new(cfg, public)?;
        self.0
            .oidc
            .set(oidc)
            .map_err(|_| anyhow::anyhow!("OIDC is configured already"))
    }

    pub(crate) fn oidc(&self) -> Option<&crate::auth::oidc::Oidc> {
        self.0.oidc.get()
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
