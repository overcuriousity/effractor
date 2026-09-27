//! The agent chat's routes and turn loop (chat spec §3, §4.3–4.6, §8).
//!
//! The server builds every model request itself: the prompt of the
//! document's mode, the stored history fitted to the context, and the tools
//! the sender's role allows. The page only says what was written and what
//! its tool calls returned, and only for calls the server has on record.

use std::convert::Infallible;

use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
use axum::response::sse::{Event as SseEvent, Sse};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use effractor_accounts::assistant::{self as store, Claim, MessageRow, SessionRow};
use effractor_accounts::perms::{self, Role as DocRole};
use effractor_accounts::{Id, Transaction, users};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;

use crate::accounts::Accounts;
use crate::api::{ApiError, need};
use crate::assistant::message::{Block, Event, Message, ProviderError, Request, Role};
use crate::assistant::{Config, catalog, load, prompt, provider, scrub, window};
use crate::auth::session::CurrentUser;

/// What the page may say about what it shows, at most.
const STATE_BYTES: usize = 2048;
const DAY: u64 = 86_400;

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/assistant", get(info))
        .route(
            "/api/documents/{id}/assistant/sessions",
            get(list).post(create),
        )
        .route(
            "/api/assistant/sessions/{sid}",
            get(read).patch(rename).delete(remove),
        )
        .route("/api/assistant/sessions/{sid}/restore", post(restore))
        .route("/api/assistant/sessions/{sid}/messages", post(message))
        .route("/api/assistant/sessions/{sid}/results", post(results))
        .route("/api/assistant/sessions/{sid}/stop", post(stop))
        // The configured message size is checked in the handlers.
        .layer(DefaultBodyLimit::max(9 << 20))
}

async fn config(accounts: &Accounts) -> Result<Config, ApiError> {
    let pinned = accounts.assistant().pinned().map(str::to_owned);
    accounts
        .blocking(move |db| db.read(|c| load(c, pinned.as_deref())))
        .await
}

/// Nothing of the chat exists for someone without a grant.
async fn granted(accounts: &Accounts, user: Id) -> Result<(), ApiError> {
    if accounts
        .blocking(move |db| db.read(|c| store::allowed(c, user)))
        .await?
    {
        Ok(())
    } else {
        Err(ApiError::NotFound)
    }
}

async fn doc_role(accounts: &Accounts, user: Id, doc: Id) -> Result<DocRole, ApiError> {
    let role = accounts
        .blocking(move |db| db.read(|c| perms::document_role(c, user, doc)))
        .await?;
    need(role, DocRole::Viewer)
}

/// The session, if the caller may see it, and their role on its document.
async fn session_for(
    accounts: &Accounts,
    user: Id,
    sid: Id,
    deleted_too: bool,
) -> Result<(SessionRow, DocRole), ApiError> {
    granted(accounts, user).await?;
    let s = accounts
        .blocking(move |db| db.read(|c| store::session(c, sid)))
        .await?
        .ok_or(ApiError::NotFound)?;
    if s.deleted_at.is_some() && !deleted_too {
        return Err(ApiError::NotFound);
    }
    let role = doc_role(accounts, user, s.document_id).await?;
    Ok((s, role))
}

fn may_manage(s: &SessionRow, user: Id, role: DocRole) -> bool {
    s.created_by == Some(user) || role == DocRole::Owner
}

async fn info(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
) -> Result<Json<Value>, ApiError> {
    let cfg = config(&accounts).await?;
    let id = user.id;
    let allowed = accounts
        .blocking(move |db| db.read(|c| store::allowed(c, id)))
        .await?;
    if !(allowed && cfg.configured()) {
        return Ok(Json(
            json!({"allowed": false, "configured": cfg.configured()}),
        ));
    }
    let host = reqwest::Url::parse(&cfg.address)
        .ok()
        .and_then(|u| u.host_str().map(str::to_owned))
        .unwrap_or_default();
    Ok(Json(json!({
        "allowed": true, "configured": true, "host": host, "model": cfg.model,
        "message_bytes": cfg.message_bytes, "context": cfg.context,
    })))
}

async fn list(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(doc): Path<Id>,
) -> Result<Json<Vec<SessionRow>>, ApiError> {
    granted(&accounts, user.id).await?;
    doc_role(&accounts, user.id, doc).await?;
    Ok(Json(
        accounts
            .blocking(move |db| db.read(|c| store::sessions(c, doc)))
            .await?,
    ))
}

