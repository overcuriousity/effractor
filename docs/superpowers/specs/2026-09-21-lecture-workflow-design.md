# effractor — architecture and sequential attack graphs

Date: 2026-09-21 · Status: approved by the owner, 2026-09-21

Implementation plan: [lecture workflow](../plans/2026-09-21-lecture-workflow.md),
awaiting the separate plan review before implementation.

## 1. Purpose and boundary

Effractor supports production security architecture analysis: architecture →
generated attack graph → compromise simulation → defense comparison. The first
acceptance case is the owner's lecture, `extract.pdf`, printed pp. 112–134.
The chosen direction is a small, inspectable component library. Existing MAL
libraries and securiCAD files are **not** imported in this milestone;
`mal-securicad-compatibility` remains subsequent roadmap work.

The existing fault-tree and attack-tree profiles retain their meanings, solver
results, random streams and frozen fingerprints. In particular, tree leaves
start at zero and AND takes their maximum. This document supersedes the v1
specification's claim that generated graphs need no document-model changes.
Generated attack actions have prerequisites **and their own elapsed durations**.

All modelling, generation and solving run locally in the browser through pure
Rust compiled to wasm. The server's existing encrypted sharing is unchanged.
No remote knowledge base, telemetry, third-party origin or execution of model
code is introduced. A new user still receives an empty document; the lecture
architecture and illustrative numbers live only in documentation and fixtures.

## 2. Reference inspected and interpretation

All 23 PDF pages were rendered and inspected, including the textless printed
pages 113–114, 120, 122–123 and 125–129. Figures 5.36 and 5.38 were additionally
rendered at 300 dpi to inspect the detailed attack routes. The PDF stays outside
the repository; this document records the relevant observations without copying
its screenshots or distributing the extract.

| Printed pages / figures | Observation | Requirement or deliberate simplification |
|---|---|---|
| 112–114 / 5.10–5.12 | Actions have an order, durations and alternative exploit routes; results include a TTC CDF. | Accumulate durations along prerequisites. Simulate complete attack attempts; do not use a shortest path through mean weights as a probability calculation. |
| 115–119 / 5.13–5.20 | Client/server networks, router, separate administration network, firewall, access control and root account. | Explicit network attachment, administration access, firewall permission and privilege grants. Access control is represented by typed account relationships rather than another generic component. |
| 120–126 / 5.21–5.28 | Hosts contain software; the client executes without root privileges; the SSH service has root execution. | Hosting carries an explicit execution privilege. Generic host/application/service types have no vendor-specific vulnerability defaults. |
| 126–128 / 5.29–5.32 | A flow has one software source and one service destination and explicit permission through the firewall. | Named, directional flows with an explicit route and permissions; connectivity alone does not permit a session. |
| 128–132 / 5.33–5.36 | Workstation compromise is the starting assumption; the graph expands component rules and shows a server CDF. A keystore authenticates a flow. | Foothold is already attained at time zero; credentials, authentication and generated rule provenance are explicit. |
| 130–134 / 5.34, 5.36–5.38 | Patching changes an exploit route; login/root-shell and other routes remain. IDS and antimalware bypass appear as actions. | Include exploit and credential-login alternatives. Deployment duration explicitly includes any assumed IDS/antimalware bypass; separate IDS/antimalware components and the screenshot's larger library are outside this first library. |

The figures do not provide a complete library, distribution set or calibration
data. Their percentages, default defense probabilities and edge colours are
not numerical acceptance targets. This library's rules are Effractor modelling
assumptions, not reconstructed proprietary rules. In particular, concurrent
attempts are modelled; attacker choice, discouragement and a finite effort
budget are not inferred from a large TTC.

## 3. Representation and compatibility

Use a separate architecture document and a separate generated graph, alongside
the existing tree `Model`. Do not encode timed actions as tree leaves or add
prerequisite edges to the existing tree evaluator.

Alternatives considered: extending every tree node with timed gates would make
old exact analyses easy to apply incorrectly; converting the architecture to
a tree loses ordering, shared actions and cycles. A typed architecture plus a
derived graph has a slightly larger API but makes the semantic boundary explicit.

