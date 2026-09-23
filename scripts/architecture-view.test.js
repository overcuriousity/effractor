const { test } = require('node:test');
const assert = require('node:assert/strict');
const V = require('../assets/js/architecture-view.js');
const G = require('../assets/js/graph.js');

function lecture() {
  return {
    profile: 'architecture',
    entities: {
      lan: { kind: 'network', label: 'Client network' },
      ws: { kind: 'host', label: 'Workstation' },
      srv: { kind: 'host', label: 'Server' },
      cli: { kind: 'application', label: 'SSH client' },
      sshd: { kind: 'service', label: 'SSH server', parameters: { login: { status: 'unknown' }, 'find-exploit': { status: 'illustrative', ttc: 'Zero', note: 'n' } }, defenses: { patched: false } },
      fw: { kind: 'firewall', label: 'Firewall' },
    },
    associations: {
      a1: { kind: 'attached', from: 'ws', to: 'lan' },
      h1: { kind: 'hosts', from: 'ws', to: 'cli', privilege: 'user' },
      h2: { kind: 'hosts', from: 'srv', to: 'sshd', privilege: 'admin' },
      p1: { kind: 'permits', from: 'fw', to: 'ssh', allowed: true },
      bad: { kind: 'hosts', from: 'ghost', to: 'sshd', privilege: 'user' },
    },
    flows: { ssh: { label: 'SSH', source: 'cli', target: 'sshd', route: ['lan'], parameters: { connect: { status: 'unknown' } } } },
    attacker: { footholds: [{ entity: 'ws', state: 'admin' }], target: { entity: 'srv', state: 'admin' } },
    scenarios: {},
  };
}

test('an empty architecture draws nothing', () => {
  assert.deepEqual(V.describe({ profile: 'architecture', entities: {}, associations: {}, flows: {}, attacker: { footholds: [] } }), { profile: 'architecture', nodes: [], edges: [] });
});

test('components are neutral boxes with their kind, qualified ids and no fault symbols', () => {
  const g = V.describe(lecture());
  assert.equal(g.profile, 'architecture');
  assert.deepEqual(g.nodes.map(n => n.id), ['entity/lan', 'entity/ws', 'entity/srv', 'entity/cli', 'entity/sshd', 'entity/fw']);
  const sshd = g.nodes[4];
  assert.equal(sshd.symbol, 'component');
  assert.equal(sshd.component, 'service');
  assert.equal(sshd.label, 'SSH server');
  assert.deepEqual(sshd.lines, ['SSH server']);
  assert.equal(sshd.inscription, null);
  assert.equal(sshd.attributes, 'service · 1 unknown');
  assert.equal(sshd.unquantified, true);
  assert.equal(sshd.top, false);
  const lan = g.nodes[0];
  assert.equal(lan.attributes, 'network');
  assert.equal(lan.unquantified, false);
});

test('foothold and target are badges', () => {
  const g = V.describe(lecture());
  assert.equal(g.nodes[1].badge, 'foothold · admin');
  assert.equal(g.nodes[2].badge, 'target · admin');
  assert.equal(g.nodes[0].badge, null);
});

test('associations between components and flows are the edges; permits and dangling ones are not', () => {
  const g = V.describe(lecture());
  assert.deepEqual(g.edges, [
    { id: 'association/a1', from: 'entity/ws', to: 'entity/lan', kind: 'attached', label: 'attached' },
    { id: 'association/h1', from: 'entity/ws', to: 'entity/cli', kind: 'hosts', label: 'hosts · user' },
    { id: 'association/h2', from: 'entity/srv', to: 'entity/sshd', kind: 'hosts', label: 'hosts · admin' },
    { id: 'flow/ssh', from: 'entity/cli', to: 'entity/sshd', kind: 'flow', label: 'SSH →' },
  ]);
  assert.equal(g.nodes.find(n => n.id === 'entity/sshd').parents, 2);
});

test('an administration link is drawn from the managed machine to where it is managed from', () => {
  const doc = lecture();
  doc.entities.mgmt = { kind: 'network', label: 'Mgmt' };
  doc.associations.m1 = { kind: 'administration', from: 'mgmt', to: 'srv' };
  const edge = V.describe(doc).edges.find(e => e.id === 'association/m1');
  assert.deepEqual(edge, { id: 'association/m1', from: 'entity/srv', to: 'entity/mgmt', kind: 'administration', label: 'managed from' });
});

test('ids that are object keys elsewhere are just ids', () => {
  const doc = { profile: 'architecture', entities: Object.create(null), associations: {}, flows: {}, attacker: { footholds: [] } };
  doc.entities.constructor = { kind: 'host', label: 'C' };
  doc.entities.__proto__ = { kind: 'host', label: 'P' };
  assert.deepEqual(V.describe(doc).nodes.map(n => n.id), ['entity/constructor', 'entity/__proto__']);
});

test('a component is laid out as its box and kind strip, with no stem or symbol', () => {
  const node = V.describe(lecture()).nodes[0];
  const elk = G.toElk({ nodes: [node], edges: [] });
  assert.equal(elk.children[0].height, G.SIZE.box + G.SIZE.strip);
  assert.equal(elk.children[0].ports.find(p => p.id.endsWith(':out')).y, G.SIZE.box + G.SIZE.strip);
});
