const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../assets/js/architecture-edit.js');
const L = require('../assets/js/architecture-links.js');
const LECTURE = require('./fixtures/architecture.doc.json');

const lecture = () => JSON.parse(JSON.stringify(LECTURE));
const SPEC = {
  network: { parameters: [] }, router: { parameters: [] }, firewall: { parameters: [] }, host: { parameters: [] },
  application: { parameters: [] }, account: { parameters: ['admin-login'] },
  service: { parameters: ['find-exploit', 'find-exploit-patched', 'deploy-exploit', 'login'], defense: 'patched' },
  credential: { parameters: ['extract', 'extract-protected'], defense: 'protected' },
};

test('footholds and the target are explicit states', () => {
  let doc = E.empty();
  doc = E.addEntity(doc, 'host', 'Workstation', { parameters: [] }).doc;
  doc = L.setFoothold(doc, 'workstation', 'admin', true).doc;
  doc = L.setTarget(doc, 'workstation', 'admin').doc;
  assert.deepEqual(doc.attacker.footholds, [{ entity: 'workstation', state: 'admin' }]);
  assert.deepEqual(doc.attacker.target, { entity: 'workstation', state: 'admin' });
  assert.equal(L.setFoothold(doc, 'workstation', 'admin', true), null, 'already a foothold');
  doc = L.setFoothold(doc, 'workstation', 'user', true).doc;
  doc = L.setFoothold(doc, 'workstation', 'admin', false).doc;
  assert.deepEqual(doc.attacker.footholds, [{ entity: 'workstation', state: 'user' }]);
  doc = L.setTarget(doc, 'workstation', null).doc;
  assert.equal('target' in doc.attacker, false);
  assert.equal(L.setTarget(doc, 'absent', 'admin'), null);
});

// The lecture architecture, built only through the editor's functions,
// comes out as the documentation fixture — which a Rust test holds to be
// what the format reads from docs/course/lecture-architecture.yaml.
test('the lecture architecture is built through links, flows and attacker states', () => {
  const want = lecture();
  let doc = E.empty();
  doc.name = want.name;
  for (const id of Object.keys(want.entities)) {
    const e = want.entities[id];
    const added = E.addEntity(doc, e.kind, e.label, SPEC[e.kind]);
    doc = added.doc;
    if (added.entity !== id) doc = L.renameId(doc, 'entities', added.entity, id).doc;
    if (e.description) doc = E.setDescription(doc, id, e.description).doc;
    for (const slot of Object.keys(e.parameters || {})) {
      if (e.parameters[slot].status !== 'unknown') doc = E.setParameter(doc, { entity: id }, slot, e.parameters[slot]).doc;
    }
    for (const d of Object.keys(e.defenses || {})) doc = E.setDefense(doc, id, d, e.defenses[d]).doc;
  }
  // Associations name a flow that is not there yet: the draft holds it, and
  // it is for the format to refuse until the flow exists.
  for (const id of Object.keys(want.associations)) doc = L.putAssociation(doc, id, want.associations[id]).doc;
  for (const id of Object.keys(want.flows)) {
    const f = want.flows[id];
    doc = L.putFlow(doc, id, { label: f.label, source: f.source, target: f.target, route: f.route, protocol: f.protocol }).doc;
    doc = E.setParameter(doc, { flow: id }, 'connect', f.parameters.connect).doc;
  }
  for (const s of want.attacker.footholds) doc = L.setFoothold(doc, s.entity, s.state, true).doc;
  doc = L.setTarget(doc, want.attacker.target.entity, want.attacker.target.state).doc;
  doc.scenarios = want.scenarios; // scenario editing is later work
  assert.deepEqual(doc, want);
  assert.deepEqual(Object.keys(doc.entities), Object.keys(want.entities));
  assert.deepEqual(Object.keys(doc.associations), Object.keys(want.associations));
  assert.deepEqual(Object.keys(doc.associations['service-hosting']), ['kind', 'from', 'to', 'privilege']);
  assert.deepEqual(Object.keys(doc.flows.ssh), ['label', 'source', 'target', 'route', 'protocol', 'parameters']);
});

