#![allow(dead_code)]
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};

use axum::Router;
use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{Request, header};
use axum::response::Response;
use effractor_accounts::Db;
use effractor_accounts::users::{self, NewUser};
use effractor_server::accounts::Accounts;
use effractor_server::share::Shares;
use http_body_util::BodyExt;
use serde_json::Value;
use tower::ServiceExt;

pub const PW: &str = "correct horse battery";
pub const ORIGIN: &str = "http://effractor.test";

pub struct H {
    pub app: Router,
    pub accounts: Accounts,
    pub clock: Arc<AtomicU64>,
    _dir: tempfile::TempDir,
}

pub fn harness() -> H {
    harness_with(None)
}

pub fn harness_with(public_url: Option<&str>) -> H {
    let dir = tempfile::tempdir().unwrap();
    let clock = Arc::new(AtomicU64::new(1_000_000));
    let c = clock.clone();
    let db = Db::open(&dir.path().join("a.db"))
        .unwrap()
        .with_clock(move || c.load(Ordering::Relaxed));
    let accounts = Accounts::with_db(db, public_url.map(str::to_owned));
    let app = effractor_server::app_with(Shares::in_memory(), Some(accounts.clone()));
    H {
        app,
        accounts,
        clock,
        _dir: dir,
    }
}

impl H {
    pub fn add_user(&self, name: &str) -> i64 {
        self.accounts
            .db()
            .write(|t| {
                users::create(
                    t,
                    &NewUser {
                        name,
                        display_name: "",
                        password: Some(PW),
                    },
                    0,
                )
            })
            .unwrap()
    }

    pub async fn send(&self, mut req: Request<Body>) -> Response {
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([10, 0, 0, 1], 40000))));
        self.app.clone().oneshot(req).await.unwrap()
    }

    /// A request as the page makes it: JSON, same origin, the cookie if any.
    pub async fn call(
        &self,
        method: &str,
        path: &str,
        cookie: Option<&str>,
        body: Option<Value>,
    ) -> Response {
        let mut req = Request::builder()
            .method(method)
            .uri(path)
            .header(header::HOST, "effractor.test")
            .header(header::ORIGIN, ORIGIN);
        if let Some(c) = cookie {
            req = req.header(header::COOKIE, format!("effractor_session={c}"));
        }
        let body = match body {
            Some(v) => {
                req = req.header(header::CONTENT_TYPE, "application/json");
                Body::from(v.to_string())
            }
            None => Body::empty(),
        };
        self.send(req.body(body).unwrap()).await
    }

    /// Logs in and returns the session token from Set-Cookie.
    pub async fn login(&self, name: &str) -> String {
        let res = self
            .call(
                "POST",
                "/api/auth/password",
                None,
                Some(serde_json::json!({"name": name, "password": PW})),
            )
            .await;
        assert_eq!(res.status(), 204, "login as {name}");
        cookie_of(&res).expect("a session cookie")
    }
}

pub fn cookie_of(res: &Response) -> Option<String> {
    let set = res.headers().get(header::SET_COOKIE)?.to_str().ok()?;
    let value = set.strip_prefix("effractor_session=")?.split(';').next()?;
    (!value.is_empty()).then(|| value.to_owned())
}

pub async fn json(res: Response) -> Value {
    serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap()
}

pub async fn text(res: Response) -> String {
    String::from_utf8(res.into_body().collect().await.unwrap().to_bytes().to_vec()).unwrap()
}