The format adds schema version `effractor: 2` and `profile: architecture`.
Version 1 trees migrate to version 2 by changing only the schema version. Tree
profile fields and their meaning remain unchanged. Version 2 tree saves use the
same canonical conventions; existing result JSON stays `effractor-results: 1`
and byte-identical for the existing inputs. New graph results use a distinct
`effractor-graph-results: 1` envelope, with `semantics: sequential-1`.

Internally, `Document` distinguishes `Tree(Model)` and `Architecture(...)`.
Existing tree-only Rust convenience APIs remain available and diagnose an
architecture document passed to a tree-only solve. The format's document JSON,
canonicalization and wasm parse/serialize paths dispatch by profile. Version 1
cannot introduce architecture fields by omitting migration. Unknown schema or
library versions are errors, with no silent substitution.

An architecture document has these top-level fields, in canonical order:

```yaml
effractor: 2
profile: architecture
name: Untitled
time_unit: d
horizon: 100
library: {id: core-components, version: 1}
entities: {}
associations: {}
flows: {}
attacker: {footholds: []}
scenarios: {}
analysis: {seed: 42, samples: 10000, confidence: 0.95}
```

This is an empty document, not the lecture fixture. An optional
`attacker.target: {entity: server, state: admin}` names the result to measure.
Footholds use the same `{entity, state}` form. Metadata defaults above define
the experiment, never an attack's probability or duration. Schema 2 trees retain
their existing `currency`, `assets` and `controls`; these fields are not accepted
in architecture documents in this milestone. Architecture loss modelling is
explicitly unavailable, not silently ignored.

Maps preserve author order in saves. Source IDs keep the existing ID grammar;
new entity, relationship, flow and scenario IDs must also contain at least one
non-digit, preventing JavaScript's integer-key reordering. Existing tree IDs
are not changed. Cross-kind IDs are qualified in the generated graph. Labels
are user content, never identity. Unknown keys remain errors except round-tripped
`x-` extensions. Duplicate keys, malformed references and misplaced fields are
diagnosed with document paths and source positions as today.

## 4. Architecture vocabulary

Every entity has an ID, `kind`, `label`, optional `description` and the
kind-specific parameters below. There are eight kinds:

| Kind | Meaning and generated states |
|---|---|
| `network` | A network/security zone; `access` means an attacker can originate traffic there, not that every member is compromised. |
| `router` | A forwarding and management device; `admin` means administrative control. |
| `firewall` | The filter managed by one router. Permissions apply to named flows. |
| `host` | A workstation or server; `user` and `admin` control are distinct. |
| `application` | Client-side software running on a host/router; `control`. |
| `service` | A reachable service running on a host/router; `control`, with exploit and authentication routes. |
| `account` | An identity with explicit authentication and grants; no implicit global root privileges. |
| `credential` | A model of authentication material; `possessed`. Store descriptions, never actual secrets. |

Associations are maps keyed by ID. Each has `kind`, `from`, `to`, optional
`description`, and only the extra fields allowed for its kind:

