mod common;
use std::sync::{Arc, Mutex};

use axum::Router;
use axum::body::Body;
use axum::extract::{Form, State};
use axum::http::{Request, header};
use axum::routing::{get, post};
use common::*;
use effractor_server::accounts::OidcConfig;
use openidconnect::core::*;
use openidconnect::*;
use serde_json::json;

const PUBLIC: &str = "https://effractor.example";
const KEY: &str = include_str!("fixtures/oidc-test-key.pem");

/// A code the fake issuer knows: (code, subject, preferred_username, nonce).
type Code = (String, String, String, String);

#[derive(Clone, Default)]
struct Issuer {
    url: Arc<Mutex<String>>,
    /// code -> (subject, preferred_username, nonce)
    codes: Arc<Mutex<Vec<Code>>>,
}

fn key() -> CoreRsaPrivateSigningKey {
    CoreRsaPrivateSigningKey::from_pem(KEY, Some(JsonWebKeyId::new("k1".into()))).unwrap()
}

async fn issuer() -> Issuer {
    let state = Issuer::default();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    *state.url.lock().unwrap() = url.clone();
    let app = Router::new()
        .route("/.well-known/openid-configuration", get(|State(s): State<Issuer>| async move {
            let url = s.url.lock().unwrap().clone();
            let meta = CoreProviderMetadata::new(
                IssuerUrl::new(url.clone()).unwrap(),
                AuthUrl::new(format!("{url}/authorize")).unwrap(),
                JsonWebKeySetUrl::new(format!("{url}/jwks")).unwrap(),
                vec![ResponseTypes::new(vec![CoreResponseType::Code])],
                vec![CoreSubjectIdentifierType::Public],
                vec![CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256],
                EmptyAdditionalProviderMetadata {},
            )
            .set_token_endpoint(Some(TokenUrl::new(format!("{url}/token")).unwrap()));
            axum::Json(serde_json::to_value(meta).unwrap())
        }))
        .route("/jwks", get(|| async {
            axum::Json(serde_json::to_value(CoreJsonWebKeySet::new(vec![key().as_verification_key()])).unwrap())
        }))
        .route("/token", post(|State(s): State<Issuer>, Form(form): Form<std::collections::HashMap<String, String>>| async move {
            let url = s.url.lock().unwrap().clone();
            let codes = s.codes.lock().unwrap().clone();
            let (_, sub, user, nonce) = codes.into_iter().find(|c| Some(&c.0) == form.get("code")).expect("known code");
            let now = chrono::Utc::now();
            let claims = CoreIdTokenClaims::new(
                IssuerUrl::new(url).unwrap(),
                vec![Audience::new("effractor".into())],
                now + chrono::Duration::minutes(5),
                now,
                StandardClaims::new(SubjectIdentifier::new(sub))
                    .set_preferred_username(Some(EndUserUsername::new(user))),
                EmptyAdditionalClaims {},
            )
            .set_nonce(Some(Nonce::new(nonce)));
            let token = CoreIdToken::new(claims, &key(), CoreJwsSigningAlgorithm::RsaSsaPkcs1V15Sha256, None, None).unwrap();
            axum::Json(json!({"access_token": "at", "token_type": "Bearer", "expires_in": 60, "id_token": token.to_string()}))
        }))
        .with_state(state.clone());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    state
}

fn query(url: &str, key: &str) -> String {
    url::Url::parse(url)
        .unwrap()
        .query_pairs()
        .find(|(k, _)| k == key)
        .unwrap()
        .1
        .into_owned()
}

async fn start(h: &H, cookie: Option<&str>, link: bool) -> (String, String) {
    let mut req = Request::post("/api/auth/oidc/start")
        .header(header::HOST, "effractor.example")
        .header(header::ORIGIN, PUBLIC)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, format!("effractor_session={c}"));
    }
    let res = h
        .send(
            req.body(Body::from(json!({"link": link}).to_string()))
                .unwrap(),
        )
        .await;
    assert_eq!(res.status(), 200);
    let bind = res.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let url = json(res).await["url"].as_str().unwrap().to_owned();
    (url, bind)
}

