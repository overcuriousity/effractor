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

## Solver

## Browser

### ui-charts — TTC CDF and LEC
needs: —            cost: 3   benefit: 4
Hand-rolled SVG charts: exact + sampled CDF with band, LEC with percentiles and
the one-event-per-horizon note; crosshair tooltip; table view for each.

### ui-pareto — Pareto table and scatter
needs: —            cost: 2   benefit: 3
Spec 7.4: primary table with pinned cheapest path; scatter with axis pickers;
two-way highlight with the canvas. Attack-tree profile only.

### ui-controls — Control toggles and ranking
needs: —            cost: 2   benefit: 5
Controls panel: toggle (edits `enabled` in the document), delta against
baseline, ranking table with the "marginal, not additive" note.

## Sharing and delivery

### share-ui — Encrypted share, open, delete
needs: —            cost: 2   benefit: 4
WebCrypto AES-256-GCM, key in the fragment; share dialog with TTL; `/s/{id}`
loads a local copy; "My shares" list with delete. Done when sharing, opening in a
fresh profile, deleting, and then getting 404 all work — checked by hand; the
crypto and list logic have `node --test` tests.

### v1-acceptance — The spec's "done means"
needs: ui-charts, ui-pareto, ui-controls, share-ui            cost: 2   benefit: 5
A walk through spec §12 against a release binary, by hand; performance
budget check (10 000 samples < 1 s, first exact result < 100 ms on the reference
tree); docs page for the course with the reference fault tree and one attack
tree as example files.
