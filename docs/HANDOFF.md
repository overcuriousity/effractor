# Handoff — 2026-09-21, evening

For the next session — whoever or whatever picks it up; everything needed is in
the repository, nothing lives in an agent's private notes. Read `CONTRIBUTING.md`, `ROADMAP.md` and the design
(`docs/superpowers/specs/2026-09-20-effractor-v1-design.md`) first; this file
says where things stand, how the owner wants the UI to be, and what bit today.

## Continuation — automatic solving (2026-09-22)

The owner asked for trees to be solved without pressing Solve and accepted the
result in the 8081 preview. `assets/js/autosolve.js` decides when: 300 ms after
a load, open, share link or accepted edit; a newer change cancels a run still
busy with the older text; runs never overlap. Sampling is automatic until a
sampled run took more than 2 s, then only the exact part refreshes and Solve
samples on request. Results of an older text stay, faded (`data-results` on
`#app`), until replaced; the wasm `solve_begin` answer now carries `leaves` so
the canvas is coloured before sampling ends. Spec §7.2 is updated. Lesson: a
browser's `setTimeout` throws when called as another object's method, Node's
does not; the app test's fake timers now throw the same way. Folded in: the
`shared · n parents` badge is gone — the incoming edges say it.

## Continuation — architecture documents (2026-09-22)

The owner reviewed the lecture implementation plan on 2026-09-22 and chose
native, in-session execution: one feature branch per task, no worktree, a
pause at each task boundary. "securiCAD parity" in the owner's words means
the lecture-workflow milestone, not the later `mal-securicad-compatibility`
import item. Task 1 (`architecture-document`) is merged (19e7791, with the
review fixes d2566e9 and cd12e4c).

What Task 1 adds, all test-first: `effractor_core::architecture` (the typed
`Architecture`, `Document::{Tree, Architecture}`, the closed vocabulary with
`states()`, `slots()` and `defense()` per kind) and `validate_architecture`;
the format's `profile: architecture` reader/writer, schema version 2 with a
v1→v2 step that changes only the version and refuses an architecture that
claims version 1; `diagnose_document`/`load_document`/`save_document`, with
`load`/`diagnose` staying tree-only and answering an architecture with an
`unsupported` diagnostic at `profile`; the new `effractor-components` crate
whose `catalog()` describes `core-components@1` (eight kinds, nine
associations, five states, eight slots, fifteen rules, limits) and holds no
numeric duration; wasm `component_catalog()` and profile dispatch for
validate/parse/serialize; a worker `catalog` request; and a narrow app guard
that keeps the current document and says `Architecture editor unavailable`
when an architecture arrives from Open, the source view or persistence
(the architecture-editor task replaces it). A fresh reviewer checked the
branch; its two important findings (a router hosting at `user` privilege was
accepted, and an oversized library version was reported as a clamped number)
are fixed with tests, along with the tree-only diagnostic on an invalid
architecture and a block-form route test.

Decisions worth knowing that the plan left open: canonical form materializes
every slot a kind carries, so every account writes `admin-login` (not only
those with a management grant); a `note` is allowed on an `unknown` slot; a
scenario naming a permission that was deleted is an `unknown-reference`
error, so a permission is removed together with the scenarios that name it;
`effractor-solver` does not yet depend on the components crate, since nothing
in Task 1 uses it there — Task 2 adds that dependency with the generator.
`effractor-components` lists `effractor-mal` and dev-depends on
`effractor-format` for Task 2's provenance and fixtures; the catalog test
uses `effractor-mal` to prove no catalog string parses as a TTC.

Fixtures: `crates/effractor-format/tests/fixtures/canonical/lecture-architecture.yaml`
is the spec §11 scenario with its illustrative inputs, canonical and complete
(no diagnostics); `empty-architecture.yaml` is the spec §3 empty document;
`migrations/v2/` holds their flow-style sources plus a copied tree. Canonical
tree fixtures, templates and the JS fixture changed only their version line;
every solver fingerprint and result snapshot is unchanged. Examples and course
files stay version 1 and migrate on load.

Local `scripts/build-wasm.sh`, `npm test` (152), `cargo test --workspace`,
`cargo fmt --all --check`, Clippy with `-D warnings` and the roadmap check
passed on the candidate tree. No UI changed beyond the guard, so there is no
walkthrough for this task; the exact-SHA CI and fast-forward release process
applies.

## Continuation — architecture editor (2026-09-23)

