# Lecture Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Execution method awaits the owner's plan review; native execution is recommended for these closely coupled interfaces.

**Goal:** Deliver the approved architecture → generated graph → sequential simulation → defense comparison workflow and its lecture acceptance scenario.

**Architecture:** Keep the existing tree `Model` and solver intact. Add a typed `Architecture` document, a pure `effractor-components` crate for the versioned catalog/generator, and a separate event evaluator and result envelope in `effractor-solver`. Extend the existing wasm worker and quiet browser workspace through explicit profile dispatch.

**Tech Stack:** Rust edition 2024 / Rust 1.95; existing indexmap, libm, ChaCha8, serde/serde_json and wasm-bindgen; vanilla JS/CSS and vendored ELK; existing axum/askama server/static export. No new third-party runtime dependency is needed.

**Spec:** [2026-09-21-lecture-workflow-design.md](../specs/2026-09-21-lecture-workflow-design.md), approved by the owner on 2026-09-21. This plan is awaiting review. Approval of the spec does not yet authorize starting this plan's implementation.

## Global Constraints

These quoted requirements are from the approved spec and apply to every task:

- “The existing fault-tree and attack-tree profiles retain their meanings, solver results, random streams and frozen fingerprints.”
- “All modelling, generation and solving run locally in the browser through pure Rust compiled to wasm.”
- “No remote knowledge base, telemetry, third-party origin or execution of model code is introduced.”
- “A new user still receives an empty document; the lecture architecture and illustrative numbers live only in documentation and fixtures.”
- “Unknown keys remain errors except round-tripped `x-` extensions.”
- “No recursion on document-sized input and no epsilon-based cycle breaking.”
- “Use the existing ChaCha8 convention: 4096-sample chunks, stream = chunk index, seed from the document, merge in chunk order, and libm for transcendental maths.”
- “No native select/datalist, confirm dialogs, onboarding wall or vendor names in product copy.”
- “The owner performs UI acceptance; agents provide short numbered walkthroughs and do not drive a browser.”

Retain monospace, right-aligned numerics and the existing theme tokens. Limits
are 500 entities, 2,000 associations plus flows, 5,000 generated nodes, 20,000
dependencies, 100,000 samples and 16 stored scenarios. Render at most 500 nodes
at once without changing the solved graph. `mal-securicad-compatibility` is
explicitly outside this plan.

## Review Focus

Five failure classes that need explicit regression coverage:

1. An unknown input on a blocked route must not suppress a known target; an
   unknown feasible alternative must suppress the target CDF. Owned by Task 3.
2. A result or layout arriving after invalid source, undo, a target change or
   opening another document must not overwrite current state. Owned by Task 4.
3. Deleting or renaming a component must update typed references, scenarios and
   selection atomically; integer-like/prototype-like IDs must not corrupt maps.
   Owned by Tasks 1, 4 and 5.
4. Switching profiles while a tree panel/control has focus must not invoke tree
   editing or show exact/MCS/loss results for an architecture. Owned by Tasks 4–6.
5. A permission/defense toggle must preserve step identities and random slots;
   user-authored defenses that worsen an outcome must report a negative benefit.
   Owned by Tasks 2, 3 and 7.

## Execution order and boundaries

Each numbered task is one roadmap item and one code branch/PR. Test cycles
within a task are sequential. A task's branch is based on the latest delivered
master; do not start dependent implementation on an unreviewed interface.

| Task / branch | Depends on | Reviewable deliverable |
|---|---|---|
| 1. `architecture-document` | Approved spec and plan | Typed format, validation, catalog and profile-aware wasm parsing. |
| 2. `component-generation` | 1 | Stable generated graph, provenance, generation API and fixtures. |
| 3. `sequential-simulation` | 2 | Correct graph timing, quantitative results, comparisons and wasm agreement. |
| 4. `architecture-editor` | 1 | Empty architecture, component/parameter editing, persistence and undo. |
| 5. `architecture-links` | 4 | Relationships, flows and attacker configuration. |
| 6. `attack-graph-inspection` | 3, 5 | Linked graph views, source tracing and simulation results. |
| 7. `defense-comparison` | 6 | Named scenarios, overlaid CDFs and remaining routes. |
| 8. `lecture-workflow` | 7 | Final acceptance evidence, documentation and released delivery. |

Use the sequence above. Backend work gets a stable numerical contract before
the UI depends on it. The plan's eight tasks form one dependent workflow, not
independent products requiring new scope decisions.

## File and interface map

Keep each responsibility in the following files. Do not put the new evaluator
inside `plan.rs` or make `NodeKind::Leaf` acquire prerequisites.

| Location | Responsibility |
|---|---|
| `crates/effractor-core/src/architecture.rs` | Architecture domain types and `Document` enum. |
| `crates/effractor-core/src/architecture_validate.rs` | Typed references, cardinality, incomplete-state warnings and limits. |
| `crates/effractor-format/src/architecture_read.rs`, `architecture_write.rs` | Positioned lowering and canonical architecture writing. |
| `crates/effractor-components/src/catalog.rs` | `core-components@1` metadata and rule descriptions. |
| `crates/effractor-components/src/graph.rs`, `generate.rs` | Derived graph types and rule instantiation. |
| `crates/effractor-components/src/resolve.rs`, `export.rs` | Scenario/parameter resolution and graph/provenance JSON. |
| `crates/effractor-solver/src/graph_plan.rs` | Event queue, timing and witness construction. |
| `crates/effractor-solver/src/graph_support.rs` | Possible/blocked/unknown target support. |
| `crates/effractor-solver/src/graph_mc.rs`, `graph_results.rs` | Chunk sampling, paired aggregation, result types and stepped solves. |
| `crates/effractor-wasm/src/graph_api.rs` | Generation/export wrappers and graph session begin. |
| `assets/js/profiles.js`, `revisions.js` | Pure profile capabilities and asynchronous result acceptance. |
| `assets/js/architecture-edit.js`, `architecture-view.js`, `architecture-ui.js` | Pure edits/view descriptions and DOM component editor. |
| `assets/js/architecture-links.js`, `architecture-links-ui.js` | Pure relationship edits/reference maintenance and their controls. |
| `assets/js/attack-view.js`, `attack-ui.js`, `graph-results.js` | Generated graph focus/provenance, DOM inspection and result presentation data. |
| `assets/js/comparison.js`, `comparison-ui.js` | Scenario editing/presentation and comparison controls/charts. |

Existing `app.js` continues to own text, parsed document, undo history,
persistence, worker requests and notices. Renderer and layout remain shared.
DOM modules subscribe to app changes and return pure document edits through
`app.applyEdit`; JS does not duplicate Rust generation or validation.

### Domain contracts established by Task 1

Add public types under `effractor_core::architecture` and re-export `Document`.
Use existing `Analysis`, `TimeUnit`, `Distribution` and `Diagnostic`.

