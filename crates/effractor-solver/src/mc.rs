//! Monte Carlo over the model: when does top happen, and what does it cost?
//!
//! Work is cut into chunks of [`CHUNK`] iterations. A chunk depends on nothing
//! but the sampler and its own index, so chunks can be computed in any order,
//! anywhere, and [`merge`]d by index into the same result — that is the whole
//! reproducibility story, for one thread in a browser or many elsewhere.

use effractor_core::{AssetId, Dim, Distribution, Model};
use libm::sqrt;
use rand_chacha::ChaCha8Rng;

use crate::dist::{CHUNK, STEP_WORK, chunk_rng, sample};
use crate::plan::Plan;
use crate::special::phi_inv;

/// Points on the time axis, 0 and the horizon included.
pub const GRID: usize = 65;

/// Grid time `j`: the horizon split without an intermediate overflow. `j / 64`
/// is exact, so below overflow this is the same bits as `horizon * j / 64`.
pub(crate) fn grid_time(horizon: f64, j: usize) -> f64 {
    horizon * (j as f64 / (GRID - 1) as f64)
}

/// Each random quantity draws from its own window of a stream, addressed by
/// (iteration, slot). Leaves use the chunk's stream and loss magnitudes its
/// twin, so that giving a model assets cannot move a single fault. A leaf
/// therefore sees the same random numbers whatever else is going on — so when a control changes
/// one leaf's distribution, every other leaf's draws stay put, and the
/// difference between two runs is the control rather than noise. A window is
/// 256 of the stream's 32-bit words, and a uniform takes two: 128 uniforms. The
/// hungriest sampler, PERT, runs two gamma rejection loops at two uniforms a
/// try, each rejecting under 5 % of the time; it needs more than 128 less than
/// once in 10^80 iterations.
const WINDOW: u128 = 256;

/// Stream ids with this bit set belong to loss magnitudes.
const MONEY: u64 = 1 << 63;

