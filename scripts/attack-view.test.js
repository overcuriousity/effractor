const { test } = require('node:test');
const assert = require('node:assert');
const V = require('../assets/js/attack-view.js');
const fixture = require('./fixtures/graph/lecture-graph.json');
const doc = require('./fixtures/graph/lecture-doc.json');

const { graph, support } = fixture;
const clone = value => JSON.parse(JSON.stringify(value));

test('a component leads to the steps generated from it, and a step back to its sources', () => {
  const ids = V.stepsForEntity(graph, 'sshd');
  assert.ok(ids.includes('action/service-deploy-exploit/sshd'));
  assert.ok(ids.includes('state/service/sshd/control'));
  assert.ok(!ids.includes('input/foothold/workstation/admin'));
  ids.forEach(id => assert.ok(graph.nodes.some(n => n.id === id), id));
  const origins = V.sourcesForStep(graph, 'action/service-deploy-exploit/sshd');
  assert.ok(origins.some(o => o.paths.includes('entities.sshd.parameters.deploy-exploit')));
  // Back again: every component a step's origins bind leads to that step.
  origins.forEach(o => o.entities.forEach(e => assert.ok(V.stepsForEntity(graph, e).includes('action/service-deploy-exploit/sshd'))));
  assert.deepEqual(V.stepsForEntity(graph, 'nothing-here'), []);
  assert.deepEqual(V.sourcesForStep(graph, 'state/nothing'), []);
  // Flows and relationships have their steps too.
  assert.ok(V.stepsFor(graph, 'flow/ssh').includes('action/flow-connect/ssh'));
  assert.ok(V.stepsFor(graph, 'association/allow-ssh').includes('input/flow-permission/filter/ssh'));
});

test('a step several rules produce lists every one of them', () => {
  const origins = V.sourcesForStep(graph, 'state/host/server/admin');
  assert.deepEqual(origins.map(o => o.rule).sort(), ['execution-privilege', 'session-grant']);
  // The supplied objects, not a JS reconstruction of them.
  assert.equal(origins[0], graph.nodes.find(n => n.id === 'state/host/server/admin').origins[0]);
});

test('a renamed label changes what a step says, not what is selected', () => {
  const renamed = clone(graph);
  renamed.nodes.forEach(n => { n.label = n.label.replace('SSH server', 'OpenSSH'); });
  assert.deepEqual(V.stepsForEntity(renamed, 'sshd'), V.stepsForEntity(graph, 'sshd'));
  const drawn = V.describe(renamed, support, null).graph.nodes.find(n => n.id === 'step/action/service-deploy-exploit/sshd');
  assert.equal(drawn.label, 'Deploy exploit · OpenSSH');
  assert.equal(V.originOf(renamed, 'action/service-deploy-exploit/sshd'), 'entity/sshd');
  // A step's own component: the state's owner, the action's object.
  assert.equal(V.originOf(graph, 'state/host/server/admin'), 'entity/server');
  assert.equal(V.originOf(graph, 'state/flow/ssh/connected'), 'flow/ssh');
  assert.equal(V.originOf(graph, 'action/flow-connect/ssh'), 'flow/ssh');
  assert.equal(V.originOf(graph, 'action/credential-extract/workstation/server-key'), 'entity/server-key');
  assert.equal(V.originOf(graph, 'input/foothold/workstation/admin'), 'entity/workstation');
  assert.equal(V.originOf(graph, 'state/nothing'), null);
});

test('each source field leads to the place in the architecture that sets it', () => {
  const at = path => V.sourceTarget(doc, path);
  // Patching: the switch and both discovery slots.
  const find = V.sourcesForStep(graph, 'action/service-find-exploit/sshd')[0];
  assert.deepEqual(find.paths.map(at), [
    { select: 'entity/sshd', slot: 'find-exploit', path: 'entities.sshd.parameters.find-exploit' },
    { select: 'entity/sshd', slot: 'find-exploit-patched', path: 'entities.sshd.parameters.find-exploit-patched' },
    { select: 'entity/sshd', field: 'defense', path: 'entities.sshd.defenses.patched' },
  ]);
  // Extraction: the credential's slot.
  assert.deepEqual(at('entities.server-key.parameters.extract'), { select: 'entity/server-key', slot: 'extract', path: 'entities.server-key.parameters.extract' });
  // A flow's connect.
  assert.deepEqual(at('flows.ssh.parameters.connect'), { select: 'flow/ssh', slot: 'connect', path: 'flows.ssh.parameters.connect' });
  // A permission: the firewall's relationship to the flow.
  assert.deepEqual(at('associations.allow-ssh.allowed'), { select: 'association/allow-ssh', field: 'allowed', path: 'associations.allow-ssh.allowed' });
  // The foothold is set on its component.
  assert.deepEqual(at('attacker.footholds[0]'), { select: 'entity/workstation', field: 'foothold', path: 'attacker.footholds[0]' });
  // A scenario change has no control of its own: its line in the source.
  assert.deepEqual(at('scenarios.patch.changes[0]'), { source: 'scenarios.patch.changes[0]', path: 'scenarios.patch.changes[0]' });
  // What names nothing in this document goes to the source too, never to a
  // selection that does not exist.
  assert.deepEqual(at('entities.gone.parameters.login'), { source: 'entities.gone.parameters.login', path: 'entities.gone.parameters.login' });
  assert.deepEqual(at('attacker.footholds[7]'), { source: 'attacker.footholds[7]', path: 'attacker.footholds[7]' });
  // Hosting privilege: the relationship that grants it, bound by the origin.
  const hosting = V.sourcesForStep(graph, 'state/host/server/admin').find(o => o.rule === 'execution-privilege');
  assert.deepEqual(hosting.associations, ['service-hosting']);
});

test('a step inspected says its rule, its time and its state, blocked ones included', () => {
  const find = V.inspect(graph, support, 'action/service-find-exploit/sshd');
  assert.equal(find.status, 'possible');
  assert.equal(find.kind, 'action');
  assert.deepEqual(find.timing, { status: 'illustrative', expression: 'Exponential(0.1)', note: graph.nodes.find(n => n.id === 'action/service-find-exploit/sshd').timing.note });
  assert.deepEqual(find.rules, ['service-find-exploit']);
  assert.ok(find.components.includes('sshd'));

  const admin = V.inspect(graph, support, 'state/network/admin-net/access');
  assert.equal(admin.status, 'unreachable');
  assert.equal(admin.kind, 'fact');
  assert.deepEqual(admin.rules, []);
  assert.match(admin.reason, /nothing/);

  // Denied at the firewall: blocked, with the value that blocks it.
  const denied = clone(fixture);
  const i = denied.graph.nodes.findIndex(n => n.id === 'input/flow-permission/filter/ssh');
  denied.graph.nodes[i].timing.expression = 'denied';
  denied.support.nodes[i].status = 'blocked';
  const policy = V.inspect(denied.graph, denied.support, 'input/flow-permission/filter/ssh');
  assert.equal(policy.status, 'blocked');
  assert.equal(policy.kind, 'input');
  assert.match(policy.reason, /denied/);
  assert.deepEqual(V.sourcesForStep(denied.graph, 'input/flow-permission/filter/ssh')[0].paths, ['associations.allow-ssh.allowed']);
  assert.equal(V.inspect(graph, support, 'state/nothing'), null);
});
