//! Passkeys (spec §7.1): registration from the account dialog, usernameless
//! login. Ceremony state lives here for five minutes, used at most once.

use std::collections::HashMap;
use std::sync::Mutex;

use axum::extract::{Path, State};
use axum::http::{Extensions, HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, patch, post};
use axum::{Json, Router};
use effractor_accounts::{Id, Timestamp, passkeys, sessions, token};
use serde::Deserialize;
use serde_json::{Value, json};
use webauthn_rs::prelude::*;
use webauthn_rs_proto::ResidentKeyRequirement;

use super::password::peer;
use super::session::{CurrentUser, set_cookie};
use crate::accounts::Accounts;
use crate::api::ApiError;

const CEREMONY_TTL: Timestamp = 300;

enum Ceremony {
    Register {
        user: Id,
        state: PasskeyRegistration,
    },
    Login(DiscoverableAuthentication),
}

pub struct Passkeys {
    webauthn: Webauthn,
    ceremonies: Mutex<HashMap<String, (Timestamp, Ceremony)>>,
}

impl Passkeys {
    pub fn new(public_url: &str) -> anyhow::Result<Passkeys> {
        let origin = Url::parse(public_url)?;
        let rp_id = origin
            .host_str()
            .ok_or_else(|| anyhow::anyhow!("--public-url has no host"))?
            .to_owned();
        let webauthn = WebauthnBuilder::new(&rp_id, &origin)?
            .rp_name("effractor")
            .build()?;
        Ok(Passkeys {
            webauthn,
            ceremonies: Mutex::new(HashMap::new()),
        })
    }

    /// Kept for CEREMONY_TTL.
    fn keep(&self, now: Timestamp, c: Ceremony) -> String {
        let id = token();
        let mut map = self.ceremonies.lock().unwrap_or_else(|e| e.into_inner());
        crate::accounts::make_room(&mut map, now, CEREMONY_TTL, |(at, _)| *at);
        map.insert(id.clone(), (now, c));
        id
    }

    fn take(&self, now: Timestamp, id: &str) -> Option<Ceremony> {
        let mut map = self.ceremonies.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(id)
            .filter(|(at, _)| now.saturating_sub(*at) < CEREMONY_TTL)
            .map(|(_, c)| c)
    }
}

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/auth/passkey/start", post(login_start))
        .route("/api/auth/passkey/finish", post(login_finish))
        .route("/api/account/passkeys", get(list))
        .route("/api/account/passkeys/start", post(register_start))
        .route("/api/account/passkeys/finish", post(register_finish))
        .route("/api/account/passkeys/{id}", patch(rename).delete(remove))
}

fn enabled(accounts: &Accounts) -> Result<&Passkeys, ApiError> {
    accounts.passkeys().ok_or(ApiError::NotFound)
}

async fn register_start(
    State(accounts): State<Accounts>,
    CurrentUser(user, token): CurrentUser,
) -> Result<Json<Value>, ApiError> {
    let pk = enabled(&accounts)?;
    super::session::fresh(&accounts, &token).await?;
    let id = user.id;
    let existing = accounts
        .blocking(move |db| db.read(|c| passkeys::credentials(c, id)))
        .await?;
    let exclude: Vec<CredentialID> = existing
        .iter()
        .filter_map(|(_, json)| serde_json::from_str::<Passkey>(json).ok())
        .map(|p| p.cred_id().clone())
        .collect();
    let handle =
        Uuid::from_slice(&user.webauthn_id).map_err(|e| ApiError::Internal(e.to_string()))?;
    let shown = if user.display_name.is_empty() {
        &user.name
    } else {
        &user.display_name
    };
    let (mut options, state) = pk
        .webauthn
        .start_passkey_registration(handle, &user.name, shown, Some(exclude))
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    // Usernameless login needs the credential kept on the authenticator.
    if let Some(sel) = options.public_key.authenticator_selection.as_mut() {
        sel.require_resident_key = true;
        sel.resident_key = Some(ResidentKeyRequirement::Required);
    }
    let ceremony = pk.keep(
        accounts.db().now(),
        Ceremony::Register {
            user: user.id,
            state,
        },
    );
    Ok(Json(json!({ "ceremony": ceremony, "options": options })))
}

#[derive(Deserialize)]
struct RegisterFinish {
    ceremony: String,
    credential: RegisterPublicKeyCredential,
    label: String,
}

