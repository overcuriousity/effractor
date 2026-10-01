//! Administration (spec §8, §9.4). Admins manage everyone; a group's admins
//! manage that group's members and, where the group allows, create users in it.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, patch, put};
use axum::{Json, Router};
use effractor_accounts::users::{self, NewUser, User};
use effractor_accounts::{Connection, Error, Id, documents, groups, sessions};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::accounts::Accounts;
use crate::api::{ApiError, checked};
use crate::auth::password::hash_turn;
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
                    // A group's admin learns nothing beyond their groups: not
                    // the member's other groups, nor what they keep.
                    let documents = match &scope {
                        Scope::All => Some(documents::count(c, u.id)?),
                        Scope::Groups(_) => None,
                    };
                    let gs: Vec<groups::Membership> = groups::of_user(c, u.id)?
                        .into_iter()
                        .filter(|g| match &scope {
                            Scope::All => true,
                            Scope::Groups(mine) => mine.contains(&g.id),
                        })
                        .collect();
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
    // The password is hashed: in its turn.
    let turn = hash_turn().await;
    let id = checked(&accounts, move |t, now| {
        let _turn = turn;
        // A group's admin, into a group that allows it: read where the
        // write is, so neither can change in between.
        if !user.admin {
            let allowed = match body.group {
                Some(g) => {
                    groups::role_in(t, g, user.id)?.as_deref() == Some("admin")
                        && groups::flag(t, g)?
                }
                None => false,
            };
            if !allowed {
                return Ok(Err(ApiError::Forbidden));
            }
        }
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
        Ok(Ok(id))
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
    // A new password is hashed: in its turn.
    let turn = match body.password {
        Some(_) => Some(hash_turn().await),
        None => None,
    };
    accounts
        .blocking(move |db| {
            let _turn = turn;
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

/// For a group admin: only this group, only plain members. Read in the
/// transaction that writes, so neither role can change in between.
fn may_manage(
    c: &Connection,
    actor: &User,
    group: Id,
    member: Id,
) -> effractor_accounts::Result<Result<(), ApiError>> {
    if actor.admin {
        return Ok(Ok(()));
    }
    let mine = groups::role_in(c, group, actor.id)?;
    let theirs = groups::role_in(c, group, member)?;
    if mine.as_deref() != Some("admin") || theirs.as_deref() == Some("admin") {
        return Ok(Err(ApiError::Forbidden));
    }
    Ok(Ok(()))
}

async fn set_member(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path((group, member)): Path<(Id, Id)>,
    Json(b): Json<MemberRole>,
) -> Result<StatusCode, ApiError> {
    checked(&accounts, move |t, _| {
        if let Err(refused) = may_manage(t, &user, group, member)? {
            return Ok(Err(refused));
        }
        if !user.admin && b.role != "member" {
            return Ok(Err(ApiError::Forbidden));
        }
        groups::set_member(t, group, member, &b.role).map(Ok)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove_member(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path((group, member)): Path<(Id, Id)>,
) -> Result<StatusCode, ApiError> {
    checked(&accounts, move |t, _| {
        if let Err(refused) = may_manage(t, &user, group, member)? {
            return Ok(Err(refused));
        }
        groups::remove_member(t, group, member).map(Ok)
    })
    .await?;
    Ok(StatusCode::NO_CONTENT)
}