pub struct Sampler {
    plan: Plan,
    leaves: Vec<Distribution>,
    /// (step, magnitude slot, fraction)
    consequences: Vec<(usize, usize, f64)>,
    magnitudes: Vec<(AssetId, Dim, Distribution)>,
    horizon: f64,
    seed: u64,
    samples: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Chunk {
    index: u64,
    n: u64,
    /// Iterations computed so far; the chunk is complete at `n`.
    done: u64,
    /// Per plan step: iterations in which it completed within the horizon.
    hits: Vec<u64>,
    /// Per grid interval: iterations in which top completed in it.
    top_by: Vec<u64>,
    losses: Vec<f64>,
    /// Per magnitude slot: total loss booked to it.
    booked: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Interval {
    pub lo: f64,
    pub hi: f64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Sampled {
    pub samples: u64,
    pub p_top: f64,
    pub p_top_ci: Interval,
    /// P(step completes within the horizon), per plan step.
    pub p_step: Vec<f64>,
    /// (t, P(top <= t), band) on the grid.
    pub ttc_cdf: Vec<(f64, f64, Interval)>,
    pub loss: Option<Loss>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Loss {
    /// Expected loss over the horizon.
    pub mean: f64,
    pub mean_ci: Interval,
    pub p50: f64,
    pub p90: f64,
    pub p95: f64,
    pub p99: f64,
    /// (loss, P(loss >= that)), ascending in loss: the exceedance curve.
    pub curve: Vec<(f64, f64)>,
    pub by_asset: Vec<(AssetId, Dim, f64)>,
}

impl Chunk {
    pub fn is_complete(&self) -> bool {
        self.done == self.n
    }
}

impl Sampler {
    /// `leaves` is one distribution per plan leaf — see
    /// [`crate::scenario::leaf_distributions`]; the caller has already dealt
    /// with leaves that have none.
    pub fn new(
        model: &Model,
        plan: &Plan,
        leaves: Vec<Distribution>,
        seed: u64,
        samples: u64,
    ) -> Self {
        let mut magnitudes: Vec<(AssetId, Dim, Distribution)> = Vec::new();
        let mut consequences = Vec::new();
        for (step, id) in plan.ids.iter().enumerate() {
            for c in &model.nodes[id].consequences {
                let Some(magnitude) = model.assets.get(&c.asset).and_then(|a| a.loss.get(c.dim))
                else {
                    continue;
                };
                let slot = magnitudes
                    .iter()
                    .position(|(a, d, _)| *a == c.asset && *d == c.dim)
                    .unwrap_or_else(|| {
                        magnitudes.push((c.asset.clone(), c.dim, magnitude.clone()));
                        magnitudes.len() - 1
                    });
                consequences.push((step, slot, c.fraction));
            }
        }
        Self {
            plan: plan.clone(),
            leaves,
            consequences,
            magnitudes,
            horizon: model.horizon,
            seed,
            samples,
        }
    }

    /// Does any consequence carry a loss? If not, there is no money to sample.
    pub fn has_losses(&self) -> bool {
        !self.magnitudes.is_empty()
    }

    pub fn samples(&self) -> u64 {
        self.samples
    }

    pub fn chunks(&self) -> u64 {
        self.samples.div_ceil(CHUNK as u64)
    }

    /// Iterations of one step that do about [`STEP_WORK`] draws and gates.
    pub fn step_iterations(&self) -> u64 {
        (STEP_WORK / self.plan.steps.len().max(1) as u64).max(1)
    }

    /// Chunk `chunk`, with nothing computed yet: see [`Sampler::advance`].
    pub fn start_chunk(&self, chunk: u64) -> Chunk {
        let n = (self.samples - chunk * CHUNK as u64).min(CHUNK as u64);
        Chunk {
            index: chunk,
            n,
            done: 0,
            hits: vec![0; self.plan.steps.len()],
            top_by: vec![0; GRID],
            // Nothing to keep without money: a chunk holds no per-iteration row.
            losses: Vec::with_capacity(if self.has_losses() { n as usize } else { 0 }),
            booked: vec![0.0; self.magnitudes.len()],
        }
    }

    pub fn run_chunk(&self, chunk: u64) -> Chunk {
        let mut out = self.start_chunk(chunk);
        self.advance(&mut out, u64::MAX);
        out
    }

    /// Up to `budget` more iterations of `out`; returns how many. Every draw
    /// is addressed by its iteration, so a chunk computed in pieces is the
    /// same chunk to the bit.
    pub fn advance(&self, out: &mut Chunk, budget: u64) -> u64 {
        let (from, to) = (out.done, out.n.min(out.done.saturating_add(budget)));
        let mut faults = chunk_rng(self.seed, out.index);
        let mut money = chunk_rng(self.seed, out.index | MONEY);
        let (mut leaf_times, mut times, mut scratch) =
            (vec![0.0; self.leaves.len()], Vec::new(), Vec::new());
        let mut fraction = vec![0.0f64; self.magnitudes.len()];
        let draw =
            |rng: &mut ChaCha8Rng, iteration: u128, slots: usize, slot: usize, d: &Distribution| {
                rng.set_word_pos((iteration * slots as u128 + slot as u128) * WINDOW);
                sample(d, rng)
            };

        for iteration in u128::from(from)..u128::from(to) {
            for (leaf, d) in self.leaves.iter().enumerate() {
                leaf_times[leaf] = draw(&mut faults, iteration, self.leaves.len(), leaf, d);
            }
            self.plan.times(&leaf_times, &mut times, &mut scratch);
            for (hit, t) in out.hits.iter_mut().zip(&times) {
                *hit += u64::from(*t <= self.horizon);
            }
            let top = times[self.plan.top()];
            if top <= self.horizon {
                // The first grid point at or after it.
                let at = (0..GRID)
                    .find(|&j| top <= grid_time(self.horizon, j))
                    .unwrap_or(GRID - 1);
                out.top_by[at] += 1;
            }

            // Two paths to the same breach are one breach: per asset and
            // dimension the largest fraction counts, once.
            fraction.fill(0.0);
            for (step, slot, f) in &self.consequences {
                if times[*step] <= self.horizon {
                    fraction[*slot] = fraction[*slot].max(*f);
                }
            }
            let mut loss = 0.0;
            for (slot, f) in fraction.iter().enumerate().filter(|(_, f)| **f > 0.0) {
                let part = f * draw(
                    &mut money,
                    iteration,
                    self.magnitudes.len(),
                    slot,
                    &self.magnitudes[slot].2,
                );
                out.booked[slot] += part;
                loss += part;
            }
            if self.has_losses() {
                out.losses.push(loss);
            }
        }
        out.done = to;
        to - from
    }

    /// `chunks` in index order, all of them.
    pub fn merge(&self, chunks: &[Chunk], confidence: f64) -> Sampled {
        let n: u64 = chunks.iter().map(|c| c.n).sum();
        let z = phi_inv((1.0 + confidence) / 2.0);
        let column = |pick: &dyn Fn(&Chunk) -> &Vec<u64>, i: usize| {
            chunks.iter().map(|c| pick(c)[i]).sum::<u64>()
        };
        let top_hits = column(&|c| &c.hits, self.plan.top());

        let mut running = 0;
        let ttc_cdf = (0..GRID)
            .map(|j| {
                running += column(&|c| &c.top_by, j);
                (
                    grid_time(self.horizon, j),
                    running as f64 / n as f64,
                    wilson(running, n, z),
                )
            })
            .collect();

        let loss = (!self.magnitudes.is_empty()).then(|| {
            // Chunk order, so the sum is the same sum however chunks were computed.
            let mut losses: Vec<f64> = chunks
                .iter()
                .flat_map(|c| c.losses.iter().copied())
                .collect();
            let mean = losses.iter().sum::<f64>() / n as f64;
            let variance =
                losses.iter().map(|l| (l - mean) * (l - mean)).sum::<f64>() / (n.max(2) - 1) as f64;
            let half = z * sqrt(variance / n as f64);
            losses.sort_by(f64::total_cmp);
            let quantile =
                |q: f64| losses[((q * n as f64).ceil() as usize).clamp(1, losses.len()) - 1];
            let by_asset = self
                .magnitudes
                .iter()
                .enumerate()
                .map(|(slot, (a, d, _))| {
                    (
                        a.clone(),
                        *d,
                        chunks.iter().map(|c| c.booked[slot]).sum::<f64>() / n as f64,
                    )
                })
                .collect();
            Loss {
                mean,
                mean_ci: Interval {
                    lo: (mean - half).max(0.0),
                    hi: mean + half,
                },
                p50: quantile(0.5),
                p90: quantile(0.9),
                p95: quantile(0.95),
                p99: quantile(0.99),
                curve: exceedance(&losses),
                by_asset,
            }
        });

        Sampled {
            samples: n,
            p_top: top_hits as f64 / n as f64,
            p_top_ci: wilson(top_hits, n, z),
            p_step: (0..self.plan.steps.len())
                .map(|i| column(&|c| &c.hits, i) as f64 / n as f64)
                .collect(),
            ttc_cdf,
            loss,
        }
    }
}

/// Mean of `a − b` per iteration, with its interval. The two runs must share a
/// seed: then iteration i is the same world in both, the difference is paired,
/// and its interval is far tighter than the two means' own would suggest.
pub fn paired_difference(a: &[Chunk], b: &[Chunk], confidence: f64) -> (f64, Interval) {
    let d: Vec<f64> = a
        .iter()
        .flat_map(|c| &c.losses)
        .zip(b.iter().flat_map(|c| &c.losses))
        .map(|(x, y)| x - y)
        .collect();
    let n = d.len() as f64;
    let mean = d.iter().sum::<f64>() / n;
    let variance = d.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / (n - 1.0).max(1.0);
    let half = phi_inv((1.0 + confidence) / 2.0) * sqrt(variance / n);
    (
        mean,
        Interval {
            lo: mean - half,
            hi: mean + half,
        },
    )
}

/// The Wilson score interval: honest near 0 and 1, where a fault tree lives
/// and the textbook interval collapses to a point.
pub fn wilson(hits: u64, n: u64, z: f64) -> Interval {
    let (n, p) = (n as f64, hits as f64 / n as f64);
    let scale = 1.0 + z * z / n;
    let centre = (p + z * z / (2.0 * n)) / scale;
    let half = z / scale * sqrt(p * (1.0 - p) / n + z * z / (4.0 * n * n));
    Interval {
        lo: (centre - half).max(0.0),
        hi: (centre + half).min(1.0),
    }
}

/// At most 200 points of (loss, P(loss >= it)) from sorted losses, always
/// including the smallest and the largest.
fn exceedance(sorted: &[f64]) -> Vec<(f64, f64)> {
    const POINTS: usize = 200;
    let n = sorted.len();
    let mut curve: Vec<(f64, f64)> = Vec::new();
    for k in 0..POINTS.min(n) {
        let rank = if n <= POINTS {
            k
        } else {
            k * (n - 1) / (POINTS - 1)
        };
        let x = sorted[rank];
        if curve.last().is_some_and(|(last, _)| *last == x) {
            continue;
        }
        let first = sorted.partition_point(|l| *l < x);
        curve.push((x, (n - first) as f64 / n as f64));
    }
    curve
}

#[cfg(test)]
mod tests {
    use effractor_core::{LeafKind, Model, Node, Profile, Ttc};

    use super::*;

    #[test]
    fn without_money_a_chunk_keeps_no_losses() {
        let mut m = Model::new("t", Profile::FaultTree, "top".parse().unwrap());
        m.nodes.insert(
            "top".parse().unwrap(),
            Node::leaf("top", LeafKind::Basic, Some(Ttc::P(0.5))),
        );
        let plan = Plan::build(&m).unwrap();
        let s = Sampler::new(&m, &plan, vec![Distribution::Bernoulli(0.5)], 1, 5000);
        let chunk = s.run_chunk(0);
        assert_eq!((chunk.n, chunk.losses.len()), (CHUNK as u64, 0));
        assert!(s.merge(&[chunk, s.run_chunk(1)], 0.95).loss.is_none());
    }

    #[test]
    fn a_chunk_computed_in_pieces_is_the_same_chunk() {
        let mut m = Model::new("t", Profile::FaultTree, "top".parse().unwrap());
        m.nodes.insert(
            "top".parse().unwrap(),
            Node::leaf("top", LeafKind::Basic, Some(Ttc::Rate(0.5))),
        );
        m.assets.insert(
            "a".parse().unwrap(),
            effractor_core::Asset {
                label: "a".into(),
                description: None,
                loss: effractor_core::Loss {
                    c: Some(Distribution::LogNormal {
                        mu: 10.0,
                        sigma: 1.0,
                    }),
                    i: None,
                    a: None,
                },
            },
        );
        m.nodes[&"top".parse::<effractor_core::NodeId>().unwrap()]
            .consequences
            .push(effractor_core::Consequence {
                asset: "a".parse().unwrap(),
                dim: Dim::C,
                fraction: 1.0,
            });
        let plan = Plan::build(&m).unwrap();
        let d = Distribution::Exponential(0.5);
        let s = Sampler::new(&m, &plan, vec![d], 3, CHUNK as u64 + 7);
        assert!(s.has_losses());
        for chunk in 0..2 {
            let mut pieces = s.start_chunk(chunk);
            while !pieces.is_complete() {
                assert!(s.advance(&mut pieces, 999) <= 999);
            }
            assert_eq!(pieces, s.run_chunk(chunk));
        }
    }
}
