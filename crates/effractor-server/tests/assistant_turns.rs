mod common;
use common::fake_llm::{Fake, Reply};
use common::*;
use serde_json::{Value, json};

struct Chat {
    h: H,
    fake: Fake,
    ann: String,
    doc: i64,
}

async fn chat() -> Chat {
    let (address, fake) = fake_llm::start().await;
    let h = harness();
    let ann_id = h.add_user("ann");
    h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::grant(
                t,
                effractor_accounts::assistant::Grantee::User(ann_id),
                ann_id,
                0,
            )?;
            for (k, v) in [
                ("assistant.provider", "openai"),
                ("assistant.address", address.as_str()),
                ("assistant.model", "fake-small"),
            ] {
                effractor_accounts::assistant::set_setting(t, k, Some(v), ann_id, 0)?;
            }
            Ok(())
        })
        .unwrap();
    let ann = h.login("ann").await;
    let body = "effractor: 2\nprofile: architecture\nname: Lab\ntime_unit: d\nhorizon: 100\nlibrary: {id: core-components, version: 1}\nentities: {}\n";
    let res = h
        .call(
            "POST",
            "/api/documents",
            Some(&ann),
            Some(json!({"name": "Lab", "profile": "architecture", "body": body})),
        )
        .await;
    let doc = json(res).await["id"].as_i64().unwrap();
    Chat { h, fake, ann, doc }
}

/// The SSE body as (event, data) pairs.
async fn events(res: axum::response::Response) -> Vec<(String, Value)> {
    let body = text(res).await;
    body.split("\n\n")
        .filter(|b| !b.trim().is_empty())
        .map(|b| {
            let ev = b
                .lines()
                .find_map(|l| l.strip_prefix("event: "))
                .unwrap_or("")
                .to_owned();
            let data = b
                .lines()
                .find_map(|l| l.strip_prefix("data: "))
                .unwrap_or("null");
            (ev, serde_json::from_str(data).unwrap())
        })
        .collect()
}

async fn session(c: &Chat) -> i64 {
    let res =
        c.h.call(
            "POST",
            &format!("/api/documents/{}/assistant/sessions", c.doc),
            Some(&c.ann),
            None,
        )
        .await;
    assert_eq!(res.status(), 201);
    json(res).await["id"].as_i64().unwrap()
}

#[tokio::test]
async fn a_turn_with_a_tool_call_runs_end_to_end() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake.push(Fake::call(
        "c1",
        "add_entity",
        json!({"kind": "host", "label": "Web"}),
    ));
    let ev = events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "add a web host", "state": "{\"view\":\"architecture\"}"})),
        )
        .await,
    )
    .await;
    assert_eq!(ev[0].0, "tool_call");
    assert_eq!(
        ev.last().unwrap(),
        &("end".into(), json!({"reason": "tools"}))
    );
    // The model saw the prompt, the state as data, and edit tools.
    let seen = c.fake.seen.lock().unwrap()[0].clone();
    assert!(
        seen["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("You work in effractor")
    );
    assert!(
        seen["tools"]
            .as_array()
            .unwrap()
            .iter()
            .any(|t| t["function"]["name"] == "add_entity")
    );
    c.fake.push(Fake::text("Added."));
    let ev = events(c.h.call("POST", &format!("/api/assistant/sessions/{s}/results"), Some(&c.ann),
        Some(json!({"results": [{"id": "c1", "ok": true, "output": "added entity/web"}], "state": ""}))).await).await;
    assert_eq!(ev[0], ("text".into(), json!({"text": "Added."})));
    assert_eq!(ev.last().unwrap().1, json!({"reason": "done"}));
    let got = json(
        c.h.call(
            "GET",
            &format!("/api/assistant/sessions/{s}"),
            Some(&c.ann),
            None,
        )
        .await,
    )
    .await;
    let roles: Vec<_> = got["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["role"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(roles, ["user", "assistant", "tool", "assistant"]);
    assert_eq!(got["session"]["title"], "add a web host");
    assert_eq!(got["turn"], Value::Null);
}

#[tokio::test]
async fn results_must_match_the_open_calls_exactly() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake
        .push(Fake::call("c1", "show", json!({"id": "entity/x"})));
    events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "x", "state": ""})),
        )
        .await,
    )
    .await;
    for bad in [
        json!([]),
        json!([{"id": "nope", "ok": true, "output": ""}]),
        json!([{"id": "c1", "ok": true, "output": ""}, {"id": "c2", "ok": true, "output": ""}]),
    ] {
        let res =
            c.h.call(
                "POST",
                &format!("/api/assistant/sessions/{s}/results"),
                Some(&c.ann),
                Some(json!({"results": bad, "state": ""})),
            )
            .await;
        assert_eq!(res.status(), 400);
    }
}

#[tokio::test]
async fn a_viewers_turn_gets_no_edit_tools() {
    let c = chat().await;
    let bob = c.h.add_user("bob");
    c.h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::grant(
                t,
                effractor_accounts::assistant::Grantee::User(bob),
                bob,
                0,
            )
        })
        .unwrap();
    // Share the document with bob as viewer through the sharing route, as the page does.
    let res =
        c.h.call(
            "POST",
            &format!("/api/documents/{}/shares", c.doc),
            Some(&c.ann),
            Some(json!({"kind": "user", "name": "bob", "role": "viewer"})),
        )
        .await;
    assert!(res.status().is_success());
    let b = c.h.login("bob").await;
    let s = session(&c).await;
    c.fake.push(Fake::text("I can only look."));
    events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&b),
            Some(json!({"text": "add a host", "state": ""})),
        )
        .await,
    )
    .await;
    let seen = c.fake.seen.lock().unwrap()[0].clone();
    let names: Vec<_> = seen["tools"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["function"]["name"].as_str().unwrap().to_owned())
        .collect();
    assert!(names.contains(&"read_document".to_owned()));
    assert!(!names.contains(&"add_entity".to_owned()));
    assert!(
        seen["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("no editing tools")
    );
}

