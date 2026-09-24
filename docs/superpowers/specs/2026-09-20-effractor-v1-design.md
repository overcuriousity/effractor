# effractor — v1 design

Date: 2026-09-20 · Status: draft for review · Scope: v1 only

## 1. Purpose

A tool for developing and analysing production security architectures: model the
architecture, derive the attack graph, quantify risk, rank controls by risk
reduction. It is a web app. Models are text — git-versioned and diffable — and
the solver is a pure library, so a CI risk delta on a pull request stays a cheap
later addition; v1 ships no command-line analysis.

v1 delivers the analytical core on hand-built trees. Its first real user is a
university course on FTA / attack trees / securiCAD; that course is a test of
v1, not its goal.

**Core insight.** Fault trees, Schneier attack trees and MAL/securiCAD attack
graphs are one structure: an AND/OR DAG of propositions with weighted leaves.
There is one document model; a `profile` selects symbols, leaf attributes and
available analyses. v1 ships the two tree profiles. The generated attack graph
is a third profile in v2 and must need no change to the document model.

**Successor correction, 2026-09-21:** the preceding no-model-change assumption
does not hold for ordered actions with their own durations. The
[approved successor design](2026-09-21-lecture-workflow-design.md)
specifies a separate architecture document and sequential generated-graph
semantics. The tree semantics in this v1 specification remain unchanged.

**Hard constraints.** Self-hostable, local-first, no telemetry. Models never
leave the machine unless the user shares them. One implementation of the
semantics, compiled native and to wasm32.

**Deferred — not in this spec:** architecture model editor, asset/attack-step
library, generated attack graphs, infrastructure importers, auth/tenancy,
reporting.

## 2. Name

**effractor** — Latin, "one who breaks in; burglar". The tool takes the
intruder's view of an architecture: every analysis answers how, how fast, how
cheaply and how quietly someone gets in. `effractor` / `effractor-*` are
unclaimed on crates.io (checked 2026-09-20). The minimal cut set stays the
central *concept*; it is just no longer the name. The project directory may
stay `SecGraph`; nothing depends on it.

## 3. Semantics

This section is the contract. Everything else is packaging.

### 3.1 Structure

A model is a set of **nodes** with unique ids and one designated **top** node.

- **Gate**: `and`, `or`, or `vote` (k-of-n, `1 ≤ k ≤ n`), with an ordered list
  of child ids.
- **Leaf**: `basic` (circle) or `undeveloped` (diamond). Same semantics; the
  distinction is documentary and symbolic.

The children relation must form a DAG. A node may have several parents — this is
the *repeated event* and it is mandatory, not an edge case: a shared leaf is one
random variable, not one per parent. Nodes unreachable from `top` are a warning,
not an error. There is no NOT; the structure function is coherent (monotone),
which every analysis below relies on.

### 3.2 Time and probability — one quantity

Every leaf carries a **TTC** (time-to-compromise / time-to-failure): a random
variable on `[0, ∞]`. Leaves are mutually independent.

Distributions are MAL's set in effractor's spelling (amended 2026-09-23 by
the [readable time notation](2026-09-23-readable-time-notation-design.md)):
a chance `c%`, `Exponential(mean m)`, `Gamma(k, θ)`, `LogNormal(μ, σ)`,
`Pareto(xm, α)`, `TruncatedNormal(μ, σ)` (truncated at 0), `Never`,
`Immediate`, and the product form `c% * <dist>`. A document written in MAL's
spelling (`Bernoulli(p)`, rates, named shorthands) before the notation changed
still reads — shared links carry such documents — and is saved in effractor's;
an expression that is wrong in both is reported in effractor's spelling, and
the single-field parser refuses MAL's with its replacement.

`c%` alone means: time 0 with probability `c/100`, else ∞.
`c% * D` means: ∞ with probability `1 − c/100`, else a draw from `D`.
A static fault-tree probability is therefore just the chance case, and a
failure rate is an exponential — no second code path.

