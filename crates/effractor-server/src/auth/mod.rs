//! Logging in and out (spec §7).

pub mod guard;
pub mod password;
pub mod session;

use axum::Router;
use axum::routing::post;

use crate::accounts::Accounts;

pub fn routes() -> Router<Accounts> {
    Router::new()
        .route("/api/auth/password", post(password::login))
        .route("/api/auth/logout", post(password::logout))
        .route("/api/auth/logout-others", post(password::logout_others))
}
