//! A generated graph's results: `(architecture, graph, scenario?) -> GraphResults`,
//! in steps, one chunk of samples each, so a caller can show progress and
//! stop between chunks.
//!
//! The baseline and at most one scenario are sampled together on the same
//! draws. What needs no draw — a target seeded or unreachable by structure —
//! is said without pretending to have sampled it; what rests on an unknown
//! input has no number, and says which inputs are missing.

use effractor_components::{
    Binding, GeneratedGraph, GeneratedKind, ResolvedGraph, ResolvedTtc, SEMANTICS, resolve,
};
use effractor_core::architecture::Architecture;
use effractor_core::{Code, Diagnostic, Distribution, ScenarioId, TimeUnit};
use libm::sqrt;
use serde::Serialize;

use crate::graph_mc::{Draw, GraphChunk, GraphSampler, Merged, grid_time, merge};
use crate::graph_plan::{EventPlan, GraphOp};
use crate::graph_support::{GraphSupport, Status, analyze};
use crate::mc::{GRID, wilson};
use crate::results::Progress;
use crate::special::phi_inv;

/// The most samples a graph solve takes.
pub const MAX_SAMPLES: u64 = 100_000;

#[derive(Debug, Clone, PartialEq)]
pub struct GraphConfig {
    pub seed: u64,
    pub samples: u64,
    pub confidence: f64,
}

impl GraphConfig {
    /// What the document asks for.
    pub fn from_model(model: &Architecture) -> Self {
        Self {
            seed: model.analysis.seed,
            samples: model.analysis.samples,
            confidence: model.analysis.confidence,
        }
    }
}