async fn create(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(doc): Path<Id>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    granted(&accounts, user.id).await?;
    doc_role(&accounts, user.id, doc).await?;
    let by = user.id;
    let id = accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| {
                let profile: String =
                    t.query_row("SELECT profile FROM documents WHERE id = ?1", [doc], |r| {
                        r.get(0)
                    })?;
                store::create_session(t, doc, &profile, by, now)
            })
        })
        .await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id }))))
}

fn blocks_of(row: &MessageRow) -> Vec<Block> {
    serde_json::from_str(&row.content).unwrap_or_default()
}

async fn read(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(sid): Path<Id>,
) -> Result<Json<Value>, ApiError> {
    let (s, role) = session_for(&accounts, user.id, sid, false).await?;
    let (rows, turn) = accounts
        .blocking(move |db| {
            db.read(|c| {
                let turn = match store::turn(c, sid)? {
                    Some(t) => {
                        let by = users::get(c, t.by)?.map(|u| u.name).unwrap_or_default();
                        Some(json!({"by": by, "since": t.since}))
                    }
                    None => None,
                };
                Ok((store::messages(c, sid)?, turn))
            })
        })
        .await?;
    let messages: Vec<Value> = rows
        .iter()
        .map(|m| {
            json!({
                "seq": m.seq, "turn": m.turn, "role": m.role, "author": m.author,
                "content": blocks_of(m), "input_tokens": m.input_tokens,
                "output_tokens": m.output_tokens, "created_at": m.created_at,
            })
        })
        .collect();
    Ok(Json(json!({
        "session": s, "messages": messages, "turn": turn,
        "role": role.as_str(), "may_manage": may_manage(&s, user.id, role),
    })))
}

#[derive(Deserialize)]
struct Title {
    title: String,
}

