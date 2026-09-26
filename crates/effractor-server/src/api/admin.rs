//! Administration (spec §8, §9.4). Admins manage everyone; a group's admins
//! manage that group's members and, where the group allows, create users in it.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, put};
use axum::{Json, Router};
use effractor_accounts::users::{self, NewUser, User};
use effractor_accounts::{Error, Id, groups, sessions};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::accounts::Accounts;
use crate::api::ApiError;
use crate::auth::session::CurrentUser;

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/admin/users", get(list_users).post(create_user))
        .route(
            "/api/admin/users/{id}",
            patch(change_user).delete(delete_user),
        )
        .route("/api/admin/groups", get(list_groups).post(create_group))
        .route(
            "/api/admin/groups/{id}",
            patch(change_group).delete(delete_group),
        )
        .route(
            "/api/admin/groups/{id}/members/{user}",
            put(set_member).delete(remove_member),
        )
}

/// What the caller may administer: everything, some groups, or nothing (403).
enum Scope {
    All,
    Groups(Vec<Id>),
}

async fn scope(accounts: &Accounts, user: &User) -> Result<Scope, ApiError> {
    if user.admin {
        return Ok(Scope::All);
    }
    let id = user.id;
    let managed = accounts
        .blocking(move |db| db.read(|c| groups::administered(c, id)))
        .await?;
    if managed.is_empty() {
        Err(ApiError::Forbidden)
    } else {
        Ok(Scope::Groups(managed))
    }
}

