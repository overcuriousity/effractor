const { test } = require('node:test');
const assert = require('node:assert/strict');
const I = require('../assets/js/architecture-icons.js');
const A = require('../assets/js/architecture-edit.js');

test('every kind of component has an icon of plain line parts', () => {
  A.KINDS.forEach((kind) => {
    const parts = I.parts(kind);
    assert.ok(parts.length > 0, kind);
    parts.forEach(([tag, attrs]) => {
      assert.ok(['path', 'circle', 'rect', 'line'].includes(tag), kind + ': ' + tag);
      assert.equal(typeof attrs, 'object');
    });
  });
});

test('kinds fall in three families, each drawn in its own colour', () => {
  assert.deepEqual(A.KINDS.map(I.family), ['network', 'network', 'network', 'compute', 'compute', 'compute', 'compute', 'identity', 'identity', 'identity', 'data', 'identity', 'network', 'network']);
});

test('an unknown kind still draws: a plain dot, in no family', () => {
  assert.equal(I.family('teleporter'), null);
  assert.equal(I.parts('teleporter').length, 1);
});

test('a person is drawn as a person and an account as a badge', () => {
  assert.notDeepEqual(I.parts('person'), I.parts('account'));
  assert.ok(I.parts('account').some(([tag]) => tag === 'rect'));
});

test('an access control is identity, drawn as a lock, not as an account', () => {
  assert.equal(I.family('access-control'), 'identity');
  assert.notDeepEqual(I.parts('access-control'), I.parts('account'));
  assert.notDeepEqual(I.parts('access-control'), I.parts('credential'));
});

test('an IDS and an IPS are network, drawn apart from each other and the router', () => {
  assert.equal(I.family('ids'), 'network');
  assert.equal(I.family('ips'), 'network');
  assert.notDeepEqual(I.parts('ids'), I.parts('ips'));
  assert.notDeepEqual(I.parts('ids'), I.parts('router'));
  assert.ok(I.parts('ids').length > 1, 'not the unknown dot');
});
