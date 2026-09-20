# Roadmap

Remaining work for effractor, as a DAG. Spec:
`docs/superpowers/specs/2026-09-20-effractor-v1-design.md` — items argue from
it; read both.

**Rules.** `needs` = item ids that must be gone first. `cost` / `benefit` are
1–5. An item is *ready* when everything it needs has been deleted; pick the
ready item with the best benefit/cost. Delete an item in the PR that completes
it. Every item is built test-first, and its "done when" is checked in CI.

**Global constraints.** Rust edition 2024 · `core`/`mal`/`format`/`solver` have
no I/O and compile to `wasm32-unknown-unknown` · all transcendental maths via
`libm` · RNG ChaCha8, 4096-sample chunks, stream = chunk index · no panics on
user input · no third-party origins, no telemetry · vanilla CSS + JS, no bundler
· unknown YAML keys are errors (except `x-`) · numerics monospace right-aligned.

---

## Foundation

### core-model — Domain types and structural validation
needs: —            cost: 3   benefit: 5
`Model`, `NodeId`, `Node {Gate(And|Or|Vote{k}) | Leaf(Basic|Undeveloped)}`,
`Distribution` AST (spec 3.2 incl. product form and shorthands, `Pert`), `Asset`,
`Consequence`, `Control`, `Effect`, `Profile`, `AnalysisConfig`,
`Diagnostic {severity, code, message, path}`. `fn validate(&Model) -> Vec<Diagnostic>`:
dangling refs, cycles (reported with the cycle), `k` range, parameter domains,
profile-disallowed attributes, unreachable nodes, overlapping effects. Done when
each diagnostic code has a passing fixture test.

### mal-ttc — TTC expression parser
needs: core-model            cost: 2   benefit: 4
`fn parse_ttc(&str) -> Result<Distribution, ParseError{col, message}>`:
hand-written recursive descent for exactly spec 3.2, plus
`fn to_expr(&Distribution) -> String` that round-trips. Done when every
shorthand, the product form, bad arity and out-of-domain parameters are tested,
and a fuzz/proptest run finds no panic.

### format-yaml — YAML ⇄ Model, canonical writer, migrations
needs: core-model, mal-ttc            cost: 4   benefit: 5
`fn load(&str) -> Result<Model, Vec<Diagnostic>>` with line/col on diagnostics;
`fn save(&Model) -> String` in canonical form (spec §5: key order, authored map
order preserved, shorthands `p`/`rate`/`ttc` kept as written, `x-` keys
round-trip); `effractor: <int>` version gate with a migration chain (v1 is the
identity, with the fixture harness in place). Done when `save∘load` is the
identity on canonical fixtures, canonicalisation is idempotent under proptest,
the spec's example file loads, and unknown keys error with a position.

## Solver

### solver-dist — Sampling and CDFs
needs: core-model            cost: 3   benefit: 5
For every `Distribution`: `cdf(t) -> f64` and `sample(&mut ChaCha8Rng) -> f64`
(∞ allowed), all through `libm`; the chunked stream scheme
(`fn chunk_rng(seed, chunk_idx)`). Done when CDFs match closed forms, sample
moments match within tolerance, and a fixed seed gives a byte-identical sample
vector natively and under wasmtime.

### solver-bdd — BDD engine and exact P(top ≤ t)
needs: core-model            cost: 4   benefit: 5
Reduced ordered BDD with unique table and ITE cache; deterministic DFS variable
order; `and`/`or`/`vote` compilation with shared subgraphs compiled once;
`bdd_node_limit` → `Unavailable(reason)`; `fn prob(&Bdd, leaf_p: &[f64]) -> f64`.
Done when golden models (series, parallel, 2-of-3, the repeated-event bridge DAG)
match analytic values and proptest equals brute-force enumeration for ≤ 16
leaves.

### solver-mcs — Minimal cut sets and SPOFs
needs: solver-bdd            cost: 3   benefit: 5
Rauzy minimal solutions into a ZBDD; enumeration honouring `mcs_max_order` /
`mcs_max_sets` with a `truncated` flag; cut-set probability; order-1 flagged
SPOF. Done when proptest shows every set satisfies `top`, none is a superset of
another, and none is missing versus brute force.

