mod common;
use common::fake_llm::{Fake, Reply};
use common::*;
use serde_json::json;
use std::sync::{Arc, Mutex};

const KEY: &str = "sk-LEAKCANARY-0123456789";

#[derive(Clone, Default)]
struct Log(Arc<Mutex<Vec<u8>>>);
impl std::io::Write for Log {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[tokio::test(flavor = "current_thread")]
async fn the_key_appears_in_no_response_and_no_log() {
    let log = Log::default();
    let w = log.clone();
    let sub = tracing_subscriber::fmt()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(move || w.clone())
        .finish();
    let _guard = tracing::subscriber::set_default(sub);

    let (address, fake) = fake_llm::start().await;
    let h = harness();
    let root = h.add_user("root");
    h.accounts
        .db()
        .write(|t| effractor_accounts::users::set_admin(t, root, true))
        .unwrap();
    let r = h.login("root").await;
    let mut bodies = Vec::new();
    let mut hit = |s: String| bodies.push(s);
    hit(text(
        h.call(
            "PUT",
            "/api/admin/assistant",
            Some(&r),
            Some(json!({"provider":"openai","address":address,"key":KEY,"model":"fake-small"})),
        )
        .await,
    )
    .await);
    hit(text(h.call("GET", "/api/admin/assistant", Some(&r), None).await).await);
    hit(text(
        h.call(
            "POST",
            "/api/admin/assistant/models",
            Some(&r),
            Some(json!({"provider":"openai","address":address})),
        )
        .await,
    )
    .await);
    fake.push(Reply::Status(401, format!("invalid api key {KEY}")));
    hit(text(
        h.call("POST", "/api/admin/assistant/test", Some(&r), None)
            .await,
    )
    .await);
    h.call(
        "PUT",
        "/api/admin/assistant/grants",
        Some(&r),
        Some(json!({"user": root})),
    )
    .await;
    hit(text(h.call("GET", "/api/assistant", Some(&r), None).await).await);
    let body = "effractor: 2\nprofile: fault-tree\nname: T\ntop: a\nnodes:\n  a: {label: A, leaf: basic, p: 0.1}\n";
    let doc = json(
        h.call(
            "POST",
            "/api/documents",
            Some(&r),
            Some(json!({"name":"T","profile":"fault-tree","body":body})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let s = json(
        h.call(
            "POST",
            &format!("/api/documents/{doc}/assistant/sessions"),
            Some(&r),
            None,
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    fake.push(Reply::Status(500, format!("upstream said {KEY}")));
    hit(text(
        h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&r),
            Some(json!({"text":"hi","state":""})),
        )
        .await,
    )
    .await);
    fake.push(Fake::text(&format!("the key is {}", &KEY[3..15]))); // a model reciting a piece of it
    hit(text(
        h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&r),
            Some(json!({"text":"hi","state":""})),
        )
        .await,
    )
    .await);
    hit(text(
        h.call(
            "GET",
            &format!("/api/assistant/sessions/{s}"),
            Some(&r),
            None,
        )
        .await,
    )
    .await);

    for b in &bodies {
        assert!(
            !b.contains(KEY) && !b.contains(&KEY[3..15]),
            "leaked in: {b}"
        );
    }
    let logged = String::from_utf8(log.0.lock().unwrap().clone()).unwrap();
    assert!(!logged.contains(&KEY[3..15]), "leaked in the log");
}

#[tokio::test]
async fn a_key_recited_in_small_pieces_never_reaches_the_page() {
    let (address, fake) = fake_llm::start().await;
    let h = harness();
    let ann = h.add_user("ann");
    h.accounts
        .db()
        .write(|t| {
            use effractor_accounts::assistant::{Grantee, grant, set_setting};
            grant(t, Grantee::User(ann), ann, 0)?;
            for (k, v) in [
                ("assistant.provider", "openai"),
                ("assistant.address", address.as_str()),
                ("assistant.model", "fake-small"),
                ("assistant.key", KEY),
            ] {
                set_setting(t, k, Some(v), ann, 0)?;
            }
            Ok(())
        })
        .unwrap();
    let r = h.login("ann").await;
    let body = "effractor: 2\nprofile: fault-tree\nname: T\ntop: a\nnodes:\n  a: {label: A, leaf: basic, p: 0.1}\n";
    let doc = json(
        h.call(
            "POST",
            "/api/documents",
            Some(&r),
            Some(json!({"name":"T","profile":"fault-tree","body":body})),
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    let s = json(
        h.call(
            "POST",
            &format!("/api/documents/{doc}/assistant/sessions"),
            Some(&r),
            None,
        )
        .await,
    )
    .await["id"]
        .as_i64()
        .unwrap();
    // The key, one to three characters at a time, as text and as thinking.
    let said = format!("the key is {KEY} indeed");
    let chars: Vec<char> = said.chars().collect();
    let mut chunks = Vec::new();
    let mut i = 0;
    let mut n = 1;
    while i < chars.len() {
        let piece: String = chars[i..(i + n).min(chars.len())].iter().collect();
        chunks.push(json!({"choices":[{"delta":{"reasoning_content":piece}}]}));
        chunks.push(json!({"choices":[{"delta":{"content":piece}}]}));
        i += n;
        n = n % 3 + 1;
    }
    chunks.push(json!({"choices":[{"delta":{},"finish_reason":"stop"}]}));
    fake.push(Reply::Stream(chunks));
    let sse = text(
        h.call(
            "POST",
            &format!("/api/assistant/sessions/{s}/messages"),
            Some(&r),
            Some(json!({"text":"hi","state":""})),
        )
        .await,
    )
    .await;
    // What the page puts together from the live events.
    let mut live_text = String::new();
    let mut live_thinking = String::new();
    for block in sse.split("\n\n") {
        let ev = block.lines().find_map(|l| l.strip_prefix("event: "));
        let Some(data) = block.lines().find_map(|l| l.strip_prefix("data: ")) else {
            continue;
        };
        let v: serde_json::Value = serde_json::from_str(data).unwrap();
        match ev {
            Some("text") => live_text.push_str(v["text"].as_str().unwrap()),
            Some("thinking") => live_thinking.push_str(v["text"].as_str().unwrap()),
            _ => {}
        }
    }
    for got in [&live_text, &live_thinking] {
        assert!(
            !got.contains(KEY) && !got.contains(&KEY[3..11]),
            "leaked live: {got}"
        );
        assert!(
            got.starts_with("the key is ") && got.ends_with(" indeed"),
            "{got}"
        );
    }
}
