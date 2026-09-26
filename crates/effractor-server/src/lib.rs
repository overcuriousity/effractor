//! The effractor server: app shell, embedded assets, share API and, with
//! `--accounts`, people's documents.
//!
//! It never links the solver. Analysis runs in the browser; what this serves
//! is the application itself, opaque shared blobs, and stored documents.

pub mod accounts;
pub mod api;
mod assets;
pub mod auth;
pub mod cli;
mod headers;
pub(crate) mod limiter;
pub mod share;
mod shell;
mod static_site;

pub use static_site::export_static;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::Router;
use axum::extract::ConnectInfo;
use axum::http::{Extensions, HeaderMap};
use axum::routing::get;

/// The release workflow stamps `<Cargo version>+<short sha>`, since every
/// commit to master is a release and the Cargo version alone would not tell
/// two of them apart. A local build has no stamp and says so. The binary's
/// `--version` and the page's footer both show this.
pub const VERSION: &str = match option_env!("EFFRACTOR_VERSION") {
    Some(stamped) => stamped,
    None => concat!(env!("CARGO_PKG_VERSION"), "+dev"),
};

/// Lower-case hex, for hashes: asset ETags and delete-token hashes.
pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Who is asking, for the limits. Behind a trusted proxy on this host, the
/// address it appended last to X-Forwarded-For; a request from anywhere else
/// cannot choose its address that way.
pub(crate) fn client_ip(trust_proxy: bool, extensions: &Extensions, headers: &HeaderMap) -> IpAddr {
    let ip = extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED), |i| i.0.ip());
    if !(trust_proxy && ip.to_canonical().is_loopback()) {
        return ip;
    }
    headers
        .get_all("x-forwarded-for")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|v| v.split(','))
        .filter_map(|a| a.trim().parse::<IpAddr>().ok())
        .next_back()
        .unwrap_or(ip)
}

/// The path people reach the page at: that of `--public-url`, with a
/// trailing slash, or `/`. A proxy strips it before passing requests on, so
/// the routes stay where they are; only what the page links carries it.
pub fn base_path(public_url: Option<&str>) -> String {
    let Some(url) = public_url else {
        return "/".to_owned();
    };
    let after = url.find("://").map_or(0, |i| i + 3);
    let path = url[after..].find('/').map_or("", |i| &url[after + i..]);
    let path = path.split(['?', '#']).next().unwrap_or("");
    format!("{}/", path.trim_end_matches('/'))
}

/// Serve it with `into_make_service_with_connect_info::<SocketAddr>()`: the
/// share API limits creation per peer address, and without the address every
/// client is the same client.
pub fn app(shares: share::Shares) -> Router {
    app_with(shares, None)
}

/// With accounts, the account routes (behind the Origin guard) and a shell
/// that knows; without, exactly the app as before.
pub fn app_with(shares: share::Shares, accounts: Option<accounts::Accounts>) -> Router {
    app_at("/", shares, accounts)
}

/// As `app_with`, for a page people reach under `base` (see [`base_path`]).
pub fn app_at(base: &str, shares: share::Shares, accounts: Option<accounts::Accounts>) -> Router {
    let page = Arc::new(shell::Server {
        base: base.to_owned(),
        accounts: accounts.is_some(),
        max_ttl: shares.max_ttl(),
    });
    let at_share = page.clone();
    let mut router = Router::new()
        .route("/", get(move || shell::shell(page.clone())))
        .route("/s/{id}", get(move || shell::shell(at_share.clone())))
        .route("/assets/{*path}", get(assets::asset))
        .merge(share::routes(shares));
    if let Some(accounts) = accounts {
        let api = auth::routes()
            .merge(api::routes())
            .layer(axum::middleware::from_fn_with_state(
                accounts.clone(),
                auth::guard::same_origin,
            ))
            .with_state(accounts);
        router = router.merge(api);
    }
    router.layer(axum::middleware::from_fn(headers::security_headers))
}

#[cfg(test)]
mod tests {
    use super::base_path;

    #[test]
    fn the_base_path_is_the_public_urls_path_with_one_slash() {
        assert_eq!(base_path(None), "/");
        assert_eq!(base_path(Some("https://effractor.example")), "/");
        assert_eq!(base_path(Some("https://effractor.example/")), "/");
        assert_eq!(
            base_path(Some("https://example.org/effractor")),
            "/effractor/"
        );
        assert_eq!(base_path(Some("https://example.org/a/b/")), "/a/b/");
        assert_eq!(base_path(Some("http://localhost:8082/x?y=/z")), "/x/");
    }
}
