# effractor — visual and ergonomic review, and what follows from it

Status: owner decisions of 2026-09-26 recorded; the work is the ROADMAP items
named in each section. Code references are to master at `7bf86ef`.

## 1. Where this comes from

On 2026-09-26 the owner asked for a deep look at inputs, required inputs, the
display of attacker paths, the colour coding of analytical information, and
where information is shown in which situation. Four read-only reviews of the
code (no browser: the owner looks, see `docs/HANDOFF.md`) found, in short:

- the analysis never comes back to the canvas: the one route is a table, the
  attack graph carries no numbers, a scenario changes nothing on either canvas;
- the route shown is the first sample that reached the target
  (`graph_mc.rs` keeps `counts.route` while it is `None`), not a typical one,
  and there are no alternatives;
- inputs lose typed text on a solve, `type=number` fields delete a value they
  cannot read, errors are said far from the field;
- the identity family's amber is the unknowns' amber (#8a5d1f vs #845b16), the
  accent means selection and eight other things, dash patterns mean several
  states at once, edges are 2.06:1 against the canvas;
- the headline card is thin (no target name, no horizon, no time), a blocked
  model's Results panel says "Calculate", the empty canvas says nothing.

## 2. Owner decisions (2026-09-26)

1. **Ranked routes: yes.** Supersedes lecture spec §8 "labelled `Sample route`,
   never most likely path" and `graph-results.js`' "no ranking of routes".
   Routes are ranked by how often they occur among successful samples — an
   empirical frequency, said as such, never "most likely path".
2. **Chokepoints: yes.** Supersedes lecture spec §8's "MCS/SPOF unavailable
   for generated graphs" for this one analysis. A chokepoint is exact and
   structural (qualitative possibility), not a probability approximation.
3. **Family colours: option (b).** Component plates become low-chroma; the
   icon carries the kind; saturated colour is reserved for states and the
   selection.
4. **Flows may be drawn differently** than dashed.
5. **The canvas switch may be renamed:** *Components | Attack graph* (the mode
   tab keeps *Architecture*).

## 3. Quick fixes — item `ui-quick-fixes`

- `.diagnostics li.is-blocking` uses the undefined `--color-fg`
  (`60-architecture.css:120`): `--color-fg-primary`.
- Unknown inputs and step sources say `W.path` words, the raw path in the
  tooltip (`attack-ui.js:109-113,147-148,260-265`, `comparison-ui.js:306-313`,
  `charts-ui.js:41-42`).
- `problems.js` hints by message, not only by kind: a service without a
  product is told "Tab adds its product", not "its host".
- Ctrl+Enter is in `COMMON_KEYS`; `#solve` has `title="Calculate (Ctrl+Enter)"`.
- A blocked architecture's Results panel lists what is left to finish
  (the chip menu's `problems.items` rows, each following) instead of
  "Calculate (Ctrl+Enter)…" (`attack-ui.js:384-397`).
- The dropdown chevron's hard-coded `#888` (`50-editor.css:151`) follows a
  token.

## 4. Inputs — item `form-inputs`

- **Keep what is typed.** The tree inspector, Controls and Assets rebuild on
  every `onChange` (`editor.js:1187-1192`, `controls.js:342-349`); a solve
  arriving mid-typing wipes the field. One shared helper carries the
  architecture's `formKey`/`sameKey` guard and value-and-caret restore
  (`architecture-ui.js:627-657`).
- **One numeric field.** `type=text inputmode=decimal`; a comma reads as a
  point; what does not read is refused *at the field* and never means
  "remove the key" (`editor.js:652-654`). Clearing a field is the only way to
  remove a value.
- **Errors at the field.** A refused edit shows its reason under the field
  (as `#horizon-error` does), the field reverts; the notice keeps undo
  messages. A `.field-problem` style.
- **One convention.** Chance in % everywhere; labels say meaning (Chance,
  Time, How often, Noticed), not file keys; one "not said" word for an empty
  dropdown; Average time gets the unit picker the rate has; the rate has one
  field, not two.
- **One key rule.** Esc reverts the field and leaves it, Enter commits and
  leaves; one `field()` helper replaces the three copies (`editor.js:627`,
  `architecture-ui.js:429`, `controls.js:86`). Esc on a parameter draft
  collapses it and keeps the draft; Cancel drops it and says so.
- **Architecture parameters show Time at once**, Confidence after it.
- **What is left** is visible before Calculate: a ■ badge on a blocked
  component and its outline row; the chip counts "n to finish · m unknown"
  and its menu lists both. No target / no foothold opens a picker, never the
  source. Moving the target says from where.
- Validator wording in the form's words (a message map in `problems.js`,
  keyed by code and path), the file text in the tooltip.

## 5. Following a step — item `step-navigation`

- `renderer.center(id)` pans in both axes (short ease, reduced motion
  respected) for every "show step" and re-window; today `reveal` pans only
  left (`renderer-svg.js:755-777`).
- A selected step lights its derivation back to its inputs, nodes and exact
  edges (edge ids reach `applyHighlights`).
- The attack graph shows the target's support by default
  (`support.target_support`, computed and never read today), "+n elsewhere"
  and one switch for everything; the 500-step window grows from the target
  towards prerequisites only.
- Keys: in the attack view ↓ a prerequisite, ↑ a dependent (a menu when
  several); `[` / `]` previous / next step of the shown route, in both views.
  All in `?`.
- A step selected before a view round trip is selected again after it.

## 6. Ranked routes — item `ranked-routes`

**Meaning.** A *route* is the set of steps in a successful sample's
derivation (`EventPlan::derivation`, AND branches whole). Two samples take the
same route when their derivations have the same steps. A route's *share* is
the fraction of samples reaching the target by the horizon that took it.
Shown: the three routes with the largest share, then "n other routes · x%".

**Solver.** Per side and chunk, a map from a 64-bit hash of the derivation's
sorted node indices (a fixed hash, e.g. FNV-1a — never `RandomState`) to
{count, first sample}. Chunks merge in index order: counts add, the smaller
first sample stays. At finish the top three (share, ties by first sample) are
re-evaluated from their first sample — draws are addressed by iteration, so
one sample recomputes exactly — for their derivation and times. Native and
wasm agree bit for bit; the existing witness becomes route 1's example or is
replaced by it (a fingerprint move, intended, recorded). Cost: one derivation
per successful sample; the plan names a guard if it shows in timings.

**Page.** Results: "Routes" — each a row "Route A · 62%", its steps (attacker
actions only; facts and zero-time inputs under a disclosure, "starts on
Workstation"), the example's target time. Choosing a route draws it:

- **Architecture overlay:** components on the route get the accent halo and
  an order number on the plate (1, 2, 3 by first completion), the flows used
  are lit, the rest recedes. Members of a closed cluster light the cluster.
- **Attack graph:** the route's nodes and exact edges lit, the rest recedes.
- Row clicks light on the current canvas instead of switching views; `[`/`]`
  step through it.

The scenario's routes (the solver already returns a scenario witness) are
listed beside the baseline's in Compare.

## 7. Chokepoints — item `chokepoints`

**Meaning.** A step is a chokepoint when the target is not possible once that
step is blocked, under the selected policy and scenario: every derivation
passes through it. A component is a chokepoint when one of its steps is.
Exact, from the forward closure (`graph_support`), no sampling.

**Solver.** For each possible action step in the target's support, the
closure with that step blocked; iterative, no recursion. The plan fixes a size
guard and says "not checked above n steps" rather than being slow.

**Page.** A step tag "every route"; a component mark on the architecture (a
notch or double ring in `--state-choke`, a neutral ink, not a hue already
taken; judged by eye); a list "Every route passes" in Results, each item
following. In Compare, a defence on a chokepoint says "blocks every route".

## 8. Headline and background graph — item `headline-card`

- The card says what and by when: "P(Wallet · admin) by 100 d" (target name
  shortened, full in the tooltip) and, for architectures, a second line
  "50% by 3.1 d" (`GR.timeTo`).
- Stale says so in place: "outdated · Ctrl+Enter", or "not calculated · n to
  finish"; Compare fades like the other tabs.
- With a scenario chosen and current: "scenario: P · Δ".
- Click opens Results; right-click offers Show target, Show route, Time,
  Compare.
- Calculate keeps the panel's current analysis tab (Results, Time, Compare)
  instead of forcing Results.
- The attack graph is regenerated in the background after each accepted text
  (own gate channel), so step lists, route labels and Compare never ask to
  "Build" (`app.js:601` drops it today).
- A component shows one quiet result fact ("reached: P(admin) 0.42"); a
  parameter the headline rests on carries a dot.
- The analysis chip is empty or "calculated" when current; samples and seed
  in its tooltip.

## 9. Colour and line grammar — item `colour-grammar`

**States own the saturated hues; nothing else uses them.**

| Token | Meaning | Line |
|---|---|---|
| `--state-selected` (accent) | the selection | solid 2.5 |
| accent | lit because related (cut set, route, via, steps, Pareto) | dashed 2 |
| `--state-vulnerable` (danger) | unpatched product | ring |
| `--state-exposed` | runs it | ring |
| `--state-unknown` (warning) | a value owed | dashed `5 3`, always |
| `--state-blocked` (outline) | blocked, prevented | dotted `1.5 3` |
| `--state-unreachable` | cannot happen | faded (.45), no dash |

- **Families (decision 3):** four plates at chroma ≈ 0.04 (OKLCH), hues kept
  apart, each ≥ 3:1 under its white glyph and against the canvas, in both
  themes; the icon carries the kind. `scripts/check-contrast.js` gains the
  pairs, and a minimum colour-blind distance between every family and every
  state hue.
- **Lines:** `--viz-edge` to ≥ 3:1 on the canvas (proposed #8c8579 / #62687b),
  also for the "none" sector and cluster outline.
- **Flows (decision 4):** traffic, not structure — solid, slightly heavier
  than a relationship, with small direction chevrons along the line; the
  label as today. Relationships stay thin with an end arrow; permissions stay
  dotted with their dot (lines, not states, and only in the components view).
  Judged by eye; the legend follows.
- **Charts:** `--viz-series-baseline` / `--viz-series-scenario`; legends are
  small line samples in the series' stroke and dash, not glyphs; ticks at
  round steps, probabilities as %, times and amounts with digit grouping
  (`results-view.js` `number()` today prints `4.38e+3`, `0.250`).
- One selected-row treatment: bg-active plus the 2px accent bar.
- Muted text on hover/active grounds steps up to secondary where missing.
- The suggestion bulb leaves amber (fg-secondary).
- Importance colours stay the tree's (lecture spec §10).

## 10. Start, naming, legend — item `canvas-start`

- Canvas switch *Components | Attack graph* (decision 5).
- An empty canvas says one line: "A adds a component · right-click for more";
  the outline's empty text says the same.
- File › Examples › (by mode) opens the shipped examples; opt-in as before.
- The legend shows a ring only when a node carries it; toggles stay.
- nmap Add says what came in ("12 hosts · 3 unpatched · Ctrl+Z undoes") with
  "Show vulnerable" selecting them.

## 11. A lighter attack graph — item `attack-graph-density`

- A fact with a single producer folds into it (a second label line), boxes
  stay where there are real alternatives.
- Seeded steps (the attacker has them at once) get a light owned mark and a
  legend entry; the legend covers foothold, target, unreachable.
- Tags and badges fit the node (ELK is given their width, or they sit under
  the box).
- ELK's model order is off for generated graphs.
- Re-windowing keeps drawn positions or glides.

## 12. Big models — item `model-find`

A find field over the outline (components by name and kind), rows grouped
under their clusters, the kind as its icon.