async fn rename(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(sid): Path<Id>,
    Json(b): Json<Title>,
) -> Result<StatusCode, ApiError> {
    let (s, role) = session_for(&accounts, user.id, sid, false).await?;
    if !may_manage(&s, user.id, role) {
        return Err(ApiError::Forbidden);
    }
    accounts
        .blocking(move |db| db.write(|t| store::rename_session(t, sid, &b.title)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn remove(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(sid): Path<Id>,
) -> Result<StatusCode, ApiError> {
    let (s, role) = session_for(&accounts, user.id, sid, false).await?;
    if !may_manage(&s, user.id, role) {
        return Err(ApiError::Forbidden);
    }
    accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| store::delete_session(t, sid, now))
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn restore(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(sid): Path<Id>,
) -> Result<StatusCode, ApiError> {
    let (s, role) = session_for(&accounts, user.id, sid, true).await?;
    if !may_manage(&s, user.id, role) {
        return Err(ApiError::Forbidden);
    }
    accounts
        .blocking(move |db| db.write(|t| store::restore_session(t, sid)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

// ---- the history ----

fn history(rows: &[MessageRow]) -> Vec<Message> {
    rows.iter()
        .filter_map(|r| {
            Some(Message {
                role: Role::parse(&r.role)?,
                blocks: blocks_of(r),
            })
        })
        .collect()
}

/// The calls of the last assistant message that have no result yet, and
/// the turn they belong to.
fn open_calls(rows: &[MessageRow]) -> (Vec<String>, i64) {
    let Some(at) = rows.iter().rposition(|r| r.role == "assistant") else {
        return (Vec::new(), 0);
    };
    let mut open: Vec<String> = blocks_of(&rows[at])
        .into_iter()
        .filter_map(|b| match b {
            Block::ToolCall { id, .. } => Some(id),
            _ => None,
        })
        .collect();
    for r in &rows[at + 1..] {
        for b in blocks_of(r) {
            if let Block::ToolResult { id, .. } = b {
                open.retain(|o| *o != id);
            }
        }
    }
    (open, rows[at].turn)
}

fn not_run(
    t: &Transaction,
    sid: Id,
    turn: i64,
    ids: &[String],
    why: &str,
    now: u64,
) -> effractor_accounts::Result<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let blocks: Vec<Block> = ids
        .iter()
        .map(|id| Block::ToolResult {
            id: id.clone(),
            ok: false,
            output: why.to_owned(),
        })
        .collect();
    let content = serde_json::to_string(&blocks).unwrap_or_default();
    store::append(t, sid, turn, "tool", None, &content, None, now)?;
    Ok(())
}

/// The first words of the first message, cut at a word.
fn title_from(text: &str) -> String {
    let one: String = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= 60 {
        return one;
    }
    let head: String = one.chars().take(60).collect();
    match head.rfind(' ') {
        Some(i) if i > 20 => format!("{}…", &head[..i]),
        _ => format!("{head}…"),
    }
}

fn state_line(s: &str) -> String {
    s.chars().take(STATE_BYTES).collect()
}

#[derive(Deserialize)]
struct Say {
    text: String,
    #[serde(default)]
    state: String,
}

async fn message(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(sid): Path<Id>,
    Json(b): Json<Say>,
) -> Result<Response, ApiError> {
    let (session, role) = session_for(&accounts, user.id, sid, false).await?;
    let cfg = config(&accounts).await?;
    if !cfg.configured() {
        return Err(ApiError::Unavailable("no endpoint".into()));
    }
    let text = b.text.trim().to_owned();
    if text.is_empty() {
        return Err(ApiError::Bad("say something".into()));
    }
    if text.len() > cfg.message_bytes as usize {
        return Err(ApiError::TooLong);
    }
    let me = user.id;
    if let Some(daily) = cfg.daily_tokens {
        let since = accounts.db().now().saturating_sub(DAY);
        let used = accounts
            .blocking(move |db| db.read(|c| store::used_since(c, me, since)))
            .await?;
        if used >= daily as i64 {
            return Err(ApiError::Budget);
        }
    }
    let edit = role >= DocRole::Editor;
    let access = if edit { "edit" } else { "read" };
    let stale_after = u64::from(cfg.steps) * cfg.timeout_seconds;
    let untitled = session.title.is_empty();
    let claimed = accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| {
                let turn = match store::claim(t, sid, me, access, now, stale_after)? {
                    Claim::Busy { by } => return Ok(Err(by)),
                    Claim::Claimed { turn, .. } => turn,
                };
                // Calls a page never answered (it went away) are said not run,
                // so the history stays valid for both wires.
                let rows = store::messages(t, sid)?;
                let (open, their_turn) = open_calls(&rows);
                not_run(t, sid, their_turn, &open, "not run", now)?;
                let content = serde_json::to_string(&[Block::Text { text: text.clone() }])
                    .unwrap_or_default();
                store::append(t, sid, turn, "user", Some(me), &content, None, now)?;
                if untitled {
                    store::rename_session(t, sid, &title_from(&text))?;
                }
                Ok(Ok(turn))
            })
        })
        .await?;
    let turn = claimed.map_err(|by| ApiError::Busy(format!("{by} is asking")))?;
    Ok(run_step(
        accounts,
        cfg,
        Step {
            sid,
            profile: session.profile,
            edit,
            turn,
            user: me,
            state: state_line(&b.state),
            first: true,
        },
    )
    .await)
}

#[derive(Deserialize)]
struct ToolResultIn {
    id: String,
    ok: bool,
    output: String,
}

#[derive(Deserialize)]
struct Results {
    results: Vec<ToolResultIn>,
    #[serde(default)]
    state: String,
}

async fn results(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(sid): Path<Id>,
    Json(b): Json<Results>,
) -> Result<Response, ApiError> {
    let (session, _) = session_for(&accounts, user.id, sid, false).await?;
    let cfg = config(&accounts).await?;
    let (turn, rows) = accounts
        .blocking(move |db| db.read(|c| Ok((store::turn(c, sid)?, store::messages(c, sid)?))))
        .await?;
    let Some(turn) = turn.filter(|t| t.by == user.id) else {
        return Err(ApiError::Busy("not your turn".into()));
    };
    let (mut open, _) = open_calls(&rows);
    let mut given: Vec<String> = b.results.iter().map(|r| r.id.clone()).collect();
    open.sort();
    given.sort();
    if open.is_empty() || open != given {
        return Err(ApiError::Bad("results do not match the calls".into()));
    }
    let limit = cfg.message_bytes as usize;
    let blocks: Vec<Block> = b
        .results
        .into_iter()
        .map(|r| Block::ToolResult {
            id: r.id,
            ok: r.ok,
            output: if r.output.chars().count() > limit {
                let head: String = r.output.chars().take(limit).collect();
                format!("{head}\n… cut at the message size")
            } else {
                r.output
            },
        })
        .collect();
    let content = serde_json::to_string(&blocks).unwrap_or_default();
    let turn_no = turn.turn;
    accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| store::append(t, sid, turn_no, "tool", None, &content, None, now))
        })
        .await?;
    Ok(run_step(
        accounts,
        cfg,
        Step {
            sid,
            profile: session.profile,
            edit: turn.access == "edit",
            turn: turn.turn,
            user: turn.by,
            state: state_line(&b.state),
            first: false,
        },
    )
    .await)
}

