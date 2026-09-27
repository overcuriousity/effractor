const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../assets/js/assistant/tools.js');
const AE = require('../assets/js/architecture-edit.js');
const catalog = JSON.parse(require('node:fs').readFileSync('assets/js/assistant/tools.json', 'utf8'));

const HOST = { kind: 'host', parameters: [], defense: null };
const SERVICE = { kind: 'service', parameters: ['find-exploit', 'deploy-exploit'], defense: 'patched' };
const CAT = { entities: [HOST, SERVICE] };
const arch = (doc) => ({ doc: doc || AE.empty(), profile: 'architecture', catalog: CAT });
const TREE = { effractor: 2, profile: 'fault-tree', name: 'T', time_unit: 'd', horizon: 10, top: 'top',
  nodes: { top: { label: 'Top', gate: 'or', children: ['a'] }, a: { label: 'A', leaf: 'basic', p: 0.1 } } };
const tree = (doc) => ({ doc: doc || TREE, profile: 'fault-tree', catalog: null });

test('every exported function of the edit modules is used, excluded with a reason, or not an edit', () => {
  const mods = {
    'edit.js': require('../assets/js/edit.js'),
    'architecture-edit.js': AE,
    'architecture-links.js': require('../assets/js/architecture-links.js'),
    'clusters.js': require('../assets/js/clusters.js'),
    'comparison.js': require('../assets/js/comparison.js'),
  };
  for (const [file, mod] of Object.entries(mods)) {
    for (const name of Object.keys(mod)) {
      const where = [T.USES[file], Object.keys(T.EXCLUDED[file] || {}), T.NOT_EDIT[file]]
        .filter((list) => (list || []).includes(name)).length;
      assert.equal(where, 1, `${file} ${name}: say whether the agent uses it (and the agent?)`);
    }
    for (const reason of Object.values(T.EXCLUDED[file] || {})) assert.ok(reason.length > 10);
  }
});

test('every edit tool in the catalog has an operation', () => {
  for (const t of catalog.filter((t) => t.access === 'edit')) {
    for (const p of t.profiles) {
      const r = T.edit(t.name, {}, p === 'architecture' ? arch() : tree());
      assert.ok(r && (r.refused || r.doc), `${t.name} in ${p}`);
    }
  }
});

// Every list a tool takes, from its schema: a list, or also null.
function listsOf(tool) {
  return Object.entries(tool.schema.properties || {}).filter(([, s]) =>
    s.type === 'array' || (s.anyOf || []).some((a) => a.type === 'array')).map(([name]) => name);
}

test('every tool refuses bad input with a reason', () => {
  // A label alone makes a new asset, control or scenario: not bad for those.
  const bad = [{}, { id: 'nope' }, { id: 42 }, { parent: 'nope', label: '' }, { kind: 'spaceship', label: 'x' }, { collection: 'x', id: 'y' }];
  for (const t of catalog.filter((t) => t.access === 'edit')) {
    for (const p of t.profiles) {
      for (const input of bad) {
        if (input.kind && !(t.schema.properties || {}).kind && ['put_asset', 'put_control', 'put_scenario'].includes(t.name)) continue;
        const r = T.edit(t.name, input, p === 'architecture' ? arch() : tree());
        assert.equal(typeof r.refused, 'string', `${t.name}(${JSON.stringify(input)}) in ${p}`);
      }
      // A list given as anything else is refused, and says it is a list.
      for (const name of listsOf(t)) {
        for (const value of [{ node: 'a', ttc: 'exp(1)' }, 'a', 3]) {
          const r = T.edit(t.name, { id: 'a', [name]: value }, p === 'architecture' ? arch() : tree());
          assert.equal(r.refused, name + ' is a list', `${t.name}.${name} = ${JSON.stringify(value)} in ${p}`);
        }
      }
    }
  }
});

test('a wrong-typed list wipes nothing', () => {
  let d = T.edit('put_control', { label: 'Backup', effects: [{ node: 'a', ttc: 'exp(100)' }] }, tree()).doc;
  assert.equal(T.edit('put_control', { id: 'backup', effects: { node: 'a', ttc: 'exp(1)' } }, tree(d)).refused, 'effects is a list');
  d = T.edit('add_entity', { kind: 'host', label: 'H' }, arch()).doc;
  d = T.edit('set_attacker', { footholds: [{ entity: 'h', state: 'access' }] }, arch(d)).doc;
  assert.equal(T.edit('set_attacker', { footholds: { entity: 'h', state: 'access' } }, arch(d)).refused, 'footholds is a list');
});

