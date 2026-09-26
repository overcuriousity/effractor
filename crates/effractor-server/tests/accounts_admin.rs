mod common;
use common::*;
use serde_json::json;

fn admin(h: &H, name: &str) -> i64 {
    let id = h.add_user(name);
    h.accounts
        .db()
        .write(|t| effractor_accounts::users::set_admin(t, id, true))
        .unwrap();
    id
}

#[tokio::test]
async fn an_admin_creates_disables_resets_and_deletes_users() {
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    let res = h
        .call(
            "POST",
            "/api/admin/users",
            Some(&r),
            Some(json!({"name": "carol", "password": PW})),
        )
        .await;
    assert_eq!(res.status(), 201);
    let carol = json(res).await["id"].as_i64().unwrap();
    let c = h.login("carol").await;
    let res = h
        .call(
            "PATCH",
            &format!("/api/admin/users/{carol}"),
            Some(&r),
            Some(json!({"disabled": true})),
        )
        .await;
    assert_eq!(res.status(), 204);
    assert_eq!(
        json(h.call("GET", "/api/me", Some(&c), None).await).await["user"],
        serde_json::Value::Null,
        "sessions end"
    );
    h.call(
        "PATCH",
        &format!("/api/admin/users/{carol}"),
        Some(&r),
        Some(json!({"disabled": false, "password": "a new long password"})),
    )
    .await;
    let res = h
        .call(
            "POST",
            "/api/auth/password",
            None,
            Some(json!({"name": "carol", "password": "a new long password"})),
        )
        .await;
    assert_eq!(res.status(), 204);
    let list = json(h.call("GET", "/api/admin/users", Some(&r), None).await).await;
    assert!(
        list.as_array()
            .unwrap()
            .iter()
            .any(|u| u["name"] == "carol" && u["documents"] == 0)
    );
    assert_eq!(
        h.call(
            "DELETE",
            &format!("/api/admin/users/{carol}"),
            Some(&r),
            None
        )
        .await
        .status(),
        204
    );
}

#[tokio::test]
async fn the_last_admin_cannot_be_demoted_disabled_or_deleted_over_http() {
    let h = harness();
    let root = admin(&h, "root");
    let r = h.login("root").await;
    for body in [json!({"admin": false}), json!({"disabled": true})] {
        assert_eq!(
            h.call(
                "PATCH",
                &format!("/api/admin/users/{root}"),
                Some(&r),
                Some(body)
            )
            .await
            .status(),
            409
        );
    }
    assert_eq!(
        h.call(
            "DELETE",
            &format!("/api/admin/users/{root}"),
            Some(&r),
            None
        )
        .await
        .status(),
        409
    );
}

#[tokio::test]
async fn a_plain_user_has_no_administration() {
    let h = harness();
    h.add_user("bob");
    let b = h.login("bob").await;
    assert_eq!(
        h.call("GET", "/api/admin/users", Some(&b), None)
            .await
            .status(),
        403
    );
    assert_eq!(
        h.call(
            "POST",
            "/api/admin/groups",
            Some(&b),
            Some(json!({"name": "mine"}))
        )
        .await
        .status(),
        403
    );
}

#[tokio::test]
async fn a_group_admin_manages_members_and_creates_users_only_where_allowed() {
    let h = harness();
    admin(&h, "root");
    let lead = h.add_user("lead");
    let other = h.add_user("other");
    let r = h.login("root").await;
    let g = json(
        h.call(
            "POST",
            "/api/admin/groups",
            Some(&r),
            Some(json!({"name": "red"})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    h.call(
        "PUT",
        &format!("/api/admin/groups/{g}/members/{lead}"),
        Some(&r),
        Some(json!({"role": "admin"})),
    )
    .await;
    let l = h.login("lead").await;

    assert_eq!(
        h.call(
            "PUT",
            &format!("/api/admin/groups/{g}/members/{other}"),
            Some(&l),
            Some(json!({"role": "member"}))
        )
        .await
        .status(),
        204
    );
    assert_eq!(
        h.call(
            "PUT",
            &format!("/api/admin/groups/{g}/members/{other}"),
            Some(&l),
            Some(json!({"role": "admin"}))
        )
        .await
        .status(),
        403
    );
    let res = h
        .call(
            "POST",
            "/api/admin/users",
            Some(&l),
            Some(json!({"name": "newbie", "password": PW, "group": g})),
        )
        .await;
    assert_eq!(res.status(), 403, "not while the group does not allow it");
    h.call(
        "PATCH",
        &format!("/api/admin/groups/{g}"),
        Some(&r),
        Some(json!({"admins_may_create_users": true})),
    )
    .await;
    let res = h
        .call(
            "POST",
            "/api/admin/users",
            Some(&l),
            Some(json!({"name": "newbie", "password": PW, "group": g})),
        )
        .await;
    assert_eq!(res.status(), 201);
    let seen = json(h.call("GET", "/api/admin/users", Some(&l), None).await).await;
    let names: Vec<_> = seen
        .as_array()
        .unwrap()
        .iter()
        .map(|u| u["name"].as_str().unwrap().to_owned())
        .collect();
    assert!(
        names.contains(&"newbie".to_owned()) && !names.contains(&"root".to_owned()),
        "{names:?}"
    );
    assert_eq!(
        h.call(
            "PATCH",
            &format!("/api/admin/users/{other}"),
            Some(&l),
            Some(json!({"disabled": true}))
        )
        .await
        .status(),
        403
    );
    assert_eq!(
        h.call(
            "DELETE",
            &format!("/api/admin/groups/{g}/members/{lead}"),
            Some(&l),
            None
        )
        .await
        .status(),
        403,
        "a group admin cannot remove an admin"
    );
}

/// A group's admin sees their members, but not what else those members are
/// in, nor how many documents they keep.
#[tokio::test]
async fn a_group_admin_sees_only_their_groups_of_each_member() {
    let h = harness();
    admin(&h, "root");
    let lead = h.add_user("lead");
    let m = h.add_user("member");
    let r = h.login("root").await;
    let red = json(
        h.call(
            "POST",
            "/api/admin/groups",
            Some(&r),
            Some(json!({"name": "red"})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let blue = json(
        h.call(
            "POST",
            "/api/admin/groups",
            Some(&r),
            Some(json!({"name": "blue"})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    h.call(
        "PUT",
        &format!("/api/admin/groups/{red}/members/{lead}"),
        Some(&r),
        Some(json!({"role": "admin"})),
    )
    .await;
    h.call(
        "PUT",
        &format!("/api/admin/groups/{red}/members/{m}"),
        Some(&r),
        Some(json!({"role": "member"})),
    )
    .await;
    h.call(
        "PUT",
        &format!("/api/admin/groups/{blue}/members/{m}"),
        Some(&r),
        Some(json!({"role": "member"})),
    )
    .await;
    let l = h.login("lead").await;
    let users = json(h.call("GET", "/api/admin/users", Some(&l), None).await).await;
    let member = users
        .as_array()
        .unwrap()
        .iter()
        .find(|u| u["name"] == "member")
        .unwrap()
        .clone();
    let groups: Vec<_> = member["groups"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["name"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(groups, vec!["red"]);
    assert_eq!(member["documents"], serde_json::Value::Null);
}
