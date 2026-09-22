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
      effractorAutoSolve: require('../assets/js/autosolve.js'),
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

// Until the architecture editor exists (roadmap: architecture-editor), an
// architecture must not become the page's document: every renderer path reads
// `doc.nodes`. The old document stays, and the page says why.
function pageWith(kept) {
  const writes = [], nodes = new Map();
  const doc = text => text === 'arch'
    ? { name: 'A', profile: 'architecture', entities: {}, analysis: { seed: 42, samples: 10000 } }
    : { name: text, profile: 'fault-tree', nodes: {}, analysis: { seed: 42, samples: 10000 } };
  const solver = {
    async parse(text) { return { ok: doc(text) }; },
    async serialize(value) { return { ok: value.profile === 'architecture' ? 'arch' : value.name }; },
  };
  const document = {
    currentScript: { src: 'https://example.test/assets/js/app.js' },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); },
    createElement: element, querySelectorAll: () => [], addEventListener() {},
  };
  const window = {
    effractorStore: { createStore: () => ({ load: async () => kept, save: text => writes.push(text) }) },
    createSolver: () => solver,
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => async () => ({}) },
    effractorGraph: { describe: () => ({}) },
    effractorEdit: require('../assets/js/edit.js'),
    effractorResults: require('../assets/js/results-view.js'),
    effractorAutoSolve: require('../assets/js/autosolve.js'),
  };
  const fetched = [];
  vm.runInNewContext(readFileSync('assets/js/app.js', 'utf8'), {
    window, document, URL, location: new URL('https://example.test/'), console,
    setTimeout: () => 0, clearTimeout() {},
    fetch: async url => { fetched.push(url); return { ok: true, text: async () => 'template' }; },
  });
  return { app: window.effractor, writes, nodes, fetched };
}

test("opening an architecture keeps the current document and says the editor is unavailable", async () => {
  const { app, writes, nodes } = pageWith('original');
  await app.ready;
  assert.equal(await app.replaceDocument('arch', 'opened arch.yaml'), false);
  assert.equal(app.state.text, 'original');
  assert.deepEqual(writes, []);
  assert.equal(app.canUndo(), false);
  assert.match(nodes.get('note').textContent, /Architecture editor unavailable/);
  // A tree still opens through the same path.
  assert.equal(await app.replaceDocument('tree', 'opened tree.yaml'), true);
  assert.equal(app.state.text, 'tree');
});

test("typing an architecture into the source view is reported, not adopted", async () => {
  const { app, writes } = pageWith('original');
  await app.ready;
  const problems = await app.adoptSource('arch');
  assert.equal(problems.length, 1);
  assert.equal(problems[0].severity, 'error');
  assert.match(problems[0].message, /Architecture editor unavailable/);
  assert.equal(app.state.text, 'original');
  assert.deepEqual(writes, []);
  assert.equal(app.canUndo(), false);
});

test("a kept architecture cannot lock the page: it opens on the template instead", async () => {
  const { app, fetched } = pageWith('arch');
  await app.ready;
  assert.equal(app.state.text, 'template');
  assert.equal(fetched.length, 1);
});

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
    effractorAutoSolve: require('../assets/js/autosolve.js'),
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
    effractorAutoSolve: require('../assets/js/autosolve.js'),
  };
  vm.runInNewContext(readFileSync('assets/js/app.js', 'utf8'), {
    window, document, URL, location: new URL('https://example.test/'), console,
    setTimeout: () => 0, clearTimeout() {},
  });
  const app = window.effractor; await app.ready;
  assert.equal(await app.replaceDocument('text', 'opened'), true);
  assert.equal(document.getElementById('hud-stats').hidden, true);
});

