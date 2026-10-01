//! One neutral shape for messages and stream events (chat spec §4.4); the
//! adapters translate it to and from each provider's wire.

use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    ToolResult {
        id: String,
        ok: bool,
        output: String,
    },
    Marker {
        left_out_turns: u32,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
    Tool,
    Marker,
}

impl Role {
    pub fn parse(s: &str) -> Option<Role> {
        match s {
            "user" => Some(Role::User),
            "assistant" => Some(Role::Assistant),
            "tool" => Some(Role::Tool),
            "marker" => Some(Role::Marker),
            _ => None,
        }
    }
    pub fn as_str(self) -> &'static str {
        match self {
            Role::User => "user",
            Role::Assistant => "assistant",
            Role::Tool => "tool",
            Role::Marker => "marker",
        }
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct Message {
    pub role: Role,
    pub blocks: Vec<Block>,
}

/// What a provider stream yields, already neutral.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    Text {
        text: String,
    },
    Thinking {
        text: String,
    },
    ToolCall {
        id: String,
        name: String,
        input: serde_json::Value,
    },
    Usage {
        input: Option<i64>,
        output: Option<i64>,
    },
    /// "end_turn", "tool_use", "max_tokens", or the provider's own word.
    Stop {
        reason: String,
    },
}

pub struct Request<'a> {
    pub system: &'a str,
    pub messages: &'a [Message],
    pub tools: &'a [crate::assistant::catalog::Tool],
    pub model: &'a str,
    pub reply_tokens: u32,
    /// Kimi (and Moonshot) want an assistant message's thinking replayed
    /// with its tool calls, unsigned (chat spec §4.4; Vestigo's Kimi fix).
    pub replay_thinking: bool,
}

/// Why a provider request failed, in a few words. Never carries the body.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProviderError {
    Unreachable,
    Rejected,
    RateLimited,
    ContextOverflow,
    Status(u16),
    Malformed,
    /// The stream ended before the reply said it was whole.
    Incomplete,
}

impl ProviderError {
    pub fn reason(&self) -> String {
        match self {
            ProviderError::Unreachable => "endpoint unreachable".into(),
            ProviderError::Rejected => "key rejected".into(),
            ProviderError::RateLimited => "rate-limited by the provider".into(),
            ProviderError::ContextOverflow => "too long for the model".into(),
            ProviderError::Status(code) => format!("the endpoint answered {code}"),
            ProviderError::Malformed => "the endpoint's answer did not read".into(),
            ProviderError::Incomplete => "the reply broke off before its end".into(),
        }
    }
    pub fn code(&self) -> &'static str {
        match self {
            ProviderError::Unreachable => "unreachable",
            ProviderError::Rejected => "rejected",
            ProviderError::RateLimited => "rate_limited",
            ProviderError::ContextOverflow => "context",
            ProviderError::Status(_) => "status",
            ProviderError::Malformed => "malformed",
            ProviderError::Incomplete => "incomplete",
        }
    }
}