async fn callback(h: &H, code: &str, state: &str, cookies: &str) -> axum::response::Response {
    let req = Request::get(format!("/api/auth/oidc/callback?code={code}&state={state}"))
        .header(header::HOST, "effractor.example")
        .header(header::COOKIE, cookies);
    h.send(req.body(Body::empty()).unwrap()).await
}

/// As the page at the public url sends it: the Origin is the public url.
async fn public(
    h: &H,
    method: &str,
    path: &str,
    cookie: Option<&str>,
    body: serde_json::Value,
) -> axum::response::Response {
    let mut req = Request::builder()
        .method(method)
        .uri(path)
        .header(header::HOST, "effractor.example")
        .header(header::ORIGIN, PUBLIC)
        .header(header::CONTENT_TYPE, "application/json");
    if let Some(c) = cookie {
        req = req.header(header::COOKIE, format!("effractor_session={c}"));
    }
    h.send(req.body(Body::from(body.to_string())).unwrap())
        .await
}

async fn with_oidc() -> (H, Issuer) {
    let iss = issuer().await;
    let h = harness_with(Some(PUBLIC));
    h.accounts
        .with_oidc(OidcConfig {
            issuer: iss.url.lock().unwrap().clone(),
            client_id: "effractor".into(),
            secret: "s3cret".into(),
            label: "Nextcloud".into(),
        })
        .unwrap();
    (h, iss)
}

#[tokio::test]
async fn a_first_login_through_the_issuer_makes_an_account_and_logs_in() {
    let (h, iss) = with_oidc().await;
    assert_eq!(
        json(h.call("GET", "/api/me", None, None).await).await["login"]["oidc"],
        "Nextcloud"
    );
    let (url, bind) = start(&h, None, false).await;
    assert!(url.contains("code_challenge="), "PKCE");
    iss.codes.lock().unwrap().push((
        "c1".into(),
        "sub-1".into(),
        "alice".into(),
        query(&url, "nonce"),
    ));
    let res = callback(&h, "c1", &query(&url, "state"), &bind).await;
    assert_eq!(res.status(), 303);
    assert_eq!(
        res.headers()[header::LOCATION],
        "https://effractor.example/"
    );
    let session = res
        .headers()
        .get_all(header::SET_COOKIE)
        .iter()
        .filter_map(|v| {
            v.to_str()
                .ok()?
                .strip_prefix("effractor_session=")?
                .split(';')
                .next()
                .map(str::to_owned)
        })
        .find(|v| !v.is_empty())
        .expect("a session");
    assert_eq!(
        json(h.call("GET", "/api/me", Some(&session), None).await).await["user"]["name"],
        "alice"
    );
}

#[tokio::test]
async fn a_callback_without_the_starting_browsers_cookie_fails() {
    let (h, iss) = with_oidc().await;
    let (url, _bind) = start(&h, None, false).await;
    iss.codes.lock().unwrap().push((
        "c1".into(),
        "sub-1".into(),
        "alice".into(),
        query(&url, "nonce"),
    ));
    let res = callback(
        &h,
        "c1",
        &query(&url, "state"),
        "effractor_oidc=someone-else",
    )
    .await;
    assert_eq!(
        res.headers()[header::LOCATION],
        "https://effractor.example/?login=failed"
    );
}

#[tokio::test]
async fn a_wrong_nonce_fails() {
    let (h, iss) = with_oidc().await;
    let (url, bind) = start(&h, None, false).await;
    iss.codes.lock().unwrap().push((
        "c1".into(),
        "sub-1".into(),
        "alice".into(),
        "not-the-nonce".into(),
    ));
    let res = callback(&h, "c1", &query(&url, "state"), &bind).await;
    assert_eq!(
        res.headers()[header::LOCATION],
        "https://effractor.example/?login=failed"
    );
}

