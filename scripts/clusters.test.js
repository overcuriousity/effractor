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
