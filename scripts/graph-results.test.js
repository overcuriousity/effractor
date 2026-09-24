const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../assets/js/graph-results.js');
const P = require('../assets/js/profiles.js');
const { graph } = require('./fixtures/graph/lecture-graph.json');
const doc = require('./fixtures/graph/lecture-doc.json');
const available = require('./fixtures/graph/results-available.json');
const unreachable = require('./fixtures/graph/results-unreachable.json');
const seeded = require('./fixtures/graph/results-seeded.json');
const unknown = require('./fixtures/graph/results-unknown.json');
const scenarioUnknown = require('./fixtures/graph/results-scenario-unknown.json');

test('an available target CDF is the solver rows as they are, time · probability · lower · upper', () => {
  const c = R.cdf(available.baseline.outcome);
  assert.equal(c.rows, available.baseline.outcome.available.ttc_cdf);
  assert.equal(c.rows.length, 65);
  assert.deepEqual(c.rows[0].length, 4);
  assert.equal(c.reason, null);
  assert.equal(c.confidence, 0.95);
  assert.equal(c.method, 'sampled');
  assert.deepEqual(R.COLUMNS, ['time', 'probability', 'lower', 'upper']);
  assert.equal(R.TITLE, 'Target compromise probability');
});

test('the headline is P(target) by the horizon with its interval, and says the inputs are illustrative', () => {
  const h = R.headline(available);
  assert.equal(h.label, 'P(target)');
  assert.equal(h.p, 1);
  assert.deepEqual(h.ci, { lo: available.baseline.outcome.available.ci.lo, hi: 1 });
  assert.equal(h.by, '100 d');
  assert.match(h.qualifier, /illustrative/);
  assert.equal(R.illustrative(available.baseline), true);
});

test('an unreachable target is a structural zero, not insufficient knowledge', () => {
  const h = R.headline(unreachable);
  assert.equal(h.p, 0);
  assert.equal(h.ci, null);
  assert.match(h.qualifier, /unreachable/);
  const c = R.cdf(unreachable.baseline.outcome);
  assert.equal(c.method, 'structural');
  assert.ok(c.rows.every(r => r[1] === 0));
  // Never completed: the times it would take are not reached, not quantiles
  // of the attacks that succeeded.
  assert.equal(R.reachedBy(c.rows, 0.5), null);
  assert.equal(R.timeTo(unreachable, 0.5), 'not reached by 100 d');
});

test('a seeded target is certain at once and needs nothing else', () => {
  const h = R.headline(seeded);
  assert.equal(h.p, 1);
  assert.match(h.qualifier, /at once/);
  assert.equal(R.reachedBy(R.cdf(seeded.baseline.outcome).rows, 0.5), 0);
  assert.deepEqual(seeded.baseline.assumptions, []);
});

test('a target resting on an unknown input has no number and says which', () => {
  const h = R.headline(unknown);
  assert.equal(h.p, null);
  assert.match(h.qualifier, /unknown/);
  assert.deepEqual(h.missing, ['entities.openssh.parameters.find-exploit']);
  const c = R.cdf(unknown.baseline.outcome);
  assert.deepEqual(c.rows, []);
  assert.equal(c.reason, 'rests on unknown inputs');
  assert.deepEqual(c.missing, ['entities.openssh.parameters.find-exploit']);
  assert.equal(R.timeTo(unknown, 0.5), null);
  // A step on that route has no number either; one off it keeps its own.
  assert.deepEqual(R.nodeFacts(unknown, 'action/product-find-exploit/openssh'), [
    ['State', 'possible'],
    ['P(step)', 'unknown'],
    ['Unknown inputs', 'entities.openssh.parameters.find-exploit'],
  ]);
  const extract = R.nodeFacts(unknown, 'action/credential-extract/workstation/server-key');
  assert.equal(extract[1][0], 'P(step)');
  assert.equal(extract[1][1], R.number(1));
});

test('a known baseline beside an unknown scenario keeps the baseline and says why the other has none', () => {
  assert.equal(R.headline(scenarioUnknown).p, 1);
  const other = R.headline(scenarioUnknown, 'scenario');
  assert.equal(other.p, null);
  assert.deepEqual(other.missing, ['scenarios.doubt.changes[0]']);
  assert.equal(R.cdf(scenarioUnknown.scenario.outcome).rows.length, 0);
});