async fn register_finish(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Json(body): Json<RegisterFinish>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let pk = enabled(&accounts)?;
    let now = accounts.db().now();
    let Some(Ceremony::Register { user: owner, state }) = pk.take(now, &body.ceremony) else {
        return Err(ApiError::Bad("start again".into()));
    };
    if owner != user.id {
        return Err(ApiError::Bad("start again".into()));
    }
    let passkey = pk
        .webauthn
        .finish_passkey_registration(&body.credential, &state)
        .map_err(|_| ApiError::Bad("the passkey was not accepted".into()))?;
    let cred_id = passkey.cred_id().as_ref().to_vec();
    let stored = serde_json::to_string(&passkey).map_err(|e| ApiError::Internal(e.to_string()))?;
    let id = accounts
        .blocking(move |db| {
            db.write(|t| passkeys::add(t, user.id, &cred_id, &stored, &body.label, now))
        })
        .await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

async fn login_start(
    State(accounts): State<Accounts>,
    extensions: Extensions,
    headers: HeaderMap,
) -> Result<Json<Value>, ApiError> {
    let pk = enabled(&accounts)?;
    accounts.start(peer(&accounts, &extensions, &headers))?;
    let (mut options, state) = pk
        .webauthn
        .start_discoverable_authentication()
        .map_err(|e| ApiError::Internal(e.to_string()))?;
    // webauthn-rs asks for conditional mediation (autofill only); the page
    // asks from a button, where the browser shows its own passkey picker.
    options.mediation = None;
    let ceremony = pk.keep(accounts.db().now(), Ceremony::Login(state));
    Ok(Json(json!({ "ceremony": ceremony, "options": options })))
}

#[derive(Deserialize)]
struct LoginFinish {
    ceremony: String,
    credential: Value,
}

async fn login_finish(
    State(accounts): State<Accounts>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<LoginFinish>,
) -> Result<Response, ApiError> {
    let pk = enabled(&accounts)?;
    let now = accounts.db().now();
    let ip = peer(&accounts, &extensions, &headers);
    accounts.logins().take(ip, now).map_err(ApiError::TooMany)?;
    let Some(Ceremony::Login(state)) = pk.take(now, &body.ceremony) else {
        return Err(ApiError::Unauthorized);
    };
    let credential: PublicKeyCredential = serde_json::from_value(body.credential)
        .map_err(|_| ApiError::Bad("not a passkey answer".into()))?;
    let (handle, _) = pk
        .webauthn
        .identify_discoverable_authentication(&credential)
        .map_err(|_| ApiError::Unauthorized)?;
    let handle = handle.as_bytes().to_vec();
    let (user, stored) = accounts
        .blocking(move |db| {
            db.read(|c| {
                let Some(u) = passkeys::user_by_handle(c, &handle)? else {
                    return Ok((None, vec![]));
                };
                let creds = passkeys::credentials(c, u.id)?;
                Ok((Some(u), creds))
            })
        })
        .await?;
    let Some(user) = user.filter(|u| !u.disabled) else {
        return Err(ApiError::Unauthorized);
    };
    let mut keys: Vec<(Id, Passkey)> = stored
        .into_iter()
        .filter_map(|(id, json)| serde_json::from_str::<Passkey>(&json).ok().map(|p| (id, p)))
        .collect();
    let discoverable: Vec<DiscoverableKey> = keys.iter().map(|(_, p)| p.into()).collect();
    let result = pk
        .webauthn
        .finish_discoverable_authentication(&credential, state, &discoverable)
        .map_err(|_| ApiError::Unauthorized)?;
    accounts.logins().give_back(ip);
    let updates: Vec<(Id, String)> = keys
        .iter_mut()
        .filter(|(_, p)| p.cred_id() == result.cred_id())
        .filter_map(|(id, p)| {
            p.update_credential(&result);
            serde_json::to_string(p).ok().map(|s| (*id, s))
        })
        .collect();
    let token = accounts
        .blocking(move |db| {
            db.write(|t| {
                for (id, json) in &updates {
                    passkeys::update(t, *id, json, now)?;
                }
                sessions::create(t, user.id, now)
            })
        })
        .await?;
    Ok((
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, set_cookie(&accounts, &token))],
    )
        .into_response())
}

async fn list(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
) -> Result<Json<Vec<passkeys::Row>>, ApiError> {
    enabled(&accounts)?;
    Ok(Json(
        accounts
            .blocking(move |db| db.read(|c| passkeys::list(c, user.id)))
            .await?,
    ))
}

#[derive(Deserialize)]
struct Label {
    label: String,
}

async fn rename(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
    Json(b): Json<Label>,
) -> Result<StatusCode, ApiError> {
    accounts
        .blocking(move |db| db.write(|t| passkeys::rename(t, user.id, id, &b.label)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    accounts
        .blocking(move |db| db.write(|t| passkeys::remove(t, user.id, id)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
