mod common;
use common::*;
use serde_json::json;

async fn doc(h: &H, cookie: &str) -> i64 {
    let res = h
        .call(
            "POST",
            "/api/documents",
            Some(cookie),
            Some(json!({"name": "D", "profile": "fault-tree", "body": "x"})),
        )
        .await;
    json(res).await["id"].as_i64().unwrap()
}

#[tokio::test]
async fn the_owner_shares_with_a_user_who_then_can_edit_and_the_share_can_be_taken_back() {
    let h = harness();
    h.add_user("alice");
    h.add_user("bob");
    let (a, b) = (h.login("alice").await, h.login("bob").await);
    let d = doc(&h, &a).await;
    let res = h
        .call(
            "POST",
            &format!("/api/documents/{d}/shares"),
            Some(&a),
            Some(json!({"kind": "user", "name": "BOB", "role": "editor"})),
        )
        .await;
    assert_eq!(res.status(), 201);
    let share = json(res).await;
    assert_eq!(share["grantee_name"], "bob");
    let res = h
        .call(
            "PUT",
            &format!("/api/documents/{d}"),
            Some(&b),
            Some(json!({"name": "D", "body": "y", "base": 1})),
        )
        .await;
    assert_eq!(res.status(), 200);
    let list = json(
        h.call("GET", &format!("/api/documents/{d}/shares"), Some(&a), None)
            .await,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(
        h.call(
            "DELETE",
            &format!("/api/shares/{}", share["id"]),
            Some(&a),
            None
        )
        .await
        .status(),
        204
    );
    assert_eq!(
        h.call("GET", &format!("/api/documents/{d}"), Some(&b), None)
            .await
            .status(),
        404
    );
}

#[tokio::test]
async fn only_the_owner_sees_and_changes_shares() {
    let h = harness();
    h.add_user("alice");
    h.add_user("bob");
    let (a, b) = (h.login("alice").await, h.login("bob").await);
    let d = doc(&h, &a).await;
    let share = json(
        h.call(
            "POST",
            &format!("/api/documents/{d}/shares"),
            Some(&a),
            Some(json!({"kind": "user", "name": "bob", "role": "editor"})),
        )
        .await,
    )
    .await;
    assert_eq!(
        h.call("GET", &format!("/api/documents/{d}/shares"), Some(&b), None)
            .await
            .status(),
        403
    );
    assert_eq!(
        h.call(
            "POST",
            &format!("/api/documents/{d}/shares"),
            Some(&b),
            Some(json!({"kind": "user", "name": "alice", "role": "viewer"}))
        )
        .await
        .status(),
        403
    );
    assert_eq!(
        h.call(
            "DELETE",
            &format!("/api/shares/{}", share["id"]),
            Some(&b),
            None
        )
        .await
        .status(),
        404
    );
}

#[tokio::test]
async fn a_folder_shared_with_a_group_reaches_its_members() {
    let h = harness();
    h.add_user("alice");
    let bob = h.add_user("bob");
    h.accounts
        .db()
        .write(|t| {
            t.execute(
                "INSERT INTO groups (name, name_key) VALUES ('red', 'red')",
                [],
            )?;
            t.execute(
                "INSERT INTO memberships (group_id, user_id, role) VALUES (1, ?1, 'member')",
                [bob],
            )?;
            Ok(())
        })
        .unwrap();
    let (a, b) = (h.login("alice").await, h.login("bob").await);
    let f = json(
        h.call(
            "POST",
            "/api/folders",
            Some(&a),
            Some(json!({"name": "Team"})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let d = json(
        h.call(
            "POST",
            "/api/documents",
            Some(&a),
            Some(json!({"name": "Inside", "profile": "fault-tree", "body": "x", "folder": f})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    assert_eq!(
        h.call(
            "POST",
            &format!("/api/folders/{f}/shares"),
            Some(&a),
            Some(json!({"kind": "group", "name": "red", "role": "viewer"}))
        )
        .await
        .status(),
        201
    );
    let list = json(h.call("GET", "/api/documents", Some(&b), None).await).await;
    assert!(
        list["documents"]
            .as_array()
            .unwrap()
            .iter()
            .any(|x| x["id"] == d && x["role"] == "viewer")
    );
}

#[tokio::test]
async fn the_directory_finds_users_and_groups_but_not_oneself_or_the_disabled() {
    let h = harness();
    h.add_user("alice");
    h.add_user("albert");
    let al = h.add_user("alfred");
    h.add_user("root");
    h.accounts
        .db()
        .write(|t| {
            t.execute("UPDATE users SET admin = 1 WHERE name = 'root'", [])?;
            t.execute("UPDATE users SET disabled = 1 WHERE id = ?1", [al])?;
            t.execute(
                "INSERT INTO groups (name, name_key) VALUES ('alpha team', 'alpha team')",
                [],
            )?;
            Ok(())
        })
        .unwrap();
    let a = h.login("alice").await;
    let found = json(h.call("GET", "/api/directory?q=al", Some(&a), None).await).await;
    let names: Vec<_> = found
        .as_array()
        .unwrap()
        .iter()
        .map(|x| x["name"].as_str().unwrap().to_owned())
        .collect();
    assert!(names.contains(&"albert".to_owned()));
    assert!(names.contains(&"alpha team".to_owned()));
    assert!(!names.contains(&"alice".to_owned()), "not oneself");
    assert!(!names.contains(&"alfred".to_owned()), "not the disabled");
}

/// Spec §5: a role that is not enough is 403, as for documents; no role is 404.
#[tokio::test]
async fn a_shared_folder_cannot_be_renamed_or_deleted_by_its_viewer() {
    let h = harness();
    h.add_user("alice");
    h.add_user("bob");
    let (a, b) = (h.login("alice").await, h.login("bob").await);
    let f = json(
        h.call(
            "POST",
            "/api/folders",
            Some(&a),
            Some(json!({"name": "Team"})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    h.call(
        "POST",
        &format!("/api/folders/{f}/shares"),
        Some(&a),
        Some(json!({"kind": "user", "name": "bob", "role": "editor"})),
    )
    .await;
    assert_eq!(
        h.call(
            "PATCH",
            &format!("/api/folders/{f}"),
            Some(&b),
            Some(json!({"name": "Mine"}))
        )
        .await
        .status(),
        403
    );
    assert_eq!(
        h.call("DELETE", &format!("/api/folders/{f}"), Some(&b), None)
            .await
            .status(),
        403
    );
    h.add_user("eve");
    let e = h.login("eve").await;
    assert_eq!(
        h.call("DELETE", &format!("/api/folders/{f}"), Some(&e), None)
            .await
            .status(),
        404
    );
}

/// Owner, 2026-09-26: the name is content; an editor renames a document.
#[tokio::test]
async fn an_editor_renames_a_shared_document() {
    let h = harness();
    h.add_user("alice");
    h.add_user("bob");
    let (a, b) = (h.login("alice").await, h.login("bob").await);
    let d = doc(&h, &a).await;
    h.call(
        "POST",
        &format!("/api/documents/{d}/shares"),
        Some(&a),
        Some(json!({"kind": "user", "name": "bob", "role": "editor"})),
    )
    .await;
    let res = h
        .call(
            "PUT",
            &format!("/api/documents/{d}"),
            Some(&b),
            Some(json!({"name": "Bob's name", "body": "x", "base": 1})),
        )
        .await;
    assert_eq!(res.status(), 200);
    assert_eq!(
        json(
            h.call("GET", &format!("/api/documents/{d}"), Some(&a), None)
                .await
        )
        .await["name"],
        "Bob's name"
    );
}

/// The directory suggests names; it is not a list of everybody. One letter
/// finds only the user of that very name: names may be one letter long.
#[tokio::test]
async fn the_directory_wants_two_letters_or_a_whole_name() {
    let h = harness();
    h.add_user("alice");
    h.add_user("albert");
    h.add_user("x");
    h.add_user("xavier");
    let a = h.login("alice").await;
    for q in ["", "a"] {
        let found = json(
            h.call("GET", &format!("/api/directory?q={q}"), Some(&a), None)
                .await,
        )
        .await;
        assert_eq!(found, json!([]), "{q:?}");
    }
    let found = json(h.call("GET", "/api/directory?q=al", Some(&a), None).await).await;
    assert_eq!(found.as_array().unwrap().len(), 1);
    let found = json(h.call("GET", "/api/directory?q=X", Some(&a), None).await).await;
    let names: Vec<&str> = found
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["x"]);
}
