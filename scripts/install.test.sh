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

# --- systemd (spec §13) ---
fakebin="$work/fakebin"; mkdir -p "$fakebin"
cat > "$fakebin/systemctl" <<'EOF'
#!/bin/sh
echo "systemctl $*" >> "$SYSTEMCTL_LOG"
EOF
chmod +x "$fakebin/systemctl"
cat > "$fakebin/useradd" <<'EOF'
#!/bin/sh
echo "useradd $*" >> "$SYSTEMCTL_LOG"
EOF
chmod +x "$fakebin/useradd"

sysinstall() { # answer-file uid release-dir install-dir unit-dir
  HOME="$work/home" SYSTEMCTL_LOG="$work/log" PATH="$fakebin:$PATH" EFFRACTOR_TTY="$1" EFFRACTOR_UID="$2" \
    EFFRACTOR_USER_UNIT_DIR="$5" EFFRACTOR_SYSTEMD_DIR="$5" \
    EFFRACTOR_BASE_URL="file://$3" EFFRACTOR_INSTALL_DIR="$4" sh "$here/install.sh"
}

echo y > "$work/yes"; echo n > "$work/no"; : > "$work/log"
sysinstall "$work/yes" 1000 "$work/good" "$work/b5" "$work/units5" > "$work/out" || fail "user service install"
unit="$work/units5/effractor.service"
[ -f "$unit" ] || fail "no user unit written"
grep -q "ExecStart=$work/b5/effractor --bind 127.0.0.1:8080 --data " "$unit" || fail "user unit runs the binary on loopback"
grep -q "^# .*--accounts" "$unit" || fail "user unit shows how to turn on accounts, commented"
grep -q "systemctl --user enable effractor" "$work/log" || fail "user service not enabled"
grep -q "systemctl --user restart effractor" "$work/log" || fail "user service not started"
grep -q "enable-linger" "$work/out" || fail "linger not mentioned"
echo "ok - yes installs and enables a user service"

: > "$work/log"
sysinstall "$work/yes" 0 "$work/good" "$work/b6" "$work/units6" >/dev/null || fail "system service install"
unit="$work/units6/effractor.service"
grep -q "^ProtectSystem=strict" "$unit" || fail "system unit is not hardened"
grep -q "^StateDirectory=effractor" "$unit" || fail "system unit has no state directory"
grep -q "^User=effractor" "$unit" || fail "system unit does not run as effractor"
grep -q "systemctl enable effractor" "$work/log" || fail "system service not enabled"
grep -q "systemctl restart effractor" "$work/log" || fail "system service not started"
grep -q "sudo -u effractor .* user add" "$unit" || fail "system unit does not say to manage users as effractor"
echo "ok - as root, a hardened system service"

: > "$work/log"
sysinstall "$work/no" 1000 "$work/good" "$work/b7" "$work/units7" >/dev/null || fail "declining"
[ ! -e "$work/units7/effractor.service" ] || fail "wrote a unit after no"
[ ! -s "$work/log" ] || fail "ran systemctl after no"
echo "ok - no installs no service"

sysinstall "$work/nonexistent-tty" 1000 "$work/good" "$work/b8" "$work/units8" > "$work/out" || fail "no terminal"
[ ! -e "$work/units8/effractor.service" ] || fail "wrote a unit without a terminal"
grep -q "no terminal" "$work/out" || fail "did not say why no service"
echo "ok - without a terminal the answer is no"

# /dev/tty without a controlling terminal is readable but will not open, as a
# socket will not: no question may be printed then.
if command -v python3 >/dev/null; then
  python3 -c 'import socket, sys; socket.socket(socket.AF_UNIX).bind(sys.argv[1])' "$work/tty.sock"
  sysinstall "$work/tty.sock" 1000 "$work/good" "$work/b11" "$work/units11" > "$work/out" 2>&1 || fail "unopenable terminal"
  ! grep -q "Install a systemd service" "$work/out" || fail "asked on a terminal that does not open"
  grep -q "no terminal" "$work/out" || fail "did not say why no service"
  echo "ok - a terminal that does not open is no terminal"
fi

# Re-running upgrades: the binary is replaced by a rename (never written in
# place, which a running one refuses), the unit is kept, the service restarts.
before=$(stat -c %i "$work/b5/effractor")
echo "# edited by the operator" >> "$work/units5/effractor.service"
: > "$work/log"
sysinstall "$work/nonexistent-tty" 1000 "$work/good" "$work/b5" "$work/units5" > "$work/out" || fail "re-run"
[ "$(stat -c %i "$work/b5/effractor")" != "$before" ] || fail "binary written in place"
[ ! -e "$work/b5/effractor.new" ] || fail "left the new binary beside the old"
grep -q "edited by the operator" "$work/units5/effractor.service" || fail "rewrote the operator's unit"
grep -q "systemctl --user restart effractor" "$work/log" || fail "user service not restarted"
grep -q "updated" "$work/out" || fail "did not say the service was updated"
: > "$work/log"
sysinstall "$work/nonexistent-tty" 0 "$work/good" "$work/b6" "$work/units6" >/dev/null || fail "re-run as root"
grep -q "^systemctl restart effractor" "$work/log" || fail "system service not restarted"
! grep -q "useradd" "$work/log" || fail "re-run made the user again"
echo "ok - re-running replaces the binary and restarts the service"

: > "$work/log"
EFFRACTOR_SYSTEMD=yes sysinstall "$work/nonexistent-tty" 1000 "$work/good" "$work/b9" "$work/units9" >/dev/null || fail "env yes"
[ -f "$work/units9/effractor.service" ] || fail "EFFRACTOR_SYSTEMD=yes did not install"
echo "ok - EFFRACTOR_SYSTEMD answers without asking"

nosys="$work/nosys"; mkdir -p "$nosys"
for tool in sh mkdir chmod cp mv mktemp rm grep sha256sum curl uname cat id dirname; do
  ln -sf "$(command -v "$tool")" "$nosys/$tool"
done
HOME="$work/home" EFFRACTOR_SYSTEMD=yes PATH="$nosys" EFFRACTOR_UID=1000 EFFRACTOR_USER_UNIT_DIR="$work/units10" \
  EFFRACTOR_BASE_URL="file://$work/good" EFFRACTOR_INSTALL_DIR="$work/b10" \
  "$nosys/sh" "$here/install.sh" > "$work/out" || fail "without systemctl"
[ ! -e "$work/units10/effractor.service" ] || fail "wrote a unit without systemctl"
grep -q "systemctl not found" "$work/out" || fail "did not say systemctl is missing"
echo "ok - without systemctl it skips with a line"