### solver-importance — Birnbaum and Fussell-Vesely
needs: solver-mcs, solver-dist            cost: 2   benefit: 4
Birnbaum by cofactor evaluation; FV by definition from the ZBDD subset
containing the leaf (spec §4 — not the rare-event form). Done when both match
brute force under proptest and a fixture shows FV ≠ the approximation.

### solver-mc — Monte Carlo, Wilson CI, TTC CDF
needs: solver-dist, solver-bdd            cost: 3   benefit: 5
Stepped sampler: `begin(model, config) -> Run`, `step(&mut Run) -> Progress`
(one 4096 chunk), `finish(Run) -> Sampled`; node completion times by
min/max/k-th; Wilson interval on P(top ≤ T); empirical TTC CDF with pointwise
band; exact TTC CDF by sweeping the BDD over a 64-point grid. Native driver uses
rayon over chunks, merged in chunk order. Done when results are identical for
1 and N threads, and CIs cover the exact value at the nominal rate under
proptest.

### solver-impact — Consequences and the loss exceedance curve
needs: solver-mc            cost: 3   benefit: 5
Per-iteration: occurring nodes → consequences → dedupe per `(asset, dim)` by max
fraction → one magnitude draw per needed `(asset, dim)` → loss. Outputs EAL,
p50/p90/p95/p99, LEC points, per-asset breakdown. Done when the dedup fixture
(two occurring nodes, same asset/dim) yields one loss, a constant-magnitude
model matches `P × magnitude` within CI, and a zero-asset model skips cleanly.

### solver-attacker — Cheapest path and Pareto front
needs: solver-mcs, solver-dist            cost: 3   benefit: 4
Per-MCS cost (shared leaf once), detection, success, `E[max TTC | finite]`
(numerical integration of the product CDF, via `libm`); min-cost set with
time → id tie-break; non-dominated filter over (cost, time, detection). Done when
proptest finds no dominated member and no missing non-dominated MCS.

### solver-controls — Toggles, deltas, ranking
needs: solver-impact, solver-importance            cost: 3   benefit: 5
Apply enabled effects (lowest `p(T)` wins); per-control flip re-solve with
common random numbers; Δrisk (EAL if assets else P(top)), Δ/cost ranking for
disabled controls, removal cost for enabled ones. Done when a blocking control
on a SPOF ranks first in the fixture and a no-op control has Δ exactly 0.

### solver-results — `solve` façade and results JSON
needs: solver-controls, solver-attacker            cost: 2   benefit: 5
`fn solve(&Model, &Config) -> Results` plus the stepped form; `Results` serde
schema `effractor-results: 1` with `unavailable` / `truncated` reasons; profile
gating of analyses. Done when the reference tree's results JSON is
snapshot-tested and byte-identical natively and under wasmtime in CI.

## Browser

### wasm-api — wasm-bindgen surface and worker
needs: format-yaml, solver-results            cost: 3   benefit: 5
Exports `validate`, `parse`, `serialize`, `solve_begin`/`solve_step`/`solve_finish`,
each returning `{ok}` or `{diagnostics}`; panic hook; `assets/js/solver-worker.js`
with progress, cancel-between-chunks and restart-on-panic; exact results posted
before sampling starts. Done when a headless-browser test solves the reference
tree and cancels a long run.

### server-shell — Binary, app shell, embedded assets
needs: —            cost: 2   benefit: 4
`effractor` binary (axum; flags `--bind`, `--data`, `--max-ttl`); askama shell;
rust-embed for CSS, JS, fonts, wasm; security headers and the strict CSP of spec
§8. Done when an integration test asserts the headers and that no response
references a third-party origin.

### ui-tokens — Engram tokens, theme switch, validated ramp
needs: server-shell            cost: 2   benefit: 4
Port `00-tokens.css` unchanged; add the `--viz-*` tokens and ink pairs of spec
7.3; three-state switch, initial state light; `scripts/check-contrast.js`
asserting every ratio in the spec table, in CI. Done when the script passes and
fails on a deliberately broken token.

