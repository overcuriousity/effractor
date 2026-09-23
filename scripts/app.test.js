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
      effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, reveal() {}, on() {}, fit() {} }) },
      effractorLayout: { createLayout: () => async () => ({}) },
      effractorGraph: { describe: () => ({}) },
    effractorProfiles: require('../assets/js/profiles.js'),
    effractorRevisions: require('../assets/js/revisions.js'),
    effractorArchitectureView: require('../assets/js/architecture-view.js'),
    effractorPositions: require('../assets/js/positions.js'),
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

// A page whose worker and layout answer when a test says so: texts listed in
// `slow` are parsed only on release, and so are layouts while `holdLayout`.
// Everything else answers at once. Nothing here is a browser.
function racePage(kept = 'original') {
  const nodes = new Map(), writes = [], held = [], renders = [], runs = [], timers = [], reveals = [], layouts = [];
  const slow = new Set();
  const generated = [];
  let holdLayout = false;
  let holdGenerate = false;
  const docOf = text => text.startsWith('arch')
    ? { name: text, profile: 'architecture', entities: { web: { kind: 'service', label: 'Web' } }, associations: {}, flows: {}, attacker: { footholds: [] }, scenarios: {}, analysis: { seed: 1, samples: 10 } }
    : { name: text, profile: 'fault-tree', nodes: { top: { label: 'Top', leaf: 'basic' } }, analysis: { seed: 1, samples: 10 } };
  const later = (what, value) => new Promise(resolve => held.push({ what, release: () => resolve(value) }));
  const solver = {
    parse(text) { const answer = { ok: docOf(text), diagnostics: [] }; return slow.has(text) ? later('parse ' + text, answer) : Promise.resolve(answer); },
    async serialize(value) { return { ok: value.name }; },
    solve(text, on, options) { return new Promise(resolve => runs.push({ text, on, options, resolve })); },
    cancel() {},
    // Held until released: `generate <text>`. A text holding "gone" has no
    // step for its web service.
    generate(text, revision) {
      generated.push({ text, revision });
      const nodes = [{ id: 'input/foothold/web/user', label: 'Foothold', kind: 'input', inputs: [], origins: [{ rule: 'foothold', version: 1, entities: ['web'], associations: [], flows: [], paths: ['attacker.footholds[0]'], assumptions: [] }], timing: { status: 'foothold', expression: null, note: null, paths: [], missing: [] } }];
      // "big": a chain of 600 steps after the foothold, larger than the canvas shows.
      for (let i = 0; text.includes('big') && i < 600; i++) nodes.push({ id: 'state/x/n' + i + '/s', label: 'Step ' + i, kind: 'any', inputs: [i ? 'state/x/n' + (i - 1) + '/s' : 'input/foothold/web/user'], origins: [{ rule: 'r', version: 1, entities: ['e' + i], associations: [], flows: [], paths: [], assumptions: [] }], timing: { status: 'logical', expression: null, note: null, paths: [], missing: [] } });
      if (!text.includes('gone')) nodes.push({ id: 'state/service/web/control', label: 'Web · control', kind: 'any', inputs: ['input/foothold/web/user'], origins: [{ rule: 'r', version: 1, entities: ['web'], associations: [], flows: [], paths: [], assumptions: [] }], timing: { status: 'logical', expression: null, note: null, paths: [], missing: [] } });
      const answer = text.includes('broken')
        ? { diagnostics: [{ message: 'no target', path: 'attacker' }] }
        : { ok: { revision, source: text, graph: { target: nodes[nodes.length - 1].id, nodes }, support: { nodes: nodes.map(n => ({ id: n.id, status: 'possible', missing: [] })), target_support: [] } }, diagnostics: [] };
      return holdGenerate ? later('generate ' + text, answer) : Promise.resolve(answer);
    },
  };
  const document = {
    currentScript: { src: 'https://example.test/assets/js/app.js' },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, element('div')); return nodes.get(id); },
    createElement: element, querySelectorAll: () => [], addEventListener() {},
  };
  const window = {
    effractorStore: { createStore: () => ({ load: async () => kept, save: text => writes.push(text) }) },
    createSolver: () => solver,
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render(laid) { renders.push(laid.name); }, highlight() {}, reveal(id) { reveals.push(id); }, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => described => (layouts.push(described), holdLayout ? later('layout ' + described.name, described) : Promise.resolve(described)) },
    effractorGraph: { describe: doc => ({ name: doc.name }) },
    effractorProfiles: require('../assets/js/profiles.js'),
    effractorRevisions: require('../assets/js/revisions.js'),
    effractorArchitectureView: { describe: doc => ({ name: doc.name }), route: () => [] },
    effractorAttackView: require('../assets/js/attack-view.js'),
    effractorGraphResults: require('../assets/js/graph-results.js'),
    // Positions pass the layout through: these tests follow which layout is drawn.
    effractorPositions: { createStore: () => ({ load: () => ({}), move() {}, clear() {} }), place: laid => laid },
    effractorEdit: require('../assets/js/edit.js'),
    effractorResults: require('../assets/js/results-view.js'),
    effractorAutoSolve: require('../assets/js/autosolve.js'),
    effractorCharts: require('../assets/js/charts.js'),
  };
  vm.runInNewContext(readFileSync('assets/js/app.js', 'utf8'), {
    window, document, URL, location: new URL('https://example.test/'), console,
    performance: { now: () => 0 },
    setTimeout: function (f) { timers.push(f); return timers.length; },
    clearTimeout: function (id) { timers[id - 1] = null; },
    fetch: async () => ({ ok: true, text: async () => 'arch-template' }),
  });
  const settle = () => new Promise(setImmediate);
  return {
    app: window.effractor, writes, renders, runs, slow, nodes, settle, docOf, generated, reveals, layouts,
    holdLayout(on) { holdLayout = on; },
    holdGenerate(on) { holdGenerate = on; },
    async release(what) { const i = held.findIndex(h => h.what === what); assert.ok(i >= 0, 'nothing held: ' + what); held.splice(i, 1)[0].release(); await settle(); await settle(); },
    async tick() { const due = timers.splice(0).filter(Boolean); due.forEach(f => f()); await settle(); },
    attr: name => document.getElementById('app').getAttribute(name),
  };
}