fn admin_only(user: &User) -> Result<(), ApiError> {
    if user.admin {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

async fn list_users(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
) -> Result<Json<Value>, ApiError> {
    let scope = scope(&accounts, &user).await?;
    let rows = accounts
        .blocking(move |db| {
            db.read(|c| {
                let visible: Option<Vec<Id>> = match &scope {
                    Scope::All => None,
                    Scope::Groups(gs) => {
                        let mut ids = Vec::new();
                        for g in groups::list(c, Some(gs))? {
                            ids.extend(g.members.iter().map(|m| m.id));
                        }
                        Some(ids)
                    }
                };
                let mut out = Vec::new();
                for u in users::all(c)? {
                    if visible.as_ref().is_some_and(|v| !v.contains(&u.id)) {
                        continue;
                    }
                    let methods = users::login_methods(c, u.id)?;
                    let documents: i64 = c.query_row(
                        "SELECT count(*) FROM documents WHERE owner_id = ?1 AND deleted_at IS NULL", [u.id], |r| r.get(0))?;
                    let mut s = c.prepare(
                        "SELECT g.id, g.name, m.role FROM memberships m JOIN groups g ON g.id = m.group_id
                         WHERE m.user_id = ?1 ORDER BY g.name")?;
                    let gs: Vec<Value> = s
                        .query_map([u.id], |r| Ok(json!({"id": r.get::<_, Id>(0)?, "name": r.get::<_, String>(1)?, "role": r.get::<_, String>(2)?})))?
                        .collect::<effractor_accounts::rusqlite::Result<_>>()?;
                    out.push(json!({
                        "id": u.id, "name": u.name, "display_name": u.display_name, "admin": u.admin,
                        "disabled": u.disabled, "methods": methods, "groups": gs, "documents": documents,
                    }));
                }
                Ok(out)
            })
        })
        .await?;
    Ok(Json(Value::Array(rows)))
}

#[derive(Deserialize)]
struct NewUserBody {
    name: String,
    #[serde(default)]
    display_name: String,
    password: String,
    group: Option<Id>,
}

async fn create_user(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Json(body): Json<NewUserBody>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    match scope(&accounts, &user).await? {
        Scope::All => {}
        Scope::Groups(gs) => {
            let Some(g) = body.group.filter(|g| gs.contains(g)) else {
                return Err(ApiError::Forbidden);
            };
            if !accounts
                .blocking(move |db| db.read(|c| groups::flag(c, g)))
                .await?
            {
                return Err(ApiError::Forbidden);
            }
        }
    }
    let id = accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| {
                let id = users::create(
                    t,
                    &NewUser {
                        name: &body.name,
                        display_name: &body.display_name,
                        password: Some(&body.password),
                    },
                    now,
                )?;
                if let Some(g) = body.group {
                    groups::set_member(t, g, id, "member")?;
                }
                Ok(id)
            })
        })
        .await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct ChangeUser {
    display_name: Option<String>,
    admin: Option<bool>,
    disabled: Option<bool>,
    password: Option<String>,
}

async fn change_user(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
    Json(body): Json<ChangeUser>,
) -> Result<StatusCode, ApiError> {
    admin_only(&user)?;
    accounts
        .blocking(move |db| {
            db.write(|t| {
                users::get(t, id)?.ok_or(Error::NotFound)?;
                if let Some(n) = &body.display_name {
                    users::set_display_name(t, id, n)?;
                }
                if let Some(a) = body.admin {
                    users::set_admin(t, id, a)?;
                }
                if let Some(d) = body.disabled {
                    users::set_disabled(t, id, d)?;
                }
                if let Some(pw) = &body.password {
                    users::set_password(t, id, Some(pw))?;
                    sessions::revoke_all(t, id, None)?;
                }
                Ok(())
            })
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_user(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    admin_only(&user)?;
    accounts
        .blocking(move |db| db.write(|t| users::delete(t, id)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_groups(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
) -> Result<Json<Vec<groups::Group>>, ApiError> {
    let only = match scope(&accounts, &user).await? {
        Scope::All => None,
        Scope::Groups(gs) => Some(gs),
    };
    Ok(Json(
        accounts
            .blocking(move |db| db.read(|c| groups::list(c, only.as_deref())))
            .await?,
    ))
}

#[derive(Deserialize)]
struct NewGroup {
    name: String,
}

async fn create_group(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Json(b): Json<NewGroup>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    admin_only(&user)?;
    let id = accounts
        .blocking(move |db| db.write(|t| groups::create(t, &b.name)))
        .await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

#[derive(Deserialize)]
struct ChangeGroup {
    name: Option<String>,
    admins_may_create_users: Option<bool>,
}

async fn change_group(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
    Json(b): Json<ChangeGroup>,
) -> Result<StatusCode, ApiError> {
    admin_only(&user)?;
    accounts
        .blocking(move |db| {
            db.write(|t| {
                if let Some(n) = &b.name {
                    groups::rename(t, id, n)?;
                }
                if let Some(f) = b.admins_may_create_users {
                    groups::set_flag(t, id, f)?;
                }
                Ok(())
            })
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn delete_group(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(id): Path<Id>,
) -> Result<StatusCode, ApiError> {
    admin_only(&user)?;
    accounts
        .blocking(move |db| db.write(|t| groups::delete(t, id)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct MemberRole {
    role: String,
}

/// For a group admin: only this group, only plain members.
async fn may_manage(
    accounts: &Accounts,
    actor: &User,
    group: Id,
    member: Id,
) -> Result<(), ApiError> {
    if actor.admin {
        return Ok(());
    }
    let actor_id = actor.id;
    let (mine, theirs) = accounts
        .blocking(move |db| {
            db.read(|c| {
                Ok((
                    groups::role_in(c, group, actor_id)?,
                    groups::role_in(c, group, member)?,
                ))
            })
        })
        .await?;
    if mine.as_deref() != Some("admin") || theirs.as_deref() == Some("admin") {
        return Err(ApiError::Forbidden);
    }
    Ok(())
}

async fn set_member(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path((group, member)): Path<(Id, Id)>,
    Json(b): Json<MemberRole>,
) -> Result<StatusCode, ApiError> {
    may_manage(&accounts, &user, group, member).await?;
    if !user.admin && b.role != "member" {
        return Err(ApiError::Forbidden);
    }
    accounts
        .blocking(move |db| db.write(|t| groups::set_member(t, group, member, &b.role)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_member(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path((group, member)): Path<(Id, Id)>,
) -> Result<StatusCode, ApiError> {
    may_manage(&accounts, &user, group, member).await?;
    accounts
        .blocking(move |db| db.write(|t| groups::remove_member(t, group, member)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}