```rust
pub enum Document { Tree(Model), Architecture(Architecture) }
pub struct Architecture {
    pub name: String,
    pub time_unit: TimeUnit,
    pub horizon: f64,
    pub library: LibraryPin,
    pub entities: IndexMap<EntityId, Entity>,
    pub associations: IndexMap<AssociationId, Association>,
    pub flows: IndexMap<FlowId, Flow>,
    pub attacker: Attacker,
    pub scenarios: IndexMap<ScenarioId, Scenario>,
    pub analysis: Analysis,
}
pub struct LibraryPin { pub id: String, pub version: u32 }
pub enum EntityKind { Network, Router, Firewall, Host, Application, Service, Account, Credential }
pub enum Privilege { User, Admin }
pub enum State { Access, User, Admin, Control, Possessed }
pub struct StateRef { pub entity: EntityId, pub state: State }
pub struct Attacker { pub footholds: Vec<StateRef>, pub target: Option<StateRef> }
pub enum Switch { Unknown, On, Off }
pub enum Evidence { Unknown, Illustrative, Assumed, Calibrated }
pub enum Slot { Connect, FindExploit, FindExploitPatched, DeployExploit, Login, Extract, ExtractProtected, AdminLogin }
pub struct Parameter { pub status: Evidence, pub ttc: Option<Distribution>, pub note: Option<String> }
pub struct Defenses { pub patched: Option<Switch>, pub protected: Option<Switch> }
pub struct Entity {
    pub kind: EntityKind,
    pub label: String,
    pub description: Option<String>,
    pub parameters: IndexMap<Slot, Parameter>,
    pub defenses: Defenses,
}
pub struct Association { pub relation: Relation, pub description: Option<String> }
pub enum Relation {
    Attached { from: EntityId, to: EntityId },
    Hosts { from: EntityId, to: EntityId, privilege: Privilege },
    Filters { from: EntityId, to: EntityId },
    Stores { from: EntityId, to: EntityId, privilege: Privilege },
    Authenticates { from: EntityId, to: EntityId },
    Authorizes { from: EntityId, to: EntityId },
    Grants { from: EntityId, to: EntityId, privilege: Privilege },
    Administration { from: EntityId, to: EntityId },
    Permits { from: EntityId, to: FlowId, allowed: Switch },
}
pub struct Flow {
    pub label: String,
    pub source: EntityId,
    pub target: EntityId,
    pub route: Vec<EntityId>,
    pub protocol: Option<String>,
    pub connect: Parameter,
}
pub enum Defense { Patched, Protected }
pub enum Change {
    EntityDefense { entity: EntityId, defense: Defense, value: Switch },
    Permission { association: AssociationId, value: Switch },
}
pub struct Scenario { pub label: String, pub changes: Vec<Change> }
pub fn validate_architecture(model: &Architecture) -> Vec<Diagnostic>;
```

`EntityId`, `AssociationId`, `FlowId`, `ScenarioId` are new `FromStr` ID types
with `as_str`, Display, Eq, Ord and Hash. Reuse the existing grammar plus a
non-digit requirement for these new types only. The domain has no serde/I/O.
`Slot` and `EntityKind` expose `as_str()` for their kebab-case source spelling.
Derive Debug/Clone/PartialEq as needed; do not compare distributions with Eq.

## Task 1: Architecture documents and catalog

**Files:** Create the Task 1 files in the map, `crates/effractor-components/{Cargo.toml,src/lib.rs,src/catalog.rs}`, `crates/effractor-core/tests/architecture.rs`, `crates/effractor-format/tests/architecture.rs`, and `crates/effractor-format/tests/fixtures/migrations/v2/empty-architecture.yaml`. Modify core `lib.rs`, `id.rs`, `diagnostic.rs`; format `lib.rs`, `lower.rs`, `write.rs`, `migrate.rs`; wasm `api.rs`, `lib.rs`, `Cargo.toml`, tests `api.rs`; canonical format fixtures and schema-version assertions; `Cargo.lock`; `assets/js/{app.js,solver.js,solver-worker.js}` and their script tests. Add `tests/fixtures/canonical/empty-architecture.yaml` in the format crate.

**Interfaces:** Consume the domain contract above. Add to `effractor-format`:

```rust
pub fn diagnose_document(text: &str) -> (Option<Document>, Vec<Diagnostic>);
pub fn load_document(text: &str) -> Result<Document, Vec<Diagnostic>>;
pub fn save_document(document: &Document) -> String;
```

Keep `load`, `diagnose` and `save` as tree-only compatibility functions. Existing
`canonicalize`, `document` and `from_document` dispatch both profiles. Add
`effractor_components::catalog() -> serde_json::Value` and wasm
`component_catalog() -> String`, using the existing `{ok, diagnostics}` envelope.
Core validates the exact built-in pin `core-components@1`; components consumes
the same public pin constants so the domain does not depend on the generator.
The new components crate uses the workspace package/lint settings and depends
on core, mal (for canonical TTC text) and the already-used serde_json version.
Its generation tests add format as a dev-dependency. Solver adds components
as a normal dependency and format as a dev-dependency for the shared fixture.
Keep format's normal dependencies on core/mal; it must not depend on components.

- [ ] **Cycle 1 — reproduce missing schema support.** Add an inline empty
  architecture source using the complete empty document in spec §3. Assert:

  ```rust
  use effractor_core::Document;
  use effractor_format::{canonicalize, document, from_document, load_document};
  let source = include_str!("fixtures/migrations/v2/empty-architecture.yaml");
  assert!(matches!(load_document(source).unwrap(), Document::Architecture(_)));
  let canonical = canonicalize(source).unwrap();
  assert_eq!(canonicalize(&canonical).unwrap(), canonical);
  let (image, diagnostics) = document(&canonical);
  assert!(!diagnostics.iter().any(|d| d.severity == effractor_core::Severity::Error));
  assert_eq!(from_document(&image.unwrap()).unwrap(), canonical);
  ```

  Run `cargo test -p effractor-format --test architecture`; first expect the
  missing API/schema failure. Implement domain types and profile dispatch, then
  rerun the same test. Add `Code::{Incomplete, UnknownReference, AssociationType,
  Cardinality, InvalidRoute, UnknownState, UnknownLibrary, ConflictingChange,
  Limit}` with stable kebab-case strings, keeping every old diagnostic intact.

- [ ] **Cycle 2 — migration boundary.** Before migration, reject architecture
  fields/profile in schema 1. Add the single v1→v2 step and preserve original
  migration/v1 fixtures. Change only version lines in current canonical tree
  fixtures and their JSON expectations; keep result snapshots untouched.

  ```rust
  let old = include_str!("fixtures/migrations/v1/webserver.yaml");
  let migrated = effractor_format::canonicalize(old).unwrap();
  assert!(migrated.starts_with("effractor: 2\n"));
  assert_eq!(effractor_format::load(old).unwrap(), effractor_format::load(&migrated).unwrap());
  let architecture_v1 = source.replacen("effractor: 2", "effractor: 1", 1);
  assert!(load_document(&architecture_v1).is_err());
  assert!(effractor_format::load(source).is_err());
  ```

  Run the format migration/json/roundtrip tests red then green. Add a v2 tree
  migration fixture because the existing migration test visits every version.
  Run `cargo test -p effractor-solver` to prove existing numerical snapshots stay.

- [ ] **Cycle 3 — strict validation and partial authoring.** Use JSON images of
  the empty fixture to insert entities and associations; Rust remains the
  validation authority. Cover all nine endpoint combinations from spec §4
  (including wrong combinations), duplicated semantic associations, conflicting
  switches, malformed routes, wrong privilege and future library/schema versions.
  Include `constructor` as a valid source ID and `123` as an invalid new ID;
  an existing tree node `123` stays legal. A lone unhosted service returns a
  model with `incomplete` warnings, while a dangling `hosts.to` returns an error.

  ```rust
  let (image, _) = document(source);
  let mut image = image.unwrap();
  image["entities"]["sshd"] = serde_json::json!({"kind":"service", "label":"SSH"});
  let text = from_document(&image).unwrap();
  assert!(text.contains("status: unknown"));
  image["associations"]["bad"] = serde_json::json!({
      "kind":"hosts", "from":"absent", "to":"sshd", "privilege":"admin"
  });
  let errors = from_document(&image).unwrap_err();
  assert!(errors.iter().any(|d| d.path == "associations.bad.from"));
  ```

  Require nonempty notes for supplied TTCs; unknown cannot carry TTC; canonical
  writing materializes applicable missing slots and switches as unknown. Only
  relevant optional fields are written. Test `x-` at every new map/list-record
  level, source positions, large seed strings and cap boundaries. Implement in
  focused lower/writer modules using the existing positioned YAML tree, not an
  independent serde YAML parser. Share small parsing/writing primitives only
  where required; do not restructure the tree solver or change its schema rules.

- [ ] **Cycle 4 — catalog and wasm.** Catalog JSON has `library`, `entities`,
  `associations`, `states`, `parameters`, `rules` and `limits`; each rule lists
  stable ID/version, bindings, prerequisite/output descriptions and assumptions.
  Test that all eight kinds and all spec §6 rule IDs appear once, and no numeric
  TTC default appears. Make wasm validate/parse/serialize dispatch documents.
  Add a worker `catalog` request. Run `cargo test -p effractor-core -p
  effractor-format -p effractor-components -p effractor-wasm`, then the delivery
  checks below. No New Architecture menu is exposed until Task 4. Until its
  renderer exists, add a temporary app precondition before accepting/persisting
  an architecture from Open or Source: retain the current document and report
  `Architecture editor unavailable`. Regression-test both entry points with
  resolved parse promises; this prevents a released backend-only branch from
  crashing the old UI on `doc.nodes`. Task 4 replaces this narrow guard.

