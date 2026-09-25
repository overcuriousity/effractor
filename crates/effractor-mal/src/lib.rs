//! Parser for MAL TTC distribution expressions.
//!
//! v1 reads exactly one thing out of MAL: the expression on the right of a
//! step's TTC, e.g. `Bernoulli(0.5) * Exponential(0.1)`. It is hand-written and
//! pure Rust so that it compiles to wasm; tree-sitter-mal arrives with full MAL
//! parsing, natively only.
//!
//! Syntax and arity live here. Parameter domains do not — `core::validate`
//! checks those, in one place, with a document path to report them at.

use effractor_core::{Distribution, Shorthand};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParseError {
    /// 1-based, in characters.
    pub col: usize,
    pub message: String,
}

impl std::fmt::Display for ParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "col {}: {}", self.col, self.message)
    }
}

impl std::error::Error for ParseError {}

pub fn parse_expr(src: &str) -> Result<Distribution, ParseError> {
    let mut p = Parser {
        chars: src.chars().collect(),
        at: 0,
    };
    let left_at = p.skip_ws();
    let left = p.term()?;
    p.skip_ws();
    let expr = if p.eat('*') {
        p.skip_ws();
        let right = p.term()?;
        match (left, right) {
            (Distribution::Bernoulli(p), d) | (d, Distribution::Bernoulli(p)) => {
                Distribution::Product(p, Box::new(d))
            }
            _ => return Err(p.error_at(left_at, "one side of `*` must be Bernoulli(p)")),
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

/// Shortest text that reads back as the same f64. Rust's `{}` never uses an
/// exponent, which turns 2.5e-6 into a row of zeros someone has to count.
/// Public because a document writes its bare numbers the same way.
pub fn number(v: f64) -> String {
    let magnitude = v.abs();
    if v != 0.0 && !(1e-4..1e15).contains(&magnitude) {
        format!("{v:e}")
    } else {
        format!("{v}")
    }
}

const ARITY: &[(&str, &[&str])] = &[
    ("Bernoulli", &["p"]),
    ("Exponential", &["rate"]),
    ("Gamma", &["shape", "scale"]),
    ("LogNormal", &["mu", "sigma"]),
    ("Pareto", &["xm", "alpha"]),
    ("TruncatedNormal", &["mean", "sd"]),
    ("Pert", &["min", "mode", "max"]),
    ("Zero", &[]),
    ("Infinity", &[]),
];

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
        let name_at = self.at;
        let name = self.take_while(|c| c.is_ascii_alphanumeric());
        if name.is_empty() {
            return Err(self.error_at(name_at, "expected a distribution"));
        }
        if let Some(s) = Shorthand::ALL.into_iter().find(|s| s.name() == name) {
            return Ok(Distribution::Named(s));
        }
        let Some((_, params)) = ARITY.iter().find(|(n, _)| *n == name) else {
            let known: Vec<&str> = ARITY.iter().map(|(n, _)| *n).collect();
            return Err(self.error_at(
                name_at,
                format!(
                    "unknown distribution \"{name}\"; known: {}, and MAL's shorthands",
                    known.join(", ")
                ),
            ));
        };

        let args_at = self.skip_ws();
        let args = if self.eat('(') {
            Some(self.args()?)
        } else {
            None
        };
        let wrong_arity = |p: &Self, at| {
            let message = match params.len() {
                0 => format!("{name} takes no arguments"),
                1 => format!("{name} takes 1 argument: {name}({})", params[0]),
                n => format!("{name} takes {n} arguments: {name}({})", params.join(", ")),
            };
            Err(p.error_at(at, message))
        };
        let a = match (&args, params.len()) {
            (None, 0) => {
                return Ok(if name == "Zero" {
                    Distribution::Zero
                } else {
                    Distribution::Infinity
                });
            }
            (Some(_), 0) => return wrong_arity(self, args_at),
            (None, _) => return wrong_arity(self, args_at),
            (Some(a), n) if a.len() != n => return wrong_arity(self, name_at),
            (Some(a), _) => a,
        };
        Ok(match name.as_str() {
            "Bernoulli" => Distribution::Bernoulli(a[0]),
            "Exponential" => Distribution::Exponential(a[0]),
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

    /// After the `(`: numbers separated by commas, through the `)`.
    fn args(&mut self) -> Result<Vec<f64>, ParseError> {
        let mut out = Vec::new();
        loop {
            let at = self.skip_ws();
            let text =
                self.take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'));
            // `f64::from_str` also reads "inf" and "NaN", and rounds 1e999 to
            // infinity. None of those is a number a model should contain.
            let looks_numeric =
                text.starts_with(|c: char| c.is_ascii_digit() || matches!(c, '.' | '+' | '-'));
            match text.parse::<f64>() {
                Ok(v) if looks_numeric && v.is_finite() => out.push(v),
                _ => return Err(self.error_at(at, "expected a number")),
            }
            let at = self.skip_ws();
            if self.eat(')') {
                return Ok(out);
            }
            if !self.eat(',') {
                return Err(self.error_at(at, "expected `,` or `)`"));
            }
        }
    }
}
