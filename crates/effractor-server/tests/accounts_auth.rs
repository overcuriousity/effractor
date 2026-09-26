mod common;
use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use common::*;
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn me_says_nobody_and_which_logins_there_are() {
    let h = harness();
    let me = json(h.call("GET", "/api/me", None, None).await).await;
    assert_eq!(me["user"], serde_json::Value::Null);
    assert_eq!(me["login"]["password"], true);
    assert_eq!(me["login"]["passkey"], false);
    assert_eq!(me["login"]["oidc"], serde_json::Value::Null);
}

#[tokio::test]
async fn a_user_logs_in_is_known_and_logs_out() {
    let h = harness();
    h.add_user("alice");
    let res = h
        .call(
            "POST",
            "/api/auth/password",
            None,
            Some(json!({"name": "alice", "password": PW})),
        )
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let set = res.headers()[header::SET_COOKIE]
        .to_str()
        .unwrap()
        .to_owned();
    for part in ["HttpOnly", "SameSite=Lax", "Path=/", "Max-Age=2592000"] {
        assert!(set.contains(part), "{set}");
    }
    let token = cookie_of(&res).unwrap();
    let me = json(h.call("GET", "/api/me", Some(&token), None).await).await;
    assert_eq!(me["user"]["name"], "alice");
    assert_eq!(me["user"]["methods"]["password"], true);
    let res = h.call("POST", "/api/auth/logout", Some(&token), None).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    let me = json(h.call("GET", "/api/me", Some(&token), None).await).await;
    assert_eq!(me["user"], serde_json::Value::Null);
}

#[tokio::test]
async fn every_failed_login_says_the_same() {
    let h = harness();
    h.add_user("alice");
    h.add_user("root");
    let root = h
        .accounts
        .db()
        .read(|c| effractor_accounts::users::by_name(c, "root"))
        .unwrap()
        .unwrap();
    h.accounts
        .db()
        .write(|t| effractor_accounts::users::set_admin(t, root.id, true))
        .unwrap();
    let alice = h
        .accounts
        .db()
        .read(|c| effractor_accounts::users::by_name(c, "alice"))
        .unwrap()
        .unwrap();
    let mut said = Vec::new();
    for (name, pw) in [("alice", "wrong password!!"), ("nobody", PW)] {
        let res = h
            .call(
                "POST",
                "/api/auth/password",
                None,
                Some(json!({"name": name, "password": pw})),
            )
            .await;
        assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
        said.push(text(res).await);
    }
    h.accounts
        .db()
        .write(|t| effractor_accounts::users::set_disabled(t, alice.id, true))
        .unwrap();
    let res = h
        .call(
            "POST",
            "/api/auth/password",
            None,
            Some(json!({"name": "alice", "password": PW})),
        )
        .await;
    said.push(text(res).await);
    assert!(said.windows(2).all(|w| w[0] == w[1]), "{said:?}");
}

#[tokio::test]
async fn failed_logins_are_limited_per_address() {
    let h = harness();
    let mut last = StatusCode::OK;
    for _ in 0..31 {
        last = h
            .call(
                "POST",
                "/api/auth/password",
                None,
                Some(json!({"name": "x", "password": "wrong password!!"})),
            )
            .await
            .status();
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
}

#[tokio::test]
async fn a_state_change_without_the_same_origin_is_refused() {
    let h = harness();
    h.add_user("alice");
    let token = h.login("alice").await;
    for origin in [None, Some("http://evil.test")] {
        let mut req = Request::post("/api/auth/logout")
            .header(header::HOST, "effractor.test")
            .header(header::COOKIE, format!("effractor_session={token}"));
        if let Some(o) = origin {
            req = req.header(header::ORIGIN, o);
        }
        let res = h.send(req.body(Body::empty()).unwrap()).await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN, "{origin:?}");
    }
    let me = json(h.call("GET", "/api/me", Some(&token), None).await).await;
    assert_eq!(me["user"]["name"], "alice", "still logged in");
}

#[tokio::test]
async fn with_an_https_public_url_the_cookie_is_secure_and_the_origin_must_match_it() {
    let h = harness_with(Some("https://effractor.example"));
    h.add_user("alice");
    let res = h
        .call(
            "POST",
            "/api/auth/password",
            None,
            Some(json!({"name": "alice", "password": PW})),
        )
        .await;
    assert_eq!(
        res.status(),
        StatusCode::FORBIDDEN,
        "origin is the Host, not the public url"
    );
    let req = Request::post("/api/auth/password")
        .header(header::HOST, "internal:8080")
        .header(header::ORIGIN, "https://effractor.example")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"name": "alice", "password": PW}).to_string(),
        ))
        .unwrap();
    let res = h.send(req).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert!(
        res.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Secure")
    );
}

