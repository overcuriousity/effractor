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
