const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/clusters.js');
const LECTURE = require('./fixtures/architecture.doc.json');
const IMPORTED = require('./fixtures/nmap/imported.doc.json');
const ROUTERS = require('./fixtures/nmap/imported-router.doc.json');

const copy = (d) => JSON.parse(JSON.stringify(d));

test('what runs together: a host, its software and the products only it uses', () => {
  assert.deepEqual(C.together(IMPORTED), [
    { id: 'admin-box', label: IMPORTED.entities['admin-box'].label, members: ['admin-box', 'nmap'] },
    { id: 'srv', label: IMPORTED.entities.srv.label, members: ['srv', 'sshd', 'tcp-8443', 'domain', 'unidentified-tcp-8443-on-server', 'dnsmasq-2-90'] },
    { id: 'printer', label: IMPORTED.entities.printer.label, members: ['printer', 'ssh'] },
  ], 'openssh runs on two hosts and stays alone');
});

test('a box with a router brings the router and its firewall', () => {
  const groups = C.together(ROUTERS);
  const box = groups.find((g) => g.id === 'opnsense-lab');
  assert.deepEqual(box.members, ['opnsense-lab', 'opnsense-lab-router', 'opnsense-lab-firewall', 'https', 'lighttpd']);
  assert.equal(C.lead(ROUTERS, box.members), 'router', 'the more specific icon wins');
  assert.equal(C.lead(ROUTERS, ['altiera', 'nmap']), 'host');
});

function withoutHosting() {
  const d = copy(LECTURE);
  for (const [k, a] of Object.entries(d.associations)) if (a.kind === 'hosts' || a.kind === 'filters') delete d.associations[k];
  return d;
}

test('an nmap import collapses by host in one press', () => {
  const edit = C.toggleAll(IMPORTED);
  assert.equal(Object.keys(edit.doc.clusters).length, 3);
  assert.ok(Object.values(edit.doc.clusters).every((c) => c.closed === true));
  assert.equal(edit.select, undefined, 'the selection stays');
  assert.match(edit.notice, /3 clusters/);
  // Pressed again: all open; again: all closed. Nothing is ever removed.
  const open = C.toggleAll(edit.doc);
  assert.ok(Object.values(open.doc.clusters).every((c) => c.closed === false));
  const closed = C.toggleAll(open.doc);
  assert.ok(Object.values(closed.doc.clusters).every((c) => c.closed === true));
  assert.equal(Object.keys(closed.doc.clusters).length, 3);
  assert.equal(C.toggleAll(withoutHosting()), null, 'nothing runs together');
});

test('a hand-made cluster takes its members from wherever they were', () => {
  const doc = C.make(IMPORTED, ['srv', 'sshd', 'srv', 'nowhere']).doc;
  const [cid] = Object.keys(doc.clusters);
  assert.deepEqual(doc.clusters[cid], { label: IMPORTED.entities.srv.label + ' +1', members: ['srv', 'sshd'], closed: true });
  assert.equal(C.make(IMPORTED, ['srv']), null, 'two or more');
  // Taking both members of it into another dissolves it.
  const next = C.make(doc, ['srv', 'sshd', 'printer'], 'Rack');
  assert.equal(next.select, 'cluster/rack');
  assert.deepEqual(Object.keys(next.doc.clusters), ['rack']);
  assert.equal(C.clusterOf(next.doc, 'printer'), 'rack');
});

test('taking out, moving over, dissolving, renaming, opening', () => {
  const doc = C.build(IMPORTED).doc;
  assert.equal(C.label(doc, 'srv'), IMPORTED.entities.srv.label);
  let edit = C.takeOut(doc, 'srv', 'domain');
  assert.equal(edit.select, 'entity/domain');
  assert.equal(edit.doc.clusters.srv.members.includes('domain'), false);
  // One left dissolves it.
  edit = C.takeOut(doc, 'printer', 'ssh');
  assert.equal('printer' in edit.doc.clusters, false);
  assert.match(edit.notice, /dissolved/);
  edit = C.moveTo(doc, 'ssh', 'srv');
  assert.equal(C.clusterOf(edit.doc, 'ssh'), 'srv');
  assert.equal('printer' in edit.doc.clusters, false, 'left with one: dissolved');
  assert.equal(C.moveTo(doc, 'sshd', 'srv'), null, 'already there');
  assert.equal(C.rename(doc, 'srv', '  Server rack ').doc.clusters.srv.label, 'Server rack');
  assert.equal('label' in C.rename(doc, 'srv', '').doc.clusters.srv, false, 'empty: the first member names it');
  assert.equal(C.setClosed(doc, 'srv', false).doc.clusters.srv.closed, false);
  assert.equal(C.setClosed(doc, 'srv', true), null, 'already closed');
  const gone = C.dissolve(doc, 'srv');
  assert.equal('srv' in gone.doc.clusters, false);
  assert.deepEqual(Object.keys(gone.doc.entities), Object.keys(doc.entities), 'members stay');
  assert.equal('clusters' in C.dissolve(C.dissolve(gone.doc, 'printer').doc, 'admin-box').doc, false, 'no empty map left');
});

