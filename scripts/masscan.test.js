const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const M = require('../assets/js/masscan.js');
const S = require('../assets/js/scanners.js');
const E = require('../assets/js/architecture-edit.js');

// masscan beside nmap (roadmap scanner-readers): its -oX is nmap's shape,
// read by nmap's reader into the same scan; one application per tool.
const fixture = name => fs.readFileSync('scripts/fixtures/' + name, 'utf8');
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];

test('a masscan result reads as one host per machine, every port once, named', () => {
  const { scan } = M.read(fixture('masscan/lab.xml'));
  assert.equal(scan.tool, 'masscan');
  assert.equal(scan.date, '2026-09-27');
  assert.deepEqual(scan.hosts.map(h => h.addresses), [['10.0.1.7'], ['10.0.1.5']], 'no <status>: a listed host answered');
  const srv = scan.hosts[1];
  assert.deepEqual(srv.ports.map(p => [p.protocol + '/' + p.port, p.state, p.service && p.service.name]), [
    ['tcp/8443', 'open', 'https-alt'],
    ['tcp/22', 'open', 'ssh'],
    ['udp/53', 'open', 'domain'],
  ], 'a page title is not a service; the port number names it as nmap would');
  assert.ok(srv.ports.every(p => p.service.product === null), 'a banner is not a product');
  assert.deepEqual(srv.identities, []);
});

test('each result goes to its own tool, said where it goes', () => {
  const nmapXml = fixture('nmap/deep-lab.xml');
  assert.match(M.read(nmapXml).problem.message, /^This result is from nmap, not masscan; add nmap/);
  assert.match(N.read(fixture('masscan/lab.xml')).problem.message, /^This result is from masscan, not nmap; add masscan/);
  assert.equal(M.read('').problem.code, 'empty');
  assert.match(M.read('Discovered open port 22/tcp on 10.0.1.5').problem.message, /-oX -/);
  assert.match(M.read('<foo/>').problem.message, /not a masscan result/);
});

test('the command: the ports and the speed chosen, only addresses in the range', () => {
  const r = '10.0.1.0/24';
  assert.equal(M.command({}, r).text, 'sudo masscan -p' + M.PORTS[0].ports + ' --rate 1000 -oX - 10.0.1.0/24');
  assert.equal(M.command({ ports: 'tcp', rate: '100' }, r + ' 10.0.2.1-10.0.2.9').text, 'sudo masscan -p1-65535 --rate 100 -oX - 10.0.1.0/24 10.0.2.1-10.0.2.9');
  assert.equal(M.command({ ports: 'both' }, 'fd00::/120').text, 'sudo masscan -p1-65535,U:53,U:123,U:161,U:500 --rate 1000 -oX - fd00::/120');
  assert.match(M.command({ rate: '10000' }, r).warning, /overload/);
  for (const bad of ['srv-01.lab', '10.0.0.1; id', '$(id)', '-oX x', '10.0.1.0/24 --adapter-ip 1.2.3.4', '10.0.0.300']) {
    assert.equal(M.command({}, bad).text, undefined, bad);
    assert.match(M.command({}, bad).problem, /addresses/, bad);
  }
  assert.match(M.command({}, ' ').problem, /range/);
});

