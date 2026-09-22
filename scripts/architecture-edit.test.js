const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const E = require('../assets/js/architecture-edit.js');

const HOST = { kind: 'host', parameters: [], defense: null };
const SERVICE = { kind: 'service', parameters: ['find-exploit', 'find-exploit-patched', 'deploy-exploit', 'login'], defense: 'patched' };
const CREDENTIAL = { kind: 'credential', parameters: ['extract', 'extract-protected'], defense: 'protected' };

test('an architecture starts empty and label changes keep identity', () => {
  const doc = E.empty();
  assert.equal(doc.profile, 'architecture');
  assert.deepEqual(Object.keys(doc.entities), []);
  const edit = E.addEntity(doc, 'host', 'Workstation', { parameters: [] });
  assert.deepEqual(Object.keys(doc.entities), []);
  assert.equal(edit.select, 'entity/workstation');
  const renamed = E.renameEntity(edit.doc, 'workstation', 'Office workstation');
  assert.equal(renamed.doc.entities.workstation.label, 'Office workstation');
  assert.deepEqual(Object.keys(renamed.doc.entities), ['workstation']);
});

test('the empty document is the one New Architecture opens, and it holds no exercise', () => {
  const doc = E.empty();
  assert.deepEqual(doc, {
    effractor: 2, profile: 'architecture', name: 'Untitled', time_unit: 'd', horizon: 100,
    library: { id: 'core-components', version: 1 },
    entities: {}, associations: {}, flows: {}, attacker: { footholds: [] }, scenarios: {},
    analysis: { seed: 42, samples: 10000, confidence: 0.95 },
  });
  const template = readFileSync('assets/templates/new-architecture.yaml', 'utf8');
  assert.match(template, /^profile: architecture$/m);
  assert.match(template, /^entities: \{\}$/m);
  assert.doesNotMatch(template, /ssh|workstation|server|illustrative/i);
});

test('a new component carries every slot of its kind as unknown, and its switch as unknown', () => {
  const edit = E.addEntity(E.empty(), 'service', 'SSH server', SERVICE);
  const sshd = edit.doc.entities['ssh-server'];
  assert.equal(sshd.kind, 'service');
  assert.deepEqual(Object.keys(sshd.parameters), SERVICE.parameters);
  for (const slot of SERVICE.parameters) assert.deepEqual(sshd.parameters[slot], { status: 'unknown' });
  assert.deepEqual(sshd.defenses, { patched: 'unknown' });
  const host = E.addEntity(E.empty(), 'host', 'H', HOST).doc.entities.h;
  assert.equal(host.parameters, undefined);
  assert.equal(host.defenses, undefined);
});

test('ids come from the label: never only digits, never taken twice, any word allowed', () => {
  let doc = E.empty();
  const numeric = E.addEntity(doc, 'host', '123', HOST);
  assert.equal(numeric.select, 'entity/entity-123');
  doc = numeric.doc;
  const again = E.addEntity(doc, 'host', 'Entity 123', HOST);
  assert.equal(again.select, 'entity/entity-123-2');
  const blank = E.addEntity(E.empty(), 'credential', '  ', CREDENTIAL);
  assert.equal(blank, null, 'a component needs a name');
  const proto = E.addEntity(E.empty(), 'host', 'constructor', HOST);
  assert.equal(proto.select, 'entity/constructor');
  const second = E.addEntity(proto.doc, 'host', '__proto__', HOST);
  assert.equal(second.select, 'entity/proto');
  assert.deepEqual(Object.keys(second.doc.entities), ['constructor', 'proto']);
  const dup = E.addEntity(second.doc, 'host', 'Constructor', HOST);
  assert.equal(dup.select, 'entity/constructor-2');
  assert.equal(E.addEntity(E.empty(), 'nonsense', 'X', HOST), null);
});

test('renaming says nothing new is refused; the id stays whatever the label becomes', () => {
  const doc = E.addEntity(E.empty(), 'host', 'Server', HOST).doc;
  assert.equal(E.renameEntity(doc, 'server', 'Server'), null);
  assert.equal(E.renameEntity(doc, 'server', '   '), null);
  assert.equal(E.renameEntity(doc, 'nowhere', 'X'), null);
  const renamed = E.renameEntity(doc, 'server', '42');
  assert.deepEqual(Object.keys(renamed.doc.entities), ['server']);
  assert.equal(renamed.select, 'entity/server');
});

test('a supplied parameter is status, TTC and note together; clearing makes it unknown again', () => {
  const doc = E.addEntity(E.empty(), 'service', 'SSH', SERVICE).doc;
  const set = E.setParameter(doc, { entity: 'ssh' }, 'login', { status: 'illustrative', ttc: ' Exponential(1) ', note: ' Exercise ' });
  assert.deepEqual(set.doc.entities.ssh.parameters.login, { status: 'illustrative', ttc: 'Exponential(1)', note: 'Exercise' });
  assert.deepEqual(doc.entities.ssh.parameters.login, { status: 'unknown' }, 'the original is untouched');
  assert.equal(set.select, 'entity/ssh');
  // Half a parameter goes to wasm as it is and is refused there, not completed here.
  const half = E.setParameter(doc, { entity: 'ssh' }, 'login', { status: 'assumed', ttc: 'Exponential(1)', note: '' });
  assert.deepEqual(half.doc.entities.ssh.parameters.login, { status: 'assumed', ttc: 'Exponential(1)' });
  const cleared = E.setParameter(set.doc, { entity: 'ssh' }, 'login', { status: 'unknown', ttc: 'Exponential(1)', note: 'x' });
  assert.deepEqual(cleared.doc.entities.ssh.parameters.login, { status: 'unknown' });
  assert.equal(E.setParameter(doc, { entity: 'ssh' }, 'extract', { status: 'unknown' }), null, 'not a slot of a service');
  assert.equal(E.setParameter(doc, { entity: 'nowhere' }, 'login', { status: 'unknown' }), null);
  assert.equal(E.setParameter(doc, { entity: 'ssh' }, 'login', { status: 'certain' }), null);
});