- [ ] **Deliver:** remove `architecture-document`, update handoff, and use the
  signed branch/PR procedure below. Commit title: `Add typed architecture documents and component catalog`.

## Task 2: Component rules, fixtures and provenance

**Files:** Create components `graph.rs`, `generate.rs`, `resolve.rs`, `export.rs`,
`tests/generation.rs`, `tests/provenance.rs`, `tests/fixtures/lecture-unknown.yaml`;
`docs/course/lecture-architecture.yaml`; wasm `graph_api.rs`. Modify components
`lib.rs`, `Cargo.toml`; wasm `api.rs`, `lib.rs`, `Cargo.toml`, `tests/api.rs`;
`assets/js/solver.js`, `solver-worker.js` and their existing script tests.
The components test dev-dependency may use format; format must not depend on
components, avoiding a crate cycle.

**Interfaces:**

```rust
pub struct GeneratedGraph {
    pub library: LibraryPin,
    pub semantics: &'static str, // sequential-1
    pub nodes: Vec<GeneratedNode>, // sorted by ID bytes
    pub target: usize,
}
pub struct GeneratedNode {
    pub id: String,
    pub label: String,
    pub kind: GeneratedKind,
    pub duration: Binding,
    pub origins: Vec<Origin>,
}
pub enum GeneratedKind { Input, Any { inputs: Vec<usize> }, All { inputs: Vec<usize> } }
pub enum Owner { Entity(EntityId), Flow(FlowId) }
pub enum Binding {
    Logical,
    Foothold(StateRef),
    Permission(AssociationId),
    Parameter { owner: Owner, base: Slot, replacement: Option<(Defense, Slot)> },
}
pub struct Origin {
    pub rule: String,
    pub version: u32,
    pub entities: Vec<EntityId>,
    pub associations: Vec<AssociationId>,
    pub flows: Vec<FlowId>,
    pub paths: Vec<String>,
    pub assumptions: Vec<String>,
}
pub enum ResolvedTtc { Known(Distribution), Unknown(Vec<String>) }
pub struct ResolvedGraph {
    pub ttc: Vec<ResolvedTtc>,
    pub evidence: Vec<Vec<Parameter>>, // aligned with nodes, active evidence only
    pub paths: Vec<Vec<String>>,      // exact active source fields
}
pub fn generate(model: &Architecture) -> Result<GeneratedGraph, Vec<Diagnostic>>;
pub fn resolve(model: &Architecture, graph: &GeneratedGraph,
               scenario: Option<&ScenarioId>) -> Result<ResolvedGraph, Vec<Diagnostic>>;
pub fn graph_image(graph: &GeneratedGraph, resolved: &ResolvedGraph) -> serde_json::Value;
```

These live in `effractor-components`; graph construction normalizes duplicate
producers/inputs, sorts once, and resolves IDs to indices only after expansion.
`Input` is exclusively a declared foothold or policy constant. Non-input
logical states use Any, timed actions use All; ALL never has zero inputs.
Each entry's `duration` is interpreted only in the relevant kind; an Any fact
always has `Logical`. All provenance bindings survive normalization.

Wasm `generate(text: &str, revision: &str) -> String` returns `{ok: {revision,
source, graph}, diagnostics}`. `source` is the exact input snapshot; graph JSON
has `effractor-graph: 1`, `library: {id,version}`, `semantics`, target ID and
`nodes`. Each node has `id`, `label`, `kind` (`input`/`any`/`all`), `inputs`
(prerequisite IDs), `origins` and `timing` with status/expression/note/source paths.
`revision` is an
opaque caller token; it is not a digest or generated identity. The JS promise
API is `solver.generate(text, revision)`.

- [ ] **Cycle 1 — establish the lecture fixture.** Create the fixture exactly
  from the inventory below and the eight illustrative TTCs in spec §11. Store
  the fixture only under docs; tests load it with `include_str!`.

  | IDs | Kind / relationship |
  |---|---|
  | `client-net`, `server-net`, `admin-net` | networks |
  | `bridge`, `filter`, `workstation`, `server`, `ssh-client`, `sshd` | router, firewall, two hosts, application, service |
  | `server-account`, `admin-account`, `server-key`, `admin-key` | two accounts, two credentials |
  | `workstation-net`, `server-net-link`, `bridge-client`, `bridge-server` | attached pairs, respectively workstation/client-net, server/server-net, bridge/client-net, bridge/server-net |
  | `client-hosting`, `service-hosting` | workstation→ssh-client user; server→sshd admin |
  | `bridge-filter`, `manage-bridge` | filters bridge→filter; administration admin-net→bridge |
  | `server-key-store`, `admin-key-store` | stores workstation→server-key user; workstation→admin-key admin |
  | `server-auth`, `admin-auth` | authenticates each key→its account |
  | `ssh-authorizes`, `server-grant`, `router-grant` | server-account→sshd; server-account→server admin; admin-account→bridge admin |
  | `ssh`, `allow-ssh` | flow ssh-client→sshd via client-net/bridge/server-net; permits filter→ssh true |

  Baseline patching/protection switches are false. Attacker foothold is
  workstation.admin; target server.admin. Add scenarios `patch`, `protect`,
  `both`, `deny` with the corresponding typed changes. All TTCs carry
  `status: illustrative` and the note from spec §11; router admin login has its
  account slot. The admin key alone cannot cross isolated admin-net. The
  unknown fixture removes the service discovery TTC and marks that slot unknown.
  The deployment note explicitly records that the duration includes assumed
  IDS/antimalware bypass; it does not claim those mechanisms are separately modelled.

  ```rust
  use effractor_core::Document;
  use effractor_components::{generate, resolve};
  let Document::Architecture(model) = effractor_format::load_document(
      include_str!("../../../docs/course/lecture-architecture.yaml")
  ).unwrap() else { panic!("architecture fixture") };
  let graph = generate(&model).unwrap();
  assert!(graph.nodes.iter().any(|n| n.id == "action/service-login/server-account/sshd"));
  assert!(graph.nodes.iter().any(|n| n.id == "action/service-deploy-exploit/sshd"));
  assert_eq!(graph.nodes[graph.target].id, "state/host/server/admin");
  assert_eq!(resolve(&model, &graph, None).unwrap().ttc.len(), graph.nodes.len());
  ```

  Run `cargo test -p effractor-components --test generation` red before adding
  generation. Implement rule groups in spec-table order: seed/privilege/hosting,
  network/permission/connection, exploit, credential/session/management. Use
  indexed bindings rather than an unbounded Cartesian product of every entity.

- [ ] **Cycle 2 — meaningful rule assertions.** For each rule assert its exact
  prerequisite IDs and output, not only node counts. Verify a login requires
  both reachability and credential material, a grant targets the hosting device,
  user hosting cannot create host.admin, router execution is admin-only, and
  network.access creates no implicit flow. Mutate one fixture relationship at
  a time to prove a route is removed/diagnosed. Use duplicate-store and
  shared-service fixtures to distinguish per-store extraction from per-service
  discovery and per-account/service login. A host/application dependency cycle
  must generate a finite set of stable IDs.

- [ ] **Cycle 3 — identity, resolution and limits.** Reverse every authored
  map, change labels, and toggle each scenario. Assert node IDs and prerequisite
  ID sets remain identical; assert only intended resolved paths/TTCs change.
  For `patch`, discovery resolves to Infinity while login resolves unchanged;
  for `deny`, the permission input is Infinity but its router.admin alternative
  remains. Missing active replacement distributions resolve to `Unknown`.
  Validate every provenance source path against the source image and assert
  catalog rule/version coverage. Check limits during insertion, before large
  vectors are allocated, and return no graph on overflow.

- [ ] **Cycle 4 — wasm generation transport.** Test `generate` with the exact
  fixture and an opaque revision, then edit/serialize/regenerate and check
  source/provenance. Add `catalog` and `generate` message branches to the worker
  with explicit argument handling; do not pass a tree solve through generation.
  Run `cargo test -p effractor-components -p effractor-wasm` and
  `node --test scripts/solver.test.js scripts/solver-worker.test.js` red/green.

