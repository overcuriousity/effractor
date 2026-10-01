//! The chat's administration (chat spec §5): site admins only. Changes need
//! a recent login; the key is never answered, only whether one is set.

use axum::extract::State;
use axum::http::StatusCode;
use axum::routing::{get, post, put};
use axum::{Json, Router};
use effractor_accounts::assistant::{self, Grantee};
use effractor_accounts::users::User;
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::accounts::Accounts;
use crate::api::ApiError;
use crate::assistant::message::{Block, Event, Message, ProviderError, Request, Role};
use crate::assistant::{Provider, is_address, load, provider, scrub};
use crate::auth::session::{self, CurrentUser};

const DAY: u64 = 86_400;

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/admin/assistant", get(show).put(change))
        .route("/api/admin/assistant/models", post(models))
        .route("/api/admin/assistant/test", post(test))
        .route("/api/admin/assistant/grants", put(give).delete(take))
}

pub(crate) fn admin_only(user: &User) -> Result<(), ApiError> {
    if user.admin {
        Ok(())
    } else {
        Err(ApiError::Forbidden)
    }
}

async fn show(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
) -> Result<Json<Value>, ApiError> {
    admin_only(&user)?;
    let pins = accounts.assistant().pins();
    let since = accounts.db().now().saturating_sub(DAY);
    let (config, grants, usage) = accounts
        .blocking(move |db| {
            db.read(|c| {
                Ok((
                    load(c, &pins)?,
                    assistant::grants(c)?,
                    assistant::usage(c, since)?,
                ))
            })
        })
        .await?;
    Ok(Json(
        json!({ "config": config, "grants": grants, "usage": usage }),
    ))
}

/// Absent: unchanged. `key` and `daily_tokens` may be null: cleared.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Change {
    provider: Option<String>,
    address: Option<String>,
    #[serde(default, deserialize_with = "present")]
    key: Option<Option<String>>,
    model: Option<String>,
    user_agent: Option<String>,
    steps: Option<u64>,
    context: Option<u64>,
    reply_tokens: Option<u64>,
    message_bytes: Option<u64>,
    #[serde(default, deserialize_with = "present")]
    daily_tokens: Option<Option<u64>>,
    timeout_seconds: Option<u64>,
}

/// Present (even as null) is `Some`; absent stays `None` by `default`.
fn present<'de, D, T>(d: D) -> Result<Option<Option<T>>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(d).map(Some)
}

fn within(name: &str, v: Option<u64>, lo: u64, hi: u64) -> Result<Option<String>, ApiError> {
    match v {
        None => Ok(None),
        Some(n) if (lo..=hi).contains(&n) => Ok(Some(n.to_string())),
        Some(_) => Err(ApiError::Bad(format!("{name}: {lo} to {hi}"))),
    }
}

const NOT_AN_ADDRESS: &str = "address: an http or https address, not a link-local one";

async fn change(
    State(accounts): State<Accounts>,
    CurrentUser(user, token): CurrentUser,
    Json(b): Json<Change>,
) -> Result<StatusCode, ApiError> {
    admin_only(&user)?;
    session::fresh(&accounts, &token).await?;
    if let Some(p) = &b.provider
        && Provider::parse(p).is_none()
    {
        return Err(ApiError::Bad("provider: openai or anthropic".into()));
    }
    let address = match &b.address {
        Some(a) if !a.trim().is_empty() && !is_address(a.trim()) => {
            return Err(ApiError::Bad(NOT_AN_ADDRESS.into()));
        }
        Some(a) => Some(a.trim().trim_end_matches('/').to_owned()),
        None => None,
    };
    if matches!(b.key, Some(Some(_))) && accounts.assistant().pinned().is_some() {
        return Err(ApiError::Refused("the key is set by the operator".into()));
    }
    let numbers = [
        ("assistant.steps", within("steps", b.steps, 1, 10_000)?),
        (
            "assistant.context",
            within("context", b.context, 1024, 10_000_000)?,
        ),
        (
            "assistant.reply_tokens",
            within("reply tokens", b.reply_tokens, 16, 1_000_000)?,
        ),
        (
            "assistant.message_bytes",
            within("message size", b.message_bytes, 1024, 8 << 20)?,
        ),
        (
            "assistant.timeout_seconds",
            within("timeout", b.timeout_seconds, 5, 3600)?,
        ),
    ];
    let daily = match b.daily_tokens {
        Some(Some(0)) => return Err(ApiError::Bad("daily tokens: 1 or more, or empty".into())),
        other => other,
    };
    let by = user.id;
    let pins = accounts.assistant().pins();
    accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| {
                // The operator's key goes only to the operator's address, or
                // to the first one saved with it; checked where it is saved.
                if let Some(a) = &address {
                    let stored = assistant::setting(t, "assistant.address")?;
                    let fixed = match (&pins.address, &pins.key, &stored) {
                        (Some(p), _, _) => Some((p, "the address is set by the operator")),
                        (None, Some(_), Some(s)) => {
                            Some((s, "the address stays: the operator's key goes only there"))
                        }
                        _ => None,
                    };
                    if let Some((at, why)) = fixed
                        && a != at
                    {
                        return Ok(Err(ApiError::Refused(why.into())));
                    }
                }
                let set = |k: &str, v: Option<&str>| assistant::set_setting(t, k, v, by, now);
                if let Some(p) = &b.provider {
                    set("assistant.provider", Some(p))?;
                }
                if let Some(a) = address.as_ref().filter(|_| pins.address.is_none()) {
                    set(
                        "assistant.address",
                        Some(a).filter(|a| !a.is_empty()).map(String::as_str),
                    )?;
                }
                if let Some(k) = &b.key {
                    set("assistant.key", k.as_deref().filter(|k| !k.is_empty()))?;
                }
                if let Some(ua) = &b.user_agent {
                    set(
                        "assistant.user_agent",
                        Some(ua.trim()).filter(|u| !u.is_empty()),
                    )?;
                }
                if let Some(m) = &b.model {
                    set("assistant.model", Some(m.trim()).filter(|m| !m.is_empty()))?;
                }
                for (k, v) in &numbers {
                    if let Some(v) = v {
                        set(k, Some(v))?;
                    }
                }
                if let Some(d) = daily {
                    set(
                        "assistant.daily_tokens",
                        d.map(|d| d.to_string()).as_deref(),
                    )?;
                }
                Ok(Ok(()))
            })
        })
        .await??;
    Ok(StatusCode::NO_CONTENT)
}

