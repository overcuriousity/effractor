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

test('an edge is a straight line from border to border, its label halfway', () => {
  const out = Pos.place(laid(), {});
  const ac = out.edges.find((e) => e.id === 'association/ac');
  // a is above c: the line leaves a's bottom edge and meets c's top edge,
  // straight down between their centres.
  assert.deepEqual(ac.start, { x: 74, y: 62 });
  assert.deepEqual(ac.end, { x: 74, y: 200 });
  assert.deepEqual(ac.mid, { x: 74, y: 131 });
  assert.equal(ac.from, 'entity/a');
  assert.equal(ac.to, 'entity/c');
  assert.equal(out.edges.find((e) => e.id === 'association/ab').label, 'hosts · admin');
});

test('links between the same two components run side by side, whichever way they point', () => {
  const out = Pos.place(laid(), {});
  const ab = out.edges.find((e) => e.id === 'association/ab');
  const ba = out.edges.find((e) => e.id === 'flow/ba');
  // Both run straight across between a and b, one above the other.
  for (const e of [ab, ba]) {
    assert.equal(e.start.y, e.end.y, JSON.stringify(e));
    assert.equal(e.mid.y, e.start.y);
  }
  assert.equal(Math.abs(ab.mid.y - ba.mid.y), 20);
  assert.equal(ab.mid.y + ba.mid.y, 62);
});

test('side by side links end on the ring of a component plate', () => {
  const ring = (id, x) => ({ id, x, y: 0, width: 148, height: 62, hub: { x: 74, y: 24, r: 28 } });
  const out = Pos.place({
    nodes: [ring('entity/a', 0), ring('entity/b', 300)],
    edges: [
      { id: 'flow/1', from: 'entity/a', to: 'entity/b' },
      { id: 'flow/2', from: 'entity/a', to: 'entity/b' },
    ],
  }, {});
  for (const e of out.edges) {
    assert.ok(Math.abs(Math.hypot(e.start.x - 74, e.start.y - 24) - 28) < 1e-9, JSON.stringify(e.start));
    assert.ok(Math.abs(Math.hypot(e.end.x - 374, e.end.y - 24) - 28) < 1e-9, JSON.stringify(e.end));
    assert.ok(Math.abs(e.start.y - e.end.y) < 1e-9);
  }
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
  store.moveAll('Lab', { 'entity/a': { x: 10.4, y: 20.6 } });
  assert.deepEqual(store.load('Lab'), { 'entity/a': { x: 10, y: 21 } });
  assert.deepEqual(store.load('Other'), {});
  store.clear('Lab');
  assert.deepEqual(store.load('Lab'), {});
  data.set('effractor.positions:Bad', 'not json');
  assert.deepEqual(store.load('Bad'), {});
  const broken = Pos.createStore({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } });
  assert.deepEqual(broken.load('Lab'), {});
  broken.moveAll('Lab', { 'entity/a': { x: 1, y: 2 } });
  // What the storage refused stays for the page: a dragged component does not snap back.
  assert.deepEqual(broken.load('Lab'), { 'entity/a': { x: 1, y: 2 } });
  broken.moveAll('Lab', { 'entity/b': { x: 3, y: 4 } });
  assert.deepEqual(broken.load('Lab'), { 'entity/a': { x: 1, y: 2 }, 'entity/b': { x: 3, y: 4 } });
  broken.load('Lab')['entity/a'].x = 99;
  assert.equal(broken.load('Lab')['entity/a'].x, 1, 'a copy is handed out');
  broken.clear('Lab');
  assert.deepEqual(broken.load('Lab'), {});
  // Without any storage it still answers, and still holds what was moved.
  const none = Pos.createStore(null);
  assert.deepEqual(none.load('Lab'), {});
  none.moveAll('Lab', { 'entity/a': { x: 5, y: 6 } });
  assert.deepEqual(none.load('Lab'), { 'entity/a': { x: 5, y: 6 } });
});

test('a component with a plate: its lines end on the plate, not on the box around its name', () => {
  const hub = { x: 74, y: 24, r: 24 };
  const out = Pos.place({
    nodes: [{ ...box('entity/a', 0, 0), hub }, { ...box('entity/c', 0, 200), hub }],
    edges: [{ id: 'association/ac', from: 'entity/a', to: 'entity/c' }],
  }, {});
  const ac = out.edges[0];
  const dist = (p, c) => Math.hypot(p.x - c.x, p.y - c.y);
  assert.ok(Math.abs(dist(ac.start, { x: 74, y: 24 }) - 24) < 1e-9, JSON.stringify(ac.start));
  assert.ok(Math.abs(dist(ac.end, { x: 74, y: 224 }) - 24) < 1e-9, JSON.stringify(ac.end));
});

