const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../assets/js/revisions.js');

test('an edit expires every request made before it', () => {
  const gate = R.create();
  const oldSolve = gate.issue('solve');
  gate.invalidate();
  assert.equal(gate.accept(oldSolve), false);
  const oldLayout = gate.issue('layout'), newLayout = gate.issue('layout');
  assert.equal(gate.accept(oldLayout), false);
  assert.equal(gate.accept(newLayout), true);
});

test('channels do not expire each other', () => {
  const gate = R.create();
  const layout = gate.issue('layout');
  const solve = gate.issue('solve');
  gate.issue('generate');
  assert.equal(gate.accept(layout), true);
  assert.equal(gate.accept(solve), true);
  assert.equal(gate.accept(solve), true, 'accepting does not use a token up');
});

test('tokens carry the revision they were issued at', () => {
  const gate = R.create();
  const before = gate.current();
  const token = gate.issue('document');
  assert.equal(token.revision, before);
  assert.equal(token.channel, 'document');
  assert.equal(typeof token.request, 'number');
  gate.invalidate();
  assert.notEqual(gate.current(), before);
  assert.equal(gate.accept(null), false);
  assert.equal(gate.accept({ revision: gate.current(), channel: 'nowhere', request: 1 }), false);
});
