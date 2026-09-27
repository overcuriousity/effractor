//! Fitting a session into the model's context (chat spec §4.6): the task
//! (the first turn) and the latest turns stay, whole turns go from the
//! middle, and a marker says how many. A single oversized text keeps its head
//! and tail. Deterministic; nothing is summarised; the stored session is
//! never changed.

use super::message::{Block, Message, Role};

/// Characters to spend on the history: 3 per token, 80 % of what the reply
/// leaves, less the system prompt and the tools.
pub fn budget_chars(
    context_tokens: u32,
    system_chars: usize,
    tools_chars: usize,
    reply_tokens: u32,
) -> usize {
    (context_tokens.saturating_sub(reply_tokens) as usize * 3 * 8 / 10)
        .saturating_sub(system_chars)
        .saturating_sub(tools_chars)
}

fn cut(text: &str, limit: usize) -> String {
    let n = text.chars().count();
    if n <= limit {
        return text.to_owned();
    }
    let keep = limit / 2;
    let head: String = text.chars().take(keep).collect();
    let tail: String = text.chars().skip(n - keep).collect();
    format!("{head}\n… {} characters left out …\n{tail}", n - 2 * keep)
}

fn trimmed(m: &Message, limit: usize) -> Message {
    Message {
        role: m.role,
        blocks: m
            .blocks
            .iter()
            .map(|b| match b {
                Block::Text { text } => Block::Text {
                    text: cut(text, limit),
                },
                Block::ToolResult { id, ok, output } => Block::ToolResult {
                    id: id.clone(),
                    ok: *ok,
                    output: cut(output, limit),
                },
                other => other.clone(),
            })
            .collect(),
    }
}

fn size(m: &Message) -> usize {
    m.blocks
        .iter()
        .map(|b| match b {
            Block::Text { text } | Block::Thinking { text } => text.chars().count(),
            Block::ToolCall { name, input, .. } => name.len() + input.to_string().len() + 16,
            Block::ToolResult { output, .. } => output.chars().count() + 16,
            Block::Marker { .. } => 32,
        })
        .sum::<usize>()
        + 8
}

/// The messages to send, and how many whole turns were left out.
pub fn fit(history: &[Message], budget_chars: usize) -> (Vec<Message>, u32) {
    let limit = (budget_chars / 4).max(64);
    let msgs: Vec<Message> = history.iter().map(|m| trimmed(m, limit)).collect();
    // Turns start at each user message.
    let mut turns: Vec<Vec<Message>> = Vec::new();
    for m in msgs {
        if m.role == Role::User || turns.is_empty() {
            turns.push(Vec::new());
        }
        if let Some(t) = turns.last_mut() {
            t.push(m);
        }
    }
    let cost = |t: &Vec<Message>| t.iter().map(size).sum::<usize>();
    let total: usize = turns.iter().map(cost).sum();
    if total <= budget_chars || turns.len() <= 1 {
        return (turns.into_iter().flatten().collect(), 0);
    }
    let marker = 40;
    let last = turns.len() - 1;
    let first_cost = cost(&turns[0]);
    let keep_first = first_cost + cost(&turns[last]) + marker <= budget_chars;
    let mut used = if keep_first {
        first_cost + marker
    } else {
        marker
    };
    // The latest turns, as many as fit; the last one always.
    let mut from = last;
    used += cost(&turns[last]);
    while from > 1 && used + cost(&turns[from - 1]) <= budget_chars {
        from -= 1;
        used += cost(&turns[from]);
    }
    let left = (from - usize::from(keep_first)) as u32;
    let mut out = Vec::new();
    if keep_first {
        out.extend(turns[0].iter().cloned());
    }
    if left > 0 {
        out.push(Message {
            role: Role::Marker,
            blocks: vec![Block::Marker {
                left_out_turns: left,
            }],
        });
    }
    for t in &turns[from..] {
        out.extend(t.iter().cloned());
    }
    (out, left)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assistant::message::*;

    fn user(t: &str) -> Message {
        Message {
            role: Role::User,
            blocks: vec![Block::Text { text: t.into() }],
        }
    }
    fn said(t: &str) -> Message {
        Message {
            role: Role::Assistant,
            blocks: vec![Block::Text { text: t.into() }],
        }
    }

    #[test]
    fn everything_fits_nothing_changes() {
        let h = vec![user("a"), said("b"), user("c"), said("d")];
        let (out, left) = fit(&h, 10_000);
        assert_eq!((out, left), (h, 0));
    }

    #[test]
    fn the_middle_goes_and_a_marker_says_how_many_turns() {
        let mut h = vec![user("TASK"), said("ok")];
        for i in 0..10 {
            h.push(user(&format!("q{i} {}", "x".repeat(100))));
            h.push(said("y"));
        }
        let (out, left) = fit(&h, 500);
        assert!(left > 0);
        assert_eq!(out[0], user("TASK"));
        assert_eq!(
            out[2],
            Message {
                role: Role::Marker,
                blocks: vec![Block::Marker {
                    left_out_turns: left
                }]
            }
        );
        assert_eq!(out.last().unwrap(), &said("y"));
        assert!(
            matches!(&out[out.len() - 2].blocks[0], Block::Text { text } if text.starts_with("q9"))
        );
    }

    #[test]
    fn a_huge_result_keeps_its_head_and_tail() {
        let big = format!("HEAD{}TAIL", "z".repeat(10_000));
        let h = vec![
            user("a"),
            Message {
                role: Role::Tool,
                blocks: vec![Block::ToolResult {
                    id: "1".into(),
                    ok: true,
                    output: big,
                }],
            },
        ];
        let (out, _) = fit(&h, 2_000);
        let Block::ToolResult { output, .. } = &out[1].blocks[0] else {
            panic!()
        };
        assert!(
            output.starts_with("HEAD")
                && output.ends_with("TAIL")
                && output.contains("characters left out")
        );
        assert!(output.len() < 2_000);
    }

    #[test]
    fn it_is_deterministic() {
        let h: Vec<_> = (0..30)
            .flat_map(|i| [user(&"u".repeat(i * 10)), said("s")])
            .collect();
        assert_eq!(fit(&h, 700), fit(&h, 700));
    }
}