Node completion time: leaf = its TTC; `or` = min of children; `and` = max;
`vote(k)` = k-th smallest. All leaves start at t = 0 (parallel attacker / parallel
failure processes). Sequential-AND is out of v1.

The model declares a `time_unit` and a **horizon** `T`. "Node occurs" means
completion time ≤ T. Because the structure is monotone,
`P(top ≤ t) = φ(p₁(t), …, pₙ(t))` with `pᵢ(t)` the leaf CDF at `t` — so the
exact engine yields the exact TTC CDF by sweeping `t`.

### 3.3 Attacker attributes (attack-tree profile)

Leaves may carry `cost` (attacker cost, ≥ 0, model currency) and `detection`
(probability the step is detected, in [0, 1]). For a set `S` of leaves:
cost = Σ costᵢ (a shared leaf counted once); detection = `1 − Π(1 − dᵢ)`;
success = `Π pᵢ(T)`; time = `E[max TTCᵢ | all finite]`.

### 3.4 Controls

Controls are a section of their own, not nodes — the graph stays coherent and a
toggle is a one-line diff.

A control has `cost` (defender cost per horizon), `enabled` (the as-is state),
and `effects`: a list of `{node, ttc}` replacing a leaf's TTC while the control
is enabled (`ttc: Never` blocks the step). If two enabled controls affect the
same leaf, the effect with the lowest `pᵢ(T)` applies (ties: control id order);
validation warns about the overlap.

### 3.5 Impact

**Assets** live apart from the graph. Each has loss magnitudes split
`c` / `i` / `a`, each a number or a distribution (the set above plus
`Pert(min, mode, max)`, which FAIR calibration produces).

Any node — gate or leaf — may declare **consequences**:
`{asset, dim, fraction}` with `fraction ∈ (0, 1]`, default 1.

Per Monte Carlo iteration: sample leaf TTCs; determine which nodes occur within
`T`; collect their consequences; **deduplicate per `(asset, dim)` taking the max
fraction** (two paths to the same breach are one breach); sample each needed
magnitude once; loss = Σ magnitude × fraction. Sorted losses give the **loss
exceedance curve**.

FAIR compatibility and its limit: magnitudes and the LEC are FAIR-shaped; loss
event *frequency* is approximated as at most one occurrence per horizon. This is
stated in the UI next to the curve. A Poisson frequency model is a later
addition and needs no schema break (`horizon` semantics stay).

## 4. Analyses

`solver` is `fn solve(&Model, &Config) -> Results`: pure, no I/O, no clock, no
global state.

| Analysis | Method | Profiles |
|---|---|---|
| Minimal cut sets | BDD → minimal solutions (Rauzy), as ZBDD; order-1 flagged **SPOF** | both |
| P(top ≤ T), exact | Shannon expansion over the BDD | both |
| P(top ≤ T), sampled | Monte Carlo, Wilson interval at `confidence` | both |
| TTC CDF | exact: BDD swept over a `t` grid (64 points, 0..T); sampled: empirical CDF with pointwise Wilson band | both |
| Birnbaum importance | `P(top \| xᵢ=1) − P(top \| xᵢ=0)` on the BDD | both |
| Fussell-Vesely | by definition: `P(∪ MCS ∋ i) / P(top)`, from the ZBDD subset containing `i` — not the rare-event approximation | both |
| Cheapest-path attacker | min-cost MCS (cost per 3.3); ties broken by time, then id order | attack-tree |
| Pareto front | non-dominated MCS over (cost, time, detection), all minimised. Restricting to *minimal* sets is lossless: all three are monotone under set inclusion | attack-tree |
| Loss exceedance | Monte Carlo per 3.5; EAL, p50/p90/p95/p99, per-asset breakdown | both |
| Control ranking | see below | both |