test('an architecture opens as the document: a profile on the page, solved as a generated graph, qualified selection', async () => {
  const h = racePage();
  await h.app.ready; await h.tick();
  assert.equal(h.runs.length, 1, 'the tree is solved');
  h.runs[0].resolve({ cancelled: true }); await h.settle();
  h.app.select('top');
  assert.equal(await h.app.replaceDocument('arch', 'opened arch.yaml'), true);
  assert.equal(h.app.state.doc.profile, 'architecture');
  assert.equal(h.attr('data-profile'), 'architecture');
  assert.equal(h.attr('data-view'), 'architecture');
  assert.equal(h.nodes.get('solve').disabled, false);
  assert.equal(h.nodes.get('hud-p-label').textContent, 'P(target)');
  assert.equal(h.app.state.selected, null, 'a tree selection does not carry over');
  assert.deepEqual(h.writes, ['arch']);
  await h.tick();
  assert.equal(h.runs.length, 2, 'an architecture is solved too');
  assert.deepEqual(h.runs[1].options, { scenario: '', revision: h.app.state.revision }, 'as a generated graph, with its revision');
  h.app.select('entity/web');
  assert.equal(h.app.state.selected, 'entity/web');
  assert.equal(h.nodes.get('inspector-name').textContent, 'Web');
  assert.equal(h.nodes.get('inspector').hidden, false);
  h.app.select('web');
  assert.equal(h.app.state.selected, null);
  // Undo brings the tree back, and it is solved again.
  h.app.undo(); await h.settle(); await h.settle();
  assert.equal(h.app.state.text, 'original');
  assert.equal(h.attr('data-profile'), 'fault-tree');
  assert.equal(h.nodes.get('hud-p-label').textContent, 'P(top)');
  assert.equal(h.nodes.get('solve').disabled, false);
});

const graphResult = (text, revision, p) => ({ result: { ok: { revision, source: text, result: {
  'effractor-graph-results': 1, target: 'state/service/web/control', time_unit: 'h', horizon: 10, confidence: 0.95, seed: '1', samples: 10,
  baseline: { id: null, outcome: { available: { method: 'sampled', samples: 10, confidence: 0.95, p_target: p, ci: { lo: 0.1, hi: 0.9 }, ttc_cdf: [] } }, nodes: [], assumptions: [], witness: null },
  scenario: null, delta: { unavailable: { reason: 'no scenario to compare', missing: [] } } } } } });

