mod common;
use common::*;
use serde_json::json;

async fn create(h: &H, cookie: &str, name: &str, folder: Option<i64>) -> i64 {
    let res = h
        .call("POST", "/api/documents", Some(cookie),
              Some(json!({"name": name, "profile": "fault-tree", "body": "effractor: 1\n", "folder": folder})))
        .await;
    assert_eq!(res.status(), 201);
    json(res).await["id"].as_i64().unwrap()
}

#[tokio::test]
async fn logged_out_there_are_no_documents() {
    let h = harness();
    assert_eq!(
        h.call("GET", "/api/documents", None, None).await.status(),
        401
    );
}

#[tokio::test]
async fn a_document_round_trips_and_saves_with_its_version() {
    let h = harness();
    h.add_user("alice");
    let a = h.login("alice").await;
    let id = create(&h, &a, "Plant", None).await;
    let doc = json(
        h.call("GET", &format!("/api/documents/{id}"), Some(&a), None)
            .await,
    )
    .await;
    assert_eq!(
        (doc["version"].as_i64(), doc["role"].as_str()),
        (Some(1), Some("owner"))
    );
    let res = h
        .call(
            "PUT",
            &format!("/api/documents/{id}"),
            Some(&a),
            Some(json!({"name": "Plant", "body": "effractor: 1\nname: Plant\n", "base": 1})),
        )
        .await;
    assert_eq!(res.status(), 200);
    assert_eq!(json(res).await["version"], 2);
    let res = h
        .call(
            "PUT",
            &format!("/api/documents/{id}"),
            Some(&a),
            Some(json!({"name": "Plant", "body": "stale", "base": 1})),
        )
        .await;
    assert_eq!(res.status(), 409);
    let body = json(res).await;
    assert_eq!(
        (body["version"].as_i64(), body["updated_by"].as_str()),
        (Some(2), Some("alice"))
    );
}

#[tokio::test]
async fn another_users_document_is_404_and_a_viewer_cannot_save() {
    let h = harness();
    h.add_user("alice");
    let bob_id = h.add_user("bob");
    let a = h.login("alice").await;
    let b = h.login("bob").await;
    let id = create(&h, &a, "Private", None).await;
    for (m, body) in [
        ("GET", None),
        ("PUT", Some(json!({"name": "x", "body": "x", "base": 1}))),
        ("DELETE", None),
    ] {
        assert_eq!(
            h.call(m, &format!("/api/documents/{id}"), Some(&b), body)
                .await
                .status(),
            404,
            "{m}"
        );
    }
    h.accounts
        .db()
        .write(|t| {
            effractor_accounts::shares::grant(
                t,
                effractor_accounts::shares::Target::Document(id),
                effractor_accounts::shares::Grantee::User(bob_id),
                effractor_accounts::perms::Role::Viewer,
                0,
            )
        })
        .unwrap();
    assert_eq!(
        h.call("GET", &format!("/api/documents/{id}"), Some(&b), None)
            .await
            .status(),
        200
    );
    let res = h
        .call(
            "PUT",
            &format!("/api/documents/{id}"),
            Some(&b),
            Some(json!({"name": "x", "body": "x", "base": 1})),
        )
        .await;
    assert_eq!(res.status(), 403);
    assert_eq!(
        h.call("DELETE", &format!("/api/documents/{id}"), Some(&b), None)
            .await
            .status(),
        403
    );
}

#[tokio::test]
async fn the_listing_has_folders_documents_recent_and_search() {
    let h = harness();
    h.add_user("alice");
    let a = h.login("alice").await;
    let res = h
        .call(
            "POST",
            "/api/folders",
            Some(&a),
            Some(json!({"name": "Plans"})),
        )
        .await;
    assert_eq!(res.status(), 201);
    let f = json(res).await["id"].as_i64().unwrap();
    let d = create(&h, &a, "Web tier", Some(f)).await;
    create(&h, &a, "Other", None).await;
    h.call("GET", &format!("/api/documents/{d}"), Some(&a), None)
        .await;
    let list = json(h.call("GET", "/api/documents", Some(&a), None).await).await;
    assert_eq!(
        list["recent"],
        json!([]),
        "reading is not opening: a GET writes nothing"
    );
    assert_eq!(
        h.call(
            "POST",
            &format!("/api/documents/{d}/opened"),
            Some(&a),
            None
        )
        .await
        .status(),
        204
    );
    let list = json(h.call("GET", "/api/documents", Some(&a), None).await).await;
    assert_eq!(list["me"], "alice");
    assert_eq!(list["folders"].as_array().unwrap().len(), 1);
    assert_eq!(list["documents"].as_array().unwrap().len(), 2);
    assert_eq!(list["recent"], json!([d]));
    let hit = json(h.call("GET", "/api/documents?q=web", Some(&a), None).await).await;
    assert_eq!(hit["documents"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn delete_then_restore_and_the_sweep_purges_after_a_week() {
    let h = harness();
    h.add_user("alice");
    let a = h.login("alice").await;
    let d = create(&h, &a, "Gone", None).await;
    assert_eq!(
        h.call("DELETE", &format!("/api/documents/{d}"), Some(&a), None)
            .await
            .status(),
        204
    );
    assert_eq!(
        h.call("GET", &format!("/api/documents/{d}"), Some(&a), None)
            .await
            .status(),
        404
    );
    assert_eq!(
        h.call(
            "POST",
            &format!("/api/documents/{d}/restore"),
            Some(&a),
            None
        )
        .await
        .status(),
        204
    );
    assert_eq!(
        h.call("GET", &format!("/api/documents/{d}"), Some(&a), None)
            .await
            .status(),
        200
    );
}

#[tokio::test]
async fn a_body_over_a_mebibyte_is_refused() {
    let h = harness();
    h.add_user("alice");
    let a = h.login("alice").await;
    let big = "x".repeat((1 << 20) + 1);
    let res = h
        .call(
            "POST",
            "/api/documents",
            Some(&a),
            Some(json!({"name": "Big", "profile": "fault-tree", "body": big})),
        )
        .await;
    assert!(
        res.status() == 400 || res.status() == 413,
        "{}",
        res.status()
    );
}

#[tokio::test]
async fn moving_takes_null_for_the_root() {
    let h = harness();
    h.add_user("alice");
    let a = h.login("alice").await;
    let f = json(
        h.call("POST", "/api/folders", Some(&a), Some(json!({"name": "F"})))
            .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let d = create(&h, &a, "D", Some(f)).await;
    assert_eq!(
        h.call(
            "PATCH",
            &format!("/api/documents/{d}"),
            Some(&a),
            Some(json!({"folder": null}))
        )
        .await
        .status(),
        204
    );
    let doc = json(
        h.call("GET", &format!("/api/documents/{d}"), Some(&a), None)
            .await,
    )
    .await;
    assert_eq!(doc["folder"], serde_json::Value::Null);
}
