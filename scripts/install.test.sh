#!/bin/sh
# Exercises install.sh against a fake release served from file://.
# Run: sh scripts/install.test.sh
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL: $1" >&2; exit 1; }

arch=$(uname -m)
case "$arch" in arm64) arch=aarch64 ;; esac
asset="effractor-$arch-unknown-linux-musl"

release() { # dir — a fake release with one "binary" and its checksum
  mkdir -p "$1"
  printf '#!/bin/sh\necho "effractor fake"\n' > "$1/$asset"
  (cd "$1" && sha256sum "$asset" > SHA256SUMS)
}
install() { # release-dir install-dir
  EFFRACTOR_BASE_URL="file://$1" EFFRACTOR_INSTALL_DIR="$2" sh "$here/install.sh"
}

release "$work/good"
install "$work/good" "$work/bin" >/dev/null || fail "install from a good release"
[ -x "$work/bin/effractor" ] || fail "binary not installed executable"
[ "$("$work/bin/effractor")" = "effractor fake" ] || fail "installed binary is not the released one"
echo "ok - installs and marks executable"

release "$work/tampered"
echo tampered >> "$work/tampered/$asset"
if install "$work/tampered" "$work/bin2" >/dev/null 2>&1; then fail "accepted a checksum mismatch"; fi
[ ! -e "$work/bin2/effractor" ] || fail "left a binary behind after a checksum mismatch"
echo "ok - rejects a checksum mismatch and installs nothing"

release "$work/unlisted"
: > "$work/unlisted/SHA256SUMS"
if install "$work/unlisted" "$work/bin3" >/dev/null 2>&1; then fail "accepted a binary with no checksum entry"; fi
echo "ok - rejects a binary missing from SHA256SUMS"

if install "$work/missing" "$work/bin4" >/dev/null 2>&1; then fail "succeeded with nothing to download"; fi
echo "ok - fails when the download fails"