**Control ranking.** Baseline = model as written. For each control, re-solve
with that one control flipped. Risk measure = EAL if the model has assets, else
P(top ≤ T). Report Δrisk and, for disabled controls, Δrisk / cost, ranked
descending; for enabled controls report the risk *increase* if removed. Deltas
use exact P where available and **common random numbers** (same seed) for
sampled quantities, so a delta is not noise. A sampled delta carries the
confidence interval of the *paired* per-iteration difference, so the UI can show
when two controls are too close to call at the current sample count. Ranking is
marginal, one control at a time; the UI says so, because control effects are not
additive.

**Limits, never silent.** `Config` carries `bdd_node_limit` (default 1 000 000),
`mcs_max_order` (unset), `mcs_max_sets` (default 10 000). Exceeding one yields a
result marked `truncated` / `unavailable` with the reason; sampled results are
still produced. Leaves with no TTC make quantitative results unavailable;
qualitative results (MCS, SPOF) still compute.

**Reproducibility.** RNG is ChaCha8 seeded from `Config.seed`. Samples are
partitioned into fixed chunks of 4096; chunk *n* uses stream *n*; a chunk
depends on nothing but its index, and results merge in chunk order — so output
is identical however and wherever chunks are computed. (v1 computes them on one
thread, in the browser; nothing native needs more yet.) Within a chunk every
random quantity draws from its own window of the stream, addressed by
(iteration, leaf), and loss magnitudes use a twin stream: a leaf sees the same
random numbers whatever else changes, which is what makes a control's delta the
control and not noise. All transcendental maths goes through the `libm` crate
on both targets, so native and wasm results are **bit-identical**; CI asserts
it. BDD variable order is a deterministic DFS from `top` in child order.

## 5. Document format

YAML, the stable interface v2/v3 build on. Example (the course's reference
tree):

```yaml
effractor: 1
profile: fault-tree
name: Web server unavailable
time_unit: h
horizon: 8760
currency: EUR
top: loss-of-availability

nodes:
  loss-of-availability:
    label: Loss of availability
    gate: or
    children: [no-access, no-function]
    consequences:
      - {asset: webserver, dim: a}
  no-access:
    label: Server unreachable
    gate: or
    children: [administration, network, server-outage]
  no-function:
    label: Server not working
    gate: or
    children: [hardware, software, malware, server-outage]   # repeated event
  server-outage:
    label: Server outage
    leaf: basic
    rate: 2.5e-6
  malware:
    label: Malware
    leaf: undeveloped
    p: 0.004
  # …

assets:
  webserver:
    label: Web server
    loss: {c: 20000, i: 40000, a: "Pert(60000, 120000, 400000)"}

controls:
  redundant-psu:
    label: Redundant power supply
    cost: 1800
    enabled: false
    effects:
      - {node: hardware, ttc: "Exponential(mean 2500000)"}

analysis:
  seed: 42
  samples: 10000
  confidence: 0.95
```

Rules:

- `effractor: <int>` is the schema version. `format` holds an explicit chain of
  migrations `vN → vN+1`; loading an older file migrates in memory, the next save
  writes it back upgraded. A newer-than-known version is an error.
- `nodes`, `assets`, `controls` are **maps keyed by id** (`[a-z0-9][a-z0-9-]*`):
  ids are unique by construction and adding a node is a pure insertion in a diff.
- A node has exactly one of `gate` / `leaf`. `vote` gates add `k`. A leaf has at
  most one of `p` (a probability, = `p·100%`), `rate` (a failure rate, = `Exponential(mean 1/rate)`), `ttc`
  (expression string, grammar of 3.2). Attack-tree leaves may add `cost`,
  `detection`. Every node may have `label`, `description`, `consequences`.
- **Canonical form** (every save and export from the UI): fixed key order
  within each object as listed above; entry order of the maps preserved as
  authored, new entries appended; shorthands kept as written; block style except
  short scalar lists and consequence/effect entries. Canonicalisation is idempotent.
  Defaults are written out (`time_unit`, `horizon`, `currency`, `analysis`), so
  a file says what was solved; `fraction: 1` is not. Text is bare where YAML
  reads it back as the same text and double-quoted otherwise; expressions are
  always quoted. An `x-` key follows the known keys of its map, its value on one
  line in flow style.
