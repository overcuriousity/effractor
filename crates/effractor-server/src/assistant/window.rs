//! Fitting a session into the model's context (chat spec §4.6): the task
//! (the first turn) and the latest turns stay, whole turns go from the
//! middle, and a marker says how many. Only when the task's turn and the
//! latest one do not fit together are their largest texts cut, largest
//! first and only as far as needed, to a head and a tail. Deterministic;
//! nothing is summarised; the stored session is never changed.

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

/// The messages to send, and how many whole turns were left out. Whole
/// turns go from the middle first; only when the task's turn and the latest
/// one do not fit together are their texts cut.
pub fn fit(history: &[Message], budget_chars: usize) -> (Vec<Message>, u32) {
    if let Some(sent) = by_turns(history.to_vec(), budget_chars, false) {
        return sent;
    }
    by_turns(cut_to_fit(history, budget_chars), budget_chars, true).unwrap_or_default()
}

/// Room for the marker, as `by_turns` counts it.
const MARKER: usize = 40;
/// No text is cut shorter than this.
const FLOOR: usize = 64;

/// How long a text of `n` characters is once cut to `limit`.
fn cut_len(n: usize, limit: usize) -> usize {
    if n <= limit {
        return n;
    }
    let keep = limit / 2;
    let said = format!("\n… {} characters left out …\n", n - 2 * keep);
    (2 * keep + said.chars().count()).min(n)
}

