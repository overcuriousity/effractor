//! Talking to the admin's endpoint (chat spec §4.4): one request per step,
//! read as it streams, errors reduced to a few words — never the body, which
//! a proxy may have filled with the key.

use std::collections::VecDeque;
use std::time::Duration;

use futures_util::stream::{BoxStream, StreamExt};
use serde::Serialize;

use super::message::{Event, ProviderError, Request};
use super::{Config, Provider, anthropic, openai};

/// Server-sent events split into (event, data), whatever the chunking.
#[derive(Default)]
pub struct Sse {
    buf: Vec<u8>,
}

impl Sse {
    pub fn feed(&mut self, chunk: &[u8]) -> Vec<(String, String)> {
        self.buf.extend_from_slice(chunk);
        let mut out = Vec::new();
        while let Some(end) = find_blank_line(&self.buf) {
            let block: Vec<u8> = self.buf.drain(..end.0).collect();
            self.buf.drain(..end.1);
            if let Some(pair) = read_block(&block) {
                out.push(pair);
            }
        }
        out
    }

    pub fn finish(&mut self) -> Vec<(String, String)> {
        let block = std::mem::take(&mut self.buf);
        read_block(&block).into_iter().collect()
    }
}

/// Where the first blank line starts, and how long the separator is.
fn find_blank_line(buf: &[u8]) -> Option<(usize, usize)> {
    let mut i = 0;
    while i + 1 < buf.len() {
        if buf[i] == b'\n' && buf[i + 1] == b'\n' {
            return Some((i, 2));
        }
        if buf[i] == b'\n' && buf[i + 1] == b'\r' && buf.get(i + 2) == Some(&b'\n') {
            return Some((i, 3));
        }
        i += 1;
    }
    None
}

fn read_block(block: &[u8]) -> Option<(String, String)> {
    let text = String::from_utf8_lossy(block);
    let mut event = String::new();
    let mut data: Vec<&str> = Vec::new();
    for line in text.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(v) = line.strip_prefix("event:") {
            event = v.trim().to_owned();
        } else if let Some(v) = line.strip_prefix("data:") {
            data.push(v.strip_prefix(' ').unwrap_or(v));
        }
    }
    (!data.is_empty()).then(|| (event, data.join("\n")))
}

/// A wire's reading of its own stream.
pub trait Wire: Send {
    fn event(&mut self, event: &str, data: &str) -> Vec<Result<Event, ProviderError>>;
    fn end(&mut self) -> Vec<Result<Event, ProviderError>>;
}

/// All events of a recorded stream, fed in small chunks (tests).
pub fn parse_with(wire: &mut dyn Wire, raw: &[u8]) -> Result<Vec<Event>, ProviderError> {
    let mut sse = Sse::default();
    let mut out = Vec::new();
    for chunk in raw.chunks(7) {
        for (e, d) in sse.feed(chunk) {
            out.extend(wire.event(&e, &d));
        }
    }
    for (e, d) in sse.finish() {
        out.extend(wire.event(&e, &d));
    }
    out.extend(wire.end());
    out.into_iter().collect()
}

/// For a chat's streamed replies: the timeout is for silence, not for the
/// whole reply, which a slow local model may take many minutes to write.
pub fn client(timeout_seconds: u64) -> reqwest::Client {
    base()
        .read_timeout(Duration::from_secs(timeout_seconds))
        .build()
        .unwrap_or_default()
}

/// For the admin's model list and Test: short answers, a total timeout.
pub fn admin_client(timeout_seconds: u64) -> reqwest::Client {
    base()
        .timeout(Duration::from_secs(timeout_seconds))
        .build()
        .unwrap_or_default()
}

fn base() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        // A key is never carried to another host.
        .redirect(reqwest::redirect::Policy::none())
}

fn overflow(body: &str) -> bool {
    let b = body.to_lowercase();
    b.contains("context")
        || b.contains("too long")
        || (b.contains("maximum") && b.contains("tokens"))
}

/// What the provider said was wrong, in its own words, at most a line: for
/// the admin's Test only, scrubbed there. A chat is told the short reason.
fn detail_of(body: &str) -> Option<String> {
    let v: Option<serde_json::Value> = serde_json::from_str(body).ok();
    let said = v
        .as_ref()
        .and_then(|v| {
            v["error"]["message"]
                .as_str()
                .or_else(|| v["error"].as_str())
                .or_else(|| v["message"].as_str())
                .or_else(|| v["detail"].as_str())
                .map(str::to_owned)
        })
        .unwrap_or_else(|| body.trim().to_owned());
    let line: String = said.split_whitespace().collect::<Vec<_>>().join(" ");
    (!line.is_empty()).then(|| line.chars().take(200).collect())
}

async fn status_error(res: reqwest::Response) -> (ProviderError, Option<String>) {
    let code = res.status().as_u16();
    // Read a little, to tell an overflow and to say why to the admin.
    let body = res.text().await.unwrap_or_default();
    let head: String = body.chars().take(4096).collect();
    let error = match code {
        401 | 403 => ProviderError::Rejected,
        429 => ProviderError::RateLimited,
        400 | 413 if overflow(&head) => ProviderError::ContextOverflow,
        _ => ProviderError::Status(code),
    };
    (
        error,
        Some(detail_of(&head).unwrap_or_else(|| "no reason given".into())),
    )
}

