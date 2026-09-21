const { test } = require('node:test');
const assert = require('node:assert/strict');
const charts = require('../assets/js/charts.js');

test('CDF rows retain exact and sampled values without inventing missing data', () => {
  const result = { time_unit: 'day', horizon: 10, exact: { available: { ttc_cdf: [[0, .2], [10, .8]] } }, sampled: { available: { confidence: .95, ttc_cdf: [[0, .21, .19, .23], [10, .79, .77, .81]] } } };
  const data = charts.cdf(result);
  assert.deepEqual(data.rows, [[0, .2, .21, .19, .23], [10, .8, .79, .77, .81]]);
  assert.equal(data.confidence, .95);
  assert.deepEqual(charts.cdf({ exact: result.exact }).rows, [[0, .2, null, null, null], [10, .8, null, null, null]]);
  assert.deepEqual(charts.cdf(null).rows, []);
});

test('loss view preserves inclusive exceedance and quantiles, including all-zero losses', () => {
  const loss = { mean: 0, p50: 0, p90: 0, p95: 0, p99: 0, exceedance: [[0, 1]] };
  assert.deepEqual(charts.loss({ sampled: { available: { loss } } }).rows, [[0, 1]]);
  assert.deepEqual(charts.loss({ sampled: { available: { loss } } }).percentiles, [['p50', 0], ['p90', 0], ['p95', 0], ['p99', 0]]);
  assert.equal(charts.loss({ sampled: { available: { loss: null } } }).reason, 'No assets');
});

test('SVG coordinates stay finite for zero domains and retain nonzero intercepts', () => {
  assert.equal(charts.line([[0, .2], [10, .8]], 10), 'M48,169.6 L344,66.4');
  assert.equal(/NaN|Infinity/.test(charts.line([[0, 1]], 0)), false);
  assert.equal(charts.line([], 0), '');
  assert.equal(charts.nearest([[0], [5], [10]], 7), 1);
  assert.equal(charts.nearest([[0], [5], [10]], 9), 2);
});

test('partial exact snapshots include the document units and horizon without sampled data', () => {
  const begun = { exact: { available: { ttc_cdf: [[0, 0], [20, .5]] } } };
  const snapshot = charts.exactSnapshot(begun, { horizon: 20, time_unit: 'h', currency: 'EUR' });
  assert.equal(snapshot.horizon, 20);
  assert.equal(snapshot.time_unit, 'h');
  assert.equal(snapshot.currency, 'EUR');
  assert.deepEqual(charts.cdf(snapshot).rows, [[0, 0, null, null, null], [20, .5, null, null, null]]);
  assert.equal(snapshot.sampled, undefined);
});
