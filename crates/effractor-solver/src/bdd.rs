//! Reduced ordered binary decision diagrams over a model's leaves.
//!
//! The structure function of the model — "does top hold, given which leaves
//! do?" — compiled once into a canonical DAG. Exact probability is then one
//! pass over it, and it is exact where a tree evaluation is not: a leaf shared
//! by two branches is one variable here, not two.
//!
//! Nothing in this file recurses. A model is user input; its depth, and the
//! depth of the diagram it compiles to, must not be able to overflow a stack.

use std::collections::HashMap;

use effractor_core::{Gate, Model, NodeId, NodeKind};

/// A function in the diagram. `FALSE` and `TRUE` are the terminals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Ref(u32);

pub const FALSE: Ref = Ref(0);
pub const TRUE: Ref = Ref(1);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BddError {
    /// The diagram outgrew the configured limit; sampling still works.
    NodeLimit(usize),
    /// A cycle or a dangling reference. `core::validate` reports these
    /// properly; this only guarantees that compiling never loops on one.
    InvalidModel,
}

#[derive(Debug, Clone, Copy)]
struct Decision {
    var: u32,
    lo: Ref,
    hi: Ref,
}

#[derive(Debug)]
pub struct Bdd {
    /// Index 0 and 1 are the terminals. Children always sit at a lower index
    /// than their parent, which is what makes bottom-up passes a plain loop.
    nodes: Vec<Decision>,
    vars: Vec<NodeId>,
    functions: HashMap<NodeId, Ref>,
    root: Ref,
}

const TERMINAL: u32 = u32::MAX;

struct Builder {
    nodes: Vec<Decision>,
    unique: HashMap<(u32, Ref, Ref), Ref>,
    ite_cache: HashMap<(Ref, Ref, Ref), Ref>,
    limit: usize,
}

enum Frame {
    Call(Ref, Ref, Ref),
    Build(u32, (Ref, Ref, Ref)),
}

impl Builder {
    fn var(&self, f: Ref) -> u32 {
        self.nodes[f.0 as usize].var
    }

    fn make(&mut self, var: u32, lo: Ref, hi: Ref) -> Result<Ref, BddError> {
        if lo == hi {
            return Ok(lo);
        }
        if let Some(r) = self.unique.get(&(var, lo, hi)) {
            return Ok(*r);
        }
        if self.nodes.len() >= self.limit {
            return Err(BddError::NodeLimit(self.limit));
        }
        let r = Ref(self.nodes.len() as u32);
        self.nodes.push(Decision { var, lo, hi });
        self.unique.insert((var, lo, hi), r);
        Ok(r)
    }

    fn cofactors(&self, f: Ref, var: u32) -> (Ref, Ref) {
        let n = self.nodes[f.0 as usize];
        if n.var == var { (n.lo, n.hi) } else { (f, f) }
    }

    /// if-then-else, the one operation everything else is: `and(f, g)` is
    /// `ite(f, g, FALSE)`, `or(f, g)` is `ite(f, TRUE, g)`.
    fn ite(&mut self, f: Ref, g: Ref, h: Ref) -> Result<Ref, BddError> {
        let mut work = vec![Frame::Call(f, g, h)];
        let mut done: Vec<Ref> = Vec::new();
        while let Some(frame) = work.pop() {
            match frame {
                Frame::Call(f, g, h) => {
                    let known = if f == TRUE || g == h {
                        Some(g)
                    } else if f == FALSE {
                        Some(h)
                    } else if g == TRUE && h == FALSE {
                        Some(f)
                    } else {
                        self.ite_cache.get(&(f, g, h)).copied()
                    };
                    if let Some(r) = known {
                        done.push(r);
                        continue;
                    }
                    let var = self.var(f).min(self.var(g)).min(self.var(h));
                    let ((f0, f1), (g0, g1), (h0, h1)) = (
                        self.cofactors(f, var),
                        self.cofactors(g, var),
                        self.cofactors(h, var),
                    );
                    work.push(Frame::Build(var, (f, g, h)));
                    work.push(Frame::Call(f1, g1, h1));
                    work.push(Frame::Call(f0, g0, h0));
                }
                Frame::Build(var, key) => {
                    let hi = done.pop().expect("hi branch");
                    let lo = done.pop().expect("lo branch");
                    let r = self.make(var, lo, hi)?;
                    self.ite_cache.insert(key, r);
                    done.push(r);
                }
            }
        }
        Ok(done.pop().expect("one result"))
    }