test('a generated graph result arriving after a tree was opened is not shown, nor a tree result after an architecture', async () => {
  const h = racePage('arch');
  await h.app.ready; await h.tick();
  const graphRun = h.runs[h.runs.length - 1];
  assert.equal(graphRun.text, 'arch');
  assert.equal(await h.app.replaceDocument('tree', 'opened tree.yaml'), true);
  graphRun.resolve(graphResult('arch', graphRun.options.revision, 0.5)); await h.settle();
  assert.equal(h.app.state.results, null, 'the architecture\'s answer is dropped');
  assert.equal(h.nodes.get('hud-p').textContent, '—');
  await h.tick();
  const treeRun = h.runs[h.runs.length - 1];
  assert.equal(treeRun.text, 'tree');
  assert.equal(treeRun.options, undefined, 'a tree is solved as a tree');
  assert.equal(await h.app.replaceDocument('arch-again', 'opened arch'), true);
  treeRun.on.onExact({ exact: { available: { p_top: 0.9 } }, cut_sets: { available: { sets: [], total: 0 } }, leaves: [] });
  treeRun.resolve({ result: { ok: { exact: { available: { p_top: 0.9 } }, sampled: { unavailable: { reason: 'x' } }, cut_sets: { available: { sets: [], total: 0 } } } } }); await h.settle();
  assert.ok(!h.app.state.exactResults, 'the tree\'s exact answer is dropped');
  assert.equal(h.app.state.results, null, 'and so is its result');
  // The architecture's own answer is shown.
  await h.tick();
  const own = h.runs[h.runs.length - 1];
  assert.equal(own.text, 'arch-again');
  own.resolve(graphResult('arch-again', own.options.revision, 0.25)); await h.settle();
  assert.equal(h.app.state.results.baseline.outcome.available.p_target, 0.25);
  assert.equal(h.nodes.get('hud-p').textContent, '0.250');
});

test('a graph result for another revision of the same text is not shown', async () => {
  const h = racePage('arch');
  await h.app.ready; await h.tick();
  const run = h.runs[h.runs.length - 1];
  run.resolve(graphResult('arch', 'not-this-one', 0.5)); await h.settle();
  assert.equal(h.app.state.results, null);
});

test('the attack graph is generated on request, follows every edit, and a step that is gone falls back to its component', async () => {
  const h = racePage('arch');
  await h.app.ready;
  assert.equal(await h.app.setMode('attack'), true);
  assert.equal(h.attr('data-view'), 'attack');
  assert.equal(h.generated.length, 1);
  assert.equal(h.generated[0].revision, h.app.state.revision);
  h.app.select('step/state/service/web/control');
  assert.equal(h.app.state.selected, 'step/state/service/web/control');
  // An edit regenerates; the step is still there, and still selected.
  await h.app.applyEdit({ doc: h.docOf('arch-2'), select: h.app.state.selected });
  assert.equal(h.generated.length, 2);
  assert.equal(h.app.state.selected, 'step/state/service/web/control');
  // The next text has no such step: the selection falls back to its component.
  await h.app.applyEdit({ doc: h.docOf('arch-gone'), select: h.app.state.selected });
  assert.equal(h.app.state.mode, 'attack');
  assert.equal(h.app.state.selected, 'entity/web');
  // Back in the architecture, a step becomes its component.
  h.app.select('step/input/foothold/web/user');
  assert.equal(await h.app.setMode('architecture'), true);
  assert.equal(h.attr('data-view'), 'architecture');
  assert.equal(h.app.state.selected, 'entity/web');
  // A text with no attack graph: the view stays the architecture, and says why.
  await h.app.applyEdit({ doc: h.docOf('arch-broken') });
  assert.equal(await h.app.setMode('attack'), false);
  assert.match(h.nodes.get('note').textContent, /no attack graph · no target/);
  assert.equal(h.attr('data-view'), 'architecture');
});

