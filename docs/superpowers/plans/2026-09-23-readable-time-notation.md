# Readable Time Notation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** effractor files write a time-to-compromise as `30%`, `50% * Exponential(mean 12.5)`, `Never`, `Immediate` instead of MAL's `Bernoulli(p)`, rates and preset names, and the page edits it as Chance + Average time.

**Architecture:** `Distribution` gains `ExponentialMean(m)`, sampled with the rate `1/m` so that it draws the same bits as `Exponential(1/m)`. A new pure module `effractor_format::expr` parses and writes the effractor spelling; every place that reads or writes an expression in effractor's own formats uses it, and `effractor-mal` keeps MAL's spelling for the future import. A one-off example binary rewrites every file through MAL's parser and the new writer, checking equivalence as it goes.

**Tech Stack:** Rust (workspace crates `effractor-core`, `-format`, `-mal`, `-solver`, `-components`, `-wasm`), proptest, plain JS under `node --test`.

**Spec:** `docs/superpowers/specs/2026-09-23-readable-time-notation-design.md`

## Global Constraints

- The solver stays bit-identical native vs wasm: transcendental maths through `libm` only, never `std` float functions or `powi`.
- Nothing recurses on user-sized input. The expression grammar has one level (`term (* term)?`) and needs no recursion. The writer recurses only on `Product`, whose inner side is never a `Product` (`check_params` refuses one).
- Frozen fingerprints must not move. They build `Exponential(rate)` directly. `UPDATE_SNAPSHOTS=1` may rewrite only expression *text* in result JSON, never a number.
- No legacy (owner, 2026-09-23): MAL spellings are errors in effractor files, with no migration path. The error names the replacement.
- UI copy is a few words, never names other products (no "MAL", no "securiCAD" on the page).
- Checks before any PR: `npm test`, `cargo test --workspace`, `cargo fmt --all --check`, `cargo clippy --workspace --all-targets -- -D warnings`, `node scripts/check-roadmap.js`, `node scripts/check-graph-agreement.js` (after `scripts/build-wasm.sh`).
- Stage files by name, never `git add -A`. Commits end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Landing: PR → wait for `ci.yml` on the exact SHA (`scripts/dev/wait-ci.sh`, unpiped) → the **owner** runs `git push origin <sha>:master` (the agent's push is refused here) → wait for `release.yml`. Never GitHub's merge button.

## Review Focus

1. **A chance written with spaces or a decimal comma** (`50 %`, `12,5%`). Expect: `50 %` is accepted (whitespace before `%`), and `12,5%` is refused at the comma with "use a decimal point". Pinned in Task 2.
2. **A chance of exactly 0% or 100%, and a mean in exponent notation** (`0%`, `100%`, `Exponential(mean 1e-12)`). Expect: valid, and written back unchanged. Pinned in Task 2.
3. **Old spelling pasted into the source panel or a TTC field** (`Bernoulli(0.5) * Exponential(0.1)`). Expect: an error at column 1 naming the replacement (`50%`), and nothing silently accepted. Pinned in Task 2 and Task 3.
4. **A chance on the wrong side** (`Exponential(mean 5) * 50%`). Expect: refused with "write the chance first", not reordered silently. Pinned in Task 2.
5. **A value the rewrite tidies** (`Exponential(0.03)` → `mean 33.3`). Expect: listed by the tool, and it is the only kind of change to example results. Pinned in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `crates/effractor-core/src/distribution.rs` | `ExponentialMean(f64)` variant, domain and role checks |
| `crates/effractor-solver/src/dist.rs` | sample/cdf for `ExponentialMean` |
| `crates/effractor-mal/src/lib.rs` | MAL writer handles `ExponentialMean` (as `Exponential(1/m)`) |
| `crates/effractor-format/src/expr.rs` (new) | effractor spelling: `parse`, `write`, `ParseError` |
| `crates/effractor-format/src/{lib,lower,write}.rs` | use `expr` |
| `crates/effractor-solver/src/graph_results.rs`, `crates/effractor-components/src/export.rs`, `crates/effractor-wasm/src/api.rs` | quote/parse with `expr` |
| `crates/effractor-format/examples/rewrite_ttc.rs` (new, one-off) | rewrite files, verify equivalence, list tidied values |
| `assets/js/ttc.js` | presets, `split`/`join`, the Chance/Average time form |
| `assets/js/editor.js` | fault-tree `p`/`rate` shown in the new spelling |

Two PRs: **PR A** is Tasks 1–5, the format change with every file rewritten; it must land atomically, or the examples stop loading. **PR B** is Task 6, the timing form, which the owner looks at first.

---

### Task 1: `ExponentialMean` in the model and the solver

**Files:**
- Modify: `crates/effractor-core/src/distribution.rs`
- Modify: `crates/effractor-solver/src/dist.rs:94-170`
- Modify: `crates/effractor-mal/src/lib.rs` (`to_expr`)
- Test: `crates/effractor-solver/tests/dist.rs`, `crates/effractor-core/tests/validate.rs`

**Interfaces:**
- Produces: `Distribution::ExponentialMean(f64)` (the average time in model units, > 0). `effractor_solver::dist::{sample, cdf}` treat it as rate `1.0 / m`.

- [ ] **Step 1: Write the failing tests**

Append to `crates/effractor-solver/tests/dist.rs`:

```rust
/// An average time draws exactly what the rate 1/m draws: the file's new
/// spelling changes no result wherever 1/m is the rate written before.
#[test]
fn a_mean_draws_the_same_bits_as_its_rate() {
    use rand::SeedableRng;
    for (mean, rate) in [(10.0, 0.1), (12.5, 0.08), (1.0, 1.0), (500.0, 0.002)] {
        assert_eq!(1.0 / mean, rate, "the fixture pairs are exact");
        let mut a = rand_chacha::ChaCha8Rng::seed_from_u64(7);
        let mut b = rand_chacha::ChaCha8Rng::seed_from_u64(7);
        for _ in 0..1000 {
            let x = sample(&D::ExponentialMean(mean), &mut a);
            let y = sample(&D::Exponential(rate), &mut b);
            assert_eq!(x.to_bits(), y.to_bits());
        }
        for t in [0.0, 0.5, 3.0, 40.0] {
            assert_eq!(cdf(&D::ExponentialMean(mean), t).to_bits(), cdf(&D::Exponential(rate), t).to_bits());
        }
    }
}
```

Match the file's existing imports (`use effractor_core::Distribution as D; use effractor_solver::dist::{sample, cdf};`). If they differ, adapt the `use` lines at the top, not the test body. Check `Cargo.toml` for how the other tests in this file build the RNG and copy that construction if it isn't `ChaCha8Rng::seed_from_u64`.

Append to `crates/effractor-core/tests/validate.rs`:

```rust
#[test]
fn a_mean_must_be_positive_and_is_a_time_or_a_magnitude() {
    use effractor_core::Distribution as D;
    assert!(D::ExponentialMean(12.5).check_params().is_ok());
    assert!(D::ExponentialMean(0.0).check_params().unwrap_err().contains("mean"));
    assert!(D::ExponentialMean(-1.0).check_params().is_err());
    assert!(D::ExponentialMean(f64::INFINITY).check_params().is_err());
    assert!(D::ExponentialMean(3.0).check_ttc().is_ok());
    assert!(D::ExponentialMean(3.0).check_magnitude().is_ok());
    assert!(D::Product(0.5, Box::new(D::ExponentialMean(3.0))).check_params().is_ok());
}
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -q -p effractor-solver --test dist a_mean && cargo test -q -p effractor-core --test validate a_mean`
Expected: compile error, "no variant named `ExponentialMean`".

- [ ] **Step 3: Implement**

In `distribution.rs`, add the variant after `Exponential(f64),`:

```rust
    /// The average time, as an effractor file writes it. Sampled with the
    /// rate `1/m`, so it draws exactly what `Exponential(1/m)` draws.
    ExponentialMean(f64),
```

In `check_params`, after the `Exponential` arm:

```rust
            Self::ExponentialMean(mean) => positive("mean", *mean),
```

`positive` already refuses 0, negatives, NaN and infinity. `check_ttc` and `check_magnitude` match only the variants they refuse, so the new one is accepted by both with no edit. Confirm by reading them.

In `crates/effractor-solver/src/dist.rs`, in `sample`:

```rust
        D::ExponentialMean(mean) => -log(uniform(rng)) / (1.0 / mean),
```

and in `cdf`:

```rust
        D::ExponentialMean(mean) => -expm1(-(1.0 / mean) * t),
```

Both are written so that the rate is computed first and then used exactly as the `Exponential` arm uses it. That is what makes the bits match. Do not simplify them to `-log(u) * mean`.

In `crates/effractor-mal/src/lib.rs`, `to_expr`:

```rust
        D::ExponentialMean(mean) => call("Exponential", &[1.0 / mean]),
```

- [ ] **Step 4: Fix every other exhaustive match**

Run: `cargo build --workspace --all-targets 2>&1 | grep -A3 "non-exhaustive"`
For each site, treat `ExponentialMean(m)` like `Exponential(1.0 / m)`. The known ones are `crates/effractor-solver/src/graph_support.rs` and `crates/effractor-solver/src/attacker.rs`, if they match on variants. An expected-time helper returns `m` for it where it returns `1.0 / rate` for `Exponential`. Add no wildcard arms.

- [ ] **Step 5: Run the tests and the frozen fingerprints**

Run: `cargo test -q --workspace 2>&1 | grep -E "test result|FAILED|panicked"`
Expected: all pass, and no snapshot or fingerprint test fails. A moved fingerprint is a bug in Step 3's arithmetic.

- [ ] **Step 6: Commit**

```bash
git add crates/effractor-core/src/distribution.rs crates/effractor-solver/src/dist.rs crates/effractor-mal/src/lib.rs crates/effractor-solver/tests/dist.rs crates/effractor-core/tests/validate.rs
# plus any file Step 4 touched, by name
git commit -m "Add an average-time exponential that draws what its rate draws"
```

---

### Task 2: the effractor spelling, `effractor_format::expr`

**Files:**
- Create: `crates/effractor-format/src/expr.rs`
- Modify: `crates/effractor-format/src/lib.rs` (add `pub mod expr;`)
- Test: `crates/effractor-format/tests/expr.rs` (new)

**Interfaces:**
- Consumes: `Distribution::ExponentialMean` (Task 1), `effractor_mal::number` (the document's number format).
- Produces:
  - `pub struct ParseError { pub col: usize /* 1-based, chars */, pub message: String }`
  - `pub fn parse(src: &str) -> Result<Distribution, ParseError>`
  - `pub fn write(d: &Distribution) -> String` (unquoted; `Const(v)` is a bare number)
  - `pub fn chance(p: f64) -> String` (the digits before `%`, e.g. `0.333` → `"33.3"`)

- [ ] **Step 1: Write the failing tests**

Create `crates/effractor-format/tests/expr.rs`:

```rust
//! effractor's own spelling of a time-to-compromise: chances in percent,
//! exponentials by their average time, Never and Immediate.

use effractor_core::{Distribution as D, Shorthand};
use effractor_format::expr::{chance, parse, write};

fn round_trip(text: &str, d: D) {
    assert_eq!(parse(text), Ok(d.clone()), "{text}");
    assert_eq!(write(&d), text);
}

#[test]
fn every_form_reads_and_writes_back() {
    round_trip("30%", D::Bernoulli(0.3));
    round_trip("50% * Exponential(mean 12.5)", D::Product(0.5, Box::new(D::ExponentialMean(12.5))));
    round_trip("Exponential(mean 12.5)", D::ExponentialMean(12.5));
    round_trip("25% * Gamma(2, 4)", D::Product(0.25, Box::new(D::Gamma { shape: 2.0, scale: 4.0 })));
    round_trip("LogNormal(1.5, 0.5)", D::LogNormal { mu: 1.5, sigma: 0.5 });
    round_trip("Pareto(1, 2)", D::Pareto { xm: 1.0, alpha: 2.0 });
    round_trip("TruncatedNormal(5, 2)", D::TruncatedNormal { mean: 5.0, sd: 2.0 });
    round_trip("Pert(1, 2, 5)", D::Pert { min: 1.0, mode: 2.0, max: 5.0 });
    round_trip("Never", D::Infinity);
    round_trip("Immediate", D::Zero);
    round_trip("0%", D::Bernoulli(0.0));
    round_trip("100%", D::Bernoulli(1.0));
    round_trip("Exponential(mean 1e-12)", D::ExponentialMean(1e-12));
}

#[test]
fn spacing_is_free_and_a_chance_may_have_decimals() {
    assert_eq!(parse(" 50 %  *  Exponential( mean 2 ) "), parse("50% * Exponential(mean 2)"));
    assert_eq!(parse("12.5%"), Ok(D::Bernoulli(0.125)));
    assert_eq!(parse("33.3%"), Ok(D::Bernoulli(0.333)));
    assert_eq!(parse("0.25%"), Ok(D::Bernoulli(0.0025)));
}

#[test]
fn a_chance_is_written_exactly_for_every_probability() {
    for p in [0.0, 1.0, 0.5, 0.333, 1.0 / 3.0, 0.0000025, 0.1 + 0.2, 0.999_999_999_999_9] {
        let text = format!("{}%", chance(p));
        assert_eq!(parse(&text), Ok(D::Bernoulli(p)), "{text}");
    }
    assert_eq!(chance(0.333), "33.3");
    assert_eq!(chance(0.05), "5");
    assert_eq!(chance(1.0), "100");
}

#[test]
fn a_mean_is_written_exactly() {
    for m in [1.0 / 3.0, 12.5, 1e-12, 1e15, 83333.33333333333] {
        assert_eq!(parse(&write(&D::ExponentialMean(m))), Ok(D::ExponentialMean(m)));
    }
}

#[test]
fn old_spellings_are_refused_with_their_replacement() {
    let e = parse("Bernoulli(0.5) * Exponential(0.1)").unwrap_err();
    assert_eq!(e.col, 1);
    assert!(e.message.contains("50%"), "{}", e.message);
    let e = parse("Exponential(0.08)").unwrap_err();
    assert!(e.message.contains("Exponential(mean 12.5)"), "{}", e.message);
    let e = parse("HardAndUncertain").unwrap_err();
    assert!(e.message.contains("50% * Exponential(mean 10)"), "{}", e.message);
    for (old, new) in [("Infinity", "Never"), ("Enabled", "Never"), ("Zero", "Immediate"), ("Disabled", "Immediate")] {
        assert!(parse(old).unwrap_err().message.contains(new), "{old}");
    }
}

#[test]
fn mistakes_are_named_where_they_are() {
    let at = |s: &str| parse(s).unwrap_err();
    assert_eq!(at("101%").col, 1);
    assert!(at("101%").message.contains("0% to 100%"));
    assert!(at("-5%").message.contains("number"));
    let comma = at("12,5%");
    assert_eq!(comma.col, 3);
    assert!(comma.message.contains("decimal point"));
    assert!(at("Exponential(mean 0)").message.contains("mean"));
    let order = at("Exponential(mean 5) * 50%");
    assert!(order.message.contains("chance first"), "{}", order.message);
    assert!(at("50% * 20%").message.contains("time"));
    assert!(at("Exponential(5)").message.contains("mean"));
    assert!(at("Gamma(2)").message.contains("Gamma(shape, scale)"));
    assert!(at("Weibull(1, 2)").message.contains("unknown"));
    assert_eq!(at("30% extra").col, 5);
}

#[test]
fn an_imported_rate_and_a_preset_are_written_in_the_new_spelling() {
    assert_eq!(write(&D::Exponential(0.1)), "Exponential(mean 10)");
    assert_eq!(write(&D::Named(Shorthand::HardAndUncertain)), "50% * Exponential(mean 10)");
    assert_eq!(write(&D::Named(Shorthand::Enabled)), "Never");
    assert_eq!(write(&D::Const(3.0)), "3");
}
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test -q -p effractor-format --test expr`
Expected: compile error, "could not find `expr` in `effractor_format`".

- [ ] **Step 3: Implement `expr.rs`**

```rust
//! effractor's spelling of a time-to-compromise or loss magnitude: a chance in
//! percent (`30%`, `50% * …`), an exponential by its average time
//! (`Exponential(mean 12.5)`), `Never`, `Immediate`, and the other
//! distributions by their parameters. MAL's spelling (`Bernoulli`, rates,
//! named presets) is refused with its replacement; `effractor-mal` reads it
//! for the import. Syntax and arity live here; domains are `core::validate`'s,
//! except a chance's 0–100, which only the percent sign gives a meaning.

use effractor_core::{Distribution, Shorthand};
use effractor_mal::number;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// 1-based, in characters.
    pub col: usize,
    pub message: String,
}

const ARITY: &[(&str, &[&str])] = &[
    ("Gamma", &["shape", "scale"]),
    ("LogNormal", &["mu", "sigma"]),
    ("Pareto", &["xm", "alpha"]),
    ("TruncatedNormal", &["mean", "sd"]),
    ("Pert", &["min", "mode", "max"]),
];

pub fn parse(src: &str) -> Result<Distribution, ParseError> {
    let mut p = Parser { chars: src.chars().collect(), at: 0 };
    let left_at = p.skip_ws();
    let left = p.term()?;
    p.skip_ws();
    let expr = if p.eat('*') {
        let right_at = p.skip_ws();
        let right = p.term()?;
        match (left, right) {
            (Distribution::Bernoulli(_), Distribution::Bernoulli(_)) => {
                return Err(p.error_at(right_at, "after `*` comes a time, e.g. Exponential(mean 10)"));
            }
            (Distribution::Bernoulli(c), d) => Distribution::Product(c, Box::new(d)),
            (_, Distribution::Bernoulli(_)) => {
                return Err(p.error_at(left_at, "write the chance first: 50% * Exponential(mean 10)"));
            }
            _ => return Err(p.error_at(left_at, "one side of `*` must be a chance, e.g. 50%")),
        }
    } else {
        left
    };
    let end = p.skip_ws();
    if end < p.chars.len() {
        return Err(p.error_at(end, "unexpected input after the expression"));
    }
    Ok(expr)
}

/// The canonical spelling: `parse(&write(d)) == Ok(d)` for every `d` the
/// format produces. An imported `Exponential(rate)` or preset is written as
/// its effractor translation.
pub fn write(d: &Distribution) -> String {
    use Distribution as D;
    let call = |name: &str, args: &[f64]| {
        let args: Vec<String> = args.iter().map(|v| number(*v)).collect();
        format!("{name}({})", args.join(", "))
    };
    match d {
        D::Bernoulli(p) => format!("{}%", chance(*p)),
        D::Exponential(rate) => format!("Exponential(mean {})", number(1.0 / rate)),
        D::ExponentialMean(m) => format!("Exponential(mean {})", number(*m)),
        D::Gamma { shape, scale } => call("Gamma", &[*shape, *scale]),
        D::LogNormal { mu, sigma } => call("LogNormal", &[*mu, *sigma]),
        D::Pareto { xm, alpha } => call("Pareto", &[*xm, *alpha]),
        D::TruncatedNormal { mean, sd } => call("TruncatedNormal", &[*mean, *sd]),
        D::Pert { min, mode, max } => call("Pert", &[*min, *mode, *max]),
        D::Zero => "Immediate".into(),
        D::Infinity => "Never".into(),
        // The inner side is never a Product (check_params), so this recursion
        // is one level deep.
        D::Product(p, inner) => format!("{}% * {}", chance(*p), write(inner)),
        D::Named(s) => write(&s.expand()),
        D::Const(v) => number(*v),
    }
}

/// A probability as the digits before `%`: its shortest decimal with the
/// point moved two places right. Exact, because moving a decimal point is
/// exact in decimal and `parse` moves it back the same way.
pub fn chance(p: f64) -> String {
    let s = format!("{p}"); // Rust's shortest round-trip form, never an exponent
    let (int, frac) = s.split_once('.').unwrap_or((&s, ""));
    let mut frac = frac.to_owned();
    while frac.len() < 2 {
        frac.push('0');
    }
    let whole = format!("{int}{}", &frac[..2]);
    let whole = whole.trim_start_matches('0');
    let whole = if whole.is_empty() { "0" } else { whole };
    let rest = frac[2..].trim_end_matches('0');
    if rest.is_empty() { whole.to_owned() } else { format!("{whole}.{rest}") }
}

/// The digits before `%` as a probability: the point moved two places left
/// in the text, then read — so `33.3` is exactly the number `0.333`.
fn from_percent(digits: &str) -> Option<f64> {
    let (int, frac) = digits.split_once('.').unwrap_or((digits, ""));
    if int.is_empty() && frac.is_empty() {
        return None;
    }
    let int = format!("{int:0>3}"); // at least three digits: "5" → "005"
    let (high, low) = int.split_at(int.len() - 2);
    format!("{high}.{low}{frac}").parse().ok()
}

struct Parser {
    chars: Vec<char>,
    at: usize,
}

impl Parser {
    fn error_at(&self, at: usize, message: impl Into<String>) -> ParseError {
        ParseError { col: at + 1, message: message.into() }
    }

    fn skip_ws(&mut self) -> usize {
        while self.chars.get(self.at).is_some_and(|c| c.is_whitespace()) {
            self.at += 1;
        }
        self.at
    }

    fn eat(&mut self, c: char) -> bool {
        let hit = self.chars.get(self.at) == Some(&c);
        if hit {
            self.at += 1;
        }
        hit
    }

    fn take_while(&mut self, keep: impl Fn(char) -> bool) -> String {
        let start = self.at;
        while self.chars.get(self.at).is_some_and(|c| keep(*c)) {
            self.at += 1;
        }
        self.chars[start..self.at].iter().collect()
    }

    fn term(&mut self) -> Result<Distribution, ParseError> {
        let at = self.at;
        if self.chars.get(at).is_some_and(|c| c.is_ascii_digit() || *c == '.') {
            return self.chance(at);
        }
        let name = self.take_while(|c| c.is_ascii_alphanumeric());
        if name.is_empty() {
            return Err(self.error_at(at, "expected a number or a distribution"));
        }
        match name.as_str() {
            "Never" => return Ok(Distribution::Infinity),
            "Immediate" => return Ok(Distribution::Zero),
            "Infinity" | "Enabled" => return Err(self.error_at(at, format!("write Never instead of {name}"))),
            "Zero" | "Disabled" => return Err(self.error_at(at, format!("write Immediate instead of {name}"))),
            _ => {}
        }
        if let Some(s) = Shorthand::ALL.into_iter().find(|s| s.name() == name) {
            return Err(self.error_at(at, format!("write {} instead of {name}", write(&s.expand()))));
        }
        if name == "Bernoulli" {
            let args = self.args_after_name(at, &name)?;
            let hint = args.first().map_or("30%".to_owned(), |p| format!("{}%", chance(*p)));
            return Err(self.error_at(at, format!("write a chance as a percentage: {hint}")));
        }
        if name == "Exponential" {
            return self.exponential(at);
        }
        let Some((_, params)) = ARITY.iter().find(|(n, _)| *n == name) else {
            return Err(self.error_at(at, format!(
                "unknown distribution \"{name}\"; known: Exponential(mean m), {}, Never, Immediate",
                ARITY.iter().map(|(n, _)| *n).collect::<Vec<_>>().join(", "),
            )));
        };
        let args = self.args_after_name(at, &name)?;
        if args.len() != params.len() {
            return Err(self.error_at(at, format!("{name} takes {} arguments: {name}({})", params.len(), params.join(", "))));
        }
        let a = args;
        Ok(match name.as_str() {
            "Gamma" => Distribution::Gamma { shape: a[0], scale: a[1] },
            "LogNormal" => Distribution::LogNormal { mu: a[0], sigma: a[1] },
            "Pareto" => Distribution::Pareto { xm: a[0], alpha: a[1] },
            "TruncatedNormal" => Distribution::TruncatedNormal { mean: a[0], sd: a[1] },
            _ => Distribution::Pert { min: a[0], mode: a[1], max: a[2] },
        })
    }

    /// `12.5%`: digits and one point, then `%` (spaces allowed before it).
    fn chance(&mut self, at: usize) -> Result<Distribution, ParseError> {
        let digits = self.take_while(|c| c.is_ascii_digit() || c == '.');
        if self.chars.get(self.at) == Some(&',') {
            return Err(self.error_at(self.at, "use a decimal point, not a comma"));
        }
        self.skip_ws();
        if !self.eat('%') {
            return Err(self.error_at(at, "a chance ends with %, e.g. 30%; a time is e.g. Exponential(mean 10)"));
        }
        match from_percent(&digits) {
            Some(p) if (0.0..=1.0).contains(&p) => Ok(Distribution::Bernoulli(p)),
            Some(_) => Err(self.error_at(at, "a chance is from 0% to 100%")),
            None => Err(self.error_at(at, "expected a number before %")),
        }
    }

    /// `Exponential(mean m)`; a bare rate is MAL's and names its mean.
    fn exponential(&mut self, at: usize) -> Result<Distribution, ParseError> {
        self.skip_ws();
        if !self.eat('(') {
            return Err(self.error_at(at, "Exponential takes its average time: Exponential(mean 10)"));
        }
        let word_at = self.skip_ws();
        let word = self.take_while(|c| c.is_ascii_alphabetic());
        if word != "mean" {
            self.at = word_at;
            let hint = match self.number() {
                Ok(rate) if rate > 0.0 => format!("Exponential(mean {})", number(1.0 / rate)),
                _ => "Exponential(mean 10)".to_owned(),
            };
            return Err(self.error_at(at, format!("Exponential takes its average time: {hint}")));
        }
        self.skip_ws();
        let mean = self.number()?;
        let close = self.skip_ws();
        if !self.eat(')') {
            return Err(self.error_at(close, "expected `)`"));
        }
        if !(mean.is_finite() && mean > 0.0) {
            return Err(self.error_at(word_at, "the mean must be greater than 0"));
        }
        Ok(Distribution::ExponentialMean(mean))
    }

    fn args_after_name(&mut self, at: usize, name: &str) -> Result<Vec<f64>, ParseError> {
        self.skip_ws();
        if !self.eat('(') {
            return Err(self.error_at(at, format!("{name} needs its arguments in brackets")));
        }
        let mut out = Vec::new();
        loop {
            self.skip_ws();
            out.push(self.number()?);
            let at = self.skip_ws();
            if self.eat(')') {
                return Ok(out);
            }
            if !self.eat(',') {
                return Err(self.error_at(at, "expected `,` or `)`"));
            }
        }
    }

    /// A finite number; `inf`, `NaN` and overflowing exponents are not numbers
    /// a model should contain.
    fn number(&mut self) -> Result<f64, ParseError> {
        let at = self.at;
        let text = self.take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'));
        let looks_numeric = text.starts_with(|c: char| c.is_ascii_digit() || matches!(c, '.' | '+' | '-'));
        match text.parse::<f64>() {
            Ok(v) if looks_numeric && v.is_finite() => Ok(v),
            _ => Err(self.error_at(at, "expected a number")),
        }
    }
}
```

