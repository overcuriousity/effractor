const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/js/assistant/page.js');
const catalog = JSON.parse(require('node:fs').readFileSync('assets/js/assistant/tools.json', 'utf8'));

test('a call outside the turn\'s access is refused', () => {
  assert.equal(P.allowed('add_entity', 'architecture', 'read', catalog), false);
  assert.equal(P.allowed('set_view', 'architecture', 'read', catalog), true);
  assert.equal(P.allowed('add_entity', 'architecture', 'edit', catalog), true);
  assert.equal(P.allowed('add_node', 'architecture', 'edit', catalog), false, 'not a tool of this mode');
});

test('outputs go whole: the server fits them to the context, and says where it cut', () => {
  assert.equal(P.shape('abc'), '"abc"');
  const big = { x: 'y'.repeat(100000) };
  assert.deepEqual(JSON.parse(P.shape(big)), big);
});

test('every problem reaches the agent, however many there are', async () => {
  const diagnostics = Array.from({ length: 2000 }, (_, i) => ({ severity: 'warning', code: 'incomplete', path: 'entities.e' + i, message: 'm' + i }));
  const app = { state: { diagnostics, blockers: null } };
  const r = await P.createExecutor({ app, tools: {}, catalog, profile: 'architecture' }).run({ id: '1', name: 'problems', input: {} }, 'read');
  assert.equal(JSON.parse(r.output).diagnostics.length, 2000);
});

test('the analysis summary says how many routes there are beside the first three', () => {
  global.window = { effractorGraphResults: {
    headline: () => 'h',
    routes: () => [1, 2, 3, 4, 5],
    assumptions: () => [],
  } };
  try {
    const s = P.graphSummary({ state: { generated: { graph: {} } } }, { baseline: {} });
    assert.deepEqual([s.routes, s.routes_total], [[1, 2, 3], 5]);
  } finally {
    delete global.window;
  }
});

test('calls run one at a time, in order, and a refused edit comes back with its reason', async () => {
  const order = [];
  const app = {
    state: { doc: { profile: 'fault-tree', nodes: { top: { label: 'Top', gate: 'or', children: [] } }, top: 'top' }, text: 't' },
    tryEdit: (e) => new Promise((res) => setTimeout(() => { order.push(e.said); res({ ok: false, reason: 'wasm says no' }); }, 5)),
  };
  const tools = { edit: (name, input) => ({ doc: {}, select: null, said: input.label }) };
  const x = P.createExecutor({ app, tools, catalog, profile: 'fault-tree' });
  const [a, b] = await Promise.all([
    x.run({ id: '1', name: 'add_node', input: { parent: 'top', label: 'A' } }, 'edit'),
    x.run({ id: '2', name: 'add_node', input: { parent: 'top', label: 'B' } }, 'edit'),
  ]);
  assert.deepEqual(order, ['A', 'B']);
  assert.deepEqual([a.id, a.ok, a.output], ['1', false, 'wasm says no']);
  assert.equal(b.id, '2');
});

test('a viewer\'s page refuses an edit call even if the model sent one', async () => {
  const x = P.createExecutor({ app: { state: {} }, tools: {}, catalog, profile: 'architecture' });
  const r = await x.run({ id: '9', name: 'remove', input: {} }, 'read');
  assert.deepEqual([r.ok, r.output], [false, 'not allowed for you here']);
});

test('an applied edit names the plain id the other tools take', async () => {
  const app = { state: { doc: { profile: 'architecture' } }, tryEdit: () => Promise.resolve({ ok: true }) };
  const said = (select) => ({ edit: () => ({ doc: {}, select, said: 'Added network “Internet”' }) });
  const run = (select) => P.createExecutor({ app, tools: said(select), catalog, profile: 'architecture' })
    .run({ id: '1', name: 'add_entity', input: { kind: 'network', label: 'Internet' } }, 'edit');
  const r = await run('entity/internet');
  assert.equal(r.output, 'Added network “Internet”, id internet');
  assert.equal(r.select, 'entity/internet', 'the page still selects the qualified item');
  assert.equal((await run(null)).output, 'Added network “Internet”');
});

test('the catalog reaches the agent whole: every rule, and what a flow needs', async () => {
  const full = JSON.parse(require('node:fs').readFileSync('scripts/fixtures/catalog.json', 'utf8'));
  const app = { state: {}, solver: { catalog: () => Promise.resolve({ ok: full }) } };
  const x = P.createExecutor({ app, tools: {}, catalog, profile: 'architecture' });
  const r = await x.run({ id: '1', name: 'catalog', input: {} }, 'read');
  assert.equal(r.ok, true);
  assert.ok(!r.output.endsWith('… (cut)'), 'not cut');
  const c = JSON.parse(r.output);
  assert.deepEqual(c.rules.map((x) => x.id), full.rules.map((x) => x.id));
  assert.deepEqual(c.associations.map((x) => x.kind), full.associations.map((x) => x.kind));
  assert.deepEqual(c.entities.map((x) => x.kind), full.entities.map((x) => x.kind));
  assert.match(c.flows.source, /application or service/);
  assert.match(c.flows.target, /service/);
  assert.match(c.flows.route, /network/);
});