// Solving by itself: the page solves what it loads and every edit, after a
// pause; what was said about an older text stays, marked, until replaced.
function autoHarness() {
  const nodes = new Map(), timers = [], runs = [];
  let cancels = 0, clock = 0;
  const doc = name => ({ name, profile: 'fault-tree', nodes: { top: { label: 'Top', gate: 'or', children: [] } }, analysis: { seed: 1, samples: 10 } });
  const document = {
    currentScript: { src: 'https://example.test/assets/js/app.js' },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); },
    createElement: element, querySelectorAll: () => [], addEventListener() {},
  };
  const window = {
    effractorStore: { createStore: () => ({ load: async () => 'original', save() {} }) },
    createSolver: () => ({
      async parse(text) { return { ok: doc(text) }; },
      async serialize(value) { return { ok: value.name }; },
      solve(text, on) {
        return new Promise(resolve => runs.push({ text, on, resolve }));
      },
      cancel() { cancels++; },
    }),
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => async () => ({}) },
    effractorGraph: { describe: () => ({}) },
    effractorEdit: require('../assets/js/edit.js'),
    effractorResults: require('../assets/js/results-view.js'),
    effractorAutoSolve: require('../assets/js/autosolve.js'),
    effractorCharts: require('../assets/js/charts.js'),
  };
  vm.runInNewContext(readFileSync('assets/js/app.js', 'utf8'), {
    window, document, URL, location: new URL('https://example.test/'), console,
    performance: { now: () => clock },
    // Like a browser's: called as some other object's method, they throw.
    setTimeout: function (f) { 'use strict'; if (this) throw new TypeError('Illegal invocation'); timers.push(f); return timers.length; },
    clearTimeout: function (id) { 'use strict'; if (this) throw new TypeError('Illegal invocation'); timers[id - 1] = null; },
  });
  const begun = p => ({ exact: { available: { p_top: p } }, cut_sets: { available: { sets: [], total: 0 } }, leaves: [] });
  const solved = p => Object.assign(begun(p), { sampled: { available: { p_top: p, p_top_ci: { lo: p, hi: p }, confidence: 0.95, loss: null } } });
  return {
    app: window.effractor, runs, doc, begun, solved,
    text: id => nodes.get(id) ? nodes.get(id).textContent : undefined,
    level: () => document.getElementById('app').getAttribute('data-results'),
    cancels: () => cancels,
    advance(ms) { clock += ms; },
    async tick() { const due = timers.splice(0).filter(Boolean); due.forEach(f => f()); await new Promise(setImmediate); },
    settle: () => new Promise(setImmediate),
  };
}

test('a loaded document is solved by itself, and an edit keeps the old numbers until new ones arrive', async () => {
  const h = autoHarness();
  await h.app.ready;
  assert.equal(h.runs.length, 0, 'solving waits for a pause');
  await h.tick();
  assert.deepEqual(h.runs.map(r => r.text), ['original']);
  h.runs[0].on.onExact(h.begun(0.25));
  assert.equal(h.level(), 'exact');
  assert.equal(h.text('hud-p'), '0.250');
  h.runs[0].resolve({ result: { ok: h.solved(0.25) } }); await h.settle();
  assert.equal(h.level(), 'current');

  // An edit fades what is there; it does not blank it.
  assert.equal(await h.app.applyEdit({ doc: h.doc('edited') }), true);
  assert.equal(h.level(), 'updating');
  assert.equal(h.text('hud-p'), '0.250');
  assert.ok(h.app.state.results);
  await h.tick();
  assert.equal(h.runs[1].text, 'edited');

  // Another edit while that runs: it is cancelled, and what it still says is
  // about a text that is gone.
  assert.equal(await h.app.applyEdit({ doc: h.doc('again') }), true);
  assert.equal(h.cancels(), 1);
  h.runs[1].on.onExact(h.begun(0.5));
  assert.equal(h.text('hud-p'), '0.250');
  h.runs[1].resolve({ cancelled: true }); await h.settle();
  await h.tick();
  assert.equal(h.runs[2].text, 'again');
  h.runs[2].on.onExact(h.begun(0.75));
  h.runs[2].resolve({ result: { ok: h.solved(0.75) } }); await h.settle();
  assert.equal(h.text('hud-p'), '0.750');
  assert.equal(h.level(), 'current');
});

test('after a slow sampled run, edits refresh only the exact part', async () => {
  const h = autoHarness();
  await h.app.ready; await h.tick();
  h.runs[0].on.onExact(h.begun(0.25));
  h.advance(2500);
  h.runs[0].resolve({ result: { ok: h.solved(0.25) } }); await h.settle();

  await h.app.applyEdit({ doc: h.doc('edited') }); await h.tick();
  h.runs[1].on.onExact(h.begun(0.5));
  assert.equal(h.cancels(), 1, 'sampling is cancelled once the exact part is in');
  h.runs[1].resolve({ cancelled: true }); await h.settle();
  assert.equal(h.text('hud-p'), '0.500');
  assert.equal(h.level(), 'exact', 'the sampled parts stay marked as older');
  assert.equal(h.text('analysis-chip'), 'exact only · Ctrl+Enter samples');

  // Solve asks for everything, whatever the last run cost.
  h.app.solve(); await h.settle();
  assert.equal(h.runs[2].text, 'edited');
  h.runs[2].on.onExact(h.begun(0.5));
  assert.equal(h.cancels(), 1);
  h.runs[2].resolve({ result: { ok: h.solved(0.5) } }); await h.settle();
  assert.equal(h.level(), 'current');
});

test('another document starts with nothing on screen', async () => {
  const h = autoHarness();
  await h.app.ready; await h.tick();
  h.runs[0].on.onExact(h.begun(0.25));
  h.runs[0].resolve({ result: { ok: h.solved(0.25) } }); await h.settle();
  assert.equal(await h.app.replaceDocument('other', 'opened'), true);
  assert.equal(h.level(), 'none');
  assert.equal(h.app.state.results, null);
  await h.tick();
  assert.equal(h.runs[1].text, 'other');
});