test('an association keeps only what its kind carries, and a new one gets a free id', () => {
  let doc = lecture();
  const hosted = L.putAssociation(doc, null, { kind: 'hosts', from: 'server', to: 'sshd', privilege: 'user', allowed: true });
  assert.equal(hosted.select, 'association/server-hosts-sshd');
  assert.deepEqual(hosted.doc.associations['server-hosts-sshd'], { kind: 'hosts', from: 'server', to: 'sshd', privilege: 'user' });
  const again = L.putAssociation(hosted.doc, null, { kind: 'hosts', from: 'server', to: 'sshd', privilege: 'admin' });
  assert.equal(again.select, 'association/server-hosts-sshd-2');
  const permit = L.putAssociation(doc, 'allow-ssh', { kind: 'permits', from: 'filter', to: 'ssh', allowed: 'unknown' });
  assert.deepEqual(permit.doc.associations['allow-ssh'], { kind: 'permits', from: 'filter', to: 'ssh', allowed: 'unknown' });
  assert.deepEqual(Object.keys(permit.doc.associations), Object.keys(doc.associations), 'edited in place');
  assert.equal(L.putAssociation(doc, 'allow-ssh', doc.associations['allow-ssh']), null, 'nothing changes');
  assert.equal(L.putAssociation(doc, null, { kind: 'nonsense', from: 'a', to: 'b' }), null);
  // An extension on the record survives an edit of it.
  doc.associations['allow-ssh']['x-ticket'] = 'SEC-1';
  const kept = L.putAssociation(doc, 'allow-ssh', { kind: 'permits', from: 'filter', to: 'ssh', allowed: false });
  assert.equal(kept.doc.associations['allow-ssh']['x-ticket'], 'SEC-1');
});

test('a flow keeps its direction and route order, and adjacency permits nothing', () => {
  let doc = lecture();
  // Same zone: a one-network route, no router, so no permission asked for.
  let edit = L.putFlow(doc, null, { label: 'Local SSH', source: 'ssh-client', target: 'sshd', route: ['client-net'] });
  assert.equal(edit.select, 'flow/local-ssh');
  assert.deepEqual(edit.doc.flows['local-ssh'], {
    label: 'Local SSH', source: 'ssh-client', target: 'sshd', route: ['client-net'],
    parameters: { connect: { status: 'unknown' } },
  });
  assert.deepEqual(edit.doc.associations, doc.associations, 'no permission is invented');
  // Two routers: the route is kept as given.
  const route = ['client-net', 'bridge', 'server-net', 'edge', 'dmz'];
  edit = L.putFlow(doc, 'ssh', { label: 'SSH', source: 'ssh-client', target: 'sshd', route, protocol: 'tcp/22' });
  assert.deepEqual(edit.doc.flows.ssh.route, route);
  assert.deepEqual(edit.doc.flows.ssh.parameters, doc.flows.ssh.parameters, 'the connect parameter stays');
  assert.equal(edit.doc.flows.ssh.source, 'ssh-client');
  assert.equal(edit.doc.flows.ssh.target, 'sshd');
  // A draft may be partial; the format says what is missing.
  edit = L.putFlow(doc, null, { label: 'Half', source: 'ssh-client', target: '', route: [] });
  assert.deepEqual(edit.doc.flows.half, { label: 'Half', source: 'ssh-client', target: '', route: [], parameters: { connect: { status: 'unknown' } } });
  assert.equal(L.putFlow(doc, null, { label: '  ', source: 'a', target: 'b', route: [] }), null);
});

