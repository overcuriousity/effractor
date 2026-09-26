#!/bin/sh
# build-wasm.sh [--fetch-cli]
#
# Build the browser bundle into assets/wasm/, where rust-embed picks it up with
# everything else: the server binary must be built *after* this. The bundle is
# a build product and is not committed.
#
# wasm-bindgen's CLI has to be the very version of the wasm-bindgen crate in
# Cargo.lock. It is looked for in $WASM_BINDGEN, then target/tools/, then PATH.
# --fetch-cli downloads the project's release binary into target/tools/ when it
# is missing, which is what CI does; without the flag, nothing is downloaded.
set -eu
cd "$(dirname "$0")/.."

version=$(awk '/^name = "wasm-bindgen"$/ { getline; print }' Cargo.lock | cut -d'"' -f2)
[ -n "$version" ] || { echo "wasm-bindgen is not in Cargo.lock"; exit 1; }
tools=target/tools/wasm-bindgen-$version

cli=${WASM_BINDGEN:-}
if [ -z "$cli" ] && [ -x "$tools/wasm-bindgen" ]; then cli=$tools/wasm-bindgen; fi
# PATH's only in the right version: a wrong one must not keep --fetch-cli
# from fetching.
stale=
if [ -z "$cli" ] && on_path=$(command -v wasm-bindgen); then
  if [ "$("$on_path" --version | cut -d' ' -f2)" = "$version" ]; then cli=$on_path; else stale=$on_path; fi
fi

if [ -z "$cli" ] && [ "${1:-}" = --fetch-cli ]; then
  case $(uname -m) in
    x86_64) arch=x86_64-unknown-linux-musl ;;
    aarch64 | arm64) arch=aarch64-unknown-linux-musl ;;
    *) echo "no wasm-bindgen release binary for $(uname -m)"; exit 1 ;;
  esac
  url=https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/wasm-bindgen-$version-$arch.tar.gz
  mkdir -p "$tools"
  curl -fsSL "$url" -o "$tools.tar.gz"
  # Published beside the archive: catches a bad download, not a bad publisher.
  want=$(curl -fsSL "$url.sha256sum" | cut -d' ' -f1)
  [ "$(sha256sum "$tools.tar.gz" | cut -d' ' -f1)" = "$want" ] || { echo "checksum mismatch for $url"; exit 1; }
  tar -xzf "$tools.tar.gz" -C "$tools" --strip-components=1
  rm "$tools.tar.gz"
  cli=$tools/wasm-bindgen
fi

have=
if [ -n "$cli" ]; then have=$("$cli" --version | cut -d' ' -f2)
elif [ -n "$stale" ]; then have="$("$stale" --version | cut -d' ' -f2) at $stale"; fi
if [ "$have" != "$version" ]; then
  echo "wasm-bindgen CLI $version is needed (found: ${have:-none})."
  echo "  cargo install wasm-bindgen-cli --version $version --locked"
  echo "or run this script with --fetch-cli to download it into target/tools/."
  exit 1
fi

cargo build --release --locked --target wasm32-unknown-unknown -p effractor-wasm
rm -rf assets/wasm
"$cli" --target no-modules --no-typescript --out-dir assets/wasm \
  target/wasm32-unknown-unknown/release/effractor_wasm.wasm
ls -l assets/wasm
