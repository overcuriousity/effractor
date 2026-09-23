# Roadmap

Remaining work for effractor, as a DAG. The existing tree profiles are specified
in `docs/superpowers/specs/2026-09-20-effractor-v1-design.md`; the approved
successor design is linked below. How work lands is in `CONTRIBUTING.md`.

Approved successor spec:
[`2026-09-21-lecture-workflow-design.md`](docs/superpowers/specs/2026-09-21-lecture-workflow-design.md).
The [implementation plan](docs/superpowers/plans/2026-09-21-lecture-workflow.md)
was reviewed by the owner on 2026-09-22, who chose native in-session execution:
one feature branch per task, a pause for the owner at each task boundary. The
items below are its delivery decomposition. Plan tasks 1
(`architecture-document`), 2 (`component-generation`), 3
(`sequential-simulation`), 4 (`architecture-editor`), 5
(`architecture-links`) and 6 (`attack-graph-inspection`) are done; the rest map
as defense-comparison = 7, lecture-workflow = 8. `library-extension` was added
by the owner on 2026-09-23 and comes before defense-comparison, so comparisons
cover its defenses from the start.
"securiCAD parity" in the owner's words means `lecture-workflow`, not the later
`mal-securicad-compatibility`.

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

### readable-time-notation — Chances and average times instead of Bernoulli and rates
needs: —            cost: 2   benefit: 3
Implement the approved
[readable time notation](docs/superpowers/specs/2026-09-23-readable-time-notation-design.md):
`30%`, `50% * Exponential(mean 12.5)`, `Never`, `Immediate` in effractor files,
MAL spellings refused with their replacement, the internal model and every
fingerprint unchanged, examples and course files rewritten, and a timing form
with Chance and Average time. Done when the spec's tests pass and the owner
accepts the timing form in the browser.

### library-extension — Virtualisation, shared vulnerabilities, people, MFA, data
needs: —            cost: 4   benefit: 5
Extend the component library in place (owner, 2026-09-23: no versioning, no
legacy to keep), oriented on securiCAD's coreLang and on modern architectures.
Principle: a defense switch never changes the graph's structure; it switches
an input or selects a replacement duration, so step ids pair across scenarios.
Design approved by the owner so far (section 1):
- `hosts: host → host` for VMs and containers, `privilege` = what the guest
  runs as on the host; host control at it gives guest admin (logical); an
  `escape` action (guest slot `escape`, unknown until set) gives the host back;
  routers on hosts get the same escape. Nested hosting allowed, cycles errors.
- `product` kind (one software version) with `find-exploit`,
  `find-exploit-patched` and `patched`; `instance-of: service → product`. Any
  reachable instance starts one shared discovery; each instance keeps its own
  deploy. A partly patched fleet is two products. Services only.
Still to design with the owner before a spec (sections 2–3): people and
phishing (securiCAD's User: phishing to credentials or code on their
workstation, with a training defense), multi-factor login (an MFA-satisfied
fact from a policy input, a second-factor credential or a timed bypass), and
data as a target (read/modified, held by hosts/software, encryption as an
input plus key possession). Then a written spec amending
`2026-09-21-lecture-workflow-design.md` §4–6, a plan, and branch-sized delivery.
Done when every addition is generated, solved and inspectable, its rules and
assumptions are in the catalog, and the owner accepts it in the browser.

### defense-comparison — Inspect defense changes and remaining alternatives
needs: library-extension            cost: 3   benefit: 5
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
