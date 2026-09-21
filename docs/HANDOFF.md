# Handoff — 2026-09-21, evening

For the next session — whoever or whatever picks it up; everything needed is in
the repository, nothing lives in an agent's private notes. Read `CONTRIBUTING.md`, `ROADMAP.md` and the design
(`docs/superpowers/specs/2026-09-20-effractor-v1-design.md`) first; this file
says where things stand, how the owner wants the UI to be, and what bit today.

## Continuation — current session

Sharing was visually accepted and merged in PR #43. Timing UI was accepted
and merged independently through PR #48 at `1b064d4`; CI and release are green.
Stacked PR #45 is closed. Work continues on normal feature branches in the main
checkout, as requested by the owner:

- PR #44 (`feature/ui-charts`): TTC and loss charts, tables, crosshair and keys.
- PR #46 (`feature/ui-pareto`): sortable table, pinned cheapest path, axis
  pickers, scatter and two-way graph highlighting.
- `feature/v1-acceptance`: course docs/files, performance check, and an honest
  acceptance record in `docs/V1-ACCEPTANCE.md`.

These are stacked in that order on the timing merge. Charts remain pending
visual acceptance. Pareto needs another owner look after the header/cell
alignment fix in `4611161`; do not infer approval from passing tests.
The roadmap still lists the unfinished acceptance items. Read the acceptance
record for measured results and the remaining release-binary walkthrough.

The remainder of this document records the original handoff and conventions.

## Where things stood before this session

Master is `2e6166c` plus this file; CI and the release are green; no PR is open.
The Rust side (`core`, `mal`, `solver`, `format`, `wasm`, share server) is
tested and released, deterministic native vs wasm. The browser UI has now been
**walked by the owner in a browser, piece by piece**: canvas, editor, solving,
results, file menu and persistence, source view, assets, controls. Nothing is
known to be broken.

Four items are left on the roadmap, and the owner wants **all of them done in
the next session**, so cost is no criterion — only an efficient order:

1. **`share-ui`** — the server side (`POST/GET/DELETE /api/share`, spec §8) is
   built and tested; this is WebCrypto AES-256-GCM with the key in the fragment,
   a share dialog with TTL, `/s/{id}` loading a local copy, a "My shares" list
   with delete. The `Share` button in the top bar is there, disabled.
   `store.js` already wraps IndexedDB (one object store, `working`); the share
   list belongs in the same database — that needs a version bump and a second
   store. Crypto and list logic get `node --test` tests.
2. **`ui-charts`** — TTC CDF (exact + sampled with band) and LEC, hand-rolled
   SVG, crosshair tooltip, a table view each. The numbers are in the results
   already: `exact.ttc_cdf`, `sampled.ttc_cdf` (with band), `sampled.loss`
   `exceedance`. New tabs in the right panel (`controls.js` has the tab code;
   the tablist is in `shell.html`). Charts must read in both themes and never rely
   on colour alone (spec 7.3).
3. **`ui-pareto`** — attack-tree profile only; `results.attacker` has the sets
   with `on_front`. Table with the cheapest path pinned, scatter with axis
   pickers, two-way highlight with the canvas (`renderer.highlight(ids, kind)`
   and the cut-set table in `app.js` show how).
4. **`v1-acceptance`** — spec §12 by hand against a release binary, the
   performance budget, the course docs page. Needs the three above.

Order 1–3 is free (none needs another); charts and pareto both add right-panel
tabs, so doing them back to back saves a rebase. Sample documents that exercise
everything (shared nodes, vote gate, assets, controls, both profiles) are in
`~/effractor-samples/` on the owner's machine — outside the repo on purpose.

## How the owner wants the UI

The reference is Chainalysis Reactor: quiet chrome, detail on demand. Decided
today, all of it after seeing the alternative:

- **No examples ship**, nothing German ships; `/` opens the working text from
  IndexedDB, else an empty document. Fixtures and the spec's example are English.
- **No walls of buttons.** Actions are icons in the rail with the key in the
  tooltip; the context menu (canvas *and* model tree) and the `?` list spell
  them out. Every interaction has a button and every key is listed.
- **UI copy is a few words** — a unit, a range, a format — never sentences. **No
  other product is named** in the product (securiCAD is our orientation, not the
  user's; the preset names stay because they are the file format).
- **No native form pop-ups.** `menu.js` has the app's own dropdown (answers to
  `value` / `change` like a select) and suggestions under a text field; use
  them, not `<select>` / `<datalist>`.
- **No confirm dialogs.** Destructive things are undoable and say so in the
  canvas notice (`app.say`): delete, unlink, remove asset/control, New/Open.
- **No made-up numbers.** A likelihood kind opens an empty field; a leaf without
  a number is drawn dashed with `?`.
- Things are named by what they do: *Delete "X" and 3 below*, *Unlink from "P"*.

## How UI work is verified

No headless-browser harness in the repo, and the owner said **no** to an agent
driving their browser: they look, you hand them a short numbered list of what
to try. What worked today:

- One interaction per PR; pure logic (`edit.js`, `results-view.js`, `store.js`,
  `source.js` helpers, `view.js`, `graph.js`) under `node --test`; then run the
  server, say what to try, wait for the look, merge only on the owner's word.
- `cargo run -p effractor-server` serves `assets/` **from disk** in debug, so
  the page follows whatever branch the main checkout is on; `shell.html` is
  compiled in, so a change there needs a restart. To keep working while the
  owner looks, use a `git worktree` and a second server
  (`-- --bind 127.0.0.1:8081`, own `CARGO_TARGET_DIR`, copy `assets/wasm/` in).
  A different port is a different origin: separate IndexedDB and localStorage.
- Everything that refuses or fails says so through `app.say` — blind debugging
  of "nothing happens" cost an hour before that existed.
- A scratch script can drive the real wasm module under node
  (`new Function(src + "; return wasm_bindgen;")()`, then `initSync`) to check
  that an edit serialises, parses and solves; ELK runs under node too
  (`elkjs/lib/elk.bundled.js`). Good for ruling the logic out.

## What bit today

- **A scripted edit cut 90 lines too many** out of `editor.js` (rail wiring, the
  keys dialog). `node --check` and every test passed; the page was dead. After
  any scripted edit to a DOM file, read the *deleted* lines of the diff
  (`git diff | grep '^-'`) before saying it is ready.
- **Pointer capture moves the click.** `setPointerCapture` on every press made
  the browser send `click` to the svg, so nothing could be selected. Capture
  only once a press becomes a drag; select from `pointerup`.
- **Stacking.** The svg is mounted after the HUD and covered it; `.hud` has
  `z-index: 1`.
- **`solver.onCrash` was never set**, so a crash with nothing pending was
  silent. It is set now.
- In the last session's tooling `git push --force` and deleting branches were
  blocked. A rebased branch goes up under a new name with a new PR and
  the old PR is closed; a stacked PR whose base is not `master` shows as closed,
  not merged, after the fast-forward — close it with a comment.
- The process stands (see `CONTRIBUTING.md`): branch → PR → `wait-ci.sh ci.yml
  <sha>` for that exact commit, unpiped → `git merge --ff-only` on master →
  push → `wait-ci.sh release.yml <sha>`. Wait for one release before pushing
  master again. **Documentation-only commits go straight to master** — the owner
  does not want CI waited on for a text file. `commit.gpgsign` is on; master stays signed.
- `pkill -f target/debug/effractor` kills the shell that runs it. Stop the
  server by port: `ss -ltnp | grep :8080`, then `kill` the pid.

## Housekeeping left behind

- Two finished worktrees, `../SecGraph-noexamples` and `../SecGraph-source`, and
  some twenty merged branches, local and on origin. All are merged into master;
  removing them was blocked by the tooling, so it is the owner's to run:
  `git worktree remove --force <dir>`, `git branch -d …`,
  `git push origin --delete …`.

## What exists, briefly

- `effractor-format`: `load` / `save` / `canonicalize` / `diagnose`, and
  `document` / `from_document` — the JSON image the browser edits. `x-` keys are
  not in `core::Model`; the reader hands them to the writer by path.
- `effractor-wasm`: `validate`, `parse`, `serialize`, `solve_begin/step/finish/
  cancel`, `ttc_sketch`, `crash`; JSON text in and out. `scripts/build-wasm.sh
  [--fetch-cli]` → `assets/wasm/` (git-ignored; a server test fails without it).
- Page scripts, in load order: `theme`, `workspace` (panels), `graph`, `view`,
  `renderer-svg` (interface of spec 7.1, plus `zoomBy`, pressable edges, refit
  on resize), `layout` (ELK worker), `results-view`, `edit` (every document
  edit, pure), `solver`, `store`, `app` (state, solve, undo, file menu, notice),
  `menu` (dropdown, suggestions), `editor` (keys, rail, context menu, property
  panel, model tree, assets), `source`, `controls` (tabs, controls).
- `window.effractor` is how they talk: `state`, `select`, `applyEdit`,
  `adoptSource`, `solve`, `undo`/`redo`, `say`, `format`, `onChange`.
- Every edit goes document → `serialize` → `parse` in wasm; JS never judges a
  model. Maps keyed by node id are prototype-less.

## Known limits and loose ends

- A node id of digits only moves to the front of `nodes` on a trip through the
  editor (JavaScript orders such keys first). Forbid them in `core::id` or
  carry order explicitly.
- Via JSON, a bare `x-` string that looks typed (`2026-09-01`) comes back
  quoted; a description with line breaks is written as one quoted line.
- `fresh` ids (id derived from the first label) live in `editor.js` memory; an
  undo or a reload forgets which nodes were still unnamed.
- After an undo the results are cleared and not solved again (a control toggle
  does re-solve).
- The theme switch has three states (Light → Dark → System); with the OS in
  dark mode two of them look the same. The owner noticed once; a two-state
  toggle was offered and not asked for.
- Tab order and ARIA of the custom dropdown are basic (arrows, Enter, Esc).
- Behind a reverse proxy the share rate limit sees one address, by design.
- ELK may order a shared node's siblings differently from the document.