| Kind | From → to | Additional field and meaning |
|---|---|---|
| `attached` | host/router → network | Membership/interface; can have several. Does not imply flow permission. |
| `hosts` | host/router → application/service; host → router | Required `privilege: user\|admin`. Each executable, and each router, has one host; a router runs only on a host (an appliance's box, a VM). Owner request 2026-09-23. |
| `filters` | router → firewall | Exactly one firewall per complete router, one router per firewall. |
| `stores` | host/application → credential | Required `privilege: user\|admin` for a host; applications use `user`. Possession still requires an extraction action. |
| `authenticates` | credential → account | Any one associated credential suffices; multi-factor authentication is outside this library. |
| `authorizes` | account → service | The service accepts this account for login. |
| `grants` | account → host/router | Required `privilege: user\|admin`; routers accept only `admin`. |
| `administration` | network → host/router | Management access from that zone, independent of ordinary forwarding. Its existence is explicit permission to attempt management authentication, not a successful login. |
| `permits` | firewall → flow | Required `allowed: true\|false\|unknown`; a named permission for that flow. |

Duplicate semantic associations, inconsistent endpoint types and duplicate
permissions for the same firewall/flow are errors. Multiple stores, credentials,
grants and zone memberships are supported. A host privilege grant used by a
service login must target that service's actual host; unrelated grants cannot
turn a successful login on one machine into control of another. Router-hosted
executables run as admin because no router user state exists in this library.

A flow has `label`, `source` (application or service), `target` (service),
`route` and `parameters.connect`. Its `protocol` is an optional descriptive
string such as `tcp/22`; it does not infer firewall permissions or vulnerabilities.
One flow means one direction; replies do not create a reverse attack route.

`route` is an odd-length list alternating networks and routers, for example
`[client-net, bridge, server-net]`. Its first/last networks must contain the
source/target hosts. Every hop must match `attached`; each traversed router's
firewall must have one `permits` association to the flow. A same-zone route
is `[zone]`. Repeated route entities are rejected; distinct alternative network
routes are represented by distinct flow IDs. There is no implicit discovery of
IP routes, transitive zone trust, wildcard ACL, NAT or packet-level simulation.

An empty/partially constructed architecture is saveable. Missing hosting,
filters, routing permissions or target produce an `incomplete` diagnostic and
disable generation/solving where required; they never become permissive
defaults. Dangling/wrong-type references are errors. UI deletion removes or
edits the affected references atomically and remains undoable.

## 5. Library contract, parameters and defenses

`core-components@1` is bundled pure Rust, with a machine-readable catalog of
types, associations, states, parameter slots and rules. The UI gets this catalog
through wasm. No library download, expression execution, user-authored rule
language or plugin system is required. Each rule has a stable ID and version,
typed matching conditions, prerequisite/result templates, parameter references,
and plain-language assumptions. A rule change affecting generated meaning
requires a new library version. Version 1 remains available to reproduce saved
models; unknown pins fail before solving.

Attack duration fields are explicit parameter objects:

```yaml
parameters:
  find-exploit:
    status: illustrative
    ttc: "Exponential(0.1)"
    note: "Exercise assumption; not calibrated to the lecture"
  find-exploit-patched:
    status: unknown
```

`status` is `unknown`, `illustrative`, `assumed` or `calibrated`. `unknown`
has no `ttc`. Every other status requires a valid TTC expression and a nonempty
`note` giving the assumption or calibration source. `calibrated` is the author's
evidence claim, not a certificate from the app. Omitting a slot is equivalent
to unknown; canonical saves materialize required unknown slots. No library TTC
has an invented quantitative default. The existing TTC expression grammar is
reused unchanged; tests of fixed sequential durations may call the graph
evaluator directly with duration vectors. `Bernoulli(p)` is still zero or
infinity, now relative to the action's prerequisite completion.

Required slots by owner:

| Owner | Slots and switches |
|---|---|
| Flow | `connect` |
| Service | `find-exploit`, `find-exploit-patched`, `deploy-exploit`, `login`; `defenses.patched: true\|false\|unknown` |
| Credential | `extract`, `extract-protected`; `defenses.protected: true\|false\|unknown` |
| Account | `admin-login` when it has a management grant |

Patching selects `find-exploit-patched` in place of `find-exploit`; protection
selects `extract-protected` in place of `extract`. These are authored replacement
distributions, not multipliers or absolute guarantees. The author may choose
`Infinity` as an explicit blocking assumption; patching does not intrinsically
eliminate all exploits. A permission's false value blocks that permission
unless the managing router has been compromised (§6). Unknown active switches
or unknown relevant active duration slots make quantitative results unavailable.
Inactive replacement slots do not prevent solving the current scenario.

Parameters are independent between action instances. A single generated action
shared by several routes is sampled only once per iteration. The rule catalog
identifies that scope: extraction is per store association; discovery/deployment
is per service; connection is per flow; login is per account/service; management
login is per administration/grant pair. Correlated vulnerabilities, reusable
exploit research across services, retries and account lockout are outside version 1.

Logical propagation has zero duration by **rule definition**, not an estimated
parameter. Those steps explicitly say `logical` and expose that assumption.
Deployment includes any IDS/antimalware bypass the author assumes; there is no
unreported extra success factor. Missing protection assumptions therefore remain
visible in that parameter's note.

## 6. Graph generation and traceability

Generate a finite graph of **state facts** and **actions**. A fact is a zero-time
OR of its producers. An action requires ALL its prerequisite facts and has one
duration. Explicit OR junctions can combine alternative prerequisites. Edges
point from prerequisite to dependent. Nothing is encoded through layout order.

| Rule ID | Preconditions → result | Duration / assumption |
|---|---|---|
| `foothold` | Declared entity/state → attained fact | Zero; an attacker input, never an initial compromise estimate. |
| `admin-implies-user` | host.admin → host.user | Logical. |
| `host-execution` | Hosting host's required privilege → executable.control | Logical; admin also satisfies user execution. |
| `execution-privilege` | executable.control → hosting host's declared privilege | Logical; controlling user software never alone grants admin. |
| `hosted-router` | Hosting host's required privilege → router.admin | Logical; no reverse rule: leaving a VM or appliance for its host is its own step. |
| `zone-access` | host.user or router.admin + attachment → network.access | Logical traffic-origin capability only. |
| `flow-permission` | permitted policy OR managing router.admin → permission satisfied | Logical; a router admin can bypass its firewall for an explicitly modelled flow. An unknown policy is an unknown branch, not denial. |
| `flow-connect` | source.control + every route permission → flow.connected | Flow's `connect`; route validity is checked statically. |
| `service-reachable` | Any inbound flow.connected → service.reachable | Logical; does not control the service. |
| `service-find-exploit` | service.reachable → service.exploit-ready | Service discovery TTC selected by patching. |
| `service-deploy-exploit` | service.exploit-ready → service.control | Service deployment TTC; includes stated protection-bypass assumptions. |
| `credential-extract` | Store's required host privilege or application.control → credential.possessed | Credential extraction TTC selected by protection; one action per store. |
| `account-material` | Possession of any authenticating credential → account.material | Logical; material alone grants no access. |
| `service-login` | service.reachable + account.material + authorization → account.session(service) | Service's `login`; one shared action per account/service. |
| `session-grant` | account.session(service) + matching host grant → host privilege | Logical; validates service-host/grant match. |
| `administration-login` | network.access + account.material + administration + grant → host/router privilege | Account's `admin-login`; one action per administration/grant pair. |

The routing/hosting associations in the table are static matching conditions,
not stochastic events. Hosts without suitable accounts can still have an exploit
route. A credential route requires both its material and reachable login surface.
The isolated administration zone does not become accessible just because it
has an administration association. If an administrator foothold or another
explicit route reaches it, its management route can become an alternative.

Generate the potential graph independent of defense switch values. Retain
blocked branches with their reasons, so comparisons preserve identities and
the owner can inspect what changed. No infinite path unrolling is used.

Generated IDs are escaped, structured tuples of rule ID and bound source IDs,
encoded unambiguously (source IDs cannot contain `/`). For example,
`action/service-login/admin-account/sshd` and `state/host/server/admin`.
Order by UTF-8 ID bytes for solver indices, with prerequisite IDs sorted too.
Renaming labels, reordering document maps or toggling a defense must not change
IDs, duplicate an action or change sampling slots.

Every fact/action carries provenance: library ID/version, rule ID/version,
entity IDs, association/flow IDs, exact source paths for parameter and switch
values, selected parameter status/expression/note, and rule assumptions. Logical
facts list all producer rules; policy-blocked actions name the permission or
distribution that blocks them. Missing knowledge names its source field.

The graph is a derived artifact, never another editable source of truth. The
wasm generation response includes graph schema/semantics versions and the
document revision it describes. JSON graph export includes provenance and the
source document snapshot. Editing a generated assumption follows its source
reference back to the architecture; regenerated nodes keep stable identities.

## 7. Sequential timing, cycles and reproducibility

For one sample, let `d(a)` be the duration drawn once for action `a`. A seeded
fact completes at zero. An unseeded fact with no completed producer is infinity.

```text
T(action) = max(T(prerequisite facts)) + d(action)
T(fact)   = min(T(producer actions), 0 if declared as a foothold)
```

An action starts once, when all prerequisites have completed, and may run
concurrently with other enabled actions. Infinity plus anything is infinity.
All nonlogical action prerequisites are nonempty. Only declared footholds and
explicit static policy constants can originate completion at zero. A chain with
durations 2 then 3 completes at 5; prerequisites completed at 2 and 7 followed
by duration 3 complete at 10. Independent alternative routes compete by earliest
completion. A shared completed action keeps its one completion time everywhere.

Architecture and generated dependency cycles are legal: host control may imply
application control, which implies a host privilege. Such a cycle is not
evidence that compromise happened. Completion must have a finite derivation
from a foothold or static policy input. Operationally start everything else at
infinity and propagate justified completions; an unseeded cycle, including a
zero-duration cycle, stays unreachable. Do not choose the spurious zero solution
of a circular equation and do not reject useful cycles wholesale.

Implement an iterative event queue: finalize facts/actions in nondecreasing
completion time; OR accepts its first finalized producer, AND waits for every
distinct prerequisite and adds its duration to their latest completion. Ties
use generated ID order. Each node finalizes at most once; each dependency is
visited finitely. This yields O((V + E) log V) work and O(V + E) memory per
sample. Predecessor witnesses point only to previously finalized nodes, including
zero-time ties, so explanations are acyclic even when the potential graph is not.
No recursion on document-sized input and no epsilon-based cycle breaking.

Use the existing ChaCha8 convention: 4096-sample chunks, stream = chunk index,
seed from the document, merge in chunk order, and libm for transcendental maths.
Generated actions get independent random windows addressed by iteration and
their stable sorted potential-graph slot. Defense scenarios use the same slot
table, including blocked actions. Changing a target or pruning a display must
not renumber sampling slots. The tree sampler remains untouched.

Compare only defense overlays of one architecture revision, so structural edits
cannot silently mispair streams. Structural edits invalidate the comparison.
Samples, seed, horizon, library version, graph semantics, active scenario,
parameter provenance and source snapshot accompany exported results. A duration
overflow is treated as beyond the finite horizon, never NaN or a panic. JSON
represents unavailable/unreached times with explicit status and `null`, never a
nonfinite JSON number.

## 8. Analyses, unknowns and limits

| Analysis | Generated-graph contract |
|---|---|
| Possible reachability and alternatives | Iterative forward closure and target-support subgraph under the selected policy. Unknown duration/policy is potentially traversable; known `Infinity`/blocked branches stay visible but do not establish reachability. This is qualitative possibility, not probability. |
| Target/step probability by horizon | Monte Carlo completion fraction with Wilson interval. Includes every sample, including failed attempts. |
| TTC CDF | Empirical unconditional CDF, 65 points from zero through horizon, pointwise Wilson bands, chart and table. No renormalization to successful attacks. |
| Route inspection | Full potential/support graph, blocked reasons, AND prerequisites, plus a representative successful sample's complete derivation. It is labelled `Sample route`, never “most likely path”. An AND witness contains all prerequisite branches, not just one path. |
| Defense comparison | Baseline and selected overlay CDFs, probability at horizon and a paired probability difference (§9). |
| Tree BDD exact CDF, MCS/SPOF, Birnbaum/FV, cost/detection Pareto, loss/EAL and cost-efficiency ranking | Unavailable for generated graphs in this milestone. The tree product-CDF identity does not hold for accumulated durations. UI hides those tabs or gives the specific capability reason; no approximation is presented as that analysis. |

Quantitative results are unavailable if an unknown active input can participate
in a possible derivation of the target. Return the relevant missing parameter
and switch paths; do not silently assume zero, infinity or a convenient number.
Unknowns outside target support, or on a policy-blocked route, do not suppress
the target solve. An unreachable target is reported as structurally unreachable
with probability zero; this is distinct from insufficient knowledge. A seeded
target has probability one at zero without needing unrelated parameters.

Known alternatives do not justify dropping an unknown alternative. The whole
target CDF then remains unavailable; qualitative inspection still works.
Per-step numbers are emitted only for steps whose own required inputs are
known; an available target result must not manufacture numbers for unknown
steps elsewhere. Reserve sampling slots for the whole potential graph even
when solving only a target's support subgraph.
Illustrative/assumed inputs propagate a visible result label and an assumption
list. Every numeric comparison identifies whether either side is illustrative.
Intervals quantify Monte Carlo sampling error, not confidence in the library
or calibration. No claim of exhaustive real-world attack coverage is made.

Initial hard limits: 500 architecture entities, 2,000 associations plus flows,
5,000 generated nodes, 20,000 generated dependencies, 100,000 samples and 16
stored comparison scenarios. Count before allocation/expansion; checked
arithmetic and diagnostics prevent panics. A generation limit yields no partial
graph that could be mistaken for complete coverage. Display at most 500 nodes
at once; a larger valid graph opens in target/component focus with visible
shown/total counts and a complete searchable step table. Filtering changes only
presentation. Solving remains cancellable between 4096-sample chunks.

Measure the actual lecture fixture at 10,000 samples in node-hosted browser wasm
and record elapsed time, graph size and artifact sizes. Target under one second
on the owner's current machine; report a miss and keep progress/cancel usable
rather than weakening semantics. Server/static-site operation must both work.

## 9. Defense scenarios

Baseline is the architecture as written. `scenarios` stores named, independent
overlays, each with `label` and `changes`. Each change names one typed target and
one switch: entity `patched`/`protected`, or a permission association `allowed`.
Replacement distributions remain in the source parameter slots. The baseline
and overlays share component identities, bindings, footholds, target and all
analysis settings. Scenarios do not inherit from each other.

```yaml
scenarios:
  patch-server:
    label: Patch SSH service
    changes:
      - {entity: sshd, defense: patched, value: true}
  restrict-ssh:
    label: Restrict SSH
    changes:
      - {association: allow-ssh, field: allowed, value: false}
```

Conflicting assignments to one switch within an overlay are errors. Changes
to the wrong entity kind or a missing permission are errors. Combined defenses
are one overlay with several changes. Editing the baseline's parameters or
structure clears stale results; scenarios continue to refer to validated IDs.

Solve baseline and selected scenario with paired samples. At each sample compute
`delta = I(target_base <= horizon) - I(target_scenario <= horizon)`. Positive
delta means reduced compromise probability. Report its mean and the two-sided
normal interval from the sample variance of paired differences, bounded to
[-1, 1]; with fewer than two samples, mark the delta interval unavailable.
Keep per-scenario Wilson intervals separate; do not subtract their endpoints.
The same seed alone is not sufficient: unchanged actions must use identical
draws across both runs. CDF overlays use the same time grid and horizon.

Show changed rules, still possible routes, and blocked routes beside the delta.
Patching may leave login; protecting credentials may leave the exploit route;
denying the only routed flow blocks both unless an explicit router-management
route defeats its permission. A scenario with unknown active replacement inputs
has an unavailable comparison, while a fully known baseline can still solve.
Do not rank the defenses or add marginal deltas as if combined effects were
additive. User-authored replacements can make an outcome worse; report that
result rather than imposing an unsupported dominance claim.

## 10. Browser workflow and quiet presentation

File → New gains `Architecture`, opening the empty architecture document. It
does not change a first visit into a prepopulated course exercise. File import,
export, source view, local persistence, undo/redo and encrypted snapshots support
both document variants. The architecture remains the canonical editable text.

Use the existing rail, custom dropdowns, property panel, context menus, keyboard
help, tokens and numerical alignment. Add entities through one type picker;
edit hosting/relationships/flows through the selected entity's panel and link
action. Foothold and target are concise state pickers on eligible components.
An empty or incomplete field displays `?`/`Unknown`; new TTC fields stay empty.
No native select/datalist, confirm dialogs, onboarding wall or vendor names in
product copy. Failures and blocked actions report through the existing notice.

Two workspace views, `Architecture` and `Attack graph`, share selection:

* Architecture view shows components, typed associations and directional flows.
  Hosting can be collapsed in the outline without changing the model. Selecting
  a component exposes its parameters, defenses, relationships and generated steps.
* Generate opens the attack view. It shows arrows prerequisite → action/result,
  explicit ALL/ANY junctions, foothold/target badges and blocked/unknown states
  with text and stroke patterns, not colour alone. Cycles are rendered as graph
  edges, without recursively expanding the outline.
* Selecting a step exposes its rule, bound components, active TTC and evidence
  note; `Source` selects its architecture entity/field. Selecting a component
  highlights its steps, retaining target and selection when switching views.
* Results offer probability and TTC; the comparison panel selects baseline
  and one named overlay and shows the changed settings and remaining routes.
  A table accompanies the overlaid CDF; line style and labels distinguish series.
  Importance colours from the tree profile are not assigned arbitrary meanings.

Generation/solve responses carry a revision token; stale responses after edits,
undo, target changes or document switches are discarded. Last valid source
behaviour remains as today, with a stale marker and solve disabled for invalid
current text. Existing tree keyboard handlers and result panels must not operate
on architecture selections. Every new key action has a visible/context-menu
equivalent and appears in `?`. The owner performs UI acceptance; agents provide
short numbered walkthroughs and do not drive a browser.

## 11. Acceptance fixture and evidence

The documentation fixture contains Client, Server and Administration networks;
a router with firewall; workstation and server hosts; an SSH client hosted with
user privilege and SSH service with admin privilege; a server account/credential;
an admin account/credential and admin-network management relationship; explicit
stores, authentication, grants and an allowed SSH flow through the router.
The attacker starts at `workstation.admin`; the target is `server.admin`.
The workstation foothold is documented as full compromise, while its SSH client
still executes as user. Administration is initially isolated.

Use horizon 100 days and seed 42. The fixture's explicit, **illustrative** inputs
are: connect `Exponential(2)`, exploit discovery `Exponential(0.1)`, patched
discovery `Infinity`, deployment `Exponential(0.5)`, extraction
`Exponential(0.2)`, protected extraction `Infinity`, login `Exponential(1)`
and admin login `Exponential(1)`. Each object carries its own evidence note;
the prose says that perfect blocking is an exercise assumption. The library
does not install these values. Add an unknown-parameter fixture and a partial
defense fixture using slower, finite replacements to demonstrate that the
model is not limited to perfect controls.

Automated acceptance must cover:

1. Strict document round trips, schema-1 tree migration without numerical
   change, extensions, invalid endpoint types/privileges/routes, deletion
   references, unknown library pins and empty architecture saves.
2. Deterministic generation and provenance for every rule; map reorder/label
   changes; shared services/credentials; no permission inferred from adjacency;
   isolated administration; user software cannot grant admin; root service can.
3. Exact duration-vector tests: chain 2+3=5; ALL prerequisites 2/7 plus 3=10;
   competing routes, shared actions, infinity, initial footholds, cycles with
   and without an entry, zero cycles and deep input without recursion.
4. Analytic distribution oracle: two sequential independent Exponential(1)
   durations have CDF `1 - exp(-t) * (1 + t)`; sampled estimates meet a stated
   statistical tolerance, while a corresponding tree AND retains its old CDF.
5. All-node/time and complete-result fingerprints frozen natively and asserted
   by the same tests under wasmtime. Node-hosted browser wasm parse → generate
   → stepped solve matches native graph/result JSON for the lecture fixture.
6. Relevant unknown parameters block numbers without hiding routes; irrelevant
   and blocked-route unknowns do not; seeded/unreachable targets; illustrative
   labels survive export and comparison; no NaN/nonfinite JSON.
7. Baseline has exploit and login alternatives; patch-only leaves login;
   protect-only leaves exploit; both block the fixture's two routes; denied
   SSH blocks both with administration isolated. Adding an authorized admin
   foothold/credential route demonstrates the documented firewall-bypass
   alternative. Finite replacement cases change the CDF, not just reachability.
8. Paired comparison equals a direct per-sample difference; a no-op overlay has
   exactly zero delta; unchanged action draws and identities match; combined
   scenarios, conflicting edits, stale revisions, cancellation and limits.
9. Pure JS editing, selection/provenance mapping, profile dispatch, result
   capability gating, source errors and persisted empty-document behaviour.

Per UI branch, supply a brief owner walkthrough before its fast-forward. Final
walkthrough, performed by the owner:

1. Start an empty architecture; build the three zones, router/firewall, two
   hosts and SSH software, then add their relationships, credentials and flow.
2. Mark the workstation compromised and server admin as target. Generate;
   inspect both exploit and credential routes and follow one rule to its source.
3. Fill or import the documented illustrative inputs. Solve and inspect the
   probability over time, uncertainty band, table and assumption labels.
4. Compare patching, credential protection, both, and denied permission;
   inspect the remaining or blocked routes and restore the baseline with undo.
5. Clear a relevant TTC, check `Unknown`, then restore it. Save/reopen, switch
   themes/views and verify old tree profiles still edit and solve normally.

Required checks remain `npm test`, `cargo test --workspace`,
`cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`
and `node scripts/check-roadmap.js`. Run `scripts/build-wasm.sh` before server
tests. Run solver tests under `wasm32-wasip1` with wasmtime and the browser-wasm
agreement check. CI must cover graph generation, timing and comparison, not
just the old tree fingerprints. Record exact commits and owner acceptance in
`docs/HANDOFF.md` and the lecture acceptance record.

## 12. Delivery decomposition and review checkpoints

The roadmap holds the authoritative branch-sized work items and dependencies:

| Item | Deliverable | Depends on |
|---|---|---|
| `architecture-document` | Typed schema, validation, migration, catalog and wasm document dispatch. | `successor-design` |
| `component-generation` | Versioned rules, generated graph/provenance, generation API and fixtures. | `architecture-document` |
| `sequential-simulation` | Iterative timing, graph results, paired scenarios and wasm stepping; native/wasm evidence. | `component-generation` |
| `architecture-editor` | Empty architecture creation and component/parameter editing, persistence and undo. | `architecture-document` |
| `architecture-links` | Typed associations, flows, privilege, foothold and target editing. | `architecture-editor` |
| `attack-graph-inspection` | Linked graph views, provenance, route inspection and CDF results. | `architecture-links`, `sequential-simulation` |
| `defense-comparison` | Scenario editing, CDF overlays, paired deltas and remaining routes. | `attack-graph-inspection` |
| `lecture-workflow` | Final course fixtures/docs, full verification, owner acceptance and released delivery. | `defense-comparison` |

The owner first reviews this written specification. After that review, write
and present the detailed implementation plan, including exact interfaces,
files, test-first steps and execution method, for the second review checkpoint.
This decomposition is the design's delivery outline, not approval of an
unwritten implementation plan. `successor-design` is removed only once its
required review and decomposition are complete. Implementation starts after
the plan review; broad scope is already settled and needs no further vote.

Documentation-only commits go directly to master and are signed. Each code
item has its own branch/PR, signed commit, all required local checks, successful
CI for that exact SHA, owner UI acceptance where applicable, local fast-forward
to master and release verification before the next code delivery. Remove each
roadmap item in its completing change. The final acceptance change removes
`lecture-workflow`, updates the handoff with exact evidence and leaves
`mal-securicad-compatibility` pending. Do not report the milestone complete while
the owner's walkthrough or release evidence is outstanding.
