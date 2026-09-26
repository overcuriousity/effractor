use std::fs;
use std::path::Path;

use anyhow::Context;

use crate::{assets::Assets, shell};

/// Export the same shell and assets, with self-contained sharing only.
/// The destination must not exist: never mix stale files into a deployment or
/// overwrite a user's directory. Build scripts may clear their own output first.
pub fn export_static(destination: &Path) -> anyhow::Result<()> {
    for required in ["wasm/effractor_wasm.js", "wasm/effractor_wasm_bg.wasm"] {
        anyhow::ensure!(
            Assets::get(required).is_some(),
            "missing {required}: run scripts/build-wasm.sh before building the server"
        );
    }
    let html = shell::render(None)?;
    fs::create_dir(destination).with_context(|| {
        format!(
            "cannot create {}: the export goes into a new directory",
            destination.display()
        )
    })?;
    let write = |path: &Path, data: &[u8]| {
        fs::write(path, data).with_context(|| format!("cannot write {}", path.display()))
    };
    for name in Assets::iter() {
        // The static site has no server to keep accounts on (spec §2).
        if name.starts_with("js/accounts/") || name == "css/70-accounts.css" {
            continue;
        }
        let file = Assets::get(&name)
            .ok_or_else(|| anyhow::anyhow!("asset disappeared during export: {name}"))?;
        let path = destination.join("assets").join(name.as_ref());
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .with_context(|| format!("cannot create {}", parent.display()))?;
        }
        write(&path, &file.data)?;
    }
    write(&destination.join(".nojekyll"), b"")?;
    // Write the entry point last, after all of its dependencies exist.
    write(&destination.join("index.html"), html.as_bytes())
}
