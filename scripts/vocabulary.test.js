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
