//! Monte Carlo over a generated graph, for the baseline and at most one
//! scenario at once, on the same draws.
//!
//! Every node owns a random window per iteration, addressed by its index in
//! the whole sorted graph — its slot — whether or not it is sampled, so
//! neither a target nor a scenario renumbers another step's draws. Two sides
//! that give a step the same distribution therefore give it the same time in
//! every iteration, and their difference is the defence rather than noise.
//! A chunk keeps counters and, per side, how often each route was taken —
//! a route being the set of steps in a successful sample's derivation, kept
//! whole as the key of its count and first sample (a hash of it would count
//! two routes that collide as one) — never a samples × nodes table; chunks
//! merge in index order. A route's steps and
//! times are had again by replaying its first sample: draws are addressed
//! by sample, so one sample recomputes exactly.

use std::collections::BTreeMap;

use effractor_core::Distribution;
use rand_chacha::ChaCha8Rng;

use crate::dist::{CHUNK, STEP_WORK, chunk_rng, sample};
use crate::graph_plan::{EventPlan, Scratch, Witness};
use crate::mc::{GRID, grid_time};

/// 256 words is 128 uniforms, as for trees.
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

/// How often one route was taken, and the first sample that took it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Tally {
    pub(crate) count: u64,
    pub(crate) first: u64,
}

/// A route: its steps' indices, ascending.
pub(crate) type RouteKey = Vec<usize>;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct SideCounts {
    /// Per node: iterations in which it completed within the horizon.
    pub(crate) hits: Vec<u64>,
    /// Per grid point: iterations whose target completed at or before it and
    /// after the one before.
    pub(crate) target_by: Vec<u64>,
    /// Per route taken to the target within the horizon: how often, and
    /// first when.
    pub(crate) routes: BTreeMap<RouteKey, Tally>,
}

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct GraphChunk {
    index: u64,
    pub(crate) n: u64,
    /// Iterations computed so far; the chunk is complete at `n`.
    pub(crate) done: u64,
    pub(crate) sides: Vec<SideCounts>,
    /// Iterations in which the baseline reached the target and the scenario
    /// did not, and the reverse.
    pub(crate) plus: u64,
    pub(crate) minus: u64,
    #[cfg(test)]
    pub(crate) indicators: Vec<(bool, bool)>,
}

impl GraphSampler {
    pub(crate) fn chunks(&self) -> u64 {
        self.samples.div_ceil(CHUNK as u64)
    }

    /// Iterations of one step that do about [`STEP_WORK`] node evaluations.
    pub(crate) fn step_iterations(&self) -> u64 {
        (STEP_WORK / (self.plan.len() * self.sides.len()).max(1) as u64).max(1)
    }

    /// Chunk `chunk`, with nothing computed yet: see [`GraphSampler::advance`].
    pub(crate) fn start_chunk(&self, chunk: u64) -> GraphChunk {
        let nodes = self.plan.len();
        GraphChunk {
            index: chunk,
            n: (self.samples - chunk * CHUNK as u64).min(CHUNK as u64),
            done: 0,
            sides: (0..self.sides.len())
                .map(|_| SideCounts {
                    hits: vec![0; nodes],
                    target_by: vec![0; GRID],
                    routes: BTreeMap::new(),
                })
                .collect(),
            plus: 0,
            minus: 0,
            #[cfg(test)]
            indicators: Vec::new(),
        }
    }

    #[cfg(test)]
    pub(crate) fn run_chunk(&self, chunk: u64) -> GraphChunk {
        let mut out = self.start_chunk(chunk);
        self.advance(&mut out, u64::MAX);
        out
    }

