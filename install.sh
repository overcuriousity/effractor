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
  place "$tmp/$asset" "$dir/effractor"
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
  if [ "${EFFRACTOR_UID:-$(id -u)}" = 0 ]; then
    scope=system
    units=${EFFRACTOR_SYSTEMD_DIR:-/etc/systemd/system}
  else
    scope=user
    units=${EFFRACTOR_USER_UNIT_DIR:-$HOME/.config/systemd/user}
  fi
  # Installed before: the new binary replaces the old, the unit stays as the
  # operator left it (--accounts and all), and the service restarts on it.
  if [ -f "$units/effractor.service" ] && command -v systemctl >/dev/null; then
    [ "$scope" = user ] || system_binary "$bin"
    restart "$scope service updated"
    return 0
  fi
  answer=${EFFRACTOR_SYSTEMD:-}
  if [ -z "$answer" ]; then
    tty=${EFFRACTOR_TTY:-/dev/tty}
    # Readable is not enough: without a controlling terminal /dev/tty exists
    # but will not open, so try opening it before asking.
    if (exec < "$tty") 2>/dev/null && printf 'Install a systemd service? [y/N] ' && read -r answer < "$tty"; then
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
  if [ "$scope" = system ]; then
    system_service "$bin"
  else
    user_service "$bin"
  fi
}

# Copy beside the target and rename over it: a running binary cannot be
# written to (ETXTBSY), but it can be replaced.
place() {
  cp "$1" "$2.new"
  chmod 755 "$2.new"
  mv -f "$2.new" "$2"
}

# Start it, or restart it on a new binary; say so either way.
restart() {
  how=systemctl
  if [ "$scope" = user ]; then how="systemctl --user"; fi
  if $how restart effractor; then
    echo "$1: http://127.0.0.1:8080 (or as its unit says)"
  else
    echo "$1, but it did not start — see: $how status effractor"
  fi
}

# ProtectHome hides /root, where a root install put the binary; the system
# service runs a copy from /usr/local/bin. (Tests set the unit dir and keep
# the binary where it is.)
system_binary() {
  if [ -z "${EFFRACTOR_SYSTEMD_DIR:-}" ]; then
    place "$1" /usr/local/bin/effractor
    bin=/usr/local/bin/effractor
  fi
}

# The line that shows how to turn accounts on; the installer never does.
accounts_hint() {
  echo "# Accounts: add --accounts $1/effractor.db (see the README)"
}

user_service() {
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
  systemctl --user enable effractor
  restart "user service installed"
  echo "to keep it running without a login session: loginctl enable-linger $(id -un 2>/dev/null || echo "\$USER")"
}

system_service() {
  system_binary "$1"
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
# Manage users as the service's user, which owns the database:
#   sudo -u effractor $bin user add NAME --accounts /var/lib/effractor/effractor.db
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
  systemctl enable effractor
  restart "system service installed"
}

die() {
  echo "effractor install: $1" >&2
  exit 1
}

main "$@"
