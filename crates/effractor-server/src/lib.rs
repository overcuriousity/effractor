//! The effractor server: app shell, embedded assets, share API.
//!
//! It never links the solver. Analysis runs in the browser; what this serves
//! is the application itself and, later, opaque shared blobs.

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

use axum::Router;
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

/// Serve it with `into_make_service_with_connect_info::<SocketAddr>()`: the
/// share API limits creation per peer address, and without the address every
/// client is the same client.
pub fn app(shares: share::Shares) -> Router {
    app_with(shares, None)
}

/// With accounts, the account routes (behind the Origin guard) and a shell
/// that knows; without, exactly the app as before.
pub fn app_with(shares: share::Shares, accounts: Option<accounts::Accounts>) -> Router {
    let on = accounts.is_some();
    let mut router = Router::new()
        .route("/", get(move || shell::shell(on)))
        .route("/s/{id}", get(move || shell::shell(on)))
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
