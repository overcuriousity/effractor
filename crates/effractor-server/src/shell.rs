use askama::Template;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};

#[derive(Template)]
#[template(path = "shell.html")]
struct Shell {
    version: &'static str,
}

pub async fn shell() -> Response {
    let page = Shell {
        version: env!("CARGO_PKG_VERSION"),
    };
    match page.render() {
        Ok(html) => Html(html).into_response(),
        Err(err) => {
            tracing::error!(%err, "shell template failed to render");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}