async fn stop(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
    Path(sid): Path<Id>,
) -> Result<StatusCode, ApiError> {
    let (_, role) = session_for(&accounts, user.id, sid, false).await?;
    let turn = accounts
        .blocking(move |db| db.read(|c| store::turn(c, sid)))
        .await?;
    let Some(turn) = turn else {
        return Ok(StatusCode::NO_CONTENT);
    };
    if turn.by != user.id && role != DocRole::Owner {
        return Err(ApiError::Forbidden);
    }
    // Streaming: the step stops itself and says so. Between steps (the page
    // was running tools): the open calls are said not run here.
    if !accounts.assistant().stop(sid) {
        accounts
            .blocking(move |db| {
                let now = db.now();
                db.write(|t| {
                    let rows = store::messages(t, sid)?;
                    let (open, their_turn) = open_calls(&rows);
                    not_run(t, sid, their_turn, &open, "not run", now)?;
                    store::release(t, sid)
                })
            })
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

// ---- one step: a model request, streamed ----

struct Step {
    sid: Id,
    profile: String,
    edit: bool,
    turn: i64,
    user: Id,
    state: String,
    first: bool,
}

fn sse(name: &str, data: Value) -> SseEvent {
    SseEvent::default().event(name).data(data.to_string())
}

async fn run_step(accounts: Accounts, cfg: Config, step: Step) -> Response {
    let (tx, rx) = mpsc::channel::<SseEvent>(64);
    tokio::spawn(drive(accounts, cfg, step, tx));
    Sse::new(ReceiverStream::new(rx).map(Ok::<_, Infallible>)).into_response()
}

async fn drive(accounts: Accounts, cfg: Config, step: Step, tx: mpsc::Sender<SseEvent>) {
    let sid = step.sid;
    let key = cfg.key.clone();
    let outcome = drive_inner(&accounts, &cfg, &step, &tx).await;
    let (end, open) = match outcome {
        Ok(o) => o,
        Err(e) => {
            // The database failed: say it plainly and let the turn go.
            tracing::error!(err = %scrub(&format!("{e:?}"), key.as_deref()), "chat step failed");
            (
                Ending::Error("database".into(), "could not store the reply".into()),
                Vec::new(),
            )
        }
    };
    let turn = step.turn;
    let why = match &end {
        Ending::Steps => "not run: step limit",
        _ => "not run",
    };
    let release = !matches!(end, Ending::Tools);
    let open_for_db = open.clone();
    let why = why.to_owned();
    let _ = accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| {
                if release {
                    not_run(t, sid, turn, &open_for_db, &why, now)?;
                    store::release(t, sid)?;
                }
                Ok(())
            })
        })
        .await;
    accounts.assistant().done(sid);
    let last = match end {
        Ending::Done => sse("end", json!({"reason": "done"})),
        Ending::Tools => sse("end", json!({"reason": "tools"})),
        Ending::Steps => sse("end", json!({"reason": "steps"})),
        Ending::Stopped => sse("end", json!({"reason": "stopped"})),
        Ending::Error(code, reason) => sse("error", json!({"code": code, "reason": reason})),
    };
    let _ = tx.send(last).await;
}

enum Ending {
    Done,
    Tools,
    Steps,
    Stopped,
    Error(String, String),
}