test('a generation that arrives after an edit or undo is not the graph on the page', async () => {
  const h = racePage('arch');
  await h.app.ready;
  h.holdGenerate(true);
  const asked = h.app.setMode('attack');
  await h.settle();
  h.holdGenerate(false);
  await h.app.applyEdit({ doc: h.docOf('arch-2') });
  await h.release('generate arch');
  assert.equal(await asked, false, 'the answer about the old text changes nothing');
  assert.equal(h.app.state.generated, null);
  assert.equal(h.app.state.mode, 'architecture');
  // Undo while a regeneration in the attack view is on its way.
  assert.equal(await h.app.setMode('attack'), true);
  h.holdGenerate(true);
  const edit = h.app.applyEdit({ doc: h.docOf('arch-3') });
  await h.settle(); await h.settle();
  h.holdGenerate(false);
  h.app.undo(); await h.settle(); await h.settle(); await h.settle();
  await h.release('generate arch-3');
  await edit;
  assert.equal(h.app.state.text, 'arch-2');
  assert.equal(h.app.state.generated.revision, h.app.state.revision);
  assert.ok(h.app.state.generated.graph.nodes.length > 0);
  // Opening a tree leaves the attack view.
  assert.equal(await h.app.replaceDocument('tree', 'opened tree'), true);
  assert.equal(h.app.state.mode, 'architecture');
  assert.equal(h.app.state.generated, null);
  assert.equal(await h.app.setMode('attack'), false, 'a tree has no attack graph');
});

test('choosing the architecture while the attack graph is on its way keeps the architecture', async () => {
  const h = racePage('arch');
  await h.app.ready;
  h.holdGenerate(true);
  const attack = h.app.setMode('attack');
  await h.settle();
  assert.equal(await h.app.setMode('architecture'), true);
  await h.release('generate arch');
  assert.equal(await attack, false, 'the later choice wins');
  assert.equal(h.app.state.mode, 'architecture');
  assert.equal(h.attr('data-view'), 'architecture');
});

test('typing in the source while the attack graph regenerates leaves no older graph on the canvas', async () => {
  const h = racePage('arch');
  await h.app.ready;
  assert.equal(await h.app.setMode('attack'), true);
  h.holdGenerate(true);
  const edit = h.app.applyEdit({ doc: h.docOf('arch-2') });
  await h.settle(); await h.settle();
  h.app.markSourceDirty();
  await h.release('generate arch-2');
  await edit; await h.settle();
  assert.equal(h.app.state.generated, null);
  assert.equal(h.app.state.laidView, 'document', 'the drawing is not the graph of the text before');
  assert.equal(h.attr('data-view'), 'architecture');
  // Typed back to the document: the attack graph comes back with it.
  h.holdGenerate(false);
  assert.deepEqual(await h.app.adoptSource('arch-2'), []);
  await h.settle(); await h.settle();
  assert.equal(h.app.state.laidView, 'attack');
  assert.equal(h.app.state.generated.revision, h.app.state.revision);
});

test('selecting in the attack view lays out again only to bring a step into view, and then shows it', async () => {
  const h = racePage('arch');
  await h.app.ready;
  assert.equal(await h.app.setMode('attack'), true);
  const before = h.layouts.length;
  h.app.select('entity/web');
  h.app.select('entity/web');
  h.app.select('step/state/service/web/control');
  await h.settle();
  assert.equal(h.layouts.length, before, 'everything is on the canvas already');
  // A graph larger than the canvas: a step outside the window is brought in and revealed.
  await h.app.applyEdit({ doc: h.docOf('arch-big'), select: null });
  await h.settle();
  h.app.select('step/state/x/n599/s');
  assert.equal(h.layouts.length, before + 2, 'one layout for the edit, one to bring the step in');
  h.reveals.length = 0;
  await h.settle(); await h.settle();
  assert.ok(h.reveals.includes('step/state/x/n599/s'), 'revealed once it is drawn');
});

test('a step shows its state once, in the inspector, not again among the facts', async () => {
  const h = racePage('arch');
  await h.app.ready;
  assert.equal(await h.app.setMode('attack'), true);
  await h.tick();
  const run = h.runs[h.runs.length - 1];
  run.resolve({ result: { ok: { revision: run.options.revision, source: 'arch', result: {
    'effractor-graph-results': 1, target: 'state/service/web/control', time_unit: 'h', horizon: 10, confidence: 0.95, seed: '1', samples: 10,
    baseline: { id: null, outcome: { available: { method: 'sampled', samples: 10, confidence: 0.95, p_target: 0.5, ci: { lo: 0.1, hi: 0.9 }, ttc_cdf: [] } }, nodes: [{ id: 'state/service/web/control', status: 'possible', outcome: { available: { p: 0.5, ci: { lo: 0.1, hi: 0.9 } } } }], assumptions: [], witness: null },
    scenario: null, delta: { unavailable: { reason: 'no scenario to compare', missing: [] } } } } } });
  await h.settle();
  h.app.select('step/state/service/web/control');
  const terms = h.nodes.get('selected-facts').children.filter(c => c.tag === 'dt').map(c => c.textContent);
  assert.deepEqual(terms, ['P(step)', '95% CI']);
});