- [ ] **Deliver:** remove `component-generation`, update handoff and run the
  delivery procedure. Commit title: `Generate traceable attack graphs from architecture components`.

## Task 3: Sequential simulation and comparison backend

**Files:** Create the five graph solver modules in the map plus
`tests/graph_timing.rs`, `tests/graph_support.rs`, `tests/graph_solve.rs`,
`tests/graph_determinism.rs`, `tests/snapshots/lecture-graph.json` in the solver
crate; wasm `examples/graph-agreement.rs`; `scripts/check-graph-agreement.js`.
Modify solver `lib.rs`, `Cargo.toml`; wasm `api.rs`, `graph_api.rs`, `lib.rs`,
`tests/api.rs`; worker/client solve dispatch and their tests; `.github/workflows/ci.yml`.
Do not alter tree `plan.rs`, `scenario.rs`, sampler ordering or existing snapshots.

**Interfaces:** `EventPlan` and `GraphSolve` are opaque public structs. Their
private storage is owned respectively by the event evaluator and stepped solve;
the following signatures define their external contract.

```rust
pub enum GraphOp { Input, Any(Vec<usize>), All(Vec<usize>) }
impl EventPlan {
    pub fn new(operations: Vec<GraphOp>) -> Result<Self, Vec<Diagnostic>>;
    pub fn times(&self, durations: &[f64]) -> Result<Vec<f64>, Vec<Diagnostic>>;
}
pub struct GraphConfig { pub seed: u64, pub samples: u64, pub confidence: f64 }
impl GraphConfig { pub fn from_model(model: &Architecture) -> Self; }
impl GraphSolve {
    pub fn begin(model: &Architecture, graph: &GeneratedGraph,
        scenario: Option<&ScenarioId>, config: &GraphConfig) -> Result<Self, Vec<Diagnostic>>;
    pub fn step(&mut self) -> Progress;
    pub fn progress(&self) -> Progress;
    pub fn finish(self) -> GraphResults;
}
```

`Progress` is the existing solver type, still measured in chunks. Public timing
convenience allocates output; the sampler uses the same internal evaluator with
reused queue/scratch buffers. Verify the graph's arity, bounds and duplicate
inputs in `EventPlan::new`. Validate vector length, nonnegative durations and
NaN before evaluation; infinity is valid. IDs have already been sorted by the
generator, so index order is the deterministic tie breaker.

`GraphResults` serializes these exact top-level fields:

| Field | JSON contract |
|---|---|
| `effractor-graph-results`, `semantics` | `1`, `"sequential-1"` |
| `library` | `{id,version}` copied from the supported pin |
| `target`, `time_unit`, `horizon` | Generated target ID, source unit, finite positive horizon |
| `seed`, `samples`, `confidence` | Requested analysis settings; seed stays a decimal string above JavaScript's safe integer range |
| `baseline`, `scenario` | A ScenarioReport each; scenario is null when only baseline was requested |
| `delta` | Outcome of `{mean,ci}`; unavailable when no comparison or either target lacks numbers |

ScenarioReport has `id` (null for baseline), `outcome`, `nodes`, `assumptions`
and `witness`. An Outcome serializes `{available: value}` or
`{unavailable: {reason,missing}}`, where missing is a sorted list of source paths.
Available target statistics are `{method,samples,confidence,p_target,ci,ttc_cdf}`;
method is `sampled` or `structural`, ci is `{lo,hi}`, and ttc_cdf has 65
`[t,p,lo,hi]` rows. Structurally seeded/unreachable targets need no draws and
have degenerate bands at 1/0; record `samples: 0` for that proof, not a fabricated
Monte Carlo count. Each node report has `id`, qualitative status
(`seeded`/`possible`/`blocked`/`unreachable`) and a quantitative Outcome of
`{p,ci}`, its horizon probability and Wilson band. An unknown feasible action is possible qualitatively
and unavailable quantitatively. Assumptions list active source paths, status,
expression and note. Witness is null or `{sample,target_time,nodes,edges}`;
nodes have finite completion times and edges have prerequisite/dependent IDs.
Delta ci is null with an interval reason when fewer than two paired samples exist.

The pure `graph_support::analyze(graph: &GeneratedGraph, resolved: &ResolvedGraph)`
returns a `GraphSupport` with node-aligned qualitative statuses, missing-path
lists, guaranteed-zero flags and the target's support indices. It never reads
a sampled probability. Task 6 adds this report to generation responses as
`support` using the same serializer as ScenarioReport nodes' qualitative fields.

Wasm finishes a graph solve with `{ok: {revision,source,result: GraphResults},
diagnostics}`. The app stores the inner result as state.results; tree finish
payloads remain unchanged. Native/backend result DTOs own their serializable
strings/scalars, so core types need not acquire serde dependencies.

Keep `Session::begin(text)` tree-compatible and dispatch an architecture to a
baseline graph solve. Add `Session::begin_graph(text, scenario, revision)` and
wasm `solve_graph_begin(text: &str, scenario: &str, revision: &str)`; empty
scenario string means baseline, not an invented scenario ID. Session stores
an enum Tree/Graph and shares step/finish/cancel. Worker `solve` accepts optional
`scenario` and `revision`; architecture begin sends `begun` to `onBegin`, while
trees retain `exact` to `onExact`. No graph result masquerades as exact.

- [ ] **Cycle 1 — ordered time and cycle oracles.** Add these tests before the
  evaluator. Run `cargo test -p effractor-solver --test graph_timing` red.

  ```rust
  use effractor_solver::graph_plan::{EventPlan, GraphOp::*};
  let chain = EventPlan::new(vec![Input, All(vec![0]), All(vec![1])]).unwrap();
  assert_eq!(chain.times(&[0.0, 2.0, 3.0]).unwrap(), vec![0.0, 2.0, 5.0]);
  let join = EventPlan::new(vec![Input, Input, All(vec![0, 1])]).unwrap();
  assert_eq!(join.times(&[2.0, 7.0, 3.0]).unwrap()[2], 10.0);
  let closed = EventPlan::new(vec![All(vec![1]), All(vec![0])]).unwrap();
  assert!(closed.times(&[0.0, 0.0]).unwrap().iter().all(|t| t.is_infinite()));
  let entered = EventPlan::new(vec![Input, Any(vec![0, 2]), All(vec![1])]).unwrap();
  assert_eq!(entered.times(&[0.0, 0.0, 3.0]).unwrap(), vec![0.0, 0.0, 3.0]);
  assert!(EventPlan::new(vec![All(vec![])]).is_err());
  assert!(chain.times(&[0.0, f64::NAN, 1.0]).is_err());
  ```

  Implement a min event queue using total float ordering and node index. Inputs
  enqueue their finite duration; an Any node enqueues once its first producer
  finalizes; an All node waits for its distinct prerequisites then adds its
  duration to their maximum. Finalized nodes never reopen. Record the accepted
  Any predecessor and All input set; witnesses only reference earlier finalized
  nodes. Infinity is not enqueued. Test overflow-to-infinity, competing routes,
  shared actions, positive/zero cycles, and a 5,000-node chain without recursion.

- [ ] **Cycle 2 — unknowns and support.** Before sampling, compute possible
  reachability with unknown actions provisionally possible and impossible TTCs
  blocked. Recognize Infinity, Bernoulli(0), Product(0, D), named Enabled and
  products whose inner duration is impossible; do not inspect only literal
  expression text. Backward target support visits only possible producer
  branches and all required AND inputs. Propagate a guaranteed-zero closure
  from footholds, allowed policy inputs and known-zero logical/actions; an Any
  needs one guaranteed-zero input and an All needs all of them plus zero duration.
  Stop backward traversal at those facts because an unknown alternative cannot
  improve their time below zero. An unknown inside a
  retained feasible support branch gives an unavailable numeric outcome with
  source paths, while still returning the qualitative graph.

  Test the unknown fixture, then apply `deny`: target becomes unreachable/zero,
  not unknown. Add a hosted unquantified service on another host and a separate
  permitted flow from the SSH client to it: the original known target still
  solves and the new reachable service's step probabilities remain unavailable. Seed the
  target: probability is one at zero. Cover an unknown policy with a reachable
  management alternative and show the unresolved branch explicitly. Per-node
  status is computed for its own support, not copied from the selected target.
  Do not emit numbers produced by substituting a value for an unknown input.