Two details the tests pin:
- `-5%`: `term` sees `-`, which is neither a digit nor a name, so it reports "expected a number or a distribution".
- `Gamma(2)`: the arity message says `Gamma takes 2 arguments: Gamma(shape, scale)`.

Add `pub mod expr;` to `crates/effractor-format/src/lib.rs` next to the other `mod` lines.

- [ ] **Step 4: Run the tests**

Run: `cargo test -q -p effractor-format --test expr`
Expected: all 7 pass. If `-5%`'s message doesn't contain "number", change `term`'s empty-name message to keep "number" in it. Don't weaken the test.

- [ ] **Step 5: Commit**

```bash
git add crates/effractor-format/src/expr.rs crates/effractor-format/src/lib.rs crates/effractor-format/tests/expr.rs
git commit -m "Read and write chances in percent and exponentials by their mean"
```

---

### Task 3: every reader and writer uses the new spelling

**Files:**
- Modify: `crates/effractor-format/src/lower.rs:317-335` (`expression`)
- Modify: `crates/effractor-format/src/write.rs:10,225-241`
- Modify: `crates/effractor-solver/src/graph_results.rs:539`, `crates/effractor-components/src/export.rs:81`
- Modify: `crates/effractor-wasm/src/api.rs:85`
- Modify: `crates/effractor-components/tests/catalog.rs:96`
- Test: `crates/effractor-format/tests/diagnostics.rs`, `crates/effractor-format/tests/properties.rs`

