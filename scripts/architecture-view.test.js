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
  const d = V.describe({ profile: 'architecture', entities: {}, associations: {}, flows: {}, attacker: { footholds: [] } });
  assert.equal(d.profile, 'architecture');
  assert.deepEqual([d.nodes, d.edges, d.permits, d.groups], [[], [], [], []]);
  assert.deepEqual([Object.keys(d.hidden), Object.keys(d.bundles)], [[], []]);
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
  assert.deepEqual(g.nodes[1].pins, [{ role: 'foothold', state: 'admin', entity: 'ws', word: 'admin' }]);
  assert.deepEqual(g.nodes[2].pins, [{ role: 'target', state: 'admin', entity: 'srv', word: 'admin' }]);
  assert.deepEqual(g.nodes[0].pins, []);
  // One component may be both; each pin is its own.
  const both = lecture();
  both.attacker.target = { entity: both.attacker.footholds[0].entity, state: 'user' };
  assert.deepEqual(V.describe(both).nodes[1].pins, [{ role: 'foothold', state: 'admin', entity: 'ws', word: 'admin' }, { role: 'target', state: 'user', entity: 'ws', word: 'user' }]);
  const worded = V.describe(both, s => s + ' control').nodes[1].pins;
  assert.deepEqual(worded.map(p => p.word), ['admin control', 'user control']);
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

test('an escape is shown only on a hosted host or router', () => {
  const doc = {
    profile: 'architecture',
    entities: {
      hv: { kind: 'host', label: 'HV', parameters: { escape: { status: 'unknown' } } },
      vm: { kind: 'host', label: 'VM', parameters: { escape: { status: 'unknown' } } },
    },
    associations: { 'hv-vm': { kind: 'hosts', from: 'hv', to: 'vm', privilege: 'user' } },
    flows: {},
    attacker: { footholds: [] },
  };
  assert.deepEqual(V.shownSlots(doc, 'hv'), []);
  assert.deepEqual(V.shownSlots(doc, 'vm'), ['escape']);
  const nodes = V.describe(doc).nodes;
  assert.equal(nodes.find((n) => n.id === 'entity/hv').unknown, 0);
  assert.equal(nodes.find((n) => n.id === 'entity/vm').unknown, 1);
});

test('the new links are said in plain words along the arrow', () => {
  const doc = {
    profile: 'architecture',
    entities: {
      s: { kind: 'service', label: 'S' }, p: { kind: 'product', label: 'P' }, a: { kind: 'account', label: 'A' },
      b: { kind: 'account', label: 'B' }, k: { kind: 'credential', label: 'K' }, seed: { kind: 'credential', label: 'Seed' },
      ada: { kind: 'person', label: 'Ada' }, app: { kind: 'application', label: 'App' }, net: { kind: 'network', label: 'Net' },
    },
    associations: {
      i: { kind: 'instance-of', from: 's', to: 'p' },
      r: { kind: 'runs-as', from: 's', to: 'a', privilege: 'user' },
      m: { kind: 'assumes', from: 'a', to: 'b' },
      k1: { kind: 'authenticates', from: 'k', to: 'a' },
      k2: { kind: 'authenticates', from: 'seed', to: 'a', factor: 'second' },
      kn: { kind: 'knows', from: 'ada', to: 'k' },
      op: { kind: 'operates', from: 'ada', to: 'app' },
      d: { kind: 'delivers', from: 'net', to: 'ada' },
    },
    flows: {},
    attacker: { footholds: [] },
  };
  const said = Object.fromEntries(V.describe(doc).edges.map((e) => [e.id.split('/')[1], e.label]));
  assert.deepEqual(said, {
    i: 'is an instance of', r: 'runs as · user', m: 'may become', k1: 'authenticates',
    k2: 'second factor for', kn: 'knows', op: 'uses', d: 'reaches',
  });
});

test('take-over and its guard are shown only on software content reaches', () => {
  const software = { parameters: { 'take-over': { status: 'unknown' }, 'take-over-guarded': { status: 'unknown' } }, defenses: { guarded: 'unknown' } };
  const doc = {
    entities: {
      net: { kind: 'network', label: 'Internet' },
      bot: Object.assign({ kind: 'service', label: 'Bot' }, software),
      cli: Object.assign({ kind: 'application', label: 'Client' }, software),
    },
    associations: { tickets: { kind: 'delivers', from: 'net', to: 'bot' } },
    flows: {},
  };
  assert.deepEqual(V.shownSlots(doc, 'bot'), ['take-over', 'take-over-guarded']);
  assert.equal(V.shownDefense(doc, 'bot'), 'guarded');
  assert.deepEqual(V.shownSlots(doc, 'cli'), []);
  assert.equal(V.shownDefense(doc, 'cli'), null);
  // What is not shown is not counted as unknown on the canvas.
  const drawn = V.describe(doc).nodes;
  assert.equal(drawn.find((n) => n.id === 'entity/cli').unknown, 0);
  assert.equal(drawn.find((n) => n.id === 'entity/bot').unknown, 2);
});