- Required: `effractor`, `profile`, `name`, `top`, `nodes`; a node's `label` and
  one of `gate` / `leaf`; a gate's `children`; a control's `label`, `cost`,
  `enabled`. The format is one document of maps, lists and scalars: anchors,
  aliases, tags and a second document are errors, not features.
- Comments do not survive a canonical rewrite (serde round trip). `description`
  exists so that nothing worth keeping needs to be a comment. Hand-edited files
  keep their comments until the UI first saves them.
- No layout coordinates are stored. Layout is computed; diffs stay semantic.
- Unknown keys are an error (typos must not silently drop a consequence), except
  under a reserved `x-` prefix, which round-trips untouched.

Validation returns **diagnostics** `{severity, code, message, path, line, col}`
— dangling child/asset/node references, cycles (reported with the cycle), `k`
out of range, parameters out of domain, attributes not allowed by the profile
(warning), unreachable nodes (warning), overlapping control effects (warning);
also a child listed twice in one gate, an effect that targets a gate, and a
consequence on a dimension its asset declares no loss for (all errors).

Results have their own versioned JSON schema (`effractor-results: 1`), the wasm return value and the
export format of the results panel.

## 6. Architecture

Cargo workspace; edition 2024; house stack (axum, askama, vanilla CSS + JS,
htmx where a server round trip exists).

| Crate | Responsibility | Depends on |
|---|---|---|
| `effractor-core` | Domain types: `Model`, `Node`, `Gate`, `Distribution`, `Asset`, `Control`, `Profile`, `Diagnostic`; structural validation. No I/O, no serde-format knowledge. | — |
| `effractor-mal` | Parses TTC distribution expressions into `core::Distribution`. v1 is a hand-written recursive-descent parser for exactly the grammar in 3.2, pure Rust so it compiles to wasm. tree-sitter-mal arrives with v2's full MAL parsing, behind a native-only feature. | core |
| `effractor-format` | YAML ⇄ `Model`, schema version, migrations, canonical writer, line/col diagnostics. | core, mal |
| `effractor-solver` | Everything in §4. | core |
| `effractor-wasm` | wasm-bindgen surface: `validate`, `parse`, `serialize`, `solve_begin` / `solve_step` / `solve_finish`. | core, format, solver |
| `effractor-server` | The `effractor` binary: axum app shell, embedded assets incl. the wasm bundle (rust-embed), share API, `Storage` trait + filesystem impl. Flags: `--bind`, `--data`, `--max-ttl`; nothing else. | — (never links solver) |

There is no CLI crate. `core` + `solver` + `format` still build and test natively
— that is where the test suite runs and what keeps them UI-free.

**Solving runs in the browser.** The wasm module runs in a Web Worker. Solving is
stepped (`solve_step` processes one 4096-sample chunk and returns progress) so
the UI shows progress and can cancel between chunks without threads. Exact
analyses run first and are delivered before sampling starts. The server never
sees a model except as an opaque shared blob (§8).

**Budget.** Trees up to ~500 nodes; 10 000 samples under 1 s in wasm on a
current laptop for the reference tree; first exact results under 100 ms.

## 7. UI

Docked-panel investigative workspace (Chainalysis Reactor / GraphSense idiom),
per the approved mockups:

- **Top bar**: the three modes as tabs (Fault tree · Attack tree ·
  Architecture, keys 1–3; each keeps its own working document and undo
  history in the browser), the document's name as its file menu; on the
  right horizon, analysis state (`10 000 samples · seed 42`), theme icon,
  Share, Calculate. An architecture's Architecture | Attack graph switch
  sits on the canvas, top left.
- **Tool rail** (left, 40 px): select, add, link, source, controls, results
  views.
