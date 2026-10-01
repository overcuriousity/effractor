use std::net::IpAddr;
use std::sync::OnceLock;

use axum::Json;
use axum::extract::State;
use axum::http::{Extensions, HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use effractor_accounts::{sessions, users};
use serde::Deserialize;
use tokio::sync::{Semaphore, SemaphorePermit};

use super::session::{CurrentUser, MaybeUser, clear_cookie, set_cookie};
use crate::accounts::Accounts;
use crate::api::ApiError;

#[derive(Deserialize)]
pub struct Login {
    name: String,
    password: String,
}

/// Who is asking, for the login limit (see `crate::client_ip`).
pub(crate) fn peer(accounts: &Accounts, extensions: &Extensions, headers: &HeaderMap) -> IpAddr {
    crate::client_ip(accounts.trusts_proxy(), extensions, headers)
}

/// Who may hash or check a password now. Argon2 takes 19 MiB and a core
/// for a moment; without a bound, a few hundred logins at once would take
/// gigabytes. One at a time per core, all requests together; the rest wait.
pub fn hashing() -> &'static Semaphore {
    static PERMITS: OnceLock<Semaphore> = OnceLock::new();
    PERMITS.get_or_init(|| {
        Semaphore::new(std::thread::available_parallelism().map_or(1, std::num::NonZero::get))
    })
}

/// A turn at Argon2: moved into the blocking closure that hashes, so it is
/// held for as long as the hashing runs, even if the request goes away.
pub(crate) async fn hash_turn() -> SemaphorePermit<'static> {
    hashing()
        .acquire()
        .await
        .expect("the semaphore is never closed")
}

/// Checks `name`'s password in its turn, after giving the database
/// connection back (see `users::LoginCandidate`).
pub(crate) async fn check(
    accounts: &Accounts,
    name: String,
    password: String,
) -> Result<Option<users::User>, ApiError> {
    let turn = hash_turn().await;
    accounts
        .blocking(move |db| {
            let candidate = db.read(|c| users::login_candidate(c, &name))?;
            let user = candidate.verify(&password);
            drop(turn);
            Ok(user)
        })
        .await
}

/// A token is taken per attempt and given back on success, so only failures count.
pub async fn login(
    State(accounts): State<Accounts>,
    extensions: Extensions,
    headers: HeaderMap,
    Json(body): Json<Login>,
) -> Result<Response, ApiError> {
    let ip = peer(&accounts, &extensions, &headers);
    let now = accounts.db().now();
    accounts.logins().take(ip, now).map_err(ApiError::TooMany)?;
    let user = check(&accounts, body.name, body.password).await?;
    let Some(user) = user else {
        return Err(ApiError::Unauthorized);
    };
    accounts.logins().give_back(ip);
    let token = accounts
        .blocking(move |db| db.write(|t| sessions::create(t, user.id, now)))
        .await?;
    Ok((
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, set_cookie(&accounts, &token))],
    )
        .into_response())
}

pub async fn logout(
    State(accounts): State<Accounts>,
    MaybeUser(who): MaybeUser,
) -> Result<Response, ApiError> {
    if let Some((_, token)) = who {
        accounts
            .blocking(move |db| db.write(|t| sessions::revoke(t, &token)))
            .await?;
    }
    Ok((
        StatusCode::NO_CONTENT,
        [(header::SET_COOKIE, clear_cookie(&accounts))],
    )
        .into_response())
}

pub async fn logout_others(
    State(accounts): State<Accounts>,
    CurrentUser(user, token): CurrentUser,
) -> Result<StatusCode, ApiError> {
    accounts
        .blocking(move |db| db.write(|t| sessions::revoke_all(t, user.id, Some(&token))))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
