# v1 acceptance record

Date: 2026-09-21. Final release acceptance is **pending** until the chart and
Pareto PRs are visually accepted and released, and the owner completes
the keyboard walkthrough against that release binary. Do not remove
`v1-acceptance` from the roadmap before that check.

## Automated evidence

- The reference fault-tree and office attack-tree documentation files parse and
  solve. Native `effractor-wasm::api::Session` and browser wasm results match
  byte-for-byte for both files, including control comparisons.
- `npm test`, `cargo test --workspace`, `cargo fmt --all --check`,
  `cargo clippy --workspace --all-targets -- -D warnings`, and
  `node scripts/check-roadmap.js` have passed during implementation. CI must
  still pass for the exact commit being merged.
- `scripts/build-wasm.sh` built the browser module. The reproducible budget
  check is `node scripts/check-performance.js`; it requires 10,000 samples,
  first exact result under 100 ms and total solve under 1 s in every run.
- Measurement before the performance script was added: Node v22.22.3, Linux
  x86_64, AMD Ryzen AI 7 350. Reference fixture: first exact 10.98 ms, first
  full solve 66.04 ms; five subsequent runs exact 0.45–0.67 ms, total
  39.44–50.33 ms. Includes parsing, baseline sampling, control comparisons and
  result serialization; excludes browser worker startup, layout and paint.
  This is a Node-hosted wasm check, not a browser timing claim.
- The documented installer downloaded and verified the SHA-256 of release
  `0.1.0+6010f7f` into an empty temporary installation directory. That release
  includes accepted sharing but predates the remaining UI work. Installation
  was checked on the existing Linux host, not a fresh OS installation.
- Sharing was visually accepted by the owner and merged in PR #43; exact-commit
  CI and release verification passed.

- A local release-mode build with embedded chart/timing/Pareto assets served
  the editor and passed encrypted snapshot create, fetch/decrypt, delete and
  subsequent 404 checks using the reference fixture. This smoke test does not
  replace visual acceptance.

- Timing UI (TTC preset pickers and horizon editor) was visually accepted by
  the owner and merged independently through PR #48 at `1b064d4`; exact-commit
  CI and release verification passed. Pareto
  table alignment was accepted; Mean time/unit/pinned wording was then clarified.
  Overall Pareto merge approval remains pending.

## Owner walkthrough still required

Follow [the course walkthrough](course/README.md) against the final release:

- Build both trees using the keyboard and solve locally.
- Verify charts and Pareto in light/dark themes and their table equivalents.
- Edit horizon and TTC in the UI; undo and verify the result changes.
- Toggle a control and inspect risk delta/rank.
- Share, open in a fresh profile, edit/reload the local copy, delete, and confirm
  the old link is unavailable.
- Install and run the final release on a fresh Linux machine.

Record the release version and the owner's result here when completed.
