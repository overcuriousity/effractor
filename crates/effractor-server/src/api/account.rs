//! `/api/me` and `/api/account` (spec §7.4, §10).

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, patch};
use axum::{Json, Router};
use effractor_accounts::{Error, sessions, users};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::accounts::Accounts;
use crate::api::ApiError;
use crate::auth::session::{CurrentUser, MaybeUser};

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/me", get(me))
        .route("/api/account", patch(update))
        .route("/api/account/oidc", axum::routing::delete(unlink_oidc))
}

async fn me(
    State(accounts): State<Accounts>,
    MaybeUser(who): MaybeUser,
) -> Result<Json<Value>, ApiError> {
    let login = json!({
        "password": true,
        "passkey": accounts.passkeys_enabled(),
        "oidc": accounts.oidc_label(),
    });
    let Some((user, _)) = who else {
        return Ok(Json(json!({"user": null, "login": login})));
    };
    let id = user.id;
    let (methods, group_admin) = accounts
        .blocking(move |db| {
            db.read(|c| {
                let m = users::login_methods(c, id)?;
                let ga: bool = c.query_row(
                    "SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?1 AND role = 'admin')",
                    [id],
                    |r| r.get(0),
                )?;
                Ok((m, ga))
            })
        })
        .await?;
    Ok(Json(json!({
        "user": {
            "id": user.id, "name": user.name, "display_name": user.display_name,
            "admin": user.admin, "group_admin": group_admin, "methods": methods,
        },
        "login": login,
    })))
}

/// Each field present is changed; `"password": null` removes the password.
#[derive(Deserialize)]
struct Update {
    display_name: Option<String>,
    #[serde(default, deserialize_with = "present")]
    password: Option<Value>,
    /// Needed to change or remove a password that exists (review I5).
    current_password: Option<String>,
}

/// A field that is there, `null` included, is `Some`: serde alone would read
/// `null` as absent, and "remove the password" as "leave it".
fn present<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

async fn update(
    State(accounts): State<Accounts>,
    CurrentUser(user, token): CurrentUser,
    Json(body): Json<Update>,
) -> Result<StatusCode, ApiError> {
    // Absent: unchanged. null: removed. A string: set. Anything else: 400.
    let password: Option<Option<String>> = match body.password {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s)),
        Some(_) => return Err(ApiError::Bad("a password is text".into())),
    };
    let display_name = body.display_name;
    if password.is_some() && user.has_password {
        let (name, current) = (user.name.clone(), body.current_password.unwrap_or_default());
        let ok = accounts
            .blocking(move |db| db.read(|c| users::login(c, &name, &current)))
            .await?
            .is_some();
        if !ok {
            return Err(ApiError::WrongPassword);
        }
    }
    accounts
        .blocking(move |db| {
            db.write(|t| {
                if let Some(name) = &display_name {
                    users::set_display_name(t, user.id, name)?;
                }
                if let Some(pw) = &password {
                    if pw.is_none() {
                        let m = users::login_methods(t, user.id)?;
                        if m.passkeys == 0 && !m.oidc {
                            return Err(Error::Refused("the last way to log in stays"));
                        }
                    }
                    users::set_password(t, user.id, pw.as_deref())?;
                    sessions::revoke_all(t, user.id, Some(&token))?;
                }
                Ok(())
            })
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn unlink_oidc(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
) -> Result<StatusCode, ApiError> {
    accounts
        .blocking(move |db| db.write(|t| effractor_accounts::oidc::unlink(t, user.id)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