test('contained software says so on its hosting line', () => {
  const doc = lecture();
  doc.associations.h1.contained = true;
  const edges = V.describe(doc).edges;
  assert.equal(edges.find((e) => e.id === 'association/h1').label, 'hosts · user · contained');
  assert.equal(edges.find((e) => e.id === 'association/h2').label, 'hosts · admin');
});

test('software that reads data processes content; data links read in plain words', () => {
  const software = { parameters: { 'take-over': { status: 'unknown' }, 'take-over-guarded': { status: 'unknown' } }, defenses: { guarded: 'unknown' } };
  const doc = {
    entities: {
      bot: Object.assign({ kind: 'service', label: 'Bot' }, software),
      docs: { kind: 'data', label: 'Docs', defenses: { encrypted: false } },
      key: { kind: 'credential', label: 'Key' },
      ops: { kind: 'account', label: 'Ops' },
    },
    associations: {
      r: { kind: 'reads', from: 'bot', to: 'docs' },
      h: { kind: 'holds', from: 'bot', to: 'docs', privilege: 'user', decrypts: false },
      a: { kind: 'accesses', from: 'ops', to: 'docs', mode: 'read' },
      k: { kind: 'encrypted-with', from: 'docs', to: 'key' },
    },
    flows: {},
  };
  assert.deepEqual(V.shownSlots(doc, 'bot'), ['take-over', 'take-over-guarded']);
  assert.equal(V.shownDefense(doc, 'bot'), 'guarded');
  const label = (id) => V.describe(doc).edges.find((e) => e.id === 'association/' + id).label;
  assert.equal(label('r'), 'reads');
  assert.equal(label('h'), 'holds · ciphertext only');
  assert.equal(label('a'), 'may read');
  assert.equal(label('k'), 'encrypted with');
});

test('an unpatched product rings red, and so do the software running it and its host', () => {
  const doc = {
    profile: 'architecture',
    entities: {
      web: { kind: 'host', label: 'web-01' },
      https: { kind: 'service', label: 'https' },
      admin: { kind: 'application', label: 'admin panel' },
      nginx: { kind: 'product', label: 'nginx 1.4.6', parameters: { 'find-exploit': { status: 'unknown', note: 'nmap ssl-heartbleed: VULNERABLE, CVE-2014-0160 (The Heartbleed Bug).' } }, defenses: { patched: false } },
      php: { kind: 'product', label: 'PHP 5.3', parameters: { 'find-exploit': { status: 'unknown' } }, defenses: { patched: false } },
      other: { kind: 'host', label: 'other' },
      ssh: { kind: 'service', label: 'ssh' },
      openssh: { kind: 'product', label: 'OpenSSH 9.6p1', defenses: { patched: 'unknown' } },
      fixed: { kind: 'product', label: 'fixed', defenses: { patched: true } },
    },
    associations: {
      h1: { kind: 'hosts', from: 'web', to: 'https', privilege: 'unknown' },
      h2: { kind: 'hosts', from: 'web', to: 'admin', privilege: 'user' },
      h3: { kind: 'hosts', from: 'other', to: 'ssh', privilege: 'unknown' },
      i1: { kind: 'instance-of', from: 'https', to: 'nginx' },
      i2: { kind: 'instance-of', from: 'admin', to: 'php' },
      i3: { kind: 'instance-of', from: 'ssh', to: 'openssh' },
    },
    flows: {},
    attacker: { footholds: [] },
    scenarios: {},
  };
  const rings = Object.fromEntries(V.describe(doc).nodes.map(n => [n.id.slice(7), n.rings]));
  const nginx = 'vulnerable: nginx 1.4.6 unpatched\nnmap ssl-heartbleed: VULNERABLE, CVE-2014-0160 (The Heartbleed Bug).';
  assert.deepEqual(rings.nginx, [{ state: 'vulnerable', why: nginx }]);
  assert.deepEqual(rings.https, [{ state: 'vulnerable', why: nginx }]);
  assert.deepEqual(rings.web, [{ state: 'vulnerable', why: nginx + '\nvulnerable: PHP 5.3 unpatched' }]);
  for (const id of ['other', 'ssh', 'openssh', 'fixed']) assert.deepEqual(rings[id], [], id);
});

const Clusters = require('../assets/js/clusters.js');
const IMPORTED = require('./fixtures/nmap/imported.doc.json');

