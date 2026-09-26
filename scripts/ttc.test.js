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
  for (const other of ['Never', 'Immediate', 'Gamma(2, 4)', 'nonsense', '50% * Gamma(2, 4)', '50% *', '50%*', '* Exponential(mean 3)', '*']) {
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
  assert.equal(ttc.showRate(0.03), 'Exponential(mean 33.333333333333336)');
  assert.equal(ttc.showRate(1e-25), 'Exponential(mean 9.999999999999999e+24)'); // the parser takes exponents
});

// The form, driven through a minimal DOM: what a person types stays typed.
function form(initial) {
  class El extends EventTarget {
    constructor(tag) { super(); this.tagName = tag; this.children = []; this._v = ''; this.hidden = false; this.id = ''; }
    get value() { return this._v; }
    set value(v) { this._v = String(v); }
    append(...c) { this.children.push(...c); }
    setAttribute() {}
    focus() {}
    select() {}
  }
  global.document = { createElement: t => new El(t) };
  global.window = { effractorMenu: { dropdown: () => new El('select') } };
  const input = new El('input');
  input.id = 'ttc';
  input.value = initial;
  const wrap = ttc.attach(input, 'd');
  const parts = wrap.children[1];
  const fields = { input, parts, picker: wrap.children[0], chance: parts.children[0].children[1], mean: parts.children[1].children[1] };
  fields.type = (field, text) => {
    field.value = '';
    for (const ch of text) {
      field.value = field.value + ch;
      field.dispatchEvent(new Event('input'));
    }
  };
  return fields;
}

test('typing a number into Chance or Average time keeps every key', () => {
  const f = form('50% * Exponential(mean 10)');
  f.type(f.chance, '0.05');
  assert.equal(f.chance.value, '0.05');
  assert.equal(f.input.value, '0.05% * Exponential(mean 10)');
  f.type(f.mean, '12.05');
  assert.equal(f.mean.value, '12.05');
  assert.equal(f.input.value, '0.05% * Exponential(mean 12.05)');
});

test('the preset and the parts have ids from the field, so a redrawn form keeps the focus', () => {
  const f = form('50% * Exponential(mean 10)');
  assert.equal(f.chance.id, 'ttc-chance');
  assert.equal(f.mean.id, 'ttc-mean');
  assert.equal(f.picker.id, 'ttc-preset');
});

test('a certain chance with no time is written, not dropped', () => {
  assert.equal(ttc.join({ chance: 100, mean: null }), '100%');
  assert.equal(ttc.join({ chance: '100', mean: '' }), '100%');
});

test('a tiny fault-tree probability is shown without an exponent', () => {
  assert.equal(ttc.showChance(1e-9), '0.0000001%');
  assert.doesNotMatch(ttc.showChance(2.5e-12), /e/);
});

test('a preset of one unit says it in the singular', () => {
  const labels = ttc.options('d').map(o => o[1]);
  assert.ok(labels.includes('Easy · about 1 day'), labels.join(' | '));
  assert.ok(labels.includes('Hard · about 10 days'), labels.join(' | '));
});

test('no page copy or example tells people to write a refused spelling', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const dir = path.join(__dirname, '../assets/js');
  const refused = /(["'`])[^"'`\n]*\b(Infinity|Bernoulli|HardAndCertain|EasyAndCertain)\b[^"'`\n]*\1/;
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js'))) {
    assert.doesNotMatch(fs.readFileSync(path.join(dir, f), 'utf8'), refused, f);
  }
  for (const dir of ['../assets/templates', '../docs/course']) {
    const ex = path.join(__dirname, dir);
    for (const f of fs.readdirSync(ex).filter(f => f.endsWith('.yaml'))) {
      assert.doesNotMatch(fs.readFileSync(path.join(ex, f), 'utf8'), /\b(Infinity|Bernoulli)\b/, f);
    }
  }
});
