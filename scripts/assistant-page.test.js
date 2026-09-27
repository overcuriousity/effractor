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

test('outputs are cut, and say so', () => {
  assert.equal(P.shape('abc', 10), '"abc"');
  const long = P.shape({ x: 'y'.repeat(100) }, 20);
  assert.ok(long.length <= 20 + 8 && long.endsWith('… (cut)'));
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
