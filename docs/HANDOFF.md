# Handoff — 2026-09-21

For the next session. Read `CONTRIBUTING.md`, `ROADMAP.md` and the design
(`docs/superpowers/specs/2026-09-20-effractor-v1-design.md`) first; this file
says where things stand and what is wrong, which those do not.

## The honest state

The Rust side is solid: `core`, `mal`, `solver`, `format`, `wasm` and the share
server are tested (property tests included), deterministic native vs wasm, and
released. **The browser UI is not.** `wasm-api`, `ui-renderer`, `ui-results` and
`ui-editor` were landed in one session without anyone looking at the page: their
pure logic has `node --test` tests, the DOM code has none and was never run in a
browser by its author. The owner's first quick look found three defects
(below). Treat every DOM-facing file as unverified:

    assets/js/app.js  editor.js  renderer-svg.js (event wiring)  layout.js
    assets/js/solver-worker.js (bootstrap part)   assets/css/30-, 40-, 50-*.css

Those four roadmap items are still on the roadmap, narrowed to their check by
hand. Do not delete one until the owner has seen it work. The editor in
particular is "far from functional" in the owner's words — assume more is
broken than is listed here.

## Defects found by the owner — fix these first

### 1. A German example dataset is shipped and opens by default — neither is wanted

- `assets/examples/webserver.yaml` (German labels, the course's reference tree)
  is what `/` loads; `office.yaml` is German too. `app.js` (`EXAMPLES`,
  `exampleName`, `load`) fetches one on every start.
- Wanted: no dataset opening by default, and nothing German in what ships. The
  obvious shape: `/` starts with an empty document (what `?example=new` does
  now); if examples stay at all they are English and opened on request. Ask the
  owner whether examples should ship at all before writing new ones.
- Touches: `assets/examples/*`, `app.js`, the server test
  `the_solver_and_its_example_are_embedded`, the format test
  `shipped_examples_are_canonical`, `scripts/fixtures/webserver.doc.json` and
  its Rust pin `the_javascript_fixture_is_the_real_image`, and the three
  narrowed roadmap items that name German labels. Test *fixtures* under
  `crates/effractor-format/tests/fixtures/` are German as well; they are not
  shipped, but ask whether they should be translated too. The spec's §5 example
  is the same German tree.
- The `?example=` / `?samples=` query parameters were scaffolding for hand
  checks before an editor and a source view existed. `ui-source` (New, import,
  export, persistence) is their replacement.

### 2. The **Fit** button does nothing

Cause, read from the source, not yet confirmed in a browser: the SVG covers the
HUD. `renderer.mount($("canvas"))` appends `svg.graph` *after* the `.hud`
elements in `#canvas`; both are `position: absolute` with no `z-index`, so the
SVG (`inset: 0`) is on top and takes the click — and starts a pan. The P(top) /
loss cards are under it too. Fix: stack `.hud` above `.graph` (`z-index`), or
mount the SVG before the HUD; and check the `F` key separately, it goes through
a different path (`app.js` keydown).

### 3. Nodes cannot be removed

Not diagnosed. `Del`/`Backspace` → `actions.remove` in `editor.js` →
`E.removeEdge` (tested, works under node, also through the real wasm module) →
`app.applyEdit`. Leads, in the order I would check them:

1. Keys never arrive. `typingElsewhere` ignores keydown whenever the event
   target is a `BUTTON`/`INPUT`/…; clicking the SVG does not move focus, so
   after any button click (Solve, Fit, a rail tool) the canvas keys may be dead
   until something else takes focus. If so, *all* canvas keys are affected, not
   just Del. Likely fix: make the canvas focusable and focus it on select, and
   scope the key handler to it.
2. `state.parent` is null, so `remove` returns early — check what `select()`
   computes for a node clicked on the canvas.
3. `window.confirm` (shown when the node has attributes) or `applyEdit`
   returning early because `state.running` is stuck `true`.
4. The context-menu path (`Remove this edge`) — is the menu even shown? It is
   positioned with `position: fixed` via CSS custom properties.

Removing the **top** node is refused by design (no parent edge); say so in the
UI rather than doing nothing.

## How to verify UI work from now on

The rule stands: no headless-browser harness in the repo, the owner judges the
page. What went wrong this session is that code was landed with *nobody* having
run it. Do not repeat that:

- After any DOM change, run the server and ask the owner to look **before**
  landing, with a short list of what to try. Small PRs, one interaction each.
- This environment has a Chrome extension tool (`claude-in-chrome`) that could
  drive the owner's real browser for a smoke check. It was not used, because the
  standing instruction is that the owner verifies the UI. Ask once whether it
  may be used for smoke checks; it is not a test harness and leaves nothing in
  the repo.
- A one-off trick that did catch real layout bugs: serialise the renderer's
  output through `scripts/fixtures/fake-dom.js` to an `.svg`, inline the token
  values, rasterise with ImageMagick, look at the PNG. Geometry only — it says
  nothing about events, focus or stacking, which is exactly where the defects
  above are.

## What exists, briefly

- `effractor-format`: `load` / `save` / `canonicalize` / `diagnose`, and
  `document` / `from_document` — the JSON image of a document that the browser
  edits. `x-` keys are **not** in `core::Model`; the reader hands them to the
  writer by path. Text is written bare only where the YAML parser reads it back
  identically *in that position* (block value, block key, flow item/key/value).
- `effractor-wasm`: `validate`, `parse`, `serialize`, `solve_begin/step/finish/
  cancel`, `ttc_sketch`, `crash`; JSON text in and out; logic in `api.rs`,
  tested natively. `serde_json` needs `float_roundtrip` (a test fails without).
- `scripts/build-wasm.sh [--fetch-cli]` → `assets/wasm/` (git-ignored). The
  server test for the bundle fails until it has run. CI and the release run it;
  the release builds the bundle once for both architectures.
- JS, pure and tested: `graph.js` (document → drawn nodes → ELK graph; shared
  nodes get one in-port per parent via a second layout pass), `view.js`,
  `results-view.js`, `edit.js`, `solver.js`, and the message handler in
  `solver-worker.js`. Maps keyed by node id are prototype-less: `constructor`
  is a valid id.
- Share server: `share::Storage` with one contract test for memory and
  filesystem; `POST/GET/DELETE /api/share`; details in spec §8.

## Known limits and loose ends

- JavaScript reorders object keys that look like array indices: a node whose id
  is all digits moves to the front of `nodes` on a trip through the editor.
  Either forbid such ids in `core::id` (a spec change) or carry order explicitly.
- Via JSON, a bare `x-` string that looks typed (`2026-09-01`) comes back
  quoted. Same value to every reader; documented in `tests/json.rs`.
- Descriptions with line breaks are written as one double-quoted line; a block
  scalar would diff better.
- The editor cannot edit the header, assets or controls, and there is no New /
  open / save — all noted on `ui-source`.
- `fresh` ids (derive the id from the first label) live in `editor.js` memory
  only; an undo or a reload forgets which nodes were still unnamed.
- Behind a reverse proxy the share rate limit sees one address. By design there
  is no flag for it.
- ELK may order a shared node's siblings differently from the document to avoid
  crossings.

## Process reminders that bit this session

- `ship.sh` runs `git add -A`. Build products that are ignored only on another
  branch (it was `assets/wasm/`) get committed; `.git/info/exclude` has the entry
  locally now.
- `ship.sh` switches the checkout to `master`; a worktree holding `master`
  blocks it. Once it has fast-forwarded it only watches the release and the tree
  is free.
- Run `cargo fmt --all` *after* the last edit; rustfmt rewraps lines, which also
  breaks scripted search-and-replace against them.

## Suggested order

1. Defects 1–3 above, each looked at by the owner before it lands.
2. Walk the four narrowed roadmap items with the owner; fix what falls out;
   delete each item only then.
3. `ui-source` next — it removes the query-parameter scaffolding and gives the
   editor New/open/save — then `ui-controls`, `ui-charts`, `ui-pareto`,
   `share-ui`, `v1-acceptance`.