async fn give(
    State(accounts): State<Accounts>,
    CurrentUser(user, token): CurrentUser,
    Json(who): Json<Grantee>,
) -> Result<StatusCode, ApiError> {
    admin_only(&user)?;
    session::fresh(&accounts, &token).await?;
    let by = user.id;
    accounts
        .blocking(move |db| {
            let now = db.now();
            db.write(|t| assistant::grant(t, who, by, now))
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn take(
    State(accounts): State<Accounts>,
    CurrentUser(user, token): CurrentUser,
    Json(who): Json<Grantee>,
) -> Result<StatusCode, ApiError> {
    admin_only(&user)?;
    session::fresh(&accounts, &token).await?;
    accounts
        .blocking(move |db| db.write(|t| assistant::revoke(t, who)))
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
struct ListModels {
    provider: String,
    address: String,
    key: Option<String>,
    user_agent: Option<String>,
}

/// The models, or none and why, for a recent login: like saving, it sends
/// a key out. A typed key goes where it was typed for; the stored one goes
/// to the address listed, which the admin could save as well.
async fn models(
    State(accounts): State<Accounts>,
    CurrentUser(user, token): CurrentUser,
    Json(b): Json<ListModels>,
) -> Result<Json<Value>, ApiError> {
    admin_only(&user)?;
    session::fresh(&accounts, &token).await?;
    let Some(p) = Provider::parse(&b.provider) else {
        return Err(ApiError::Bad("provider: openai or anthropic".into()));
    };
    let address = b.address.trim().trim_end_matches('/').to_owned();
    if !is_address(&address) {
        return Ok(Json(
            json!({"models": [], "reason": "not an http or https address, or a link-local one"}),
        ));
    }
    let pins = accounts.assistant().pins();
    let cfg = accounts
        .blocking(move |db| db.read(|c| load(c, &pins)))
        .await?;
    // A fixed address is the only one: the operator's key goes nowhere else.
    if cfg.address_fixed && address != cfg.address {
        return Ok(Json(
            json!({"models": [], "reason": "the address is fixed by the operator"}),
        ));
    }
    let key = b.key.filter(|k| !k.is_empty()).or_else(|| cfg.key.clone());
    let http = provider::admin_client(cfg.timeout_seconds.min(30));
    let ua = b.user_agent.unwrap_or(cfg.user_agent.clone());
    Ok(Json(
        match provider::models(p, &address, key.as_deref(), ua.trim(), &http).await {
            Ok(list) => json!({ "models": list }),
            Err(e) => json!({ "models": [], "reason": e.reason() }),
        },
    ))
}

/// One tiny request to the saved endpoint, said in plain words.
async fn test(
    State(accounts): State<Accounts>,
    CurrentUser(user, _): CurrentUser,
) -> Result<Json<Value>, ApiError> {
    admin_only(&user)?;
    // The saved address, or the operator's: never one only typed.
    let pins = accounts.assistant().pins();
    let cfg = accounts
        .blocking(move |db| db.read(|c| load(c, &pins)))
        .await?;
    if !cfg.configured() {
        return Ok(Json(
            json!({"ok": false, "said": "no address or model yet"}),
        ));
    }
    let messages = [Message {
        role: Role::User,
        blocks: vec![Block::Text {
            text: "Say ok.".into(),
        }],
    }];
    // What a turn sends: the prompt and tools of an editor on an
    // architecture, the largest set, so a refused tool shows here.
    let system = crate::assistant::prompt::system("architecture", true, "");
    let tools = crate::assistant::catalog::tools("architecture", true);
    let req = Request {
        system: &system,
        messages: &messages,
        tools: &tools,
        model: &cfg.model,
        reply_tokens: 64,
        replay_thinking: crate::assistant::replays_thinking(&cfg.address),
    };
    let http = provider::admin_client(cfg.timeout_seconds);
    let mut said = String::new();
    let outcome = match provider::stream_explained(&cfg, &req, &http).await {
        Err(e) => Err(e),
        Ok(mut events) => {
            let mut failed = None;
            while let Some(e) = events.next().await {
                match e {
                    Ok(Event::Text { text }) => said.push_str(&text),
                    Ok(_) => {}
                    Err(e) => {
                        failed = Some((e, None));
                        break;
                    }
                }
            }
            failed.map_or(Ok(()), Err)
        }
    };
    Ok(Json(match outcome {
        Ok(()) => {
            let head: String = said.trim().chars().take(60).collect();
            json!({"ok": true, "said": scrub(&format!("answered: {head}"), cfg.key.as_deref())})
        }
        Err((e, detail)) => {
            // For the admin, what the provider said, scrubbed of the key.
            let said = match detail {
                Some(d)
                    if matches!(e, ProviderError::Status(_) | ProviderError::ContextOverflow) =>
                {
                    format!("{}: {d}", e.reason())
                }
                _ => e.reason(),
            };
            json!({"ok": false, "said": scrub(&said, cfg.key.as_deref())})
        }
    }))
}