test('a cluster qualified id expands to its members', () => {
  const doc = C.build(IMPORTED).doc;
  assert.deepEqual(C.entitiesOf(doc, ['cluster/printer', 'entity/nmap', 'entity/printer']), ['printer', 'ssh', 'nmap']);
});

test('labels of hand-made clusters without one', () => {
  const doc = copy(IMPORTED);
  doc.clusters = { c: { members: ['srv', 'sshd', 'domain'], closed: true } };
  assert.equal(C.label(doc, 'c'), IMPORTED.entities.srv.label + ' +2');
});

test('ring sectors: one per member up to twelve, else one per state', () => {
  const four = C.segments(['vulnerable', null, 'unknown', null]);
  assert.equal(four.length, 4);
  assert.deepEqual(four.map((s) => s.state), ['vulnerable', null, 'unknown', null]);
  assert.ok(four[0].from > -Math.PI / 2 && four[0].to < 0, 'first sector clockwise from the top, with a gap');
  assert.ok(four.every((s) => s.to > s.from));
  const many = C.segments(Array.from({ length: 20 }, (_, i) => (i < 5 ? 'vulnerable' : null)));
  assert.deepEqual(many.map((s) => s.state), ['vulnerable', null]);
  const share = (s) => s.to - s.from;
  assert.ok(Math.abs(share(many[0]) / (share(many[0]) + share(many[1])) - 0.25) < 0.02, 'sized by count');
  assert.deepEqual(C.segments(Array(20).fill(null)), [{ state: null, full: true }]);
  assert.equal(C.arc(0, 0, 10, -Math.PI / 2, 0), 'M0 -10A10 10 0 0 1 10 0');
});

test('a rectangle picks what its centre is inside of', () => {
  const nodes = [
    { id: 'entity/a', x: 0, y: 0, width: 148, height: 84, hub: { x: 74, y: 24, r: 28 } },
    { id: 'entity/b', x: 300, y: 0, width: 148, height: 84, hub: { x: 74, y: 24, r: 28 } },
  ];
  assert.deepEqual(C.within(nodes, { x0: 200, y0: 100, x1: -10, y1: -10 }), ['entity/a']);
  assert.deepEqual(C.within(nodes, { x0: -10, y0: -10, x1: 500, y1: 60 }), ['entity/a', 'entity/b']);
});

test('closing and opening in place', () => {
  assert.deepEqual(C.closeAt([{ x: 0, y: 0 }, { x: 100, y: 50 }]), { x: 50, y: 25 });
  assert.equal(C.closeAt([]), null);
  // Opened where the cluster now stands: members keep their spacing.
  const moved = C.reopen({ x: 1000, y: 500 }, ['a', 'b', 'c'], { a: { x: 0, y: 0 }, b: { x: 100, y: 50 } });
  assert.deepEqual(moved, { a: { x: 950, y: 475 }, b: { x: 1050, y: 525 } });
  assert.deepEqual(C.reopen({ x: 0, y: 0 }, ['a'], {}), {});
});

test('what glides from where when clusters open and close', () => {
  const before = { a: 'cluster/k', b: 'cluster/k', c: 'cluster/m', d: 'cluster/m' };
  const after = { c: 'cluster/n', d: 'cluster/n', e: 'cluster/q', f: 'cluster/q' };
  const t = C.transitions(before, after);
  // k opened: its members come out of it.
  assert.deepEqual(t.origins['entity/a'], ['cluster/k']);
  assert.deepEqual(t.origins['entity/b'], ['cluster/k']);
  // q closed: it grows from its members, which go into it.
  assert.deepEqual(t.origins['cluster/q'], ['entity/e', 'entity/f']);
  assert.equal(t.exits['entity/e'], 'cluster/q');
  assert.equal(t.exits['entity/f'], 'cluster/q');
  // m became n (renamed or remade): n comes from where m was.
  assert.deepEqual(t.origins['cluster/n'], ['cluster/m']);
  assert.equal(t.exits['cluster/m'], 'cluster/n');
  assert.deepEqual(C.transitions(null, null), { origins: {}, exits: {} });
});

