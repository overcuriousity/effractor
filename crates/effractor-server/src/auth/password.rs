use std::net::IpAddr;

use axum::Json;
use axum::extract::State;
use axum::http::{Extensions, HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use effractor_accounts::{sessions, users};
use serde::Deserialize;

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
    let user = accounts
        .blocking(move |db| db.read(|c| users::login(c, &body.name, &body.password)))
        .await?;
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
        [(header::SET_COOKIE, clear_cookie())],
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