test('step facts: the state, the probability by the horizon and its interval', () => {
  assert.deepEqual(R.nodeFacts(available, 'action/service-login/server-account/sshd'), [
    ['State', 'possible'],
    ['P(step)', R.number(available.baseline.nodes.find(n => n.id === 'action/service-login/server-account/sshd').outcome.available.p)],
    ['95% CI', R.band(available.baseline.nodes.find(n => n.id === 'action/service-login/server-account/sshd').outcome.available.ci)],
  ]);
  assert.deepEqual(R.nodeFacts(available, 'state/network/admin-net/access'), [['State', 'unreachable'], ['P(step)', '0']]);
  assert.deepEqual(R.nodeFacts(available, 'state/nothing'), []);
  assert.deepEqual(R.nodeFacts(null, 'state/host/server/admin'), []);
});

test('assumptions are listed with their evidence status, expression and note', () => {
  const rows = R.assumptions(available.baseline);
  assert.deepEqual(rows.map(a => a.status), ['policy', 'illustrative', 'defense', 'illustrative', 'illustrative', 'illustrative', 'illustrative']);
  // A switch that opens a way at once is something the result rests on too.
  const mfa = rows.find(a => a.path === 'entities.server-account.defenses.mfa');
  assert.equal(mfa.expression, 'off');
  assert.equal(rows[0].path, 'associations.allow-ssh.allowed');
  assert.equal(rows[0].expression, 'allowed');
  const extract = rows.find(a => a.path === 'entities.server-key.parameters.extract');
  assert.ok(extract.paths.includes('entities.server-key.defenses.protected'));
});

test('the sample route is one real sample, whole: every prerequisite of every action on it', () => {
  const w = R.witness(available.baseline, graph);
  assert.equal(w.title, 'Simulated path');
  assert.equal(w.sample, available.baseline.witness.sample);
  assert.equal(w.time, available.baseline.witness.target_time);
  const byId = Object.fromEntries(graph.nodes.map(n => [n.id, n]));
  const on = new Set(w.steps.map(s => s.id));
  w.steps.forEach(s => {
    assert.equal(s.label, byId[s.id].label);
    if (byId[s.id].kind === 'all') {
      assert.deepEqual(s.inputs.slice().sort(), byId[s.id].inputs.slice().sort(), s.id + ' has all its prerequisites');
      s.inputs.forEach(i => assert.ok(on.has(i)));
    }
  });
  // In the order they completed, never ranked.
  for (let i = 1; i < w.steps.length; i++) assert.ok(w.steps[i - 1].time <= w.steps[i].time);
  assert.ok(!('rank' in w) && !('likely' in w));
  assert.equal(R.witness(unreachable.baseline, graph), null);
});

test('a generated graph has no exact, cut-set, Pareto, loss or control analysis', () => {
  const none = ['exact', 'cut_sets', 'attacker', 'sampled', 'controls'];
  none.forEach(key => assert.ok(!(key in available), key));
  const c = P.capabilities(doc);
  ['exact', 'cutSets', 'pareto', 'loss', 'controls'].forEach(k => assert.equal(c[k], false, k));
  assert.deepEqual(R.analyses(available), { probability: true, ttc: true, route: true, exact: false, cutSets: false, pareto: false, loss: false, controls: false });
  assert.equal(R.isGraphResults(available), true);
  assert.equal(R.isGraphResults({ exact: {}, sampled: {} }), false);
});

test('the chart key names a band only where there was sampling', () => {
  assert.equal(R.cdfKey(R.cdf(available.baseline.outcome)), '┄ Target compromise probability · 95% pointwise band');
  assert.equal(R.cdfKey(R.cdf(unreachable.baseline.outcome)), '— Target compromise probability · by structure, not sampled');
  assert.equal(R.cdfKey(R.cdf(seeded.baseline.outcome)), '— Target compromise probability · by structure, not sampled');
});

test('an interval that prints as one number is not said', () => {
  const h = R.headline(available);
  // Every sample reached the target: its interval is 1.00–1.00 as printed.
  assert.doesNotMatch(h.qualifier, /CI/);
  assert.match(h.qualifier, /illustrative inputs/);
});