test('deleting a service removes what named it and nothing else', () => {
  const doc = lecture();
  const edit = L.remove(doc, 'entities', 'sshd');
  const d = edit.doc;
  assert.equal('sshd' in d.entities, false);
  assert.deepEqual(Object.keys(d.entities), Object.keys(doc.entities).filter((k) => k !== 'sshd'));
  // hosting, authorization, the flow to it and the flow's permission
  for (const gone of ['service-hosting', 'ssh-authorizes', 'allow-ssh']) assert.equal(gone in d.associations, false, gone);
  assert.equal('ssh' in d.flows, false);
  assert.equal('server-grant' in d.associations, true);
  // Scenario changes on removed things go; the scenarios stay, an empty one too.
  assert.deepEqual(Object.keys(d.scenarios), ['patch', 'protect', 'both', 'deny']);
  assert.deepEqual(d.scenarios.patch.changes, []);
  assert.deepEqual(d.scenarios.both.changes, [{ entity: 'server-key', defense: 'protected', value: true }]);
  assert.deepEqual(d.scenarios.deny.changes, []);
  assert.equal(edit.select, null);
  assert.match(edit.notice, /^deleted “SSH server” and 4 links · Ctrl\+Z undoes$/);
  assert.deepEqual(doc, lecture(), 'the input is not changed');
});

test('deleting a host leaves its software unhosted, not moved', () => {
  const d = L.remove(lecture(), 'entities', 'server').doc;
  assert.equal('service-hosting' in d.associations, false);
  assert.equal('server-net-link' in d.associations, false);
  assert.equal('server-grant' in d.associations, false);
  assert.equal('sshd' in d.entities, true);
  assert.equal(Object.values(d.associations).some((a) => a.to === 'sshd' && a.kind === 'hosts'), false);
  assert.equal('target' in d.attacker, false, 'the target was server.admin');
});

test('deleting a route network deletes the flows over it, not just the hop', () => {
  const d = L.remove(lecture(), 'entities', 'server-net').doc;
  assert.equal('ssh' in d.flows, false);
  assert.equal('allow-ssh' in d.associations, false);
  assert.equal('bridge-server' in d.associations, false);
});

test('deleting a flow or a permission takes its references along', () => {
  let d = L.remove(lecture(), 'flows', 'ssh').doc;
  assert.equal('allow-ssh' in d.associations, false);
  assert.deepEqual(d.scenarios.deny.changes, []);
  const unlinked = L.remove(lecture(), 'associations', 'ssh-authorizes');
  assert.equal(unlinked.notice, 'deleted “authorizes Server account → SSH server” · Ctrl+Z undoes');
  d = L.remove(lecture(), 'associations', 'allow-ssh').doc;
  assert.equal('ssh' in d.flows, true);
  assert.deepEqual(d.scenarios.deny.changes, []);
  assert.equal(L.remove(lecture(), 'entities', 'absent'), null);
  assert.equal(L.remove(lecture(), 'nodes', 'sshd'), null);
});

test('detaching a machine from a network deletes the flows whose route needs it', () => {
  for (const link of ['workstation-net', 'server-net-link', 'bridge-client', 'bridge-server']) {
    const edit = L.remove(lecture(), 'associations', link);
    assert.equal('ssh' in edit.doc.flows, false, link);
    assert.equal('allow-ssh' in edit.doc.associations, false, link);
    assert.match(edit.notice, / and 2 links · /, link);
  }
  // An attachment no route uses takes nothing along.
  const doc = lecture();
  doc.associations['server-admin-net'] = { kind: 'attached', from: 'server', to: 'admin-net' };
  const edit = L.remove(doc, 'associations', 'server-admin-net');
  assert.equal('ssh' in edit.doc.flows, true);
  assert.doesNotMatch(edit.notice, /links?/);
});

test('an unlinked component is deleted alone, and says so', () => {
  let doc = E.addEntity(E.empty(), 'host', 'Workstation', { parameters: [] }).doc;
  doc = E.addEntity(doc, 'host', 'Spare', { parameters: [] }).doc;
  const gone = L.remove(doc, 'entities', 'spare');
  assert.deepEqual(Object.keys(gone.doc.entities), ['workstation']);
  assert.equal(gone.select, null);
  assert.equal(gone.notice, 'deleted “Spare” · Ctrl+Z undoes');
});

test('a flow counts once however often its route passes a network', () => {
  const doc = E.empty();
  for (const id of ['c', 's', 'n', 'r']) doc.entities[id] = { kind: 'host', label: id };
  doc.flows.f = { label: 'F', source: 'c', target: 's', route: ['n', 'r', 'n'], parameters: {} };
  assert.match(L.remove(doc, 'entities', 'n').notice, / and 1 link · /);
});

