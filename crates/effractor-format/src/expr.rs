//! effractor's spelling of a time-to-compromise or loss magnitude: a chance in
//! percent (`30%`, `50% * …`), an exponential by its average time
//! (`Exponential(mean 12.5)`), `Never`, `Immediate`, and the other
//! distributions by their parameters. MAL's spelling (`Bernoulli`, rates,
//! named presets) is refused with its replacement; `effractor-mal` reads it
//! for the import and for documents written before this notation. Syntax and arity live here; domains are `core::validate`'s,
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
    let mut p = Parser {
        chars: src.chars().collect(),
        at: 0,
    };
    let left_at = p.skip_ws();
    let left = p.term()?;
    p.skip_ws();
    let expr = if p.eat('*') {
        let right_at = p.skip_ws();
        let right = p.term()?;
        match (left, right) {
            (Distribution::Bernoulli(_), Distribution::Bernoulli(_)) => {
                return Err(p.error_at(
                    right_at,
                    "after `*` comes a time, e.g. Exponential(mean 10)",
                ));
            }
            (Distribution::Bernoulli(c), d) => Distribution::Product(c, Box::new(d)),
            (_, Distribution::Bernoulli(_)) => {
                return Err(p.error_at(
                    left_at,
                    "write the chance first: 50% * Exponential(mean 10)",
                ));
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
    if rest.is_empty() {
        whole.to_owned()
    } else {
        format!("{whole}.{rest}")
    }
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
        ParseError {
            col: at + 1,
            message: message.into(),
        }
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
        if self
            .chars
            .get(at)
            .is_some_and(|c| c.is_ascii_digit() || *c == '.')
        {
            return self.chance(at);
        }
        let name = self.take_while(|c| c.is_ascii_alphanumeric());
        if name.is_empty() {
            return Err(self.error_at(at, "expected a number or a distribution"));
        }
        match name.as_str() {
            "Never" => return Ok(Distribution::Infinity),
            "Immediate" => return Ok(Distribution::Zero),
            "Infinity" | "Enabled" => {
                return Err(self.error_at(at, format!("write Never instead of {name}")));
            }
            "Zero" | "Disabled" => {
                return Err(self.error_at(at, format!("write Immediate instead of {name}")));
            }
            _ => {}
        }
        if let Some(s) = Shorthand::ALL.into_iter().find(|s| s.name() == name) {
            return Err(self.error_at(
                at,
                format!("write {} instead of {name}", write(&s.expand())),
            ));
        }
        if name == "Bernoulli" {
            let args = self.args_after_name(at, &name)?;
            let hint = args
                .first()
                .map_or("30%".to_owned(), |p| format!("{}%", chance(*p)));
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
            return Err(self.error_at(
                at,
                format!(
                    "{name} takes {} arguments: {name}({})",
                    params.len(),
                    params.join(", ")
                ),
            ));
        }
        let a = args;
        Ok(match name.as_str() {
            "Gamma" => Distribution::Gamma {
                shape: a[0],
                scale: a[1],
            },
            "LogNormal" => Distribution::LogNormal {
                mu: a[0],
                sigma: a[1],
            },
            "Pareto" => Distribution::Pareto {
                xm: a[0],
                alpha: a[1],
            },
            "TruncatedNormal" => Distribution::TruncatedNormal {
                mean: a[0],
                sd: a[1],
            },
            _ => Distribution::Pert {
                min: a[0],
                mode: a[1],
                max: a[2],
            },
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
            return Err(self.error_at(
                at,
                "a chance ends with %, e.g. 30%; a time is e.g. Exponential(mean 10)",
            ));
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
            return Err(self.error_at(
                at,
                "Exponential takes its average time: Exponential(mean 10)",
            ));
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
        let looks_numeric =
            text.starts_with(|c: char| c.is_ascii_digit() || matches!(c, '.' | '+' | '-'));
        match text.parse::<f64>() {
            Ok(v) if looks_numeric && v.is_finite() => Ok(v),
            _ => Err(self.error_at(at, "expected a number")),
        }
    }
}
