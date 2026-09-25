//! The effractor server: app shell, embedded assets, share API.
//!
//! It never links the solver. Analysis runs in the browser; what this serves
//! is the application itself and, later, opaque shared blobs.

mod assets;
mod headers;
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

/// Serve it with `into_make_service_with_connect_info::<SocketAddr>()`: the
/// share API limits creation per peer address, and without the address every
/// client is the same client.
pub fn app(shares: share::Shares) -> Router {
    Router::new()
        .route("/", get(shell::shell))
        .route("/s/{id}", get(shell::shell))
        .route("/assets/{*path}", get(assets::asset))
        .merge(share::routes(shares))
        .layer(axum::middleware::from_fn(headers::security_headers))
}
