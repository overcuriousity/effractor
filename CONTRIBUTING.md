# Working on effractor

**What to work on** is in [ROADMAP.md](ROADMAP.md): a DAG of items with
`needs`, `cost` and `benefit`. An item is ready when everything it needs has
been deleted; take the ready item with the best benefit/cost. The design they
argue from is `docs/superpowers/specs/2026-09-20-effractor-v1-design.md`.

**How it lands.** One branch per item, built test-first. The PR that completes
an item deletes it from the roadmap (`scripts/dev/roadmap-done.py <id>`).
`scripts/dev/ship.sh` does the rest: local checks, commit, PR, wait for that
commit's CI, fast-forward `master`, wait for the release. Commits on `master`
are signed by their author, which is why merges are fast-forwards made locally
and never GitHub's merge button. Every push to `master` is a release.

**Rules the solver lives by.** Native and wasm results are bit-identical, and
CI proves it by running the solver's tests, frozen fingerprints included, under
wasmtime (`cargo test --target wasm32-wasip1 -p effractor-solver` with
`CARGO_TARGET_WASM32_WASIP1_RUNNER="wasmtime run --dir ."`). So: every
transcendental function comes from `libm`, never `std` (`ln`, `exp`, `powf`,
`powi`, …); a fingerprint that moves is a change to every recorded result and
must be intended; and nothing recurses on user-sized input — a model is user
input, and a stack overflow is not a diagnostic.

**UI work** is checked by eye. Pure logic gets `node --test`, server behaviour
gets Rust tests, and what the page looks like is looked at. There is no
headless-browser harness, by decision.
