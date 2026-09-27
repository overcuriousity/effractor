const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const E = require('../assets/js/architecture-edit.js');
const fixture = name => fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8');
const catalog = JSON.parse(fs.readFileSync('scripts/fixtures/catalog.json', 'utf8'));
const specOf = kind => catalog.entities.filter(e => e.kind === kind)[0];

// nmap on the admin box, which is on the lab network.
function lab() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.1.0/24'] },
    admin: { kind: 'host', label: 'Admin box', addresses: ['10.0.1.50'], parameters: { escape: { status: 'unknown' } } },
  };
  d.associations = { 'admin-lan': { kind: 'attached', from: 'admin', to: 'lan' } };
  return N.addNmap(d, 'admin', 'nmap', specOf).doc;
}
const scan = () => N.read(fixture('route.xml')).scan;
function imported(doc, s, change) {
  const p = N.plan(doc, 'nmap', s, '', {});
  const t = N.defaults(p);
  if (change) change(p, t);
  const edit = N.apply(doc, p, t, specOf, N.stampFor(s, '', s.date));
  return edit && edit.doc;
}
const byLabel = (doc, label) => Object.keys(doc.entities).filter(id => doc.entities[id].label === label)[0];
const kinds = (doc, kind) => Object.keys(doc.entities).filter(id => doc.entities[id].kind === kind);
const attached = (doc, m, n) => Object.values(doc.associations).some(a => a.kind === 'attached' && a.from === m && a.to === n);

test('hops are routers once each, the networks between them named by their ends, the internet cut off', () => {
  const p = N.plan(lab(), 'nmap', scan(), '', {});
  assert.deepEqual(p.routers.map(r => [r.address, r.label, r.known, r.row, r.targets]), [
    ['10.0.1.1', 'gw.lab', null, null, 3],
    ['172.16.0.1', '172.16.0.1', null, null, 1],
    ['172.16.5.1', '172.16.5.1', null, null, 1],
  ]);
  assert.deepEqual(p.links.map(l => [l.label, l.network, l.gap]), [
    ['between gw.lab and 172.16.0.1', null, 0],
    ['between gw.lab and 172.16.5.1 (1 hop unseen)', null, 1],
  ]);
  const [a, b, c] = p.hosts.map(h => p.paths[h.key]);
  assert.deepEqual([a.hops.length, a.cut, a.first, a.last], [2, 0, 'lan', 'new']);
  assert.deepEqual([b.hops.length, b.cut], [2, 0]);
  assert.deepEqual([c.hops.length, c.cut], [1, 2], 'the way over the internet stops at the last private hop');
  assert.equal(N.routeSaid(p, p.hosts[0].key), 'via gw.lab, 172.16.0.1');
  assert.equal(N.routeSaid(p, p.hosts[2].key), 'via gw.lab · then 2 hops on the internet');
  assert.equal(N.said(N.summary(lab(), p, N.defaults(p), null)), 'Adds 6 hosts, 3 networks, 3 routers, 3 services, 1 product, 3 flows.');
});

test('applied: a box and its router per hop, on the networks between, and the flows take the whole way', () => {
  const doc = imported(lab(), scan());
  assert.equal(kinds(doc, 'host').length, 1 + 3 + 3);
  assert.equal(kinds(doc, 'router').length, 3);
  assert.deepEqual(kinds(doc, 'network').map(n => doc.entities[n].label).sort(), ['10.9.0.0/24', 'Lab network', 'between gw.lab and 172.16.0.1', 'between gw.lab and 172.16.5.1 (1 hop unseen)']);
  const gw = byLabel(doc, 'gw.lab'), gwr = byLabel(doc, 'gw.lab router');
  assert.deepEqual(doc.entities[gw].addresses, ['10.0.1.1']);
  assert.equal(doc.entities[gw].seen, '2026-09-27');
  const link1 = byLabel(doc, 'between gw.lab and 172.16.0.1'), far = byLabel(doc, '10.9.0.0/24');
  assert.equal(doc.entities[link1].addresses, undefined, 'a later scan fills it');
  for (const m of [gw, gwr]) for (const n of ['lan', link1]) assert.ok(attached(doc, m, n), m + ' on ' + n);
  const r2 = byLabel(doc, '172.16.0.1 router');
  assert.ok(attached(doc, r2, link1) && attached(doc, r2, far));
  const flows = Object.values(doc.flows);
  assert.deepEqual(flows.map(f => f.route), [
    ['lan', gwr, link1, r2, far],
    ['lan', gwr, byLabel(doc, 'between gw.lab and 172.16.5.1 (1 hop unseen)'), byLabel(doc, '172.16.5.1 router'), far],
    [],
  ]);
});