**Interfaces:**
- Consumes: `effractor_format::expr::{parse, write, ParseError}` (Task 2).

- [ ] **Step 1: Write the failing tests**

Append to `crates/effractor-format/tests/diagnostics.rs`, using that file's existing helper for "diagnose this text and return the diagnostics" (read the top of the file and use its name):

```rust
#[test]
fn an_old_spelling_in_a_file_names_its_replacement_at_its_column() {
    let text = "effractor: 2\nprofile: attack-tree\nname: T\ntime_unit: d\nhorizon: 30\ntop: a\nnodes:\n  a:\n    label: A\n    leaf: basic\n    ttc: \"Bernoulli(0.5)\"\n";
    let (_, diagnostics) = effractor_format::diagnose(text);
    let d = diagnostics.iter().find(|d| d.message.contains("50%")).expect("names 50%");
    assert_eq!((d.pos.line, d.pos.col), (11, 11));
}
```

If the file header doesn't need `effractor: 2`, copy the minimal header another test in that file uses. The point is a `ttc:` with the old spelling, and a diagnostic at the character just past the opening quote.

In `crates/effractor-format/tests/properties.rs`, change the `time()` strategy's first arm:

```rust
        positive().prop_map(D::ExponentialMean),
```

and in the probability-bearing strategies, keep `Bernoulli`/`Product` as they are: `chance` writes every probability exactly.