#[tokio::test]
async fn a_logged_in_user_links_the_issuer_and_logs_in_with_it_later() {
    let (h, iss) = with_oidc().await;
    h.add_user("bob");
    let res = public(
        &h,
        "POST",
        "/api/auth/password",
        None,
        json!({"name": "bob", "password": PW}),
    )
    .await;
    let b = cookie_of(&res).expect("bob logs in");
    let (url, bind) = start(&h, Some(&b), true).await;
    iss.codes.lock().unwrap().push((
        "c1".into(),
        "sub-bob".into(),
        "robert".into(),
        query(&url, "nonce"),
    ));
    let res = callback(
        &h,
        "c1",
        &query(&url, "state"),
        &format!("{bind}; effractor_session={b}"),
    )
    .await;
    assert_eq!(
        res.headers()[header::LOCATION],
        "https://effractor.example/"
    );
    let me = json(h.call("GET", "/api/me", Some(&b), None).await).await;
    assert_eq!(me["user"]["methods"]["oidc"], true);
    assert_eq!(
        public(&h, "DELETE", "/api/account/oidc", Some(&b), json!({}))
            .await
            .status(),
        204
    );
}

/// Linking an identity needs a fresh login: a stolen session cannot link
/// its own Nextcloud account for lasting access (review I5).
#[tokio::test]
async fn linking_needs_a_login_from_the_last_fifteen_minutes() {
    let (h, _iss) = with_oidc().await;
    h.add_user("bob");
    let res = public(
        &h,
        "POST",
        "/api/auth/password",
        None,
        json!({"name": "bob", "password": PW}),
    )
    .await;
    let b = cookie_of(&res).expect("bob logs in");
    h.clock
        .fetch_add(16 * 60, std::sync::atomic::Ordering::Relaxed);
    let res = public(
        &h,
        "POST",
        "/api/auth/oidc/start",
        Some(&b),
        json!({"link": true}),
    )
    .await;
    assert_eq!(res.status(), 403);
    // Logging in needs no session, fresh or not.
    let res = public(
        &h,
        "POST",
        "/api/auth/oidc/start",
        None,
        json!({"link": false}),
    )
    .await;
    assert_eq!(res.status(), 200);
}

/// Back to the public url, path included: a server under a prefix works.
#[tokio::test]
async fn the_callback_goes_back_to_the_public_url() {
    let iss = issuer().await;
    let h = harness_with(Some("https://effractor.example/tools"));
    h.accounts
        .with_oidc(OidcConfig {
            issuer: iss.url.lock().unwrap().clone(),
            client_id: "effractor".into(),
            secret: "s3cret".into(),
            label: "Nextcloud".into(),
        })
        .unwrap();
    let req = Request::post("/api/auth/oidc/start")
        .header(header::HOST, "effractor.example")
        .header(header::ORIGIN, "https://effractor.example")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(json!({"link": false}).to_string()))
        .unwrap();
    let res = h.send(req).await;
    assert_eq!(res.status(), 200);
    let url = json(res).await["url"].as_str().unwrap().to_owned();
    assert!(
        query(&url, "redirect_uri")
            .starts_with("https://effractor.example/tools/api/auth/oidc/callback")
    );
    let res = callback(&h, "nope", "nope", "effractor_oidc=x").await;
    assert_eq!(
        res.headers()[header::LOCATION],
        "https://effractor.example/tools/?login=failed"
    );
}

/// Starting logins costs a pending entry and an issuer request: limited per address.
#[tokio::test]
async fn starting_oidc_logins_is_limited_per_address() {
    let (h, _iss) = with_oidc().await;
    let mut last = 0;
    for _ in 0..61 {
        last = public(
            &h,
            "POST",
            "/api/auth/oidc/start",
            None,
            json!({"link": false}),
        )
        .await
        .status()
        .as_u16();
    }
    assert_eq!(last, 429);
}
