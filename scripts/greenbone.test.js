const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const G = require('../assets/js/greenbone.js');
const S = require('../assets/js/scanners.js');
const E = require('../assets/js/architecture-edit.js');

// Greenbone beside nmap (roadmap greenbone-import): a GVM report read into
// the scan nmap.js plans from. The fixture is hand-written in the shape of
// GVM 9 and 22.6 XML reports.
const fixture = name => fs.readFileSync('scripts/fixtures/' + name, 'utf8');
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const report = () => G.read(fixture('greenbone/lab.xml')).scan;

test('a report reads its hosts, their names, OS, MAC, open ports and products', () => {
  const scan = report();
  assert.equal(scan.tool, 'greenbone');
  assert.equal(scan.date, '2026-09-27');
  assert.equal(scan.task, 'Lab network');
  assert.deepEqual(scan.hosts.map(h => h.addresses), [['10.0.1.5'], ['10.0.1.7'], ['10.0.1.30']]);
  const [srv, other, db] = scan.hosts;
  assert.deepEqual(srv.names, [{ name: 'srv-01.lab', from: 'Greenbone' }]);
  assert.equal(srv.hostname, 'srv-01.lab');
  assert.deepEqual(srv.os, { name: 'Ubuntu 24.04', accuracy: null });
  assert.deepEqual(srv.identities, ['mac:52:54:00:12:34:56']);
  assert.deepEqual(srv.ports.map(p => [p.protocol + '/' + p.port, p.service.name, p.service.product]), [
    ['tcp/22', 'ssh', 'openssh 9.6p1'],
    ['tcp/8443', 'https-alt', null],
    ['udp/53', 'domain', 'dnsmasq 2.90'],
  ], 'from the details, the ports with results and a Log result; products from their CPE');
  assert.deepEqual(other.ports.map(p => p.port), [22]);
  assert.equal(db.ports[0].service.product, 'mysql 8.0.36', 'the product of a finding\'s detection');
});

test('a finding: CVEs and severity, on its port or on the host; Log and false positives are none', () => {
  const [srv, , db] = report().hosts;
  assert.deepEqual(srv.ports[0].findings, [{
    source: 'Greenbone',
    key: '1.3.6.1.4.1.25623.1.0.114674',
    title: 'OpenSSH 8.5p1 - 9.7p1 RCE Vulnerability (regreSSHion) - Active Check',
    state: 'High 8.1',
    ids: ['CVE:CVE-2024-6387'],
  }], 'the false positive on the same port is left out');
  assert.deepEqual(srv.ports[2].findings, [], 'a Log result says the port is open, not a finding');
  assert.deepEqual(srv.findings.map(f => [f.title, f.state, f.ids]), [['TCP Timestamps Information Disclosure', 'Low 2.6', []]]);
  assert.deepEqual(db.ports[0].findings.map(f => f.ids), [[]]);
});

test('CPE into a product name', () => {
  assert.equal(G.cpeLabel('cpe:/a:openbsd:openssh:9.6p1'), 'openssh 9.6p1');
  assert.equal(G.cpeLabel('cpe:/a:apache:http_server:2.4.58'), 'apache http server 2.4.58');
  assert.equal(G.cpeLabel('cpe:2.3:a:openbsd:openssh:9.6:p1:*:*:*:*:*:*'), 'openssh 9.6p1');
  assert.equal(G.cpeLabel('cpe:/a:nginx:nginx'), 'nginx');
  assert.equal(G.cpeLabel('cpe:/o:canonical:ubuntu_linux:24.04'), null, 'an OS is not a product');
  assert.equal(G.cpeLabel('cpe:/a:x:%E0%A4:1'), '%E0%A4 1', 'a broken escape stays as written');
});

