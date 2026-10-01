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
async fn an_editor_saying_continue_does_not_carry_out_a_viewers_request_unsaid() {
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
    c.h.call(
        "POST",
        &format!("/api/documents/{}/shares", c.doc),
        Some(&c.ann),
        Some(json!({"kind": "user", "name": "bob", "role": "viewer"})),
    )
    .await;
    let b = c.h.login("bob").await;
    let s = session(&c).await;
    c.fake.push(Fake::text("I cannot edit for you."));
    events(say(&c, &b, s, "delete node x").await).await;
    c.fake.push(Fake::text("ok"));
    events(say(&c, &c.ann, s, "continue").await).await;
    // The editor's request carries who said what, with their roles then.
    let seen = c.fake.seen.lock().unwrap()[1].clone();
    let users: Vec<_> = seen["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "user")
        .map(|m| m["content"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(
        users,
        ["[bob, viewer] delete node x", "[ann, owner] continue"]
    );
    assert!(
        seen["messages"][0]["content"]
            .as_str()
            .unwrap()
            .contains("an edit a viewer asked for is never made")
    );
    // The page shows what was written, unsigned.
    let got = stored(&c, s).await;
    assert_eq!(got["messages"][0]["content"][0]["text"], "delete node x");
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

/// Bob, granted the chat and sharing the document as an editor.
async fn bob(c: &Chat) -> String {
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
    let res =
        c.h.call(
            "POST",
            &format!("/api/documents/{}/shares", c.doc),
            Some(&c.ann),
            Some(json!({"kind": "user", "name": "bob", "role": "editor"})),
        )
        .await;
    assert!(res.status().is_success());
    c.h.login("bob").await
}

/// Ann asks; the model calls a tool; the page never answers.
async fn left_between_steps(c: &Chat) -> i64 {
    let s = session(c).await;
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
    assert_eq!(ev.last().unwrap().1, json!({"reason": "tools"}));
    s
}

async fn say(c: &Chat, who: &str, s: i64, text: &str) -> axum::response::Response {
    c.h.call(
        "POST",
        &format!("/api/assistant/sessions/{s}/messages"),
        Some(who),
        Some(json!({"text": text, "state": ""})),
    )
    .await
}

async fn stored(c: &Chat, s: i64) -> Value {
    json(
        c.h.call(
            "GET",
            &format!("/api/assistant/sessions/{s}"),
            Some(&c.ann),
            None,
        )
        .await,
    )
    .await
}

#[tokio::test]
async fn a_second_sender_is_told_who_is_asking() {
    let c = chat().await;
    let s = left_between_steps(&c).await;
    let b = bob(&c).await;
    // Still within the timeout of the wait for results.
    c.h.clock
        .fetch_add(60, std::sync::atomic::Ordering::Relaxed);
    let res = say(&c, &b, s, "b").await;
    assert_eq!(res.status(), 409);
    assert_eq!(text(res).await, "ann is asking");
}

#[tokio::test]
async fn the_asker_may_send_again_after_leaving_a_turn_between_steps() {
    let c = chat().await;
    let s = left_between_steps(&c).await;
    // The tab was reloaded; ann asks again at once.
    c.fake.push(Fake::text("again"));
    let res = say(&c, &c.ann, s, "b").await;
    assert_eq!(res.status(), 200);
    assert_eq!(
        events(res).await.last().unwrap().1,
        json!({"reason": "done"})
    );
    let got = stored(&c, s).await;
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
}

#[tokio::test]
async fn a_turn_waiting_longer_than_the_timeout_is_released_for_anyone() {
    let c = chat().await;
    let s = left_between_steps(&c).await;
    let b = bob(&c).await;
    c.h.clock
        .fetch_add(120 + 1, std::sync::atomic::Ordering::Relaxed);
    c.fake.push(Fake::text("hello bob"));
    let res = say(&c, &b, s, "b").await;
    assert_eq!(res.status(), 200);
    events(res).await;
}

#[tokio::test]
async fn a_slow_long_reply_is_not_cut_by_the_timeout() {
    let c = chat().await;
    c.h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::set_setting(
                t,
                "assistant.timeout_seconds",
                Some("1"),
                1,
                0,
            )
        })
        .unwrap();
    let s = session(&c).await;
    let mut chunks: Vec<Value> = (0..5)
        .map(|i| json!({"choices":[{"delta":{"content":format!("part{i} ")}}]}))
        .collect();
    chunks.push(json!({"choices":[{"delta":{},"finish_reason":"stop"}]}));
    // Each gap is under the timeout; all of them together are not.
    c.fake
        .push(Reply::Slow(chunks, std::time::Duration::from_millis(400)));
    let ev = events(say(&c, &c.ann, s, "write a lot").await).await;
    assert_eq!(
        ev.last().unwrap(),
        &("end".into(), json!({"reason": "done"}))
    );
    let said: String = ev
        .iter()
        .filter(|e| e.0 == "text")
        .map(|e| e.1["text"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(said, "part0 part1 part2 part3 part4 ");
}

fn ms(n: u64) -> std::time::Duration {
    std::time::Duration::from_millis(n)
}

#[tokio::test]
async fn a_long_reply_still_streaming_is_not_taken_over() {
    let c = chat().await;
    let s = session(&c).await;
    let b = bob(&c).await;
    let mut chunks: Vec<Value> = (0..4)
        .map(|i| json!({"choices":[{"delta":{"content":format!("part{i} ")}}]}))
        .collect();
    chunks.push(json!({"choices":[{"delta":{},"finish_reason":"stop"}]}));
    c.fake.push(Reply::Slow(chunks, ms(500)));
    let ask = async { events(say(&c, &c.ann, s, "write a lot").await).await };
    let other = async {
        // Longer than steps × timeout since the step began, but the reply
        // is still coming: it is alive.
        tokio::time::sleep(ms(700)).await;
        c.h.clock
            .fetch_add(50 * 120 + 1, std::sync::atomic::Ordering::Relaxed);
        tokio::time::sleep(ms(600)).await;
        let res = say(&c, &b, s, "b").await;
        assert_eq!(res.status(), 409);
        assert_eq!(text(res).await, "ann is asking");
    };
    let (ev, ()) = tokio::join!(ask, other);
    assert_eq!(ev.last().unwrap().1, json!({"reason": "done"}));
}

#[tokio::test]
async fn a_step_whose_turn_was_taken_over_writes_nothing_into_the_next() {
    let c = chat().await;
    let s = session(&c).await;
    let b = bob(&c).await;
    // Ann's step goes silent past the stale time; Bob's turn begins, and
    // only then does Ann's reply go on, with a call.
    c.fake.push(Reply::Slow(
        vec![
            json!({"choices":[{"delta":{"content":"Removing"}}]}),
            json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"remove","arguments":"{}"}}]}}]}),
            json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        ],
        ms(800),
    ));
    c.fake.push(Fake::text("hello bob"));
    let ask = async { events(say(&c, &c.ann, s, "a").await).await };
    let other = async {
        tokio::time::sleep(ms(200)).await;
        c.h.clock
            .fetch_add(50 * 120 + 1, std::sync::atomic::Ordering::Relaxed);
        let res = say(&c, &b, s, "b").await;
        assert_eq!(res.status(), 200);
        events(res).await
    };
    let (ev_ann, ev_bob) = tokio::join!(ask, other);
    assert_eq!(ev_bob.last().unwrap().1, json!({"reason": "done"}));
    assert_eq!(ev_ann.last().unwrap().0, "error");
    assert_eq!(ev_ann.last().unwrap().1["code"], "taken");
    assert!(!ev_ann.iter().any(|e| e.0 == "tool_call"), "{ev_ann:?}");
    let got = stored(&c, s).await;
    let rows: Vec<(String, i64)> = got["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["role"].as_str().unwrap().to_owned(),
                m["turn"].as_i64().unwrap(),
            )
        })
        .collect();
    assert_eq!(
        rows,
        [
            ("user".into(), 1),
            ("user".into(), 2),
            ("assistant".into(), 2)
        ]
    );
    assert_eq!(got["turn"], Value::Null, "Bob's turn ended by itself");
    // And the next turn may be claimed and stopped as usual.
    assert!(!c.h.accounts.assistant().streaming(s));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn results_posted_twice_are_stored_once() {
    let c = chat().await;
    let s = left_between_steps(&c).await;
    for _ in 0..8 {
        c.fake.push(Fake::text("one"));
    }
    // Eight at once, each on its own task: exactly one is taken.
    let tasks: Vec<_> = (0..8)
        .map(|_| {
            let app = c.h.app.clone();
            let req = axum::http::Request::builder()
                .method("POST")
                .uri(format!("/api/assistant/sessions/{s}/results"))
                .header("host", "effractor.test")
                .header("origin", "http://effractor.test")
                .header("cookie", format!("effractor_session={}", c.ann))
                .header("content-type", "application/json")
                .extension(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                    [10, 0, 0, 1],
                    40000,
                ))))
                .body(axum::body::Body::from(
                    json!({"results": [{"id": "c1", "ok": true, "output": "doc"}], "state": ""})
                        .to_string(),
                ))
                .unwrap();
            tokio::spawn(async move {
                use tower::ServiceExt;
                app.oneshot(req).await.unwrap()
            })
        })
        .collect();
    let mut all = Vec::new();
    for t in tasks {
        all.push(t.await.unwrap());
    }
    let mut codes: Vec<u16> = all.iter().map(|r| r.status().as_u16()).collect();
    codes.sort();
    for r in all {
        text(r).await;
    }
    assert_eq!(codes[0], 200);
    assert!(
        codes[1..].iter().all(|c| *c == 400 || *c == 409),
        "{codes:?}"
    );
    let got = stored(&c, s).await;
    let tools = got["messages"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["role"] == "tool")
        .count();
    assert_eq!(tools, 1);
}