test('a flow owns its connect parameter', () => {
  const doc = E.empty();
  doc.flows.ssh = { label: 'SSH', source: 'a', target: 'b', route: ['n'], parameters: { connect: { status: 'unknown' } } };
  const set = E.setParameter(doc, { flow: 'ssh' }, 'connect', { status: 'calibrated', ttc: 'Exponential(2)', note: 'Measured' });
  assert.deepEqual(set.doc.flows.ssh.parameters.connect, { status: 'calibrated', ttc: 'Exponential(2)', note: 'Measured' });
  assert.equal(set.select, 'flow/ssh');
  assert.equal(E.setParameter(doc, { flow: 'ssh' }, 'login', { status: 'unknown' }), null);
});

test('edits keep x- extensions at the entity and parameter level', () => {
  const doc = E.addEntity(E.empty(), 'service', 'SSH', SERVICE).doc;
  doc.entities.ssh['x-owner'] = 'ops';
  doc.entities.ssh.parameters.login['x-ticket'] = 7;
  const set = E.setParameter(doc, { entity: 'ssh' }, 'login', { status: 'assumed', ttc: 'Zero', note: 'n' });
  assert.equal(set.doc.entities.ssh['x-owner'], 'ops');
  assert.equal(set.doc.entities.ssh.parameters.login['x-ticket'], 7);
  const renamed = E.renameEntity(set.doc, 'ssh', 'Secure shell');
  assert.equal(renamed.doc.entities.ssh['x-owner'], 'ops');
  const patched = E.setDefense(renamed.doc, 'ssh', 'patched', true);
  assert.equal(patched.doc.entities.ssh['x-owner'], 'ops');
});

test('defense switches are true, false or unknown, and only where the kind has one', () => {
  const doc = E.addEntity(E.empty(), 'credential', 'Password', CREDENTIAL).doc;
  assert.deepEqual(E.setDefense(doc, 'password', 'protected', true).doc.entities.password.defenses, { protected: true });
  assert.deepEqual(E.setDefense(doc, 'password', 'protected', false).doc.entities.password.defenses, { protected: false });
  assert.equal(E.setDefense(doc, 'password', 'protected', 'unknown'), null, 'unchanged');
  assert.equal(E.setDefense(doc, 'password', 'patched', true), null);
  assert.equal(E.setDefense(doc, 'password', 'protected', 'maybe'), null);
});

test('an unreferenced component is deleted; a referenced one is refused until links can be removed', () => {
  let doc = E.addEntity(E.empty(), 'host', 'Workstation', HOST).doc;
  doc = E.addEntity(doc, 'network', 'LAN', { parameters: [], defense: null }).doc;
  doc = E.addEntity(doc, 'host', 'Spare', HOST).doc;
  doc.associations.join = { kind: 'attached', from: 'workstation', to: 'lan' };
  doc.attacker.footholds.push({ entity: 'workstation', state: 'admin' });
  const gone = E.removeEntity(doc, 'spare');
  assert.deepEqual(Object.keys(gone.doc.entities), ['workstation', 'lan']);
  assert.equal(gone.select, null);
  assert.match(gone.notice, /Spare/);
  assert.equal(E.references(doc, 'workstation'), 2);
  assert.equal(E.references(doc, 'lan'), 1);
  assert.equal(E.removeEntity(doc, 'workstation'), null);
  assert.equal(E.removeEntity(doc, 'nowhere'), null);
});

test('references count flows, routes, targets and scenarios', () => {
  const doc = E.empty();
  for (const id of ['c', 's', 'n', 'r', 'k']) doc.entities[id] = { kind: 'host', label: id };
  doc.flows.f = { label: 'F', source: 'c', target: 's', route: ['n', 'r', 'n'], parameters: {} };
  doc.attacker.target = { entity: 's', state: 'admin' };
  doc.scenarios.patch = { label: 'P', changes: [{ entity: 'k', defense: 'patched', value: true }] };
  assert.equal(E.references(doc, 'c'), 1);
  assert.equal(E.references(doc, 's'), 2);
  assert.equal(E.references(doc, 'n'), 1, 'one flow, however often its route passes');
  assert.equal(E.references(doc, 'k'), 1);
});

test('a description is set, trimmed, and removed when emptied', () => {
  const doc = E.addEntity(E.empty(), 'host', 'Server', HOST).doc;
  const set = E.setDescription(doc, 'server', '  Runs the shop  ');
  assert.equal(set.doc.entities.server.description, 'Runs the shop');
  assert.equal(set.select, 'entity/server');
  assert.equal(E.setDescription(set.doc, 'server', 'Runs the shop'), null);
  const gone = E.setDescription(set.doc, 'server', ' ');
  assert.equal('description' in gone.doc.entities.server, false);
  assert.equal(E.setDescription(doc, 'server', ''), null, 'nothing to remove');
  assert.equal(E.setDescription(doc, 'nowhere', 'x'), null);
});
