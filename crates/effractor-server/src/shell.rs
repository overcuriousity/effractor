use std::sync::Arc;

use askama::Template;
use axum::http::StatusCode;
use axum::response::{Html, IntoResponse, Response};

use crate::share::Ttl;

#[derive(Template)]
#[template(path = "shell.html")]
struct Shell<'a> {
    version: &'static str,
    asset_prefix: &'a str,
    sharing: bool,
    accounts: bool,
    max_ttl: Ttl,
    csp: &'static str,
}

/// What a served shell knows of its server.
pub(crate) struct Server {
    /// The path people reach the page at (`lib::base_path`). Absolute, so
    /// `/s/<id>` finds the assets as `/` does.
    pub base: String,
    pub accounts: bool,
    /// The share dialog offers no expiry the server would refuse.
    pub max_ttl: Ttl,
}

/// The static export (`None`) links its assets relative to itself, which
/// works at a domain root and under a repository path alike.
pub(crate) fn render(server: Option<&Server>) -> Result<String, askama::Error> {
    Shell {
        version: super::VERSION,
        asset_prefix: server.map_or("./", |s| &s.base),
        sharing: server.is_some(),
        accounts: server.is_some_and(|s| s.accounts),
        max_ttl: server.map_or(Ttl::Never, |s| s.max_ttl),
        // Pages cannot set response headers. This directive only works in a
        // header; the remaining policy is also supported in a meta element.
        csp: super::headers::CSP
            .strip_suffix("; frame-ancestors 'none'")
            .unwrap_or(super::headers::CSP),
    }
    .render()
}

