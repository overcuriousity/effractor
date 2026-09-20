#!/bin/sh
# effractor installer: fetch the latest release binary for this machine, verify
# its SHA-256 against the release's SHA256SUMS, install it.
#
#   curl -fsSL https://raw.githubusercontent.com/overcuriousity/effractor/master/install.sh | sh
#
# EFFRACTOR_INSTALL_DIR  where to put it (default: ~/.local/bin)
# EFFRACTOR_BASE_URL     where to fetch from (default: the latest GitHub release)
set -eu

# Everything lives in main(), called on the last line, so a download cut short
# cannot run half a script.
main() {
  base=${EFFRACTOR_BASE_URL:-https://github.com/overcuriousity/effractor/releases/latest/download}
  dir=${EFFRACTOR_INSTALL_DIR:-$HOME/.local/bin}

  [ "$(uname -s)" = Linux ] || die "only Linux binaries are published; build from source elsewhere"
  case "$(uname -m)" in
    x86_64 | amd64) arch=x86_64 ;;
    aarch64 | arm64) arch=aarch64 ;;
    *) die "no binary published for $(uname -m)" ;;
  esac
  asset="effractor-$arch-unknown-linux-musl"

  command -v curl >/dev/null || die "curl is required"
  command -v sha256sum >/dev/null || die "sha256sum is required"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  echo "downloading $asset"
  curl -fsSL "$base/$asset" -o "$tmp/$asset" || die "download failed: $base/$asset"
  curl -fsSL "$base/SHA256SUMS" -o "$tmp/SHA256SUMS" || die "download failed: $base/SHA256SUMS"

  # Check only our line, and insist there is one: an empty list verifies nothing.
  grep " $asset\$" "$tmp/SHA256SUMS" > "$tmp/expected" || die "$asset is not listed in SHA256SUMS"
  (cd "$tmp" && sha256sum -c expected >/dev/null 2>&1) || die "checksum mismatch — not installing"

  mkdir -p "$dir"
  chmod +x "$tmp/$asset"
  mv "$tmp/$asset" "$dir/effractor"
  echo "installed $dir/effractor"

  case ":$PATH:" in
    *":$dir:"*) echo "run: effractor" ;;
    *) echo "$dir is not on your PATH — run: $dir/effractor" ;;
  esac
}

die() {
  echo "effractor install: $1" >&2
  exit 1
}

main "$@"
