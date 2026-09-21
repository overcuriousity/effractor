# effractor

Security architecture analysis in the browser. Model a fault tree or an attack
tree as text, and get minimal cut sets, single points of failure, exact and
sampled probabilities, time-to-compromise, a loss exceedance curve, and controls
ranked by risk reduction per cost. Solving runs locally in WebAssembly: a model
never leaves your machine unless you share it. No accounts, no telemetry.

*effractor* — Latin: one who breaks in.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/overcuriousity/effractor/master/install.sh | sh
```

Linux x86_64 and aarch64, one static binary, SHA-256 verified, installed to
`~/.local/bin`. Then:

```sh
effractor            # http://127.0.0.1:8080
effractor --bind 0.0.0.0:9000
```

The [course walkthrough](docs/course/README.md) includes fault-tree and attack-tree
files, timing explanations, and a step-by-step analysis exercise.

## Status

Early. What is left is in [ROADMAP.md](ROADMAP.md); what it is meant to be is in
the [design](docs/superpowers/specs/2026-09-20-effractor-v1-design.md).

## Build

```sh
scripts/build-wasm.sh            # the solver, as wasm, into assets/wasm/
cargo run -p effractor-server
```

The first line needs the `wasm-bindgen` CLI in the version `Cargo.lock` names;
it says how to get it, or fetches it itself with `--fetch-cli`. Run it again
after changing a crate the browser runs. Other browser assets are vendored; `npm ci && npm run vendor` only after bumping a pin
in `package.json`.

AGPL-3.0-or-later.
