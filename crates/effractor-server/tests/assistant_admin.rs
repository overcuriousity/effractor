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
async fn only_site_admins_see_and_change_the_chat_settings() {
    let h = harness();
    admin(&h, "root");
    h.add_user("ann");
    let a = h.login("ann").await;
    assert_eq!(
        h.call("GET", "/api/admin/assistant", Some(&a), None)
            .await
            .status(),
        403
    );
    let r = h.login("root").await;
    let got = json(h.call("GET", "/api/admin/assistant", Some(&r), None).await).await;
    assert_eq!(got["config"]["steps"], 50);
    assert_eq!(got["config"]["key_set"], false);
}

#[tokio::test]
async fn the_key_is_stored_but_never_shown_and_stays_when_the_address_changes() {
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    let res = h.call("PUT", "/api/admin/assistant", Some(&r), Some(json!({
        "provider": "openai", "address": "http://127.0.0.1:9/v1", "key": "sk-SECRET", "model": "m"
    }))).await;
    assert_eq!(res.status(), 204);
    let body = text(h.call("GET", "/api/admin/assistant", Some(&r), None).await).await;
    assert!(!body.contains("sk-SECRET"));
    assert!(body.contains("\"key_set\":true"));
    h.call(
        "PUT",
        "/api/admin/assistant",
        Some(&r),
        Some(json!({"address": "http://127.0.0.1:10/v1"})),
    )
    .await;
    let got = json(h.call("GET", "/api/admin/assistant", Some(&r), None).await).await;
    assert_eq!(
        got["config"]["key_set"], true,
        "the key stays: saving needs a recent login already"
    );
}

#[tokio::test]
async fn changes_need_a_recent_login() {
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    h.clock
        .fetch_add(16 * 60, std::sync::atomic::Ordering::Relaxed);
    let res = h
        .call(
            "PUT",
            "/api/admin/assistant",
            Some(&r),
            Some(json!({"model": "m"})),
        )
        .await;
    assert_eq!(res.status(), 403);
}

#[tokio::test]
async fn nonsense_limits_and_addresses_are_refused() {
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    for body in [
        json!({"steps": 0}),
        json!({"address": "ftp://x"}),
        json!({"message_bytes": 10}),
    ] {
        assert_eq!(
            h.call("PUT", "/api/admin/assistant", Some(&r), Some(body))
                .await
                .status(),
            400
        );
    }
}

#[tokio::test]
async fn a_pinned_key_cannot_be_replaced() {
    let h = harness();
    h.accounts.with_pinned_key("sk-PINNED".into());
    admin(&h, "root");
    let r = h.login("root").await;
    let got = json(h.call("GET", "/api/admin/assistant", Some(&r), None).await).await;
    assert_eq!(got["config"]["key_pinned"], true);
    let res = h
        .call(
            "PUT",
            "/api/admin/assistant",
            Some(&r),
            Some(json!({"key": "sk-OTHER"})),
        )
        .await;
    assert_eq!(res.status(), 409);
}

#[tokio::test]
async fn grants_are_given_and_taken() {
    let h = harness();
    admin(&h, "root");
    let ann = h.add_user("ann");
    let r = h.login("root").await;
    assert_eq!(
        h.call(
            "PUT",
            "/api/admin/assistant/grants",
            Some(&r),
            Some(json!({"user": ann}))
        )
        .await
        .status(),
        204
    );
    let got = json(h.call("GET", "/api/admin/assistant", Some(&r), None).await).await;
    assert_eq!(got["grants"], json!([{"user": ann}]));
    assert_eq!(
        h.call(
            "DELETE",
            "/api/admin/assistant/grants",
            Some(&r),
            Some(json!({"user": ann}))
        )
        .await
        .status(),
        204
    );
}

fn seen_auth(fake: &common::fake_llm::Fake) -> Vec<serde_json::Value> {
    fake.seen
        .lock()
        .unwrap()
        .iter()
        .filter(|s| s["path"] == "models")
        .map(|s| s["authorization"].clone())
        .collect()
}