- [ ] **Step 2: Run to verify the diagnostic test fails**

Run: `cargo test -q -p effractor-format --test diagnostics an_old_spelling`
Expected: FAIL, because MAL's parser accepts `Bernoulli(0.5)`, so there is no diagnostic.

- [ ] **Step 3: Switch the call sites**

`lower.rs`:

```rust
        match crate::expr::parse(text) {
```

(`e.col` and `e.message` keep their meaning, so the column arithmetic below it stays.)

`write.rs`: drop `to_expr` from the `use effractor_mal::{number, to_expr};` line and in `expression`:

```rust
        _ => format!("\"{}\"", crate::expr::write(d)),
```

`graph_results.rs:539` and `export.rs:81`:

```rust
                        Some(effractor_format::expr::write(d)),
```

`api.rs` (`ttc_sketch`):

```rust
    let d = match effractor_format::expr::parse(expression) {
```

`catalog.rs:96` (slot names must not read as a TTC):

```rust
            effractor_format::expr::parse(&s).is_err(),
```

Remove `effractor-mal` from a crate's `Cargo.toml` only if nothing in it uses the crate any more (`grep -rn effractor_mal crates/<crate>/src crates/<crate>/tests`). `effractor-format` still uses `number`.

- [ ] **Step 4: Run the whole workspace and see what the fixtures say**

