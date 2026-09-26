//! Minimal cut sets: the smallest sets of leaves that make top hold.
//!
//! Rauzy's construction. For a monotone function f = ite(x, f1, f0), the
//! minimal solutions are those of f0, plus x joined to every minimal solution
//! of f1 that is not already a superset of one of f0's. The family is held as
//! a zero-suppressed decision diagram, which shares structure the way the BDD
//! does — the number of cut sets can be astronomically larger than the diagram.
//!
//! As in `bdd`, nothing recurses.

use std::collections::HashMap;

use crate::bdd::{Bdd, BddError, FALSE, Ref, TRUE};

/// A family of sets. `EMPTY` has no sets; `BASE` has exactly the empty set.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Fam(u32);

pub const EMPTY: Fam = Fam(0);
pub const BASE: Fam = Fam(1);

const TERMINAL: u32 = u32::MAX;

#[derive(Debug, Clone, Copy)]
struct Node {
    var: u32,
    /// Sets without `var`.
    lo: Fam,
    /// Sets with `var`, written without it.
    hi: Fam,
}

pub struct CutSets {
    nodes: Vec<Node>,
    unique: HashMap<(u32, Fam, Fam), Fam>,
    limit: usize,
    root: Fam,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Enumerated {
    /// Each set as variable indices, ascending. Smallest sets first, then in
    /// variable order — so single points of failure lead, and under
    /// truncation it is the large sets that are dropped.
    pub sets: Vec<Vec<usize>>,
    /// How many there are in all, saturating at `u128::MAX`.
    pub total: u128,
    /// `total` saturated: there are at least that many.
    pub saturated: bool,
    /// Why `sets` is shorter than `total`, if it is.
    pub truncated: Option<Truncated>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Truncated {
    MaxOrder(usize),
    MaxSets(usize),
}

enum Frame {
    Call(Fam, Fam),
    /// Both branches are on the result stack: build the node.
    Join(u32, (Fam, Fam)),
    /// Same variable on both sides: `lo` and `without(a.hi, b.hi)` are on the
    /// stack; the latter still has to lose its supersets of `b.lo`.
    Second(u32, (Fam, Fam), Fam),
    Memo((Fam, Fam)),
}

impl CutSets {
    pub fn of(bdd: &Bdd, f: Ref, node_limit: usize) -> Result<CutSets, BddError> {
        let terminal = Node {
            var: TERMINAL,
            lo: EMPTY,
            hi: EMPTY,
        };
        let mut z = CutSets {
            nodes: vec![terminal, terminal],
            unique: HashMap::new(),
            limit: node_limit.max(2),
            root: EMPTY,
        };
        let mut without_cache = HashMap::new();

        // Which BDD nodes does `f` use? Then bottom-up over just those:
        // children have lower indices, so a plain ascending loop is post-order.
        let mut used = vec![false; Bdd::index(f) + 1];
        let mut stack = vec![f];
        while let Some(g) = stack.pop() {
            if !std::mem::replace(&mut used[Bdd::index(g)], true) && g != FALSE && g != TRUE {
                let (_, lo, hi) = bdd.decision(g);
                stack.extend([lo, hi]);
            }
        }
        let mut minimal: Vec<Fam> = vec![EMPTY; used.len()];
        if used.len() > 1 {
            minimal[1] = BASE;
        }
        for i in 2..used.len() {
            if !used[i] {
                continue;
            }
            // `Ref` has no public constructor; every index here is one `f` reaches.
            let (var, lo, hi) = bdd.decision(bdd.ref_at(i, f));
            let k0 = minimal[Bdd::index(lo)];
            let k1 = z.without(minimal[Bdd::index(hi)], k0, &mut without_cache)?;
            minimal[i] = z.make(var, k0, k1)?;
        }
        z.root = minimal[Bdd::index(f)];
        Ok(z)
    }

    fn make(&mut self, var: u32, lo: Fam, hi: Fam) -> Result<Fam, BddError> {
        if hi == EMPTY {
            return Ok(lo); // zero-suppression
        }
        if let Some(f) = self.unique.get(&(var, lo, hi)) {
            return Ok(*f);
        }
        if self.nodes.len() >= self.limit {
            return Err(BddError::NodeLimit(self.limit));
        }
        let f = Fam(self.nodes.len() as u32);
        self.nodes.push(Node { var, lo, hi });
        self.unique.insert((var, lo, hi), f);
        Ok(f)
    }

    /// `a`, minus every set that is a superset of (or equal to) a set in `b`.
    fn without(
        &mut self,
        a: Fam,
        b: Fam,
        cache: &mut HashMap<(Fam, Fam), Fam>,
    ) -> Result<Fam, BddError> {
        let mut work = vec![Frame::Call(a, b)];
        let mut done: Vec<Fam> = Vec::new();
        while let Some(frame) = work.pop() {
            match frame {
                Frame::Call(a, b) => {
                    let known = if a == EMPTY || b == BASE || a == b {
                        Some(EMPTY) // every set is a superset of the empty set
                    } else if b == EMPTY {
                        Some(a)
                    } else {
                        cache.get(&(a, b)).copied()
                    };
                    if let Some(f) = known {
                        done.push(f);
                        continue;
                    }
                    let (na, nb) = (self.nodes[a.0 as usize], self.nodes[b.0 as usize]);
                    if na.var < nb.var {
                        // No set of `b` mentions this variable: both halves of `a` face all of `b`.
                        work.push(Frame::Join(na.var, (a, b)));
                        work.push(Frame::Call(na.hi, b));
                        work.push(Frame::Call(na.lo, b));
                    } else if na.var > nb.var {
                        // No set of `a` contains b's variable, so only b's sets without it can be subsets.
                        work.push(Frame::Memo((a, b)));
                        work.push(Frame::Call(a, nb.lo));
                    } else {
                        work.push(Frame::Second(na.var, (a, b), nb.lo));
                        work.push(Frame::Call(na.hi, nb.hi));
                        work.push(Frame::Call(na.lo, nb.lo));
                    }
                }
                Frame::Second(var, key, b_lo) => {
                    let partial = done.pop().expect("hi branch");
                    work.push(Frame::Join(var, key));
                    work.push(Frame::Call(partial, b_lo));
                }
                Frame::Join(var, key) => {
                    let hi = done.pop().expect("hi branch");
                    let lo = done.pop().expect("lo branch");
                    let f = self.make(var, lo, hi)?;
                    cache.insert(key, f);
                    done.push(f);
                }
                Frame::Memo(key) => {
                    cache.insert(key, *done.last().expect("result"));
                }
            }
        }
        Ok(done.pop().expect("one result"))
    }

    pub fn size(&self) -> usize {
        self.nodes.len()
    }

    /// Per node: how many sets, and the smallest and largest set size.
    fn measure(&self) -> Vec<(u128, usize, usize)> {
        let mut m = vec![(0u128, usize::MAX, 0usize); self.nodes.len()];
        m[1] = (1, 0, 0);
        for i in 2..self.nodes.len() {
            let n = self.nodes[i];
            let (lo, hi) = (m[n.lo.0 as usize], m[n.hi.0 as usize]);
            m[i] = (
                lo.0.saturating_add(hi.0),
                lo.1.min(hi.1.saturating_add(1)),
                lo.2.max(hi.2 + 1),
            );
        }
        m
    }

    pub fn total(&self) -> u128 {
        self.measure()[self.root.0 as usize].0
    }

    /// List the sets, smallest first, until a limit says stop.
    pub fn enumerate(&self, max_order: Option<usize>, max_sets: usize) -> Enumerated {
        let m = self.measure();
        let (total, smallest, largest) = m[self.root.0 as usize];
        let mut out = Enumerated {
            sets: vec![],
            total,
            saturated: total == u128::MAX,
            truncated: None,
        };
        if total == 0 {
            return out;
        }
        let last_order = max_order.map_or(largest, |cap| cap.min(largest));
        'orders: for order in smallest..=last_order {
            // Every set of exactly this size: depth-first, leaving any branch
            // that can no longer reach the size or has already passed it.
            let mut path: Vec<usize> = Vec::new();
            let mut stack: Vec<(Fam, usize, bool)> = vec![(self.root, 0, false)];
            while let Some((f, depth, entered)) = stack.pop() {
                path.truncate(depth);
                if entered {
                    path.push(self.nodes[f.0 as usize].var as usize);
                    let hi = self.nodes[f.0 as usize].hi;
                    stack.push((hi, depth + 1, false));
                    continue;
                }
                let (_, min, max) = m[f.0 as usize];
                if f == EMPTY || depth + min > order || depth + max < order {
                    continue;
                }
                if f == BASE {
                    if out.sets.len() == max_sets {
                        out.truncated = Some(Truncated::MaxSets(max_sets));
                        break 'orders;
                    }
                    out.sets.push(path.clone());
                    continue;
                }
                // hi first: sets with this variable come before sets without
                // it, so the walk meets them in the order they are listed,
                // and a truncated list is the start of the whole one.
                stack.push((self.nodes[f.0 as usize].lo, depth, false));
                stack.push((f, depth, true));
            }
        }
        if out.truncated.is_none() && (out.sets.len() as u128) < total {
            out.truncated = max_order.map(Truncated::MaxOrder);
        }
        out.sets
            .sort_by(|a, b| a.len().cmp(&b.len()).then_with(|| a.cmp(b)));
        out
    }

    /// The event "some cut set holds", as a function in `bdd` — for the whole
    /// family and, per variable, for just the sets that contain it. The second
    /// is what Fussell–Vesely is defined on.
    pub(crate) fn as_functions(
        &self,
        bdd: &mut Bdd,
        n_vars: usize,
    ) -> Result<(Ref, Vec<Ref>), BddError> {
        let mut vars = Vec::with_capacity(n_vars);
        for v in 0..n_vars {
            vars.push(bdd.variable(v)?);
        }
        // whole[i]: some set of family i holds.
        let mut whole = vec![FALSE; self.nodes.len()];
        whole[1] = TRUE;
        for i in 2..self.nodes.len() {
            let n = self.nodes[i];
            let with = bdd.ite(whole[n.hi.0 as usize], TRUE, whole[n.lo.0 as usize])?;
            whole[i] = bdd.ite(vars[n.var as usize], with, whole[n.lo.0 as usize])?;
        }
        let mut containing = Vec::with_capacity(n_vars);
        for v in 0..n_vars as u32 {
            // only[i]: some set of family i that contains v holds.
            let mut only = vec![FALSE; self.nodes.len()];
            for i in 2..=self.root.0 as usize {
                let n = self.nodes[i];
                only[i] = if n.var == v {
                    bdd.ite(vars[v as usize], whole[n.hi.0 as usize], FALSE)?
                } else if n.var < v {
                    let with = bdd.ite(only[n.hi.0 as usize], TRUE, only[n.lo.0 as usize])?;
                    bdd.ite(vars[n.var as usize], with, only[n.lo.0 as usize])?
                } else {
                    FALSE // v would have been decided above here
                };
            }
            containing.push(only[self.root.0 as usize]);
        }
        Ok((whole[self.root.0 as usize], containing))
    }
}