fn post(cfg: &Config, http: &reqwest::Client, body: &serde_json::Value) -> reqwest::RequestBuilder {
    let key = cfg.key.as_deref();
    let r = post_to(cfg, http, body, key);
    if cfg.user_agent.is_empty() {
        r
    } else {
        r.header(reqwest::header::USER_AGENT, &cfg.user_agent)
    }
}

fn post_to(
    cfg: &Config,
    http: &reqwest::Client,
    body: &serde_json::Value,
    key: Option<&str>,
) -> reqwest::RequestBuilder {
    match cfg.provider {
        Provider::Openai => {
            let r = http
                .post(format!("{}/chat/completions", cfg.address))
                .json(body);
            match key {
                Some(k) => r.bearer_auth(k),
                None => r,
            }
        }
        Provider::Anthropic => http
            .post(format!("{}/v1/messages", cfg.address))
            .header("x-api-key", key.unwrap_or(""))
            .header("anthropic-version", "2023-06-01")
            .json(body),
    }
}

/// One model request, streamed as neutral events.
pub async fn stream(
    cfg: &Config,
    req: &Request<'_>,
    http: &reqwest::Client,
) -> Result<BoxStream<'static, Result<Event, ProviderError>>, ProviderError> {
    stream_explained(cfg, req, http).await.map_err(|e| e.0)
}

/// As `stream`, with what the provider said when it refused (the admin's Test).
pub async fn stream_explained(
    cfg: &Config,
    req: &Request<'_>,
    http: &reqwest::Client,
) -> Result<BoxStream<'static, Result<Event, ProviderError>>, (ProviderError, Option<String>)> {
    let (body, wire): (serde_json::Value, Box<dyn Wire>) = match cfg.provider {
        Provider::Openai => (openai::body(req), Box::<openai::Parser>::default()),
        Provider::Anthropic => (anthropic::body(req), Box::<anthropic::Parser>::default()),
    };
    let res = post(cfg, http, &body)
        .send()
        .await
        .map_err(|_| (ProviderError::Unreachable, None))?;
    if !res.status().is_success() {
        return Err(status_error(res).await);
    }
    struct State {
        bytes: BoxStream<'static, reqwest::Result<bytes_alias::Bytes>>,
        sse: Sse,
        wire: Box<dyn Wire>,
        pending: VecDeque<Result<Event, ProviderError>>,
        done: bool,
    }
    let state = State {
        bytes: res.bytes_stream().boxed(),
        sse: Sse::default(),
        wire,
        pending: VecDeque::new(),
        done: false,
    };
    Ok(futures_util::stream::unfold(state, |mut s| async move {
        loop {
            if let Some(next) = s.pending.pop_front() {
                return Some((next, s));
            }
            if s.done {
                return None;
            }
            match s.bytes.next().await {
                Some(Ok(chunk)) => {
                    for (e, d) in s.sse.feed(&chunk) {
                        s.pending.extend(s.wire.event(&e, &d));
                    }
                }
                Some(Err(_)) => {
                    s.done = true;
                    s.pending.push_back(Err(ProviderError::Unreachable));
                }
                None => {
                    s.done = true;
                    for (e, d) in s.sse.finish() {
                        s.pending.extend(s.wire.event(&e, &d));
                    }
                    s.pending.extend(s.wire.end());
                }
            }
        }
    })
    .boxed())
}

mod bytes_alias {
    pub use axum::body::Bytes;
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ModelInfo {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<u32>,
}

/// The endpoint's models, for the admin's list.
pub async fn models(
    provider: Provider,
    address: &str,
    key: Option<&str>,
    user_agent: &str,
    http: &reqwest::Client,
) -> Result<Vec<ModelInfo>, ProviderError> {
    let req = match provider {
        Provider::Openai => {
            let r = http.get(format!("{address}/models"));
            match key {
                Some(k) => r.bearer_auth(k),
                None => r,
            }
        }
        Provider::Anthropic => http
            .get(format!("{address}/v1/models"))
            .header("x-api-key", key.unwrap_or(""))
            .header("anthropic-version", "2023-06-01"),
    };
    let req = if user_agent.is_empty() {
        req
    } else {
        req.header(reqwest::header::USER_AGENT, user_agent)
    };
    let res = req.send().await.map_err(|_| ProviderError::Unreachable)?;
    if !res.status().is_success() {
        return Err(status_error(res).await.0);
    }
    let v: serde_json::Value = res.json().await.map_err(|_| ProviderError::Malformed)?;
    let list = v["data"].as_array().ok_or(ProviderError::Malformed)?;
    let mut out: Vec<ModelInfo> = list
        .iter()
        .filter_map(|m| {
            Some(ModelInfo {
                id: m["id"].as_str()?.to_owned(),
                context: m["context_length"]
                    .as_u64()
                    .or_else(|| m["max_input_tokens"].as_u64())
                    .and_then(|n| u32::try_from(n).ok()),
            })
        })
        .collect();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sse_blocks_split_anywhere_read_whole_and_crlf_too() {
        let mut s = Sse::default();
        assert!(s.feed(b"event: a\ndata: {\"x\"").is_empty());
        assert_eq!(
            s.feed(b":1}\n\nevent: b\r\ndata: 2\r\n\r\n"),
            vec![("a".into(), "{\"x\":1}".into()), ("b".into(), "2".into())]
        );
    }
}