#[tokio::test]
async fn nobody_without_a_grant_sees_anything() {
    let c = chat().await;
    let s = session(&c).await;
    c.h.add_user("eve");
    let e = c.h.login("eve").await;
    assert_eq!(
        json(c.h.call("GET", "/api/assistant", Some(&e), None).await).await["allowed"],
        false
    );
    assert_eq!(
        c.h.call(
            "GET",
            &format!("/api/assistant/sessions/{s}"),
            Some(&e),
            None
        )
        .await
        .status(),
        404
    );
}

#[tokio::test]
async fn a_second_sender_is_told_who_is_asking() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake.push(Fake::call("c1", "read_document", json!({})));
    events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "a", "state": ""})),
        )
        .await,
    )
    .await;
    let res =
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "b", "state": ""})),
        )
        .await;
    assert_eq!(res.status(), 409);
    assert_eq!(text(res).await, "ann is asking");
}

#[tokio::test]
async fn a_turn_left_hanging_is_released_and_its_calls_marked_not_run() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake.push(Fake::call("c1", "read_document", json!({})));
    events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "a", "state": ""})),
        )
        .await,
    )
    .await;
    // The page went away; time passes beyond steps × timeout.
    c.h.clock
        .fetch_add(50 * 120 + 1, std::sync::atomic::Ordering::Relaxed);
    c.fake.push(Fake::text("again"));
    let res =
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "b", "state": ""})),
        )
        .await;
    assert_eq!(res.status(), 200);
    events(res).await;
    let got = json(
        c.h.call(
            "GET",
            &format!("/api/assistant/sessions/{s}"),
            Some(&c.ann),
            None,
        )
        .await,
    )
    .await;
    let tool = got["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["role"] == "tool")
        .unwrap()
        .clone();
    assert_eq!(
        tool["content"][0],
        json!({"type": "tool_result", "id": "c1", "ok": false, "output": "not run"})
    );
    // And the provider saw a valid history: a tool message for c1 before "b".
    let last = c.fake.seen.lock().unwrap().last().unwrap().clone();
    assert!(
        last["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["role"] == "tool" && m["tool_call_id"] == "c1")
    );
}

#[tokio::test]
async fn the_step_limit_ends_the_turn_with_steps() {
    let c = chat().await;
    c.h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::set_setting(t, "assistant.steps", Some("1"), 1, 0)
        })
        .unwrap();
    let s = session(&c).await;
    c.fake.push(Fake::call("c1", "read_document", json!({})));
    let ev = events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "a", "state": ""})),
        )
        .await,
    )
    .await;
    assert_eq!(ev.last().unwrap().1, json!({"reason": "steps"}));
}

#[tokio::test]
async fn a_provider_error_is_a_short_reason_and_the_turn_is_released() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake.push(Reply::Status(429, "slow down".into()));
    let ev = events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "a", "state": ""})),
        )
        .await,
    )
    .await;
    assert_eq!(
        ev.last().unwrap(),
        &(
            "error".into(),
            json!({"code": "rate_limited", "reason": "rate-limited by the provider"})
        )
    );
    c.fake.push(Fake::text("ok"));
    let res =
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "b", "state": ""})),
        )
        .await;
    assert_eq!(res.status(), 200, "released");
}

#[tokio::test]
async fn the_daily_budget_holds() {
    let c = chat().await;
    c.h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::set_setting(t, "assistant.daily_tokens", Some("5"), 1, 0)
        })
        .unwrap();
    let s = session(&c).await;
    c.fake.push(Fake::text("ok")); // reports 10 + 2 tokens
    events(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "a", "state": ""})),
        )
        .await,
    )
    .await;
    let res =
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&c.ann),
            Some(json!({"text": "b", "state": ""})),
        )
        .await;
    assert_eq!(res.status(), 429);
    assert_eq!(text(res).await, "daily budget reached");
}

#[tokio::test]
async fn only_the_starter_or_the_owner_renames_and_deletes() {
    let c = chat().await;
    let s = session(&c).await;
    let bob = c.h.add_user("bob");
    c.h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::grant(
                t,
                effractor_accounts::assistant::Grantee::User(bob),
                bob,
                0,
            )
        })
        .unwrap();
    c.h.call(
        "POST",
        &format!("/api/documents/{}/shares", c.doc),
        Some(&c.ann),
        Some(json!({"kind": "user", "name": "bob", "role": "editor"})),
    )
    .await;
    let b = c.h.login("bob").await;
    assert_eq!(
        c.h.call(
            "DELETE",
            &format!("/api/assistant/sessions/{s}"),
            Some(&b),
            None
        )
        .await
        .status(),
        403
    );
    assert_eq!(
        c.h.call(
            "PATCH",
            &format!("/api/assistant/sessions/{s}"),
            Some(&c.ann),
            Some(json!({"title": "Lab work"}))
        )
        .await
        .status(),
        204
    );
    assert_eq!(
        c.h.call(
            "DELETE",
            &format!("/api/assistant/sessions/{s}"),
            Some(&c.ann),
            None
        )
        .await
        .status(),
        204
    );
    assert_eq!(
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/restore"),
            Some(&c.ann),
            None
        )
        .await
        .status(),
        204
    );
}