- **Left panel**: model tree (outline of the DAG; repeated nodes appear under
  each parent, marked) and assets with C/I/A magnitudes.
- **Canvas** (centre): the graph; HUD cards for P(top) ± CI and EAL / p95.
- **Right panel**: minimal cut sets (ranked by probability, SPOF flagged) and
  selected-node stats; tabs for TTC CDF, LEC, Pareto, Controls.
- **Legend footer**: importance ramp, symbols, badges.

All numerics are monospace, right-aligned, tabular. UI language is English;
labels are user content.

### 7.1 Rendering

Custom SVG, ELK.js (`layered`, top-down, vendored, run in its own worker) for
layout. DIN 25424 fidelity in the fault-tree profile: gate boxes inscribed `&`,
`≥1`, `≥k`; basic event circle; undeveloped event diamond; event description
box above each gate. The attack-tree profile uses the same geometry with
Schneier-style labelling (AND/OR text, leaf boxes showing cost · detection). A
repeated node is drawn **once** with several incoming edges; the edges say it
is shared, so no badge repeats it (owner decision, 2026-09-22).

The renderer sits behind an interface so v2 can swap in canvas/WebGL:

```
mount(el) · render(layout, styles) · highlight(ids, kind) · fit() ·
on(event, handler)   // select, activate, context, drop
```

Everything above the interface (selection, editing, colouring decisions) speaks
node ids and style classes only, never SVG.

### 7.2 Editor interaction model

**The YAML document is the single source of truth; the canvas is a structured
editor over it, not a drawing surface.** ELK owns all positions — there is no
free dragging, so there is nothing to store and nothing to tidy.

Keyboard-first, outliner-style, on the selected node:

| Key | Action |
|---|---|
| `Tab` | add child (on a leaf: converts it to an `or` gate first) |
| `Enter` | add sibling |
| `F2` / typing | rename label (id is derived once from the first label, then stable; editable in the panel) |
| `G` | cycle gate `or → and → vote` |
| `B` / `U` | leaf kind basic / undeveloped |
| `L` | **link existing**: pick a node by search to add as a child — this is how a repeated event is made |
| `Del` | remove this edge; the node itself is deleted when its last parent edge goes (confirmed if it has attributes) |
| arrows | walk the DAG |
| `P` / `Esc` | into the property panel and back to the canvas — `Tab` is taken, and the tree must be buildable without a pointer |
| `Ctrl+Z` / `Ctrl+Shift+Z` | undo / redo (document snapshots) |

Pointer: click selects, drag a node onto a gate reparents (or links, with
`Ctrl`), context menu mirrors the keys. Attributes (TTC, cost, detection,
consequences) are edited in the right panel, with the distribution shown as a
small density sketch and its `p(T)`.

A **Source** view (tool rail) shows the YAML in a plain textarea with a
diagnostics list (click → line). Edits there re-parse on pause; while the text
is invalid the canvas keeps the last valid model and is marked stale. Canvas
edits rewrite the text canonically. Every edit path goes through
`parse → Model → serialize` in wasm; JS never interprets the model itself.

Working state persists in the browser (IndexedDB), with import/export of
`.yaml` files. Solving is automatic (owner decision, 2026-09-22): a loaded,
opened or shared document and every accepted edit are solved 300 ms after the
last change, and a newer change cancels a run still busy with the older text.
Sampling is part of the automatic run until a sampled run took more than 2 s;
after that only the exact part refreshes by itself, and Solve
(button / `Ctrl+Enter`) samples on request and opens the results. Results of an
older text stay on screen, faded, until the new ones replace them in place;
another document starts empty. Solving runs in the visitor's browser only.

### 7.3 Theme and the importance ramp

Engram's `00-tokens.css` is ported unchanged, including its two-selector
structure. Three states — light, dark, system — stored in localStorage; the
**initial state is light** (the app sets `data-theme="light"` on first load), so
the canvas is light by default as decided.