### ui-workspace — Docked-panel layout
needs: ui-tokens            cost: 3   benefit: 4
Top bar, tool rail, left/right panels, canvas region, legend footer per the
approved mockups; resizable, collapsible panels; tabular numerics. Static, no
model yet. Done when it holds at 1280×720 and up in both themes.

### ui-renderer — Renderer interface and SVG implementation
needs: ui-workspace, wasm-api            cost: 5   benefit: 5
The interface of spec 7.1; ELK layered layout in its own worker; DIN 25424
symbols (`&`, `≥1`, `≥k`, circle, diamond, description boxes); attack-tree
labelling; a repeated node drawn once with a `shared · n parents` badge; pan,
zoom, fit; highlight. Done when interface contract tests pass and the reference
tree renders symbol-correct in both profiles.

### ui-editor — Keyboard-first structure editing
needs: ui-renderer            cost: 5   benefit: 5
Spec 7.2 in full: key table, link-existing search, drag reparent/link, context
menu, property panel with density sketch and `p(T)`, undo/redo snapshots, model
tree in the left panel. Every edit goes `parse → Model → serialize` in wasm.
Done when a headless test builds the reference tree, including its repeated
event, by keyboard alone.

### ui-source — YAML source view and persistence
needs: ui-editor            cost: 2   benefit: 4
Textarea with diagnostics list (click → line); stale-canvas state while invalid;
IndexedDB working state; `.yaml` import/export. Done when a text edit and a
canvas edit round-trip into each other in a headless test.

### ui-results — Cut sets, node stats, importance colouring
needs: ui-renderer            cost: 3   benefit: 5
Solve button / `Ctrl+Enter`, progress and cancel; HUD cards (P(top) ± CI, EAL /
p95); ranked cut-set table with SPOF flags and canvas cross-highlight;
selected-node stats; leaf fills from fixed FV/Birnbaum bins; legend; auto
re-solve of exact results when the last took < 100 ms; visible
unavailable/truncated reasons.

### ui-charts — TTC CDF and LEC
needs: ui-results            cost: 3   benefit: 4
Hand-rolled SVG charts: exact + sampled CDF with band, LEC with percentiles and
the one-event-per-horizon note; crosshair tooltip; table view for each.

### ui-pareto — Pareto table and scatter
needs: ui-results            cost: 2   benefit: 3
Spec 7.4: primary table with pinned cheapest path; scatter with axis pickers;
two-way highlight with the canvas. Attack-tree profile only.

### ui-controls — Control toggles and ranking
needs: ui-results            cost: 2   benefit: 5
Controls panel: toggle (edits `enabled` in the document), delta against
baseline, ranking table with the "marginal, not additive" note.

## Sharing and delivery

### share-server — Storage trait, filesystem impl, API
needs: server-shell            cost: 3   benefit: 4
`Storage` trait per spec §8 with reusable contract tests; filesystem impl
(atomic rename, `.meta.json`); `POST/GET/DELETE /api/share`; TTL options and
`--max-ttl`; hourly + startup sweep; hashed delete token; 1 MiB and per-IP
limits; 404 for unknown and expired alike.

### share-ui — Encrypted share, open, delete
needs: share-server, ui-source            cost: 2   benefit: 4
WebCrypto AES-256-GCM, key in the fragment; share dialog with TTL; `/s/{id}`
loads a local copy; "My shares" list with delete. Done when a headless test
shares, opens in a fresh profile, deletes, and then gets 404.

### release — Release workflow, installer, README
needs: server-shell            cost: 2   benefit: 5
On push to `master`: build wasm, embed, compile static musl binaries (x86_64,
aarch64), publish a GitHub Release `<Cargo version>+<short sha>` with SHA-256
sums, move `latest`. `install.sh` (arch detect, checksum verify,
`~/.local/bin`). Concise `README.md` with the curl one-liner. Done when the
one-liner yields a running instance on a clean container in CI.

### v1-acceptance — The spec's "done means"
needs: ui-editor, ui-charts, ui-pareto, ui-controls, share-ui, release            cost: 2   benefit: 5
End-to-end headless run of spec §12 against a release binary; performance
budget check (10 000 samples < 1 s, first exact result < 100 ms on the reference
tree); docs page for the course with the reference fault tree and one attack
tree as example files.