test('add_entity then set_entity then link, as the agent would populate from a scan', () => {
  let r = T.edit('add_entity', { kind: 'host', label: 'Web 1', addresses: ['10.0.0.5'] }, arch());
  assert.equal(r.select, 'entity/web-1');
  assert.deepEqual(r.doc.entities['web-1'].addresses, ['10.0.0.5']);
  assert.match(r.said, /host/);
  r = T.edit('add_entity', { kind: 'service', label: 'sshd' }, arch(r.doc));
  assert.deepEqual(Object.keys(r.doc.entities.sshd.parameters), ['find-exploit', 'deploy-exploit']);
  r = T.edit('set_entity', { id: 'sshd', parameters: { 'find-exploit': { status: 'assumed', ttc: 'exp(5)', note: 'CVE-2024-6387' } }, defenses: { patched: false } }, arch(r.doc));
  assert.equal(r.doc.entities.sshd.parameters['find-exploit'].note, 'CVE-2024-6387');
  assert.equal(r.doc.entities.sshd.defenses.patched, false);
  r = T.edit('link', { kind: 'hosts', from: 'web-1', to: 'sshd', privilege: 'root' }, arch(r.doc));
  assert.equal(r.select, 'association/web-1-hosts-sshd');
});

test('a tool on an unknown id says which id', () => {
  const r = T.edit('set_entity', { id: 'ghost', label: 'x' }, arch());
  assert.match(r.refused, /ghost/);
});

test('set_entity with nothing to change says so', () => {
  const d = T.edit('add_entity', { kind: 'host', label: 'H' }, arch()).doc;
  assert.equal(T.edit('set_entity', { id: 'h', label: 'H' }, arch(d)).refused, 'that changes nothing');
});

test('tree: add_node, set_node gate and probability, link, delete', () => {
  let r = T.edit('add_node', { parent: 'top', label: 'Power loss' }, tree());
  assert.equal(r.select, 'power-loss');
  r = T.edit('set_node', { id: 'top', gate: 'vote', k: 2 }, tree(r.doc));
  assert.deepEqual([r.doc.nodes.top.gate, r.doc.nodes.top.k], ['vote', 2]);
  r = T.edit('set_node', { id: 'power-loss', p: 0.02 }, tree(r.doc));
  assert.equal(r.doc.nodes['power-loss'].p, 0.02);
  r = T.edit('set_node', { id: 'power-loss', rate: 0.5 }, tree(r.doc));
  assert.equal(r.doc.nodes['power-loss'].p, undefined, 'p, rate and ttc are one quantity');
  r = T.edit('delete_node', { id: 'power-loss' }, tree(r.doc));
  assert.equal(r.doc.nodes['power-loss'], undefined);
});

test('put_control writes effects whole and toggles enabled', () => {
  let r = T.edit('put_control', { label: 'Backup power', cost: 500, enabled: true, effects: [{ node: 'a', ttc: 'exp(100)' }] }, tree());
  const c = r.doc.controls['backup-power'];
  assert.deepEqual([c.cost, c.enabled, c.effects], [500, true, [{ node: 'a', ttc: 'exp(100)' }]]);
  r = T.edit('put_control', { id: 'backup-power', effects: [] }, tree(r.doc));
  assert.deepEqual(r.doc.controls['backup-power'].effects, []);
});

test('scenarios: create, change, speed', () => {
  let d = T.edit('add_entity', { kind: 'service', label: 'sshd' }, arch()).doc;
  let r = T.edit('put_scenario', { label: 'Patch ssh' }, arch(d));
  const id = Object.keys(r.doc.scenarios)[0];
  r = T.edit('set_change', { scenario: id, target: { entity: 'sshd', defense: 'patched' }, value: true }, arch(r.doc));
  r = T.edit('set_speed', { scenario: id, speed: 2 }, arch(r.doc));
  assert.equal(r.doc.scenarios[id].attacker.speed, 2);
});

test('the input is never mutated and ctx.doc stays as it was', () => {
  const before = JSON.stringify(TREE);
  T.edit('add_node', { parent: 'top', label: 'X' }, tree());
  assert.equal(JSON.stringify(TREE), before);
});
