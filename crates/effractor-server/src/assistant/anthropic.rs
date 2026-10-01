//! Anthropic's Messages API, streamed (chat spec §4.4). Roles must
//! alternate; unsigned thinking is not sent back.

use serde_json::{Value, json};

use super::message::{Block, Event, Message, ProviderError, Request, Role};
use super::provider::Wire;

fn content(m: &Message, replay_thinking: bool) -> Vec<Value> {
    let mut out: Vec<Value> = m
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Text { text } => Some(json!({"type": "text", "text": text})),
            Block::Thinking { text } if replay_thinking => {
                Some(json!({"type": "thinking", "thinking": text, "signature": ""}))
            }
            Block::Thinking { .. } => None,
            Block::ToolCall { id, name, input } => Some(json!({"type": "tool_use", "id": id, "name": name, "input": input})),
            Block::ToolResult { id, ok, output } => Some(json!({"type": "tool_result", "tool_use_id": id, "content": output, "is_error": !ok})),
            Block::Marker { left_out_turns } => Some(json!({"type": "text", "text": format!("[{left_out_turns} earlier turns left out]")})),
        })
        .collect();
    // Kimi, thinking server-side, wants a thinking block before replayed
    // tool calls; unsigned is what it accepts (Vestigo's KimiAnthropicModel).
    if replay_thinking
        && m.role == Role::Assistant
        && out.iter().any(|b| b["type"] == "tool_use")
        && !out.iter().any(|b| b["type"] == "thinking")
    {
        out.insert(
            0,
            json!({"type": "thinking", "thinking": "", "signature": ""}),
        );
    }
    out
}

pub fn body(req: &Request<'_>) -> Value {
    let mut messages: Vec<(String, Vec<Value>)> = Vec::new();
    for m in req.messages {
        let role = if m.role == Role::Assistant {
            "assistant"
        } else {
            "user"
        };
        let blocks = content(m, req.replay_thinking);
        if blocks.is_empty() {
            continue;
        }
        match messages.last_mut() {
            Some((r, c)) if r == role => c.extend(blocks),
            _ => messages.push((role.to_owned(), blocks)),
        }
    }
    let mut body = json!({
        "model": req.model,
        "max_tokens": req.reply_tokens,
        "stream": true,
        "system": req.system,
        "messages": messages.into_iter().map(|(r, c)| json!({"role": r, "content": c})).collect::<Vec<_>>(),
    });
    if !req.tools.is_empty() {
        body["tools"] = req
            .tools
            .iter()
            .map(
                |t| json!({"name": t.name, "description": t.description, "input_schema": t.schema}),
            )
            .collect();
    }
    body
}

enum Open {
    Text,
    Thinking,
    Tool {
        id: String,
        name: String,
        json: String,
        start: Value,
    },
}

#[derive(Default)]
pub struct Parser {
    open: Vec<(u64, Open)>,
    /// `message_stop` came: the reply is whole.
    stopped: bool,
}

impl Wire for Parser {
    fn event(&mut self, _event: &str, data: &str) -> Vec<Result<Event, ProviderError>> {
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return vec![Err(ProviderError::Malformed)];
        };
        let index = v["index"].as_u64().unwrap_or(0);
        match v["type"].as_str().unwrap_or("") {
            "message_start" => vec![Ok(Event::Usage {
                input: v["message"]["usage"]["input_tokens"].as_i64(),
                output: None,
            })],
            "content_block_start" => {
                let b = &v["content_block"];
                let mut out = Vec::new();
                let open = match b["type"].as_str().unwrap_or("") {
                    "tool_use" => Open::Tool {
                        id: b["id"].as_str().unwrap_or("").to_owned(),
                        name: b["name"].as_str().unwrap_or("").to_owned(),
                        json: String::new(),
                        start: b["input"].clone(),
                    },
                    "thinking" => Open::Thinking,
                    _ => {
                        if let Some(t) = b["text"].as_str().filter(|t| !t.is_empty()) {
                            out.push(Ok(Event::Text { text: t.to_owned() }));
                        }
                        Open::Text
                    }
                };
                self.open.push((index, open));
                out
            }
            "content_block_delta" => {
                let d = &v["delta"];
                match d["type"].as_str().unwrap_or("") {
                    "text_delta" => vec![Ok(Event::Text {
                        text: d["text"].as_str().unwrap_or("").to_owned(),
                    })],
                    "thinking_delta" => vec![Ok(Event::Thinking {
                        text: d["thinking"].as_str().unwrap_or("").to_owned(),
                    })],
                    "input_json_delta" => {
                        if let Some((_, Open::Tool { json, .. })) =
                            self.open.iter_mut().find(|(i, _)| *i == index)
                        {
                            json.push_str(d["partial_json"].as_str().unwrap_or(""));
                        }
                        Vec::new()
                    }
                    _ => Vec::new(),
                }
            }
            "content_block_stop" => {
                let Some(at) = self.open.iter().position(|(i, _)| *i == index) else {
                    return Vec::new();
                };
                match self.open.remove(at).1 {
                    Open::Tool {
                        id,
                        name,
                        json,
                        start,
                    } => {
                        let input = if json.trim().is_empty() {
                            if start.is_object() { start } else { json!({}) }
                        } else {
                            serde_json::from_str(&json)
                                .unwrap_or_else(|_| json!({"_unparsed": json}))
                        };
                        vec![Ok(Event::ToolCall { id, name, input })]
                    }
                    _ => Vec::new(),
                }
            }
            "message_delta" => {
                let mut out = Vec::new();
                if let Some(r) = v["delta"]["stop_reason"].as_str() {
                    out.push(Ok(Event::Stop {
                        reason: r.to_owned(),
                    }));
                }
                if let Some(o) = v["usage"]["output_tokens"].as_i64() {
                    out.push(Ok(Event::Usage {
                        input: None,
                        output: Some(o),
                    }));
                }
                out
            }
            "message_stop" => {
                self.stopped = true;
                Vec::new()
            }
            "error" => {
                let kind = v["error"]["type"].as_str().unwrap_or("");
                let message = v["error"]["message"].as_str().unwrap_or("").to_lowercase();
                vec![Err(match kind {
                    "overloaded_error" | "rate_limit_error" => ProviderError::RateLimited,
                    "authentication_error" | "permission_error" => ProviderError::Rejected,
                    "invalid_request_error"
                        if message.contains("too long") || message.contains("context") =>
                    {
                        ProviderError::ContextOverflow
                    }
                    _ => ProviderError::Status(500),
                })]
            }
            _ => Vec::new(),
        }
    }

    /// Cut off before `message_stop`: a tool call still open is half there,
    /// and is not kept.
    fn end(&mut self) -> Vec<Result<Event, ProviderError>> {
        self.open.clear();
        if self.stopped {
            Vec::new()
        } else {
            vec![Err(ProviderError::Incomplete)]
        }
    }
}