test('a firewall\'s permission runs from its ring to its flow, off the flow\'s middle, and can be left out', () => {
  const hub = { x: 74, y: 24, r: 28 };
  const laid = {
    nodes: [{ ...box('entity/fw', 150, 0), hub }, { ...box('entity/a', 0, 200), hub }, { ...box('entity/b', 300, 200), hub }],
    edges: [{ id: 'flow/f', from: 'entity/a', to: 'entity/b', label: 'f →' }],
    permits: [{ id: 'association/p', firewall: 'entity/fw', flow: 'flow/f', allowed: null }],
  };
  const out = Pos.place(laid, {});
  const flow = out.edges[0];
  assert.equal(out.attachments.length, 1);
  const p = out.attachments[0];
  // On the flow, off its middle (where the flow's label is), on the firewall's side.
  const candidates = [Pos.along(flow, 0.35), Pos.along(flow, 0.65)];
  assert.ok(candidates.some((c) => Math.abs(c.x - p.end.x) < 1e-9 && Math.abs(c.y - p.end.y) < 1e-9), JSON.stringify(p.end));
  const d = (q) => Math.hypot(q.x - 224, q.y - 24);
  assert.equal(d(p.end), Math.min(...candidates.map(d)));
  assert.ok(Math.abs(Math.hypot(p.start.x - 224, p.start.y - 24) - 28) < 1e-9, JSON.stringify(p.start));
  assert.equal(p.label, '?');
  assert.equal(Pos.attach(out.nodes, flow, { ...laid.permits[0], allowed: true }).label, 'allows');
  assert.equal(Pos.attach(out.nodes, flow, { ...laid.permits[0], allowed: false }).label, 'blocks');
  assert.deepEqual(Pos.place(laid, {}, { permits: false }).attachments, []);
  assert.deepEqual(Pos.place({ ...laid, permits: [{ ...laid.permits[0], flow: 'flow/gone' }] }, {}).attachments, []);
});

test('an open cluster’s outline wraps its members; a permission may end on a node', () => {
  const at = {
    'entity/a': { id: 'entity/a', x: 0, y: 0, width: 148, height: 84 },
    'entity/b': { id: 'entity/b', x: 200, y: 100, width: 148, height: 84 },
    'cluster/k': { id: 'cluster/k', x: 600, y: 0, width: 148, height: 84, hub: { x: 74, y: 24, r: 28 } },
  };
  const o = Pos.outline(at, { id: 'cluster/c', label: 'C', members: ['entity/a', 'entity/b', 'entity/gone'] });
  assert.deepEqual([o.x, o.y, o.width, o.height], [-10, -10, 368, 204]);
  assert.equal(Pos.outline(at, { id: 'cluster/d', label: 'D', members: ['entity/gone'] }), null);
  const line = Pos.attach(at, null, { id: 'permits/x', firewall: 'entity/a', node: 'cluster/k', allowed: null, label: '2 permissions' });
  assert.equal(line.label, '2 permissions');
  assert.equal(line.node, 'cluster/k');
  assert.ok(line.end.x < 600 + 74, 'ends on the ring');
  // The outline is part of what is drawn: the drawing's size includes it.
  const placed = Pos.place({ nodes: Object.values(at), edges: [], permits: [], groups: [{ id: 'cluster/c', label: 'C', members: ['entity/a', 'entity/b'] }] }, {}, {});
  assert.equal(placed.outlines.length, 1);
  assert.equal(placed.x0, -10);
});

test('cluster outlines can be switched off', () => {
  const at = [{ id: 'entity/a', x: 0, y: 0, width: 148, height: 84 }, { id: 'entity/b', x: 200, y: 100, width: 148, height: 84 }];
  const laid = { nodes: at, edges: [], permits: [], groups: [{ id: 'cluster/c', label: 'C', members: ['entity/a', 'entity/b'] }] };
  assert.equal(Pos.place(laid, {}, {}).outlines.length, 1);
  const off = Pos.place(laid, {}, { outlines: false });
  assert.deepEqual(off.outlines, []);
  assert.equal(off.x0, 0, 'nothing drawn, nothing measured');
});

test('review: many positions are written, and forgotten, in one go', () => {
  const saved = [];
  const storage = { data: {}, getItem(k) { return this.data[k] || null; }, setItem(k, v) { saved.push(k); this.data[k] = v; }, removeItem(k) { delete this.data[k]; } };
  const store = Pos.createStore(storage);
  store.moveAll('doc', { 'entity/a': { x: 1, y: 2 } });
  saved.length = 0;
  store.moveAll('doc', { 'entity/b': { x: 3.4, y: 4 }, 'entity/c': { x: 5, y: 6 }, 'entity/a': null });
  assert.equal(saved.length, 1, 'one write');
  assert.deepEqual(store.load('doc'), { 'entity/b': { x: 3, y: 4 }, 'entity/c': { x: 5, y: 6 } });
});