Task 4 (`architecture-editor`) is merged; the owner accepted it in the 8081
preview. File → New architecture opens `assets/templates/new-architecture.yaml`
(the empty spec §3 document; `?new=architecture` too). Components are added
with the rail's +, the + beside "Model", **A**, or a right-click on the empty
canvas (one type picker); the inspector edits label, note, the kind's defense
switch and parameters. A parameter is a local draft until status, TTC and
note are applied together; wasm refuses a half one and the draft stays. A
component that is still named anywhere is refused deletion with a notice until
`architecture-links` adds reference cleanup.

Structure: pure `profiles.js` (qualified selection `entity/…`, capabilities,
`treeActionAllowed`), `revisions.js` (tokens per channel), `architecture-edit.js`,
`architecture-view.js` (components as `symbol: "component"` boxes with a kind
strip; associations and flows as edges, flows dashed); DOM `architecture-ui.js`
loads after `editor.js`, which returns early for an architecture. Tree-only
chrome carries `.tree-only` and is hidden by `60-architecture.css` via
`data-profile` on `#app`. `app.js` now tokens every parse, layout and solve:
`markSourceDirty()` (called on source input) expires parses and solves but not
the committed document's layout; undo is pushed only when an edit commits; a
repeated Ctrl+Z while one is in flight is ignored; a dropped edit says so.
`app.showSourcePath(path)` (source.js, `pathLine`) opens the source at a
document path; `app.setMode` refuses `attack` until generation exists;
`state.documents` counts document replacements. A fresh reviewer's nine
findings (races, drafts, tab keys, stale titles) are fixed with tests.

## Continuation — component generation (2026-09-23)

Task 2 (`component-generation`) is merged (fa48833) and released.
`effractor-components` now has `generate` (architecture → `GeneratedGraph`),
`resolve` (durations under the baseline or one scenario) and `graph_image`
(the `effractor-graph: 1` JSON); wasm `generate(text, revision)` returns
`{ok: {revision, source, graph}}`, and `solver.generate(text, revision)` /
the worker's `generate` message carry it. No UI uses it yet (Task 6 does).

Decisions the plan left open:

- **Generation refuses an incomplete model**, not only an invalid one: any
  error or `incomplete` warning comes back instead of a graph. Nothing missing
  becomes a permissive default; relax per case if the owner wants to generate
  half-built models.
- **Ids.** Facts are `state/<kind>/<entity>/<state>` (generated states:
  `reachable`, `exploit-ready`, `material`), plus `state/flow/<flow>/connected`,
  `state/permission/<firewall>/<flow>`, `state/session/<account>/<service>`.
  Actions are `action/<rule>/<entity ids…>` (extraction by store holder and
  credential, admin login by network/account/machine); inputs are
  `input/foothold/<entity>/<state>` and `input/flow-permission/<firewall>/<flow>`.
  Ids are built from entity/flow ids, never association ids, so renaming an
  association keeps them.
- Every declared state of every entity is a fact, reached or not; a fact
  nothing produces (the isolated `admin-net` access) has no origin and no
  inputs. Logical rules are edges into Any facts, which list every producing
  rule as an origin; timed rules are All actions.
- `resolve` puts an active switch's path (or the scenario change that set it)
  next to the slot path; an unknown switch resolves to `Unknown` with no
  evidence; a policy is `Zero`/`Infinity`/`Unknown`.
- The dependency limit cannot be reached within the document's own limits;
  it is tested through a private `generate_within` with small limits. The
  node limit is tested for real with a 20×20×20 management mesh.

A fresh reviewer found no correctness bug; fixed from its report: the worker
answers a `generate` without text/revision instead of crashing the module,
origins are sorted canonically so exports ignore authoring order, the
filters association is indexed, `graph_image` refuses a mismatched
resolution. Left as is: a `permits` for a flow whose route does not cross
that firewall's router still yields unused permission nodes (the validator
does not flag it yet), and an unknown switch reports only the switch path.

Fixtures: `docs/course/lecture-architecture.yaml` follows the plan's
inventory exactly (router `bridge`, firewall `filter`, keys, admin account
granted on the router, isolated `admin-net`; scenarios `patch`, `protect`,
`both`, `deny`). It differs from the format crate's
`lecture-architecture.yaml` of Task 1 (whose login only grants `server.user`);
both stay, for their own tests. `tests/fixtures/lecture-unknown.yaml` leaves
discovery unknown. Test-first caveat: Cycle 1 went red then green, but the
generator was written whole in that cycle, so Cycles 2–3 were green on first
run; a deliberate mutation (grants used on any machine) was checked to fail
them.

