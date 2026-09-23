# effractor — readable time notation

Date: 2026-09-23 · Status: approved by the owner, 2026-09-23

## 1. Purpose

A time-to-compromise is written today in MAL's notation:
`Bernoulli(0.5) * Exponential(0.08)`. Two parts of it are unreadable to
the people effractor is for: `Bernoulli(p)` hides "succeeds with probability
p" behind a statistician's name, and `Exponential(λ)` takes a rate where people
think in average times (0.08 per day is 12.5 days). The notation appears in
every example, in the course files and in the YAML source panel, so the app
cannot hide it by translating it on screen alone.

This change gives effractor's files their own spelling of exactly those two
things. Everything else stays: the other distributions, their parameters, the
solver and every result.

## 2. The notation

| Today (MAL) | effractor |
|---|---|
| `Bernoulli(0.3)` | `30%` |
| `Bernoulli(0.5) * Exponential(0.08)` | `50% * Exponential(mean 12.5)` |
| `Exponential(0.08)` | `Exponential(mean 12.5)` |
| `Bernoulli(0.25) * Gamma(2, 4)` | `25% * Gamma(2, 4)` |
| `Infinity`, `Enabled` | `Never` |
| `Zero`, `Disabled` | `Immediate` |
| `HardAndCertain` and the other five presets | written out, e.g. `Exponential(mean 10)`, `50% * Exponential(mean 10)` |

* A chance is a number from 0 to 100 followed by `%`. A bare number is not a
  chance: it stays what it is today, a constant loss magnitude.
* `c%` alone is a TTC that succeeds at once with chance c, and never
  otherwise. `c% * D` succeeds with chance c and then takes a time drawn from
  D. The right side of `*` is a time distribution, as today.
* `Exponential` takes only `mean m` (m > 0, in the model's time unit).
* `Gamma`, `LogNormal`, `Pareto`, `TruncatedNormal`, `Pert` keep their
  spelling and parameters.
* The MAL spellings (`Bernoulli`, `Exponential(rate)`, the named presets,
  `Enabled`, `Disabled`, `Infinity`, `Zero`) are errors in an effractor file,
  with a message that gives the effractor spelling. There is no migration
  (owner, 2026-09-23: no legacy).

## 3. Where it lives

* **Internal model unchanged.** `effractor_core::Distribution` keeps
  `Bernoulli(p)`, `Exponential(rate)` and `Product`. `mean m` is read as
  `rate = 1/m`. For the values in use (1, 10, 100, 12.5 …) this is the same
  f64 as today's written rate. The solver, its sampling and every frozen
  fingerprint are untouched. CI proves it, because the fingerprints build their
  distributions directly and must not move.
* **Round trip.** The canonical writer prints the shortest decimal `m` for
  which `1/m` gives back the stored rate exactly, and the shortest `c` for
  which `c/100` gives back the stored probability. So `mean 12.5` saves as
  `mean 12.5` and never as `12.499999999999998`.
* **Own parser.** The effractor spelling gets a small hand-written parser and
  writer in `effractor-format`: pure, no recursion on input, and diagnostics at
  the character as today. `effractor-mal` keeps MAL's spelling for the future
  `mal-securicad-compatibility` import, which translates on the way in. The
  document reader, the canonical writer and the wasm `ttc_sketch` use the
  format's parser.
* `Distribution::Named` is no longer produced by the format. It remains
  available to the MAL import, and the writer writes its expansion.

## 4. The page

* **Timing form.** Chance (%) and Average time (in the model's unit) cover
  `c% * Exponential(mean m)`, `Exponential(mean m)` and `c%`. *Never*,
  *Immediate* and *Custom…* (free text, for Gamma and the rest) complete the
  picker. The presets become choices that fill both fields. The field under
  them shows the written expression, which is now readable itself.
* A fault-tree leaf's `p`/`rate` are shown as `30%` / `Exponential(mean 10)`
  wherever the page shows them as an expression today. The fields `p:` and
  `rate:` themselves are unchanged: reliability engineers use failure rates.
* Wherever a TTC is displayed (step inspector, assumptions table, tree
  properties, tooltips), it is the expression as written.

## 5. Content

A one-off script rewrites the 16 examples, the templates and the course files
through the old parser and the new writer. No example's results change.
The previous notation is removed from the v1 specification's distribution
section, the lecture specification, README and HANDOFF.

## 6. Tests

* Parser/writer: every form in §2 round-trips; each MAL spelling is refused
  with the replacement named; errors carry the right column; `mean`, `%` and
  domain errors (101%, -5%, `mean 0`) are diagnosed; 0% and 100% are valid.
* The shortest-decimal writer, on a spread of rates and probabilities,
  including ones with no short decimal (1/3).
* All examples: parsed with the old grammar before the rewrite and with the new
  one after, they give identical `Distribution` values. The solver snapshots do
  not change.
* JS: the timing form's two fields ↔ expression, as pure functions under
  `node --test`; the page itself by the owner's look.

## 7. Out of scope

Plain-language forms of Gamma/LogNormal/Pareto/TruncatedNormal/Pert, the
fault tree's `p`/`rate` fields, and time units inside expressions
(`mean 12.5 d`). The model's `time_unit` remains the unit.