/// The public url as typed need not be as the browser spells its origin.
#[tokio::test]
async fn a_public_url_typed_in_capitals_or_with_its_default_port_still_matches() {
    let h = harness_with(Some("HTTPS://Effractor.Example:443/Tools/"));
    assert_eq!(
        h.accounts.public_url(),
        Some("https://effractor.example/Tools")
    );
    h.add_user("alice");
    let req = Request::post("/api/auth/password")
        .header(header::HOST, "internal:8080")
        .header(header::ORIGIN, "https://effractor.example")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({"name": "alice", "password": PW}).to_string(),
        ))
        .unwrap();
    let res = h.send(req).await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
    assert!(
        res.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Secure")
    );
}

#[test]
fn a_public_url_that_is_no_web_address_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    for bad in ["effractor.example", "file:///srv", "not a url"] {
        let db = effractor_accounts::Db::open(&dir.path().join("a.db")).unwrap();
        assert!(
            effractor_server::accounts::Accounts::with_db(db, Some(bad.into())).is_err(),
            "{bad}"
        );
    }
}

#[tokio::test]
async fn cookie_is_not_secure_without_an_https_public_url() {
    let h = harness();
    h.add_user("alice");
    let res = h
        .call(
            "POST",
            "/api/auth/password",
            None,
            Some(json!({"name": "alice", "password": PW})),
        )
        .await;
    assert!(
        !res.headers()[header::SET_COOKIE]
            .to_str()
            .unwrap()
            .contains("Secure")
    );
}

#[tokio::test]
async fn logging_out_elsewhere_keeps_this_session() {
    let h = harness();
    h.add_user("alice");
    let here = h.login("alice").await;
    let there = h.login("alice").await;
    assert_eq!(
        h.call("POST", "/api/auth/logout-others", Some(&here), None)
            .await
            .status(),
        204
    );
    assert_eq!(
        json(h.call("GET", "/api/me", Some(&here), None).await).await["user"]["name"],
        "alice"
    );
    assert_eq!(
        json(h.call("GET", "/api/me", Some(&there), None).await).await["user"],
        serde_json::Value::Null
    );
}

#[tokio::test]
async fn changing_ones_password_ends_the_other_sessions() {
    let h = harness();
    h.add_user("alice");
    let here = h.login("alice").await;
    let there = h.login("alice").await;
    let res = h
        .call(
            "PATCH",
            "/api/account",
            Some(&here),
            Some(json!({"password": "a brand new password", "current_password": PW})),
        )
        .await;
    assert_eq!(res.status(), 204);
    assert_eq!(
        json(h.call("GET", "/api/me", Some(&there), None).await).await["user"],
        serde_json::Value::Null
    );
    let res = h
        .call(
            "PATCH",
            "/api/account",
            Some(&here),
            Some(json!({"password": "short", "current_password": "a brand new password"})),
        )
        .await;
    assert_eq!(res.status(), 400);
}

#[tokio::test]
async fn the_last_way_to_log_in_cannot_be_removed() {
    let h = harness();
    h.add_user("alice");
    let token = h.login("alice").await;
    let res = h
        .call(
            "PATCH",
            "/api/account",
            Some(&token),
            Some(json!({"password": null, "current_password": PW})),
        )
        .await;
    assert_eq!(res.status(), 409);
}

