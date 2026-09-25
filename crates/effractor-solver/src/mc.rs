//! Monte Carlo over the model: when does top happen, and what does it cost?
//!
//! Work is cut into chunks of [`CHUNK`] iterations. A chunk depends on nothing
//! but the sampler and its own index, so chunks can be computed in any order,
//! anywhere, and [`merge`]d by index into the same result — that is the whole
//! reproducibility story, for one thread in a browser or many elsewhere.

use effractor_core::{AssetId, Dim, Distribution, Model};
use libm::sqrt;
use rand_chacha::ChaCha8Rng;

use crate::dist::{CHUNK, chunk_rng, sample};
use crate::plan::Plan;
use crate::special::phi_inv;

/// Points on the time axis, 0 and the horizon included.
pub const GRID: usize = 65;

/// Each random quantity draws from its own window of a stream, addressed by
/// (iteration, slot). Leaves use the chunk's stream and loss magnitudes its
/// twin, so that giving a model assets cannot move a single fault. A leaf
/// therefore sees the same random numbers whatever else is going on — so when a control changes
/// one leaf's distribution, every other leaf's draws stay put, and the
/// difference between two runs is the control rather than noise. 256 words is
/// 32 draws; the hungriest sampler (a rejection loop) needs more than that
/// about once in 10^20 iterations.
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
    n: u64,
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

    pub fn chunks(&self) -> u64 {
        self.samples.div_ceil(CHUNK as u64)
    }

    pub fn run_chunk(&self, chunk: u64) -> Chunk {
        let n = (self.samples - chunk * CHUNK as u64).min(CHUNK as u64);
        let mut faults = chunk_rng(self.seed, chunk);
        let mut money = chunk_rng(self.seed, chunk | MONEY);
        let mut out = Chunk {
            n,
            hits: vec![0; self.plan.steps.len()],
            top_by: vec![0; GRID],
            // Nothing to keep without money: a chunk holds no per-iteration row.
            losses: Vec::with_capacity(if self.has_losses() { n as usize } else { 0 }),
            booked: vec![0.0; self.magnitudes.len()],
        };
        let (mut leaf_times, mut times, mut scratch) =
            (vec![0.0; self.leaves.len()], Vec::new(), Vec::new());
        let mut fraction = vec![0.0f64; self.magnitudes.len()];
        let draw =
            |rng: &mut ChaCha8Rng, iteration: u128, slots: usize, slot: usize, d: &Distribution| {
                rng.set_word_pos((iteration * slots as u128 + slot as u128) * WINDOW);
                sample(d, rng)
            };

        for iteration in 0..u128::from(n) {
            for (leaf, d) in self.leaves.iter().enumerate() {
                leaf_times[leaf] = draw(&mut faults, iteration, self.leaves.len(), leaf, d);
            }
            self.plan.times(&leaf_times, &mut times, &mut scratch);
            for (hit, t) in out.hits.iter_mut().zip(&times) {
                *hit += u64::from(*t <= self.horizon);
            }
            let top = times[self.plan.top()];
            if top <= self.horizon {
                // The first grid point at or after it. Multiplying before
                // dividing keeps this exact at the grid points themselves.
                let at = (0..GRID)
                    .find(|j| top * (GRID - 1) as f64 <= self.horizon * *j as f64)
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
        out
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
                    self.horizon * j as f64 / (GRID - 1) as f64,
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
}
