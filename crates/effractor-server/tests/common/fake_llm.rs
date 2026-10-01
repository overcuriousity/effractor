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
    /// As `Stream`, each payload sent after the pause (a slow model).
    Slow(Vec<serde_json::Value>, std::time::Duration),
    /// The reply, its headers sent only after the pause.
    Late(std::time::Duration, Box<Reply>),
    /// As `Stream`, without `[DONE]`: the connection ends mid-reply.
    Cut(Vec<serde_json::Value>),
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
    let next = f.replies.lock().unwrap().pop_front();
    answer(next).await
}

async fn answer(next: Option<Reply>) -> axum::response::Response {
    match next {
        Some(Reply::Stream(chunks)) => {
            let mut s = String::new();
            for c in chunks {
                s.push_str(&format!("data: {c}\n\n"));
            }
            s.push_str("data: [DONE]\n\n");
            ([("content-type", "text/event-stream")], s).into_response()
        }
        Some(Reply::Cut(chunks)) => {
            let s: String = chunks.iter().map(|c| format!("data: {c}\n\n")).collect();
            ([("content-type", "text/event-stream")], s).into_response()
        }
        Some(Reply::Status(code, body)) => {
            (StatusCode::from_u16(code).unwrap(), body).into_response()
        }
        Some(Reply::Slow(chunks, pause)) => {
            let mut parts: Vec<String> = chunks.iter().map(|c| format!("data: {c}\n\n")).collect();
            parts.push("data: [DONE]\n\n".into());
            let body = futures_util::stream::unfold(parts.into_iter(), move |mut it| async move {
                let next = it.next()?;
                tokio::time::sleep(pause).await;
                Some((Ok::<_, std::convert::Infallible>(next), it))
            });
            (
                [("content-type", "text/event-stream")],
                axum::body::Body::from_stream(body),
            )
                .into_response()
        }
        Some(Reply::Late(pause, reply)) => {
            tokio::time::sleep(pause).await;
            Box::pin(answer(Some(*reply))).await
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