#[cfg(test)]
pub fn parse_all(raw: &[u8]) -> Result<Vec<Event>, ProviderError> {
    super::provider::parse_with(&mut Parser::default(), raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assistant::message::*;

    #[test]
    fn a_stream_with_thinking_text_and_a_tool_use_reads_neutral() {
        let raw = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":40}}}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"thinking\",\"thinking\":\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hm\"}}\n\n",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n",
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"show\",\"input\":{}}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"id\\\":\\\"a\\\"}\"}}\n\n",
            "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":1}\n\n",
            "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"tool_use\"},\"usage\":{\"output_tokens\":9}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
        );
        let events = parse_all(raw.as_bytes()).unwrap();
        assert_eq!(
            events,
            vec![
                Event::Usage {
                    input: Some(40),
                    output: None
                },
                Event::Thinking { text: "hm".into() },
                Event::ToolCall {
                    id: "t1".into(),
                    name: "show".into(),
                    input: serde_json::json!({"id":"a"})
                },
                Event::Stop {
                    reason: "tool_use".into()
                },
                Event::Usage {
                    input: None,
                    output: Some(9)
                },
            ]
        );
    }

    #[test]
    fn a_stream_cut_before_message_stop_is_incomplete_and_its_open_call_is_not_kept() {
        let raw = concat!(
            "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,\"content_block\":{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"remove\",\"input\":{}}}\n\n",
            "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"id\\\":\"}}\n\n",
        );
        let mut p = Parser::default();
        let mut sse = crate::assistant::provider::Sse::default();
        let mut out = Vec::new();
        for (e, d) in sse.feed(raw.as_bytes()) {
            out.extend(p.event(&e, &d));
        }
        out.extend(p.end());
        assert_eq!(out, vec![Err(ProviderError::Incomplete)]);
    }

    #[test]
    fn roles_alternate_thinking_is_dropped_and_results_are_user_blocks() {
        let msgs = vec![
            Message {
                role: Role::User,
                blocks: vec![Block::Text { text: "a".into() }],
            },
            Message {
                role: Role::Marker,
                blocks: vec![Block::Marker { left_out_turns: 1 }],
            },
            Message {
                role: Role::Assistant,
                blocks: vec![
                    Block::Thinking { text: "x".into() },
                    Block::ToolCall {
                        id: "t".into(),
                        name: "show".into(),
                        input: serde_json::json!({}),
                    },
                ],
            },
            Message {
                role: Role::Tool,
                blocks: vec![Block::ToolResult {
                    id: "t".into(),
                    ok: true,
                    output: "done".into(),
                }],
            },
        ];
        let b = body(&Request {
            system: "S",
            messages: &msgs,
            tools: &[],
            model: "m",
            reply_tokens: 10,
            replay_thinking: false,
        });
        let m = b["messages"].as_array().unwrap();
        assert_eq!(m.len(), 3, "user + marker merged");
        assert_eq!(
            m[1]["content"].as_array().unwrap().len(),
            1,
            "thinking dropped"
        );
        assert_eq!(m[2]["content"][0]["type"], "tool_result");
        assert_eq!(b["system"], "S");
    }
}

#[cfg(test)]
mod kimi_tests {
    use super::*;
    use crate::assistant::message::*;

    #[test]
    fn replayed_tool_calls_carry_an_unsigned_thinking_block_first() {
        let msgs = vec![
            Message {
                role: Role::User,
                blocks: vec![Block::Text { text: "a".into() }],
            },
            Message {
                role: Role::Assistant,
                blocks: vec![Block::ToolCall {
                    id: "t".into(),
                    name: "show".into(),
                    input: serde_json::json!({}),
                }],
            },
            Message {
                role: Role::Assistant,
                blocks: vec![
                    Block::Thinking { text: "hm".into() },
                    Block::Text { text: "b".into() },
                ],
            },
        ];
        let req = Request {
            system: "S",
            messages: &msgs,
            tools: &[],
            model: "m",
            reply_tokens: 10,
            replay_thinking: true,
        };
        let m = body(&req)["messages"].clone();
        assert_eq!(
            m[1]["content"][0],
            serde_json::json!({"type": "thinking", "thinking": "", "signature": ""})
        );
        assert_eq!(m[1]["content"][1]["type"], "tool_use");
        assert_eq!(
            m[1]["content"][2]["type"], "thinking",
            "the next assistant message, merged, keeps its own"
        );
    }
}