- [ ] **Cycle 3 — simulation and statistical oracle.** Reuse `dist::sample`,
  `dist::chunk_rng`, `mc::wilson` and `special::phi_inv`; these already use libm.
  Slot = index in the complete sorted potential graph; set the RNG word
  position to `256 * (iteration_in_chunk * node_count + slot)` before each
  sampled action. Reserve slots for logical/blocked nodes. Use a separate
  scratch duration vector per resolved scenario and identical window addresses.
  Keep only counters and the first successful witness by global sample index,
  not a samples×nodes matrix. Chunk aggregation order is fixed.

  ```rust
  use effractor_core::Distribution;
  use effractor_solver::dist::{chunk_rng, sample};
  use effractor_solver::graph_plan::{EventPlan, GraphOp::*};
  let plan = EventPlan::new(vec![Input, All(vec![0]), All(vec![1])]).unwrap();
  let n = 100_000_u64;
  let mut hits = 0_u64;
  let t = 2.0;
  for chunk in 0..n.div_ceil(4096) {
      let mut rng = chunk_rng(42, chunk);
      for iteration in 0..(n - chunk * 4096).min(4096) {
          let mut durations = [0.0; 3];
          for slot in 1..3 {
              rng.set_word_pos(256 * (u128::from(iteration) * 3 + slot as u128));
              durations[slot] = sample(&Distribution::Exponential(1.0), &mut rng);
          }
          hits += u64::from(plan.times(&durations).unwrap()[2] <= t);
      }
  }
  let observed = hits as f64 / n as f64;
  let expected = 1.0 - libm::exp(-t) * (1.0 + t);
  assert!((observed - expected).abs() < 0.008);
  ```

  In the same test file retain a tree AND oracle `(1-exp(-t))²` and assert it
  differs from the chain oracle. Test all CDF endpoints, permanent failures,
  sample counts 1/4095/4096/4097, reversed chunk execution with ordered merge,
  huge finite horizon and cancellation. Compute grid times as
  `horizon * (j as f64 / 64.0)` to avoid intermediate overflow. Assumption
  statuses and source snapshots must survive serialization; no nonfinite JSON.

- [ ] **Cycle 4 — paired scenarios.** Baseline and one selected overlay resolve
  against the same graph. For each sample accumulate the two completion
  indicators and their difference; store integer counts of +1 and -1. Let
  `s = plus - minus`, `q = plus + minus`, `mean = s/n`; for n>1 use
  `variance = max(0, (q - n*mean*mean)/(n-1))` and
  `half = phi_inv((1+confidence)/2) * sqrt(variance/n)`. Clamp the interval to
  [-1,1]. For n=1 omit the interval with a reason. Wilson intervals remain
  separate. Test a no-op overlay gives exactly zero mean and interval, and
  recompute the paired count directly from saved test-only indicators.

  Assert fixture route outcomes: patch leaves login, protect leaves exploit,
  both and deny are unreachable with isolated administration. Add admin-net.access
  as a foothold: router administration can defeat a denied permission when its
  credential is extracted. Replace perfect controls with finite slower TTCs
  and check CDF changes without deleting the route. Replace a baseline
  Infinity with a finite defended TTC and assert the reported benefit is
  negative. Unknown replacement gives an unavailable scenario/delta while
  preserving an available baseline. Do not assume defense CDFs cannot cross.

- [ ] **Cycle 5 — native and both wasm paths.** Freeze graph/result JSON from
  the lecture at 8192 samples and assert the same bytes in native and wasip1
  tests. Include cycle/tie witnesses and comparison statistics in the snapshot.
  Keep every existing tree snapshot unchanged. Implement the native example
  `graph-agreement` as a test tool only: read a source path from argv, call
  `api::parse`, `api::generate(..., "agreement")` and a stepped graph session,
  then print each raw JSON response on its own line. A second arg selects the
  scenario. No production analysis CLI is introduced.

  Node script loads `assets/wasm/effractor_wasm.js` through the existing
  `new Function(... + '; return wasm_bindgen;')()` / `initSync` pattern, invokes
  the same calls and compares the response strings to the native example.
  Use `execFileSync` argument arrays, never shell interpolation of model text.
  Check baseline, patch, deny and unknown fixture, plus a large seed. Add this
  check after the wasm build in CI's Rust job and add `-p effractor-components`
  to its pure wasm build. The existing wasmtime solver job now exercises the
  graph tests too. Commands:

  ```sh
  scripts/build-wasm.sh
  cargo test -p effractor-solver -p effractor-wasm
  CARGO_TARGET_WASM32_WASIP1_RUNNER="wasmtime run --dir ." cargo test --target wasm32-wasip1 -p effractor-solver
  node scripts/check-graph-agreement.js
  node --test scripts/solver.test.js scripts/solver-worker.test.js
  ```

- [ ] **Deliver:** remove `sequential-simulation`, update handoff and follow
  the delivery procedure. Commit title: `Simulate sequential graph actions with paired defense comparisons`.

## Task 4: Empty architecture and component editing

**Files:** Create `assets/templates/new-architecture.yaml`, `assets/js/profiles.js`,
`revisions.js`, `architecture-edit.js`, `architecture-view.js`, `architecture-ui.js`,
`assets/css/60-architecture.css`; `scripts/architecture-edit.test.js`,
`architecture-view.test.js`, `profiles.test.js`, `revisions.test.js`. Modify
`app.js`, `editor.js`, `source.js`, `controls.js`, `charts-ui.js`, `pareto-ui.js`,
`renderer-svg.js`, `graph.js`, server `templates/shell.html`, and existing
script/static-site/shell tests. The limited profile guard added in Task 1 is
replaced by actual architecture dispatch here.

**Interfaces:** Pure JS modules use the existing CommonJS/browser-global pattern.
`effractorArchitectureEdit` exports `empty()`, `addEntity(doc, kind, label,
catalog)`, `renameEntity(doc, id, label)`, `setParameter(doc, owner, slot, value)`,
`setDefense(doc, id, defense, value)`, `removeEntity(doc, id)`.
`owner` is `{entity:id}` or `{flow:id}`. Edits return `{doc, select, notice}` or
null. Source IDs become stable at creation; label edits never change them.
Maps are prototype-less and operations never mutate the original document.
Unknown parameters are `{status:"unknown"}`. Completed supplied parameters
carry status, TTC string and note together in one atomic edit.

Qualified architecture selection IDs are `entity/<id>`, `flow/<id>`,
`association/<id>` and `step/<generated-id>`; tree selection remains its old
node ID. `effractorArchitectureView.describe(doc)` returns the shared renderer's
`{profile,nodes,edges}` shape. Rendered nodes have the existing id/label/lines/
symbol/inscription/attributes/badge/top/unquantified fields; add neutral
`component`, `action`, `fact` symbols instead of reusing fault symbols.
`effractorProfiles` exports `isArchitecture(doc)`, `selectionExists(doc,id,graph)`,
`capabilities(doc)` and `treeActionAllowed(doc,action)`. Capabilities are an
explicit object `{architecture,generate,solve,exact,cutSets,loss,pareto,controls}`;
unfinished UI entry points remain disabled until Task 6, independently of backend
API availability. Never read `doc.nodes` unconditionally for an architecture.

`effractorRevisions.create()` returns:

```js
// invalidate() advances the document revision and expires all pending work.
// issue(channel) advances that channel's request counter without changing the document.
// accept(token) checks both current document revision and latest request in its channel.
{ current, invalidate, issue, accept }
// Tokens: {revision: String, channel: String, request: Number}
```

The app exposes `state.revision`, `state.sourceValid`, `state.mode`
(`architecture`/`attack`, only relevant for architecture documents) and
`state.generated`, plus `markSourceDirty()`, `showSourcePath(path)` and
`setMode(mode)`. Generated/solve/layout callbacks carry captured revision
tokens. `markSourceDirty` invalidates immediately when source input changes,
before a debounced parse finishes; a valid adopted parse restores sourceValid.
Do not let an obsolete cancellation callback stop a newer solve.