Run: `cargo test -q --workspace 2>&1 | grep -E "FAILED|panicked" | head -40`
Expected: the new tests pass. Tests that load YAML fixtures or inline YAML with the old spelling now fail. **Don't fix them by hand.** Task 4 rewrites them. Record the failing test names in the commit message body so Task 4 can confirm each one goes green.

- [ ] **Step 5: Commit**

```bash
git add crates/effractor-format/src/lower.rs crates/effractor-format/src/write.rs crates/effractor-solver/src/graph_results.rs crates/effractor-components/src/export.rs crates/effractor-wasm/src/api.rs crates/effractor-components/tests/catalog.rs crates/effractor-format/tests/diagnostics.rs crates/effractor-format/tests/properties.rs
git commit -m "Read and write effractor documents in the readable time notation"
```

(The branch is red between Task 3 and Task 4; the PR is opened only after Task 5.)

---

### Task 4: rewrite every file, verifying equivalence

**Files:**
- Create: `crates/effractor-format/examples/rewrite_ttc.rs`
- Modify (by the tool): `assets/examples/*.yaml`, `assets/templates/*.yaml`, `docs/course/*.yaml`, `crates/*/tests/fixtures/**/*.yaml`, inline YAML in `crates/*/tests/*.rs`, `scripts/*.js`, `scripts/check-graph-agreement.js`
- Regenerate: `scripts/fixtures/graph/*.json`, `crates/effractor-solver/tests/snapshots/*.json`

**Interfaces:**
- Consumes: `effractor_mal::parse_expr` (old), `effractor_format::expr::{parse, write}` (new).

- [ ] **Step 1: Write the tool**

