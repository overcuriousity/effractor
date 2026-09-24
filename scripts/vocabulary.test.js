const { test } = require('node:test');
const assert = require('node:assert');
const W = require('../assets/js/vocabulary.js');
const catalog = require('./fixtures/catalog.json');

test('ids read as the catalog words, and an unknown id stays itself', () => {
  assert.equal(W.state(catalog, 'admin'), 'admin control');
  assert.equal(W.state(catalog, 'possessed'), 'held');
  assert.equal(W.slot(catalog, 'find-exploit-patched'), 'Find an exploit (patched)');
  assert.equal(W.rule(catalog, 'service-deploy-exploit'), 'Use the exploit');
  assert.match(W.meaning(catalog, 'service'), /accepts connections/);
  assert.equal(W.state(catalog, 'nothing'), 'nothing');
  assert.equal(W.slot(null, 'login'), 'login');
  assert.equal(W.meaning(catalog, 'nothing'), '');
});

test('evidence statuses and step states are words, not ids', () => {
  assert.equal(W.status('unknown'), 'Unknown');
  assert.equal(W.status('illustrative'), 'Illustrative');
  assert.equal(W.status('policy'), 'Firewall rule');
});

test('a defence switch and its step status read as words', () => {
  assert.equal(W.defense(catalog, 'mfa'), 'Multi-factor login');
  assert.equal(W.defense(catalog, 'patched'), 'Patched');
  assert.equal(W.defense(null, 'mfa'), 'mfa');
  assert.equal(W.status('defense'), 'Defence switch');
});

test('an attacker profile is named as such among the assumptions', () => {
  assert.equal(require('../assets/js/vocabulary.js').status('attacker'), 'Attacker speed');
});

test('a source path in plain words: the component, then what of it', () => {
  const doc = require('./fixtures/graph/lecture-doc.json');
  const path = (p) => W.path(doc, catalog, p);
  assert.equal(path('entities.openssh.parameters.find-exploit'), 'OpenSSH · ' + W.slot(catalog, 'find-exploit'));
  assert.equal(path('entities.server-account.defenses.mfa'), 'Server account · ' + W.defense(catalog, 'mfa'));
  assert.equal(path('flows.ssh.parameters.connect'), 'SSH from the workstation · ' + W.slot(catalog, 'connect'));
  assert.equal(path('associations.allow-ssh.allowed'), 'Firewall · SSH from the workstation');
  assert.equal(path('scenarios.deny.changes[0]'), 'Deny SSH at the router · change 1');
  assert.equal(path('scenarios.deny.attacker.speed'), 'Deny SSH at the router · attacker speed');
  // What it cannot name, it shows as it is.
  assert.equal(path('entities.nobody.parameters.login'), 'entities.nobody.parameters.login');
  assert.equal(path('attacker.target'), 'attacker.target');
  assert.equal(W.path(null, catalog, 'flows.ssh.parameters.connect'), 'flows.ssh.parameters.connect');
});
