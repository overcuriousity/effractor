mod common;
use axum::body::Body;
use axum::http::{Request, header};
use common::*;
use passkey::authenticator::{Authenticator, UiHint, UserCheck, UserValidationMethod};
use passkey::client::{Client, DefaultClientData};
use passkey::types::Passkey;
use passkey::types::ctap2::{Aaguid, Ctap2Error};
use passkey::types::webauthn::{CredentialCreationOptions, CredentialRequestOptions};
use serde_json::{Value, json};
use url::Url;

/// A person who is always there and always verified.
struct Present;

#[async_trait::async_trait]
impl UserValidationMethod for Present {
    type PasskeyItem = Passkey;
    async fn check_user<'a>(
        &self,
        _hint: UiHint<'a, Passkey>,
        _presence: bool,
        _verification: bool,
    ) -> Result<UserCheck, Ctap2Error> {
        Ok(UserCheck {
            presence: true,
            verification: true,
        })
    }
    fn is_verification_enabled(&self) -> Option<bool> {
        Some(true)
    }
    fn is_presence_enabled(&self) -> bool {
        true
    }
}

const PUBLIC: &str = "https://effractor.example";

async fn post(h: &H, path: &str, cookie: Option<&str>, body: Value) -> axum::response::Response {
    let mut req = Request::post(path)
        .header(header::HOST, "effractor.example")
        .header(header::ORIGIN, PUBLIC)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, format!("effractor_session={c}"));
    }
    h.send(req.body(Body::from(body.to_string())).unwrap())
        .await
}

#[tokio::test]
async fn a_user_adds_a_passkey_and_logs_in_with_it_without_a_name() {
    let h = harness_with(Some(PUBLIC));
    h.add_user("alice");
    let res = post(
        &h,
        "/api/auth/password",
        None,
        json!({"name": "alice", "password": PW}),
    )
    .await;
    let cookie = cookie_of(&res).unwrap();
    let me = json(h.call("GET", "/api/me", Some(&cookie), None).await).await;
    assert_eq!(me["login"]["passkey"], true);

    let start = json(post(&h, "/api/account/passkeys/start", Some(&cookie), json!({})).await).await;
    // Keeps the one passkey it makes: a resident key, as the server asked.
    let store: Option<Passkey> = None;
    let mut client = Client::new(Authenticator::new(Aaguid::new_empty(), store, Present));
    let origin = Url::parse(PUBLIC).unwrap();
    let ccr: CredentialCreationOptions = serde_json::from_value(start["options"].clone()).unwrap();
    let credential = client
        .register(&origin, ccr, DefaultClientData)
        .await
        .unwrap();
    let res = post(
        &h,
        "/api/account/passkeys/finish",
        Some(&cookie),
        json!({"ceremony": start["ceremony"], "credential": credential, "label": "Laptop"}),
    )
    .await;
    assert_eq!(res.status(), 201);

    let start = json(post(&h, "/api/auth/passkey/start", None, json!({})).await).await;
    let rcr: CredentialRequestOptions = serde_json::from_value(start["options"].clone()).unwrap();
    assert!(
        rcr.public_key
            .allow_credentials
            .as_ref()
            .is_none_or(|c| c.is_empty()),
        "usernameless"
    );
    let assertion = client
        .authenticate(&origin, rcr, DefaultClientData)
        .await
        .unwrap();
    let res = post(
        &h,
        "/api/auth/passkey/finish",
        None,
        json!({"ceremony": start["ceremony"], "credential": assertion}),
    )
    .await;
    assert_eq!(res.status(), 204);
    let token = cookie_of(&res).unwrap();
    assert_eq!(
        json(h.call("GET", "/api/me", Some(&token), None).await).await["user"]["name"],
        "alice"
    );
}

#[tokio::test]
async fn without_a_public_url_there_are_no_passkeys() {
    let h = harness();
    assert_eq!(
        json(h.call("GET", "/api/me", None, None).await).await["login"]["passkey"],
        false
    );
    assert_eq!(
        h.call("POST", "/api/auth/passkey/start", None, Some(json!({})))
            .await
            .status(),
        404
    );
}

#[tokio::test]
async fn a_ceremony_is_used_once() {
    let h = harness_with(Some(PUBLIC));
    let start = json(post(&h, "/api/auth/passkey/start", None, json!({})).await).await;
    let bogus = json!({"ceremony": start["ceremony"], "credential": {"id": "x"}});
    let first = post(&h, "/api/auth/passkey/finish", None, bogus.clone())
        .await
        .status();
    assert!(first == 400 || first == 401 || first == 422);
    assert_eq!(
        post(&h, "/api/auth/passkey/finish", None, bogus)
            .await
            .status(),
        401,
        "gone after one try"
    );
}

/// Adding a way in needs a fresh login: a stolen session cannot plant its
/// own passkey (review I5).
#[tokio::test]
async fn adding_a_passkey_needs_a_login_from_the_last_fifteen_minutes() {
    let h = harness_with(Some(PUBLIC));
    h.add_user("alice");
    let res = post(
        &h,
        "/api/auth/password",
        None,
        json!({"name": "alice", "password": PW}),
    )
    .await;
    let cookie = cookie_of(&res).unwrap();
    assert_eq!(
        post(&h, "/api/account/passkeys/start", Some(&cookie), json!({}))
            .await
            .status(),
        200
    );
    h.clock
        .fetch_add(16 * 60, std::sync::atomic::Ordering::Relaxed);
    let res = post(&h, "/api/account/passkeys/start", Some(&cookie), json!({})).await;
    assert_eq!(res.status(), 403);
    assert!(text(res).await.contains("log in again"));
}

/// Starting logins costs memory here: limited per address, as failed logins are.
#[tokio::test]
async fn starting_passkey_logins_is_limited_per_address() {
    let h = harness_with(Some(PUBLIC));
    let mut last = 0;
    for _ in 0..61 {
        last = post(&h, "/api/auth/passkey/start", None, json!({}))
            .await
            .status()
            .as_u16();
    }
    assert_eq!(last, 429);
}

/// Under a path prefix the passkey's origin is still scheme and host.
#[tokio::test]
async fn passkeys_work_under_a_path_prefix() {
    let h = harness_with(Some("https://effractor.example/tools"));
    h.add_user("alice");
    let res = post(
        &h,
        "/api/auth/password",
        None,
        json!({"name": "alice", "password": PW}),
    )
    .await;
    let cookie = cookie_of(&res).unwrap();
    let start = json(post(&h, "/api/account/passkeys/start", Some(&cookie), json!({})).await).await;
    let store: Option<Passkey> = None;
    let mut client = Client::new(Authenticator::new(Aaguid::new_empty(), store, Present));
    let origin = Url::parse(PUBLIC).unwrap();
    let ccr: CredentialCreationOptions = serde_json::from_value(start["options"].clone()).unwrap();
    let credential = client
        .register(&origin, ccr, DefaultClientData)
        .await
        .unwrap();
    let res = post(
        &h,
        "/api/account/passkeys/finish",
        Some(&cookie),
        json!({"ceremony": start["ceremony"], "credential": credential, "label": "Laptop"}),
    )
    .await;
    assert_eq!(res.status(), 201);
}
