//! When each step of a generated graph completes in one sample: actions wait
//! for every prerequisite and then take their own time, facts take their first
//! producer, and nothing completes in a cycle that nothing entered.

use effractor_solver::graph_plan::{EventPlan, GraphOp::*};

const INF: f64 = f64::INFINITY;

#[test]
fn a_chain_accumulates_and_a_join_waits_for_the_latest() {
    let chain = EventPlan::new(vec![Input, All(vec![0]), All(vec![1])]).unwrap();
    assert_eq!(chain.times(&[0.0, 2.0, 3.0]).unwrap(), vec![0.0, 2.0, 5.0]);
    let join = EventPlan::new(vec![Input, Input, All(vec![0, 1])]).unwrap();
    assert_eq!(join.times(&[2.0, 7.0, 3.0]).unwrap()[2], 10.0);
}

#[test]
fn a_cycle_nothing_entered_never_completes() {
    let closed = EventPlan::new(vec![All(vec![1]), All(vec![0])]).unwrap();
    assert!(
        closed
            .times(&[0.0, 0.0])
            .unwrap()
            .iter()
            .all(|t| t.is_infinite())
    );
    // Zero durations and facts in the loop change nothing.
    let zero = EventPlan::new(vec![Any(vec![1]), All(vec![0]), Any(vec![1])]).unwrap();
    assert!(zero.times(&[0.0; 3]).unwrap().iter().all(|t| *t == INF));
}

#[test]
fn a_cycle_entered_from_outside_completes_from_its_entry() {
    let entered = EventPlan::new(vec![Input, Any(vec![0, 2]), All(vec![1])]).unwrap();
    assert_eq!(
        entered.times(&[0.0, 0.0, 3.0]).unwrap(),
        vec![0.0, 0.0, 3.0]
    );
    // A positive loop: entered at 1, around it once more costs 4, which the
    // fact does not wait for.
    let positive =
        EventPlan::new(vec![Input, All(vec![0]), Any(vec![1, 3]), All(vec![2])]).unwrap();
    assert_eq!(
        positive.times(&[0.0, 1.0, 0.0, 4.0]).unwrap(),
        vec![0.0, 1.0, 1.0, 5.0]
    );
}

#[test]
fn alternatives_compete_and_a_shared_action_completes_once() {
    // Two routes to one fact: 2 + 5 and 4 + 1.
    let plan = EventPlan::new(vec![
        Input,
        All(vec![0]),
        All(vec![1]),
        All(vec![0]),
        All(vec![3]),
        Any(vec![2, 4]),
    ])
    .unwrap();
    assert_eq!(plan.times(&[0.0, 2.0, 5.0, 4.0, 1.0, 0.0]).unwrap()[5], 5.0);
    // One shared action feeds two joins: both see its single completion.
    let shared = EventPlan::new(vec![
        Input,
        All(vec![0]),
        All(vec![1]),
        All(vec![1]),
        All(vec![2, 3]),
    ])
    .unwrap();
    assert_eq!(
        shared.times(&[0.0, 3.0, 1.0, 2.0, 0.0]).unwrap(),
        vec![0.0, 3.0, 4.0, 5.0, 5.0]
    );
}

#[test]
fn an_input_that_never_happens_blocks_what_needs_it() {
    let plan = EventPlan::new(vec![Input, Input, All(vec![0, 1]), Any(vec![0, 1])]).unwrap();
    assert_eq!(
        plan.times(&[1.0, INF, 1.0, 0.0]).unwrap(),
        vec![1.0, INF, INF, 1.0]
    );
}

#[test]
fn a_sum_past_the_largest_float_is_never_not_nan() {
    let plan = EventPlan::new(vec![Input, All(vec![0]), All(vec![1])]).unwrap();
    let times = plan.times(&[0.0, f64::MAX, f64::MAX]).unwrap();
    assert_eq!(times, vec![0.0, f64::MAX, INF]);
}

#[test]
fn malformed_plans_and_durations_are_refused() {
    assert!(EventPlan::new(vec![All(vec![])]).is_err());
    assert!(EventPlan::new(vec![Input, All(vec![1])]).is_ok());
    assert!(EventPlan::new(vec![Input, All(vec![2])]).is_err());
    assert!(EventPlan::new(vec![Input, All(vec![0, 0])]).is_err());
    assert!(EventPlan::new(vec![Input, Any(vec![0, 0])]).is_err());
    let chain = EventPlan::new(vec![Input, All(vec![0]), All(vec![1])]).unwrap();
    assert!(chain.times(&[0.0, f64::NAN, 1.0]).is_err());
    assert!(chain.times(&[0.0, -1.0, 1.0]).is_err());
    assert!(chain.times(&[0.0, 1.0]).is_err());
    // Infinity is a duration: never.
    assert_eq!(chain.times(&[0.0, INF, 1.0]).unwrap()[2], INF);
}

#[test]
fn a_long_chain_needs_no_recursion() {
    let n = 5_000;
    let mut ops = vec![Input];
    ops.extend((1..n).map(|i| All(vec![i - 1])));
    let plan = EventPlan::new(ops).unwrap();
    let mut durations = vec![1.0; n];
    durations[0] = 0.0;
    let times = plan.times(&durations).unwrap();
    assert_eq!(times[n - 1], (n - 1) as f64);
}

#[test]
fn ties_finalize_in_index_order_and_explain_only_by_earlier_nodes() {
    // Everything completes at zero; the fact accepts the lower-index producer
    // that finalized first, never one that completes after it.
    let plan = EventPlan::new(vec![
        Input,
        Input,
        Any(vec![3, 4]),
        All(vec![0]),
        All(vec![1]),
    ])
    .unwrap();
    let witness = plan.witness(&[0.0; 5], 2).unwrap();
    assert_eq!(witness.nodes, vec![0, 2, 3]);
    assert_eq!(witness.edges, vec![(0, 3), (3, 2)]);
}

#[test]
fn a_witness_of_a_join_holds_every_branch() {
    let plan = EventPlan::new(vec![
        Input,
        All(vec![0]),
        All(vec![0]),
        All(vec![1, 2]),
        Any(vec![3, 1]),
    ])
    .unwrap();
    let witness = plan.witness(&[0.0, 1.0, 2.0, 1.0, 0.0], 3).unwrap();
    assert_eq!(witness.nodes, vec![0, 1, 2, 3]);
    assert_eq!(witness.edges, vec![(0, 1), (0, 2), (1, 3), (2, 3)]);
    assert!(plan.witness(&[0.0, INF, 2.0, 1.0, 0.0], 3).is_none());
}
