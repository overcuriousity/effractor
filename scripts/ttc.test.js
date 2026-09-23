const { test } = require('node:test');
const assert = require('node:assert');
const ttc = require('../assets/js/ttc.js');

test('the common shapes split into a chance and an average time, and join back', () => {
  const cases = [
    ['50% * Exponential(mean 12.5)', { chance: 50, mean: 12.5 }],
    ['Exponential(mean 3)', { chance: null, mean: 3 }],
    ['30%', { chance: 30, mean: null }],
    ['12.5% * Exponential(mean 1e-3)', { chance: 12.5, mean: 0.001 }],
  ];
  for (const [text, parts] of cases) {
    assert.deepEqual(ttc.split(text), parts, text);
    assert.equal(ttc.split(ttc.join(parts)).chance, parts.chance, text);
    assert.equal(ttc.split(ttc.join(parts)).mean, parts.mean, text);
  }
  assert.equal(ttc.join({ chance: 100, mean: 4 }), 'Exponential(mean 4)');
  assert.equal(ttc.join({ chance: null, mean: null }), '');
  for (const other of ['Never', 'Immediate', 'Gamma(2, 4)', 'nonsense', '50% * Gamma(2, 4)']) {
    assert.equal(ttc.split(other), null, other);
  }
});

test('presets are plain choices, written in the file as the notation itself', () => {
  const labels = ttc.PRESETS.map(p => p[0]);
  assert.deepEqual(labels.slice(-2), ['Never', 'Immediate']);
  const hard = ttc.PRESETS.find(p => p[1] === 'Exponential(mean 10)');
  assert.ok(hard, 'Hard is an average of 10');
  assert.ok(ttc.PRESETS.some(p => p[1] === '50% * Exponential(mean 10)'));
  for (const [, expr] of ttc.PRESETS) assert.doesNotMatch(expr, /Bernoulli|And|Infinity|Zero/);
});

test('hints say what happens in plain words and model units', () => {
  assert.match(ttc.describe('Exponential(mean 10)', 'd'), /10 days/);
  assert.match(ttc.describe('50% * Exponential(mean 10)', 'h'), /50%/);
  assert.match(ttc.describe('50% * Exponential(mean 10)', 'h'), /10 hours/);
  assert.match(ttc.describe('Never', 'd'), /never/i);
  assert.match(ttc.describe('Immediate', 'd'), /at once/i);
  assert.match(ttc.describe('Gamma(2, 4)', 'd'), /custom/i);
  assert.match(ttc.describe('', 'd'), /choose/i);
});

test('a fault-tree leaf shows its p and rate in the same notation', () => {
  assert.equal(ttc.showChance(0.3), '30%');
  assert.equal(ttc.showChance(0.0025), '0.25%');
  assert.equal(ttc.showRate(0.1), 'Exponential(mean 10)');
  assert.equal(ttc.showRate(0.03), 'Exponential(mean 33.3)');
});
