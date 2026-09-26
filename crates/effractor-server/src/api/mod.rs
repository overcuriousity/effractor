//! The routes the page uses (spec §10). Internal to the page, not a stable
//! interface; a scripted API with tokens is the later `api-tokens` item.

pub mod account;
pub mod admin;
pub mod documents;
pub mod sharing;

use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use effractor_accounts::Error;

#[derive(Debug)]
pub enum ApiError {
    NotFound,
    /// Wrong name or password (or passkey), said the same for every cause.
    Unauthorized,
    /// No session: a bare 401.
    LoggedOut,
    /// Adding a way to log in wants a login from the last minutes.
    Stale,
    /// Changing the password wants the current one.
    WrongPassword,
    Forbidden,
    TooMany(u64),
    Bad(String),
    Refused(String),
    Conflict(effractor_accounts::Conflict),
    Internal(String),
}

impl From<Error> for ApiError {
    fn from(e: Error) -> Self {
        match e {
            Error::NotFound => ApiError::NotFound,
            Error::Invalid(why) => ApiError::Bad(why),
            Error::Refused(why) => ApiError::Refused(why.to_owned()),
            Error::Exists => ApiError::Refused("taken".to_owned()),
            Error::Conflict(c) => ApiError::Conflict(c),
            other => ApiError::Internal(other.to_string()),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        match self {
            ApiError::NotFound => StatusCode::NOT_FOUND.into_response(),
            ApiError::Unauthorized => {
                (StatusCode::UNAUTHORIZED, "wrong name or password").into_response()
            }
            ApiError::LoggedOut => StatusCode::UNAUTHORIZED.into_response(),
            ApiError::Stale => (StatusCode::FORBIDDEN, "log in again to do this").into_response(),
            ApiError::WrongPassword => {
                (StatusCode::FORBIDDEN, "the current password is wrong").into_response()
            }
            ApiError::Forbidden => StatusCode::FORBIDDEN.into_response(),
            ApiError::TooMany(s) => (
                StatusCode::TOO_MANY_REQUESTS,
                [(axum::http::header::RETRY_AFTER, s.to_string())],
            )
                .into_response(),
            ApiError::Bad(why) => (StatusCode::BAD_REQUEST, why).into_response(),
            ApiError::Refused(why) => (StatusCode::CONFLICT, why).into_response(),
            ApiError::Conflict(c) => (
                StatusCode::CONFLICT,
                Json(serde_json::json!({
                    "version": c.version, "updated_by": c.updated_by, "updated_at": c.updated_at,
                })),
            )
                .into_response(),
            ApiError::Internal(err) => {
                tracing::error!(%err, "accounts failed");
                StatusCode::INTERNAL_SERVER_ERROR.into_response()
            }
        }
    }
}

pub fn routes() -> axum::Router<crate::accounts::Accounts> {
    axum::Router::new()
        .merge(account::routes())
        .merge(documents::routes())
        .merge(sharing::routes())
        .merge(admin::routes())
}