    fn gate(&mut self, gate: Gate, inputs: &[Ref]) -> Result<Ref, BddError> {
        match gate {
            Gate::And => inputs
                .iter()
                .try_fold(TRUE, |acc, f| self.ite(acc, *f, FALSE)),
            Gate::Or => inputs
                .iter()
                .try_fold(FALSE, |acc, f| self.ite(acc, TRUE, *f)),
            Gate::Vote { k } => {
                // need[j] = "at least j of the inputs seen so far hold".
                // Taking inputs from the back: need'[j] = ite(x, need[j-1], need[j]).
                let mut need = vec![FALSE; k + 1];
                need[0] = TRUE;
                for x in inputs.iter().rev() {
                    for j in (1..=k).rev() {
                        need[j] = self.ite(*x, need[j - 1], need[j])?;
                    }
                }
                Ok(need[k])
            }
        }
    }
}

impl Bdd {
    /// Compile everything reachable from `model.top`. Variables are the leaves,
    /// ordered by a depth-first walk from top with children in document order —
    /// deterministic, and it keeps leaves that are near each other in the model
    /// near each other in the diagram.
    pub fn compile(model: &Model, node_limit: usize) -> Result<Bdd, BddError> {
        let terminal = |lo| Decision {
            var: TERMINAL,
            lo,
            hi: lo,
        };
        let mut b = Builder {
            nodes: vec![terminal(FALSE), terminal(TRUE)],
            unique: HashMap::new(),
            ite_cache: HashMap::new(),
            limit: node_limit.max(2),
        };
        let mut vars: Vec<NodeId> = Vec::new();
        let mut functions: HashMap<NodeId, Ref> = HashMap::new();
        let mut on_path: HashMap<&NodeId, ()> = HashMap::new();

        let (top, _) = model
            .nodes
            .get_key_value(&model.top)
            .ok_or(BddError::InvalidModel)?;
        let mut path: Vec<(&NodeId, usize)> = vec![(top, 0)];
        on_path.insert(top, ());
        while let Some((id, next)) = path.last_mut() {
            let id = *id;
            let children: &[NodeId] = match &model.nodes[id].kind {
                NodeKind::Gate { children, .. } => children,
                NodeKind::Leaf(_) => &[],
            };
            if let Some(child) = children.get(*next) {
                *next += 1;
                let (child, _) = model
                    .nodes
                    .get_key_value(child)
                    .ok_or(BddError::InvalidModel)?;
                if functions.contains_key(child) {
                    continue;
                }
                if on_path.insert(child, ()).is_some() {
                    return Err(BddError::InvalidModel);
                }
                path.push((child, 0));
                continue;
            }
            let f = match &model.nodes[id].kind {
                NodeKind::Leaf(_) => {
                    vars.push(id.clone());
                    b.make(vars.len() as u32 - 1, FALSE, TRUE)?
                }
                NodeKind::Gate { gate, children } => {
                    let inputs: Vec<Ref> = children.iter().map(|c| functions[c]).collect();
                    b.gate(*gate, &inputs)?
                }
            };
            functions.insert(id.clone(), f);
            on_path.remove(id);
            path.pop();
        }

        let root = functions[top];
        Ok(Bdd {
            nodes: b.nodes,
            vars,
            functions,
            root,
        })
    }

    /// The leaves, in variable order. `prob` takes probabilities in this order.
    pub fn vars(&self) -> &[NodeId] {
        &self.vars
    }

    pub fn root(&self) -> Ref {
        self.root
    }

    /// The function of any model node reachable from top — gates included,
    /// which is what lets a consequence hang off an intermediate event.
    pub fn node(&self, id: &NodeId) -> Option<Ref> {
        self.functions.get(id).copied()
    }

    pub fn size(&self) -> usize {
        self.nodes.len()
    }

    /// P(f), given independent leaf probabilities in `vars()` order: Shannon
    /// expansion, bottom-up. Exact up to floating point, however leaves are shared.
    pub fn prob(&self, f: Ref, leaf_p: &[f64]) -> f64 {
        assert_eq!(
            leaf_p.len(),
            self.vars.len(),
            "one probability per variable"
        );
        let upto = f.0 as usize;
        let mut value = vec![0.0; upto + 1];
        if upto >= 1 {
            value[1] = 1.0;
        }
        for i in 2..=upto {
            let n = self.nodes[i];
            let p = leaf_p[n.var as usize];
            value[i] = (1.0 - p) * value[n.lo.0 as usize] + p * value[n.hi.0 as usize];
        }
        value[upto]
    }
}