Local `scripts/build-wasm.sh`, `npm test` (201), `cargo test --workspace`,
fmt, Clippy `-D warnings` and the roadmap check passed; the built wasm module
generated the lecture graph (28 nodes) under node.

## Continuation — architecture links (2026-09-23)

Task 5 (`architecture-links`) is merged after the owner's look in the 8081
preview. What exists:

- `architecture-links.js` (pure): `putAssociation`, `putFlow`, `setFoothold`,
  `setTarget`, `renameId`, `remove` (reference-safe: a delete takes along the
  associations, flows from/to/over it or needing a removed attachment, their
  permissions, attacker states and scenario changes); catalog-driven
  `linkChoices`, `addChoices`, `addLinked`, `privileges`, `nextHops`,
  `flowPermissions`, `phrase`, and the explanations `notes`, `emptyLink`,
  `emptyFlow`, `emptyHop`. Fixtures `scripts/fixtures/architecture.doc.json`
  and `catalog.json` are pinned to the real format/catalog by Rust tests.
- `architecture-links-ui.js`: the Link action (L, rail chain button, menu),
  links/flows/foothold/target in a component's form, forms for a selected
  association or flow (route hop by hop, per-router permission, connect).
  **Tab** (or the rail's + with a selection) adds a component linked to the
  selected one in one undoable edit, flows included.
- **Dragging** (owner's choice: positions in *this browser only*, per
  document name, `positions.js` over localStorage; never in the file). An
  architecture is drawn "free": stored positions over ELK's, curved edges box
  to box with arrow and label, parallel links fanned; "Arrange automatically"
  on the background menu forgets the moves. Trees keep ELK routes and
  drag-onto-to-move. The renderer interface gained `move` and `reveal`.
- The v1 spec's "the canvas never stores a position" now holds for trees only.

Known limits: positions are keyed by document name (two "Untitled" share);
an automatically placed component may land on a dragged one after an edit.

## Continuation — self-contained links (2026-09-22)

The owner approved optional self-contained sharing. Branch
`feature/self-contained-links` adds `#tree=v1.<base64url(gzip(YAML))>` links to
both hosting modes. Pages offers self-contained links; the server keeps its
encrypted links as default and adds a mode picker. Inline links upload nothing,
are not encrypted, and have no expiry or revocation. Limits are 8,192 URL
characters and 1 MiB of expanded UTF-8 YAML. The additional contract is in
the v1 spec's hosting/sharing section and README.

Opening uses the validating, undoable document replacement and detaches to the
deployment base only after success. A live navigation guard prevents a link
that finishes parsing after Back/navigation from changing the document,
persistence or undo history. The reviewer identified this race; regression
tests cover each asynchronous parse/serialize/adopt stage and normal file undo.

Local npm/workspace tests, fmt, Clippy and roadmap checks passed. The WASM build
ran, and all 13 shipped examples encoded, decoded and parsed in the real WASM
module. Code review has no remaining findings. **The owner accepted the UI and
authorized merging on 2026-09-22.** No agent drove a browser. The preview worktree
is `/tmp/effractor-self-contained-links`; static preview is
`http://127.0.0.1:8082/effractor/`, server preview is `http://127.0.0.1:8081/`.
The previews cover create/copy/open, editing and re-sharing, Ctrl+Z, and both
server modes. Follow the exact-commit CI and fast-forward release process.

## Continuation — successor scope

The owner selected the lecture workflow with a small, transparent component
library as the first successor milestone. Compatibility with existing
securiCAD/MAL models and libraries is recorded as later work in `ROADMAP.md`,
dependent on that milestone. The reference is `extract.pdf`, printed
pp. 112–134: model a client/router/SSH-server architecture, start from a
compromised workstation, generate attack routes and compare defenses.

The written successor design is now
[`2026-09-21-lecture-workflow-design.md`](superpowers/specs/2026-09-21-lecture-workflow-design.md),
**approved by the owner on 2026-09-21**. It separates the architecture/generated graph from
the existing tree model, specifies accumulated action durations and justified
cycle entry, and defines a versioned transparent component library, explicit
unknown/illustrative assumptions, defense overlays and linked views. All 23
reference pages were rendered and inspected, with detailed renders of figures
5.36 and 5.38; the page-to-requirement record is in the spec.

`successor-design` is complete: the written spec is approved and `ROADMAP.md`
contains the branch-sized implementation decomposition. The detailed
[implementation plan](superpowers/plans/2026-09-21-lecture-workflow.md) is written
and was reviewed on 2026-09-22; the owner chose native execution (see the
architecture-documents continuation above). No product code has changed; `lecture-workflow` remains
pending. The starting checkout was clean `master` at `c58d0cf`; the written-spec
review commit is signed `c2e748b`.

The owner requested that this session end after committing and pushing the plan
directly to master. Stop at that documentation checkpoint; the next step is
plan review and execution-method selection, not implementation without review.

Baseline `npm test`, `cargo test --workspace`, `cargo fmt --all --check`,
`cargo clippy --workspace --all-targets -- -D warnings` and the roadmap check
passed, and `scripts/build-wasm.sh` ran successfully. The wasip1 target is
installed but wasmtime was not on PATH; resolve the verification tool before
the sequential-simulation task. These are baseline checks, not implementation
acceptance. The lecture does not supply calibrated distributions needed for
numerical equivalence. Compatibility work remains on the roadmap and is outside
this session's implementation.

Delivery observation: the starting documentation commit's
[release run](https://github.com/overcuriousity/effractor/actions/runs/35653913216)
failed at `gate / this commit passed ci`, since release.yml requires PR CI
although documentation-only commits go straight to master. The implementation
plan records that existing mismatch; code branches still require exact-SHA CI
and a successful release. Do not describe a documentation push as a published
code release.

## Continuation — v1 acceptance

Sharing (#43), timing (#48), charts (#44), and Pareto (#46) are merged and
released in `v0.1.0+361b206`. PR #47 now records the completed release
acceptance, the course docs/files, and the reproducible wasm budget check.
The owner explicitly requested an agent-driven browser/headless-browser
walkthrough for this acceptance, overriding the earlier browser restriction
for this task. The agent ran isolated Chromium profiles against the released
binary and inspected screenshots; no owner's personal browser was driven.

Both keyboard-built trees, charts in both themes, Pareto interaction, timing
edits/undo, control deltas, encrypted sharing/local persistence/deletion,
clean-container installation, browser performance, and native/browser result
agreement passed. See `docs/V1-ACCEPTANCE.md` for exact scope and measurements.
The `v1-acceptance` roadmap item is complete. The installation check used a
fresh Alpine userspace, not a physical machine or VM.

The walkthrough found and this PR fixed two keyboard bugs: Enter on More
failed to open the disclosure, and Enter on a cut-set row could also add a
sibling. Graph shortcuts now respect controls that own the key. Both failures
were reproduced before the fix; the focused regression and full browser
walkthroughs were rerun on the corrected branch.

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

- **Examples ship as opt-in YAML files** in `assets/examples/`, per the owner's
  2026-09-21 request: twelve domain examples and a playful date-night bonus.
  The catalog is `assets/examples/README.md`. This supersedes the earlier
  no-examples decision. `/` opens the working text from IndexedDB, else an empty
  document. Shipped examples, fixtures and the spec's example are English.
- **Nothing is shown unless asked for** (owner, 2026-09-22). A first visit is
  the canvas alone: both panels closed, the HUD cards hidden until a solve. A
  solve opens the results panel; the controls tool and the source view open
  theirs; the selection shows the inspector on the canvas and nothing else.
  A panel the visitor opened stays open on that origin.
- **Left click acts, right click offers options** (owner, 2026-09-22). One
  context menu (`app.showMenu`) serves nodes, assets, controls, the theme and
  the measure button; a click on the last two cycles. Double-click renames.
  The file crumb's labelled dropdown is the one left-click menu.
- **The selected node's form is an inspector on the canvas**, *floating* over
  its right edge (owner, 2026-09-23: the docked column resized the canvas and
  made the clicked node jump). One fixed size; the HUD steps aside; a node it
  would cover is panned into view (`renderer.reveal`). Not in either panel:
  the left is the model, the right is the analysis.
- **Menus are hierarchical** (owner, 2026-09-23): an item may carry a submenu
  (`[label, key, items]`), one item is active at a time, greyed notes
  (`run` null) explain what is not offered. The right-hand column is only a key.
- **Say why, never nothing** (owner, 2026-09-23): an empty menu or list states
  what is missing and how to add it.
- **Relationships are said in plain words** from the selected component
  (*runs here as admin*, *is admin here*, *may log in*); the file's relation
  name is the tooltip. Canvas lines keep the technical `hosts · admin`.
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