    /// Up to `budget` more iterations of `out`; returns how many. Draws are
    /// addressed by iteration, so a chunk computed in pieces is the same chunk.
    pub(crate) fn advance(&self, out: &mut GraphChunk, budget: u64) -> u64 {
        let (from, to) = (out.done, out.n.min(out.done.saturating_add(budget)));
        let (chunk, nodes) = (out.index, self.plan.len());
        let mut rng = chunk_rng(self.seed, chunk);
        let mut durations = vec![0.0; nodes];
        let mut scratch = Scratch::default();
        let mut reached = [false; 2];
        for iteration in from..to {
            for (s, reach) in reached.iter_mut().enumerate().take(self.sides.len()) {
                self.fill(&mut rng, iteration, s, &mut durations);
                self.plan.evaluate(&durations, &mut scratch);
                let counts = &mut out.sides[s];
                for (hit, t) in counts.hits.iter_mut().zip(&scratch.times) {
                    *hit += u64::from(*t <= self.horizon);
                }
                let t = scratch.times[self.target];
                *reach = t <= self.horizon;
                if *reach {
                    let at = (0..GRID)
                        .find(|&j| t <= grid_time(self.horizon, j))
                        .unwrap_or(GRID - 1);
                    counts.target_by[at] += 1;
                    if let Some(witness) = self.plan.derivation(&scratch, self.target) {
                        // Iterations ascend, so the first seen is the first.
                        let tally = counts.routes.entry(witness.nodes).or_insert(Tally {
                            count: 0,
                            first: chunk * CHUNK as u64 + iteration,
                        });
                        tally.count += 1;
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
        out.done = to;
        to - from
    }

    /// One side's durations for `iteration` of the chunk `rng` is for.
    fn fill(&self, rng: &mut ChaCha8Rng, iteration: u64, s: usize, durations: &mut [f64]) {
        let nodes = self.plan.len();
        let speed = self.speeds[s];
        for (slot, draw) in self.sides[s].iter().enumerate() {
            durations[slot] = match draw {
                Draw::Fixed(t) => *t,
                Draw::Random(d) => {
                    rng.set_word_pos(
                        (u128::from(iteration) * nodes as u128 + slot as u128) * WINDOW,
                    );
                    sample(d, rng) / speed
                }
            };
        }
    }

    /// Global sample `n` of side `s`, evaluated again: its derivation of the
    /// target and when each of its steps completed. `None` when that sample
    /// did not reach the target.
    pub(crate) fn replay(&self, s: usize, n: u64) -> Option<Route> {
        let (chunk, iteration) = (n / CHUNK as u64, n % CHUNK as u64);
        let mut rng = chunk_rng(self.seed, chunk);
        let mut durations = vec![0.0; self.plan.len()];
        let mut scratch = Scratch::default();
        self.fill(&mut rng, iteration, s, &mut durations);
        self.plan.evaluate(&durations, &mut scratch);
        let witness = self.plan.derivation(&scratch, self.target)?;
        Some(Route {
            sample: n,
            times: witness.nodes.iter().map(|&i| scratch.times[i]).collect(),
            witness,
        })
    }
}

/// All chunks' counts for one side, merged in chunk order.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Merged {
    pub(crate) n: u64,
    pub(crate) hits: Vec<u64>,
    /// Cumulative: iterations whose target completed by grid point `j`.
    pub(crate) target_by: Vec<u64>,
    /// Every route taken, by key: most taken first; ties by the earlier
    /// first sample.
    pub(crate) routes: Vec<(RouteKey, Tally)>,
}

/// `chunks` in index order, all of them.
pub(crate) fn merge(chunks: &[GraphChunk], side: usize, nodes: usize) -> Merged {
    let mut merged = Merged {
        n: 0,
        hits: vec![0; nodes],
        target_by: vec![0; GRID],
        routes: Vec::new(),
    };
    let mut routes: BTreeMap<RouteKey, Tally> = BTreeMap::new();
    for chunk in chunks {
        let counts = &chunk.sides[side];
        merged.n += chunk.n;
        for (total, hits) in merged.hits.iter_mut().zip(&counts.hits) {
            *total += hits;
        }
        for (total, hits) in merged.target_by.iter_mut().zip(&counts.target_by) {
            *total += hits;
        }
        for (key, tally) in &counts.routes {
            match routes.get_mut(key) {
                Some(into) => {
                    into.count += tally.count;
                    into.first = into.first.min(tally.first);
                }
                None => {
                    routes.insert(key.clone(), *tally);
                }
            }
        }
    }
    merged.routes = routes.into_iter().collect();
    merged
        .routes
        .sort_by(|(_, a), (_, b)| b.count.cmp(&a.count).then(a.first.cmp(&b.first)));
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
    fn every_success_is_counted_under_its_route_and_a_route_replays_exactly() {
        let s = sampler(2 * CHUNK as u64 + 17);
        let chunks: Vec<GraphChunk> = (0..s.chunks()).map(|c| s.run_chunk(c)).collect();
        for side in 0..2 {
            let m = merge(&chunks, side, 4);
            let counted: u64 = m.routes.iter().map(|(_, t)| t.count).sum();
            assert_eq!(counted, m.target_by[GRID - 1], "one route per success");
            // Through node 1 or through node 2: two routes, most taken first.
            assert_eq!(m.routes.len(), 2);
            assert!(m.routes[0].1.count >= m.routes[1].1.count);
            for (key, tally) in &m.routes {
                let route = s
                    .replay(side, tally.first)
                    .expect("its first sample reached the target");
                assert_eq!(&route.witness.nodes, key);
                assert_eq!(route.sample, tally.first);
                let target = route.witness.nodes.binary_search(&3).unwrap();
                assert!(route.times[target] <= s.horizon);
            }
        }
        // The slowed side takes the slowed route less.
        let share = |side: usize, node: usize| {
            let m = merge(&chunks, side, 4);
            m.routes
                .iter()
                .filter(|(_, t)| {
                    s.replay(side, t.first)
                        .unwrap()
                        .witness
                        .nodes
                        .contains(&node)
                })
                .map(|(_, t)| t.count)
                .sum::<u64>()
        };
        assert!(share(1, 2) < share(0, 2));
    }

    /// A route is counted under itself: two routes are one only if they
    /// are the same steps, never because a hash of them agrees.
    #[test]
    fn a_route_is_its_own_key() {
        let s = sampler(CHUNK as u64);
        let chunk = s.run_chunk(0);
        for (key, tally) in &chunk.sides[0].routes {
            let route = s.replay(0, tally.first).unwrap();
            assert_eq!(&route.witness.nodes, key);
        }
    }

    #[test]
    fn a_chunk_computed_in_pieces_is_the_same_chunk() {
        let s = sampler(CHUNK as u64 + 5);
        for chunk in 0..2 {
            let mut pieces = s.start_chunk(chunk);
            while pieces.done < pieces.n {
                assert!(s.advance(&mut pieces, 1000) <= 1000);
            }
            assert_eq!(pieces, s.run_chunk(chunk));
        }
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
