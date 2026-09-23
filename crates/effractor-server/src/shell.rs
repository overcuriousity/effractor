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

    /// Pure modules load before the page that uses them, the architecture
    /// editor after the tree editor and the dropdowns it builds on.
    fn assert_script_order(html: &str, prefix: &str) {
        let at = |name: &str| {
            html.find(&format!("src=\"{prefix}assets/js/{name}\""))
                .unwrap_or_else(|| panic!("{name} is not loaded"))
        };
        for pure in [
            "profiles.js",
            "revisions.js",
            "architecture-edit.js",
            "architecture-links.js",
            "architecture-view.js",
            "attack-view.js",
            "graph-results.js",
        ] {
            assert!(at(pure) < at("app.js"), "{pure} loads before app.js");
        }
        assert!(at("graph.js") < at("architecture-view.js"));
        assert!(at("positions.js") < at("renderer-svg.js"));
        assert!(at("architecture-icons.js") < at("renderer-svg.js"));
        assert!(at("edit.js") < at("architecture-edit.js"));
        assert!(at("edit.js") < at("architecture-links.js"));
        assert!(at("menu.js") < at("architecture-ui.js"));
        assert!(at("editor.js") < at("architecture-ui.js"));
        assert!(at("architecture-ui.js") < at("architecture-links-ui.js"));
        assert!(at("architecture-links-ui.js") < at("attack-ui.js"));
        assert!(at("graph.js") < at("attack-view.js"));
        assert!(at("results-view.js") < at("graph-results.js"));
        assert!(at("graph-results.js") < at("charts-ui.js"));
        assert!(html.contains("id=\"view-attack\""));
        assert!(html.contains("id=\"attack-results\""));
        assert!(html.contains(&format!("href=\"{prefix}assets/css/60-architecture.css\"")));
        assert!(html.contains("data-file=\"new-architecture\""));
    }

    #[test]
    fn static_shell_offers_self_contained_sharing_without_server_controls() {
        let html = render(false).unwrap();
        assert!(html.contains("id=\"canvas\""));
        assert!(html.contains("src=\"./assets/js/app.js\""));
        assert!(!html.contains("src=\"/assets/"));
        assert!(html.contains("./assets/js/share-ui.js"));
        assert!(html.contains("id=\"share-dialog\""));
        assert!(html.contains("data-server-sharing=\"false\""));
        assert!(!html.contains("id=\"share-expiry\""));
        assert!(!html.contains("id=\"my-shares\""));
        assert!(html.contains("http-equiv=\"Content-Security-Policy\""));
        assert!(!html.contains("frame-ancestors"));
        assert_script_order(&html, "./");
    }

    #[test]
    fn server_shell_keeps_sharing_and_root_paths_for_shared_links() {
        let html = render(true).unwrap();
        assert!(html.contains("src=\"/assets/js/app.js\""));
        assert!(html.contains("/assets/js/share-ui.js"));
        assert!(html.contains("id=\"share-dialog\""));
        assert!(html.contains("data-server-sharing=\"true\""));
        assert!(html.contains("id=\"share-expiry\""));
        assert_script_order(&html, "/");
    }
}