pub(crate) async fn shell(server: Arc<Server>) -> Response {
    match render(Some(&server)) {
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
            "vocabulary.js",
            "architecture-edit.js",
            "clusters.js",
            "architecture-links.js",
            "problems.js",
            "architecture-view.js",
            "attack-view.js",
            "graph-results.js",
        ] {
            assert!(at(pure) < at("app.js"), "{pure} loads before app.js");
        }
        assert!(at("graph.js") < at("architecture-view.js"));
        assert!(at("clusters.js") < at("architecture-view.js"));
        assert!(at("clusters.js") < at("renderer-svg.js"));
        assert!(at("clusters.js") < at("architecture-links.js"));
        assert!(at("positions.js") < at("renderer-svg.js"));
        assert!(at("architecture-icons.js") < at("renderer-svg.js"));
        assert!(at("edit.js") < at("architecture-edit.js"));
        assert!(at("edit.js") < at("architecture-links.js"));
        assert!(at("architecture-edit.js") < at("architecture-links.js"));
        assert!(at("architecture-links.js") < at("problems.js"));
        assert!(at("menu.js") < at("architecture-ui.js"));
        assert!(at("editor.js") < at("architecture-ui.js"));
        assert!(at("architecture-ui.js") < at("architecture-links-ui.js"));
        assert!(at("architecture-links-ui.js") < at("attack-ui.js"));
        assert!(at("architecture-ui.js") < at("attacker-pins.js"));
        assert!(at("vocabulary.js") < at("architecture-ui.js"));
        assert!(at("architecture-links.js") < at("nmap.js"));
        assert!(at("nmap.js") < at("app.js"), "nmap.js loads before app.js");
        assert!(at("architecture-links-ui.js") < at("nmap-ui.js"));
        assert!(at("architecture-links-ui.js") < at("cluster-ui.js"));
        assert!(at("cluster-ui.js") < at("attacker-pins.js"));
        assert!(html.contains("id=\"nmap-dialog\""));
        assert!(html.contains("id=\"nmap-hint\""));
        assert!(html.contains("id=\"nmap-hint-close\""));
        for side in ["left", "right"] {
            assert!(
                html.contains(&format!("data-close=\"{side}\"")),
                "{side} panel closes"
            );
        }
        assert!(at("graph.js") < at("attack-view.js"));
        assert!(at("results-view.js") < at("graph-results.js"));
        assert!(at("graph-results.js") < at("charts-ui.js"));
        assert!(html.contains("id=\"view-attack\""));
        assert!(html.contains("id=\"attack-results\""));
        assert!(html.contains(&format!("href=\"{prefix}assets/css/60-architecture.css\"")));
        for mode in ["fault-tree", "attack-tree", "architecture"] {
            assert!(html.contains(&format!("id=\"mode-{mode}\"")), "{mode} tab");
        }
    }

    fn served(accounts: bool) -> String {
        render(Some(&Server {
            base: "/".to_owned(),
            accounts,
            max_ttl: Ttl::Year1,
        }))
        .unwrap()
    }

    #[test]
    fn static_shell_offers_self_contained_sharing_without_server_controls() {
        let html = render(None).unwrap();
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
        let html = served(false);
        assert!(html.contains("src=\"/assets/js/app.js\""));
        assert!(html.contains("/assets/js/share-ui.js"));
        assert!(html.contains("id=\"share-dialog\""));
        assert!(html.contains("data-server-sharing=\"true\""));
        assert!(html.contains("data-max-ttl=\"1y\""));
        assert!(html.contains("id=\"share-expiry\""));
        assert_script_order(&html, "/");
    }

    #[test]
    fn under_a_prefix_every_asset_carries_it() {
        let html = render(Some(&Server {
            base: "/effractor/".to_owned(),
            accounts: true,
            max_ttl: Ttl::Days30,
        }))
        .unwrap();
        assert!(!html.contains("\"/assets/"));
        assert!(!html.contains("\"./assets/"));
        assert!(html.contains("src=\"/effractor/assets/js/accounts/client.js\""));
        assert!(html.contains("data-max-ttl=\"30d\""));
        assert_script_order(&html, "/effractor/");
    }

    #[test]
    fn an_accounts_shell_loads_the_account_modules_and_shows_the_bar_parts() {
        let html = served(true);
        assert!(html.contains("data-accounts=\"true\""));
        assert!(html.contains("src=\"/assets/js/accounts/client.js\""));
        assert!(html.contains("src=\"/assets/js/accounts/account-ui.js\""));
        assert!(html.contains("href=\"/assets/css/70-accounts.css\""));
        for id in [
            "local-only",
            "login-open",
            "account",
            "login-dialog",
            "account-dialog",
        ] {
            assert!(html.contains(&format!("id=\"{id}\"")), "{id}");
        }
        let at = |s: &str| html.find(s).unwrap();
        assert!(at("js/share-ui.js") < at("js/accounts/client.js"));
        assert!(at("js/accounts/client.js") < at("js/accounts/account-ui.js"));
        // The account dialog's passkey section uses the conversions.
        assert!(at("js/accounts/client.js") < at("js/accounts/passkeys.js"));
        assert!(at("js/accounts/passkeys.js") < at("js/accounts/account-ui.js"));
        // The Documents tab (spec §9.2): its own tab attribute, since
        // controls.js owns every [data-tab] as the right panel's.
        for id in [
            "left-tab-model",
            "left-tab-documents",
            "left-model",
            "view-documents",
            "documents-search",
            "documents-recent",
            "documents-mine",
            "documents-shared",
            "documents-new",
            "documents-login",
            "model-path",
            "save-state",
        ] {
            assert!(html.contains(&format!("id=\"{id}\"")), "{id}");
        }
        assert!(html.contains("data-left-tab=\"documents\""));
        assert!(html.contains("data-documents"));
        assert!(!html.contains("data-tab=\"documents\""));
        assert!(at("js/accounts/account-ui.js") < at("js/accounts/documents.js"));
        assert!(at("js/accounts/documents.js") < at("js/accounts/documents-ui.js"));
        assert!(at("js/accounts/documents-ui.js") < at("js/accounts/autosave.js"));
        assert!(at("js/accounts/autosave.js") < at("js/accounts/sync-core.js"));
        assert!(at("js/accounts/sync-core.js") < at("js/accounts/sync.js"));
        // Sharing with people (spec §9.3), in the share dialog.
        for id in [
            "share-people",
            "share-people-name",
            "share-people-role",
            "share-people-add",
            "share-people-suggest",
            "share-people-list",
            "share-public",
        ] {
            assert!(html.contains(&format!("id=\"{id}\"")), "{id}");
        }
        assert!(at("js/accounts/sync.js") < at("js/accounts/people-ui.js"));
        // Administration (spec §9.4): its own tab attribute, as the left panel.
        for id in [
            "admin-dialog",
            "admin-rows",
            "admin-new",
            "admin-detail",
            "admin-problem",
            "admin-close",
        ] {
            assert!(html.contains(&format!("id=\"{id}\"")), "{id}");
        }
        assert!(html.contains("data-admin-tab=\"users\""));
        assert!(at("js/accounts/people-ui.js") < at("js/accounts/admin-ui.js"));
    }

    #[test]
    fn without_accounts_the_shell_has_no_trace_of_them() {
        for (sharing, html) in [(true, served(false)), (false, render(None).unwrap())] {
            for needle in [
                "data-accounts",
                "js/accounts/",
                "70-accounts.css",
                "login-dialog",
                "local-only",
                "view-documents",
                "data-left-tab",
                "model-path",
                "save-state",
                "share-people",
                "admin-dialog",
            ] {
                assert!(!html.contains(needle), "{needle} with sharing={sharing}");
            }
        }
    }
}
