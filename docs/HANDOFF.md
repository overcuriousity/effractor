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

The owner has since walked the renderer, the editor, solving and the results
panel in a browser (see below); the attack-tree look and the dark theme have
been seen only in passing.

## The three defects of 2026-09-21 — fixed and seen by the owner

1. No example ships; `/` opens an empty document (`assets/templates/`),
   `?new=attack-tree` an empty attack tree. Fixtures and the spec's example are
   English.
2. **Fit**: the HUD is stacked above the graph.
3. Nothing could be removed because nothing could be *selected*: the renderer
   captured the pointer on every press, and a captured pointer's `click` goes
   to the svg. Capture now starts with the drag; selection comes from the
   release. The canvas takes focus on a press, so keys survive a button click.

Since then, asked for by the owner: every action is an icon in the rail with
its key in the tooltip, `?` lists all keys, the node menu also opens from the
model tree, a refused edit leaves a notice on the canvas, and removal is worded
by what it does (delete / unlink from a parent / delete everywhere) with undo
instead of a confirm. `ui-renderer` and `ui-editor` are off the roadmap;
`wasm-api` and `ui-results` followed once solving, cancel, the crash recovery
and the results panel had been walked. The owner's
taste: Chainalysis Reactor — quiet chrome, detail on demand.

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

1. `ui-source` next — it removes the query-parameter scaffolding and gives the
   editor New/open/save — then `ui-controls`, `ui-charts`, `ui-pareto`,
   `share-ui`, `v1-acceptance`.