Node colour encodes **importance, not category**: leaves are filled by
Fussell-Vesely (switchable to Birnbaum); gates stay neutral. Importance is a
magnitude, so the ramp is sequential, one hue (engram's danger hue, OKLCH
h ≈ 27°), monotone in lightness, anchored to the canvas in each theme (light →
dark on light, dark → light on dark). The prior mockup's red/amber/green ramp is
replaced: it was a status palette, not monotone in lightness, and unsafe under
red-green CVD.

Bins are **fixed thresholds** — `<0.01`, `<0.05`, `<0.2`, `<0.5`, `≥0.5` — so a
colour means the same thing across models and across the two sides of a diff.

| Token | Light | label ink · ratio | Dark | label ink · ratio |
|---|---|---|---|---|
| `--viz-canvas` | `#f4f2ec` | | `#0b0d12` | |
| `--viz-outline` | `#6c6c65` · 4.72 vs canvas | | `#8185a3` · 5.38 vs canvas | |
| `--viz-imp-1` | `#ffe0db` | `#2d2d2d` · 11.11 | `#41211e` | `#e2e4ec` · 11.32 |
| `--viz-imp-2` | `#f7afa6` | `#2d2d2d` · 7.63 | `#742e29` | `#e2e4ec` · 7.64 |
| `--viz-imp-3` | `#e8796e` | `#2d2d2d` · 4.85 | `#ab3a33` | `#e2e4ec` · 4.89 |
| `--viz-imp-4` | `#c8433c` | `#ffffff` · 4.86 | `#e36c61` | `#0e1015` · 5.97 |
| `--viz-imp-5` | `#901e1c` | `#ffffff` · 8.79 | `#fdb6ad` | `#0e1015` · 11.30 |

Validated 2026-09-20: every label ink ≥ 4.5:1 on its fill (WCAG AA text);
adjacent steps ≥ 12 ΔE (OKLab × 100), lightness strictly monotone. The low steps
are deliberately close to the canvas, so **every node carries the
`--viz-outline` stroke**, which clears 3:1 against the canvas (WCAG 1.4.11) in
both themes — shape never depends on fill. Each step pairs with an ink token
(`--viz-imp-N-ink`). Unsolved / no-data nodes use `--color-bg-elevated`. Colour
is never the only channel: the value is printed in the node, SPOFs carry a
badge, and the cut-set table is the accessible equivalent. `--viz-edge` is
`#b3aa98` / `#3b4054` (decorative; highlighted edges use `--color-accent`). The
generating script and these assertions live in the repo and run in CI, so a
token edit that breaks AA fails the build.

### 7.4 Presenting Pareto results

Three objectives do not fit one honest 2-D picture, so the **table is primary**:
one row per non-dominated cut set — members, cost, E[time], detection, success
probability — sortable, monospace, the cheapest path pinned and labelled. Beside
it a **scatter with axis pickers** (any two of cost / time / detection; default
cost × time): front points in `--color-accent`, dominated cut sets as small
muted dots for context, the third attribute in the tooltip and the table. No
size or colour encoding of the third objective, and no 3-D. Selecting a row or
point highlights that cut set's leaves and edges on the canvas, and the reverse.

Charts (TTC CDF with band, LEC, scatter) are hand-rolled SVG, single series in
`--color-accent`, recessive grid, hover crosshair + tooltip, and each has a
table view.

## 8. Hosting and sharing

Hosted instance, no accounts. Sharing creates an **immutable snapshot**.

**Additional mode approved 2026-09-22: self-contained links.** Both the server
and the static GitHub Pages site can put the YAML in the link itself:
`<app-base>/#tree=v1.<base64url(gzip(UTF-8 YAML))>`. The `v1` identifies the link
encoding independently of the YAML schema version. No upload, encryption,
expiry or revocation; anyone holding the full link can recover the document.
The static site offers this mode; the server keeps encrypted server links as
the default and offers a sharing-mode picker. TTL and My shares apply only to
server links. Browser-native compression adds no dependency or third-party
origin.