- [ ] **Cycle 1 — empty document and safe edits.** Before module creation add:

  ```js
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const E = require('../assets/js/architecture-edit.js');
  test('an architecture starts empty and label changes keep identity', () => {
    const doc = E.empty();
    assert.equal(doc.profile, 'architecture');
    assert.deepEqual(Object.keys(doc.entities), []);
    const edit = E.addEntity(doc, 'host', 'Workstation', {parameters: []});
    assert.deepEqual(Object.keys(doc.entities), []);
    assert.equal(edit.select, 'entity/workstation');
    const renamed = E.renameEntity(edit.doc, 'workstation', 'Office workstation');
    assert.equal(renamed.doc.entities.workstation.label, 'Office workstation');
    assert.deepEqual(Object.keys(renamed.doc.entities), ['workstation']);
  });
  ```

  Run `node --test scripts/architecture-edit.test.js` red then implement. Add
  numeric labels (derive a nonnumeric ID such as `entity-123`), duplicate labels,
  `constructor` keys, unknown TTC, clearing TTC, and extension-preserving edits.
  Retain server/default first-visit tests: no lecture content in assets/templates
  or initial state. Test New/Open/Undo via the app's existing fake DOM helpers,
  not a browser. Referenced-entity deletion may refuse with a notice until Task 5
  adds atomic reference cleanup; it must not silently produce invalid state.

- [ ] **Cycle 2 — protect asynchronous state.** Write token tests first:

  ```js
  const gate = require('../assets/js/revisions.js').create();
  const oldSolve = gate.issue('solve');
  gate.invalidate();
  assert.equal(gate.accept(oldSolve), false);
  const oldLayout = gate.issue('layout'), newLayout = gate.issue('layout');
  assert.equal(gate.accept(oldLayout), false);
  assert.equal(gate.accept(newLayout), true);
  ```

  Add app-level promise tests where old source parsing, layout and solving finish
  after a new file, undo, invalid source input or target edit. Assert both
  rendered state and persisted text remain the latest accepted document. Use
  separate channel tokens for document, layout, generation and solve requests.
  Apply the guard at the existing app entry points `adopt`, `adoptSource`,
  `draw`, `solve` and `documentChanged`. Disable tree auto-exact on architecture.
  All first-visit, source-stale, cancel and worker-crash tests must still pass.

- [ ] **Cycle 3 — profile-safe workspace.** Add pure dispatch tests showing
  tree delete/link/gate actions are rejected for architecture selection, while
  source/file/undo shortcuts remain available. Guard every tree DOM subscriber
  before reading nodes/assets/controls or results.exact. Architecture numeric
  panels stay empty until Task 6. Create the architecture entity outline and
  component renderer using neutral rectangles, existing tokens and labels; no
  free-position coordinates enter the source. Load pure modules before app.js
  and DOM modules after menu.js. Update both server/static shell tests for the
  script list and asset URLs, including a repository Pages prefix and `/s/id`.

- [ ] **Cycle 4 — component/property controls.** Add New Architecture to the
  existing file menu. One catalog-backed type picker creates entities. Selection
  shows kind, label, description, applicable parameter slots and defense switches.
  A parameter form keeps a local draft until status/TTC/note can be submitted
  together; it does not save an invalid half-parameter or invent a status/note.
  Every submit uses wasm serialization and reports diagnostics through app.say.
  Use menu.js dropdowns and the current source/undo/store mechanisms. Update `?`
  and context menu together; no entity additions intercept Tab inside forms.
  Read removed DOM lines in the diff before requesting visual acceptance.

- [ ] **Owner walkthrough:**
  1. File → New Architecture; confirm an empty outline and canvas.
  2. Add a host, service and credential; rename them and enter one illustrative
     TTC with a note. Clear it and confirm Unknown.
  3. Undo/redo, save/reopen, edit invalid YAML, and switch to an old tree; verify
     tree editing/results still work. Check light and dark themes.

- [ ] **Deliver after the owner's look:** remove `architecture-editor`, update
  handoff and follow the delivery procedure. Commit title: `Edit empty architecture documents and component assumptions`.

## Task 5: Relationships, flows and attacker configuration

**Files:** Create `assets/js/architecture-links.js`, `architecture-links-ui.js`,
`scripts/architecture-links.test.js`. Modify architecture edit/view/UI modules,
`profiles.js`, app selection, shell/CSS and relevant script tests.

**Interfaces:** `effractorArchitectureLinks` exports
`putAssociation(doc,id,value)`, `putFlow(doc,id,value)`,
`setFoothold(doc,entity,state,enabled)`, `setTarget(doc,entity,state)`,
`renameId(doc,collection,oldId,newId)` and `remove(doc,collection,id)`.
`collection` is `entities`, `associations` or `flows`. These return the same
immutable edit shape as Task 4. Kind/range validity is checked by wasm; JS
performs deterministic reference rewrites and collects the affected-count notice.
Use own-key checks and a prototype-less lookup for every ID map.

- [ ] **Cycle 1 — explicit references.** Build a document through these pure
  functions containing the fixture's hosts, networks, stores, authorizations and
  grants. Assert the `hosts` privilege, directional source/target, route order
  and `permits.allowed` value survive serialize/parse through the real wasm API
  in the Node agreement tooling. Test a same-zone flow and a two-router flow;
  adjacency must not auto-create a permission. Draft forms can hold partial
  selections, but save must report Rust's dangling/type/cardinality diagnostics.

  ```js
  const E = require('../assets/js/architecture-edit.js');
  const L = require('../assets/js/architecture-links.js');
  let doc = E.empty();
  doc = E.addEntity(doc, 'host', 'Workstation', {parameters: []}).doc;
  doc = L.setFoothold(doc, 'workstation', 'admin', true).doc;
  doc = L.setTarget(doc, 'workstation', 'admin').doc;
  assert.deepEqual(doc.attacker.footholds, [{entity:'workstation', state:'admin'}]);
  assert.deepEqual(doc.attacker.target, {entity:'workstation', state:'admin'});
  ```

  Run `node --test scripts/architecture-links.test.js` red before implementing
  the pure operations, then rerun after adding real wasm serialization coverage.

- [ ] **Cycle 2 — deletion and identity.** Add actual source fixtures in
  `scripts/fixtures/architecture.doc.json` generated from the documentation
  fixture, with a paired serde/wasm check preventing drift. Delete `sshd` and
  assert hosting/authorization and its flow/permission references are removed,
  as are scenario changes referencing removed entities/permissions. Preserve
  unrelated components and named scenarios; an empty change list is a valid
  no-op. Removing a host removes its hosting associations, leaving executables
  explicitly unhosted/incomplete rather than inventing a new host. Removing a
  route network deletes affected flows, not just that hop. Undo restores the
  entire former source snapshot, including extensions and scenarios.

  Rename `server` to `production-server`; assert association endpoints, target,
  footholds and affected route IDs are updated without changing map order.
  Rename a flow and update its permissions; rename a permission and update
  scenario overrides. Label-only changes still preserve all IDs. A conflicting
  or numeric-only new ID is refused with a notice before committing an edit.
  Route every architecture delete action, including rail and keyboard actions,
  through `architectureLinks.remove` once these reference-aware edits exist.

- [ ] **Cycle 3 — quiet relationship controls.** Add one Link action to the
  selected component and concise relationship lists in its panel. A typed kind
  picker filters eligible endpoints using the catalog; Rust remains authoritative.
  Flow editing supplies source, destination, ordered route and explicit
  permissions. Expose privilege on hosting/stores/grants, plus state pickers for
  foothold/target. Show missing hosting/filter/permission diagnostics without
  inserting guessed values. Architecture graph edges carry relation labels and
  flow direction. All forms have keyboard and visible action paths in `?`.

- [ ] **Owner walkthrough:**
  1. Build client/server/admin zones, router/firewall, workstation/server and
     SSH software with user/admin hosting respectively.
  2. Add accounts/credentials, the SSH route and firewall permission, and the
     separate administration relationship. Set workstation.admin and server.admin.
  3. Delete/undo a referenced component, then save/reopen and inspect the
     relationships and attacker settings.

