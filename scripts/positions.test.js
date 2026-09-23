const { test } = require('node:test');
const assert = require('node:assert/strict');
const Pos = require('../assets/js/positions.js');

const box = (id, x, y) => ({ id, x, y, width: 148, height: 62, node: { id } });
const laid = () => ({
  width: 500, height: 300,
  nodes: [box('entity/a', 0, 0), box('entity/b', 300, 0), box('entity/c', 0, 200)],
  edges: [
    { id: 'association/ab', from: 'entity/a', to: 'entity/b', label: 'hosts · admin', points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
    { id: 'flow/ba', from: 'entity/b', to: 'entity/a', label: 'SSH →', points: [] },
    { id: 'association/ac', from: 'entity/a', to: 'entity/c', points: [] },
  ],
});

test('stored positions win over the automatic layout; the rest stays where it was put', () => {
  const out = Pos.place(laid(), { 'entity/b': { x: 400, y: 100 } });
  assert.equal(out.free, true);
  const b = out.nodes.find((n) => n.id === 'entity/b');
  assert.deepEqual([b.x, b.y], [400, 100]);
  const a = out.nodes.find((n) => n.id === 'entity/a');
  assert.deepEqual([a.x, a.y], [0, 0]);
  // Positions of components that are gone are ignored, not drawn.
  assert.equal(Pos.place(laid(), { 'entity/gone': { x: 1, y: 1 } }).nodes.length, 3);
});

test('the drawing is as large as what is on it, wherever that is', () => {
  const out = Pos.place(laid(), { 'entity/a': { x: -100, y: -50 } });
  assert.equal(out.x0, -100);
  assert.equal(out.y0, -50);
  assert.equal(out.width, 448 + 100);
  assert.equal(out.height, 262 + 50);
});

test('an edge is a curve from border to border, its label halfway', () => {
  const out = Pos.place(laid(), {});
  const ac = out.edges.find((e) => e.id === 'association/ac');
  // a is above c: the line leaves a's bottom edge and meets c's top edge.
  assert.ok(Math.abs(ac.start.y - 62) < 1e-9, JSON.stringify(ac.start));
  assert.ok(Math.abs(ac.end.y - 200) < 1e-9, JSON.stringify(ac.end));
  assert.ok(ac.mid.y > 62 && ac.mid.y < 200);
  assert.equal(ac.from, 'entity/a');
  assert.equal(ac.to, 'entity/c');
  assert.equal(out.edges.find((e) => e.id === 'association/ab').label, 'hosts · admin');
});

test('links between the same two components bend apart, whichever way they point', () => {
  const out = Pos.place(laid(), {});
  const ab = out.edges.find((e) => e.id === 'association/ab');
  const ba = out.edges.find((e) => e.id === 'flow/ba');
  // Both run horizontally between a and b; their middles are on either side.
  const side = (e) => Math.sign(e.mid.y - 31);
  assert.notEqual(side(ab), 0);
  assert.equal(side(ab), -side(ba));
});

test('an edge can be recomputed for one moved node', () => {
  const out = Pos.place(laid(), {});
  const moved = out.nodes.map((n) => (n.id === 'entity/c' ? { ...n, x: 300, y: 300 } : n));
  const edge = out.edges.find((e) => e.id === 'association/ac');
  const again = Pos.route(moved, edge);
  assert.notDeepEqual(again.end, edge.end);
  assert.ok(Math.abs(again.end.x - 300) < 1e-9 || Math.abs(again.end.y - 300) < 1e-9);
});

test('positions are kept per document in the browser, and a broken storage is no error', () => {
  const data = new Map();
  const storage = { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), removeItem: (k) => data.delete(k) };
  const store = Pos.createStore(storage);
  assert.deepEqual(store.load('Lab'), {});
  store.move('Lab', 'entity/a', 10.4, 20.6);
  assert.deepEqual(store.load('Lab'), { 'entity/a': { x: 10, y: 21 } });
  assert.deepEqual(store.load('Other'), {});
  store.clear('Lab');
  assert.deepEqual(store.load('Lab'), {});
  data.set('effractor.positions:Bad', 'not json');
  assert.deepEqual(store.load('Bad'), {});
  const broken = Pos.createStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
  assert.deepEqual(broken.load('Lab'), {});
  broken.move('Lab', 'entity/a', 1, 2);
  broken.clear('Lab');
  // Without any storage it still answers.
  assert.deepEqual(Pos.createStore(null).load('Lab'), {});
});
