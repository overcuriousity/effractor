//! The share API over HTTP: what a browser sees.

use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, StatusCode, header};
use axum::response::Response;
use effractor_server::share::{Limits, MemoryStorage, Shares, Storage, Ttl};
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

const DAY: u64 = 86_400;

struct Harness {
    app: Router,
    clock: Arc<AtomicU64>,
    storage: Arc<MemoryStorage>,
}

fn harness(limits: Limits) -> Harness {
    let clock = Arc::new(AtomicU64::new(1_000_000));
    let storage = Arc::new(MemoryStorage::default());
    let now = clock.clone();
    let shares =
        Shares::new(storage.clone(), limits).with_clock(move || now.load(Ordering::Relaxed));
    Harness {
        app: effractor_server::app(shares),
        clock,
        storage,
    }
}

impl Harness {
    async fn send(&self, mut req: Request<Body>, from: [u8; 4]) -> Response {
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from((from, 40000))));
        self.app.clone().oneshot(req).await.unwrap()
    }

    async fn create(&self, query: &str, body: Vec<u8>) -> Response {
        let req = Request::post(format!("/api/share{query}"))
            .body(Body::from(body))
            .unwrap();
        self.send(req, [10, 0, 0, 1]).await
    }

    async fn get(&self, id: &str) -> Response {
        self.send(
            Request::get(format!("/api/share/{id}"))
                .body(Body::empty())
                .unwrap(),
            [10, 0, 0, 1],
        )
        .await
    }

    async fn delete(&self, id: &str, token: Option<&str>) -> Response {
        let mut req = Request::delete(format!("/api/share/{id}"));
        if let Some(token) = token {
            req = req.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        self.send(req.body(Body::empty()).unwrap(), [10, 0, 0, 1])
            .await
    }
}

async fn bytes(res: Response) -> Vec<u8> {
    res.into_body().collect().await.unwrap().to_bytes().to_vec()
}

async fn json(res: Response) -> Value {
    serde_json::from_slice(&bytes(res).await).unwrap()
}