- [ ] **Deliver after the owner's look:** remove `architecture-links`, update
  handoff and follow the delivery procedure. Commit title: `Model architecture relationships flows and attacker states`.

## Task 6: Linked attack graph inspection and simulation results

**Files:** Create `assets/js/attack-view.js`, `attack-ui.js`, `graph-results.js`,
`scripts/attack-view.test.js`, `graph-results.test.js`. Modify architecture
view/UI, app/profile dispatch, graph/renderer/CSS, charts/CDF presentation, source
path navigation and shell/tests. Extend wasm `graph_api.rs` and its API tests
to include the pure solver's qualitative support in generation responses.

**Interfaces:** `effractorAttackView.describe(graph, support, focus)` adapts
backend graph data to the shared renderer; `focus` is a selected component or
step ID plus a page/window choice. It returns `{graph,shown,total}` without
altering the original graph. `stepsForEntity(graph,entityId)` returns generated
IDs; `sourcesForStep(graph,stepId)` returns the supplied provenance objects.
`effractorGraphResults.cdf(outcome)` returns `{rows,reason,confidence}` using
available graph CDF rows directly; `nodeFacts(results,id)` returns display
facts with a clear reason for unavailable values. No JS reachability or timing
algorithm is introduced. Pure graph support comes from Rust even before a
quantitative solve succeeds.

- [ ] **Cycle 1 — selection and provenance.** Use the generated lecture graph
  fixture to assert source/step selection in both directions. A step with
  several origins returns all of them; a label rename changes its label but
  not selection. Inspect the source paths for patch selection, extraction,
  permissions and hosting privilege, including blocked steps. Requesting a
  source field changes to Architecture and opens that field or highlights its
  exact source line when no dedicated control exists.

  ```js
  const V = require('../assets/js/attack-view.js');
  const graph = require('./fixtures/lecture-graph.json');
  const ids = V.stepsForEntity(graph, 'sshd');
  assert.ok(ids.includes('action/service-deploy-exploit/sshd'));
  const origins = V.sourcesForStep(graph, 'action/service-deploy-exploit/sshd');
  assert.ok(origins.some(o => o.paths.includes('entities.sshd.parameters.deploy-exploit')));
  ```

  Create the JSON fixture by exporting the real generated graph, and compare it
  against wasm in the agreement check; do not invent a parallel JS model.
  Run `node --test scripts/attack-view.test.js` red/green.

- [ ] **Cycle 2 — graph focus and rendering.** Orient all generated edges
  prerequisite→dependent. Explicit Any/All symbols remain visible; foothold and
  target badges, unknown `?`, blocked labels and stroke patterns never rely on
  colour. Keep neutral fills rather than tree importance colours. Test cyclic
  input does not recursively expand an outline. For a 501-node graph, the view
  shows at most 500 and an accurate count; search/table still returns all 501.
  Focusing a node outside the current window brings it into view. Generated
  steps are read-only; attempts to apply tree reparent/delete keys are rejected.
  Reuse ELK under Node for a cyclic layout contract check, without browser driving.

- [ ] **Cycle 3 — graph results.** Add fixtures for an available CDF,
  unreachable target, seeded target, unknown target and baseline-known/
  scenario-unknown outcomes. Assert available numbers/labels and absent exact,
  cut-set, Pareto, loss and control-ranking capabilities. Use existing chart
  coordinate/path helpers for the sampled CDF; label the curve as target
  compromise probability. Show Wilson band, pointwise qualifier, assumption
  statuses and a table with time/probability/lower/upper columns. Infinite
  completion time is shown as unreached, not as a conditional-success quantile.
  A sample witness shows every required AND branch and its actual sample index;
  it is labelled `Sample route` and never ranked as the most likely route.

- [ ] **Cycle 4 — integrate generation and solving.** Enable Generate and
  Architecture/Attack graph view switching. Pass opaque document revision into
  wasm calls and accept only the latest token. Clear stale graph/results on
  every semantic edit, new/open/undo and invalid source; selection falls back
  to its originating component when a generated ID vanishes. Solve respects
  capability/source validity from both button and Ctrl+Enter. Graph callbacks
  use onBegin, progress and graph results; old trees keep onExact and auto-exact.
  Add fake-worker promise regressions for a graph result arriving after opening
  a tree and vice versa. Run all script tests and server/static export checks.

- [ ] **Owner walkthrough:**
  1. Open the documented architecture, Generate, and inspect exploit and login
     routes; select a step, follow Source, and switch views while preserving context.
  2. Solve; inspect probability, TTC band/table, illustrative notes and the
     complete Sample route. Clear a relevant TTC and confirm Unknown without
     losing qualitative routes.
  3. Cancel a long solve, undo an edit and switch to a tree; check no stale
     graph/result appears. Check both themes and keyboard navigation.

- [ ] **Deliver after the owner's look:** remove `attack-graph-inspection`,
  update handoff and follow the delivery procedure. Commit title: `Inspect generated attack routes and compromise probabilities`.

## Task 7: Defense comparison UI

**Files:** Create `assets/js/comparison.js`, `comparison-ui.js`,
`scripts/comparison.test.js`. Modify graph results/UI, app/profile dispatch,
chart/CSS/shell modules and their tests. Backend comparisons were delivered in
Task 3; this task must not introduce a JS probability calculation.

**Interfaces:** `effractorComparison` exports `putScenario(doc,id,label,changes)`,
`removeScenario(doc,id)`, `rows(result)` and `changedSteps(graph,result)`.
Edits use the established immutable edit shape. `rows` combines the backend's
baseline/scenario CDFs by their identical grid index and returns baseline and
scenario probability/band columns, without recomputing paired uncertainty.
`changedSteps` maps backend changed parameter/permission paths to generated IDs.
Selecting a scenario is workspace state, not an accidental rewrite of baseline
defenses; scenario definitions themselves are source document data.

- [ ] **Cycle 1 — scenario editing and integrity.** Test patch, protect, both,
  deny and no-op edits with the real fixture; preserve unknown and x- fields.
  Send duplicate assignments and a wrong entity-kind defense through wasm and
  assert actionable source paths. Deleting a referenced permission uses Task 5
  cleanup. Selecting a scenario does not change baseline switch values; saving
  and reopening preserves all scenario definitions. Structural edits invalidate
  comparison requests/results and selections that no longer name an ID.

  ```js
  const C = require('../assets/js/comparison.js');
  const doc = require('./fixtures/architecture.doc.json');
  const before = JSON.stringify(doc);
  const edit = C.putScenario(doc, 'patch-only', 'Patch SSH', [
    {entity:'sshd', defense:'patched', value:true}
  ]);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(edit.doc.entities.sshd.defenses.patched, false);
  assert.equal(edit.doc.scenarios['patch-only'].changes[0].value, true);
  ```

  Run `node --test scripts/comparison.test.js` red, implement the pure edit and
  presentation functions, then rerun with actual backend result fixtures.

- [ ] **Cycle 2 — meaningful result presentation.** Test positive, zero and
  negative paired benefits, n=1 unavailable interval, known-baseline/unknown-
  scenario, no samples, seeded and unreachable cases. Present the backend delta
  with its paired interval; do not subtract Wilson endpoints. CDF lines use
  distinct line patterns and labels, and their table includes both bands.
  Statuses identify illustrative inputs on either side. Changed/blocked/remaining
  route lists use each scenario's Rust support result, not numeric thresholds
  applied to Monte Carlo probabilities. A route with zero observed successes
  can still be qualitatively possible.

- [ ] **Cycle 3 — comparison controls.** Add a quiet comparison tab and custom
  scenario selector, with named overlay edits for patching, protection and
  permissions. Baseline and selected overlay share one explicit Solve and one
  cancellation/progress path; use `solve_graph_begin`. Multiple switches in one
  overlay are a combined experiment, never a sum of individual deltas. Bind
  selected changed-step/remaining-route rows to canvas/source selection. Do not
  expose tree control cost/rank UI for architecture. Read DOM deletions and run
  the full checks before owner inspection.

