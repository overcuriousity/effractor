//! OIDC login (spec §7.1–§7.2): authorization code with PKCE, state and nonce.
//! The only outbound connection effractor makes, and only to the issuer the
//! operator configured. The pending login is kept here for ten minutes and
//! bound to the starting browser by a cookie, so a login cannot be finished
//! in a browser that did not start it.

use std::collections::HashMap;
use std::sync::Mutex;

use axum::extract::{Query, State};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use effractor_accounts::{Id, Timestamp, oidc, sessions, users};
use openidconnect::core::{CoreAuthenticationFlow, CoreClient, CoreProviderMetadata};
use openidconnect::{
    AuthorizationCode, ClientId, ClientSecret, CsrfToken, IssuerUrl, Nonce, PkceCodeChallenge,
    PkceCodeVerifier, RedirectUrl, Scope, TokenResponse,
};
use serde::Deserialize;
use serde_json::json;

use super::session::{MaybeUser, set_cookie};
use crate::accounts::{Accounts, OidcConfig};
use crate::api::ApiError;

const PENDING_TTL: Timestamp = 600;
const COOKIE: &str = "effractor_oidc";

struct Pending {
    at: Timestamp,
    verifier: String,
    nonce: String,
    link: Option<Id>,
}

pub struct Oidc {
    cfg: OidcConfig,
    redirect: String,
    /// Where people come back to: the public url, its path included.
    home: String,
    /// The binding cookie's path: the callback's, under the public url's
    /// path, or a browser behind a prefix would not send it back.
    cookie_path: String,
    http: reqwest::Client,
    pending: Mutex<HashMap<String, Pending>>,
    /// The issuer's discovery document, for a few minutes.
    meta: Mutex<Option<(std::time::Instant, CoreProviderMetadata)>>,
}

/// How long discovery is trusted: an issuer that changes keys is followed
/// soon, and a flood of starts does not become a flood of requests to it.
const META_TTL: std::time::Duration = std::time::Duration::from_secs(300);

impl Oidc {
    pub fn new(cfg: OidcConfig, public_url: &str) -> anyhow::Result<Oidc> {
        let http = reqwest::Client::builder()
            // openidconnect's advice: never follow redirects (SSRF).
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let cookie_path = format!("{}/api/auth/oidc", url_path(public_url));
        // Checked once here, so building the cookie later cannot fail.
        if cookie_path.contains(';') || HeaderValue::from_str(&cookie_path).is_err() {
            anyhow::bail!("--public-url has a path no cookie can carry");
        }
        Ok(Oidc {
            redirect: format!("{public_url}/api/auth/oidc/callback"),
            home: format!("{public_url}/"),
            cookie_path,
            cfg,
            http,
            pending: Mutex::new(HashMap::new()),
            meta: Mutex::new(None),
        })
    }

    pub fn label(&self) -> &str {
        &self.cfg.label
    }
}

/// The path of a url without its trailing slash: "" for none.
fn url_path(url: &str) -> &str {
    let after = url.find("://").map_or(0, |i| i + 3);
    url[after..]
        .find('/')
        .map_or("", |slash| &url[after + slash..])
}

/// Discovery on each login: an issuer that was down at startup works as soon
/// as it is up, and its keys are never stale.
async fn metadata(o: &Oidc) -> Result<CoreProviderMetadata, ApiError> {
    if let Some((at, meta)) = o.meta.lock().unwrap_or_else(|e| e.into_inner()).as_ref()
        && at.elapsed() < META_TTL
    {
        return Ok(meta.clone());
    }
    let issuer =
        IssuerUrl::new(o.cfg.issuer.clone()).map_err(|e| ApiError::Internal(e.to_string()))?;
    let meta = CoreProviderMetadata::discover_async(issuer, &o.http)
        .await
        .map_err(|e| ApiError::Internal(format!("OIDC discovery: {e}")))?;
    *o.meta.lock().unwrap_or_else(|e| e.into_inner()) =
        Some((std::time::Instant::now(), meta.clone()));
    Ok(meta)
}

