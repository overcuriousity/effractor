//! The effractor server: app shell, embedded assets, share API.
//!
//! It never links the solver. Analysis runs in the browser; what this serves
//! is the application itself and, later, opaque shared blobs.

mod assets;
mod headers;
pub mod share;
mod shell;

use axum::Router;
use axum::routing::get;

/// Serve it with `into_make_service_with_connect_info::<SocketAddr>()`: the
/// share API limits creation per peer address, and without the address every
/// client is the same client.
pub fn app(shares: share::Shares) -> Router {
    Router::new()
        .route("/", get(shell::shell))
        .route("/assets/{*path}", get(assets::asset))
        .merge(share::routes(shares))
        .layer(axum::middleware::from_fn(headers::security_headers))
}
