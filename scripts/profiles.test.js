const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/js/profiles.js');

const tree = { profile: 'fault-tree', nodes: { top: { label: 'Top', leaf: 'basic' } } };
const attack = { profile: 'attack-tree', nodes: { top: { label: 'Top', leaf: 'basic' } } };
const arch = { profile: 'architecture', entities: { web: { kind: 'service', label: 'Web' } }, associations: { a: {} }, flows: { f: {} } };

test('an architecture is told apart without reading nodes', () => {
  assert.equal(P.isArchitecture(arch), true);
  assert.equal(P.isArchitecture(tree), false);
  assert.equal(P.isArchitecture(null), false);
});

test('selection ids: bare for a tree, qualified for an architecture', () => {
  assert.equal(P.selectionExists(tree, 'top'), true);
  assert.equal(P.selectionExists(tree, 'entity/top'), false);
  assert.equal(P.selectionExists(tree, 'constructor'), false);
  assert.equal(P.selectionExists(arch, 'entity/web'), true);
  assert.equal(P.selectionExists(arch, 'web'), false);
  assert.equal(P.selectionExists(arch, 'flow/f'), true);
  assert.equal(P.selectionExists(arch, 'association/a'), true);
  assert.equal(P.selectionExists(arch, 'entity/constructor'), false);
  assert.equal(P.selectionExists(arch, 'step/x'), false);
  assert.equal(P.selectionExists(arch, 'step/x', { nodes: { x: {} } }), true);
  assert.deepEqual(P.qualified('entity/a/b'), { kind: 'entity', id: 'a/b' });
  assert.equal(P.qualified('plain'), null);
});

test('capabilities are explicit, and an architecture has no tree analysis', () => {
  assert.deepEqual(P.capabilities(tree), { architecture: false, generate: false, solve: true, exact: true, cutSets: true, loss: true, pareto: false, controls: true });
  assert.equal(P.capabilities(attack).pareto, true);
  assert.deepEqual(P.capabilities(arch), { architecture: true, generate: false, solve: false, exact: false, cutSets: false, loss: false, pareto: false, controls: false });
});

test('tree actions are refused on an architecture; undo and redo are not tree actions', () => {
  for (const action of ['addChild', 'addSibling', 'cycleGate', 'link', 'move', 'remove', 'deleteNode', 'unlink', 'basic', 'properties']) {
    assert.equal(P.treeActionAllowed(arch, action), false, action);
    assert.equal(P.treeActionAllowed(tree, action), true, action);
  }
  assert.equal(P.treeActionAllowed(arch, 'undo'), true);
  assert.equal(P.treeActionAllowed(arch, 'redo'), true);
});
