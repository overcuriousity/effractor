//! The account system's state (spec 2026-09-26-accounts-design): the
//! database, what the cookie may claim, the login limiter. Absent when the
//! server runs without `--accounts`.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use anyhow::Context;
use effractor_accounts::{Db, Timestamp};

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
    /// Normalised: lower-case scheme and host, no default port, no trailing
    /// slash; its path, if any, kept.
    public_url: Option<String>,
    /// What a browser sends as Origin: scheme, host and port.
    public_origin: Option<String>,
    logins: Mutex<Limiter>,
    /// Started passkey and OIDC logins, per address: each costs a pending
    /// entry here (and for OIDC a request to the issuer).
    starts: Mutex<Limiter>,
    oidc: std::sync::OnceLock<crate::auth::oidc::Oidc>,
    passkeys: Option<crate::auth::passkey::Passkeys>,
    /// A reverse proxy on this host: believe its X-Forwarded-For.
    trusted_proxy: bool,
}

#[derive(Clone)]
pub struct Accounts(Arc<Inner>);

/// Failed logins per address and hour (spec §7.1).
const LOGINS_PER_HOUR: u32 = 30;
/// Passkey or OIDC logins started per address and hour.
const STARTS_PER_HOUR: u32 = 60;
/// Logins in progress kept at most, all addresses together.
const MAX_PENDING: usize = 10_000;

/// Room for one more login in progress: the expired go, and if that is not
/// enough the oldest does. Refusing instead would let a few hundred
/// addresses lock everybody out.
pub(crate) fn make_room<V>(
    pending: &mut HashMap<String, V>,
    now: Timestamp,
    ttl: Timestamp,
    at: impl Fn(&V) -> Timestamp,
) {
    pending.retain(|_, v| now.saturating_sub(at(v)) < ttl);
    if pending.len() >= MAX_PENDING
        && let Some(oldest) = pending
            .iter()
            .min_by_key(|(_, v)| at(v))
            .map(|(k, _)| k.clone())
    {
        pending.remove(&oldest);
    }
}

/// The public url as the browser will spell it, and its origin: typed as
/// `HTTPS://Effractor.Example:443/` it still matches what browsers send.
fn normalise(url: &str) -> anyhow::Result<(String, String)> {
    let parsed =
        webauthn_rs::prelude::Url::parse(url).with_context(|| format!("--public-url {url:?}"))?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        anyhow::bail!("--public-url {url:?} is not an http or https address");
    }
    Ok((
        parsed.as_str().trim_end_matches('/').to_owned(),
        parsed.origin().ascii_serialization(),
    ))
}

impl Accounts {
    pub fn open(cfg: AccountsConfig) -> anyhow::Result<Accounts> {
        let db = Db::open(&cfg.db)?;
        Self::with_db(db, cfg.public_url)
    }

    pub fn with_db(db: Db, public_url: Option<String>) -> anyhow::Result<Accounts> {
        let (public_url, public_origin) = match public_url.as_deref().map(normalise).transpose()? {
            Some((url, origin)) => (Some(url), Some(origin)),
            None => (None, None),
        };
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
        Ok(Accounts(Arc::new(Inner {
            db,
            public_url,
            public_origin,
            logins: Mutex::new(Limiter::new(LOGINS_PER_HOUR)),
            starts: Mutex::new(Limiter::new(STARTS_PER_HOUR)),
            oidc: std::sync::OnceLock::new(),
            passkeys,
            trusted_proxy: false,
        })))
    }

    /// Behind a reverse proxy on the same host (nginx, Caddy): the client's
    /// address is the last X-Forwarded-For entry of a request from loopback.
    /// Set at startup, before the state is shared.
    pub fn trusting_proxy(mut self) -> Accounts {
        Arc::get_mut(&mut self.0)
            .expect("trusting_proxy is set before Accounts is shared")
            .trusted_proxy = true;
        self
    }

    pub(crate) fn trusts_proxy(&self) -> bool {
        self.0.trusted_proxy
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

    /// The public url's origin: what a browser sends as Origin, whatever
    /// path the server sits under.
    pub fn public_origin(&self) -> Option<&str> {
        self.0.public_origin.as_deref()
    }

    pub fn secure_cookie(&self) -> bool {
        self.public_url().is_some_and(|u| u.starts_with("https://"))
    }

    /// One more started login from `ip`, or how long to wait.
    pub(crate) fn start(&self, ip: std::net::IpAddr) -> Result<(), ApiError> {
        let now = self.db().now();
        self.0
            .starts
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take(ip, now)
            .map_err(ApiError::TooMany)
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A full table makes room instead of refusing: the expired go first,
    /// then the oldest.
    #[test]
    fn a_full_table_of_logins_in_progress_drops_the_oldest() {
        let mut pending: HashMap<String, Timestamp> = HashMap::new();
        for i in 0..MAX_PENDING as u64 {
            pending.insert(i.to_string(), 100 + i);
        }
        make_room(&mut pending, 200, 1_000_000, |at| *at);
        assert_eq!(pending.len(), MAX_PENDING - 1);
        assert!(!pending.contains_key("0"), "the oldest went");
        // Expired entries are enough when there are any.
        pending.insert("new".into(), 200);
        make_room(&mut pending, 250, 100, |at| *at);
        assert_eq!(pending.len(), MAX_PENDING - 50);
        assert!(pending.contains_key("new"));
    }
}
