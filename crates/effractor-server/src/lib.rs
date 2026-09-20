//! The effractor server: app shell, embedded assets, share API.
//!
//! It never links the solver. Analysis runs in the browser; what this serves
//! is the application itself and, later, opaque shared blobs.

mod assets;
mod headers;
mod shell;

use axum::Router;
use axum::routing::get;

pub fn app() -> Router {
    Router::new()
        .route("/", get(shell::shell))
        .route("/assets/{*path}", get(assets::asset))
        .layer(axum::middleware::from_fn(headers::security_headers))
}
