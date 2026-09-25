//! `POST /api/share` · `GET /api/share/{id}` · `DELETE /api/share/{id}`.
//!
//! Errors are status codes and nothing more. Unknown, expired and malformed
//! ids are one and the same 404, on purpose: the API does not say which shares
//! once existed. Nothing here logs an id.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Bytes;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State};
use axum::http::{Extensions, HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use sha2::{Digest, Sha256};

use super::limiter::Limiter;
use super::{
    MemoryStorage, ShareId, ShareMeta, Storage, StorageError, Timestamp, Ttl, random_token,
};

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// The longest a share may be asked to live. `Ttl::Never` allows `never`.
    pub max_ttl: Ttl,
    pub max_bytes: usize,
    /// Per address; see [`Limiter`].
    pub creates_per_hour: u32,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_ttl: Ttl::Year1,
            max_bytes: 1024 * 1024,
            creates_per_hour: 30,
        }
    }
}

#[derive(Clone)]
pub struct Shares {
    storage: Arc<dyn Storage>,
    limits: Limits,
    limiter: Arc<Mutex<Limiter>>,
    clock: Arc<dyn Fn() -> Timestamp + Send + Sync>,
}

impl Shares {
    pub fn new(storage: Arc<dyn Storage>, limits: Limits) -> Self {
        Self {
            storage,
            limits,
            limiter: Arc::new(Mutex::new(Limiter::new(limits.creates_per_hour))),
            clock: Arc::new(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map_or(0, |d| d.as_secs())
            }),
        }
    }

    /// Shares that live as long as the process.
    pub fn in_memory() -> Self {
        Self::new(Arc::new(MemoryStorage::default()), Limits::default())
    }

    /// Tests own the time.
    pub fn with_clock(mut self, clock: impl Fn() -> Timestamp + Send + Sync + 'static) -> Self {
        self.clock = Arc::new(clock);
        self
    }

    /// Remove what has expired. Run at startup and hourly.
    pub async fn sweep(&self) -> Result<u64, StorageError> {
        self.storage.sweep((self.clock)()).await
    }

    /// A share that exists and has not expired — whether or not a sweep has
    /// got to it yet.
    async fn live(&self, id: &str) -> Result<Option<(ShareId, Bytes, ShareMeta)>, StorageError> {
        let Ok(id) = id.parse::<ShareId>() else {
            return Ok(None);
        };
        let found = self.storage.get(&id).await?;
        Ok(found
            .filter(|(_, meta)| !meta.expired((self.clock)()))
            .map(|(blob, meta)| (id, blob, meta)))
    }

    /// As `live`, without reading the blob.
    async fn live_meta(&self, id: &str) -> Result<Option<(ShareId, ShareMeta)>, StorageError> {
        let Ok(id) = id.parse::<ShareId>() else {
            return Ok(None);
        };
        let found = self.storage.meta(&id).await?;
        Ok(found
            .filter(|meta| !meta.expired((self.clock)()))
            .map(|meta| (id, meta)))
    }
}

pub fn routes(shares: Shares) -> Router {
    let limit = shares.limits.max_bytes;
    Router::new()
        .route(
            "/api/share",
            post(create).layer(DefaultBodyLimit::max(limit)),
        )
        .route("/api/share/{id}", get(fetch).delete(remove))
        .with_state(shares)
}

fn hash(token: &str) -> String {
    Sha256::digest(token.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Without an early exit, so the time taken says nothing about where two
/// hashes first differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len()
        && a.bytes()
            .zip(b.bytes())
            .fold(0, |acc, (x, y)| acc | (x ^ y))
            == 0
}

fn failed(err: &StorageError) -> Response {
    tracing::error!(%err, "share storage failed");
    StatusCode::INTERNAL_SERVER_ERROR.into_response()
}

async fn create(
    State(shares): State<Shares>,
    Query(query): Query<HashMap<String, String>>,
    extensions: Extensions,
    blob: Bytes,
) -> Response {
    let limits = shares.limits;
    let ttl = match query.get("ttl").map(|s| s.parse::<Ttl>()) {
        // The default is 90 days, or the operator's cap if that is shorter.
        None => Ttl::DEFAULT.min(limits.max_ttl),
        Some(Ok(ttl)) if ttl <= limits.max_ttl => ttl,
        Some(Ok(_)) => {
            let message = format!("this server keeps shares for at most {}", limits.max_ttl);
            return (StatusCode::BAD_REQUEST, message).into_response();
        }
        Some(Err(message)) => return (StatusCode::BAD_REQUEST, message).into_response(),
    };
    if blob.is_empty() {
        return (StatusCode::BAD_REQUEST, "nothing to share").into_response();
    }

    let now = (shares.clock)();
    // The peer's address. Behind a reverse proxy that is the proxy, and the
    // limit is then one for everybody — which a proxy can do better itself.
    let ip = extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |info| info.0.ip());
    let limiter = || shares.limiter.lock().unwrap_or_else(|e| e.into_inner());
    // Taken before the write, so that concurrent requests cannot all pass the
    // check; given back if the write fails, which is not the client's doing.
    let taken = limiter().take(ip, now);
    if let Err(seconds) = taken {
        let retry = [(header::RETRY_AFTER, seconds.to_string())];
        return (StatusCode::TOO_MANY_REQUESTS, retry).into_response();
    }

    let id = ShareId::random();
    let delete_token = random_token();
    let expires_at = ttl.seconds().map(|s| now + s);
    let meta = ShareMeta {
        expires_at,
        delete_token_hash: hash(&delete_token),
        size: blob.len() as u64,
    };
    if let Err(err) = shares.storage.put(&id, blob, meta).await {
        limiter().give_back(ip);
        return failed(&err);
    }
    let body = serde_json::json!({
        "id": id.as_str(),
        "delete_token": delete_token,
        "expires_at": expires_at,
    });
    (
        StatusCode::CREATED,
        [(header::CACHE_CONTROL, "no-store")],
        Json(body),
    )
        .into_response()
}

async fn fetch(State(shares): State<Shares>, Path(id): Path<String>) -> Response {
    match shares.live(&id).await {
        Ok(Some((_, blob, _))) => {
            let headers = [
                (header::CONTENT_TYPE, "application/octet-stream"),
                (header::CACHE_CONTROL, "no-store"),
            ];
            (headers, blob).into_response()
        }
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => failed(&err),
    }
}

async fn remove(
    State(shares): State<Shares>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Response {
    let (id, meta) = match shares.live_meta(&id).await {
        Ok(Some(found)) => found,
        Ok(None) => return StatusCode::NOT_FOUND.into_response(),
        Err(err) => return failed(&err),
    };
    let token = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .unwrap_or("");
    // Whoever has the id can already fetch the share, so a 403 tells them
    // nothing new — and tells a confused client what is actually wrong.
    if !same(&hash(token), &meta.delete_token_hash) {
        return StatusCode::FORBIDDEN.into_response();
    }
    match shares.storage.delete(&id).await {
        Ok(true) => StatusCode::NO_CONTENT.into_response(),
        Ok(false) => StatusCode::NOT_FOUND.into_response(),
        Err(err) => failed(&err),
    }
}