#[tokio::test]
async fn models_are_listed_from_the_typed_address_and_a_stored_key_stays_home() {
    let (address, fake) = common::fake_llm::start().await;
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    h.call(
        "PUT",
        "/api/admin/assistant",
        Some(&r),
        Some(json!({"provider": "openai", "address": address, "key": "sk-STORED-KEY", "model": "fake-small"})),
    )
    .await;
    let got = json(
        h.call(
            "POST",
            "/api/admin/assistant/models",
            Some(&r),
            Some(json!({"provider": "openai", "address": address})),
        )
        .await,
    )
    .await;
    assert_eq!(got["models"][0], json!({"id": "fake-large"}));
    assert_eq!(
        got["models"][1],
        json!({"id": "fake-small", "context": 8192})
    );
    assert_eq!(seen_auth(&fake), vec![json!("Bearer sk-STORED-KEY")]);
    // Another address: a recent login lists with the stored key there, as it
    // could save the address; a typed key wins; an old login sends none.
    let (other, other_fake) = common::fake_llm::start().await;
    let list = |key: Option<&str>| {
        let mut body = json!({"provider": "openai", "address": other});
        if let Some(k) = key {
            body["key"] = json!(k);
        }
        h.call("POST", "/api/admin/assistant/models", Some(&r), Some(body))
    };
    list(None).await;
    list(Some("sk-TYPED")).await;
    h.clock
        .fetch_add(16 * 60, std::sync::atomic::Ordering::Relaxed);
    list(None).await;
    assert_eq!(
        seen_auth(&other_fake),
        vec![
            json!("Bearer sk-STORED-KEY"),
            json!("Bearer sk-TYPED"),
            json!(null)
        ]
    );
}

#[tokio::test]
async fn a_list_that_fails_says_why() {
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    let got = json(
        h.call(
            "POST",
            "/api/admin/assistant/models",
            Some(&r),
            Some(json!({"provider": "openai", "address": "http://127.0.0.1:9/v1"})),
        )
        .await,
    )
    .await;
    assert_eq!(got, json!({"models": [], "reason": "endpoint unreachable"}));
}

#[tokio::test]
async fn test_says_what_happened_in_plain_words() {
    let (address, fake) = common::fake_llm::start().await;
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    h.call(
        "PUT",
        "/api/admin/assistant",
        Some(&r),
        Some(json!({"provider": "openai", "address": address, "model": "fake-small"})),
    )
    .await;
    fake.push(common::fake_llm::Fake::text("ok"));
    let got = json(
        h.call("POST", "/api/admin/assistant/test", Some(&r), None)
            .await,
    )
    .await;
    assert_eq!(got, json!({"ok": true, "said": "answered: ok"}));
    fake.push(common::fake_llm::Reply::Status(
        401,
        "bad key sk-STORED-KEY".into(),
    ));
    let got = json(
        h.call("POST", "/api/admin/assistant/test", Some(&r), None)
            .await,
    )
    .await;
    assert_eq!(got, json!({"ok": false, "said": "key rejected"}));
}

#[tokio::test]
async fn the_user_agent_is_sent_and_test_shows_the_providers_reason_with_the_tools() {
    let (address, fake) = common::fake_llm::start().await;
    let h = harness();
    admin(&h, "root");
    let r = h.login("root").await;
    let res = h
        .call(
            "PUT",
            "/api/admin/assistant",
            Some(&r),
            Some(json!({"provider": "openai", "address": address, "model": "fake-small", "key": "sk-KEY-12345678", "user_agent": "claude-code/0.1.0"})),
        )
        .await;
    assert_eq!(res.status(), 204);
    let got = json(h.call("GET", "/api/admin/assistant", Some(&r), None).await).await;
    assert_eq!(got["config"]["user_agent"], "claude-code/0.1.0");
    fake.push(common::fake_llm::Reply::Status(
        400,
        r#"{"error":{"message":"Invalid request: tools[3].function.parameters is not valid (key sk-KEY-12345678)"}}"#.into(),
    ));
    let got = json(
        h.call("POST", "/api/admin/assistant/test", Some(&r), None)
            .await,
    )
    .await;
    assert_eq!(got["ok"], false);
    let said = got["said"].as_str().unwrap();
    assert!(
        said.starts_with("the endpoint answered 400: Invalid request: tools[3]"),
        "{said}"
    );
    assert!(!said.contains("sk-KEY"), "{said}");
    let seen = fake.seen.lock().unwrap().last().unwrap().clone();
    assert_eq!(seen["_user_agent"], "claude-code/0.1.0");
    assert!(
        seen["tools"].as_array().is_some_and(|t| t.len() > 10),
        "Test sends a turn's tools"
    );
}
