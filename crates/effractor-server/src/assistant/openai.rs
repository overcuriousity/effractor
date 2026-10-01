//! The OpenAI-compatible wire (ollama, llama.cpp, vllm, OpenRouter, …):
//! chat completions, streamed (chat spec §4.4).

use serde_json::{Value, json};

use super::message::{Block, Event, ProviderError, Request, Role};
use super::provider::Wire;

fn text_of(blocks: &[Block]) -> String {
    blocks
        .iter()
        .filter_map(|b| match b {
            Block::Text { text } => Some(text.as_str()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn body(req: &Request<'_>) -> Value {
    let mut messages = vec![json!({"role": "system", "content": req.system})];
    for m in req.messages {
        match m.role {
            Role::User => messages.push(json!({"role": "user", "content": text_of(&m.blocks)})),
            Role::Marker => {
                for b in &m.blocks {
                    if let Block::Marker { left_out_turns } = b {
                        messages.push(json!({"role": "user", "content": format!("[{left_out_turns} earlier turns left out]")}));
                    }
                }
            }
            Role::Assistant => {
                let calls: Vec<Value> = m
                    .blocks
                    .iter()
                    .filter_map(|b| match b {
                        Block::ToolCall { id, name, input } => Some(json!({
                            "id": id, "type": "function",
                            "function": {"name": name, "arguments": input.to_string()},
                        })),
                        _ => None,
                    })
                    .collect();
                let text = text_of(&m.blocks);
                // A reply of thinking only: this wire has no message for it.
                if text.is_empty() && calls.is_empty() {
                    continue;
                }
                let mut msg = json!({"role": "assistant", "content": if text.is_empty() { Value::Null } else { Value::String(text) }});
                if !calls.is_empty() {
                    msg["tool_calls"] = Value::Array(calls);
                    if req.replay_thinking {
                        let thought: String = m
                            .blocks
                            .iter()
                            .filter_map(|b| match b {
                                Block::Thinking { text } => Some(text.as_str()),
                                _ => None,
                            })
                            .collect();
                        msg["reasoning_content"] = Value::String(thought);
                    }
                }
                messages.push(msg);
            }
            Role::Tool => {
                for b in &m.blocks {
                    if let Block::ToolResult { id, ok, output } = b {
                        let content = if *ok {
                            output.clone()
                        } else {
                            format!("error: {output}")
                        };
                        messages
                            .push(json!({"role": "tool", "tool_call_id": id, "content": content}));
                    }
                }
            }
        }
    }
    let mut body = json!({
        "model": req.model,
        "stream": true,
        "stream_options": {"include_usage": true},
        "max_tokens": req.reply_tokens,
        "messages": messages,
    });
    if !req.tools.is_empty() {
        body["tools"] = req
            .tools
            .iter()
            .map(|t| json!({"type": "function", "function": {"name": t.name, "description": t.description, "parameters": t.schema}}))
            .collect();
    }
    body
}

#[derive(Default)]
struct Call {
    id: String,
    name: String,
    arguments: String,
}

#[derive(Default)]
pub struct Parser {
    /// By the server's index; `None` for a server that sends none.
    calls: Vec<(Option<u64>, Call)>,
    finished: bool,
    /// `[DONE]` came: the stream is whole.
    done: bool,
}

fn input_of(arguments: &str) -> Value {
    if arguments.trim().is_empty() {
        return json!({});
    }
    serde_json::from_str(arguments).unwrap_or_else(|_| json!({"_unparsed": arguments}))
}

impl Parser {
    /// The message's calls. Some servers give no ids, or one id twice; a
    /// result must name its call, so each gets its own (`call_<n>`).
    fn flush_calls(&mut self) -> Vec<Result<Event, ProviderError>> {
        let calls = std::mem::take(&mut self.calls);
        let given: Vec<String> = calls.iter().map(|(_, c)| c.id.clone()).collect();
        let mut used: Vec<String> = Vec::new();
        let mut out = Vec::new();
        for (at, (_, c)) in calls.into_iter().enumerate() {
            let mut id = c.id;
            // The first holder of a given id keeps it.
            let first = given.iter().position(|g| *g == id) == Some(at);
            if id.is_empty() || !first || used.contains(&id) {
                let mut n = at;
                id = format!("call_{n}");
                while used.contains(&id) || given.contains(&id) {
                    n += 1;
                    id = format!("call_{n}");
                }
            }
            used.push(id.clone());
            out.push(Ok(Event::ToolCall {
                input: input_of(&c.arguments),
                id,
                name: c.name,
            }));
        }
        out
    }
}

impl Wire for Parser {
    fn event(&mut self, _event: &str, data: &str) -> Vec<Result<Event, ProviderError>> {
        if data.trim() == "[DONE]" {
            self.done = true;
            return Vec::new();
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return vec![Err(ProviderError::Malformed)];
        };
        if v.get("error").is_some() {
            return vec![Err(ProviderError::Status(500))];
        }
        let mut out = Vec::new();
        if let Some(choice) = v["choices"].get(0) {
            let delta = &choice["delta"];
            for key in ["reasoning_content", "reasoning"] {
                if let Some(t) = delta[key].as_str().filter(|t| !t.is_empty()) {
                    out.push(Ok(Event::Thinking { text: t.to_owned() }));
                }
            }
            if let Some(t) = delta["content"].as_str().filter(|t| !t.is_empty()) {
                out.push(Ok(Event::Text { text: t.to_owned() }));
            }
            for tc in delta["tool_calls"].as_array().into_iter().flatten() {
                // A piece belongs to the latest call of its index (the latest
                // call when the server gives no index), unless it names
                // another id: then it starts a call of its own.
                let index = tc["index"].as_u64();
                let id = tc["id"].as_str().filter(|i| !i.is_empty());
                let found = match index {
                    Some(_) => self.calls.iter().rposition(|(i, _)| *i == index),
                    None => self.calls.len().checked_sub(1),
                };
                let at = match found {
                    Some(at)
                        if id.is_none_or(|id| {
                            let held = &self.calls[at].1.id;
                            held.is_empty() || held == id
                        }) =>
                    {
                        at
                    }
                    _ => {
                        self.calls.push((index, Call::default()));
                        self.calls.len() - 1
                    }
                };
                let call = &mut self.calls[at].1;
                if let Some(id) = tc["id"].as_str() {
                    call.id = id.to_owned();
                }
                if let Some(n) = tc["function"]["name"].as_str() {
                    call.name.push_str(n);
                }
                if let Some(a) = tc["function"]["arguments"].as_str() {
                    call.arguments.push_str(a);
                }
            }
            if let Some(reason) = choice["finish_reason"].as_str() {
                out.extend(self.flush_calls());
                let reason = match reason {
                    "tool_calls" | "function_call" => "tool_use",
                    "stop" => "end_turn",
                    "length" => "max_tokens",
                    other => other,
                };
                self.finished = true;
                out.push(Ok(Event::Stop {
                    reason: reason.to_owned(),
                }));
            }
        }
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            out.push(Ok(Event::Usage {
                input: u["prompt_tokens"].as_i64(),
                output: u["completion_tokens"].as_i64(),
            }));
        }
        out
    }

    fn end(&mut self) -> Vec<Result<Event, ProviderError>> {
        // Cut off before its end: a call may be half there, and is not kept.
        if !self.finished && !self.done {
            self.calls.clear();
            return vec![Err(ProviderError::Incomplete)];
        }
        let mut out = self.flush_calls();
        if !self.finished && !out.is_empty() {
            out.push(Ok(Event::Stop {
                reason: "tool_use".into(),
            }));
        }
        out
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
    fn a_stream_with_text_a_split_tool_call_and_usage_reads_neutral() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Adding \"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"add_entity\",\"arguments\":\"{\\\"kind\\\":\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\"host\\\"}\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":50,\"completion_tokens\":7}}\n\n",
            "data: [DONE]\n\n",
        );
        let events = parse_all(raw.as_bytes()).unwrap();
        assert_eq!(
            events,
            vec![
                Event::Text {
                    text: "Adding ".into()
                },
                Event::ToolCall {
                    id: "c1".into(),
                    name: "add_entity".into(),
                    input: serde_json::json!({"kind": "host"})
                },
                Event::Stop {
                    reason: "tool_use".into()
                },
                Event::Usage {
                    input: Some(50),
                    output: Some(7)
                },
            ]
        );
    }

    #[test]
    fn tool_results_become_tool_messages_and_markers_user_text() {
        let msgs = vec![
            Message {
                role: Role::Assistant,
                blocks: vec![Block::ToolCall {
                    id: "c1".into(),
                    name: "show".into(),
                    input: serde_json::json!({"id":"x"}),
                }],
            },
            Message {
                role: Role::Tool,
                blocks: vec![Block::ToolResult {
                    id: "c1".into(),
                    ok: false,
                    output: "no such item".into(),
                }],
            },
            Message {
                role: Role::Marker,
                blocks: vec![Block::Marker { left_out_turns: 3 }],
            },
        ];
        let body = body(&Request {
            system: "S",
            messages: &msgs,
            tools: &[],
            model: "m",
            reply_tokens: 10,
            replay_thinking: false,
        });
        let m = body["messages"].as_array().unwrap();
        assert_eq!(m[0]["role"], "system");
        assert_eq!(
            m[1]["tool_calls"][0]["function"]["arguments"],
            "{\"id\":\"x\"}"
        );
        assert_eq!(
            m[2],
            serde_json::json!({"role":"tool","tool_call_id":"c1","content":"error: no such item"})
        );
        assert_eq!(m[3]["content"], "[3 earlier turns left out]");
    }

    #[test]
    fn missing_or_repeated_call_ids_are_made_unique() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[",
            "{\"index\":0,\"function\":{\"name\":\"show\",\"arguments\":\"{}\"}},",
            "{\"index\":1,\"id\":\"\",\"function\":{\"name\":\"show\",\"arguments\":\"{}\"}},",
            "{\"index\":2,\"id\":\"call_0\",\"function\":{\"name\":\"show\",\"arguments\":\"{}\"}},",
            "{\"index\":3,\"id\":\"call_0\",\"function\":{\"name\":\"show\",\"arguments\":\"{}\"}}",
            "]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n",
        );
        let ids: Vec<String> = parse_all(raw.as_bytes())
            .unwrap()
            .into_iter()
            .filter_map(|e| match e {
                Event::ToolCall { id, .. } => Some(id),
                _ => None,
            })
            .collect();
        assert_eq!(ids.len(), 4);
        assert!(ids.iter().all(|i| !i.is_empty()), "{ids:?}");
        let mut unique = ids.clone();
        unique.sort();
        unique.dedup();
        assert_eq!(unique.len(), 4, "{ids:?}");
        assert!(ids.contains(&"call_0".to_owned()), "a given id is kept");
    }

    #[test]
    fn a_reply_of_thinking_only_is_not_sent_as_an_empty_assistant_message() {
        let msgs = vec![
            Message {
                role: Role::User,
                blocks: vec![Block::Text { text: "a".into() }],
            },
            Message {
                role: Role::Assistant,
                blocks: vec![Block::Thinking { text: "hm".into() }],
            },
            Message {
                role: Role::User,
                blocks: vec![Block::Text { text: "b".into() }],
            },
        ];
        let body = body(&Request {
            system: "S",
            messages: &msgs,
            tools: &[],
            model: "m",
            reply_tokens: 10,
            replay_thinking: true,
        });
        let roles: Vec<_> = body["messages"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["role"].as_str().unwrap().to_owned())
            .collect();
        assert_eq!(roles, ["system", "user", "user"]);
    }

    #[test]
    fn parallel_calls_without_an_index_stay_apart_by_their_ids() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[",
            "{\"id\":\"a\",\"type\":\"function\",\"function\":{\"name\":\"show\",\"arguments\":\"{\\\"id\\\":\"}},",
            "{\"function\":{\"arguments\":\"\\\"x\\\"}\"}},",
            "{\"id\":\"b\",\"type\":\"function\",\"function\":{\"name\":\"problems\",\"arguments\":\"{}\"}}",
            "]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c\",\"function\":{\"name\":\"read_document\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
            "data: [DONE]\n\n",
        );
        let calls: Vec<_> = parse_all(raw.as_bytes())
            .unwrap()
            .into_iter()
            .filter_map(|e| match e {
                Event::ToolCall { id, name, input } => Some((id, name, input)),
                _ => None,
            })
            .collect();
        assert_eq!(
            calls,
            vec![
                ("a".into(), "show".into(), serde_json::json!({"id": "x"})),
                ("b".into(), "problems".into(), serde_json::json!({})),
                ("c".into(), "read_document".into(), serde_json::json!({})),
            ]
        );
    }

    #[test]
    fn a_stream_cut_before_its_end_is_an_incomplete_reply_without_its_half_call() {
        let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"content\":\"Adding\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c1\",\"function\":{\"name\":\"add_entity\",\"arguments\":\"{\\\"kind\\\":\"}}]}}]}\n\n",
        );
        let mut p = Parser::default();
        let mut sse = super::super::provider::Sse::default();
        let mut out = Vec::new();
        for (e, d) in sse.feed(raw.as_bytes()) {
            out.extend(p.event(&e, &d));
        }
        out.extend(p.end());
        assert!(
            !out.iter().any(|e| matches!(e, Ok(Event::ToolCall { .. }))),
            "{out:?}"
        );
        assert_eq!(out.last(), Some(&Err(ProviderError::Incomplete)));
        // A stream that said [DONE] is whole, even without a finish reason.
        assert!(
            parse_all(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n"
            )
            .is_ok()
        );
    }

    #[test]
    fn unparseable_arguments_are_kept_for_the_page_to_refuse() {
        let raw = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"c\",\"function\":{\"name\":\"show\",\"arguments\":\"{oops\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
        let events = parse_all(raw.as_bytes()).unwrap();
        assert_eq!(
            events[0],
            Event::ToolCall {
                id: "c".into(),
                name: "show".into(),
                input: serde_json::json!({"_unparsed": "{oops"})
            }
        );
    }
}

#[cfg(test)]
mod kimi_tests {
    use super::*;
    use crate::assistant::message::*;

    fn call_msgs() -> Vec<Message> {
        vec![Message {
            role: Role::Assistant,
            blocks: vec![
                Block::Thinking {
                    text: "plan".into(),
                },
                Block::ToolCall {
                    id: "c".into(),
                    name: "show".into(),
                    input: serde_json::json!({}),
                },
            ],
        }]
    }

    #[test]
    fn replayed_thinking_goes_as_reasoning_content_only_where_asked() {
        let msgs = call_msgs();
        let mut req = Request {
            system: "S",
            messages: &msgs,
            tools: &[],
            model: "m",
            reply_tokens: 10,
            replay_thinking: true,
        };
        assert_eq!(body(&req)["messages"][1]["reasoning_content"], "plan");
        req.replay_thinking = false;
        assert!(body(&req)["messages"][1].get("reasoning_content").is_none());
    }
}
