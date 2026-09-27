//! The agent chat (spec 2026-09-27-assistant-chat-design): the admin's
//! configuration, the key that never leaves this process, and the signals
//! that stop a running turn. Storage is `effractor_accounts::assistant`.

pub mod anthropic;
pub mod catalog;
pub mod message;
pub mod openai;
pub mod prompt;
pub mod provider;
pub mod window;

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use effractor_accounts::assistant::setting;
use effractor_accounts::{Connection, Id};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Openai,
    Anthropic,
}

impl Provider {
    pub fn parse(s: &str) -> Option<Provider> {
        match s {
            "openai" => Some(Provider::Openai),
            "anthropic" => Some(Provider::Anthropic),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Provider::Openai => "openai",
            Provider::Anthropic => "anthropic",
        }
    }
}

pub const STEPS: u32 = 50;
pub const CONTEXT: u32 = 32_768;
pub const REPLY_TOKENS: u32 = 8_192;
pub const MESSAGE_BYTES: u32 = 262_144;
pub const TIMEOUT_SECONDS: u64 = 120;

/// What the admin configured, with the key resolved but never serialised.
#[derive(Clone, Debug, Serialize)]
pub struct Config {
    pub provider: Provider,
    pub address: String,
    pub model: String,
    pub steps: u32,
    pub context: u32,
    pub reply_tokens: u32,
    pub message_bytes: u32,
    pub daily_tokens: Option<u64>,
    pub timeout_seconds: u64,
    /// Sent as the User-Agent when set: Kimi's coding plan answers only
    /// requests that name a coding agent. The admin chooses; nothing is
    /// pretended by default.
    pub user_agent: String,
    #[serde(skip)]
    pub key: Option<String>,
    pub key_set: bool,
    pub key_pinned: bool,
}

impl Config {
    /// An address and a model; a local endpoint may need no key.
    pub fn configured(&self) -> bool {
        !self.address.is_empty() && !self.model.is_empty()
    }
}

fn number<T: std::str::FromStr>(
    c: &Connection,
    key: &str,
    default: T,
) -> effractor_accounts::Result<T> {
    Ok(setting(c, key)?
        .and_then(|v| v.parse().ok())
        .unwrap_or(default))
}

/// The configuration as stored; a pinned key wins over a stored one.
pub fn load(c: &Connection, pinned: Option<&str>) -> effractor_accounts::Result<Config> {
    let stored_key = setting(c, "assistant.key")?;
    let key = pinned.map(str::to_owned).or(stored_key);
    Ok(Config {
        provider: setting(c, "assistant.provider")?
            .and_then(|p| Provider::parse(&p))
            .unwrap_or(Provider::Openai),
        address: setting(c, "assistant.address")?.unwrap_or_default(),
        model: setting(c, "assistant.model")?.unwrap_or_default(),
        steps: number(c, "assistant.steps", STEPS)?,
        context: number(c, "assistant.context", CONTEXT)?,
        reply_tokens: number(c, "assistant.reply_tokens", REPLY_TOKENS)?,
        message_bytes: number(c, "assistant.message_bytes", MESSAGE_BYTES)?,
        daily_tokens: setting(c, "assistant.daily_tokens")?.and_then(|v| v.parse().ok()),
        timeout_seconds: number(c, "assistant.timeout_seconds", TIMEOUT_SECONDS)?,
        user_agent: setting(c, "assistant.user_agent")?.unwrap_or_default(),
        key_set: key.is_some(),
        key_pinned: pinned.is_some(),
        key,
    })
}

/// Kimi's and Moonshot's endpoints, which want thinking replayed with tool
/// calls (Vestigo's Kimi fix).
pub fn replays_thinking(address: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(address) else {
        return false;
    };
    let host = url.host_str().unwrap_or("").to_lowercase();
    ["kimi.com", "kimi.ai", "moonshot.ai", "moonshot.cn"]
        .iter()
        .any(|d| host == *d || host.ends_with(&format!(".{d}")))
}

/// The key, or any long enough piece of it, never leaves in a message.
pub fn scrub(text: &str, key: Option<&str>) -> String {
    let Some(key) = key.filter(|k| k.chars().count() >= 8) else {
        return text.to_owned();
    };
    let mut out = text.replace(key, "…");
    // Proxies echo keys cut or partly masked: any 8-character window goes too.
    let chars: Vec<char> = key.chars().collect();
    for w in chars.windows(8) {
        let piece: String = w.iter().collect();
        if out.contains(&piece) {
            out = out.replace(&piece, "…");
        }
    }
    out
}

/// The chat's process state: the operator's key, and a stop signal per
/// session whose turn is streaming.
#[derive(Default)]
pub struct Assistant {
    pinned: OnceLock<String>,
    stops: Mutex<HashMap<Id, tokio::sync::watch::Sender<bool>>>,
}

impl Assistant {
    pub fn pinned(&self) -> Option<&str> {
        self.pinned.get().map(String::as_str)
    }

    pub(crate) fn pin(&self, key: String) -> bool {
        self.pinned.set(key).is_ok()
    }

    /// A fresh signal for the step now starting in `session`.
    pub fn stop_signal(&self, session: Id) -> tokio::sync::watch::Receiver<bool> {
        let (tx, rx) = tokio::sync::watch::channel(false);
        self.stops
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(session, tx);
        rx
    }

    /// Whether a step of `session` is streaming in this process.
    pub fn streaming(&self, session: Id) -> bool {
        self.stops
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains_key(&session)
    }

    /// Whether a streaming step was there to stop.
    pub fn stop(&self, session: Id) -> bool {
        let stops = self.stops.lock().unwrap_or_else(|e| e.into_inner());
        match stops.get(&session) {
            Some(tx) => tx.send(true).is_ok(),
            None => false,
        }
    }

    pub fn done(&self, session: Id) {
        self.stops
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&session);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scrub_removes_the_key_and_its_pieces() {
        assert_eq!(
            scrub("bad key sk-abcdefghijkl here", Some("sk-abcdefghijkl")),
            "bad key … here"
        );
        assert!(!scrub("key: abcdefghij…", Some("sk-abcdefghijkl")).contains("abcdefgh"));
        assert_eq!(scrub("nothing", None), "nothing");
    }
}

#[cfg(test)]
mod kimi_tests {
    use super::replays_thinking;

    #[test]
    fn kimi_and_moonshot_addresses_replay_thinking_others_do_not() {
        for a in [
            "https://api.kimi.com/coding",
            "https://api.kimi.ai/coding/v1",
            "https://api.moonshot.ai/v1",
            "https://api.moonshot.cn/v1",
        ] {
            assert!(replays_thinking(a), "{a}");
        }
        for a in [
            "http://localhost:11434/v1",
            "https://api.anthropic.com",
            "https://notkimi.com.evil/v1",
            "not a url",
        ] {
            assert!(!replays_thinking(a), "{a}");
        }
    }
}
