# Lecture workflow acceptance record

The first successor milestone: architecture → generated attack graph →
simulation → defence comparison, on the lecture's SSH exercise
(`extract.pdf`, printed pp. 112–134, sections 5.3–5.5; the extract stays
outside the repository). Design: lecture spec §11, read from history as
`docs/HANDOFF.md` says.

**Closed 2026-09-30, as scoped.** The automated evidence is below; the owner
walked the lecture extract itself against the page and chose to close the
milestone on the exercise as it is, with the gaps found recorded here and
`host-products` opened on the roadmap for the one that matters most.

## What was checked against

- Code: release `v0.1.0+2dcb068` (CI and release green for `2dcb068`). The
  change that adds this record, the two course files, the course text and
  the performance script changes no code the page or the solver runs.
- Library `core-components` 1, semantics `sequential-1`.
- Fixtures: [`course/lecture-architecture.yaml`](course/lecture-architecture.yaml),
  [`course/lecture-partial-defenses.yaml`](course/lecture-partial-defenses.yaml),
  [`course/lecture-unknown.yaml`](course/lecture-unknown.yaml); seed 42,
  10,000 samples, horizon 100 days. Every time in them is an exercise
  assumption, marked illustrative.
- Host: Linux x86_64, AMD Ryzen AI 7 350; rustc 1.95.0, Node v22.22.3,
  wasmtime 48.0.2.

## Automated evidence

Run on the candidate tree after `scripts/build-wasm.sh`, all passing:

| Check | Result |
|---|---|
| `npm test` | 906 tests, 905 pass, 1 skipped, 0 fail |
| `cargo test --workspace` | 69 test binaries, all ok |
| `cargo fmt --all --check` | clean |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean |
| `node scripts/check-roadmap.js` | ok |
| `cargo test --target wasm32-wasip1 -p effractor-solver` under wasmtime | all ok, frozen fingerprints included |
| `node scripts/check-graph-agreement.js` | 12 cases, native and browser wasm the same text, the partial file's `both` among them; no stale fixture |
| `scripts/build-site.sh` | static export built |

What the course files are held to (`crates/effractor-solver/tests/course_files.rs`):
the unknown and the partial file are the exercise's text with exactly the
replacements their names say; a partial defence leaves its step and the target possible and
slower; both together lower the target without closing it, with a paired
interval above zero; a denied flow closes the partial file too; and every
number in the course text's table is what the solver says.

The spec's nine classes of automated acceptance (§11) are covered by the
tests of plan tasks 1–7, which landed with them; they ran again in the checks
above.

## Performance

`node scripts/check-graph-performance.js [file] [scenario]`: the browser's
wasm module under Node, the lecture file generated and sampled with 10,000
samples, the baseline and one scenario measured apart, each in a module of
its own, one cold run and five warm. Generation is parse, validation,
generation and serialization; the solve is parse, generation, sampling, the
comparison and serialization; loading and instantiating the module is not
timed. The graph has 39 nodes (11 steps, 24 states, 4 inputs) and 48
dependencies.
The bundle is 1,381,823 bytes of wasm and 14,002 of JavaScript.

| File | Measured | Cold: generate / solve | Warm: generate | Warm: solve |
|---|---|---|---|---|
| exercise | baseline | 14.7 / 34.9 ms | 1.4–2.1 ms | 28.5–29.3 ms |
| exercise | `both` | 2.1 / 45.2 ms | 1.3–1.9 ms | 44.7–46.5 ms |
| partial defences | baseline | 14.7 / 34.6 ms | 1.5–2.2 ms | 28.8–29.5 ms |
| partial defences | `both` | 1.9 / 58.1 ms | 1.3–2.1 ms | 57.3–58.2 ms |

Every run is inside the target of one second for generation and solve
together. The second module's first run is not as cold as the first's: the
runtime has compiled the same bundle once already. These are Node timings;
the page adds drawing, which is not measured here.

## Owner walkthrough

Done 2026-09-30 by the owner, on the preview of `ac3705a`
(`v0.1.0+ac3705a`), not along the five steps of spec §11 but along the
reference itself: the extract's sections 5.3–5.5, figure by figure, rebuilt
in the page. The owner's finding: section 5.3.3 (the administration zone,
the router's access control and firewall, the account with root on the
router) could not be reproduced as the extract draws it, and asked whether
that was the model being better or the model lacking freedom. The answer,
verified against the catalog and every figure of the extract:

| The extract | effractor | |
|---|---|---|
| Admin LAN — *Administration* — Router (5.17) | `administration`: Administration network *managed from here* → Router | same |
| Router — *Firewall execution* — Firewall (5.18) | `filters` | same |
| Router — *Authorization* — AccessControl; AccessControl — *Root Authorization* — UserAccount (5.19) | no access-control object; the account *grants it admin* → Router | same meaning, one object fewer |
| Elements hidden inside the router (5.20, 5.21) | a cluster (K) opens and closes | similar; a cluster is a way of looking, not containment |
| IDS, IPS on the router (5.18) | none; getting past detection is inside *Use the exploit* by assumption | gap |
| *Ubuntu Linux*, *Windows 7*, *RHEL 7.2*, *putty* as software products on hosts and clients (5.28, 5.35) | `instance-of` only from a service; a host or application has no product | **gap** → `host-products` |
| Host defences ASLR, AntiMalware, DEP, Hardened, HostFirewall, StaticARPTables (5.37) | a host has no defence switch; only a product is patched | gap; HostFirewall is half of the dropped `firewall-denies` |
| Attack steps ARPCachePoisoning, BypassAntiMalware, BypassIDS, DenialOfService, PhysicalAccess, PrivilegeEscalation, USBAccess (5.33, 5.34) | none; no user-to-admin escalation step on a host | gap, securiCAD's breadth |
| An attacker object with a chosen entry step (5.33, 5.35) | the foothold pin with a state (host: user / admin; network: access) | same for *Compromise*; fewer entry states |
| Named views of one model (5.27) | one canvas, clusters | gap, presentation only |
| Zones, router, dataflow with route and the firewall's permission (5.31, 5.32); non-root client execution (5.25); the TTC curve with percentiles (5.34); the most probable path (5.36); a defence switch per component (5.37) | the same | same |

The owner's ruling (2026-09-30): the differences are the small library the
design chose, not a better model; close the milestone on the exercise as it
is, record the gaps, and open `host-products` for products on hosts and
applications with a host defence or two. `mal-securicad-compatibility` is
where the rest of securiCAD's vocabulary is met.

The spec's step 4, *restore the baseline with undo*: choosing a scenario is
a choice of the workspace, not an edit, so undo does not take it back;
*nothing · baseline only* in Compare does. The page was left so; the owner
did not ask for a change.

## Known limits

- The numbers are this library's, from illustrative inputs; agreement with
  the lecture's screenshots is not claimed and was not an acceptance
  criterion.
- Perfect blocking (`Never`) is an assumption of the exercise. The partial
  file shows finite replacements.
- A host or an application has no product, so no operating-system route; a
  host has no defence switch (`host-products` on the roadmap).
- Compare sets the baseline against one scenario; two scenarios are not
  compared with each other.
- Existing securiCAD and MAL models are not read: `mal-securicad-compatibility`
  is the roadmap's next item.
