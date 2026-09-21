const { test } = require('node:test');
const assert = require('node:assert/strict');
const ttc = require('../assets/js/ttc.js');

test('presets explain eventual success separately from waiting time, in model units', () => {
  assert.match(ttc.describe('HardAndCertain', 'd'), /10 days/);
  assert.match(ttc.describe('HardAndCertain', 'd'), /eventual success/);
  assert.match(ttc.describe('HardAndCertain', 'd'), /horizon/);
  assert.match(ttc.describe('HardAndUncertain', 'h'), /50%/);
  assert.match(ttc.describe('HardAndUncertain', 'h'), /10 hours/);
  assert.match(ttc.describe('EasyAndUncertain', 'y'), /immediate/);
  assert.doesNotMatch(ttc.describe('EasyAndUncertain', 'y'), /mean/);
  assert.match(ttc.describe('Infinity', 'd'), /blocked/);
  assert.match(ttc.describe('Zero', 'd'), /immediate/);
});

test('picker labels explain presets while values preserve the file format', () => {
  const options = ttc.options('d');
  assert.ok(options.some(([value, label]) => value === 'HardAndCertain' && label.includes('10 days')));
  assert.ok(options.some(([value]) => value === 'custom'));
  assert.match(ttc.describe('Gamma(2, 10)', 'h'), /Custom distribution/);
});
