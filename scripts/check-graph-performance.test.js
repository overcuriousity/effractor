const { test } = require('node:test');
const assert = require('node:assert/strict');
const { measure, withinBudget, summary } = require('./check-graph-performance.js');

const graph = { library: { id: 'core-components', version: 1 }, semantics: 'sequential-1', nodes: [{ id: 'a', inputs: [] }, { id: 'b', inputs: ['a'] }, { id: 'c', inputs: ['a', 'b'] }] };
function api(over) {
  let steps = 0;
  return Object.assign({
    generate: () => JSON.stringify({ ok: { graph } }),
    solve_graph_begin: () => JSON.stringify({ ok: { progress: { done: 0, total: 3 } } }),
    solve_step: () => JSON.stringify({ ok: { done: ++steps, total: 3 } }),
    solve_finish: () => { assert.equal(steps, 3); return JSON.stringify({ ok: { result: { samples: 10000, baseline: {}, scenario: null } } }); },
  }, over);
}

test('generation and the solve are timed apart, the solve through its last chunk and its answer', () => {
  const clock = [100, 104, 129];
  assert.deepEqual(measure(api(), 'yaml', '', () => clock.shift()), { scenario: null, generate_ms: 4, solve_ms: 25, nodes: 3, edges: 3, samples: 10000, library: 'core-components 1', semantics: 'sequential-1' });
});

test('a scenario is asked for by name and named in its measurement', () => {
  let asked;
  const a = api({
    solve_graph_begin: (text, scenario) => { asked = scenario; return JSON.stringify({ ok: { progress: { done: 0, total: 3 } } }); },
  });
  assert.equal(measure(a, 'yaml', 'patch', () => 0).scenario, 'patch');
  assert.equal(asked, 'patch');
});

test('the budget is one second for generation and solve together, on ten thousand samples', () => {
  assert.equal(withinBudget({ generate_ms: 99, solve_ms: 900, samples: 10000 }), true);
  assert.equal(withinBudget({ generate_ms: 100, solve_ms: 900, samples: 10000 }), false);
  assert.equal(withinBudget({ generate_ms: 1, solve_ms: 2, samples: 4096 }), false);
});

test('what cannot be generated or sampled is an error, not a measurement', () => {
  assert.throws(() => measure(api({ generate: () => JSON.stringify({ diagnostics: [{ message: 'no target' }] }) }), '', '', () => 0), /no target/);
  assert.throws(() => measure(api({ solve_graph_begin: () => JSON.stringify({ diagnostics: [{ message: 'no scenario nope' }] }) }), '', 'nope', () => 0), /no scenario nope/);
  assert.throws(() => measure(api({ solve_step: () => JSON.stringify({ ok: { done: 0, total: 3 } }) }), '', '', () => 0), /progress/);
});

test('the first run is reported as cold and the rest as a range', () => {
  const run = ms => ({ scenario: null, generate_ms: ms, solve_ms: ms * 10, nodes: 3, edges: 3, samples: 10000 });
  assert.deepEqual(summary([run(5), run(2), run(1), run(3), run(2), run(2)]), {
    cold: { generate_ms: 5, solve_ms: 50 },
    warm: { runs: 5, generate_ms: [1, 3], solve_ms: [10, 30] },
  });
});

test('a run outside the budget says why', () => {
  const { reason } = require('./check-graph-performance.js');
  assert.equal(reason({ generate_ms: 1, solve_ms: 2, samples: 10000 }), null);
  assert.equal(reason({ generate_ms: 1, solve_ms: 2, samples: 4096 }), '4096 samples, the budget is for 10000');
  assert.equal(reason({ generate_ms: 400, solve_ms: 700.5, samples: 10000 }), '1100.5 ms, the budget is 1000');
});