/// Streams one model request to the page and stores what came. Returns how
/// the step ended and the calls left without a result.
async fn drive_inner(
    accounts: &Accounts,
    cfg: &Config,
    step: &Step,
    tx: &mpsc::Sender<SseEvent>,
) -> Result<(Ending, Vec<String>), ApiError> {
    let sid = step.sid;
    let key = cfg.key.as_deref();
    let rows = accounts
        .blocking(move |db| db.read(|c| store::messages(c, sid)))
        .await?;
    let past = history(&rows);
    let system = prompt::system(&step.profile, step.edit, &step.state);
    let tools = catalog::tools(&step.profile, step.edit);
    let tools_chars: usize = tools
        .iter()
        .map(|t| t.name.len() + t.description.len() + t.schema.to_string().len())
        .sum();
    let mut budget = window::budget_chars(cfg.context, system.len(), tools_chars, cfg.reply_tokens);
    let steps = accounts
        .blocking(move |db| db.write(|t| store::bump_steps(t, sid)))
        .await?;
    let mut stop = accounts.assistant().stop_signal(sid);
    let http = provider::client(cfg.timeout_seconds);

    let mut text = String::new();
    let mut thinking = String::new();
    let mut calls: Vec<(String, String, Value)> = Vec::new();
    let mut usage: (Option<i64>, Option<i64>) = (None, None);
    let mut opened = false;
    let mut stopped = false;
    let mut failed: Option<ProviderError> = None;
    let mut marked = false;
    for attempt in 0..2 {
        let (msgs, left) = window::fit(&past, budget);
        if left > 0 && step.first && !marked {
            marked = true;
            let content = serde_json::to_string(&[Block::Marker {
                left_out_turns: left,
            }])
            .unwrap_or_default();
            let turn = step.turn;
            accounts
                .blocking(move |db| {
                    let now = db.now();
                    db.write(|t| store::append(t, sid, turn, "marker", None, &content, None, now))
                })
                .await?;
            let _ = tx
                .send(sse("marker", json!({"left_out_turns": left})))
                .await;
        }
        let req = Request {
            system: &system,
            messages: &msgs,
            tools: &tools,
            model: &cfg.model,
            reply_tokens: cfg.reply_tokens,
            replay_thinking: crate::assistant::replays_thinking(&cfg.address),
        };
        let mut events = match provider::stream(cfg, &req, &http).await {
            Err(ProviderError::ContextOverflow) if attempt == 0 => {
                budget /= 2;
                continue;
            }
            Err(e) => {
                failed = Some(e);
                break;
            }
            Ok(s) => s,
        };
        opened = true;
        loop {
            tokio::select! {
                Ok(()) = stop.changed() => {
                    if *stop.borrow() {
                        stopped = true;
                        break;
                    }
                }
                next = events.next() => {
                    let sent = match next {
                        None => break,
                        Some(Err(e)) => {
                            failed = Some(e);
                            break;
                        }
                        Some(Ok(Event::Text { text: t })) => {
                            let t = scrub(&t, key);
                            text.push_str(&t);
                            tx.send(sse("text", json!({"text": t}))).await
                        }
                        Some(Ok(Event::Thinking { text: t })) => {
                            let t = scrub(&t, key);
                            thinking.push_str(&t);
                            tx.send(sse("thinking", json!({"text": t}))).await
                        }
                        Some(Ok(Event::ToolCall { id, name, input })) => {
                            let r = tx.send(sse("tool_call", json!({"id": id, "name": name, "input": input}))).await;
                            calls.push((id, name, input));
                            r
                        }
                        Some(Ok(Event::Usage { input, output })) => {
                            usage = (input.or(usage.0), output.or(usage.1));
                            Ok(())
                        }
                        Some(Ok(Event::Stop { .. })) => Ok(()),
                    };
                    // The page is gone: stop, as if asked.
                    if sent.is_err() {
                        stopped = true;
                        break;
                    }
                }
            }
        }
        break;
    }

    let cut = stopped || failed.is_some();
    let mut blocks = Vec::new();
    if !thinking.is_empty() {
        blocks.push(Block::Thinking { text: thinking });
    }
    if !text.is_empty() {
        let text = scrub(&text, key);
        blocks.push(Block::Text {
            text: if cut {
                format!("{text} [interrupted]")
            } else {
                text
            },
        });
    }
    let ids: Vec<String> = calls.iter().map(|c| c.0.clone()).collect();
    for (id, name, input) in calls {
        blocks.push(Block::ToolCall { id, name, input });
    }
    let (turn, user) = (step.turn, step.user);
    let tokens = (usage.0.is_some() || usage.1.is_some())
        .then(|| (usage.0.unwrap_or(0), usage.1.unwrap_or(0)));
    let content = serde_json::to_string(&blocks).unwrap_or_default();
    let store_it = !blocks.is_empty();
    accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| {
                if store_it {
                    store::append(t, sid, turn, "assistant", None, &content, tokens, now)?;
                }
                if opened {
                    store::record_usage(t, user, Some(sid), usage.0, usage.1, now)?;
                }
                Ok(())
            })
        })
        .await?;

    Ok(if stopped {
        (Ending::Stopped, ids)
    } else if let Some(e) = failed {
        (Ending::Error(e.code().into(), e.reason()), ids)
    } else if ids.is_empty() {
        (Ending::Done, ids)
    } else if steps >= i64::from(cfg.steps) {
        (Ending::Steps, ids)
    } else {
        (Ending::Tools, ids)
    })
}

#[cfg(test)]
mod tests {
    use super::title_from;

    #[test]
    fn a_title_is_the_first_words_cut_at_a_word() {
        assert_eq!(title_from("add a  web\nhost"), "add a web host");
        let long =
            "please model the whole lab network with three hosts and a firewall between them";
        let t = title_from(long);
        assert!(t.ends_with('…') && t.chars().count() <= 61 && !t.contains("betwe…"));
    }
}
