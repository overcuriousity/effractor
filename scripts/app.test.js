const { test } = require("node:test");
const assert = require("node:assert");
const { templateName, grouped, probability, money, analysisLabel, samplesOverride } = require("../assets/js/app.js");
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { element } = require('./fixtures/fake-dom.js');

// The real app/history, with the worker boundary paused at each asynchronous
// stage. A cancelled link must not alter document, saved text, or undo history.
for (const stage of ['parse', 'serialize', 'commit-parse']) {
  test(`navigation during share ${stage} cannot commit an obsolete document`, async () => {
    let release, entered, current = true, parseCount = 0;
    const paused = new Promise(resolve => { entered = resolve; });
    const writes = [], nodes = new Map();
    const doc = text => ({ name: text, profile: 'fault-tree', nodes: {}, analysis: { seed: 42, samples: 10000 } });
    async function hold() { entered(); await new Promise(resolve => { release = resolve; }); }
    const solver = {
      async parse(text) {
        if (text === 'linked') {
          parseCount++;
          if ((stage === 'parse' && parseCount === 1) || (stage === 'commit-parse' && parseCount === 2)) await hold();
        }
        return { ok: doc(text) };
      },
      async serialize(value) { if (stage === 'serialize' && value.name === 'linked') await hold(); return { ok: value.name }; },
    };
    const document = {
      currentScript: { src: 'https://example.test/assets/js/app.js' },
      getElementById(id) { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); },
      createElement: element, querySelectorAll: () => [], addEventListener() {},
    };
    const window = {
      effractorStore: { createStore: () => ({ load: async () => 'original', save: text => writes.push(text) }) },
      createSolver: () => solver,
      effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, on() {}, fit() {} }) },
      effractorLayout: { createLayout: () => async () => ({}) },
      effractorGraph: { describe: () => ({}) },
      effractorEdit: require('../assets/js/edit.js'),
      effractorResults: require('../assets/js/results-view.js'),
    };
    vm.runInNewContext(readFileSync('assets/js/app.js', 'utf8'), {
      window, document, URL, location: new URL('https://example.test/'), console,
      setTimeout: () => 0, clearTimeout() {},
    });
    const app = window.effractor; await app.ready;
    assert.equal(app.state.text, 'original');
    const pending = app.replaceDocument('linked', 'opened local copy', () => current);
    await paused; current = false; release();
    assert.equal(await pending, false);
    assert.equal(app.state.text, 'original');
    assert.deepEqual(writes, []);
    assert.equal(app.canUndo(), false);
    // Ordinary file opens still commit, persist, and undo through the same path.
    assert.equal(await app.replaceDocument('replacement', 'opened file'), true);
    assert.equal(app.state.text, 'replacement');
    assert.deepEqual(writes, ['replacement']);
    assert.equal(app.canUndo(), true);
    app.undo(); await new Promise(setImmediate);
    assert.equal(app.state.text, 'original');
  });
}

test("whole numbers are grouped in threes with a no-break space", () => {
  assert.equal(grouped(42), "42");
  assert.equal(grouped(10000), "10 000");
  assert.equal(grouped(1234567), "1 234 567");
});

test("probabilities keep three significant digits, small ones in e-notation", () => {
  assert.equal(probability(0.047351064), "0.0474");
  assert.equal(probability(1), "1.00");
  assert.equal(probability(0), "0");
  assert.equal(probability(2.5e-7), "2.50e-7");
});

test("money is whole units of the model's currency, whatever that is", () => {
  assert.equal(money(6370.97, "EUR"), "€6,371");
  // A currency is free text in the document; not every one is an ISO code.
  assert.equal(money(1500, "Taler"), "1,500 Taler");
  assert.equal(money(1500, ""), "1,500");
});

test("the analysis chip says what will be sampled", () => {
  assert.equal(analysisLabel({ samples: 10000, seed: 42 }), "10 000 samples · seed 42");
  // A seed beyond 2^53 arrives as a string and is shown as it is.
  assert.equal(analysisLabel({ samples: 1, seed: "18446744073709551615" }), "1 samples · seed 18446744073709551615");
});