Creation is capped at 8,192 URL characters and 1 MiB of UTF-8 YAML. Decoding
checks the fragment length, version, canonical base64url, gzip integrity and
UTF-8, and stops decompression above 1 MiB before parsing. Oversized links offer
YAML export or server sharing; the URL cap is an application policy, not a
guarantee that all messaging services preserve links of that length. Opening
a link uses the existing validating, undoable document replacement, then
removes the fragment by replacing history at the app base. Failure keeps the
previous document and reports why. Static links preserve the deployment's
subdirectory. Editing a local copy does not change a previously copied link.

The following storage, encryption, expiry and deletion rules apply to
**server links**:

- The browser encrypts the YAML with a fresh AES-256-GCM key (WebCrypto) and
  uploads only ciphertext. The link is `/s/{id}#{key}`; the fragment never
  reaches the server. The server cannot read shared models — "models never leave
  the machine" degrades to "ciphertext leaves the machine" on share.
- `id`: 128 random bits, base64url (22 chars), generated server-side.
- Immutable: no accounts means no ownership, so there is no update. Re-sharing
  makes a new link. Opening a link loads a local copy.
- **TTL**: chosen at share time — 1 day, 30 days, **90 days (default)**, 1 year.
  Fixed from creation, not sliding (predictable; no write on read). Operators
  set `max_ttl` and may allow `never`. A sweeper deletes expired blobs hourly and
  at startup.
- **Deletion**: the share response carries a one-time `delete_token` (128 bits);
  the server stores only its SHA-256. The browser keeps it in a local "My shares"
  list; `DELETE /api/share/{id}` with the token removes the blob immediately.
  Lose the token and the TTL is the deletion.
- Limits: 1 MiB per blob, in-memory per-IP rate limit on create. Responses carry
  `Referrer-Policy: no-referrer`, `X-Robots-Tag: noindex`, a strict CSP
  (`script-src 'self' 'wasm-unsafe-eval'`), no third-party origins at all —
  fonts, ELK and wasm are served from the binary.
- No telemetry, no analytics, no request logging of ids beyond the standard
  trace level, which is off by default for `/s/` and `/api/share/`.

API: `POST /api/share?ttl=1d|30d|90d|1y|never` (body: the ciphertext, as it is)
→ 201 `{id, delete_token, expires_at}` — `expires_at` in Unix seconds, `null`
for never; a `ttl` beyond `--max-ttl` is a 400, and without one the default is
90 days or the cap, whichever is shorter · `GET /api/share/{id}` → ciphertext,
`no-store` · `DELETE /api/share/{id}` with `Authorization: Bearer
<delete_token>` → 204, or 403 for a wrong token: whoever holds the id can fetch
the share anyway, so that gives nothing away. Creation is limited to 30 per hour
per peer address (a /64 for IPv6), as a token bucket, with `Retry-After`.

```rust
#[async_trait]
trait Storage {
    async fn put(&self, id: &ShareId, blob: Bytes, meta: ShareMeta) -> Result<()>;
    async fn get(&self, id: &ShareId) -> Result<Option<(Bytes, ShareMeta)>>;
    async fn delete(&self, id: &ShareId) -> Result<bool>;
    async fn sweep(&self, now: Timestamp) -> Result<u64>;
}
```

v1 implementation: filesystem, `data/{id[..2]}/{id}.bin` + `.meta.json`
(expiry, delete-token hash, size), atomic write via rename. The metadata is
written last and removed first — it is the commit — and `sweep` also clears what
a crash leaves behind once it is ten minutes old. Storage does not judge expiry
on `get`; the API does, so an expired share is a 404 before any sweep. Auth and Postgres
later implement the same trait.

## 9. Development process and delivery

**Roadmap.** All work is scheduled and checked through `ROADMAP.md`, which is
itself a DAG. One entry per work item:

```
### solver-bdd — BDD engine and exact P(top)
needs: core-model            cost: 3   benefit: 5
Shannon expansion, deterministic variable order, node limit. Done when the
golden models and the brute-force property test pass.
```

