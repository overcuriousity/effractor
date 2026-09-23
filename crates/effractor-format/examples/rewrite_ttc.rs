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
    // `ttc:` in YAML, `"ttc":` in JSON.
    let next = |r: &str| {
        [("ttc:", 4), ("\"ttc\":", 6)]
            .iter()
            .filter_map(|(n, len)| r.find(n).map(|i| (i, *len)))
            .min()
    };
    while let Some((i, len)) = next(rest) {
        out.push_str(&rest[..i + len]);
        rest = &rest[i + len..];
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
            body.find([',', '}', '\n', '"', '\'', '`'])
                .unwrap_or(body.len())
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
                assert_eq!(
                    effractor_format::expr::parse(&new),
                    Ok(new_d.clone()),
                    "{new}"
                );
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