```rust
//! One-off: rewrite MAL-spelled TTCs to effractor's spelling in the files
//! named on the command line, in place. Only the value after a `ttc:` key is
//! touched (YAML block or flow style, quoted or not, also inside Rust or JS
//! string literals, where the quotes may be escaped). Each rewrite is checked:
//! the new text must parse to a distribution that draws exactly what the old
//! one drew, unless the average time was tidied, which is printed.
//!
//!   cargo run -q -p effractor-format --example rewrite_ttc -- FILE...

use effractor_core::Distribution as D;

fn main() {
    let mut tidied = 0;
    for path in std::env::args().skip(1) {
        let text = std::fs::read_to_string(&path).unwrap();
        let (out, notes) = rewrite(&text);
        for n in &notes {
            println!("{path}: {n}");
        }
        tidied += notes.iter().filter(|n| n.starts_with("tidied")).count();
        if out != text {
            std::fs::write(&path, out).unwrap();
        }
    }
    println!("{tidied} tidied");
}

/// The shortest decimal whose reciprocal is `rate` exactly, if it has at most
/// 6 significant digits; else `rate`'s mean rounded to 3.
fn mean_of(rate: f64) -> (f64, bool) {
    for digits in 1..=6 {
        let m: f64 = format!("{:.*e}", digits - 1, 1.0 / rate).parse().unwrap();
        if 1.0 / m == rate {
            return (m, true);
        }
    }
    (format!("{:.2e}", 1.0 / rate).parse().unwrap(), false)
}

/// MAL's distribution in effractor's model, and whether it draws the same.
fn translate(d: D) -> (D, bool) {
    match d {
        D::Exponential(rate) => {
            let (m, exact) = mean_of(rate);
            (D::ExponentialMean(m), exact)
        }
        D::Product(p, inner) => {
            let (inner, exact) = translate(*inner);
            (D::Product(p, Box::new(inner)), exact)
        }
        D::Named(s) => translate(s.expand()),
        other => (other, true),
    }
}

fn rewrite(text: &str) -> (String, Vec<String>) {
    let mut out = String::with_capacity(text.len());
    let mut notes = Vec::new();
    let mut rest = text;
    while let Some(i) = rest.find("ttc:") {
        out.push_str(&rest[..i + 4]);
        rest = &rest[i + 4..];
        let ws = rest.len() - rest.trim_start_matches(' ').len();
        out.push_str(&rest[..ws]);
        rest = &rest[ws..];
        let (open, close) = if rest.starts_with("\\\"") {
            ("\\\"", "\\\"")
        } else if rest.starts_with('"') {
            ("\"", "\"")
        } else {
            ("", "")
        };
        let body = &rest[open.len()..];
        let end = if close.is_empty() {
            body.find(|c: char| matches!(c, ',' | '}' | '\n')).unwrap_or(body.len())
        } else {
            body.find(close).unwrap_or(0)
        };
        let old = body[..end].trim_end();
        match effractor_mal::parse_expr(old) {
            // An invalid value (an error test's `Exponential(0)`) stays as it
            // is: it has no translation, and the test is about the error.
            Ok(d) if d.check_params().is_err() => {
                notes.push(format!("left {old}: not a valid value"));
                out.push_str(&rest[..open.len() + end + close.len()]);
                rest = &body[end + close.len()..];
            }
            Ok(d) if !matches!(d, D::Const(_)) => {
                let (new_d, exact) = translate(d);
                let new = effractor_format::expr::write(&new_d);
                assert_eq!(effractor_format::expr::parse(&new), Ok(new_d.clone()), "{new}");
                if !exact {
                    notes.push(format!("tidied {old} → {new}"));
                }
                // The original's quoting, whatever it was: an unquoted value
                // may sit inside a string literal of the file's own language.
                out.push_str(&format!("{open}{new}{close}"));
                rest = &body[end + close.len()..];
            }
            _ => {
                out.push_str(&rest[..open.len() + end + close.len()]);
                rest = &body[end + close.len()..];
            }
        }
    }
    out.push_str(rest);
    (out, notes)
}
```

Quoting: the result keeps the original's quoting. If an unquoted new value (`50% * …`) fails to load in some fixture, Step 4's test run shows it; quote that one by hand.

