//! Documents and folders (spec §6, §10).

use axum::extract::{DefaultBodyLimit, Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use axum::{Json, Router};
use effractor_accounts::perms::{self, Role};
use effractor_accounts::{Error, Id, documents, folders};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::accounts::Accounts;
use crate::api::{ApiError, with_role};
use crate::auth::session::CurrentUser;

const BODY_LIMIT: usize = 2 << 20;

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/documents", get(list).post(create))
        .route(
            "/api/documents/{id}",
            get(open).put(save).patch(move_doc).delete(delete),
        )
        .route("/api/documents/{id}/restore", post(restore))
        .route("/api/documents/{id}/opened", post(opened))
        .route("/api/folders", post(create_folder))
        .route(
            "/api/folders/{id}",
            axum::routing::patch(change_folder).delete(delete_folder),
        )
        .route("/api/folders/{id}/restore", post(restore_folder))
        .layer(DefaultBodyLimit::max(BODY_LIMIT))
}

/// `Some(null)` and `Some(id)` are both a destination; absent is "no change".
/// Read where the write is, after the role: whoever may not move it learns
/// that first.
fn destination(v: &Value) -> effractor_accounts::Result<Option<Id>> {
    match v {
        Value::Null => Ok(None),
        Value::Number(n) => n
            .as_i64()
            .map(Some)
            .ok_or_else(|| Error::Invalid("not a folder".into())),
        _ => Err(Error::Invalid("not a folder".into())),
    }
}

#[derive(Deserialize)]
struct Search {
    q: Option<String>,
}

async fn list(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Query(search): Query<Search>,
) -> Result<Json<Value>, ApiError> {
    let me = user.name.clone();
    let (visible, recent) = accounts
        .blocking(move |db| {
            db.read(|c| {
                Ok((
                    perms::visible(c, user.id, search.q.as_deref())?,
                    documents::recent(c, user.id)?,
                ))
            })
        })
        .await?;
    let recent: Vec<Id> = recent
        .into_iter()
        .filter(|id| visible.documents.iter().any(|d| d.id == *id))
        .collect();
    Ok(Json(
        json!({ "me": me, "recent": recent, "folders": visible.folders, "documents": visible.documents }),
    ))
}

#[derive(Deserialize)]
struct NewDoc {
    name: String,
    profile: String,
    body: String,
    folder: Option<Id>,
}

async fn create(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Json(new): Json<NewDoc>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let doc = accounts
        .blocking(move |db| {
            let now = db.now();
            let id = db.write(|t| {
                documents::create(
                    t,
                    user.id,
                    new.folder,
                    &new.name,
                    &new.profile,
                    &new.body,
                    now,
                )
            })?;
            db.read(|c| documents::get(c, id))
        })
        .await?
        .ok_or(ApiError::NotFound)?;
    let mut v = serde_json::to_value(&doc).map_err(|e| ApiError::Internal(e.to_string()))?;
    v["role"] = json!("owner");
    v.as_object_mut().map(|o| o.remove("body"));
    Ok((StatusCode::CREATED, Json(v)))
}

async fn open(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<Json<Value>, ApiError> {
    let (doc, role) = accounts
        .blocking(move |db| {
            let role = db.read(|c| perms::document_role(c, user.id, id))?;
            let doc = db.read(|c| documents::get(c, id))?;
            Ok((doc, role))
        })
        .await?;
    let (Some(doc), Some(role)) = (doc, role) else {
        return Err(ApiError::NotFound);
    };
    let mut v = serde_json::to_value(&doc).map_err(|e| ApiError::Internal(e.to_string()))?;
    v["role"] = json!(role.as_str());
    Ok(Json(v))
}

/// The page opened it: Recent (spec §9.2). A POST, so that reading a
/// document never writes.
async fn opened(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    with_role(
        &accounts,
        Role::Viewer,
        move |c| perms::document_role(c, user.id, id),
        move |t, now| documents::opened(t, user.id, id, now),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct Save {
    name: String,
    body: String,
    base: i64,
}

async fn save(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
    Json(s): Json<Save>,
) -> Result<Json<Value>, ApiError> {
    let (version, at) = with_role(
        &accounts,
        Role::Editor,
        move |c| perms::document_role(c, user.id, id),
        move |t, now| {
            let v = documents::save(t, id, user.id, s.base, &s.name, &s.body, now)?;
            Ok((v, now))
        },
    )
    .await?;
    Ok(Json(json!({ "version": version, "updated_at": at })))
}

async fn move_doc(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
    Json(body): Json<Value>,
) -> Result<StatusCode, ApiError> {
    with_role(
        &accounts,
        Role::Owner,
        move |c| perms::document_role(c, user.id, id),
        move |t, _| {
            let to = body
                .get("folder")
                .ok_or_else(|| Error::Invalid("folder?".into()))?;
            documents::move_to(t, user.id, id, destination(to)?)
        },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    with_role(
        &accounts,
        Role::Owner,
        move |c| perms::document_role(c, user.id, id),
        move |t, now| documents::delete(t, user.id, id, now),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    accounts
        .blocking(move |db| db.write(|t| documents::restore(t, user.id, id)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct NewFolder {
    name: String,
    parent: Option<Id>,
}

async fn create_folder(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Json(new): Json<NewFolder>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    let id = accounts
        .blocking(move |db| db.write(|t| folders::create(t, user.id, new.parent, &new.name)))
        .await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

async fn change_folder(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
    Json(body): Json<Value>,
) -> Result<StatusCode, ApiError> {
    with_role(
        &accounts,
        Role::Owner,
        move |c| perms::folder_role(c, user.id, id),
        move |t, _| {
            let parent = body.get("parent").map(destination).transpose()?;
            if let Some(n) = body.get("name").and_then(Value::as_str) {
                folders::rename(t, user.id, id, n)?;
            }
            if let Some(p) = parent {
                folders::move_to(t, user.id, id, p)?;
            }
            Ok(())
        },
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_folder(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    with_role(
        &accounts,
        Role::Owner,
        move |c| perms::folder_role(c, user.id, id),
        move |t, now| folders::delete(t, user.id, id, now),
    )
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore_folder(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    accounts
        .blocking(move |db| db.write(|t| folders::restore(t, user.id, id)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
