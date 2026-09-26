//! The session cookie and who it says is asking.

use axum::extract::{FromRef, FromRequestParts};
use axum::http::request::Parts;
use axum::http::{HeaderValue, header};
use effractor_accounts::sessions;
use effractor_accounts::users::User;

use crate::accounts::Accounts;
use crate::api::ApiError;

pub const COOKIE: &str = "effractor_session";

fn token(parts: &Parts) -> Option<String> {
    parts
        .headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(';'))
        .filter_map(|c| c.trim().strip_prefix(COOKIE)?.strip_prefix('='))
        .map(str::to_owned)
        .next()
}

pub fn set_cookie(accounts: &Accounts, token: &str) -> HeaderValue {
    let secure = if accounts.secure_cookie() {
        "; Secure"
    } else {
        ""
    };
    HeaderValue::from_str(&format!(
        "{COOKIE}={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}{secure}",
        sessions::LIFETIME
    ))
    .expect("a token is base64url")
}

pub fn clear_cookie() -> HeaderValue {
    HeaderValue::from_static("effractor_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")
}

/// Somebody logged in, or 401.
pub struct CurrentUser(pub User, pub String);
/// Whoever is asking, logged in or not.
pub struct MaybeUser(pub Option<(User, String)>);

impl<S: Send + Sync> FromRequestParts<S> for MaybeUser
where
    Accounts: FromRef<S>,
{
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, ApiError> {
        let accounts = Accounts::from_ref(state);
        let Some(token) = token(parts) else {
            return Ok(MaybeUser(None));
        };
        let t = token.clone();
        let user = accounts
            .blocking(move |db| sessions::lookup(db, &t))
            .await?;
        Ok(MaybeUser(user.map(|u| (u, token))))
    }
}

impl<S: Send + Sync> FromRequestParts<S> for CurrentUser
where
    Accounts: FromRef<S>,
{
    type Rejection = ApiError;
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, ApiError> {
        match MaybeUser::from_request_parts(parts, state).await?.0 {
            Some((u, t)) => Ok(CurrentUser(u, t)),
            None => Err(ApiError::LoggedOut),
        }
    }
}