/// A result, or why there is none and which inputs would give one.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum GraphOutcome<T> {
    Available(T),
    Unavailable {
        reason: String,
        missing: Vec<String>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Band {
    pub lo: f64,
    pub hi: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Library {
    pub id: String,
    pub version: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct GraphResults {
    #[serde(rename = "effractor-graph-results")]
    pub schema: u32,
    pub semantics: &'static str,
    pub library: Library,
    pub target: String,
    pub time_unit: &'static str,
    pub horizon: f64,
    /// A string: seeds go past what a JavaScript number holds exactly.
    pub seed: String,
    pub samples: u64,
    pub confidence: f64,
    pub baseline: ScenarioReport,
    pub scenario: Option<ScenarioReport>,
    pub delta: GraphOutcome<Delta>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ScenarioReport {
    /// `None` for the baseline.
    pub id: Option<String>,
    pub outcome: GraphOutcome<TargetStats>,
    pub nodes: Vec<NodeReport>,
    /// What the target's number rests on, by source path.
    pub assumptions: Vec<Assumption>,
    /// The first sample that reached the target, whole.
    pub witness: Option<WitnessReport>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct TargetStats {
    /// `sampled`, or `structural` when no draw can change the answer.
    pub method: &'static str,
    /// 0 for a structural answer.
    pub samples: u64,
    pub confidence: f64,
    /// P(target by the horizon).
    pub p_target: f64,
    pub ci: Band,
    /// 65 rows of `[t, P(target by t), lo, hi]`, 0 through the horizon.
    pub ttc_cdf: Vec<[f64; 4]>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NodeReport {
    pub id: String,
    /// `seeded`, `possible`, `blocked` or `unreachable`.
    pub status: &'static str,
    pub outcome: GraphOutcome<NodeStats>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NodeStats {
    /// P(step by the horizon).
    pub p: f64,
    pub ci: Band,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Assumption {
    /// The value itself: a parameter slot, a permission or the scenario
    /// change that set it.
    pub path: String,
    /// Every source field that decided it, the switch that chose a
    /// replacement slot included.
    pub paths: Vec<String>,
    /// The parameter's evidence, `policy`, `defense`, or `unknown`.
    pub status: &'static str,
    /// Canonical TTC text, `allowed`/`denied` for a firewall rule, `off`/`on`
    /// for a defence switch, `None` if unknown.
    pub expression: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WitnessReport {
    pub sample: u64,
    pub target_time: f64,
    /// By completion time, then id.
    pub nodes: Vec<WitnessNode>,
    pub edges: Vec<WitnessEdge>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WitnessNode {
    pub id: String,
    pub time: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct WitnessEdge {
    pub prerequisite: String,
    pub dependent: String,
}

/// Baseline minus scenario: P(target by the horizon) that the scenario takes
/// away, positive when it helps, from paired samples.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Delta {
    pub mean: f64,
    pub ci: Option<Band>,
    /// Why there is no interval, when there is none.
    pub ci_reason: Option<String>,
}

/// One side: what it resolved to and what can happen under it.
struct SideSetup {
    id: Option<ScenarioId>,
    resolved: ResolvedGraph,
    support: GraphSupport,
}

pub struct GraphSolve {
    graph: GeneratedGraph,
    time_unit: TimeUnit,
    horizon: f64,
    config: GraphConfig,
    sides: Vec<SideSetup>,
    sampler: GraphSampler,
    chunks: Vec<GraphChunk>,
}

fn unknown<T>(missing: &[String]) -> GraphOutcome<T> {
    GraphOutcome::Unavailable {
        reason: "rests on unknown inputs".to_owned(),
        missing: missing.to_vec(),
    }
}

fn refuse(path: &str, message: impl Into<String>) -> Vec<Diagnostic> {
    vec![Diagnostic::error(Code::ParamDomain, path, message)]
}

impl GraphSolve {
    pub fn begin(
        model: &Architecture,
        graph: &GeneratedGraph,
        scenario: Option<&ScenarioId>,
        config: &GraphConfig,
    ) -> Result<Self, Vec<Diagnostic>> {
        if !(1..=MAX_SAMPLES).contains(&config.samples) {
            return Err(refuse(
                "analysis.samples",
                format!("samples must be 1 to {MAX_SAMPLES}"),
            ));
        }
        if !(config.confidence > 0.0 && config.confidence < 1.0) {
            return Err(refuse(
                "analysis.confidence",
                "confidence must be in (0, 1)",
            ));
        }
        if !(model.horizon.is_finite() && model.horizon > 0.0) {
            return Err(refuse("horizon", "the horizon must be finite and > 0"));
        }
        if graph.semantics != SEMANTICS || graph.library != model.library {
            return Err(vec![Diagnostic::error(
                Code::UnknownLibrary,
                "library",
                "the graph was generated by another library or semantics",
            )]);
        }
        let plan = EventPlan::new(
            graph
                .nodes
                .iter()
                .map(|n| match &n.kind {
                    GeneratedKind::Input => GraphOp::Input,
                    GeneratedKind::Any { inputs } => GraphOp::Any(inputs.clone()),
                    GeneratedKind::All { inputs } => GraphOp::All(inputs.clone()),
                })
                .collect(),
        )?;
        let mut sides = Vec::new();
        for id in [None].into_iter().chain(scenario.map(Some)) {
            let resolved = resolve(model, graph, id)?;
            let support = analyze(graph, &resolved);
            sides.push(SideSetup {
                id: id.cloned(),
                resolved,
                support,
            });
        }
        let draws = sides
            .iter()
            .map(|side| {
                graph
                    .nodes
                    .iter()
                    .zip(&side.resolved.ttc)
                    .map(|(node, ttc)| match (&node.kind, ttc) {
                        (GeneratedKind::Any { .. }, _) => Draw::Fixed(0.0),
                        // Never read for a number: a node resting on it has none.
                        (_, ResolvedTtc::Unknown(_)) => Draw::Fixed(f64::INFINITY),
                        (_, ResolvedTtc::Known(Distribution::Zero)) => Draw::Fixed(0.0),
                        (_, ResolvedTtc::Known(Distribution::Infinity)) => {
                            Draw::Fixed(f64::INFINITY)
                        }
                        (_, ResolvedTtc::Known(d)) => Draw::Random(d.clone()),
                    })
                    .collect()
            })
            .collect();
        Ok(Self {
            sampler: GraphSampler {
                plan,
                sides: draws,
                target: graph.target,
                horizon: model.horizon,
                seed: config.seed,
                samples: config.samples,
            },
            graph: graph.clone(),
            time_unit: model.time_unit,
            horizon: model.horizon,
            config: config.clone(),
            sides,
            chunks: Vec::new(),
        })
    }

    pub fn progress(&self) -> Progress {
        Progress {
            done: self.chunks.len() as u64,
            total: self.sampler.chunks(),
        }
    }

    /// One chunk of samples, for every side. Does nothing once complete.
    pub fn step(&mut self) -> Progress {
        let next = self.chunks.len() as u64;
        if next < self.sampler.chunks() {
            self.chunks.push(self.sampler.run_chunk(next));
        }
        self.progress()
    }

    pub fn finish(mut self) -> GraphResults {
        while self.step().done < self.sampler.chunks() {}
        let nodes = self.graph.nodes.len();
        let z = phi_inv((1.0 + self.config.confidence) / 2.0);
        let reports: Vec<ScenarioReport> = self
            .sides
            .iter()
            .enumerate()
            .map(|(s, side)| self.report(side, &merge(&self.chunks, s, nodes), z))
            .collect();
        let mut reports = reports.into_iter();
        let baseline = reports.next().expect("the baseline is always solved");
        let scenario = reports.next();
        let delta = self.delta(&baseline, scenario.as_ref(), z);
        GraphResults {
            schema: 1,
            semantics: SEMANTICS,
            library: Library {
                id: self.graph.library.id.clone(),
                version: self.graph.library.version,
            },
            target: self.graph.nodes[self.graph.target].id.clone(),
            time_unit: match self.time_unit {
                TimeUnit::Hours => "h",
                TimeUnit::Days => "d",
                TimeUnit::Years => "y",
            },
            horizon: self.horizon,
            seed: self.config.seed.to_string(),
            samples: self.config.samples,
            confidence: self.config.confidence,
            baseline,
            scenario,
            delta,
        }
    }

    fn report(&self, side: &SideSetup, merged: &Merged, z: f64) -> ScenarioReport {
        let support = &side.support;
        let target = self.graph.target;
        let n = merged.n;
        let fixed = |p: f64| Band { lo: p, hi: p };

        let nodes = self
            .graph
            .nodes
            .iter()
            .enumerate()
            .map(|(i, node)| {
                let status = support.status[i];
                let outcome = match status {
                    _ if !support.missing[i].is_empty() => unknown(&support.missing[i]),
                    Status::Seeded => GraphOutcome::Available(NodeStats {
                        p: 1.0,
                        ci: fixed(1.0),
                    }),
                    Status::Blocked | Status::Unreachable => GraphOutcome::Available(NodeStats {
                        p: 0.0,
                        ci: fixed(0.0),
                    }),
                    Status::Possible => {
                        let ci = wilson(merged.hits[i], n, z);
                        GraphOutcome::Available(NodeStats {
                            p: merged.hits[i] as f64 / n as f64,
                            ci: Band {
                                lo: ci.lo,
                                hi: ci.hi,
                            },
                        })
                    }
                };
                NodeReport {
                    id: node.id.clone(),
                    status: status.as_str(),
                    outcome,
                }
            })
            .collect();

        let structural = |p: f64| TargetStats {
            method: "structural",
            samples: 0,
            confidence: self.config.confidence,
            p_target: p,
            ci: fixed(p),
            ttc_cdf: (0..GRID)
                .map(|j| [grid_time(self.horizon, j), p, p, p])
                .collect(),
        };
        let outcome = match support.status[target] {
            _ if !support.missing[target].is_empty() => unknown(&support.missing[target]),
            Status::Seeded => GraphOutcome::Available(structural(1.0)),
            Status::Blocked | Status::Unreachable => GraphOutcome::Available(structural(0.0)),
            Status::Possible => {
                let hits = merged.target_by[GRID - 1];
                let ci = wilson(hits, n, z);
                GraphOutcome::Available(TargetStats {
                    method: "sampled",
                    samples: n,
                    confidence: self.config.confidence,
                    p_target: hits as f64 / n as f64,
                    ci: Band {
                        lo: ci.lo,
                        hi: ci.hi,
                    },
                    ttc_cdf: (0..GRID)
                        .map(|j| {
                            let by = merged.target_by[j];
                            let band = wilson(by, n, z);
                            [
                                grid_time(self.horizon, j),
                                by as f64 / n as f64,
                                band.lo,
                                band.hi,
                            ]
                        })
                        .collect(),
                })
            }
        };

        let witness = match (&outcome, &merged.route) {
            (GraphOutcome::Available(_), Some(route)) => {
                let id = |i: usize| self.graph.nodes[i].id.clone();
                let mut nodes: Vec<(f64, usize)> = route
                    .witness
                    .nodes
                    .iter()
                    .zip(&route.times)
                    .map(|(&i, &t)| (t, i))
                    .collect();
                nodes.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
                Some(WitnessReport {
                    sample: route.sample,
                    target_time: route.times[route
                        .witness
                        .nodes
                        .binary_search(&target)
                        .expect("a witness holds its target")],
                    nodes: nodes
                        .into_iter()
                        .map(|(time, i)| WitnessNode { id: id(i), time })
                        .collect(),
                    edges: route
                        .witness
                        .edges
                        .iter()
                        .map(|&(p, d)| WitnessEdge {
                            prerequisite: id(p),
                            dependent: id(d),
                        })
                        .collect(),
                })
            }
            _ => None,
        };

        ScenarioReport {
            id: side.id.as_ref().map(ToString::to_string),
            outcome,
            nodes,
            assumptions: self.assumptions(side),
            witness,
        }
    }

    /// What the target's result rests on, once per path: every parameter and
    /// policy its support reads, the policies that make a fact in it happen
    /// at once, and the known blockers — denials, never-TTCs — behind which
    /// the rest of its routes stop. A structural zero rests on those.
    fn assumptions(&self, side: &SideSetup) -> Vec<Assumption> {
        let r = &side.resolved;
        let support = &side.support;
        let n = self.graph.nodes.len();
        let inputs = |i: usize| -> &[usize] {
            match &self.graph.nodes[i].kind {
                GeneratedKind::Input => &[],
                GeneratedKind::Any { inputs } | GeneratedKind::All { inputs } => inputs,
            }
        };
        let mut listed = vec![false; n];
        let mut stack = support.target_support.clone();
        for &i in &stack {
            listed[i] = true;
        }
        while let Some(i) = stack.pop() {
            if !support.zero[i] {
                continue;
            }
            for &j in inputs(i) {
                if support.zero[j] && !listed[j] {
                    listed[j] = true;
                    stack.push(j);
                }
            }
        }
        // Everything the target could be derived from, possible or not, short
        // of what happens at once anyway: its blockers are listed.
        let mut region = vec![false; n];
        let mut stack = vec![self.graph.target];
        region[self.graph.target] = true;
        while let Some(i) = stack.pop() {
            if support.status[i] == Status::Blocked {
                listed[i] = true;
            }
            if support.zero[i] {
                continue;
            }
            for &j in inputs(i) {
                if !region[j] {
                    region[j] = true;
                    stack.push(j);
                }
            }
        }
        let mut out: Vec<Assumption> = (0..n)
            .filter(|&i| listed[i])
            .filter_map(|i| {
                let path = r.paths[i].first()?.clone();
                let note = r.evidence[i].first().and_then(|p| p.note.clone());
                let (status, expression) = match (&self.graph.nodes[i].duration, &r.ttc[i]) {
                    (Binding::Permission(_), ResolvedTtc::Known(d)) => (
                        "policy",
                        Some(if matches!(d, Distribution::Infinity) {
                            "denied".to_owned()
                        } else {
                            "allowed".to_owned()
                        }),
                    ),
                    (Binding::Policy { .. }, ResolvedTtc::Known(d)) => (
                        "defense",
                        Some(
                            if matches!(d, Distribution::Infinity) {
                                "on"
                            } else {
                                "off"
                            }
                            .to_owned(),
                        ),
                    ),
                    (Binding::Parameter { .. }, ResolvedTtc::Known(d)) => (
                        r.evidence[i]
                            .first()
                            .map_or("unknown", |p| p.status.as_str()),
                        Some(effractor_format::expr::write(d)),
                    ),
                    (
                        Binding::Permission(_) | Binding::Policy { .. } | Binding::Parameter { .. },
                        ResolvedTtc::Unknown(_),
                    )
                    | (Binding::Unfinished { .. }, _) => ("unknown", None),
                    (Binding::Logical | Binding::Foothold(_), _) => return None,
                };
                Some(Assumption {
                    path,
                    paths: r.paths[i].clone(),
                    status,
                    expression,
                    note,
                })
            })
            .collect();
        out.sort_by(|a, b| a.path.cmp(&b.path));
        out.dedup_by(|a, b| a.path == b.path);
        out
    }

    fn delta(
        &self,
        baseline: &ScenarioReport,
        scenario: Option<&ScenarioReport>,
        z: f64,
    ) -> GraphOutcome<Delta> {
        let Some(scenario) = scenario else {
            return GraphOutcome::Unavailable {
                reason: "no scenario to compare".to_owned(),
                missing: Vec::new(),
            };
        };
        let mut missing = Vec::new();
        for side in [baseline, scenario] {
            if let GraphOutcome::Unavailable { missing: m, .. } = &side.outcome {
                missing.extend(m.iter().cloned());
            }
        }
        if !missing.is_empty() {
            missing.sort();
            missing.dedup();
            return GraphOutcome::Unavailable {
                reason: "a side rests on unknown inputs".to_owned(),
                missing,
            };
        }
        let plus: u64 = self.chunks.iter().map(|c| c.plus).sum();
        let minus: u64 = self.chunks.iter().map(|c| c.minus).sum();
        let n: u64 = self.chunks.iter().map(|c| c.n).sum();
        let (s, q, nf) = (plus as f64 - minus as f64, (plus + minus) as f64, n as f64);
        let mean = s / nf;
        if n < 2 {
            return GraphOutcome::Available(Delta {
                mean,
                ci: None,
                ci_reason: Some("fewer than two paired samples".to_owned()),
            });
        }
        let variance = ((q - nf * mean * mean) / (nf - 1.0)).max(0.0);
        let half = z * sqrt(variance / nf);
        GraphOutcome::Available(Delta {
            mean,
            ci: Some(Band {
                lo: (mean - half).clamp(-1.0, 1.0),
                hi: (mean + half).clamp(-1.0, 1.0),
            }),
            ci_reason: None,
        })
    }
}
