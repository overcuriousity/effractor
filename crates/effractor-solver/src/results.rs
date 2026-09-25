//! `solve`: a model and a configuration in, results out.
//!
//! [`Solve`] is the same thing in steps, for a caller that wants to show
//! progress and be able to stop: everything exact is ready as soon as
//! [`Solve::begin`] returns, and each [`Solve::step`] is one chunk of sampling.
//! One thread, no clock, no I/O — a browser worker calls exactly this.

use effractor_core::{
    Diagnostic, Distribution, Model, NodeKind, Profile, Severity, TimeUnit, validate,
};
use serde::Serialize;

use crate::attacker::{self, attacker};
use crate::bdd::Bdd;
use crate::dist::cdf;
use crate::importance::{birnbaum, fussell_vesely};
use crate::mc::{Chunk, GRID, Sampled, Sampler, paired_difference};
use crate::mcs::{CutSets, Truncated};
use crate::plan::Plan;
use crate::scenario::{as_written, leaf_distributions};

#[derive(Debug, Clone, PartialEq)]
pub struct Config {
    pub seed: u64,
    pub samples: u64,
    pub confidence: f64,
    pub bdd_node_limit: usize,
    pub mcs_max_order: Option<usize>,
    pub mcs_max_sets: usize,
}

impl Config {
    /// What the document asks for, with the limits at their defaults.
    pub fn from_model(model: &Model) -> Self {
        Self {
            seed: model.analysis.seed,
            samples: model.analysis.samples,
            confidence: model.analysis.confidence,
            bdd_node_limit: 1_000_000,
            mcs_max_order: None,
            mcs_max_sets: 10_000,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum SolveError {
    /// The model has errors; these are all its diagnostics, warnings included.
    Invalid(Vec<Diagnostic>),
}

/// A result, or the reason there is none. Limits and missing data cost the
/// analyses that need them and nothing else; they are never silent.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome<T> {
    Available(T),
    Unavailable { reason: String },
}

impl<T> Outcome<T> {
    pub fn available(&self) -> Option<&T> {
        match self {
            Self::Available(v) => Some(v),
            Self::Unavailable { .. } => None,
        }
    }

    fn unavailable(reason: impl Into<String>) -> Self {
        Self::Unavailable {
            reason: reason.into(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Results {
    #[serde(rename = "effractor-results")]
    pub schema: u32,
    pub profile: &'static str,
    pub time_unit: &'static str,
    pub horizon: f64,
    pub currency: String,
    pub leaves: Vec<LeafResult>,
    pub nodes: Vec<NodeResult>,
    pub cut_sets: Outcome<CutSetsResult>,
    pub exact: Outcome<Exact>,
    pub sampled: Outcome<SampledResult>,
    /// Attack-tree profile only.
    pub attacker: Option<Outcome<AttackerResult>>,
    pub controls: Outcome<ControlsResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LeafResult {
    pub id: String,
    /// P(leaf within the horizon), under the controls as written.
    pub p: Option<f64>,
    pub birnbaum: Option<f64>,
    pub fussell_vesely: Option<f64>,
    /// A cut set of its own: a single point of failure, independent of BDD
    /// and cut-set listing limits.
    pub spof: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NodeResult {
    pub id: String,
    pub p_exact: Option<f64>,
    pub p_sampled: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CutSetsResult {
    /// A decimal string: the count can exceed what JSON numbers hold.
    pub total: String,
    pub truncated: Option<String>,
    pub sets: Vec<CutSetResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CutSetResult {
    pub leaves: Vec<String>,
    pub probability: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Exact {
    pub p_top: f64,
    /// (t, P(top <= t)) on the grid.
    pub ttc_cdf: Vec<(f64, f64)>,
    pub bdd_nodes: usize,
    /// Why the leaves have no Fussell–Vesely, if they have none: it needs the
    /// cut sets and room in the diagram for a function per leaf. Birnbaum
    /// needs neither.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fussell_vesely_unavailable: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Band {
    pub lo: f64,
    pub hi: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SampledResult {
    pub samples: u64,
    pub seed: u64,
    pub confidence: f64,
    pub p_top: f64,
    pub p_top_ci: Band,
    /// (t, P(top <= t), lo, hi) on the grid.
    pub ttc_cdf: Vec<(f64, f64, f64, f64)>,
    pub loss: Option<LossResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LossResult {
    /// Expected loss over the horizon. At most one occurrence of each
    /// consequence per horizon is modelled; frequency is not.
    pub mean: f64,
    pub mean_ci: Band,
    pub p50: f64,
    pub p90: f64,
    pub p95: f64,
    pub p99: f64,
    /// (loss, P(loss >= it)).
    pub exceedance: Vec<(f64, f64)>,
    pub by_asset: Vec<AssetLoss>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AssetLoss {
    pub asset: String,
    pub dim: &'static str,
    pub mean: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AttackerResult {
    /// Index into `attacks`.
    pub cheapest: Option<usize>,
    pub attacks: Vec<AttackResult>,
    /// Leaves whose `cost` or `detection` was missing and counted as zero.
    pub assumed_free: Vec<String>,
    pub assumed_unnoticed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AttackResult {
    pub leaves: Vec<String>,
    pub cost: f64,
    /// `null` when the attack has no finite expected time.
    pub time: Option<f64>,
    pub detection: f64,
    pub success: f64,
    pub on_front: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ControlsResult {
    /// `"expected_loss"` if the model books losses, else `"p_top"`.
    pub measure: &'static str,
    pub baseline: f64,
    /// One control flipped at a time against the model as written. Marginal,
    /// not additive: two controls on one path do not save twice.
    pub controls: Vec<ControlResult>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ControlResult {
    pub id: String,
    pub enabled: bool,
    pub cost: f64,
    /// The measure with this one control flipped; `null` when that cannot be
    /// measured, and then `unavailable` says why.
    pub flipped: Option<f64>,
    /// What the control is worth: for a disabled control, the risk enabling it
    /// removes; for an enabled one, the risk removing it would add.
    pub value: Option<f64>,
    /// Present when the value is a sampled loss. The scenarios share their
    /// random numbers, so this is the interval of a paired difference — and if
    /// it straddles another control's value, more samples will settle it.
    pub value_ci: Option<Band>,
    /// `value / cost`, disabled controls only; `null` when it costs nothing.
    pub value_per_cost: Option<f64>,
    /// 1 is the best buy. Disabled controls only.
    pub rank: Option<usize>,
    /// Why this flip has no numbers: switching the control off can take away
    /// the only distribution a leaf has.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unavailable: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Progress {
    pub done: u64,
    pub total: u64,
}

struct Scenario {
    /// `None` is the model as written; `Some(i)` flips control `i`.
    flip: Option<usize>,
    p_top_exact: Option<f64>,
    sampler: Option<Sampler>,
    chunks: Vec<Chunk>,
    /// Why this flip cannot be measured, if so.
    unavailable: Option<String>,
}

pub struct Solve {
    model: Model,
    config: Config,
    plan: Plan,
    base: Base,
    scenarios: Vec<Scenario>,
    done: u64,
    total: u64,
}

/// Everything that needs no sampling.
struct Base {
    leaves: Vec<LeafResult>,
    p_node_exact: Option<Vec<f64>>,
    cut_sets: Outcome<CutSetsResult>,
    exact: Outcome<Exact>,
    attacker: Option<Outcome<AttackerResult>>,
    /// Why nothing quantitative can be said, if so.
    no_numbers: Option<String>,
}

pub fn solve(model: &Model, config: &Config) -> Result<Results, SolveError> {
    Ok(Solve::begin(model, config)?.finish())
}

impl Solve {
    pub fn begin(model: &Model, config: &Config) -> Result<Solve, SolveError> {
        let diagnostics = validate(model);
        if diagnostics.iter().any(|d| d.severity == Severity::Error) {
            return Err(SolveError::Invalid(diagnostics));
        }
        let plan = Plan::build(model).map_err(|_| SolveError::Invalid(diagnostics))?;
        let name = |leaf: &usize| plan.leaves[*leaf].to_string();

        let written = as_written(model);
        let dists = leaf_distributions(model, &plan, &written);
        let missing: Vec<String> = dists
            .iter()
            .enumerate()
            .filter(|(_, d)| d.is_none())
            .map(|(i, _)| name(&i))
            .collect();
        let no_numbers =
            (!missing.is_empty()).then(|| format!("no distribution on: {}", missing.join(", ")));
        let dists: Option<Vec<Distribution>> = dists.into_iter().collect();
        let leaf_p: Option<Vec<f64>> = dists
            .as_ref()
            .map(|ds| ds.iter().map(|d| cdf(d, model.horizon)).collect());

        let mut bdd = Bdd::from_plan(&plan, config.bdd_node_limit).map_err(|e| format!("{e:?}"));
        let cut_sets = bdd.as_ref().map_err(Clone::clone).and_then(|b| {
            CutSets::of(b, b.root(), config.bdd_node_limit).map_err(|e| format!("{e:?}"))
        });
        let listed = cut_sets
            .as_ref()
            .ok()
            .map(|z| z.enumerate(config.mcs_max_order, config.mcs_max_sets));

        let spofs = plan.single_points_of_failure();
        let mut leaves: Vec<LeafResult> = (0..plan.leaves.len())
            .map(|i| LeafResult {
                id: name(&i),
                p: leaf_p.as_ref().map(|p| p[i]),
                birnbaum: None,
                fussell_vesely: None,
                spof: spofs[i],
            })
            .collect();

        let mut p_node_exact = None;
        let exact = match (&mut bdd, &dists, &leaf_p) {
            (Err(e), _, _) => Outcome::unavailable(format!(
                "exact analysis gave up: {e}; sampled results still hold"
            )),
            (Ok(_), None, _) | (Ok(_), _, None) => {
                Outcome::unavailable(no_numbers.clone().unwrap_or_default())
            }
            (Ok(bdd), Some(dists), Some(p)) => {
                let top = bdd.root();
                let all = bdd.prob_all(p);
                p_node_exact = Some(
                    plan.ids
                        .iter()
                        .map(|id| all[Bdd::index(bdd.node(id).expect("planned"))])
                        .collect(),
                );
                for (leaf, b) in leaves.iter_mut().zip(birnbaum(bdd, top, p)) {
                    leaf.birnbaum = Some(b);
                }
                let fv = match &cut_sets {
                    Ok(z) => fussell_vesely(bdd, top, z, p)
                        .map_err(|e| format!("Fussell–Vesely gave up: {e:?}")),
                    Err(_) => Err("Fussell–Vesely needs cut sets".to_owned()),
                };
                let fussell_vesely_unavailable = match fv {
                    Ok(fv) => {
                        for (leaf, f) in leaves.iter_mut().zip(fv) {
                            leaf.fussell_vesely = Some(f);
                        }
                        None
                    }
                    Err(reason) => Some(reason),
                };
                let ttc_cdf = (0..GRID)
                    .map(|j| {
                        let t = model.horizon * j as f64 / (GRID - 1) as f64;
                        let at_t: Vec<f64> = dists.iter().map(|d| cdf(d, t)).collect();
                        (t, bdd.prob(top, &at_t))
                    })
                    .collect();
                Outcome::Available(Exact {
                    p_top: bdd.prob(top, p),
                    ttc_cdf,
                    bdd_nodes: bdd.size(),
                    fussell_vesely_unavailable,
                })
            }
        };

        let cut_sets_out = match (&cut_sets, &listed) {
            (Ok(_), Some(l)) => Outcome::Available(CutSetsResult {
                total: l.total.to_string(),
                truncated: l.truncated.map(|t| match t {
                    Truncated::MaxOrder(k) => format!("only cut sets of order <= {k} are listed"),
                    Truncated::MaxSets(n) => format!("only the {n} smallest cut sets are listed"),
                }),
                sets: l
                    .sets
                    .iter()
                    .map(|s| CutSetResult {
                        leaves: s.iter().map(name).collect(),
                        probability: leaf_p.as_ref().map(|p| s.iter().map(|i| p[*i]).product()),
                    })
                    .collect(),
            }),
            (Err(e), _) => Outcome::unavailable(format!("cut sets gave up: {e}")),
            (Ok(_), None) => Outcome::unavailable("cut sets were not listed"),
        };

        let attacker_out =
            (model.profile == Profile::AttackTree).then(|| match (&listed, &dists) {
                (Some(l), Some(ds)) => {
                    let steps: Vec<attacker::Step> = plan
                        .leaves
                        .iter()
                        .zip(ds)
                        .map(|(id, d)| match &model.nodes[id].kind {
                            NodeKind::Leaf(leaf) => attacker::Step {
                                ttc: d.clone(),
                                cost: leaf.cost,
                                detection: leaf.detection,
                            },
                            NodeKind::Gate { .. } => unreachable!("plan leaves are leaves"),
                        })
                        .collect();
                    let a = attacker(&l.sets, &steps, model.horizon);
                    let lacking = |f: &dyn Fn(&attacker::Step) -> bool| {
                        steps
                            .iter()
                            .enumerate()
                            .filter(|(_, s)| f(s))
                            .map(|(i, _)| name(&i))
                            .collect()
                    };
                    Outcome::Available(AttackerResult {
                        cheapest: a.cheapest,
                        attacks: a
                            .attacks
                            .iter()
                            .map(|x| AttackResult {
                                leaves: l.sets[x.set].iter().map(name).collect(),
                                cost: x.cost,
                                time: x.time.is_finite().then_some(x.time),
                                detection: x.detection,
                                success: x.success,
                                on_front: x.on_front,
                            })
                            .collect(),
                        assumed_free: lacking(&|s| s.cost.is_none()),
                        assumed_unnoticed: lacking(&|s| s.detection.is_none()),
                    })
                }
                (None, _) => Outcome::unavailable("needs cut sets"),
                (_, None) => Outcome::unavailable(no_numbers.clone().unwrap_or_default()),
            });

        // The model as written, then each control flipped on its own.
        let mut scenarios = Vec::new();
        let mut losses = false;
        if no_numbers.is_none() {
            let flips = std::iter::once(None).chain((0..written.len()).map(Some));
            for flip in flips {
                let mut enabled = written.clone();
                if let Some(i) = flip {
                    enabled[i] = !enabled[i];
                }
                let ds = leaf_distributions(model, &plan, &enabled);
                let lacking: Vec<String> = ds
                    .iter()
                    .enumerate()
                    .filter(|(_, d)| d.is_none())
                    .map(|(i, _)| name(&i))
                    .collect();
                let Some(ds) = ds.into_iter().collect::<Option<Vec<Distribution>>>() else {
                    // As written every leaf has numbers, and an effect only
                    // ever replaces them: this is a control switched off that
                    // was a leaf's only source.
                    scenarios.push(Scenario {
                        flip,
                        p_top_exact: None,
                        sampler: None,
                        chunks: vec![],
                        unavailable: Some(format!(
                            "switched off, it leaves no distribution on: {}",
                            lacking.join(", ")
                        )),
                    });
                    continue;
                };
                let p_top_exact = bdd.as_ref().ok().map(|b| {
                    b.prob(
                        b.root(),
                        &ds.iter().map(|d| cdf(d, model.horizon)).collect::<Vec<_>>(),
                    )
                });
                // A flip is sampled only when sampling is what measures it.
                let needed = flip.is_none() || losses || p_top_exact.is_none();
                let sampler =
                    needed.then(|| Sampler::new(model, &plan, ds, config.seed, config.samples));
                if flip.is_none() {
                    // Whether any loss is booked does not depend on the controls.
                    losses = sampler.as_ref().is_some_and(Sampler::has_losses);
                }
                scenarios.push(Scenario {
                    flip,
                    p_top_exact,
                    sampler,
                    chunks: vec![],
                    unavailable: None,
                });
            }
        }
        let total = scenarios
            .iter()
            .filter_map(|s| s.sampler.as_ref())
            .map(Sampler::chunks)
            .sum();

        let base = Base {
            leaves,
            p_node_exact,
            cut_sets: cut_sets_out,
            exact,
            attacker: attacker_out,
            no_numbers,
        };
        Ok(Solve {
            model: model.clone(),
            config: config.clone(),
            plan,
            base,
            scenarios,
            done: 0,
            total,
        })
    }

    /// Cut sets, available before any sampling.
    pub fn cut_sets(&self) -> &Outcome<CutSetsResult> {
        &self.base.cut_sets
    }

    /// Exact results, available before any sampling.
    pub fn exact(&self) -> &Outcome<Exact> {
        &self.base.exact
    }

    /// Leaf probabilities and importance, available before any sampling.
    pub fn leaves(&self) -> &[LeafResult] {
        &self.base.leaves
    }

    pub fn progress(&self) -> Progress {
        Progress {
            done: self.done,
            total: self.total,
        }
    }

    /// One chunk of sampling. Returns progress; does nothing once complete.
    pub fn step(&mut self) -> Progress {
        let next = self.scenarios.iter_mut().find_map(|s| {
            let sampler = s.sampler.as_ref()?;
            ((s.chunks.len() as u64) < sampler.chunks()).then_some((sampler, &mut s.chunks))
        });
        if let Some((sampler, chunks)) = next {
            chunks.push(sampler.run_chunk(chunks.len() as u64));
            self.done += 1;
        }
        self.progress()
    }

    pub fn finish(mut self) -> Results {
        while self.done < self.total {
            self.step();
        }
        let merged: Vec<Option<Sampled>> = self
            .scenarios
            .iter()
            .map(|s| {
                s.sampler
                    .as_ref()
                    .map(|x| x.merge(&s.chunks, self.config.confidence))
            })
            .collect();
        let baseline = merged.first().and_then(Option::as_ref);

        let band = |i: &crate::mc::Interval| Band { lo: i.lo, hi: i.hi };
        let sampled = match (baseline, &self.base.no_numbers) {
            (Some(s), _) => Outcome::Available(SampledResult {
                samples: s.samples,
                seed: self.config.seed,
                confidence: self.config.confidence,
                p_top: s.p_top,
                p_top_ci: band(&s.p_top_ci),
                ttc_cdf: s
                    .ttc_cdf
                    .iter()
                    .map(|(t, f, b)| (*t, *f, b.lo, b.hi))
                    .collect(),
                loss: s.loss.as_ref().map(|l| LossResult {
                    mean: l.mean,
                    mean_ci: band(&l.mean_ci),
                    p50: l.p50,
                    p90: l.p90,
                    p95: l.p95,
                    p99: l.p99,
                    exceedance: l.curve.clone(),
                    by_asset: l
                        .by_asset
                        .iter()
                        .map(|(a, d, mean)| AssetLoss {
                            asset: a.to_string(),
                            dim: d.key(),
                            mean: *mean,
                        })
                        .collect(),
                }),
            }),
            (None, reason) => Outcome::unavailable(reason.clone().unwrap_or_default()),
        };

        // Losses if the model books any; otherwise P(top), exact where it can be.
        let by_loss = baseline.is_some_and(|s| s.loss.is_some());
        let measure = |i: usize| -> Option<f64> {
            if by_loss {
                merged[i].as_ref()?.loss.as_ref().map(|l| l.mean)
            } else {
                self.scenarios[i]
                    .p_top_exact
                    .or(merged[i].as_ref().map(|s| s.p_top))
            }
        };
        let controls = match (measure_at(&self.scenarios, &measure), &self.base.no_numbers) {
            (Some(baseline), _) => {
                let mut out: Vec<ControlResult> = self
                    .scenarios
                    .iter()
                    .enumerate()
                    .filter_map(|(i, s)| Some((i, s.flip?)))
                    .map(|(i, c)| {
                        let (id, control) = self
                            .model
                            .controls
                            .get_index(c)
                            .expect("one scenario per control");
                        if let Some(reason) = &self.scenarios[i].unavailable {
                            return ControlResult {
                                id: id.to_string(),
                                enabled: control.enabled,
                                cost: control.cost,
                                flipped: None,
                                value: None,
                                value_ci: None,
                                value_per_cost: None,
                                rank: None,
                                unavailable: Some(reason.clone()),
                            };
                        }
                        let flipped = measure(i).expect("measured like the baseline");
                        let value = if control.enabled {
                            flipped - baseline
                        } else {
                            baseline - flipped
                        };
                        let value_ci = by_loss.then(|| {
                            let (with, without) =
                                (&self.scenarios[i].chunks, &self.scenarios[0].chunks);
                            let (_, ci) = if control.enabled {
                                paired_difference(with, without, self.config.confidence)
                            } else {
                                paired_difference(without, with, self.config.confidence)
                            };
                            Band {
                                lo: ci.lo,
                                hi: ci.hi,
                            }
                        });
                        let value_per_cost =
                            (!control.enabled && control.cost > 0.0).then(|| value / control.cost);
                        ControlResult {
                            id: id.to_string(),
                            enabled: control.enabled,
                            cost: control.cost,
                            flipped: Some(flipped),
                            value: Some(value),
                            value_ci,
                            value_per_cost,
                            rank: None,
                            unavailable: None,
                        }
                    })
                    .collect();
                // Best buy first; something for nothing beats any ratio.
                let mut order: Vec<usize> = (0..out.len())
                    .filter(|i| !out[*i].enabled && out[*i].value.is_some())
                    .collect();
                let score = |c: &ControlResult| {
                    c.value_per_cost
                        .unwrap_or(if c.value.is_some_and(|v| v > 0.0) {
                            f64::INFINITY
                        } else {
                            0.0
                        })
                };
                order.sort_by(|a, b| score(&out[*b]).total_cmp(&score(&out[*a])).then(a.cmp(b)));
                for (rank, i) in order.into_iter().enumerate() {
                    out[i].rank = Some(rank + 1);
                }
                Outcome::Available(ControlsResult {
                    measure: if by_loss { "expected_loss" } else { "p_top" },
                    baseline,
                    controls: out,
                })
            }
            (None, reason) => Outcome::unavailable(reason.clone().unwrap_or_default()),
        };

        let nodes = self
            .plan
            .ids
            .iter()
            .enumerate()
            .map(|(i, id)| NodeResult {
                id: id.to_string(),
                p_exact: self.base.p_node_exact.as_ref().map(|p| p[i]),
                p_sampled: baseline.map(|s| s.p_step[i]),
            })
            .collect();

        Results {
            schema: 1,
            profile: match self.model.profile {
                Profile::FaultTree => "fault-tree",
                Profile::AttackTree => "attack-tree",
            },
            time_unit: match self.model.time_unit {
                TimeUnit::Hours => "h",
                TimeUnit::Days => "d",
                TimeUnit::Years => "y",
            },
            horizon: self.model.horizon,
            currency: self.model.currency.clone(),
            leaves: self.base.leaves,
            nodes,
            cut_sets: self.base.cut_sets,
            exact: self.base.exact,
            sampled,
            attacker: self.base.attacker,
            controls,
        }
    }
}

fn measure_at(scenarios: &[Scenario], measure: &dyn Fn(usize) -> Option<f64>) -> Option<f64> {
    (!scenarios.is_empty()).then(|| measure(0)).flatten()
}