test('what is not a report is said, with where it goes', () => {
  assert.equal(G.read('  ').problem.code, 'empty');
  assert.match(G.read(fixture('nmap/deep-lab.xml')).problem.message, /^This result is from nmap, not Greenbone/);
  assert.match(G.read(fixture('masscan/lab.xml')).problem.message, /^This result is from masscan, not Greenbone/);
  assert.equal(G.read('<html><body>hi</body></html>').problem.code, 'not-report');
  assert.equal(G.read('<report id="x" format_id="y"><report><results>').problem.code, 'truncated');
  assert.equal(G.read('<report id="x" format_id="y"><report><results></results></report></report>').problem.code, 'no-host');
  // A GMP answer is read as the download is.
  const wrapped = '<get_reports_response status="200">' + fixture('greenbone/lab.xml').replace(/^<\?xml[^>]*>/, '') + '</get_reports_response>';
  assert.equal(G.read(wrapped).scan.hosts.length, 3);
  // A report pasted into nmap's dialog says where it goes.
  assert.match(S.read('nmap', fixture('greenbone/lab.xml')).problem.message, /^This result is from Greenbone, not nmap; add Greenbone/);
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
const deep = () => N.read(fixture('nmap/deep-lab.xml')).scan;
function nmapped() {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  return N.apply(d, p, N.defaults(p), specOf, { date: '2026-09-24', recipes: ['services'], range: '10.0.1.0/24' }).doc;
}
function withGreenbone(doc) {
  const added = S.addScanner(doc, 'greenbone', 'admin-box', 'Greenbone', specOf);
  assert.equal(added.doc.entities[added.entity].tool, 'greenbone');
  return { doc: added.doc, app: added.entity };
}
const label = (doc, id) => doc.entities[id].label;

test('after nmap: findings land on the ports and products nmap drew; no host twice', () => {
  const { doc, app } = withGreenbone(nmapped());
  const p = N.plan(doc, app, report(), '10.0.1.0/24', {});
  const [srv, other, db] = p.hosts;
  assert.deepEqual([srv.known, other.known && label(doc, other.known), db.known], ['srv', '10.0.1.7', null]);
  assert.equal(srv.os, 'Greenbone OS guess: Ubuntu 24.04.');
  const ssh = srv.ports.find(r => r.proto === 'tcp/22');
  assert.deepEqual([ssh.known, ssh.addsFlow], ['sshd', false], 'nmap beside it already reaches it');
  assert.deepEqual(ssh.findings.map(f => [f.tag, f.id, f.product, f.line]), [
    ['High 8.1', 'CVE-2024-6387', 'openssh', 'Greenbone: High 8.1, CVE-2024-6387 (OpenSSH 8.5p1 - 9.7p1 RCE Vulnerability (regreSSHion) - Active Check).'],
  ]);
  const tls = srv.ports.find(r => r.proto === 'tcp/8443');
  assert.equal(label(doc, tls.findings[0].product), 'unidentified tcp/8443 on Server', 'the product nmap drew, whatever it knew');
  assert.deepEqual(srv.unplaced.map(f => [f.tag, f.title, f.why]), [['Low 2.6', 'TCP Timestamps Information Disclosure', 'on the host, not a port']]);
  assert.equal(other.ports[0].findings[0].product, 'openssh', 'shared, as nmap drew it');

  const t = N.defaults(p);
  const s = N.summary(doc, p, t, { entities: 500, relationships: 2000 });
  assert.deepEqual([s.hosts, s.networks, s.attached, s.services, s.products, s.flows, s.unpatched], [1, 0, 0, 1, 1, 1, 3]);
  assert.equal(N.said(s), 'Adds 1 host, 1 service, 1 product, 1 flow, marks 3 products unpatched.');
  assert.deepEqual(p.changes.list, [], 'Greenbone names products its own way: no version change offered');

  const out = N.apply(doc, p, t, specOf, S.stampFor('greenbone', report(), '', '2026-09-27')).doc;
  assert.equal(out.entities.openssh.defenses.patched, false);
  assert.equal(out.entities.openssh.parameters['find-exploit'].note, 'Greenbone: High 8.1, CVE-2024-6387 (OpenSSH 8.5p1 - 9.7p1 RCE Vulnerability (regreSSHion) - Active Check).', 'one line, though on two hosts');
  assert.equal(out.entities[app].description, 'Last Greenbone import: 2026-09-27, report of Lab network (scanned 2026-09-27).');
  const db1 = Object.keys(out.entities).find(id => out.entities[id].label === 'db-01.lab');
  assert.deepEqual(out.entities[db1].addresses, ['10.0.1.30']);
  assert.equal(out.entities[db1].description, 'Greenbone OS guess: Debian GNU/Linux 12.');
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'host').length, 4);

  // Again: nothing new.
  const again = N.plan(out, app, report(), '10.0.1.0/24', {});
  const s2 = N.summary(out, again, N.defaults(again), null);
  assert.deepEqual([s2.hosts, s2.services, s2.products, s2.flows, s2.unpatched], [0, 0, 0, 0, 0]);

  const file = 'scripts/fixtures/greenbone/imported.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('before nmap: Greenbone draws, nmap afterwards draws no host twice', () => {
  const { doc, app } = withGreenbone(lab());
  const p = N.plan(doc, app, report(), '10.0.1.0/24', {});
  const other = p.hosts[1];
  assert.equal(other.ports[0].product.existing, 'openssh', '"openssh 9.6p1" is the drawn "OpenSSH 9.6p1"');
  const out = N.apply(doc, p, N.defaults(p), specOf, S.stampFor('greenbone', report(), '', '2026-09-27')).doc;
  const q = N.plan(out, 'nmap', deep(), '10.0.1.0/24', {});
  const s = N.summary(out, q, N.defaults(q), null);
  assert.equal(s.hosts, 0);
  assert.deepEqual(q.hosts.map(h => label(out, h.known)), ['Server', '10.0.1.7']);
  // nmap's own finding lines and Greenbone's are both a scan's, not the author's.
  assert.ok(q.hosts[0].ports.every(r => r.proto !== 'tcp/22' || r.known));
});

// The shape of a real export (owner, 2026-09-27): Greenbone in a rootless
// container, the filter without Log.
test('a report from behind a container\'s NAT, exported without Log, says so', () => {
  const scan = G.read(fixture('greenbone/container.xml')).scan;
  const [router, box] = scan.hosts;
  assert.deepEqual(router.ports.map(p => [p.protocol + '/' + p.port, p.service && p.service.name, p.service && p.service.product]), [
    ['tcp/53', 'domain', null],
    ['tcp/80', 'http', null],
    ['tcp/443', 'https', null],
    ['tcp/5060', 'sip', null],
    ['tcp/49000', 'upnp', null],
  ], 'a protocol\'s CPE is not a product; Greenbone\'s Services name what nmap\'s table does not');
  assert.equal(box.hostname, 'box.home.example');
  assert.deepEqual(G.notes(scan), [
    'The export left out 66 of 69 results, 65 of them Log: in the report\'s filter tick Log and show all rows; Log results name the services.',
    'Every host was reached through 10.89.5.17 first: Greenbone scans from behind it, likely a container\'s network. Hosts that do not answer from there stay unseen; see step 1.',
    '1 check did not finish: Directory Scanner (HTTP).',
  ]);
  assert.deepEqual(G.notes(report()), [], 'the lab report is whole, from inside the network');
});

test('Greenbone is a scanner of its own in the menus', () => {
  assert.deepEqual(S.TOOLS.map(t => [t.id, t.name]), [['nmap', 'nmap'], ['masscan', 'masscan'], ['greenbone', 'Greenbone']]);
});
