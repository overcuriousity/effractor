use std::fs;
use std::path::Path;

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
    let html = shell::render(false)?;
    fs::create_dir(destination)?;
    for name in Assets::iter() {
        let file = Assets::get(&name)
            .ok_or_else(|| anyhow::anyhow!("asset disappeared during export: {name}"))?;
        let path = destination.join("assets").join(name.as_ref());
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, file.data)?;
    }
    fs::write(destination.join(".nojekyll"), "")?;
    // Write the entry point last, after all of its dependencies exist.
    fs::write(destination.join("index.html"), html)?;
    Ok(())
}
