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
  assert.deepEqual(V.describe({ profile: 'architecture', entities: {}, associations: {}, flows: {}, attacker: { footholds: [] } }), { profile: 'architecture', nodes: [], edges: [], permits: [] });
});

test('components are icons of their kind, with qualified ids and no fault symbols', () => {
  const g = V.describe(lecture());
  assert.equal(g.profile, 'architecture');
  assert.deepEqual(g.nodes.map(n => n.id), ['entity/lan', 'entity/ws', 'entity/srv', 'entity/cli', 'entity/sshd', 'entity/fw']);
  const sshd = g.nodes[4];
  assert.equal(sshd.symbol, 'component');
  assert.equal(sshd.component, 'service');
  assert.equal(sshd.label, 'SSH server');
  assert.deepEqual(sshd.lines, ['SSH server']);
  assert.equal(sshd.inscription, null);
  assert.equal(sshd.attributes, null);
  assert.equal(sshd.unknown, 1);
  assert.equal(sshd.unquantified, true);
  assert.equal(sshd.top, false);
  const lan = g.nodes[0];
  assert.equal(lan.unknown, 0);
  assert.equal(lan.unquantified, false);
});

test('footholds and the target are pins on their components', () => {
  const g = V.describe(lecture());
  assert.deepEqual(g.nodes[1].pins, [{ role: 'foothold', state: 'admin' }]);
  assert.deepEqual(g.nodes[2].pins, [{ role: 'target', state: 'admin' }]);
  assert.deepEqual(g.nodes[0].pins, []);
  // One component may be both; each pin is its own.
  const both = lecture();
  both.attacker.target = { entity: both.attacker.footholds[0].entity, state: 'user' };
  assert.deepEqual(V.describe(both).nodes[1].pins, [{ role: 'foothold', state: 'admin' }, { role: 'target', state: 'user' }]);
});

test('associations between components and flows are the edges; permits and dangling ones are not', () => {
  const g = V.describe(lecture());
  assert.deepEqual(g.edges, [
    { id: 'association/a1', from: 'entity/ws', to: 'entity/lan', kind: 'attached', label: 'attached', title: 'attached' },
    { id: 'association/h1', from: 'entity/ws', to: 'entity/cli', kind: 'hosts', label: 'hosts · user', title: 'hosts · user' },
    { id: 'association/h2', from: 'entity/srv', to: 'entity/sshd', kind: 'hosts', label: 'hosts · admin', title: 'hosts · admin' },
    // The arrowhead gives the direction; the name does not repeat it.
    { id: 'flow/ssh', from: 'entity/cli', to: 'entity/sshd', kind: 'flow', label: 'SSH', title: 'flow' },
  ]);
  assert.equal(g.nodes.find(n => n.id === 'entity/sshd').parents, 2);
});

test('an administration link is drawn from the managed machine to where it is managed from', () => {
  const doc = lecture();
  doc.entities.mgmt = { kind: 'network', label: 'Mgmt' };
  doc.associations.m1 = { kind: 'administration', from: 'mgmt', to: 'srv' };
  const edge = V.describe(doc).edges.find(e => e.id === 'association/m1');
  assert.deepEqual(edge, { id: 'association/m1', from: 'entity/srv', to: 'entity/mgmt', kind: 'administration', label: 'managed from', title: 'administration' });
});

test('ids that are object keys elsewhere are just ids', () => {
  const doc = { profile: 'architecture', entities: Object.create(null), associations: {}, flows: {}, attacker: { footholds: [] } };
  doc.entities.constructor = { kind: 'host', label: 'C' };
  doc.entities.__proto__ = { kind: 'host', label: 'P' };
  assert.deepEqual(V.describe(doc).nodes.map(n => n.id), ['entity/constructor', 'entity/__proto__']);
});

test('a component is laid out as its plate and name, with no stem or symbol', () => {
  const node = V.describe(lecture()).nodes[0];
  const elk = G.toElk({ nodes: [node], edges: [] });
  assert.equal(elk.children[0].height, G.SIZE.component);
  assert.equal(elk.children[0].ports.find(p => p.id.endsWith(':out')).y, G.SIZE.component);
});

test('a firewall\'s permission is carried to be drawn to the flow it rules on, never as an edge', () => {
  const g = V.describe(lecture());
  assert.deepEqual(g.permits, [{ id: 'association/p1', firewall: 'entity/fw', flow: 'flow/ssh', allowed: true }]);
  assert.ok(!g.edges.some(e => e.id === 'association/p1'));
  const doc = lecture();
  doc.associations.p1.allowed = 'unknown';
  doc.associations.p2 = { kind: 'permits', from: 'fw', to: 'gone', allowed: true };
  assert.deepEqual(V.describe(doc).permits, [{ id: 'association/p1', firewall: 'entity/fw', flow: 'flow/ssh', allowed: null }]);
});

test('relations that read backwards along their arrow are said the way it runs; the file term is the tooltip', () => {
  const doc = lecture();
  doc.entities.acct = { kind: 'account', label: 'Admin' };
  doc.entities.r = { kind: 'router', label: 'R' };
  doc.associations.z1 = { kind: 'authorizes', from: 'acct', to: 'sshd' };
  doc.associations.z2 = { kind: 'grants', from: 'acct', to: 'srv', privilege: 'admin' };
  doc.associations.z3 = { kind: 'filters', from: 'r', to: 'fw' };
  const said = Object.fromEntries(V.describe(doc).edges.map(e => [e.id, [e.label, e.title]]));
  assert.deepEqual(said['association/z1'], ['may log in to', 'authorizes']);
  assert.deepEqual(said['association/z2'], ['admin on', 'grants · admin']);
  assert.deepEqual(said['association/z3'], ['filtered by', 'filters']);
});

test('a flow\'s route is the networks and routers it passes through', () => {
  const doc = lecture();
  doc.flows.ssh.route = ['lan', 'ghost'];
  assert.deepEqual(V.route(doc, 'ssh'), ['entity/lan']);
  assert.deepEqual(V.route(doc, 'none'), []);
});