test('deleting the foothold removes only the foothold', () => {
  const d = L.remove(lecture(), 'entities', 'workstation').doc;
  assert.deepEqual(d.attacker.footholds, []);
  assert.deepEqual(d.attacker.target, { entity: 'server', state: 'admin' });
});

test('renaming an id rewrites every reference and keeps map order', () => {
  const doc = lecture();
  const edit = L.renameId(doc, 'entities', 'server', 'production-server');
  const d = edit.doc;
  assert.equal(edit.select, 'entity/production-server');
  assert.deepEqual(Object.keys(d.entities), Object.keys(doc.entities).map((k) => (k === 'server' ? 'production-server' : k)));
  assert.equal(d.associations['server-net-link'].from, 'production-server');
  assert.equal(d.associations['service-hosting'].from, 'production-server');
  assert.equal(d.associations['server-grant'].to, 'production-server');
  assert.deepEqual(d.attacker.target, { entity: 'production-server', state: 'admin' });
  assert.equal(d.entities['production-server'].label, 'Server', 'the label is not the id');

  const net = L.renameId(doc, 'entities', 'server-net', 'backend').doc;
  assert.deepEqual(net.flows.ssh.route, ['client-net', 'bridge', 'backend']);
  const key = L.renameId(doc, 'entities', 'sshd', 'openssh').doc;
  assert.equal(key.flows.ssh.target, 'openssh');
  assert.deepEqual(key.scenarios.patch.changes[0], { entity: 'openssh', defense: 'patched', value: true });

  const flow = L.renameId(doc, 'flows', 'ssh', 'admin-ssh').doc;
  assert.equal(flow.associations['allow-ssh'].to, 'admin-ssh');
  assert.deepEqual(Object.keys(flow.flows), ['admin-ssh']);
  const permit = L.renameId(doc, 'associations', 'allow-ssh', 'ssh-rule').doc;
  assert.deepEqual(permit.scenarios.deny.changes[0], { association: 'ssh-rule', field: 'allowed', value: false });
});

test('a taken, numeric or malformed id is refused before any edit', () => {
  const doc = lecture();
  assert.match(L.idProblem(doc, 'entities', 'server', 'workstation'), /taken/);
  assert.match(L.idProblem(doc, 'entities', 'server', '123'), /digit/);
  assert.match(L.idProblem(doc, 'entities', 'server', 'Server!'), /a-z/);
  assert.equal(L.idProblem(doc, 'entities', 'server', 'constructor'), null);
  assert.equal(L.idProblem(doc, 'entities', 'server', 'server'), null);
  assert.equal(L.renameId(doc, 'entities', 'server', 'workstation'), null);
  assert.equal(L.renameId(doc, 'entities', 'server', 'server'), null);
  // Prototype-like ids are only ids.
  const proto = L.renameId(doc, 'entities', 'server', 'constructor');
  assert.equal(proto.doc.entities.constructor.label, 'Server');
  assert.equal(proto.doc.attacker.target.entity, 'constructor');
  assert.equal(Object.hasOwn(L.remove(proto.doc, 'entities', 'constructor').doc.entities, 'constructor'), false);
  assert.equal(L.remove(lecture(), 'entities', 'toString'), null);
});

const CATALOG = require('./fixtures/catalog.json');

