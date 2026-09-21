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

### wasm-api — wasm-bindgen surface and worker
needs: —            cost: 1   benefit: 5
Built and tested: the exports, the worker, the page's first solve. What is left
is the check by hand, which is the item's "done": with `scripts/build-wasm.sh`
run and the server up, the reference tree solves on **Solve** / `Ctrl+Enter`
with P(top) shown at once and progress after; `/?samples=20000000` runs long
enough to **Cancel**; and `effractor.solver.crash()` in the console, then Solve
again, shows a crash reported and the worker replaced. Delete this item when
that has been seen.

### ui-renderer — Renderer interface and SVG implementation
needs: wasm-api            cost: 1   benefit: 5
Built and tested: the interface of spec 7.1 with its contract tests, ELK in its
own worker, both profiles' symbols, the repeated node drawn once, pan, zoom,
fit, highlight. What is left is the look, which is the item's "done": `/` shows
the reference fault tree (`&`/`≥1` boxes, circles, the diamond on Malware,
`shared · 2 parents` on Ausfall Server with each parent arriving at its own
point), `/?example=office` the attack tree (AND/OR/`2/3`, cost · detection
strips); in both themes; drag pans, the wheel zooms, **Fit** or `F` fits, a click
selects and fills *Selected*. Delete this item when that has been seen.

### ui-editor — Keyboard-first structure editing
needs: ui-renderer            cost: 1   benefit: 5
Built: the editing operations (tested, and driven through the real wasm module
to build the reference tree with its repeated event), the key table, link
search, drop to reparent / Ctrl-drop to link, context menu, property panel with
the distribution sketch and `p(T)`, undo/redo, the model tree and assets on the
left. What is left is the item's "done", by hand: open `/?example=new` and build
the reference tree by keyboard alone — `Tab`, type the label, `Enter`; `P` for
the panel and `Esc` back; `L` to link *Ausfall Server* under the second gate;
`Ctrl+Z` — and `/?example=new-attack` for an attack tree. Delete this item when
that has been done.

### ui-source — YAML source view and persistence
needs: ui-editor            cost: 2   benefit: 4
Textarea with diagnostics list (click → line); stale-canvas state while invalid;
IndexedDB working state; `.yaml` import/export; a **New** action in place of
`?example=new`, and editing of the header, assets and controls, which the canvas
editor does not reach. Done when a text edit and a
canvas edit round-trip into each other — checked by hand.

### ui-results — Cut sets, node stats, importance colouring
needs: ui-renderer            cost: 1   benefit: 5
Built and tested: fixed FV/Birnbaum bins, leaf styles with the value printed and
SPOF said in words, the ranked cut-set table, reasons for whatever is
unavailable or truncated, node stats, the exact-only re-solve under 100 ms (no
edit path calls it yet — the editor will). What is left is the look, which is
the item's "done": after **Solve**, cut sets list at once and the leaves colour
when sampling ends; a row lights its leaves on the canvas and a selected node
marks its rows; the legend's measure button switches Fussell-Vesely / Birnbaum;
*Selected* shows the node's numbers. Delete this item when that has been seen.

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

### share-ui — Encrypted share, open, delete
needs: ui-source            cost: 2   benefit: 4
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
