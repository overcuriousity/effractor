# effractor

Security architecture analysis in the browser. Model a fault tree or an attack
tree as text, and get minimal cut sets, single points of failure, exact and
sampled probabilities, time-to-compromise, a loss exceedance curve, and controls
ranked by risk reduction per cost. Solving runs locally in WebAssembly: a model
never leaves your machine unless you share it. No accounts, no telemetry.

*effractor* — Latin: one who breaks in.

[Open effractor in your browser](https://overcuriousity.github.io/effractor/).
The public site runs the same editor and solver, with local persistence,
file import/export and self-contained share links. These links carry compressed
YAML in the URL fragment: no model is uploaded. Anyone with the link can read
it; links are not encrypted and cannot expire or be revoked. Opening one makes
an editable local copy; Ctrl+Z restores the previous document.

Self-contained links are limited to 8,192 characters and 1 MiB of expanded YAML.
Long links may not survive every messaging service; use a YAML file for larger
models. Install the server below to also offer short, encrypted share links
with expiry and deletion, stored on your own server.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/overcuriousity/effractor/master/install.sh | sh
```

Linux x86_64 and aarch64, one static binary, SHA-256 verified, installed to
`~/.local/bin`. The installer asks whether to install a systemd service (a user
service, or a hardened system service as root); `EFFRACTOR_SYSTEMD=yes|no`
answers without asking. Then:

```sh
effractor            # http://127.0.0.1:8080
effractor --bind 0.0.0.0:9000
```

The [sample collection](assets/examples/README.md) includes three fault trees,
three attack trees and seven architectures in rising order of complexity. Download
a YAML file and use **Open** in the app; the files ship with both the server and
the static site.

## Accounts (self-hosted)

The server can keep people's documents: accounts with password, passkey or
OIDC login (e.g. Nextcloud), folders and search, and sharing with users and
groups. It is off unless you give it a database; without one, nothing changes.
The GitHub Pages build never has accounts.

```sh
effractor user add alice --accounts /var/lib/effractor/effractor.db   # asks for a password
effractor user promote alice --accounts /var/lib/effractor/effractor.db
effractor --accounts /var/lib/effractor/effractor.db --public-url https://effractor.example
```

- `effractor user list | add | promote | demote | passwd` manage users from the
  shell; admins manage users and groups in the page. There is no public sign-up.
- `--public-url` is the address people use. Passkeys need it, and it makes the
  session cookie `Secure` when it is `https`. Put a TLS proxy in front, and
  start with `--trusted-proxy` when it runs on the same host, so failed logins
  are counted per client and not all as the proxy. The address may carry a
  path (`https://example.org/effractor`) when the proxy strips it before
  passing requests on.
- OIDC: `--oidc-issuer URL --oidc-client-id ID --oidc-name Nextcloud` and the
  secret in `--oidc-secret-file FILE` or `EFFRACTOR_OIDC_SECRET`. Register
  `<public url>/api/auth/oidc/callback` as the redirect URI at the issuer. A
  first login makes an account in no group; an admin assigns groups.
- Documents are stored readable in SQLite (WAL). Protect the file as you
  would any database; the YAML download is every user's own backup.
- Public share links stay end-to-end encrypted, as without accounts.

## Fault-tree methods and references

Effractor analyses static, coherent fault trees with independent basic events.
Repeated events share one variable; minimal cut sets identify combinations that
cause the top event, and singleton cut sets identify single points of failure.
Exact probabilities use binary decision diagrams (BDDs). Failure rates describe
time to first failure without repair; simulation confidence intervals measure
sampling error, not uncertainty in the supplied failure rates.

Public background and reference material:

- [NRC Fault Tree Handbook, NUREG-0492 (1981)](https://www.nrc.gov/regulations-legislation/nureg-series-publications/publications-prepared-by-nrc-staff/sr0492)
  — fault-tree construction and evaluation.
- [NASA Fault Tree Handbook with Aerospace Applications, version 1.1 (2002)](https://s3vi.ndc.nasa.gov/ssri-kb/static/resources/Fault%20Tree%20Handbook_NASA.pdf)
  — Boolean logic and BDDs (§6), quantification and uncertainty (§7), and dynamic
  fault trees (§8). Effractor does not implement the handbook's full range of methods.

These references describe the methods; they do not establish DIN/IEC conformity.

## Status

Early. What is left is in [ROADMAP.md](ROADMAP.md); where things stand is in
[docs/HANDOFF.md](docs/HANDOFF.md).

## Build

```sh
scripts/build-wasm.sh            # the solver, as wasm, into assets/wasm/
cargo run -p effractor-server
```

The server builds OpenSSL from source (for passkeys), which needs `perl` with
its core modules (Fedora: `perl-core`), `make` and a C compiler.
The first line needs the `wasm-bindgen` CLI in the version `Cargo.lock` names;
it says how to get it, or fetches it itself with `--fetch-cli`. Run it again
after changing a crate the browser runs. Other browser assets are vendored; `npm ci && npm run vendor` only after bumping a pin
in `package.json`.

To build a static site after building WASM, run `scripts/build-site.sh`.
Serve `target/site/` with any static web server. The export uses the server's
own HTML template and assets; no separate UI is maintained. Asset paths work
at a domain root or under a repository path.

The `pages` workflow builds and deploys it on every push to `master`, including
documentation-only pushes. Repository Settings → Pages → Source must be
**GitHub Actions** (one-time setup). The workflow can also be run manually.

AGPL-3.0-or-later.