test('the link menu offers the kinds a component can stand in, with eligible ends', () => {
  const doc = lecture();
  const choices = L.linkChoices(doc, CATALOG, 'server');
  const kinds = choices.map((c) => c.kind + ':' + c.direction);
  assert.deepEqual(kinds, ['attached:out', 'hosts:out', 'stores:out', 'grants:in', 'administration:in']);
  const attached = choices.find((c) => c.kind === 'attached');
  // server is already attached to server-net; the others are offered.
  assert.deepEqual(attached.candidates, ['client-net', 'admin-net']);
  const hosts = choices.find((c) => c.kind === 'hosts');
  assert.deepEqual(hosts.candidates, [], 'both executables have their host, and hosting is one per executable');
  const grants = choices.find((c) => c.kind === 'grants');
  assert.deepEqual(grants.candidates, ['admin-account']);
  assert.equal(choices.some((c) => c.kind === 'permits'), false, 'permissions belong to a flow');
  // A firewall's router is picked from routers; an account links both ways.
  assert.deepEqual(L.linkChoices(doc, CATALOG, 'filter').map((c) => c.kind + ':' + c.direction), ['filters:in']);
  assert.deepEqual(L.linkChoices(doc, CATALOG, 'server-account').map((c) => c.kind + ':' + c.direction), ['authenticates:in', 'authorizes:out', 'grants:out']);
  assert.deepEqual(L.linkChoices(doc, CATALOG, 'absent'), []);
});

test('hosting already given is not offered twice', () => {
  const doc = lecture();
  const hosts = L.linkChoices(doc, CATALOG, 'workstation').find((c) => c.kind === 'hosts');
  assert.deepEqual(hosts.candidates, [], 'both executables have their host');
});

test('privileges offered follow what a router or an application can hold', () => {
  const doc = lecture();
  assert.deepEqual(L.privileges(doc, 'hosts', 'server', 'sshd'), ['user', 'admin']);
  assert.deepEqual(L.privileges(doc, 'hosts', 'bridge', 'sshd'), ['admin']);
  assert.deepEqual(L.privileges(doc, 'grants', 'admin-account', 'bridge'), ['admin']);
  assert.deepEqual(L.privileges(doc, 'stores', 'ssh-client', 'server-key'), ['user']);
  assert.deepEqual(L.privileges(doc, 'attached', 'server', 'server-net'), null);
});

test('a route grows network, router, network — attached ones first, none twice', () => {
  const doc = lecture();
  doc.entities.edge = { kind: 'router', label: 'Edge' };
  const flow = { source: 'ssh-client', target: 'sshd', route: [] };
  // The source's host is on client-net: it comes first.
  assert.deepEqual(L.nextHops(doc, flow), ['client-net', 'server-net', 'admin-net']);
  flow.route = ['client-net'];
  assert.deepEqual(L.nextHops(doc, flow), ['bridge', 'edge']);
  flow.route = ['client-net', 'bridge'];
  assert.deepEqual(L.nextHops(doc, flow), ['server-net', 'admin-net']);
});

test('a flow lists the permission each router on its route needs, given or not', () => {
  const doc = lecture();
  assert.deepEqual(L.flowPermissions(doc, 'ssh'), [{ router: 'bridge', firewall: 'filter', association: 'allow-ssh', allowed: true }]);
  delete doc.associations['allow-ssh'];
  assert.deepEqual(L.flowPermissions(doc, 'ssh'), [{ router: 'bridge', firewall: 'filter', association: null, allowed: null }]);
  delete doc.associations['bridge-filter'];
  assert.deepEqual(L.flowPermissions(doc, 'ssh'), [{ router: 'bridge', firewall: null, association: null, allowed: null }]);
  assert.deepEqual(L.flowPermissions(doc, 'absent'), []);
});

test('a component lists its links and flows, outgoing and incoming', () => {
  const doc = lecture();
  assert.deepEqual(L.linksOf(doc, 'sshd').map((l) => [l.id, l.direction, l.other]), [
    ['service-hosting', 'in', 'server'],
    ['ssh-authorizes', 'in', 'server-account'],
  ]);
  assert.deepEqual(L.flowsOf(doc, 'sshd'), [{ id: 'ssh', direction: 'in', other: 'ssh-client' }]);
  assert.deepEqual(L.flowsOf(doc, 'ssh-client'), [{ id: 'ssh', direction: 'out', other: 'sshd' }]);
});