test('a call after the turn\'s document was closed is refused, and nothing runs on the other one', async () => {
  let open = 7, edits = 0;
  const app = { state: { doc: { profile: 'architecture' }, text: 't' }, tryEdit: () => { edits++; return Promise.resolve({ ok: true }); } };
  const tools = { edit: () => ({ doc: {}, select: null, said: 'Added' }) };
  const x = P.createExecutor({ app, tools, catalog, profile: 'architecture', docId: 7, openId: () => open });
  assert.equal((await x.run({ id: '1', name: 'add_entity', input: { kind: 'host', label: 'H' } }, 'edit')).ok, true);
  open = 8;
  const r = await x.run({ id: '2', name: 'add_entity', input: { kind: 'host', label: 'H' } }, 'edit');
  assert.deepEqual([r.ok, r.output], [false, 'the document was closed']);
  const read = await x.run({ id: '3', name: 'read_document', input: {} }, 'read');
  assert.deepEqual([read.ok, read.output], [false, 'the document was closed']);
  assert.equal(edits, 1);
});

// A page whose solve is played by the test: `run(state)` is what one run does.
function solvingApp(state, run) {
  const app = { state: Object.assign({ doc: { profile: 'fault-tree' }, running: false, explicit: false, blockers: null, sourceValid: true }, state), solves: 0 };
  app.solve = () => {
    app.solves++;
    if (app.state.running && app.state.explicit) { app.state.running = false; return; } // the page's toggle
    setTimeout(() => {
      app.state.running = true;
      setTimeout(() => { app.state.running = false; run(app.state); }, 20);
    }, 5);
  };
  return app;
}

test('results of an older text are not reported as current: an unsolvable edit says why', async () => {
  const blockers = [{ severity: 'error', code: 'no-target', path: 'attacker', message: 'no target' }];
  const app = solvingApp({ doc: { profile: 'architecture' }, results: { old: true }, revision: 2, solvedRevision: 1, scenario: '' },
    (s) => { s.blockers = blockers; });
  global.window = { effractorGraphResults: { headline: () => 'h', routes: () => [], assumptions: () => [] } };
  try {
    const r = await P.createExecutor({ app, tools: {}, catalog, profile: 'architecture' }).run({ id: '1', name: 'solve', input: {} }, 'read');
    assert.equal(r.ok, false);
    assert.deepEqual(JSON.parse(r.output).blockers, blockers);
  } finally {
    delete global.window;
  }
});

test('results solved for the text on the page now are reported', async () => {
  const app = solvingApp({ results: { old: true }, revision: 2, solvedRevision: 1 },
    (s) => { s.results = { p: 0.5 }; s.solvedRevision = s.revision; });
  const r = await P.createExecutor({ app, tools: {}, catalog, profile: 'fault-tree' }).run({ id: '1', name: 'analyse', input: {} }, 'read');
  assert.deepEqual([r.ok, JSON.parse(r.output)], [true, { p: 0.5 }]);
});

test('a solve already running is waited for, not toggled off', async () => {
  const app = solvingApp({ results: null, revision: 3, solvedRevision: 1, running: true, explicit: true }, () => {});
  setTimeout(() => { app.state.running = false; app.state.results = { p: 0.25 }; app.state.solvedRevision = 3; }, 30);
  const r = await P.createExecutor({ app, tools: {}, catalog, profile: 'fault-tree' }).run({ id: '1', name: 'analyse', input: {} }, 'read');
  assert.equal(app.solves, 0);
  assert.deepEqual([r.ok, JSON.parse(r.output)], [true, { p: 0.25 }]);
});

test("the agent's catalog carries each kind's switches and what is optional", () => {
  const library = require('./fixtures/catalog.json');
  const host = P.forAgent(library).entities.find((e) => e.kind === 'host');
  assert.deepEqual(host.defenses, ['aslr', 'anti-malware', 'dep', 'hardened']);
  assert.deepEqual(host.optional_defenses, ['aslr', 'anti-malware', 'dep', 'hardened']);
  assert.ok(host.optional.includes('deploy-exploit'));
  assert.deepEqual(P.forAgent(library).entities.find((e) => e.kind === 'product').defenses, ['patched']);
});

test('a view that could not be shown is refused with the reason, not reported shown', async () => {
  const blockers = [{ severity: 'error', code: 'no-target', path: 'attacker', message: 'no target' }];
  const app = { state: { blockers }, setMode: () => Promise.resolve(false) };
  const x = P.createExecutor({ app, tools: {}, catalog, profile: 'architecture' });
  const r = await x.run({ id: '1', name: 'set_view', input: { view: 'attack' } }, 'read');
  assert.equal(r.ok, false);
  assert.deepEqual(JSON.parse(r.output), blockers);
  app.setMode = () => Promise.resolve(true);
  const shown = await x.run({ id: '2', name: 'set_view', input: { view: 'attack' } }, 'read');
  assert.deepEqual([shown.ok, shown.output], [true, 'showing the attack graph']);
});

test('only a route that exists is drawn', async () => {
  const drawn = [];
  const routes = [{ witness: [] }, { witness: [] }];
  const app = {
    state: { results: { 'effractor-graph-results': 1, baseline: { routes }, scenario: { routes: [routes[0]] } } },
    showRoute: (i, side) => drawn.push([i, side]),
  };
  const x = P.createExecutor({ app, tools: {}, catalog, profile: 'architecture' });
  const run = (input) => x.run({ id: '1', name: 'show_route', input }, 'read');
  for (const index of [2, -1, 1.5, '0', true]) {
    assert.equal((await run({ index })).ok, false, String(index));
  }
  assert.equal((await run({ index: 1, side: 'scenario' })).ok, false, 'the scenario has one route');
  assert.deepEqual(drawn, [], 'nothing drawn for a refused index');
  assert.deepEqual([(await run({ index: 1 })).output, (await run({ index: null })).output], ['route 2 shown', 'no route shown']);
  assert.deepEqual(drawn, [[1, undefined], [null, undefined]]);
});