#[tokio::test]
async fn without_accounts_every_account_route_is_404() {
    let app = effractor_server::app(effractor_server::share::Shares::in_memory());
    for (method, path) in [
        ("GET", "/api/me"),
        ("POST", "/api/auth/password"),
        ("POST", "/api/auth/logout"),
    ] {
        let res = tower::ServiceExt::oneshot(
            app.clone(),
            Request::builder()
                .method(method)
                .uri(path)
                .header(header::ORIGIN, ORIGIN)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{method} {path}");
    }
}

/// A session alone does not change a password: an unlocked machine or a
/// stolen cookie would otherwise take the account over (review I5).
#[tokio::test]
async fn changing_a_password_needs_the_current_one() {
    let h = harness();
    h.add_user("alice");
    let token = h.login("alice").await;
    for body in [
        json!({"password": "a brand new password"}),
        json!({"password": "a brand new password", "current_password": "not the password"}),
        json!({"password": null}),
    ] {
        let res = h
            .call("PATCH", "/api/account", Some(&token), Some(body.clone()))
            .await;
        assert_eq!(res.status(), StatusCode::FORBIDDEN, "{body}");
    }
    let res = h
        .call(
            "POST",
            "/api/auth/password",
            None,
            Some(json!({"name": "alice", "password": PW})),
        )
        .await;
    assert_eq!(
        res.status(),
        StatusCode::NO_CONTENT,
        "the password is unchanged"
    );
    // A display name needs no password.
    let res = h
        .call(
            "PATCH",
            "/api/account",
            Some(&token),
            Some(json!({"display_name": "Alice"})),
        )
        .await;
    assert_eq!(res.status(), StatusCode::NO_CONTENT);
}

/// Guessing the current password counts as a failed login: a session does
/// not get around the limit on /api/auth/password.
#[tokio::test]
async fn guessing_the_current_password_is_limited_like_logins() {
    let h = harness();
    h.add_user("alice");
    let token = h.login("alice").await;
    let mut last = StatusCode::OK;
    for i in 0..31 {
        last = h
            .call(
                "PATCH",
                "/api/account",
                Some(&token),
                Some(json!({"password": "a brand new password", "current_password": format!("guess {i}")})),
            )
            .await
            .status();
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
    let res = h
        .call(
            "POST",
            "/api/auth/password",
            None,
            Some(json!({"name": "alice", "password": PW})),
        )
        .await;
    assert_eq!(
        res.status(),
        StatusCode::TOO_MANY_REQUESTS,
        "one limit for both"
    );
}

/// Behind a TLS proxy every peer is the proxy; with --trusted-proxy the
/// address it forwards is the one counted (review I4).
#[tokio::test]
async fn behind_a_trusted_proxy_failed_logins_count_per_forwarded_address() {
    let h = harness_trusting_proxy();
    let attempt = |ip: &'static str, from: [u8; 4]| {
        let h = &h;
        async move {
            let mut req = Request::post("/api/auth/password")
                .header(header::HOST, "effractor.test")
                .header(header::ORIGIN, ORIGIN)
                .header(header::CONTENT_TYPE, "application/json")
                .header("x-forwarded-for", format!("203.0.113.9, {ip}"))
                .body(Body::from(
                    json!({"name": "x", "password": "wrong password!!"}).to_string(),
                ))
                .unwrap();
            req.extensions_mut()
                .insert(axum::extract::ConnectInfo(std::net::SocketAddr::from((
                    from, 40000,
                ))));
            h.app.clone().oneshot(req).await.unwrap().status()
        }
    };
    for _ in 0..30 {
        attempt("198.51.100.1", [127, 0, 0, 1]).await;
    }
    assert_eq!(
        attempt("198.51.100.1", [127, 0, 0, 1]).await,
        StatusCode::TOO_MANY_REQUESTS
    );
    assert_eq!(
        attempt("198.51.100.2", [127, 0, 0, 1]).await,
        StatusCode::UNAUTHORIZED,
        "another client is not locked out"
    );
    // From anywhere but loopback the header is not believed.
    for _ in 0..30 {
        attempt("198.51.100.3", [10, 0, 0, 7]).await;
    }
    assert_eq!(
        attempt("198.51.100.4", [10, 0, 0, 7]).await,
        StatusCode::TOO_MANY_REQUESTS
    );
}

/// Spec §11: every route that needs a session refuses one without.
#[tokio::test]
async fn every_account_route_needs_a_session() {
    let h = harness();
    for (method, path) in [
        ("GET", "/api/documents"),
        ("POST", "/api/documents"),
        ("GET", "/api/documents/1"),
        ("PUT", "/api/documents/1"),
        ("PATCH", "/api/documents/1"),
        ("DELETE", "/api/documents/1"),
        ("POST", "/api/documents/1/restore"),
        ("POST", "/api/folders"),
        ("PATCH", "/api/folders/1"),
        ("DELETE", "/api/folders/1"),
        ("POST", "/api/folders/1/restore"),
        ("GET", "/api/documents/1/shares"),
        ("POST", "/api/documents/1/shares"),
        ("GET", "/api/folders/1/shares"),
        ("POST", "/api/folders/1/shares"),
        ("DELETE", "/api/shares/1"),
        ("GET", "/api/directory"),
        ("PATCH", "/api/account"),
        ("POST", "/api/auth/logout-others"),
        ("GET", "/api/admin/users"),
        ("POST", "/api/admin/users"),
        ("PATCH", "/api/admin/users/1"),
        ("DELETE", "/api/admin/users/1"),
        ("GET", "/api/admin/groups"),
        ("POST", "/api/admin/groups"),
        ("PATCH", "/api/admin/groups/1"),
        ("DELETE", "/api/admin/groups/1"),
        ("PUT", "/api/admin/groups/1/members/1"),
        ("DELETE", "/api/admin/groups/1/members/1"),
        ("DELETE", "/api/account/oidc"),
    ] {
        let body = matches!(method, "POST" | "PUT" | "PATCH").then(|| json!({}));
        let status = h.call(method, path, None, body).await.status();
        assert!(
            status == StatusCode::UNAUTHORIZED || status == StatusCode::UNPROCESSABLE_ENTITY,
            "{method} {path}: {status}"
        );
    }
}