test('K: nothing selected toggles all; one opens or closes its cluster; several merge', () => {
  const doc = C.build(IMPORTED).doc;
  // Nothing selected: the rail's toggle.
  assert.deepEqual(C.pressK(doc, []).doc, C.toggleAll(doc).doc);
  // A cluster, or a member of one: that cluster opens, or closes; it stays.
  const opened = C.pressK(doc, ['cluster/srv']);
  assert.equal(opened.doc.clusters.srv.closed, false);
  assert.equal(opened.select, 'cluster/srv');
  assert.equal(C.pressK(opened.doc, ['cluster/srv']).doc.clusters.srv.closed, true);
  const byMember = C.pressK(doc, ['entity/domain']);
  assert.equal(byMember.doc.clusters.srv.closed, false);
  assert.equal(byMember.select, 'entity/domain', 'the member stays selected');
  // A component in no cluster: nothing to do, and why.
  const alone = C.pressK(doc, ['entity/openssh']);
  assert.equal(alone.doc, undefined);
  assert.match(alone.refusal, /no cluster/);
  // Several, clusters among them: one cluster of all their members.
  const merged = C.pressK(doc, ['cluster/printer', 'cluster/admin-box', 'entity/openssh']).doc;
  assert.deepEqual(Object.keys(merged.clusters).sort(), ['printer', 'srv'], 'admin-box merged away; the new one named after its first');
  assert.deepEqual(merged.clusters.printer.members, ['printer', 'ssh', 'admin-box', 'nmap', 'openssh']);
  assert.match(C.pressK(doc, ['entity/openssh', 'entity/openssh']).refusal || '', /two or more/);
});

test('an open cluster selected lights its members', () => {
  const doc = C.build(IMPORTED).doc;
  doc.clusters.srv.closed = false;
  assert.deepEqual(C.lit(doc, ['cluster/srv']), ['cluster/srv'].concat(doc.clusters.srv.members.map((m) => 'entity/' + m)));
  assert.deepEqual(C.lit(doc, ['cluster/printer', 'entity/openssh']), ['cluster/printer', 'entity/openssh'], 'a closed one is its node');
});

test('a member dragged out of a closed cluster stays in it, drawn beside it', () => {
  const doc = C.build(IMPORTED).doc;
  const out = C.peel(doc, 'srv', 'domain');
  assert.equal(out.select, 'entity/domain');
  assert.deepEqual(out.doc.clusters.srv.shown, ['domain']);
  assert.equal(out.doc.clusters.srv.closed, true);
  assert.equal(C.clusterOf(out.doc, 'domain'), 'srv', 'still a member');
  assert.equal(C.peel(out.doc, 'srv', 'domain'), null, 'already out');
  // Back onto the cluster: stacked again.
  const back = C.unpeel(out.doc, 'srv', 'domain');
  assert.equal('shown' in back.doc.clusters.srv, false);
  // The last one stacked, dragged out: the cluster just opens.
  let d = C.build(IMPORTED).doc;
  d = C.peel(d, 'printer', 'ssh').doc;
  const last = C.peel(d, 'printer', 'printer').doc.clusters.printer;
  assert.equal(last.closed, false);
  assert.equal('shown' in last, false);
  // Closing or opening puts everyone together again.
  assert.equal('shown' in C.setClosed(out.doc, 'srv', false).doc.clusters.srv, false);
  assert.equal('shown' in C.toggleAll(out.doc).doc.clusters.srv, false);
  // Taking out, or deleting, forgets it; renaming renames it.
  assert.equal('shown' in C.takeOut(out.doc, 'srv', 'domain').doc.clusters.srv, false);
  const renamed = JSON.parse(JSON.stringify(out.doc));
  C.rekey(renamed, 'domain', 'dns');
  assert.deepEqual(renamed.clusters.srv.shown, ['dns']);
  // Selected, the cluster lights what is drawn beside it.
  assert.deepEqual(C.lit(out.doc, ['cluster/srv']), ['cluster/srv', 'entity/domain']);
});

