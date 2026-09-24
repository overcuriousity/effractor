//! Monte Carlo over a generated graph, for the baseline and at most one
//! scenario at once, on the same draws.
//!
//! Every node owns a random window per iteration, addressed by its index in
//! the whole sorted graph — its slot — whether or not it is sampled, so
//! neither a target nor a scenario renumbers another step's draws. Two sides
//! that give a step the same distribution therefore give it the same time in
//! every iteration, and their difference is the defence rather than noise.
//! A chunk keeps counters and at most one route per side, never a
//! samples × nodes table; chunks merge in index order.

use effractor_core::Distribution;

use crate::dist::{CHUNK, chunk_rng, sample};
use crate::graph_plan::{EventPlan, Scratch, Witness};
use crate::mc::GRID;

/// 256 words is 32 draws, as for trees.
const WINDOW: u128 = 256;

/// Where a node's duration comes from in one side's samples.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Draw {
    Fixed(f64),
    Random(Distribution),
}

/// The draws of one side, one per node.
pub(crate) type Side = Vec<Draw>;

pub(crate) struct GraphSampler {
    pub(crate) plan: EventPlan,
    pub(crate) sides: Vec<Side>,
    /// Per side: what every random draw is divided by. 1 leaves it exact.
    pub(crate) speeds: Vec<f64>,
    pub(crate) target: usize,
    pub(crate) horizon: f64,
    pub(crate) seed: u64,
    pub(crate) samples: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Route {
    /// Global sample index.
    pub(crate) sample: u64,
    pub(crate) witness: Witness,
    /// Completion times, aligned with `witness.nodes`.
    pub(crate) times: Vec<f64>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SideCounts {
    /// Per node: iterations in which it completed within the horizon.
    pub(crate) hits: Vec<u64>,
    /// Per grid point: iterations whose target completed at or before it and
    /// after the one before.
    pub(crate) target_by: Vec<u64>,
    /// The first iteration that reached the target within the horizon.
    pub(crate) route: Option<Route>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GraphChunk {
    pub(crate) n: u64,
    pub(crate) sides: Vec<SideCounts>,
    /// Iterations in which the baseline reached the target and the scenario
    /// did not, and the reverse.
    pub(crate) plus: u64,
    pub(crate) minus: u64,
    #[cfg(test)]
    pub(crate) indicators: Vec<(bool, bool)>,
}

/// Grid time `j`: the horizon split without an intermediate overflow.
pub(crate) fn grid_time(horizon: f64, j: usize) -> f64 {
    horizon * (j as f64 / (GRID - 1) as f64)
}

impl GraphSampler {
    pub(crate) fn chunks(&self) -> u64 {
        self.samples.div_ceil(CHUNK as u64)
    }

    pub(crate) fn run_chunk(&self, chunk: u64) -> GraphChunk {
        let n = (self.samples - chunk * CHUNK as u64).min(CHUNK as u64);
        let nodes = self.plan.len();
        let mut rng = chunk_rng(self.seed, chunk);
        let mut out = GraphChunk {
            n,
            sides: (0..self.sides.len())
                .map(|_| SideCounts {
                    hits: vec![0; nodes],
                    target_by: vec![0; GRID],
                    route: None,
                })
                .collect(),
            plus: 0,
            minus: 0,
            #[cfg(test)]
            indicators: Vec::new(),
        };
        let mut durations = vec![0.0; nodes];
        let mut scratch = Scratch::default();
        let mut reached = [false; 2];
        for iteration in 0..n {
            for (s, side) in self.sides.iter().enumerate() {
                let speed = self.speeds[s];
                for (slot, draw) in side.iter().enumerate() {
                    durations[slot] = match draw {
                        Draw::Fixed(t) => *t,
                        Draw::Random(d) => {
                            rng.set_word_pos(
                                (u128::from(iteration) * nodes as u128 + slot as u128) * WINDOW,
                            );
                            sample(d, &mut rng) / speed
                        }
                    };
                }
                self.plan.evaluate(&durations, &mut scratch);
                let counts = &mut out.sides[s];
                for (hit, t) in counts.hits.iter_mut().zip(&scratch.times) {
                    *hit += u64::from(*t <= self.horizon);
                }
                let t = scratch.times[self.target];
                reached[s] = t <= self.horizon;
                if reached[s] {
                    let at = (0..GRID)
                        .find(|&j| t <= grid_time(self.horizon, j))
                        .unwrap_or(GRID - 1);
                    counts.target_by[at] += 1;
                    if counts.route.is_none()
                        && let Some(witness) = self.plan.derivation(&scratch, self.target)
                    {
                        counts.route = Some(Route {
                            sample: chunk * CHUNK as u64 + iteration,
                            times: witness.nodes.iter().map(|&i| scratch.times[i]).collect(),
                            witness,
                        });
                    }
                }
            }
            if self.sides.len() == 2 {
                out.plus += u64::from(reached[0] && !reached[1]);
                out.minus += u64::from(!reached[0] && reached[1]);
                #[cfg(test)]
                out.indicators.push((reached[0], reached[1]));
            }
        }
        out
    }
}

/// All chunks' counts for one side, merged in chunk order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Merged {
    pub(crate) n: u64,
    pub(crate) hits: Vec<u64>,
    /// Cumulative: iterations whose target completed by grid point `j`.
    pub(crate) target_by: Vec<u64>,
    pub(crate) route: Option<Route>,
}

/// `chunks` in index order, all of them.
pub(crate) fn merge(chunks: &[GraphChunk], side: usize, nodes: usize) -> Merged {
    let mut merged = Merged {
        n: 0,
        hits: vec![0; nodes],
        target_by: vec![0; GRID],
        route: None,
    };
    for chunk in chunks {
        let counts = &chunk.sides[side];
        merged.n += chunk.n;
        for (total, hits) in merged.hits.iter_mut().zip(&counts.hits) {
            *total += hits;
        }
        for (total, hits) in merged.target_by.iter_mut().zip(&counts.target_by) {
            *total += hits;
        }
        if merged.route.is_none() {
            merged.route.clone_from(&counts.route);
        }
    }
    let mut running = 0;
    for count in &mut merged.target_by {
        running += *count;
        *count = running;
    }
    merged
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::graph_plan::GraphOp::*;

    fn sampler(samples: u64) -> GraphSampler {
        // Two routes to the target, one of them slowed on the second side.
        let plan =
            EventPlan::new(vec![Input, All(vec![0]), All(vec![0]), Any(vec![1, 2])]).unwrap();
        let side = |slow: f64| {
            vec![
                Draw::Fixed(0.0),
                Draw::Random(Distribution::Exponential(1.0)),
                Draw::Random(Distribution::Exponential(slow)),
                Draw::Fixed(0.0),
            ]
        };
        GraphSampler {
            plan,
            sides: vec![side(0.5), side(0.05)],
            speeds: vec![1.0, 1.0],
            target: 3,
            horizon: 1.0,
            seed: 7,
            samples,
        }
    }

    #[test]
    fn chunks_computed_in_any_order_merge_to_the_same_counts() {
        let s = sampler(3 * CHUNK as u64 + 5);
        let forward: Vec<GraphChunk> = (0..s.chunks()).map(|c| s.run_chunk(c)).collect();
        let mut backward: Vec<GraphChunk> = (0..s.chunks()).rev().map(|c| s.run_chunk(c)).collect();
        backward.reverse();
        assert_eq!(forward, backward);
        assert_eq!(merge(&forward, 0, 4), merge(&backward, 0, 4));
        assert_eq!(merge(&forward, 1, 4).n, 3 * CHUNK as u64 + 5);
    }

    #[test]
    fn paired_counts_are_the_saved_indicators() {
        let s = sampler(2 * CHUNK as u64);
        let chunks: Vec<GraphChunk> = (0..s.chunks()).map(|c| s.run_chunk(c)).collect();
        let indicators: Vec<(bool, bool)> =
            chunks.iter().flat_map(|c| c.indicators.clone()).collect();
        assert_eq!(indicators.len(), 2 * CHUNK);
        let plus = indicators.iter().filter(|(a, b)| *a && !*b).count() as u64;
        let minus = indicators.iter().filter(|(a, b)| !*a && *b).count() as u64;
        assert_eq!(chunks.iter().map(|c| c.plus).sum::<u64>(), plus);
        assert_eq!(chunks.iter().map(|c| c.minus).sum::<u64>(), minus);
        // Only the slowed route differs: a scenario never wins here.
        assert!(plus > 0);
        assert_eq!(minus, 0);
        let base = merge(&chunks, 0, 4);
        let reached = indicators.iter().filter(|(a, _)| *a).count() as u64;
        assert_eq!(base.target_by[GRID - 1], reached);
    }
}