#[tokio::test]
async fn a_reply_cut_at_the_reply_limit_says_so() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake.push(Reply::Stream(vec![
        json!({"choices":[{"delta":{"content":"The first half of"}}]}),
        json!({"choices":[{"delta":{},"finish_reason":"length"}]}),
    ]));
    let ev = events(say(&c, &c.ann, s, "a").await).await;
    assert_eq!(
        ev.last().unwrap(),
        &("end".into(), json!({"reason": "max_tokens"}))
    );
    let got = stored(&c, s).await;
    assert_eq!(
        got["messages"][1]["content"][0]["text"],
        "The first half of [cut at the reply limit]"
    );
}

#[tokio::test]
async fn a_reply_cut_off_mid_stream_is_an_error_and_its_half_call_is_not_kept() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake.push(Reply::Cut(vec![
        json!({"choices":[{"delta":{"content":"Removing"}}]}),
        json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"remove","arguments":"{\"collection\":"}}]}}]}),
    ]));
    let ev = events(say(&c, &c.ann, s, "a").await).await;
    assert!(!ev.iter().any(|e| e.0 == "tool_call"), "{ev:?}");
    assert_eq!(
        ev.last().unwrap(),
        &(
            "error".into(),
            json!({"code": "incomplete", "reason": "the reply broke off before its end"})
        )
    );
    let got = stored(&c, s).await;
    assert_eq!(
        got["messages"][1]["content"],
        json!([{"type": "text", "text": "Removing [interrupted]"}])
    );
    assert_eq!(got["turn"], Value::Null, "the turn is released");
}