Why this proves equivalence: `translate` maps `Exponential(r)` to `ExponentialMean(m)` with `1/m == r` exactly (else it's reported as tidied). Task 1's test proves those two draw identical bits, and `Named(s)` samples as `s.expand()` in the solver (`dist.rs`). So every non-tidied rewrite samples identically.

- [ ] **Step 2: Run it on everything**

```bash
files=$(git ls-files 'assets/examples/*.yaml' 'assets/templates/*.yaml' 'docs/course/*.yaml' 'crates/*/tests/fixtures/*.yaml' 'crates/*/tests/fixtures/**/*.yaml' 'crates/*/tests/*.rs' 'scripts/*.js' 'docs/course/README.md' 'assets/examples/README.md')
cargo run -q -p effractor-format --example rewrite_ttc -- $files
```

Expected: a list of `tidied …` lines (0.03, 0.015, 0.000012, 6e-7, 3e-5, 2.3e-7 when they appear in a `ttc:`) and the count. Keep the output for the PR description.

- [ ] **Step 3: Find what the tool couldn't reach**

```bash
git grep -nE "Bernoulli\(|Exponential\([0-9.]|HardAnd|EasyAnd|VeryHard|\b(Enabled|Disabled)\b" -- assets docs/course crates/*/tests scripts ':!crates/effractor-mal' ':!crates/effractor-solver/tests' ':!crates/effractor-core/tests'
```

Each hit is either a Rust constructor (`D::Exponential(…)`, which is valid, so leave it) or text the tool missed (a `ttc` written as a map key in another form, a doc sentence, an `Infinity` horizon test in `edit.test.js`, which is **not** a TTC). Rewrite the missed TTC text by hand in the new spelling. `scripts/check-graph-agreement.js:31` replaces text in the lecture fixture: change its needles and replacements to the new spelling (`"Never"` and `"Exponential(mean 200)"`).

- [ ] **Step 4: Regenerate fixtures and check the numbers didn't move**

```bash
scripts/build-wasm.sh
node scripts/graph-fixtures.js --write
UPDATE_SNAPSHOTS=1 cargo test -q -p effractor-solver --test graph_determinism --test solve
cargo test -q --workspace 2>&1 | grep -E "FAILED|panicked"
git diff --stat crates/effractor-solver/tests/snapshots scripts/fixtures
git diff crates/effractor-solver/tests/snapshots scripts/fixtures | grep -E "^[-+] " | grep -vE "Exponential|%|Never|Immediate" | head
```

Expected: every test from Task 3's list is green. The last command prints nothing, because only expression text changed and no number did. If a number moved, a tidied value reached a snapshot: find which fixture holds it, and either keep that fixture's rate exact (hand-edit it to a mean with an exact reciprocal) or explain in the PR why that result changes.

- [ ] **Step 5: Run the full checks**

```bash
npm test
cargo fmt --all --check
cargo clippy -q --workspace --all-targets -- -D warnings
node scripts/check-roadmap.js
node scripts/check-graph-agreement.js
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add crates/effractor-format/examples/rewrite_ttc.rs
git add $(git diff --name-only)   # every file the tool and Step 3 changed, listed by name
git status --short                 # confirm nothing untracked or unintended is staged
git commit -m "Rewrite examples, course files and fixtures in the readable notation"
```

---

### Task 5: the documentation says the new spelling

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-effractor-v1-design.md` (the distribution section: `grep -n "Bernoulli\|Exponential" …`)
- Modify: `docs/superpowers/specs/2026-09-21-lecture-workflow-design.md` (mentions of TTC expressions)
- Modify: `README.md`, `docs/course/README.md`, `assets/examples/README.md`
- Modify: `docs/HANDOFF.md`, `ROADMAP.md`

- [ ] **Step 1: Replace the notation in prose**

In each file, replace the old notation in examples and grammar descriptions with the table of §2 of the spec. Keep MAL's spelling only where the text is about MAL compatibility (`mal-securicad-compatibility`), and say there that the import translates it.

- [ ] **Step 2: HANDOFF and roadmap**

Add a HANDOFF continuation section: what `ExponentialMean` is and why it exists (exact round trip, no moved fingerprints), where the grammar lives (`effractor_format::expr`), that `effractor-mal` is the import's, and which example values were tidied (the Task 4 output). Delete the `readable-time-notation` item from `ROADMAP.md` in PR B (Task 6), which completes it. Leave it here.

- [ ] **Step 3: Check and commit**

```bash
node scripts/check-roadmap.js
git grep -n "Bernoulli(" -- '*.md'   # only MAL-compatibility context may remain
git add docs/superpowers/specs/2026-09-20-effractor-v1-design.md docs/superpowers/specs/2026-09-21-lecture-workflow-design.md README.md docs/course/README.md assets/examples/README.md docs/HANDOFF.md
git commit -m "Describe the readable time notation"
```

**PR A:** push, open PR "Write chances in percent and exponentials by their mean" with the tidied list in the body, wait for `ci.yml` on the SHA, hand the owner `git push origin <sha>:master`, then wait for `release.yml`.

---

### Task 6: Chance and Average time in the timing form (PR B)

**Files:**
- Modify: `assets/js/ttc.js`
- Modify: `assets/js/editor.js:643` (fault-tree `p`/`rate` shown as an expression)
- Modify: `assets/css/50-editor.css` (the two fields on one row)
- Test: `scripts/ttc.test.js` (rewrite)
- Modify: `ROADMAP.md` (delete `readable-time-notation`: `scripts/dev/roadmap-done.py readable-time-notation`)

**Interfaces:**
- Produces (pure, exported by `ttc.js`):
  - `split(expr) → {chance: number|null, mean: number|null} | null`: `"50% * Exponential(mean 12.5)"` → `{chance: 50, mean: 12.5}`; `"Exponential(mean 3)"` → `{chance: null, mean: 3}`; `"30%"` → `{chance: 30, mean: null}`; anything else (`Never`, `Gamma(…)`, garbage) → `null`.
  - `join({chance, mean}) → string`: the inverse; `chance` null or 100 → no `%` part; `mean` null → `"c%"`; both null → `""`.
  - `PRESETS`: `[[label, expr]]`, in the order Easy, Hard, Very hard, each certain then 50%, then Never, Immediate.
  - `describe(expr, unit)` → the one-line hint, which no longer echoes preset names.
  - `showRate(rate) → "Exponential(mean …)"` with the mean to 3 significant digits, and `showChance(p) → "…%"`: for `editor.js`.

- [ ] **Step 1: Write the failing tests**

Replace `scripts/ttc.test.js` with:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const ttc = require('../assets/js/ttc.js');

test('the common shapes split into a chance and an average time, and join back', () => {
  const cases = [
    ['50% * Exponential(mean 12.5)', { chance: 50, mean: 12.5 }],
    ['Exponential(mean 3)', { chance: null, mean: 3 }],
    ['30%', { chance: 30, mean: null }],
    ['12.5% * Exponential(mean 1e-3)', { chance: 12.5, mean: 0.001 }],
  ];
  for (const [text, parts] of cases) {
    assert.deepEqual(ttc.split(text), parts, text);
    assert.equal(ttc.split(ttc.join(parts)).chance, parts.chance, text);
    assert.equal(ttc.split(ttc.join(parts)).mean, parts.mean, text);
  }
  assert.equal(ttc.join({ chance: 100, mean: 4 }), 'Exponential(mean 4)');
  assert.equal(ttc.join({ chance: null, mean: null }), '');
  for (const other of ['Never', 'Immediate', 'Gamma(2, 4)', 'nonsense', '50% * Gamma(2, 4)']) {
    assert.equal(ttc.split(other), null, other);
  }
});

test('presets are plain choices, written in the file as the notation itself', () => {
  const labels = ttc.PRESETS.map(p => p[0]);
  assert.deepEqual(labels.slice(-2), ['Never', 'Immediate']);
  const hard = ttc.PRESETS.find(p => p[1] === 'Exponential(mean 10)');
  assert.ok(hard, 'Hard is an average of 10');
  assert.ok(ttc.PRESETS.some(p => p[1] === '50% * Exponential(mean 10)'));
  for (const [, expr] of ttc.PRESETS) assert.doesNotMatch(expr, /Bernoulli|And|Infinity|Zero/);
});

test('hints say what happens in plain words and model units', () => {
  assert.match(ttc.describe('Exponential(mean 10)', 'd'), /10 days/);
  assert.match(ttc.describe('50% * Exponential(mean 10)', 'h'), /50%/);
  assert.match(ttc.describe('50% * Exponential(mean 10)', 'h'), /10 hours/);
  assert.match(ttc.describe('Never', 'd'), /never/i);
  assert.match(ttc.describe('Immediate', 'd'), /at once/i);
  assert.match(ttc.describe('Gamma(2, 4)', 'd'), /custom/i);
  assert.match(ttc.describe('', 'd'), /choose/i);
});

test('a fault-tree leaf shows its p and rate in the same notation', () => {
  assert.equal(ttc.showChance(0.3), '30%');
  assert.equal(ttc.showChance(0.0025), '0.25%');
  assert.equal(ttc.showRate(0.1), 'Exponential(mean 10)');
  assert.equal(ttc.showRate(0.03), 'Exponential(mean 33.3)');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --test scripts/ttc.test.js`
Expected: FAIL, "ttc.split is not a function".

- [ ] **Step 3: Implement the pure part of `ttc.js`**

Replace the `PRESETS`, `preset`, `label`, `describe` and `options` block with:

```js
  var PRESETS = [
    ['Easy · about 1 {u}', 'Exponential(mean 1)'],
    ['Hard · about 10 {u}', 'Exponential(mean 10)'],
    ['Very hard · about 100 {u}', 'Exponential(mean 100)'],
    ['Easy · 50% chance', '50%'],
    ['Hard · 50% chance, about 10 {u}', '50% * Exponential(mean 10)'],
    ['Very hard · 50% chance, about 100 {u}', '50% * Exponential(mean 100)'],
    ['Never', 'Never'],
    ['Immediate', 'Immediate'],
  ];
  var NUM = '([0-9]*\\.?[0-9]+(?:e[-+]?[0-9]+)?)';
  var SHAPE = new RegExp('^\\s*(?:' + NUM + '\\s*%)?\\s*(?:\\*\\s*)?(?:Exponential\\(\\s*mean\\s+' + NUM + '\\s*\\))?\\s*$', 'i');
  function split(expr) {
    var m = SHAPE.exec(String(expr || ''));
    if (!m || (m[1] == null && m[2] == null)) return null;
    // "30% Exponential(…)" without * is not the notation.
    if (m[1] != null && m[2] != null && !/\*/.test(expr)) return null;
    return { chance: m[1] == null ? null : Number(m[1]), mean: m[2] == null ? null : Number(m[2]) };
  }
  function join(parts) {
    var c = parts.chance, mean = parts.mean;
    var time = mean == null || mean === '' ? '' : 'Exponential(mean ' + mean + ')';
    if (c == null || c === '' || Number(c) === 100) return time;
    return time ? c + '% * ' + time : c + '%';
  }
  function unitName(unit, count) {
    return ({ h: 'hour', d: 'day', y: 'year' }[unit] || unit) + (Number(count) === 1 ? '' : 's');
  }
  function describe(expr, unit) {
    var text = String(expr || '').trim();
    if (!text) return 'Choose timing, or write it below.';
    if (text === 'Never') return 'Never succeeds · blocked.';
    if (text === 'Immediate') return 'Succeeds at once.';
    var p = split(text);
    if (!p) return 'Custom distribution · time in ' + unitName(unit, 2) + '.';
    var chance = p.chance == null ? '' : p.chance + '% chance';
    var time = p.mean == null ? 'at once' : 'about ' + p.mean + ' ' + unitName(unit, p.mean) + ' on average';
    return (chance ? chance + ', then ' : 'Succeeds, ') + time + (p.chance == null || p.chance === 100 ? '' : '; otherwise never') + '.';
  }
  function showChance(p) {
    return String(Number((p * 100).toPrecision(12))) + '%';
  }
  function showRate(rate) {
    return 'Exponential(mean ' + Number((1 / rate).toPrecision(3)) + ')';
  }
  function options(unit) {
    var u = unitName(unit, 2);
    return PRESETS.map(function (p) { return [p[1], p[0].replace('{u}', u)]; }).concat([['custom', 'Custom…']]);
  }
```

Export them: `var api = { PRESETS: PRESETS, split: split, join: join, describe: describe, showChance: showChance, showRate: showRate, options: options, attach: attach };`.

- [ ] **Step 4: Run the pure tests**

Run: `node --test scripts/ttc.test.js`
Expected: PASS. Adjust `describe`'s wording only if a test's regex disagrees with it. The tests say what the owner was promised: plain words and model units.

- [ ] **Step 5: The form (`attach`)**

Rewrite `attach(input, unit)` so it builds, above the existing text `input` (which stays the value the editor reads):
- the preset dropdown (`window.effractorMenu.dropdown(options(unit), current)`, where `current` is the preset whose expression equals the input, else `'custom'` when there is text, else `''`);
- a row with two small number inputs, **Chance** (`%` suffix, 0–100, empty means certain) and **Average time** (the unit name as suffix, > 0, empty means at once). They're shown only when `split(input.value)` is not null or the input is empty;
- the hint (`describe`) under everything.

Keep all three in step:
- picking a preset writes its expression into `input`, refills the two fields and dispatches `change` on `input`;
- typing in either field writes `join({chance, mean})` into `input` and dispatches `input` (and `change` on blur);
- typing in `input` refills the fields from `split`, or hides them when it returns null.

`input.placeholder = 'e.g. 50% * Exponential(mean 10)'`. Style the row in `50-editor.css` with the existing tokens (`display: grid; grid-template-columns: 1fr 1fr; gap: 6px;`, the `hint` class for the suffixes). No native `<select>`.

- [ ] **Step 6: Fault-tree display**

`editor.js:643`:

```js
    return kind === "p" ? window.effractorTtc.showChance(n.p) : kind === "rate" ? window.effractorTtc.showRate(n.rate) : kind === "ttc" ? String(n.ttc) : null;
```

- [ ] **Step 7: Full checks, roadmap, commit**

```bash
npm test
node scripts/check-roadmap.js
scripts/dev/roadmap-done.py readable-time-notation
node scripts/check-roadmap.js
git diff assets/js/ttc.js assets/js/editor.js | grep '^-[^-]'   # read every removed line
git add assets/js/ttc.js assets/js/editor.js assets/css/50-editor.css scripts/ttc.test.js ROADMAP.md
git commit -m "Edit timing as a chance and an average time"
```

- [ ] **Step 8: Owner's look, then land**

Restart the preview (`target/debug/effractor --bind 127.0.0.1:8081`; `shell.html` is compiled in). Give the owner these steps to try:
1. Open an attack-tree example, select a leaf and open its timing: pick *Hard · 50% chance*, then check that Chance shows 50 and Average time 10, and the text reads `50% * Exponential(mean 10)`.
2. Clear Chance: the text becomes `Exponential(mean 10)`.
3. Type `Gamma(2, 4)` in the text: the two fields hide and the hint says custom.
4. In an architecture, open a service parameter and do the same.
5. In a fault tree, a leaf with a rate shows `Exponential(mean …)`.

After their word: PR, `ci.yml` on the SHA, the owner's push, `release.yml`.

---

## Self-review notes

- Spec coverage: §2 notation → Task 2. §3 model form → Task 1. Round trip → Task 2 tests. Own parser and call sites → Tasks 2–3. `Named` and imported rate writing → Task 2 tests. §4 page → Task 6. §5 content and tidying → Task 4, docs → Task 5. §6 tests → Tasks 1, 2 and 4 (Step 4's number check) and Task 6.
- Types: `expr::parse/write/chance` are used by the same names in Tasks 3, 4 and 6. JS `split/join/showRate/showChance/PRESETS` are defined and tested in Task 6.
