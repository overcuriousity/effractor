use askama::Template;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};

#[derive(Template)]
#[template(path = "shell.html")]
struct Shell {
    version: &'static str,
    asset_prefix: &'static str,
    sharing: bool,
    csp: &'static str,
}

pub(crate) fn render(sharing: bool) -> Result<String, askama::Error> {
    Shell {
        version: env!("CARGO_PKG_VERSION"),
        asset_prefix: if sharing { "/" } else { "./" },
        sharing,
        // Pages cannot set response headers. This directive only works in a
        // header; the remaining policy is also supported in a meta element.
        csp: super::headers::CSP
            .strip_suffix("; frame-ancestors 'none'")
            .unwrap_or(super::headers::CSP),
    }
    .render()
}

pub async fn shell() -> Response {
    match render(true) {
        Ok(html) => Html(html).into_response(),
        Err(err) => {
            tracing::error!(%err, "shell template failed to render");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn static_shell_keeps_the_editor_but_disables_server_sharing() {
        let html = render(false).unwrap();
        assert!(html.contains("id=\"canvas\""));
        assert!(html.contains("src=\"./assets/js/app.js\""));
        assert!(!html.contains("src=\"/assets/"));
        assert!(!html.contains("share-ui.js"));
        assert!(!html.contains("id=\"share-dialog\""));
        assert!(html.contains("disabled title=\"Sharing unavailable on this site\""));
        assert!(html.contains("http-equiv=\"Content-Security-Policy\""));
        assert!(!html.contains("frame-ancestors"));
    }

    #[test]
    fn server_shell_keeps_sharing_and_root_paths_for_shared_links() {
        let html = render(true).unwrap();
        assert!(html.contains("src=\"/assets/js/app.js\""));
        assert!(html.contains("/assets/js/share-ui.js"));
        assert!(html.contains("id=\"share-dialog\""));
    }
}
