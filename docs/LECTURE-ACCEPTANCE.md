# Lecture workflow acceptance record

The first successor milestone: architecture → generated attack graph →
simulation → defence comparison, on the lecture's SSH exercise
(`extract.pdf`, printed pp. 112–134, sections 5.3–5.5; the extract stays
outside the repository). Design: lecture spec §11, read from history as
`docs/HANDOFF.md` says.

**State, 2026-09-29: the automated evidence below is complete; the owner's
walkthrough is outstanding.** The milestone is not complete until it is
recorded here.

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

Outstanding. The five steps of spec §11, against the final candidate:

1. Start an empty architecture; build the three networks, the router and its
   firewall, the two hosts and the SSH software, then their relationships,
   the accounts, the keys and the flow.
2. Set the workstation as foothold and the server's admin control as target.
   Open the attack graph; find the exploit path and the login path, and
   follow one step to where its time is set.
3. Fill in or open the documented times. Calculate; read the probability
   over time, its band, the table and the assumptions.
4. Compare patching, protecting the key, both, and the denied flow; read
   what is blocked and what remains; return to the baseline.
5. Clear a time that matters and see *unknown*; restore it. Save and reopen,
   switch theme and view, and see that a fault tree and an attack tree still
   edit and calculate. A new browser profile still opens an empty document.

What the owner checked, and what they said, is recorded here when it has
happened.

Known before the walk (review of `39ecb20`): the spec's step 4 says *restore
the baseline with undo*. Choosing a scenario is a choice of the workspace,
not an edit, so undo does not take it back; *nothing · baseline only* in
Compare does. Undo takes back edits to a scenario. Whether the page should
do as the spec says is the owner's to decide.

## Known limits

- The numbers are this library's, from illustrative inputs; agreement with
  the lecture's screenshots is not claimed and was not an acceptance
  criterion.
- Perfect blocking (`Never`) is an assumption of the exercise. The partial
  file shows finite replacements.
- Compare sets the baseline against one scenario; two scenarios are not
  compared with each other.
- Existing securiCAD and MAL models are not read: `mal-securicad-compatibility`
  is the roadmap's next item.