fn client_from(
    o: &Oidc,
    meta: CoreProviderMetadata,
) -> Result<
    CoreClient<
        openidconnect::EndpointSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointNotSet,
        openidconnect::EndpointMaybeSet,
        openidconnect::EndpointMaybeSet,
    >,
    ApiError,
> {
    let redirect =
        RedirectUrl::new(o.redirect.clone()).map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok(CoreClient::from_provider_metadata(
        meta,
        ClientId::new(o.cfg.client_id.clone()),
        Some(ClientSecret::new(o.cfg.secret.clone())),
    )
    .set_redirect_uri(redirect))
}

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/auth/oidc/start", post(start))
        .route("/api/auth/oidc/callback", get(callback))
}

#[derive(Deserialize)]
struct Start {
    #[serde(default)]
    link: bool,
}

async fn start(
    State(accounts): State<Accounts>,
    MaybeUser(who): MaybeUser,
    extensions: axum::http::Extensions,
    headers: HeaderMap,
    Json(body): Json<Start>,
) -> Result<Response, ApiError> {
    let o = accounts.oidc().ok_or(ApiError::NotFound)?;
    accounts.start(super::password::peer(&accounts, &extensions, &headers))?;
    let link = if body.link {
        let (user, token) = who.ok_or(ApiError::LoggedOut)?;
        super::session::fresh(&accounts, &token).await?;
        Some(user.id)
    } else {
        None
    };
    let client = client_from(o, metadata(o).await?)?;
    let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
    let (url, state, nonce) = client
        .authorize_url(
            CoreAuthenticationFlow::AuthorizationCode,
            CsrfToken::new_random,
            Nonce::new_random,
        )
        .add_scope(Scope::new("profile".into()))
        .set_pkce_challenge(challenge)
        .url();
    let now = accounts.db().now();
    {
        let mut p = o.pending.lock().unwrap_or_else(|e| e.into_inner());
        crate::accounts::make_room(&mut p, now, PENDING_TTL, |v| v.at);
        p.insert(
            state.secret().clone(),
            Pending {
                at: now,
                verifier: verifier.secret().clone(),
                nonce: nonce.secret().clone(),
                link,
            },
        );
    }
    let secure = if accounts.secure_cookie() {
        "; Secure"
    } else {
        ""
    };
    let bind = HeaderValue::from_str(&format!(
        "{COOKIE}={}; Path={}; HttpOnly; SameSite=Lax; Max-Age={PENDING_TTL}{secure}",
        state.secret(),
        o.cookie_path
    ))
    .map_err(|e| ApiError::Internal(e.to_string()))?;
    Ok((
        [(header::SET_COOKIE, bind)],
        Json(json!({ "url": url.to_string() })),
    )
        .into_response())
}

#[derive(Deserialize)]
struct Callback {
    code: Option<String>,
    state: Option<String>,
}

fn go(to: &str, cookies: Vec<HeaderValue>) -> Response {
    let mut res = (StatusCode::SEE_OTHER, [(header::LOCATION, to.to_owned())]).into_response();
    for c in cookies {
        res.headers_mut().append(header::SET_COOKIE, c);
    }
    res
}

fn bound_state(headers: &HeaderMap) -> Option<String> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().strip_prefix(COOKIE)?.strip_prefix('='))
        .map(str::to_owned)
        .next()
}