- [ ] **Owner walkthrough:**
  1. Compare baseline to patch-only, then protection-only; inspect the remaining
     login and exploit routes respectively.
  2. Compare both and denied SSH permission; confirm blocked target with isolated
     administration. Inspect a finite replacement to see a delayed CDF.
  3. Enable an explicit administration foothold and inspect the documented
     router-control alternative. Clear a replacement TTC and confirm the
     baseline remains available while that comparison says Unknown.

- [ ] **Deliver after the owner's look:** remove `defense-comparison`, update
  handoff and follow the delivery procedure. Commit title: `Compare architecture defenses and remaining attack routes`.

## Task 8: Lecture acceptance and delivery evidence

**Files:** Create `docs/LECTURE-ACCEPTANCE.md`,
`docs/course/lecture-unknown.yaml`, `docs/course/lecture-partial-defenses.yaml`
and `scripts/check-graph-performance.js`. Modify `docs/course/README.md`,
the documentation fixture where required, handoff and roadmap. Add meaningful
final regression tests only if the walkthrough reveals new failures; do not
duplicate already passing coverage or drive a browser to replace owner acceptance.

**Interfaces:** Performance tooling consumes the built wasm generation and
stepped graph solve APIs. Acceptance documentation links the exact fixture,
library/semantics versions, commit SHA and release evidence.

- [ ] **Course documentation.** Explain all three architecture files and how
  to build the exercise from empty. List each illustrative parameter's units,
  assumption and affected rule. Explain the difference between user execution
  and the full workstation foothold; the isolated admin zone; perfect versus
  finite defenses; unknown distributions; the unconditional CDF and its sampling
  uncertainty. Document scope exclusions and avoid a promise of numerical
  equivalence to screenshots or a complete vulnerability library.
  The unknown example marks `sshd.find-exploit` unknown. The partial-defense
  example uses patched discovery `Exponential(0.01)` and protected extraction
  `Exponential(0.02)`, with explicit illustrative notes; its routes remain
  possible. These inputs belong only in the documentation fixtures.

- [ ] **Fresh automated evidence.** After the final code change, run every
  required check and both wasm-agreement paths. The performance script loads
  wasm under Node, generates the actual lecture fixture, runs 10,000 samples
  and reports generation/solve milliseconds, graph node/edge counts, node/wasm
  versions and bundle bytes. Record baseline plus one selected scenario, using
  separate measurements so comparison work is not hidden. Measure an initial
  cold run and five warm runs. Target <1 s for the fixture; report any miss.
  Run `scripts/build-site.sh` and server/static asset tests as well.

- [ ] **Final owner walkthrough.** Provide the five numbered steps from spec
  §11 against the final candidate. Record what the owner actually checked and
  their response. If a fix changes UI after acceptance, rerun the affected
  walkthrough before delivery; do not treat previous approval as covering a
  changed implementation. Preserve the new-user empty-document check.

- [ ] **Complete the milestone.** Once code, checks and owner acceptance are
  complete, remove `lecture-workflow` in its completing change and leave
  `mal-securicad-compatibility` on the roadmap with no completed dependency.
  Update handoff with actual delivered state, reproducibility commands, known
  limits and acceptance evidence. If this final change is documentation-only,
  follow the docs-on-master exception and identify the exact already-released
  code SHA separately; if it contains code, use its own CI-tested PR/release.
  A documentation push does not substitute for verification of the code release.

## Delivery procedure for every code task

- [ ] After plan approval, use the worktree skill to obtain an isolated checkout
  inside an allowed writable directory, or recognize an already-isolated one.
  Check current branch/status first. Preserve owner edits. Use one branch per
  item and a separate preview server/port while the owner looks.
- [ ] Start each listed regression with a demonstrated failure, implement the
  smallest coherent change, and rerun it. Run native checks for pure Rust,
  Node tests for pure JS, and let the owner inspect UI. No headless-browser
  harness is introduced. Perform the execution method's required code review
  and fix substantive findings before delivery.
- [ ] Remove only the completed roadmap item with
  `python3 scripts/dev/roadmap-done.py ITEM`, then update `docs/HANDOFF.md`.
  Review the full diff, especially deleted DOM lines. Use an explicit file list
  when staging; do not absorb unrelated owner files.
- [ ] Run the required commands on the candidate tree, ensuring the wasm build
  precedes any server test. These checks are mandatory despite ship.sh's smaller
  local subset:

  ```sh
  scripts/build-wasm.sh
  npm test
  cargo test --workspace
  cargo fmt --all --check
  cargo clippy --workspace --all-targets -- -D warnings
  node scripts/check-roadmap.js
  ```

  For generator/solver/wasm changes also run the Task 3 wasmtime/agreement
  commands. CI additionally checks vendored assets, contrast, shell scripts,
  static export and pure wasm builds. Test failures are diagnoses to resolve,
  not permission to update frozen numbers.
- [ ] Start the preview server from the candidate checkout after rebuilding
  wasm and shell. Supply the task's short numbered walkthrough and wait for
  the owner's look before its UI fast-forward. While waiting, do independent
  read-only work or tests; do not claim visual acceptance.
- [ ] Commit with the configured author signature (`git commit -S`). Push the
  feature branch and create a PR with the concrete behavior/validation. Use a
  body file for multiline `gh pr create` content. Invoke
  `scripts/dev/wait-ci.sh ci.yml EXACT_SHA` unpiped; success must refer to the
  current candidate SHA. If review causes another commit, repeat that gate.
- [ ] Fast-forward local master to that same SHA (`git merge --ff-only BRANCH`),
  then push master. Never use the GitHub merge button or force-push. Wait for
  `scripts/dev/wait-ci.sh release.yml EXACT_SHA` unpiped before the next code
  push to master. Long-running tools must yield so progress updates continue.
  Do not run the monolithic ship script before owner UI acceptance; its final
  fast-forward is intentionally gated by the completed walkthrough.

## Existing delivery/environment observations

The starting master was `c58d0cf`; the spec review commit is signed `c2e748b`.
Baseline `npm test`, workspace tests, fmt, clippy and roadmap check passed;
`scripts/build-wasm.sh` succeeded. This is baseline evidence, not evidence that
the new graph workflow exists. The wasip1 target is installed; wasmtime was not
on PATH during the design checkpoint. Locate an existing runner or install a
pinned verification-tool build into task-local tooling before Task 3; do not
silently skip the wasm tests. Browser-wasm comparison is a separate required
check, not a substitute for the CI wasmtime tests.

The repository currently has a documented docs-on-master exception, while
release.yml requires PR CI for every SHA. The starting documentation commit's
[release run](https://github.com/overcuriousity/effractor/actions/runs/35653913216)
failed at `gate / this commit passed ci`; builds and publication were skipped.
Preserve the owner's direct documentation workflow and report documentation
pushes honestly. Every **code** delivery in this plan must have green exact-SHA
PR CI and a verified release. Changing release policy is not part of this plan;
an existing failed documentation release cannot be described as a code release.

## Coverage and review handoff

| Spec sections | Plan coverage |
|---|---|
| 1–3: boundary, tree preservation, versioned documents | Task 1 + all delivery checks |
| 4: entities, associations, flows, incomplete authoring | Tasks 1, 2, 4, 5 |
| 5–6: library, parameters, rules, traceability | Tasks 1, 2, 6 |
| 7: timing, cycles, determinism | Task 3 |
| 8: analyses, unknowns, limits | Tasks 2, 3, 6 |
| 9: defense overlays and paired deltas | Tasks 1, 3, 7 |
| 10: quiet linked UI and stale-state handling | Tasks 4–7 |
| 11: fixtures, automated and owner acceptance | Tasks 2–8 |
| 12: branches, checks and delivery | All tasks and delivery procedure |

Before execution, ask the owner to review this written plan and choose native
execution or subagent-driven execution. Recommend native: these tasks share
format, graph and UI interfaces, have sequential owner checkpoints, and benefit
from keeping implementation context together. Under native execution the main
agent implements and a fresh reviewer checks each completed code branch before
delivery, as required by the execution skills. Under subagent-driven execution,
use the corresponding skill's per-task implementer/reviewer workflow. Either
choice retains exactly the same tests, owner UI reviews and release gates.