test('dragging one onto another merges them', () => {
  const doc = C.build(IMPORTED).doc;
  // A component onto a cluster: it joins.
  let m = C.merge(doc, 'entity/openssh', 'cluster/srv');
  assert.equal(C.clusterOf(m.doc, 'openssh'), 'srv');
  // A cluster onto a cluster: the target takes the members, keeps its name.
  m = C.merge(doc, 'cluster/printer', 'cluster/srv');
  assert.equal('printer' in m.doc.clusters, false);
  assert.deepEqual(m.doc.clusters.srv.members.slice(-2), ['printer', 'ssh']);
  assert.equal(m.doc.clusters.srv.label, doc.clusters.srv.label);
  assert.equal(m.select, 'cluster/srv');
  // A cluster onto a component: the cluster takes it in.
  m = C.merge(doc, 'cluster/printer', 'entity/openssh');
  assert.equal(C.clusterOf(m.doc, 'openssh'), 'printer');
  // Two loose components: a new cluster, named after the target, first.
  const loose = JSON.parse(JSON.stringify(IMPORTED));
  m = C.merge(loose, 'entity/openssh', 'entity/lan');
  const [cid] = Object.keys(m.doc.clusters);
  assert.deepEqual(m.doc.clusters[cid].members, ['lan', 'openssh']);
  assert.equal(m.doc.clusters[cid].label, IMPORTED.entities.lan.label + ' +1');
  // Onto a member of an open cluster: it joins that one.
  const open = C.setClosed(doc, 'srv', false).doc;
  assert.equal(C.clusterOf(C.merge(open, 'entity/openssh', 'entity/sshd').doc, 'openssh'), 'srv');
  // Back onto its own cluster from beside it: stacked again; else nothing.
  const peeled = C.peel(doc, 'srv', 'domain').doc;
  assert.equal('shown' in C.merge(peeled, 'entity/domain', 'cluster/srv').doc.clusters.srv, false);
  assert.equal(C.merge(doc, 'entity/sshd', 'cluster/srv'), null);
  // Two members of an open cluster: they become its stack, the rest beside it.
  const stacked = C.merge(open, 'entity/sshd', 'entity/domain');
  assert.equal(stacked.select, 'cluster/srv');
  assert.equal(stacked.doc.clusters.srv.closed, true);
  assert.deepEqual(stacked.doc.clusters.srv.shown, ['srv', 'tcp-8443', 'unidentified-tcp-8443-on-server', 'dnsmasq-2-90']);
  // Two more beside the stack: into the stack too, the one stack there is.
  const more = C.merge(stacked.doc, 'entity/tcp-8443', 'entity/srv').doc;
  assert.deepEqual(more.clusters.srv.shown, ['unidentified-tcp-8443-on-server', 'dnsmasq-2-90']);
  // The last two beside it: everyone stacked, a plain closed cluster.
  const all = C.merge(more, 'entity/dnsmasq-2-90', 'entity/unidentified-tcp-8443-on-server').doc.clusters.srv;
  assert.equal(all.closed, true);
  assert.equal('shown' in all, false);
  assert.equal(C.merge(doc, 'cluster/srv', 'cluster/srv'), null);
});

test('a cluster just opened pushes what it now overlaps away, and stays', () => {
  const n = (id, x, y) => ({ id, x, y, width: 148, height: 84 });
  const placed = {
    nodes: [n('entity/a', 0, 0), n('entity/b', 160, 0), n('entity/c', 200, 40), n('entity/far', 1000, 0)],
    outlines: [{ id: 'cluster/k', x: -10, y: -10, width: 328, height: 104, members: ['entity/a', 'entity/b'] }],
  };
  const moved = C.spread(placed, ['cluster/k'], 20);
  assert.equal(moved['entity/a'], undefined, 'the opened one stays');
  assert.equal(moved['entity/b'], undefined);
  assert.equal(moved['entity/far'], undefined, 'what is clear stays');
  const c = moved['entity/c'];
  assert.ok(c, 'c moved');
  const clear = c.x >= 318 + 20 || c.y >= 94 + 20;
  assert.ok(clear, 'c is clear of the outline: ' + JSON.stringify(c));
  assert.deepEqual(C.opened({ origins: { 'entity/a': ['cluster/k'], 'cluster/q': ['entity/x'] }, exits: {} }), ['cluster/k']);
});