test("?samples= is a whole number of at least one, or nothing", () => {
  assert.equal(samplesOverride("?samples=5000000"), 5000000);
  assert.equal(samplesOverride("?a=1&samples=20"), 20);
  assert.equal(samplesOverride(""), null);
  assert.equal(samplesOverride("?samples=lots"), null);
  assert.equal(samplesOverride("?samples=0"), null);
  assert.equal(samplesOverride("?samples=1.5"), null);
});

test("the page opens on an empty document; ?new= picks its profile and nothing else", () => {
  assert.equal(templateName(""), "new");
  assert.equal(templateName("?new=attack-tree"), "new-attack");
  assert.equal(templateName("?samples=5&new=attack-tree"), "new-attack");
  assert.equal(templateName("?new=../../etc/passwd"), "new");
  assert.equal(templateName("?example=webserver"), "new");
});

// The selected node's form lives in an inspector on the canvas, shown exactly
// while something is selected; the side panels are not touched by a selection.
test("the inspector follows the selection", async () => {
  const nodes = new Map(), attributes = [];
  const doc = { name: 't', profile: 'fault-tree', nodes: { top: { label: 'Top', gate: 'or', children: ['a'] }, a: { label: 'A', leaf: 'basic' } }, analysis: { seed: 1, samples: 10 } };
  const document = {
    currentScript: { src: 'https://example.test/assets/js/app.js' },
    getElementById(id) {
      if (!nodes.has(id)) {
        const el = element('div');
        if (id === 'app') el.setAttribute = (k, v) => attributes.push(k + '=' + v);
        nodes.set(id, el);
      }
      return nodes.get(id);
    },
    createElement: element, querySelectorAll: () => [], addEventListener() {},
  };
  const window = {
    effractorStore: { createStore: () => ({ load: async () => 'text', save() {} }) },
    createSolver: () => ({ async parse() { return { ok: doc }; }, async serialize() { return { ok: 'text' }; } }),
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => async () => ({}) },
    effractorGraph: { describe: () => ({}) },
    effractorEdit: require('../assets/js/edit.js'),
    effractorResults: require('../assets/js/results-view.js'),
  };
  vm.runInNewContext(readFileSync('assets/js/app.js', 'utf8'), {
    window, document, URL, location: new URL('https://example.test/'), console,
    setTimeout: () => 0, clearTimeout() {},
  });
  const app = window.effractor; await app.ready;
  // Hidden by its markup until the first selection; from then on, by select().
  const inspector = document.getElementById('inspector');
  app.select('a');
  assert.equal(inspector.hidden, false);
  assert.equal(nodes.get('inspector-name').textContent, 'A');
  app.select(null);
  assert.equal(inspector.hidden, true);
  app.select('nowhere');
  assert.equal(inspector.hidden, true);
  // Selecting opens no panel: the workspace attributes stay whatever they were.
  assert.deepEqual(attributes.filter(a => /^data-(left|right)/.test(a)), []);
});

// The HUD's two cards say nothing until there is a solve to say it with.
test("the HUD is hidden while nothing is solved", async () => {
  const nodes = new Map();
  const doc = { name: 't', profile: 'fault-tree', nodes: { top: { label: 'Top', gate: 'or', children: [] } }, analysis: { seed: 1, samples: 10 } };
  const document = {
    currentScript: { src: 'https://example.test/assets/js/app.js' },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); },
    createElement: element, querySelectorAll: () => [], addEventListener() {},
  };
  const window = {
    effractorStore: { createStore: () => ({ load: async () => 'text', save() {} }) },
    createSolver: () => ({ async parse() { return { ok: doc }; }, async serialize() { return { ok: 'text' }; } }),
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => async () => ({}) },
    effractorGraph: { describe: () => ({}) },
    effractorEdit: require('../assets/js/edit.js'),
    effractorResults: require('../assets/js/results-view.js'),
  };
  vm.runInNewContext(readFileSync('assets/js/app.js', 'utf8'), {
    window, document, URL, location: new URL('https://example.test/'), console,
    setTimeout: () => 0, clearTimeout() {},
  });
  const app = window.effractor; await app.ready;
  assert.equal(await app.replaceDocument('text', 'opened'), true);
  assert.equal(document.getElementById('hud-stats').hidden, true);
});