test('the same scan applied twice draws no router, network or flow twice', () => {
  const once = imported(lab(), scan());
  const p = N.plan(once, 'nmap', scan(), '', {});
  assert.ok(p.routers.every(r => r.known && r.router), 'every hop is a drawn router');
  assert.ok(p.links.every(l => l.network), 'every link is a drawn network');
  assert.equal(N.apply(once, p, N.defaults(p), specOf, N.stampFor(scan(), '', '2026-09-27')), null);
});

test('a drawn network that holds the far hop is the link; a drawn router is used, not added', () => {
  const d = lab();
  d.entities.transit = { kind: 'network', label: 'Transit', addresses: ['172.16.0.0/24'] };
  d.entities.gw = { kind: 'host', label: 'Gateway', addresses: ['10.0.1.1'] };
  d.entities.gwr = { kind: 'router', label: 'Gateway router' };
  d.associations['gw-runs'] = { kind: 'hosts', from: 'gw', to: 'gwr', privilege: 'admin' };
  d.associations['gw-lan'] = { kind: 'attached', from: 'gw', to: 'lan' };
  d.associations['gwr-lan'] = { kind: 'attached', from: 'gwr', to: 'lan' };
  const p = N.plan(d, 'nmap', scan(), '', {});
  assert.deepEqual([p.routers[0].known, p.routers[0].router, p.routers[0].label], ['gw', 'gwr', 'Gateway']);
  assert.equal(p.links[0].network, 'transit');
  const doc = imported(d, scan());
  assert.equal(kinds(doc, 'router').length, 3);
  assert.ok(attached(doc, 'gwr', 'transit') && attached(doc, 'gw', 'transit'));
  assert.deepEqual(Object.values(doc.flows)[0].route.slice(0, 3), ['lan', 'gwr', 'transit']);
});

test('a hop that is a scanned host is that host, preselected as a router; set back to host, there is no way through it', () => {
  const s = scan();
  s.hosts.push({ addresses: ['172.16.0.1'], identities: [], names: [], hostnames: [], hostname: null, vendor: null, os: null, device: [], self: false, ports: [], scripts: [], trace: [], extraports: [] });
  const p = N.plan(lab(), 'nmap', s, '', {});
  const row = p.hosts[3];
  assert.equal(p.routers[1].row, row.key);
  assert.deepEqual([row.role, row.device], ['router', 'on the way to others']);
  const doc = imported(lab(), s);
  assert.equal(kinds(doc, 'host').length, 1 + 4 + 2, 'not drawn twice');
  assert.equal(Object.values(doc.flows)[0].route.length, 5);
  const plain = imported(lab(), s, (pl, t) => { t.roles[pl.hosts[3].key] = 'host'; });
  assert.deepEqual(Object.values(plain.flows)[0].route, []);
  assert.equal(kinds(plain, 'router').length, 2);
});

test('an unticked router is not drawn, and the flows through it have no route', () => {
  const doc = imported(lab(), scan(), (p, t) => { t.routers[p.routers[1].key] = false; });
  assert.equal(kinds(doc, 'router').length, 2);
  assert.equal(byLabel(doc, 'between gw.lab and 172.16.0.1'), undefined);
  assert.deepEqual(Object.values(doc.flows).map(f => f.route.length), [0, 5, 0]);
});

test('a scan without traces plans and applies as before', () => {
  const s = N.read(fixture('deep-lab.xml')).scan;
  const p = N.plan(lab(), 'nmap', s, '', {});
  assert.deepEqual([p.routers, p.links, p.paths], [[], [], {}]);
});

test('the route import is the document the Rust and wasm checks validate', () => {
  const out = imported(lab(), scan());
  const file = 'scripts/fixtures/nmap/imported-route.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});