async fn callback(
    State(accounts): State<Accounts>,
    headers: HeaderMap,
    Query(q): Query<Callback>,
) -> Response {
    let (home, path) = accounts.oidc().map_or_else(
        || ("/".to_owned(), "/api/auth/oidc".to_owned()),
        |o| (o.home.clone(), o.cookie_path.clone()),
    );
    let clear = HeaderValue::from_str(&format!(
        "{COOKIE}=; Path={path}; HttpOnly; SameSite=Lax; Max-Age=0"
    ))
    .expect("checked in Oidc::new");
    // The page says how a link went: linked, the identity is somebody
    // else's, or it failed.
    let mut linking = false;
    match finish(&accounts, &headers, q, &mut linking).await {
        Ok(Done::Session(token)) => go(&home, vec![clear, set_cookie(&accounts, &token)]),
        Ok(Done::Linked) => go(&format!("{home}?linked=ok"), vec![clear]),
        Ok(Done::Taken) => go(&format!("{home}?linked=taken"), vec![clear]),
        Err(err) if linking => {
            tracing::warn!(?err, "OIDC link failed");
            go(&format!("{home}?linked=failed"), vec![clear])
        }
        Err(err) => {
            tracing::warn!(?err, "OIDC login failed");
            go(&format!("{home}?login=failed"), vec![clear])
        }
    }
}

enum Done {
    /// A login: the new session's token.
    Session(String),
    /// The identity is now linked to the session that is already there.
    Linked,
    /// The identity is linked to another account already.
    Taken,
}

/// `linking` is set as soon as the pending login says it links.
async fn finish(
    accounts: &Accounts,
    headers: &HeaderMap,
    q: Callback,
    linking: &mut bool,
) -> Result<Done, ApiError> {
    let o = accounts.oidc().ok_or(ApiError::NotFound)?;
    let (Some(code), Some(state)) = (q.code, q.state) else {
        return Err(ApiError::Bad("no code".into()));
    };
    if bound_state(headers).as_deref() != Some(state.as_str()) {
        return Err(ApiError::Bad("not the browser that started".into()));
    }
    let now = accounts.db().now();
    let pending = o
        .pending
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&state)
        .filter(|p| now.saturating_sub(p.at) < PENDING_TTL)
        .ok_or_else(|| ApiError::Bad("expired".into()))?;
    *linking = pending.link.is_some();
    let client = client_from(o, metadata(o).await?)?;
    let tokens = client
        .exchange_code(AuthorizationCode::new(code))
        .map_err(|e| ApiError::Internal(e.to_string()))?
        .set_pkce_verifier(PkceCodeVerifier::new(pending.verifier))
        .request_async(&o.http)
        .await
        .map_err(|e| ApiError::Bad(format!("token: {e}")))?;
    let id_token = tokens
        .id_token()
        .ok_or_else(|| ApiError::Bad("no id token".into()))?;
    let claims = id_token
        .claims(&client.id_token_verifier(), &Nonce::new(pending.nonce))
        .map_err(|e| ApiError::Bad(format!("id token: {e}")))?;
    let issuer = o.cfg.issuer.clone();
    let subject = claims.subject().to_string();
    let preferred = claims.preferred_username().map(|u| u.to_string());
    let display = claims
        .name()
        .and_then(|n| n.get(None))
        .map(|n| n.to_string())
        .unwrap_or_default();

    if let Some(user) = pending.link {
        return accounts
            .blocking(
                move |db| match db.write(|t| oidc::link(t, user, &issuer, &subject)) {
                    Ok(()) => Ok(Done::Linked),
                    Err(effractor_accounts::Error::Exists) => Ok(Done::Taken),
                    Err(err) => Err(err),
                },
            )
            .await;
    }
    let token = accounts
        .blocking(move |db| {
            db.write(|t| {
                let id = match oidc::find(t, &issuer, &subject)? {
                    Some(id) => id,
                    None => {
                        oidc::provision(t, &issuer, &subject, preferred.as_deref(), &display, now)?
                    }
                };
                let user = users::get(t, id)?.ok_or(effractor_accounts::Error::NotFound)?;
                if user.disabled {
                    return Err(effractor_accounts::Error::Refused("disabled"));
                }
                sessions::create(t, id, now)
            })
        })
        .await?;
    Ok(Done::Session(token))
}