// The nmap lab: nmap on the admin box, Server 10.0.1.5 with ssh on OpenSSH.
function lab() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.1.0/24'] },
    'admin-box': { kind: 'host', label: 'Admin box' },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    srv: { kind: 'host', label: 'Server', addresses: ['10.0.1.5'] },
    sshd: { kind: 'service', label: 'ssh' },
    openssh: { kind: 'product', label: 'OpenSSH 9.6p1' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'admin-box', to: 'lan' },
    a2: { kind: 'attached', from: 'srv', to: 'lan' },
    a3: { kind: 'hosts', from: 'admin-box', to: 'nmap', privilege: 'user' },
    a4: { kind: 'hosts', from: 'srv', to: 'sshd', privilege: 'admin' },
    a5: { kind: 'instance-of', from: 'sshd', to: 'openssh' },
  };
  d.flows = { f1: { label: 'ssh on Server', source: 'nmap', target: 'sshd', route: ['lan'], protocol: 'tcp/22' } };
  return d;
}
// The lab after nmap's deep scan, with masscan beside nmap on the admin box.
function afterNmap() {
  const d = lab();
  const deep = N.read(fixture('nmap/deep-lab.xml')).scan;
  const p = N.plan(d, 'nmap', deep, '10.0.1.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, { date: '2026-09-24', recipes: ['services'], range: '10.0.1.0/24' }).doc;
  const added = S.addScanner(out, 'masscan', 'admin-box', 'masscan', specOf);
  assert.equal(added.doc.entities[added.entity].tool, 'masscan');
  return { doc: added.doc, app: added.entity };
}

test('masscan after nmap on the same hosts adds nothing twice', () => {
  const { doc, app } = afterNmap();
  const scan = M.read(fixture('masscan/lab.xml')).scan;
  const p = N.plan(doc, app, scan, '10.0.1.0/24', {});
  assert.deepEqual(p.hosts.map(h => h.known).map(id => doc.entities[id].label), ['10.0.1.7', 'Server']);
  const s = N.summary(doc, p, N.defaults(p), { entities: 500, relationships: 2000 });
  assert.deepEqual([s.hosts, s.networks, s.attached, s.services, s.products, s.flows, s.unpatched, s.changes], [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(N.said(s), 'Notes 2 hosts as seen.', 'what it adds is the day it saw them');
  assert.deepEqual(p.changes.list, [], 'masscan says nothing of versions, closed ports or missing hosts');
});

test('what masscan adds after nmap: a new host, new ports, flows from masscan', () => {
  const { doc, app } = afterNmap();
  const scan = M.read(fixture('masscan/new-lab.xml')).scan;
  const p = N.plan(doc, app, scan, '10.0.1.0/24', {});
  const s = N.summary(doc, p, N.defaults(p), null);
  assert.deepEqual([s.hosts, s.networks, s.services, s.products, s.flows], [1, 0, 3, 3, 3]);
  const stamp = S.stampFor('masscan', scan, '10.0.1.0/24', '2026-09-27');
  const out = N.apply(doc, p, N.defaults(p), specOf, stamp).doc;
  assert.equal(out.entities[app].description, 'Last masscan import: 2026-09-27, scan of 10.0.1.0/24.');
  const flows = Object.values(out.flows).filter(f => f.source === app);
  assert.deepEqual(flows.map(f => [f.label, f.protocol, f.route]).sort(), [
    ['http-proxy on 10.0.1.7', 'tcp/8080', ['lan']],
    ['microsoft-ds on 10.0.1.20', 'tcp/445', ['lan']],
    ['ms-wbt-server on 10.0.1.20', 'tcp/3389', ['lan']],
  ]);
  // Again: nothing, and the stamp is replaced, not added.
  const again = N.plan(out, app, scan, '10.0.1.0/24', {});
  const s2 = N.summary(out, again, N.defaults(again), null);
  assert.deepEqual([s2.hosts, s2.services, s2.products, s2.flows], [0, 0, 0, 0]);
  const twice = N.apply(out, again, N.defaults(again), specOf, S.stampFor('masscan', scan, '10.0.1.0/24', '2026-09-28'));
  assert.equal(twice, null, 'the same day again is nothing to add');

  const file = 'scripts/fixtures/masscan/imported.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('nmap after masscan names what masscan found and adds no second service', () => {
  const d = lab();
  const added = S.addScanner(d, 'masscan', 'admin-box', 'masscan', specOf);
  const m = M.read(fixture('masscan/new-lab.xml')).scan;
  const p = N.plan(added.doc, added.entity, m, '10.0.1.0/24', {});
  const out = N.apply(added.doc, p, N.defaults(p), specOf, S.stampFor('masscan', m, '10.0.1.0/24', '2026-09-27')).doc;
  const again = { tool: 'nmap', args: '', silentUdp: 0, date: '2026-09-28', hosts: [{ addresses: ['10.0.1.20'], hostname: null, os: null, ports: [
    { protocol: 'tcp', port: 3389, state: 'open', service: { name: 'ms-wbt-server', product: 'Microsoft Terminal Services', version: null }, scripts: [] },
  ] }] };
  const q = N.plan(out, 'nmap', again, '10.0.1.0/24', {});
  const row = q.hosts[0].ports[0];
  assert.ok(row.known, 'the service masscan drew');
  assert.equal(row.addsFlow, false, 'masscan beside nmap already reaches it');
  const s = N.summary(out, q, N.defaults(q), null);
  assert.deepEqual([s.hosts, s.services, s.flows], [0, 0, 0]);
});

test('scanners are one application each, named in their menus', () => {
  assert.deepEqual(S.TOOLS.slice(0, 2).map(t => [t.id, t.name]), [['nmap', 'nmap'], ['masscan', 'masscan']]);
  assert.equal(S.tool({ kind: 'application', tool: 'masscan' }).name, 'masscan');
  assert.equal(S.tool({ kind: 'host' }), null);
  const loose = S.addScanner(E.empty(), 'masscan', null, 'masscan', specOf);
  assert.deepEqual(Object.keys(loose.doc.associations), []);
  assert.equal(S.addScanner(E.empty(), 'zmap', null, 'zmap', specOf), null);
});

test('masscan asks which ports are open, and nothing else (scan workflow spec §3)', () => {
  const { scan } = M.read(fixture('masscan/lab.xml'));
  assert.deepEqual(scan.asks, ['ports']);
  const d = E.empty();
  const added = S.addScanner(d, 'masscan', null, 'masscan', specOf);
  const p = N.plan(added.doc, added.entity, scan, '10.0.1.0/24', {});
  const out = N.apply(added.doc, p, N.defaults(p), specOf, S.stampFor('masscan', scan, '10.0.1.0/24', '2026-09-27')).doc;
  const hosts = Object.values(out.entities).filter(e => e.kind === 'host');
  assert.equal(hosts.length, 2);
  for (const h of hosts) assert.deepEqual(h.asked, { ports: '2026-09-27' });
});
