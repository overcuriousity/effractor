//! Sharing with users and groups (spec §5, §9.3).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use effractor_accounts::perms::{self, Role};
use effractor_accounts::shares::{self, Grantee, Share, Target};
use effractor_accounts::{Error, Id, users};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::accounts::Accounts;
use crate::api::ApiError;
use crate::auth::session::CurrentUser;

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/documents/{id}/shares", get(list_doc).post(grant_doc))
        .route(
            "/api/folders/{id}/shares",
            get(list_folder).post(grant_folder),
        )
        .route("/api/shares/{id}", delete(revoke))
        .route("/api/directory", get(directory))
}

fn role_of(
    c: &effractor_accounts::Connection,
    user: Id,
    target: Target,
) -> effractor_accounts::Result<Option<Role>> {
    match target {
        Target::Document(id) => perms::document_role(c, user, id),
        Target::Folder(id) => perms::folder_role(c, user, id),
    }
}

async fn owner_only(accounts: &Accounts, user: Id, target: Target) -> Result<(), ApiError> {
    match accounts
        .blocking(move |db| db.read(|c| role_of(c, user, target)))
        .await?
    {
        None => Err(ApiError::NotFound),
        Some(Role::Owner) => Ok(()),
        Some(_) => Err(ApiError::Forbidden),
    }
}

async fn list(accounts: Accounts, user: Id, target: Target) -> Result<Json<Vec<Share>>, ApiError> {
    owner_only(&accounts, user, target).await?;
    Ok(Json(
        accounts
            .blocking(move |db| db.read(|c| shares::list(c, target)))
            .await?,
    ))
}

async fn list_doc(
    State(a): State<Accounts>,
    CurrentUser(u, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<Json<Vec<Share>>, ApiError> {
    list(a, u.id, Target::Document(id)).await
}
async fn list_folder(
    State(a): State<Accounts>,
    CurrentUser(u, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<Json<Vec<Share>>, ApiError> {
    list(a, u.id, Target::Folder(id)).await
}

#[derive(Deserialize)]
struct Grant {
    kind: String,
    name: String,
    role: String,
}

async fn grant(
    accounts: Accounts,
    user: Id,
    target: Target,
    g: Grant,
) -> Result<(StatusCode, Json<Share>), ApiError> {
    owner_only(&accounts, user, target).await?;
    let role = Role::parse(&g.role)?;
    let share = accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| {
                let grantee = match g.kind.as_str() {
                    "user" => {
                        let u = users::by_name(t, &g.name)?
                            .filter(|u| !u.disabled)
                            .ok_or(Error::NotFound)?;
                        Grantee::User(u.id)
                    }
                    "group" => {
                        let id: Id = t
                            .query_row(
                                "SELECT id FROM groups WHERE name_key = fold(?1)",
                                [g.name.trim()],
                                |r| r.get(0),
                            )
                            .map_err(|_| Error::NotFound)?;
                        Grantee::Group(id)
                    }
                    _ => return Err(Error::Invalid("kind is user or group".into())),
                };
                let id = shares::grant(t, target, grantee, role, now)?;
                shares::get(t, id)?.ok_or(Error::NotFound)
            })
        })
        .await
        .map_err(|e| match e {
            ApiError::NotFound => ApiError::Bad("no such user or group".into()),
            other => other,
        })?;
    Ok((StatusCode::CREATED, Json(share)))
}

async fn grant_doc(
    State(a): State<Accounts>,
    CurrentUser(u, _): CurrentUser,
    Path(id): Path<Id>,
    Json(g): Json<Grant>,
) -> Result<(StatusCode, Json<Share>), ApiError> {
    grant(a, u.id, Target::Document(id), g).await
}
async fn grant_folder(
    State(a): State<Accounts>,
    CurrentUser(u, _): CurrentUser,
    Path(id): Path<Id>,
    Json(g): Json<Grant>,
) -> Result<(StatusCode, Json<Share>), ApiError> {
    grant(a, u.id, Target::Folder(id), g).await
}

async fn revoke(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    let share = accounts
        .blocking(move |db| db.read(|c| shares::get(c, id)))
        .await?
        .ok_or(ApiError::NotFound)?;
    let target = if share.target_kind == "document" {
        Target::Document(share.target_id)
    } else {
        Target::Folder(share.target_id)
    };
    // Somebody who is not the owner learns nothing about a share id.
    owner_only(&accounts, user.id, target)
        .await
        .map_err(|_| ApiError::NotFound)?;
    accounts
        .blocking(move |db| db.write(|t| shares::revoke(t, id)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Q {
    q: Option<String>,
}

async fn directory(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Query(q): Query<Q>,
) -> Result<Json<Value>, ApiError> {
    let q = q.q.unwrap_or_default().trim().to_lowercase();
    let rows = accounts
        .blocking(move |db| {
            db.read(|c| {
                let mut s = c.prepare(
                    "SELECT kind, id, name, display_name FROM (
                       SELECT 'user' AS kind, id, name, display_name FROM users WHERE NOT disabled AND id != ?1
                       UNION ALL SELECT 'group', id, name, '' FROM groups)
                     WHERE instr(fold(name), fold(?2)) > 0 OR instr(fold(display_name), fold(?2)) > 0
                     ORDER BY instr(fold(name), fold(?2)) != 1, name LIMIT 10",
                )?;
                let out = s
                    .query_map(effractor_accounts::rusqlite::params![user.id, q], |r| {
                        Ok(json!({ "kind": r.get::<_, String>(0)?, "id": r.get::<_, Id>(1)?,
                                   "name": r.get::<_, String>(2)?, "display_name": r.get::<_, String>(3)? }))
                    })?
                    .collect::<effractor_accounts::rusqlite::Result<Vec<_>>>()?;
                Ok(out)
            })
        })
        .await?;
    Ok(Json(Value::Array(rows)))
}
