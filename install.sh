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

  offer_service "$dir/effractor"
}

# Ask whether to run effractor as a systemd service (spec §13). stdin is this
# script under `curl | sh`, so the answer comes from the terminal; without one
# the answer is no. EFFRACTOR_SYSTEMD=yes|no answers without asking.
offer_service() {
  bin=$1
  answer=${EFFRACTOR_SYSTEMD:-}
  if [ -z "$answer" ]; then
    tty=${EFFRACTOR_TTY:-/dev/tty}
    if [ -r "$tty" ] && printf 'Install a systemd service? [y/N] ' && read -r answer < "$tty"; then
      :
    else
      echo "no terminal to ask on — no service installed (EFFRACTOR_SYSTEMD=yes installs one)"
      return 0
    fi
  fi
  case "$answer" in
    y | Y | yes | YES) ;;
    *) return 0 ;;
  esac
  command -v systemctl >/dev/null || { echo "systemctl not found — no service installed"; return 0; }
  if [ "${EFFRACTOR_UID:-$(id -u)}" = 0 ]; then
    system_service "$bin"
  else
    user_service "$bin"
  fi
}

# The line that shows how to turn accounts on; the installer never does.
accounts_hint() {
  echo "# Accounts: add --accounts $1/effractor.db (see the README)"
}

user_service() {
  units=${EFFRACTOR_USER_UNIT_DIR:-$HOME/.config/systemd/user}
  data=${XDG_DATA_HOME:-$HOME/.local/share}/effractor
  mkdir -p "$units" "$data"
  cat > "$units/effractor.service" <<EOF
[Unit]
Description=effractor

[Service]
ExecStart=$bin --bind 127.0.0.1:8080 --data $data/shares
$(accounts_hint "$data")
Restart=on-failure

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now effractor
  echo "user service installed: http://127.0.0.1:8080"
  echo "to keep it running without a login session: loginctl enable-linger $(id -un 2>/dev/null || echo "\$USER")"
}

system_service() {
  units=${EFFRACTOR_SYSTEMD_DIR:-/etc/systemd/system}
  # ProtectHome hides /root, where a root install put the binary; the
  # service runs a copy from /usr/local/bin. (Tests set the unit dir and
  # keep the binary where it is.)
  if [ -z "${EFFRACTOR_SYSTEMD_DIR:-}" ]; then
    cp "$bin" /usr/local/bin/effractor
    bin=/usr/local/bin/effractor
  fi
  mkdir -p "$units"
  if ! id effractor >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin effractor
  fi
  cat > "$units/effractor.service" <<EOF
[Unit]
Description=effractor
After=network.target

[Service]
User=effractor
StateDirectory=effractor
ExecStart=$bin --bind 127.0.0.1:8080 --data /var/lib/effractor/shares
$(accounts_hint /var/lib/effractor)
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now effractor
  echo "system service installed: http://127.0.0.1:8080"
}

die() {
  echo "effractor install: $1" >&2
  exit 1
}

main "$@"