#[tokio::test]
async fn a_share_is_created_fetched_and_deleted() {
    let h = harness(Limits::default());
    let res = h.create("", b"ciphertext".to_vec()).await;
    assert_eq!(res.status(), StatusCode::CREATED);
    assert_eq!(res.headers()["referrer-policy"], "no-referrer");
    let made = json(res).await;
    let (id, token) = (
        made["id"].as_str().unwrap(),
        made["delete_token"].as_str().unwrap(),
    );
    assert_eq!(id.len(), 22);
    assert_eq!(token.len(), 22);
    // Ninety days unless asked otherwise.
    assert_eq!(made["expires_at"], 1_000_000 + 90 * DAY);

    let res = h.get(id).await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(
        res.headers()[header::CONTENT_TYPE],
        "application/octet-stream"
    );
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
    assert_eq!(res.headers()["x-robots-tag"], "noindex");
    assert_eq!(bytes(res).await, b"ciphertext");

    assert_eq!(
        h.delete(id, Some(token)).await.status(),
        StatusCode::NO_CONTENT
    );
    assert_eq!(h.get(id).await.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        h.delete(id, Some(token)).await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_server_keeps_only_a_hash_of_the_delete_token() {
    let h = harness(Limits::default());
    let made = json(h.create("", b"x".to_vec()).await).await;
    let id = made["id"].as_str().unwrap().parse().unwrap();
    let (_, meta) = h.storage.get(&id).await.unwrap().unwrap();
    let token = made["delete_token"].as_str().unwrap();
    assert_eq!(meta.delete_token_hash.len(), 64);
    assert!(!meta.delete_token_hash.contains(token));
    assert_eq!(meta.size, 1);
}

#[tokio::test]
async fn deleting_needs_the_token() {
    let h = harness(Limits::default());
    let made = json(h.create("", b"x".to_vec()).await).await;
    let id = made["id"].as_str().unwrap();
    assert_eq!(h.delete(id, None).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        h.delete(id, Some("AAAAAAAAAAAAAAAAAAAAAA")).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(h.delete(id, Some("")).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(h.get(id).await.status(), StatusCode::OK);
}

#[tokio::test]
async fn ttl_is_chosen_at_creation_and_fixed() {
    let h = harness(Limits::default());
    for (query, days) in [
        ("?ttl=1d", 1),
        ("?ttl=30d", 30),
        ("?ttl=90d", 90),
        ("?ttl=1y", 365),
    ] {
        let made = json(h.create(query, b"x".to_vec()).await).await;
        assert_eq!(made["expires_at"], 1_000_000 + days * DAY, "{query}");
    }
    for query in ["?ttl=2d", "?ttl=forever", "?ttl="] {
        assert_eq!(
            h.create(query, b"x".to_vec()).await.status(),
            StatusCode::BAD_REQUEST,
            "{query}"
        );
    }
    // `never` is the operator's to allow.
    assert_eq!(
        h.create("?ttl=never", b"x".to_vec()).await.status(),
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn the_operator_caps_the_ttl() {
    let h = harness(Limits {
        max_ttl: Ttl::Days30,
        ..Limits::default()
    });
    // The default follows the cap down.
    assert_eq!(
        json(h.create("", b"x".to_vec()).await).await["expires_at"],
        1_000_000 + 30 * DAY
    );
    assert_eq!(
        h.create("?ttl=1d", b"x".to_vec()).await.status(),
        StatusCode::CREATED
    );
    assert_eq!(
        h.create("?ttl=90d", b"x".to_vec()).await.status(),
        StatusCode::BAD_REQUEST
    );

    let h = harness(Limits {
        max_ttl: Ttl::Never,
        ..Limits::default()
    });
    let made = json(h.create("?ttl=never", b"x".to_vec()).await).await;
    assert!(made["expires_at"].is_null());
    // Allowing `never` does not make it the default.
    assert_eq!(
        json(h.create("", b"x".to_vec()).await).await["expires_at"],
        1_000_000 + 90 * DAY
    );
}

#[tokio::test]
async fn expired_and_unknown_and_malformed_are_the_same_404() {
    let h = harness(Limits::default());
    let made = json(h.create("?ttl=1d", b"x".to_vec()).await).await;
    let id = made["id"].as_str().unwrap();
    h.clock.store(1_000_000 + DAY - 1, Ordering::Relaxed);
    assert_eq!(h.get(id).await.status(), StatusCode::OK);
    // Expired before any sweep has run: the API checks, it does not rely on it.
    h.clock.store(1_000_000 + DAY, Ordering::Relaxed);
    let expired = h.get(id).await;
    let unknown = h.get("AAAAAAAAAAAAAAAAAAAAAA").await;
    let malformed = h.get("not-an-id").await;
    for res in [&expired, &unknown, &malformed] {
        assert_eq!(res.status(), StatusCode::NOT_FOUND);
    }
    let (a, b, c) = (
        bytes(expired).await,
        bytes(unknown).await,
        bytes(malformed).await,
    );
    assert!(a == b && b == c);
    // Nor can an expired share be deleted into revealing itself.
    let token = made["delete_token"].as_str().unwrap();
    assert_eq!(
        h.delete(id, Some(token)).await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn the_sweep_removes_what_has_expired() {
    let h = harness(Limits::default());
    let short = json(h.create("?ttl=1d", b"x".to_vec()).await).await;
    let long = json(h.create("?ttl=30d", b"x".to_vec()).await).await;
    h.clock.store(1_000_000 + 2 * DAY, Ordering::Relaxed);
    let shares = Shares::new(h.storage.clone(), Limits::default()).with_clock({
        let c = h.clock.clone();
        move || c.load(Ordering::Relaxed)
    });
    assert_eq!(shares.sweep().await.unwrap(), 1);
    let id = |v: &Value| v["id"].as_str().unwrap().parse().unwrap();
    assert!(h.storage.get(&id(&short)).await.unwrap().is_none());
    assert!(h.storage.get(&id(&long)).await.unwrap().is_some());
}

#[tokio::test]
async fn a_blob_is_at_most_one_mebibyte_and_not_empty() {
    let h = harness(Limits::default());
    assert_eq!(
        h.create("", vec![0; 1024 * 1024]).await.status(),
        StatusCode::CREATED
    );
    assert_eq!(
        h.create("", vec![0; 1024 * 1024 + 1]).await.status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    assert_eq!(h.create("", vec![]).await.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn creation_is_rate_limited_per_address() {
    let h = harness(Limits {
        creates_per_hour: 3,
        ..Limits::default()
    });
    let post = |from: [u8; 4]| {
        let req = Request::post("/api/share").body(Body::from("x")).unwrap();
        h.send(req, from)
    };
    for _ in 0..3 {
        assert_eq!(post([10, 0, 0, 1]).await.status(), StatusCode::CREATED);
    }
    let limited = post([10, 0, 0, 1]).await;
    assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
    assert!(limited.headers().contains_key(header::RETRY_AFTER));
    // Someone else is not affected, and reading is never limited.
    assert_eq!(post([10, 0, 0, 2]).await.status(), StatusCode::CREATED);
    // The allowance comes back with time: a third of an hour, one more share.
    h.clock.fetch_add(20 * 60, Ordering::Relaxed);
    assert_eq!(post([10, 0, 0, 1]).await.status(), StatusCode::CREATED);
    assert_eq!(
        post([10, 0, 0, 1]).await.status(),
        StatusCode::TOO_MANY_REQUESTS
    );
}
