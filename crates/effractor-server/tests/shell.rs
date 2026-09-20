use axum::body::Body;
use axum::http::{Request, StatusCode, header};
use axum::response::Response;
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn get(path: &str) -> Response {
    effractor_server::app()
        .oneshot(Request::get(path).body(Body::empty()).unwrap())
        .await
        .unwrap()
}

async fn text(res: Response) -> String {
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    String::from_utf8(bytes.to_vec()).unwrap()
}

fn assert_security_headers(res: &Response) {
    let h = res.headers();
    assert_eq!(h["referrer-policy"], "no-referrer");
    assert_eq!(h["x-robots-tag"], "noindex");
    assert_eq!(h["x-content-type-options"], "nosniff");
    let csp = h["content-security-policy"].to_str().unwrap();
    assert!(csp.contains("default-src 'none'"), "{csp}");
    assert!(
        csp.contains("script-src 'self' 'wasm-unsafe-eval'"),
        "{csp}"
    );
    assert!(csp.contains("frame-ancestors 'none'"), "{csp}");
    // 'self' is the only origin the policy may name.
    assert!(!csp.contains("http"), "{csp}");
    assert!(!csp.contains("unsafe-inline"), "{csp}");
}

#[tokio::test]
async fn shell_is_served_with_security_headers() {
    let res = get("/").await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_security_headers(&res);
    assert!(
        res.headers()[header::CONTENT_TYPE]
            .to_str()
            .unwrap()
            .starts_with("text/html")
    );
    assert!(text(res).await.contains("<title>effractor</title>"));
}

#[tokio::test]
async fn shell_references_no_third_party_origin() {
    let html = text(get("/").await).await;
    for needle in ["http://", "https://", "src=\"//", "href=\"//"] {
        assert!(!html.contains(needle), "shell contains {needle}");
    }
}

#[tokio::test]
async fn embedded_asset_is_served_with_type_etag_and_headers() {
    let res = get("/assets/vendor/fonts/inter-400.woff2").await;
    assert_eq!(res.status(), StatusCode::OK);
    assert_security_headers(&res);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "font/woff2");
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-cache");
    let etag = res.headers()[header::ETAG].clone();

    let revalidated = effractor_server::app()
        .oneshot(
            Request::get("/assets/vendor/fonts/inter-400.woff2")
                .header(header::IF_NONE_MATCH, etag)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(revalidated.status(), StatusCode::NOT_MODIFIED);
}

#[tokio::test]
async fn unknown_paths_are_404_with_headers() {
    for path in ["/assets/nope.css", "/assets/../Cargo.toml", "/nope"] {
        let res = get(path).await;
        assert_eq!(res.status(), StatusCode::NOT_FOUND, "{path}");
        assert_security_headers(&res);
    }
}

#[tokio::test]
async fn everything_the_shell_links_is_embedded() {
    let html = text(get("/").await).await;
    let mut linked = 0;
    for attr in ["href=\"", "src=\""] {
        for part in html.split(attr).skip(1) {
            let path = part.split('"').next().unwrap();
            assert_eq!(get(path).await.status(), StatusCode::OK, "{path}");
            linked += 1;
        }
    }
    assert!(
        linked >= 3,
        "the shell should link its tokens, base css and theme script"
    );
}

#[tokio::test]
async fn shell_has_the_workspace_regions_and_no_inline_style_or_script() {
    let html = text(get("/").await).await;
    for region in [
        "class=\"topbar\"",
        "class=\"rail\"",
        "id=\"panel-left\"",
        "id=\"canvas\"",
        "id=\"panel-right\"",
        "class=\"legend\"",
    ] {
        assert!(html.contains(region), "missing {region}");
    }
    // The CSP would block these silently; better to fail here, loudly.
    assert!(!html.contains("style=\""), "inline style attribute");
    assert!(!html.contains("<style"), "inline stylesheet");
    assert!(!html.contains("onclick="), "inline handler");
    assert!(
        !html.replace("<script src=", "").contains("<script"),
        "inline script"
    );
}