test('Tab offers the kinds that can be linked to the selection, with each way to link them', () => {
  const doc = lecture();
  const choices = L.addChoices(doc, CATALOG, 'server');
  const flat = choices.map((c) => c.kind + ': ' + c.options.map((o) => (o.direction === 'out' ? o.relation + ' →' : '← ' + o.relation) + (o.privilege ? ' · ' + o.privilege : '')).join(', '));
  assert.deepEqual(flat, [
    'network: attached →, ← administration',
    'application: hosts → · user, hosts → · admin',
    'service: hosts → · user, hosts → · admin',
    'account: ← grants · user, ← grants · admin',
    'credential: stores → · user, stores → · admin',
  ]);
  // A router hosts and is granted only as admin; it has its firewall already.
  const router = L.addChoices(doc, CATALOG, 'bridge').map((c) => c.kind + ': ' + c.options.map((o) => o.relation + (o.privilege ? '·' + o.privilege : '')).join(', '));
  assert.deepEqual(router, ['network: attached, administration', 'application: hosts·admin', 'service: hosts·admin', 'account: grants·admin']);
  // A hosted executable offers no second host; an application stores as user.
  const client = L.addChoices(doc, CATALOG, 'ssh-client').map((c) => c.kind + ': ' + c.options.map((o) => o.relation + (o.privilege ? '·' + o.privilege : '')).join(', '));
  assert.deepEqual(client, ['service: flow', 'credential: stores·user']);
  assert.deepEqual(L.addChoices(doc, CATALOG, 'absent'), []);
});

test('adding a linked component is one edit: the component, its link, the selection on it', () => {
  const doc = lecture();
  const option = { relation: 'hosts', direction: 'out', privilege: 'admin' };
  const edit = L.addLinked(doc, E, 'server', 'service', 'Service', CATALOG.entities.find((e) => e.kind === 'service'), option);
  assert.equal(edit.select, 'entity/service');
  assert.equal(edit.doc.entities.service.kind, 'service');
  assert.deepEqual(edit.doc.entities.service.defenses, { patched: 'unknown' });
  assert.deepEqual(edit.doc.associations['server-hosts-service'], { kind: 'hosts', from: 'server', to: 'service', privilege: 'admin' });
  const back = L.addLinked(doc, E, 'server', 'account', 'Account', CATALOG.entities.find((e) => e.kind === 'account'), { relation: 'grants', direction: 'in', privilege: 'user' });
  assert.deepEqual(back.doc.associations['account-grants-server'], { kind: 'grants', from: 'account', to: 'server', privilege: 'user' });
  assert.equal(L.addLinked(doc, E, 'absent', 'host', 'Host', {}, option), null);
});

test('each way to link reads as a few words from the selected component', () => {
  const said = (relation, direction, privilege) => L.phrase(relation, direction, privilege);
  assert.equal(said('hosts', 'out', 'admin'), 'runs here as admin');
  assert.equal(said('hosts', 'in', 'user'), 'runs this as user');
  assert.equal(said('grants', 'in', 'admin'), 'is admin here');
  assert.equal(said('grants', 'out', 'user'), 'grants it user');
  assert.equal(said('attached', 'out'), 'connected to');
  assert.equal(said('attached', 'in'), 'connected here');
  assert.equal(said('administration', 'in'), 'manages this');
  assert.equal(said('administration', 'out'), 'managed from here');
  assert.equal(said('stores', 'out', 'user'), 'kept here, user-readable');
  assert.equal(said('stores', 'out', 'admin'), 'kept here, admin-only');
  assert.equal(said('stores', 'in', 'user'), 'keeps this, user-readable');
  assert.equal(said('authorizes', 'in'), 'may log in');
  assert.equal(said('authorizes', 'out'), 'accepts this account');
  assert.equal(said('authenticates', 'out'), 'unlocks');
  assert.equal(said('authenticates', 'in'), 'unlocks this');
  assert.equal(said('filters', 'out'), 'its firewall');
  assert.equal(said('filters', 'in'), 'its router');
  assert.equal(said('flow', 'out'), 'flow to it');
  assert.equal(said('flow', 'in'), 'flow from it');
  // Without a privilege yet (the Link menu asks for it next).
  assert.equal(said('hosts', 'out'), 'runs here');
  assert.equal(said('grants', 'in'), 'has rights here');
  assert.equal(said('stores', 'out'), 'kept here');
  // Every relation from every side has words, never the file's name.
  for (const r of ['attached', 'hosts', 'filters', 'stores', 'authenticates', 'authorizes', 'grants', 'administration', 'flow']) {
    for (const d of ['out', 'in']) assert.doesNotMatch(said(r, d, 'user'), /→|←|undefined/, r + d);
  }
});

