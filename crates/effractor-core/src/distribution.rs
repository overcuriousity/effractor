/// MAL's distribution set, plus what loss magnitudes need (`Const`, `Pert`).
///
/// One type for both roles because they share a grammar; [`Distribution::check_ttc`]
/// and [`Distribution::check_magnitude`] say which variants make sense where.
#[derive(Debug, Clone, PartialEq)]
pub enum Distribution {
    /// As a TTC: time 0 with probability `p`, else never.
    Bernoulli(f64),
    Exponential(f64),
    /// The average time, as an effractor file writes it. Sampled with the
    /// rate `1/m`, so it draws exactly what `Exponential(1/m)` draws.
    ExponentialMean(f64),
    Gamma {
        shape: f64,
        scale: f64,
    },
    LogNormal {
        mu: f64,
        sigma: f64,
    },
    Pareto {
        xm: f64,
        alpha: f64,
    },
    /// Truncated at 0.
    TruncatedNormal {
        mean: f64,
        sd: f64,
    },
    Zero,
    Infinity,
    /// `Bernoulli(p) * D`: never with probability `1 - p`, else a draw from `D`.
    Product(f64, Box<Distribution>),
    /// Kept by name so a document that says `HardAndCertain` still says it
    /// after a round trip.
    Named(Shorthand),
    /// A fixed loss magnitude.
    Const(f64),
    /// What FAIR calibration produces: min, most likely, max.
    Pert {
        min: f64,
        mode: f64,
        max: f64,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Shorthand {
    EasyAndCertain,
    EasyAndUncertain,
    HardAndCertain,
    HardAndUncertain,
    VeryHardAndCertain,
    VeryHardAndUncertain,
    /// A defence that is on: the step never succeeds.
    Enabled,
    /// A defence that is off: the step costs no time.
    Disabled,
}

impl Shorthand {
    pub const ALL: [Shorthand; 8] = [
        Self::EasyAndCertain,
        Self::EasyAndUncertain,
        Self::HardAndCertain,
        Self::HardAndUncertain,
        Self::VeryHardAndCertain,
        Self::VeryHardAndUncertain,
        Self::Enabled,
        Self::Disabled,
    ];

    pub fn name(self) -> &'static str {
        match self {
            Self::EasyAndCertain => "EasyAndCertain",
            Self::EasyAndUncertain => "EasyAndUncertain",
            Self::HardAndCertain => "HardAndCertain",
            Self::HardAndUncertain => "HardAndUncertain",
            Self::VeryHardAndCertain => "VeryHardAndCertain",
            Self::VeryHardAndUncertain => "VeryHardAndUncertain",
            Self::Enabled => "Enabled",
            Self::Disabled => "Disabled",
        }
    }

    pub fn expand(self) -> Distribution {
        use Distribution as D;
        let uncertain = |rate| D::Product(0.5, Box::new(D::Exponential(rate)));
        match self {
            Self::EasyAndCertain => D::Exponential(1.0),
            Self::EasyAndUncertain => D::Bernoulli(0.5),
            Self::HardAndCertain => D::Exponential(0.1),
            Self::HardAndUncertain => uncertain(0.1),
            Self::VeryHardAndCertain => D::Exponential(0.01),
            Self::VeryHardAndUncertain => uncertain(0.01),
            Self::Enabled => D::Infinity,
            Self::Disabled => D::Zero,
        }
    }
}

fn positive(name: &str, v: f64) -> Result<(), String> {
    if v.is_finite() && v > 0.0 {
        Ok(())
    } else {
        Err(format!("{name} must be > 0, got {v}"))
    }
}

fn finite(name: &str, v: f64) -> Result<(), String> {
    if v.is_finite() {
        Ok(())
    } else {
        Err(format!("{name} must be finite, got {v}"))
    }
}

pub(crate) fn probability(name: &str, v: f64) -> Result<(), String> {
    if (0.0..=1.0).contains(&v) {
        Ok(())
    } else {
        Err(format!("{name} must be in [0, 1], got {v}"))
    }
}

impl Distribution {
    /// Are the parameters in their domains? Says nothing about role.
    pub fn check_params(&self) -> Result<(), String> {
        match self {
            Self::Bernoulli(p) => probability("p", *p),
            Self::Exponential(rate) => positive("rate", *rate),
            Self::ExponentialMean(mean) => positive("mean", *mean),
            Self::Gamma { shape, scale } => {
                positive("shape", *shape).and(positive("scale", *scale))
            }
            Self::LogNormal { mu, sigma } => finite("mu", *mu).and(positive("sigma", *sigma)),
            Self::Pareto { xm, alpha } => positive("xm", *xm).and(positive("alpha", *alpha)),
            Self::TruncatedNormal { mean, sd } => finite("mean", *mean).and(positive("sd", *sd)),
            Self::Zero | Self::Infinity | Self::Named(_) => Ok(()),
            Self::Product(p, inner) => {
                probability("p", *p)?;
                match **inner {
                    Self::Bernoulli(_)
                    | Self::Product(..)
                    | Self::Named(_)
                    | Self::Const(_)
                    | Self::Pert { .. } => Err(
                        "the right side of `Bernoulli(p) * …` must be a time distribution".into(),
                    ),
                    _ => inner.check_params(),
                }
            }
            Self::Const(v) => {
                if v.is_finite() && *v >= 0.0 {
                    Ok(())
                } else {
                    Err(format!("value must be >= 0, got {v}"))
                }
            }
            Self::Pert { min, mode, max } => {
                let ordered = min.is_finite()
                    && max.is_finite()
                    && *min >= 0.0
                    && min <= mode
                    && mode <= max
                    && min < max;
                if ordered {
                    Ok(())
                } else {
                    Err(format!(
                        "Pert needs 0 <= min <= mode <= max and min < max, got ({min}, {mode}, {max})"
                    ))
                }
            }
        }
    }

    /// May this stand as a time-to-compromise?
    pub fn check_ttc(&self) -> Result<(), String> {
        match self {
            Self::Const(_) | Self::Pert { .. } => {
                Err("this is a loss magnitude, not a time-to-compromise".into())
            }
            _ => Ok(()),
        }
    }

    /// May this stand as a loss magnitude?
    pub fn check_magnitude(&self) -> Result<(), String> {
        match self {
            Self::Bernoulli(_)
            | Self::Zero
            | Self::Infinity
            | Self::Product(..)
            | Self::Named(_) => Err("this is a time-to-compromise, not a loss magnitude".into()),
            _ => Ok(()),
        }
    }
}