test('a closed cluster is one node; its lines go to it, merged, and inner ones hide', () => {
  const doc = Clusters.build(IMPORTED).doc;
  const d = V.describe(doc);
  const ids = d.nodes.map((n) => n.id);
  assert.ok(ids.includes('cluster/srv'));
  assert.equal(ids.includes('entity/sshd'), false);
  assert.equal(d.hidden.sshd, 'cluster/srv');
  const srv = d.nodes.find((n) => n.id === 'cluster/srv');
  assert.equal(srv.component, 'host');
  assert.equal(srv.cluster.count, 6);
  const plain = V.describe(IMPORTED).nodes;
  assert.equal(srv.unknown, doc.clusters.srv.members.reduce((s, m) => s + plain.find((n) => n.id === 'entity/' + m).unknown, 0));
  assert.equal(srv.symbol, 'component');
  // No line inside one closed cluster; every line's ends are drawn nodes.
  for (const e of d.edges) {
    assert.notEqual(e.from, e.to);
    assert.ok(ids.includes(e.from) && ids.includes(e.to), e.id);
  }
  // Lines between the same drawn ends, same direction: one, counted.
  const merged = d.edges.filter((e) => /^(links|flows)\//.test(e.id));
  assert.ok(merged.length > 0);
  for (const m of merged) {
    assert.match(m.label, /^\d+ (links|flows)$/);
    assert.equal(d.bundles[m.id].length, Number(m.label.split(' ')[0]));
  }
  // openssh is used on srv and printer: it stays, with lines from both clusters.
  assert.ok(ids.includes('entity/openssh'));
  const intoOpenssh = d.edges.filter((e) => e.to === 'entity/openssh').map((e) => e.from).sort();
  assert.deepEqual(intoOpenssh, ['cluster/printer', 'cluster/srv']);
});

test('an open cluster draws its members and an outline', () => {
  const doc = Clusters.build(IMPORTED).doc;
  doc.clusters.srv.closed = false;
  const d = V.describe(doc);
  assert.ok(d.nodes.some((n) => n.id === 'entity/sshd'));
  assert.deepEqual(d.groups, [{ id: 'cluster/srv', label: Clusters.label(doc, 'srv'), members: doc.clusters.srv.members.map((m) => 'entity/' + m) }]);
  assert.equal(d.hidden.sshd, undefined);
});

test('ring sectors carry each member state; pins keep their member', () => {
  const doc = Clusters.build(IMPORTED).doc;
  doc.entities['dnsmasq-2-90'].defenses = { patched: false };
  doc.attacker = { footholds: [{ entity: 'sshd', state: 'admin' }] };
  const srv = V.describe(doc).nodes.find((n) => n.id === 'cluster/srv');
  const at = (m) => srv.cluster.states[doc.clusters.srv.members.indexOf(m)];
  assert.equal(at('dnsmasq-2-90'), 'vulnerable');
  assert.equal(at('domain'), 'vulnerable', 'the software running it');
  assert.equal(at('srv'), 'vulnerable', 'and the host');
  assert.ok(srv.rings.some((r) => r.state === 'vulnerable'));
  assert.deepEqual(srv.pins.map((p) => [p.entity, p.role]), [['sshd', 'foothold']]);
});

test('permissions start at the firewall’s cluster and end at a cluster holding the flow', () => {
  const doc = JSON.parse(JSON.stringify(require('./fixtures/architecture.doc.json')));
  doc.clusters = {
    edge: { members: ['bridge', 'filter'], closed: true },
    servers: { members: ['server', 'sshd'], closed: true },
  };
  const d = V.describe(doc);
  assert.equal(d.permits.length, 1);
  assert.equal(d.permits[0].firewall, 'cluster/edge');
  assert.equal(d.permits[0].node, 'cluster/servers', 'the flow’s target is inside');
  // The firewall outside, the flow untouched: on the flow's line as before.
  doc.clusters = { servers: { members: ['server', 'openssh'], closed: true } };
  const plain = V.describe(doc).permits[0];
  assert.equal(plain.firewall, 'entity/filter');
  assert.equal(plain.flow, 'flow/ssh');
  // Firewall and the whole flow in one cluster: nothing to draw.
  doc.clusters = { all: { members: ['bridge', 'filter', 'ssh-client', 'sshd', 'workstation', 'server'], closed: true } };
  assert.deepEqual(V.describe(doc).permits, []);
});

test('a closed cluster with a member beside it: both inside one outline', () => {
  const doc = Clusters.peel(Clusters.build(IMPORTED).doc, 'srv', 'domain').doc;
  const d = V.describe(doc);
  const ids = d.nodes.map((n) => n.id);
  assert.ok(ids.includes('cluster/srv') && ids.includes('entity/domain'));
  assert.equal(d.hidden.domain, undefined);
  assert.equal(d.hidden.sshd, 'cluster/srv');
  assert.equal(d.nodes.find((n) => n.id === 'cluster/srv').cluster.count, 5, 'the stack holds the rest');
  assert.deepEqual(d.groups, [{ id: 'cluster/srv', label: Clusters.label(doc, 'srv'), members: ['cluster/srv', 'entity/domain'] }]);
  // Its line to the stack shows; nothing is drawn from a node to itself.
  assert.ok(d.edges.some((e) => e.from === 'cluster/srv' && e.to === 'entity/domain'));
});