test('software is offered a flow to or from a new service', () => {
  const doc = lecture();
  const kinds = (id) => L.addChoices(doc, CATALOG, id).map((c) => c.kind + ': ' + c.options.map((o) => o.relation + ':' + o.direction).join(', '));
  assert.deepEqual(kinds('ssh-client'), ['service: flow:out', 'credential: stores:out']);
  assert.deepEqual(kinds('sshd'), ['application: flow:in', 'service: flow:out, flow:in', 'account: authorizes:in']);
});

test('adding a flow partner makes the component and a flow with an empty route', () => {
  const doc = lecture();
  const spec = CATALOG.entities.find((e) => e.kind === 'service');
  const edit = L.addLinked(doc, E, 'ssh-client', 'service', 'Web server', spec, { relation: 'flow', direction: 'out', privilege: null });
  assert.equal(edit.select, 'entity/web-server');
  assert.deepEqual(edit.doc.flows['ssh-client-to-web-server'], {
    label: 'SSH client to Web server', source: 'ssh-client', target: 'web-server', route: [],
    parameters: { connect: { status: 'unknown' } },
  });
  assert.deepEqual(edit.doc.associations, doc.associations);
  const back = L.addLinked(doc, E, 'sshd', 'application', 'Scanner', CATALOG.entities.find((e) => e.kind === 'application'), { relation: 'flow', direction: 'in', privilege: null });
  assert.equal(back.doc.flows['scanner-to-ssh-server'].source, 'scanner');
  assert.equal(back.doc.flows['scanner-to-ssh-server'].target, 'sshd');
});

test('what cannot be linked is explained where it would be looked for', () => {
  const doc = lecture();
  // Greyed entries in the Tab and Link menus: the way to get there instead.
  assert.deepEqual(L.notes(doc, 'server'), [{ kind: 'router', hint: 'through a network' }]);
  assert.deepEqual(L.notes(doc, 'bridge'), [{ kind: 'host', hint: 'through a network' }]);
  assert.deepEqual(L.notes(doc, 'filter'), [{ kind: 'flow', hint: 'permitted in the flow' }]);
  assert.deepEqual(L.notes(doc, 'sshd'), []);
  assert.deepEqual(L.notes(doc, 'absent'), []);
});

test('an empty Link menu says what is missing', () => {
  const doc = lecture();
  // The firewall has its router: its permissions are the flows'.
  assert.equal(L.emptyLink(doc, CATALOG, 'filter'), 'a firewall permits flows · set it in each flow that crosses its router');
  // A lone host in a new document: nothing to link to yet.
  const lone = { entities: { h: { kind: 'host', label: 'H' } }, associations: {}, flows: {} };
  assert.equal(L.emptyLink(lone, CATALOG, 'h'), 'no network, application, service, account or credential yet · Tab adds one linked');
  assert.equal(L.emptyLink(doc, CATALOG, 'sshd'), null, 'there is something to link');
});

test('an empty flow or route choice says what to add', () => {
  const doc = lecture();
  const noServices = { entities: { c: { kind: 'application', label: 'C' } }, associations: {}, flows: {} };
  assert.equal(L.emptyFlow(noServices, 'c'), 'no service yet · Tab on “C” adds one with a flow');
  assert.equal(L.emptyFlow(doc, 'ssh-client'), null);
  assert.equal(L.emptyHop(doc, { route: ['client-net', 'bridge', 'server-net'] }), 'every router is on this route already');
  assert.equal(L.emptyHop({ entities: { n: { kind: 'network', label: 'N' } }, associations: {}, flows: {} }, { route: ['n'] }), 'no router yet · add one with A, then connect it to both networks');
  assert.equal(L.emptyHop(doc, { route: [] }), null);
});
