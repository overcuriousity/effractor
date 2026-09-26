use std::net::{IpAddr, Ipv4Addr, SocketAddr};

use axum::Json;
use axum::extract::{ConnectInfo, State};
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

/// Who is asking, for the login limit. Behind a trusted proxy on this host,
/// the address it appended last to X-Forwarded-For; a request from anywhere
/// else cannot choose its address that way.
pub(crate) fn peer(accounts: &Accounts, extensions: &Extensions, headers: &HeaderMap) -> IpAddr {
    let ip = extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |i| i.0.ip());
    if !(accounts.trusts_proxy() && ip.to_canonical().is_loopback()) {
        return ip;
    }
    headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .filter_map(|a| a.trim().parse::<IpAddr>().ok())
        .next_back()
        .unwrap_or(ip)
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
