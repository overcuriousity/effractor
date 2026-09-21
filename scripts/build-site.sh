#!/bin/sh
# Export the server's own template and assets; there is no separate Pages UI.
# build-wasm.sh must run first, exactly as for a server build.
set -eu
cd "$(dirname "$0")/.."
mkdir -p target
rm -rf target/site
cargo run --locked -p effractor-server --bin effractor -- --export-static target/site
