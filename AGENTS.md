# For agents working in this repository

Read, in this order, before changing anything:

1. `CONTRIBUTING.md` — how work lands: branch, PR, CI green for that exact
   commit, fast-forward master (signed commits, never the merge button), every
   push to master is a release. Documentation-only commits go straight to master.
2. `ROADMAP.md` — what is left; delete an item in the change that completes it.
3. `docs/HANDOFF.md` — where things stand, how the owner wants the UI, how UI
   work is verified (the owner looks; do not drive their browser), and the
   mistakes already made once.
4. `docs/superpowers/specs/2026-09-20-effractor-v1-design.md` — the design.

Checks: `npm test`, `cargo test --workspace`, `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings`,
`node scripts/check-roadmap.js`. `scripts/build-wasm.sh` must have run once for
the server tests.
