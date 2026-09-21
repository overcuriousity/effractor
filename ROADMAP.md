# Roadmap

Remaining work for effractor, as a DAG. Spec:
`docs/superpowers/specs/2026-09-20-effractor-v1-design.md` — items argue from
it; read both. How work lands is in `CONTRIBUTING.md`.

**Rules.** `needs` = item ids that must be gone first. `cost` / `benefit` are
1–5. An item is *ready* when everything it needs has been deleted; pick the
ready item with the best benefit/cost. Delete an item in the PR that completes
it. Every item is built test-first. Its "done when" is checked in CI where it can
be; what a page looks like and how it handles is checked by eye — there is no
headless-browser harness, by decision.

**Global constraints.** Rust edition 2024 · `core`/`mal`/`format`/`solver` have
no I/O and compile to `wasm32-unknown-unknown` · all transcendental maths via
`libm` · RNG ChaCha8, 4096-sample chunks, stream = chunk index · no panics on
user input · no third-party origins, no telemetry · vanilla CSS + JS, no bundler
· unknown YAML keys are errors (except `x-`) · numerics monospace right-aligned.

---

## Foundation

### format-yaml — YAML ⇄ Model, canonical writer, migrations
needs: —            cost: 4   benefit: 5
`fn load(&str) -> Result<Model, Vec<Diagnostic>>` with line/col on diagnostics;
`fn save(&Model) -> String` in canonical form (spec §5: key order, authored map
order preserved, shorthands `p`/`rate`/`ttc` kept as written, `x-` keys
round-trip); `effractor: <int>` version gate with a migration chain (v1 is the
identity, with the fixture harness in place). Done when `save∘load` is the
identity on canonical fixtures, canonicalisation is idempotent under proptest,
the spec's example file loads, and unknown keys error with a position.

## Solver

## Browser

### wasm-api — wasm-bindgen surface and worker
needs: format-yaml            cost: 3   benefit: 5
Exports `validate`, `parse`, `serialize`, `solve_begin`/`solve_step`/`solve_finish`,
each returning `{ok}` or `{diagnostics}`; panic hook; `assets/js/solver-worker.js`
with progress, cancel-between-chunks and restart-on-panic; exact results posted
before sampling starts. The build embeds the wasm bundle, so `ci.yml` and
`release.yml` both gain the wasm-bindgen step. Done when the reference tree
solves in the browser with progress shown and a long run can be cancelled —
checked by hand.

### ui-renderer — Renderer interface and SVG implementation
needs: wasm-api            cost: 5   benefit: 5
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
Done when the reference tree, including its repeated event, can be built by
keyboard alone — checked by hand.

### ui-source — YAML source view and persistence
needs: ui-editor            cost: 2   benefit: 4
Textarea with diagnostics list (click → line); stale-canvas state while invalid;
IndexedDB working state; `.yaml` import/export. Done when a text edit and a
canvas edit round-trip into each other — checked by hand.

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
needs: —            cost: 3   benefit: 4
`Storage` trait per spec §8 with reusable contract tests; filesystem impl
(atomic rename, `.meta.json`); `POST/GET/DELETE /api/share`; TTL options and
`--max-ttl`; hourly + startup sweep; hashed delete token; 1 MiB and per-IP
limits; 404 for unknown and expired alike.

### share-ui — Encrypted share, open, delete
needs: share-server, ui-source            cost: 2   benefit: 4
WebCrypto AES-256-GCM, key in the fragment; share dialog with TTL; `/s/{id}`
loads a local copy; "My shares" list with delete. Done when sharing, opening in a
fresh profile, deleting, and then getting 404 all work — checked by hand; the
crypto and list logic have `node --test` tests.

### v1-acceptance — The spec's "done means"
needs: ui-editor, ui-charts, ui-pareto, ui-controls, share-ui            cost: 2   benefit: 5
A walk through spec §12 against a release binary, by hand; performance
budget check (10 000 samples < 1 s, first exact result < 100 ms on the reference
tree); docs page for the course with the reference fault tree and one attack
tree as example files.
