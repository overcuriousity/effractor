//! A state-changing request must come from the page's own origin (spec §7.3).
//! With `--public-url`, the origin is that; without, it is the Host the
//! request was sent to. A request without an Origin header is refused:
//! browsers send one on every POST, PUT, PATCH and DELETE.

use axum::extract::{Request, State};
use axum::http::{Method, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use crate::accounts::Accounts;

pub async fn same_origin(State(accounts): State<Accounts>, req: Request, next: Next) -> Response {
    if matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS) {
        return next.run(req).await;
    }
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok());
    let allowed = match (origin, accounts.public_origin()) {
        (Some(o), Some(public)) => o == public,
        (Some(o), None) => {
            let host = req
                .headers()
                .get(header::HOST)
                .and_then(|v| v.to_str().ok());
            let authority = o.split_once("://").map(|(_, a)| a);
            host.is_some() && authority == host
        }
        (None, _) => false,
    };
    if allowed {
        next.run(req).await
    } else {
        StatusCode::FORBIDDEN.into_response()
    }
}