test('a regeneration overtaken by a newer edit leaves the selection to that edit', async () => {
  const h = racePage('arch');
  await h.app.ready;
  assert.equal(await h.app.setMode('attack'), true);
  h.app.select('step/state/service/web/control');
  h.holdGenerate(true);
  const first = h.app.applyEdit({ doc: h.docOf('arch-a'), select: h.app.state.selected });
  await h.settle(); await h.settle();
  const second = h.app.applyEdit({ doc: h.docOf('arch-b'), select: h.app.state.selected });
  await h.settle(); await h.settle();
  await h.release('generate arch-a');
  await first;
  assert.equal(h.app.state.selected, 'step/state/service/web/control', 'not downgraded to its component on the way');
  await h.release('generate arch-b');
  await second;
  assert.equal(h.app.state.selected, 'step/state/service/web/control');
  assert.equal(h.app.state.text, 'arch-b');
});

test('a kept architecture opens as it was left', async () => {
  const h = racePage('arch-kept');
  await h.app.ready;
  assert.equal(h.app.state.text, 'arch-kept');
  assert.equal(h.attr('data-profile'), 'architecture');
});

test('an edit overtaken on its way through the worker is dropped, and leaves no undo step', async () => {
  const h = racePage();
  await h.app.ready;
  h.slow.add('first');
  const first = h.app.applyEdit({ doc: h.docOf('first') });
  await h.settle();
  assert.equal(await h.app.applyEdit({ doc: h.docOf('second') }), true);
  await h.release('parse first');
  assert.equal(await first, false);
  assert.equal(h.app.state.text, 'second');
  assert.deepEqual(h.writes, ['second']);
  h.app.undo(); await h.settle(); await h.settle();
  assert.equal(h.app.state.text, 'original');
  assert.equal(h.app.canUndo(), false);
});

test('a layout that arrives after the next edit is not drawn over it', async () => {
  const h = racePage();
  await h.app.ready;
  h.holdLayout(true);
  const first = h.app.applyEdit({ doc: h.docOf('first') });
  await h.settle(); await h.settle();
  h.holdLayout(false);
  await h.app.applyEdit({ doc: h.docOf('second') });
  await h.release('layout first');
  assert.equal(await first, true, 'the edit itself stands; only its drawing is late');
  assert.equal(h.renders[h.renders.length - 1], 'second');
  assert.equal(h.renders.indexOf('first'), -1);
});

test('source text that is being typed stops older answers and solving until it parses', async () => {
  const h = racePage();
  await h.app.ready; await h.tick();
  const run = h.runs[0];
  h.app.markSourceDirty();
  assert.equal(h.app.state.sourceValid, false);
  assert.equal(h.nodes.get('solve').disabled, true);
  run.on.onExact({ exact: { available: { p_top: 0.5 } }, cut_sets: { available: { sets: [], total: 0 } }, leaves: [] });
  assert.equal(h.app.state.exactResults, undefined, 'an answer about the text before the typing is dropped');
  run.resolve({ cancelled: true }); await h.settle();
  h.app.solve();
  assert.match(h.nodes.get('note').textContent, /source is not valid/);
  // A parse of what was typed, overtaken by more typing, is not adopted.
  h.slow.add('typed');
  const typed = h.app.adoptSource('typed');
  await h.settle();
  h.app.markSourceDirty();
  await h.release('parse typed');
  assert.equal(await typed, null, 'its problems are not the ones to show');
  assert.equal(h.app.state.text, 'original');
  assert.deepEqual(h.writes, []);
  assert.equal(h.app.canUndo(), false);
  // Typed back to what the document is: valid again, and solved again.
  assert.deepEqual(await h.app.adoptSource('original'), []);
  assert.equal(h.app.state.sourceValid, true);
  assert.equal(h.nodes.get('solve').disabled, false);
  await h.tick();
  assert.equal(h.runs.length, 2);
});