`needs` lists item ids (the edges); `cost` and `benefit` are 1–5; the body says
what "done" means. An item is *ready* when everything it needs is gone. Work
picks the ready item with the best benefit/cost. **Completed items are deleted**
in the same PR that completes them — the file only ever shows remaining work;
git history is the record. CI checks the file: ids unique, every `needs` target
exists, no cycles. The implementation plan for v1 is delivered as the initial
`ROADMAP.md`, not as a separate plan document.

**Branches and releases.** Work lands on `master` by PR. PR CI: fmt, clippy,
native tests, wasm build, native-vs-wasm determinism test, script tests,
token contrast script, roadmap check. **Every commit to `master` is a release**:
the release workflow builds the wasm bundle, embeds it, compiles static
`effractor` binaries (linux x86_64 + aarch64, musl), and publishes a GitHub Release
with SHA-256 sums, versioned `<Cargo version>+<short sha>`, moving `latest`.

**Dependabot, full:** `cargo`, `github-actions`, and `npm`. ELK.js and the fonts
are vendored into the binary, but pinned through a minimal `package.json` whose
only job is to let Dependabot see them; a `vendor` script copies them into
`assets/`.

**README.md** is concise: one paragraph of what it is, a screenshot, the
installer, how to run, a link to the docs. The installer is one line —
`curl -fsSL https://raw.githubusercontent.com/<owner>/effractor/master/install.sh | sh`
— which detects the architecture, downloads the latest release binary, verifies
its SHA-256 and installs to `~/.local/bin`. Then `effractor` serves the app on
localhost: self-hosted and local-first with no other moving parts.

## 10. Error handling

- `core`, `format`, `mal`, `solver` return typed errors (`thiserror`); no panics
  on user input — fuzzed. User-facing problems are diagnostics with positions,
  not error strings.
- Solver limits produce partial results with reasons (§4), never a failure of
  the whole solve.
- wasm boundary: every export returns `{ok}` / `{diagnostics}`; a panic hook
  turns a bug into a reported error and the worker is restarted.
- Server: share errors are plain status codes (404 unknown or expired —
  indistinguishable on purpose; 413; 429). Decryption failure in the browser
  reads "link incomplete or corrupted".

## 11. Testing

- **Golden models** with analytic answers: series/parallel systems, 2-of-3,
  the course's reference tree, a bridge-like DAG with repeated events where the
  naive tree evaluation is provably wrong.
- **Property tests** (proptest) on random DAGs ≤ 16 leaves: BDD P(top) equals
  brute-force enumeration; MCS are minimal, complete and each satisfies `top`;
  Birnbaum/FV match brute force; sampled CIs cover the exact value at the
  nominal rate; Pareto front has no dominated member and misses no non-dominated
  MCS.
- **Determinism**: same seed → identical `Results` across thread counts, and
  native vs wasm (run under wasmtime in CI), byte-for-byte on the results JSON.
- **Format**: `fmt` idempotence; parse ∘ serialize = id on canonical files;
  migration fixtures per schema version; diagnostics snapshot tests with
  positions.
- **Impact**: consequence deduplication (two occurring nodes, same asset/dim →
  one loss at max fraction); zero-asset models skip LEC cleanly.
- **Server**: storage trait contract tests (run against the filesystem impl,
  reusable for later impls); TTL sweep; delete-token check; size and rate
  limits.
- **UI**: pure logic under `node --test` (renderer-interface contract, editing
  operations, panel sizing, crypto); the token contrast script. Appearance and
  interaction are checked by eye — no headless-browser harness, by decision.

## 12. v1 done means

The course's reference fault tree and one attack tree can be built by keyboard in
the browser, solved locally, shared by link and deleted again; toggling a control shows its risk delta and
rank; native and wasm solves of the same file give identical numbers; and a
fresh machine gets a running instance from the README's one-line installer.
