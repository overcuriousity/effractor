use std::fs;
use std::process::Command;

#[test]
fn exports_a_self_contained_site_without_overwriting_existing_files() {
    let temp = tempfile::tempdir().unwrap();
    let site = temp.path().join("site");
    let output = Command::new(env!("CARGO_BIN_EXE_effractor"))
        .arg("--export-static")
        .arg(&site)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let html = fs::read_to_string(site.join("index.html")).unwrap();
    assert!(html.contains("<title>effractor</title>"));
    assert!(html.contains("./assets/js/share-ui.js"));
    assert!(html.contains("data-server-sharing=\"false\""));
    assert!(!html.contains("id=\"share-expiry\""));
    assert!(site.join(".nojekyll").exists());
    for tag in html
        .split('<')
        .filter(|tag| tag.starts_with("link ") || tag.starts_with("script "))
    {
        let attr = if tag.starts_with("link ") {
            "href=\""
        } else {
            "src=\""
        };
        for part in tag.split(attr).skip(1) {
            let url = part.split('"').next().unwrap();
            let relative = url.strip_prefix("./").expect("portable asset URL");
            assert!(site.join(relative).is_file(), "missing {url}");
        }
    }
    // Runtime dependencies are not all linked from index.html.
    for asset in [
        "js/solver-worker.js",
        "vendor/elk/elk-worker.min.js",
        "templates/new.yaml",
        "templates/new-attack.yaml",
        "wasm/effractor_wasm.js",
        "wasm/effractor_wasm_bg.wasm",
    ] {
        assert!(site.join("assets").join(asset).is_file(), "missing {asset}");
    }
    let css = fs::read_to_string(site.join("assets/css/00-tokens.css")).unwrap();
    for part in css.split("url(\"").skip(1) {
        let url = part.split('"').next().unwrap();
        assert!(!url.starts_with('/'), "font URL escapes the site: {url}");
        assert!(site.join("assets/css").join(url).is_file());
    }
    let again = Command::new(env!("CARGO_BIN_EXE_effractor"))
        .arg("--export-static")
        .arg(&site)
        .output()
        .unwrap();
    assert!(!again.status.success(), "must refuse an existing directory");
    assert_eq!(fs::read_to_string(site.join("index.html")).unwrap(), html);
}