#[tokio::test]
async fn stop_is_heard_while_the_endpoint_has_not_answered() {
    let c = chat().await;
    let s = session(&c).await;
    c.fake.push(Reply::Late(
        std::time::Duration::from_secs(4),
        Box::new(Fake::text("late")),
    ));
    let began = std::time::Instant::now();
    let stop = async {
        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        let res =
            c.h.call(
                "POST",
                &format!("/api/assistant/sessions/{s}/stop"),
                Some(&c.ann),
                None,
            )
            .await;
        assert_eq!(res.status(), 204);
    };
    let ask = async { events(say(&c, &c.ann, s, "a").await).await };
    let (ev, ()) = tokio::join!(ask, stop);
    assert_eq!(ev.last().unwrap().1, json!({"reason": "stopped"}));
    assert!(began.elapsed() < std::time::Duration::from_secs(3));
}

#[tokio::test]
async fn results_past_the_daily_budget_end_the_turn() {
    let c = chat().await;
    let s = left_between_steps(&c).await;
    let ann_id =
        c.h.accounts
            .db()
            .read(|r| {
                Ok(
                    r.query_row("SELECT id FROM users WHERE name = 'ann'", [], |x| {
                        x.get::<_, i64>(0)
                    })?,
                )
            })
            .unwrap();
    c.h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::set_setting(
                t,
                "assistant.daily_tokens",
                Some("5"),
                1,
                0,
            )?;
            effractor_accounts::assistant::record_usage(
                t,
                ann_id,
                None,
                Some(10),
                Some(2),
                1_000_000,
            )
        })
        .unwrap();
    let res =
        c.h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/results"),
            Some(&c.ann),
            Some(json!({"results": [{"id": "c1", "ok": true, "output": "doc"}], "state": ""})),
        )
        .await;
    assert_eq!(res.status(), 429);
    assert_eq!(text(res).await, "daily budget reached");
    let got = stored(&c, s).await;
    assert_eq!(got["turn"], Value::Null, "the turn ended");
    assert_eq!(c.fake.seen.lock().unwrap().len(), 1, "no second request");
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
async fn the_daily_budget_holds_for_an_endpoint_that_reports_no_tokens() {
    let c = chat().await;
    c.h.accounts
        .db()
        .write(|t| {
            effractor_accounts::assistant::set_setting(
                t,
                "assistant.daily_tokens",
                Some("100"),
                1,
                0,
            )
        })
        .unwrap();
    let s = session(&c).await;
    // No usage in the stream: the request's size counts instead.
    c.fake.push(Reply::Stream(vec![
        json!({"choices":[{"delta":{"content":"ok"}}]}),
        json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
    ]));
    events(say(&c, &c.ann, s, "a").await).await;
    let res = say(&c, &c.ann, s, "b").await;
    assert_eq!(res.status(), 429);
    assert_eq!(text(res).await, "daily budget reached");
    assert_eq!(c.fake.seen.lock().unwrap().len(), 1);
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
