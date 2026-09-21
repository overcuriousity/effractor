# Roadmap

Remaining work for effractor, as a DAG. The existing tree profiles are specified
in `docs/superpowers/specs/2026-09-20-effractor-v1-design.md`; the approved
successor design is linked below. How work lands is in `CONTRIBUTING.md`.

Approved successor spec:
[`2026-09-21-lecture-workflow-design.md`](docs/superpowers/specs/2026-09-21-lecture-workflow-design.md).
The [implementation plan](docs/superpowers/plans/2026-09-21-lecture-workflow.md)
is awaiting owner review and execution-method selection. The items below are
its delivery decomposition; implementation starts after that checkpoint.

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

## Successor direction

Owner decision, 2026-09-21: the first successor milestone reproduces the
lecture workflow with a small, transparent component library. Compatibility
with existing securiCAD/MAL models and libraries follows that milestone.
Effractor's purpose remains production security architecture analysis; the
lecture supplies a concrete acceptance scenario.

Reference: the owner's `extract.pdf`, printed pp. 112–134, sections 5.3–5.5.
The scenario has client, server and administration networks, a router/firewall,
a workstation running an SSH client, an SSH server, accounts/credentials and
permitted data flows. Start with the workstation already compromised; generate
routes to server compromise and compare defenses such as patching, credential
protection and network permissions. Keep the exercise in course documentation
and test fixtures; the app still opens an empty document for a new user.

The lecture milestone is decomposed into branch-sized work by the approved design. The
existing tree profiles, local-first operation and native/wasm determinism remain
requirements. The v1 spec's assumption that generated attack graphs need no
document-model changes is superseded: generated graphs use explicit
prerequisite-dependent attack steps with accumulated durations.

### lecture-workflow — Deliver the first successor milestone
needs: defense-comparison            cost: 2   benefit: 5
Build the lecture's architecture → generated attack graph → simulation → defense
comparison workflow using a small, transparent component library. Cover
networks/zones, routers/firewalls, hosts, applications/services,
accounts/credentials and data flows, with explicit hosting, communication,
administration and privilege relationships. Generated steps expose their
originating rules and editable assumptions. Done when the owner can build the
reference scenario in the browser, choose the compromised workstation and
server target, inspect generated routes and compromise probabilities over time,
and see how defense changes affect results and remaining alternatives. Verify
sequential timing and graph generation with automated fixtures, native/wasm
agreement in CI, and the workflow by the owner's browser walkthrough. Numerical
agreement with the lecture's screenshots is not an acceptance criterion without
the underlying rules and calibrated inputs.

## Lecture implementation

### architecture-document — Typed architecture documents and library contract
needs: —            cost: 3   benefit: 5
Add the separate architecture document, schema 2 migration and strict typed
entities, associations, flows, footholds, target, assumptions and scenario
overlays. Preserve the tree model and result semantics. Expose the bundled
core-components@1 catalog and dispatch format/wasm document APIs by profile.
Done when empty and populated architectures round-trip with extensions,
invalid references/types/routes/versions have positioned diagnostics, unknown
inputs remain explicit, and migrated tree fixtures keep their frozen results.

### component-generation — Transparent component rules and generated graphs
needs: architecture-document            cost: 3   benefit: 5
Generate stable state/action identities and explicit prerequisites from the
small component library, with rule, entity, relationship and parameter
provenance. Retain blocked alternatives; distinguish connectivity, permission,
credentials and privilege. Add the lecture and unknown-input fixtures and a
wasm generation API. Done when every rule has meaningful generation tests,
reordering/renaming preserves identities, isolation and privilege boundaries
hold, cycles remain finite, and generation limits fail with diagnostics.

### sequential-simulation — Prerequisite-dependent timing and paired scenarios
needs: component-generation            cost: 4   benefit: 5
Implement iterative event evaluation for generated graphs, accumulated action
durations, justified cycle entry, explicit unknown-result states, sampled
probability/CDF and route witnesses. Compare typed defense overlays with common
random draws and paired intervals; expose stepped/cancellable wasm solves and
profile-specific result capabilities. Done when timing/cycle/shared-action
oracles, analytic chain CDF, unknowns, no-op/combined scenarios and limits pass;
new frozen fingerprints pass native and wasmtime; browser wasm agrees with
native generation/results; and existing tree fingerprints remain unchanged.

### architecture-editor — Empty architecture creation and component editing
needs: architecture-document            cost: 3   benefit: 4
Add New Architecture and quiet component/type/parameter editing through the
existing workspace, source, persistence and undo paths. New users still open an
empty document, and newly created attack parameters remain unknown. Isolate
tree actions by profile. Done when pure editing and profile-dispatch tests pass
and the owner accepts a short walkthrough of component creation, parameter
editing, save/reopen, source diagnostics and undo in both themes.

### architecture-links — Relationships, flows and attacker configuration
needs: architecture-editor            cost: 3   benefit: 5
Edit typed hosting, network, firewall, administration, credential and privilege
relationships; directional routed flows; footholds and target states. Keep
atomic reference-safe deletion undoable and do not infer permissive defaults.
Done when editing tests cover endpoint/cardinality errors, incomplete models,
multi-network routes and reference cleanup, and the owner can build the
lecture architecture and configure the compromised workstation/server target.

### attack-graph-inspection — Linked architecture, routes and simulation views
needs: architecture-links, sequential-simulation            cost: 3   benefit: 5
Add Generate, linked component/step selection, rule and assumption inspection,
blocked and unknown route states, graph focus and the full step table. Show
sampled compromise probability/CDF with table and bands, and capability-gate
tree-only analyses. Reject stale worker responses after edits and navigation.
Done when selection/provenance/results tests pass, the fixture's exploit and
login routes are inspectable, and the owner accepts generation, source links,
solving, unknown inputs, cancellation and graph navigation in the browser.

### defense-comparison — Inspect defense changes and remaining alternatives
needs: attack-graph-inspection            cost: 3   benefit: 5
Add named defense overlay editing, baseline/scenario CDFs, paired probability
deltas and visible changed/remaining/blocked routes. Surface illustrative
inputs and missing replacement assumptions; clear comparisons on structural
edits. Done when comparison view/edit tests pass and the owner verifies
patch-only, credential-only, combined and denied-flow cases, including finite
replacement TTCs and an explicit administration alternative. The final
lecture-workflow item records full acceptance, checks and released delivery.

## Compatibility after the lecture milestone

### mal-securicad-compatibility — Reuse existing models and libraries
needs: lecture-workflow            cost: 5   benefit: 4
Prioritize compatibility with existing securiCAD/MAL models and libraries after
the first successor milestone. Start from representative files and document
supported versions and constructs, distinguishing MAL language libraries,
instance models and securiCAD export formats. Define and implement the supported
import subset without silently changing its meaning. Done when documented
fixtures import with their component/asset types, associations, defenses,
attacker entry points and TTC semantics preserved, unsupported constructs
produce actionable diagnostics, and compatibility tests cover the declared
subset. Broader format coverage and numerical equivalence require their own
evidence; parsing TTC expressions alone does not establish MAL compatibility.