test('a result solved for a text that was undone is not shown', async () => {
  const h = racePage();
  await h.app.ready;
  await h.app.applyEdit({ doc: h.docOf('edited') });
  await h.tick();
  const run = h.runs[h.runs.length - 1];
  assert.equal(run.text, 'edited');
  h.app.undo(); await h.settle(); await h.settle();
  run.on.onExact({ exact: { available: { p_top: 0.9 } }, cut_sets: { available: { sets: [], total: 0 } }, leaves: [] });
  assert.ok(!h.app.state.exactResults, 'the answer about the undone text is dropped');
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
  assert.equal(templateName("?new=architecture"), "new-architecture");
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
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, reveal() {}, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => async () => ({}) },
    effractorGraph: { describe: () => ({}) },
    effractorProfiles: require('../assets/js/profiles.js'),
    effractorRevisions: require('../assets/js/revisions.js'),
    effractorArchitectureView: require('../assets/js/architecture-view.js'),
    effractorPositions: require('../assets/js/positions.js'),
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
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, reveal() {}, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => async () => ({}) },
    effractorGraph: { describe: () => ({}) },
    effractorProfiles: require('../assets/js/profiles.js'),
    effractorRevisions: require('../assets/js/revisions.js'),
    effractorArchitectureView: require('../assets/js/architecture-view.js'),
    effractorPositions: require('../assets/js/positions.js'),
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
    effractorRenderer: { createSvgRenderer: () => ({ mount() {}, render() {}, highlight() {}, reveal() {}, on() {}, fit() {} }) },
    effractorLayout: { createLayout: () => async () => ({}) },
    effractorGraph: { describe: () => ({}) },
    effractorProfiles: require('../assets/js/profiles.js'),
    effractorRevisions: require('../assets/js/revisions.js'),
    effractorArchitectureView: require('../assets/js/architecture-view.js'),
    effractorPositions: require('../assets/js/positions.js'),
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

// Review findings on the revision gate, each once seen to fail.
test('typing in the source does not drop the layout of the document already committed', async () => {
  const h = racePage();
  await h.app.ready;
  h.holdLayout(true);
  const edit = h.app.applyEdit({ doc: h.docOf('first') });
  await h.settle(); await h.settle();
  h.holdLayout(false);
  h.app.markSourceDirty();
  await h.release('layout first');
  assert.equal(await edit, true);
  assert.equal(h.renders[h.renders.length - 1], 'first');
});

test('closing the source view on its own text expires a parse still in flight', async () => {
  const h = racePage();
  await h.app.ready;
  h.slow.add('typed');
  h.app.markSourceDirty();
  const late = h.app.adoptSource('typed');
  await h.settle();
  assert.deepEqual(await h.app.adoptSource('original'), []);
  await h.release('parse typed');
  assert.equal(await late, null);
  assert.equal(h.app.state.text, 'original');
  assert.equal(h.app.state.sourceValid, true);
});

test('a dropped edit says so', async () => {
  const h = racePage();
  await h.app.ready;
  h.slow.add('first');
  const first = h.app.applyEdit({ doc: h.docOf('first') });
  await h.settle();
  await h.app.applyEdit({ doc: h.docOf('second') });
  await h.release('parse first');
  assert.equal(await first, false);
  assert.match(h.nodes.get('note').textContent, /overtaken/);
});

test('undo pressed again while one is on its way is not lost from the history', async () => {
  const h = racePage();
  await h.app.ready;
  await h.app.applyEdit({ doc: h.docOf('a') });
  await h.app.applyEdit({ doc: h.docOf('b') });
  h.slow.add('a');
  h.app.undo(); await h.settle();
  h.app.undo(); await h.settle();
  await h.release('parse a');
  assert.equal(h.app.state.text, 'a');
  assert.equal(h.app.canUndo(), true);
  h.slow.delete('a');
  h.app.redo(); await h.settle(); await h.settle();
  assert.equal(h.app.state.text, 'b');
  h.app.undo(); await h.settle(); await h.settle();
  h.app.undo(); await h.settle(); await h.settle();
  assert.equal(h.app.state.text, 'original');
});

test('a tree selection is gone the moment an architecture is committed, before its layout', async () => {
  const h = racePage();
  await h.app.ready;
  h.app.select('top');
  h.holdLayout(true);
  h.app.replaceDocument('arch', 'opened');
  await h.settle(); await h.settle(); await h.settle();
  assert.equal(h.app.state.doc.profile, 'architecture');
  assert.equal(h.app.state.selected, null);
});
