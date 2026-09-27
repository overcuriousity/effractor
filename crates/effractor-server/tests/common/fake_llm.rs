#![allow(dead_code)]
//! A model endpoint on localhost that answers from a script, speaking the
//! OpenAI-compatible wire. Records every request body it received.
use axum::{
    Router,
    extract::State,
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
pub struct Fake {
    pub replies: Arc<Mutex<std::collections::VecDeque<Reply>>>,
    pub seen: Arc<Mutex<Vec<serde_json::Value>>>,
}

pub enum Reply {
    /// SSE `data:` payloads; `[DONE]` is appended.
    Stream(Vec<serde_json::Value>),
    Status(u16, String),
}

impl Fake {
    pub fn text(t: &str) -> Reply {
        Reply::Stream(vec![
            serde_json::json!({"choices":[{"delta":{"content":t}}]}),
            serde_json::json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
            serde_json::json!({"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}),
        ])
    }
    pub fn call(id: &str, name: &str, args: serde_json::Value) -> Reply {
        Reply::Stream(vec![
            serde_json::json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":id,"function":{"name":name,"arguments":args.to_string()}}]}}]}),
            serde_json::json!({"choices":[{"delta":{},"finish_reason":"tool_calls"}]}),
        ])
    }
    pub fn push(&self, r: Reply) {
        self.replies.lock().unwrap().push_back(r);
    }
}

async fn chat(
    State(f): State<Fake>,
    headers: axum::http::HeaderMap,
    body: axum::Json<serde_json::Value>,
) -> axum::response::Response {
    let mut seen = body.0;
    seen["_user_agent"] = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .into();
    f.seen.lock().unwrap().push(seen);
    match f.replies.lock().unwrap().pop_front() {
        Some(Reply::Stream(chunks)) => {
            let mut s = String::new();
            for c in chunks {
                s.push_str(&format!("data: {c}\n\n"));
            }
            s.push_str("data: [DONE]\n\n");
            ([("content-type", "text/event-stream")], s).into_response()
        }
        Some(Reply::Status(code, body)) => {
            (StatusCode::from_u16(code).unwrap(), body).into_response()
        }
        None => (StatusCode::INTERNAL_SERVER_ERROR, "no scripted reply").into_response(),
    }
}

async fn models(State(f): State<Fake>, headers: axum::http::HeaderMap) -> impl IntoResponse {
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);
    f.seen
        .lock()
        .unwrap()
        .push(serde_json::json!({"path": "models", "authorization": auth}));
    axum::Json(
        serde_json::json!({"data":[{"id":"fake-small","context_length":8192},{"id":"fake-large"}]}),
    )
}

/// Serves on 127.0.0.1:<free port>; returns the address to configure (…/v1).
pub async fn start() -> (String, Fake) {
    let fake = Fake::default();
    let app = Router::new()
        .route("/v1/chat/completions", post(chat))
        .route("/v1/models", get(models))
        .with_state(fake.clone());
    let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = l.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(l, app).await.unwrap() });
    (format!("http://{addr}/v1"), fake)
}