/// The history with the texts of the task's turn and the latest turn cut
/// to one length, the longest that lets the two fit: the largest texts are
/// cut first, and no more than needed. Other turns are left as they are.
fn cut_to_fit(history: &[Message], budget_chars: usize) -> Vec<Message> {
    let starts: Vec<usize> = (0..history.len())
        .filter(|&i| i == 0 || history[i].role == Role::User)
        .collect();
    let first_end = starts.get(1).copied().unwrap_or(history.len());
    let last_start = starts.last().copied().unwrap_or(0);
    let kept = |i: usize| i < first_end || i >= last_start;
    let chars = |b: &Block| match b {
        Block::Text { text } => Some(text.chars().count()),
        Block::ToolResult { output, .. } => Some(output.chars().count()),
        _ => None,
    };
    let texts: Vec<usize> = (0..history.len())
        .filter(|&i| kept(i))
        .flat_map(|i| history[i].blocks.iter().filter_map(chars))
        .collect();
    let whole: usize = (0..history.len())
        .filter(|&i| kept(i))
        .map(|i| size(&history[i]))
        .sum::<usize>()
        + MARKER;
    let fixed = whole - texts.iter().sum::<usize>();
    let total = |limit: usize| fixed + texts.iter().map(|&n| cut_len(n, limit)).sum::<usize>();
    // The longest length that fits; the floor when none does.
    let (mut lo, mut hi) = (
        FLOOR,
        texts.iter().copied().max().unwrap_or(FLOOR).max(FLOOR),
    );
    while lo < hi {
        let mid = lo + (hi - lo).div_ceil(2);
        if total(mid) <= budget_chars {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    let limit = lo;
    let cut_block = |b: &Block| match b {
        Block::Text { text } if cut_len(text.chars().count(), limit) < text.chars().count() => {
            Block::Text {
                text: cut(text, limit),
            }
        }
        Block::ToolResult { id, ok, output }
            if cut_len(output.chars().count(), limit) < output.chars().count() =>
        {
            Block::ToolResult {
                id: id.clone(),
                ok: *ok,
                output: cut(output, limit),
            }
        }
        other => other.clone(),
    };
    history
        .iter()
        .enumerate()
        .map(|(i, m)| {
            if kept(i) {
                Message {
                    role: m.role,
                    blocks: m.blocks.iter().map(cut_block).collect(),
                }
            } else {
                m.clone()
            }
        })
        .collect()
}

/// The task's turn and the latest turns that fit, a marker for the rest;
/// `None` when the task's turn and the latest one do not fit whole, unless
/// `anyway`.
fn by_turns(msgs: Vec<Message>, budget_chars: usize, anyway: bool) -> Option<(Vec<Message>, u32)> {
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
    if total <= budget_chars {
        return Some((turns.into_iter().flatten().collect(), 0));
    }
    let marker = MARKER;
    let last = turns.len().checked_sub(1)?;
    if last == 0 {
        return anyway.then(|| (turns.into_iter().flatten().collect(), 0));
    }
    let first_cost = cost(&turns[0]);
    // The task's turn stays: rather cut than lose it.
    if !anyway && first_cost + cost(&turns[last]) + marker > budget_chars {
        return None;
    }
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
    Some((out, left))
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
    fn a_large_result_is_sent_whole_while_everything_fits() {
        // The component catalog is read once and is larger than a quarter
        // of the default budget; with room to spare it goes whole.
        let catalog = "c".repeat(12_000);
        let h = vec![
            user("a"),
            Message {
                role: Role::Tool,
                blocks: vec![Block::ToolResult {
                    id: "1".into(),
                    ok: true,
                    output: catalog,
                }],
            },
        ];
        let (out, left) = fit(&h, 40_000);
        assert_eq!((out, left), (h, 0));
    }

    #[test]
    fn middle_turns_go_before_any_result_is_cut() {
        // A long session: the task's turn read the catalog; dropping the
        // middle makes room, so the catalog stays whole.
        let catalog = "c".repeat(3_000);
        let mut h = vec![
            user("TASK"),
            Message {
                role: Role::Tool,
                blocks: vec![Block::ToolResult {
                    id: "1".into(),
                    ok: true,
                    output: catalog.clone(),
                }],
            },
        ];
        for i in 0..20 {
            h.push(user(&format!("q{i} {}", "x".repeat(500))));
            h.push(said("y"));
        }
        let (out, left) = fit(&h, 6_000);
        assert!(left > 0);
        assert_eq!(out[1], h[1], "the catalog is sent whole");
    }

    #[test]
    fn a_task_turn_too_large_to_keep_whole_is_cut_not_dropped() {
        let h = vec![
            user(&format!("TASK{}END", "t".repeat(5_000))),
            said("ok"),
            user("next"),
            said("done"),
        ];
        let (out, _) = fit(&h, 3_000);
        let Block::Text { text } = &out[0].blocks[0] else {
            panic!()
        };
        assert!(text.starts_with("TASK") && text.contains("characters left out"));
        assert_eq!(out.last().unwrap(), &said("done"));
    }

    fn result(id: &str, output: String) -> Message {
        Message {
            role: Role::Tool,
            blocks: vec![Block::ToolResult {
                id: id.into(),
                ok: true,
                output,
            }],
        }
    }

    #[test]
    fn only_as_much_is_cut_as_needed_largest_first() {
        // The default budget; the task's turn read the catalog, the latest
        // one a long document. The catalog stays whole; only the document
        // is cut, and only to what fits.
        let budget = 43_000;
        let catalog = "c".repeat(12_000);
        let doc = format!("HEAD{}TAIL", "d".repeat(35_000));
        let mut h = vec![user("TASK"), result("1", catalog.clone())];
        for i in 0..5 {
            h.push(user(&format!("q{i}")));
            h.push(said("y"));
        }
        h.push(user("read this"));
        h.push(result("2", doc));
        let (out, left) = fit(&h, budget);
        assert_eq!(left, 5);
        assert_eq!(out[1], h[1], "the catalog is sent whole");
        let Block::ToolResult { output, .. } = &out.last().unwrap().blocks[0] else {
            panic!()
        };
        assert!(output.starts_with("HEAD") && output.ends_with("TAIL"));
        assert!(output.contains("characters left out"));
        let sent: usize = out.iter().map(size).sum();
        assert!(sent <= budget, "{sent}");
        assert!(
            output.chars().count() > budget - 12_000 - 400,
            "cut no more than needed"
        );
    }

    #[test]
    fn it_is_deterministic() {
        let h: Vec<_> = (0..30)
            .flat_map(|i| [user(&"u".repeat(i * 10)), said("s")])
            .collect();
        assert_eq!(fit(&h, 700), fit(&h, 700));
    }
}
