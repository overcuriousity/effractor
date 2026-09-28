const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const Nu = require('../assets/js/nuclei.js');
const S = require('../assets/js/scanners.js');
const T = require('../assets/js/nuclei-templates.js');
const E = require('../assets/js/architecture-edit.js');
const P = require('../assets/js/nmap-products.js');

// What is there (nuclei templates spec §4, §5, §7): the answers of
// effractor's own templates read into products, applications and names.
// identify.jsonl is what nuclei 3.11.0 wrote against the lab of
// scripts/dev/nuclei-lab.py, rewritten to the lab's addresses.
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const text = () => fs.readFileSync('scripts/fixtures/nuclei/identify.jsonl', 'utf8');
const lines = () => text().trim().split('\n').map(l => JSON.parse(l));
const written = list => list.map(r => JSON.stringify(r)).join('\n') + '\n';
const result = () => Nu.read(text()).scan;
const host = (scan, address) => scan.hosts.find(h => h.addresses.includes(address));
const port = (scan, address, number) => host(scan, address).ports.find(p => p.port === number);
const STAMP = () => S.stampFor('nuclei', result(), '10.0.2.0/24', '2026-09-28');

test('the fixture holds every answer of the identify templates', () => {
  const seen = new Set(lines().map(r => r['extractor-name']));
  const asked = T.ANSWERS.filter(a => T.TEMPLATES.find(t => t.id === a.template).group === 'identify').map(a => a.name);
  assert.deepEqual(asked.filter(n => !seen.has(n)), [], 'record again: python3 scripts/dev/nuclei-lab.py record identify');
  for (const r of lines()) assert.match(r['template-id'], /^effractor-(banner|web|certificate)$/);
});

test('a banner names the product and its version, spelled as nmap spells it', () => {
  const scan = result();
  assert.equal(scan.tool, 'nuclei');
  assert.deepEqual([scan.results, scan.informational, scan.answers, scan.unknown, scan.refused], [0, 0, lines().length, 0, 0]);
  assert.deepEqual(host(scan, '10.0.2.5').ports.map(p => [p.port, p.service.name, p.service.product, p.service.version]), [
    [21, 'ftp', 'vsftpd', '3.0.5'],
    [22, 'ssh', 'OpenSSH', '9.6p1'],
    [25, 'smtp', 'Postfix smtpd', null],
    [143, 'imap', 'Dovecot', null],
    [2222, null, 'Dropbear sshd', '2022.83'],
    [3306, 'mysql', 'MariaDB', '10.11.6'],
  ]);
  assert.deepEqual(port(scan, '10.0.2.6', 3306).service, { name: 'mysql', product: 'MySQL', version: '8.0.36' }, 'MariaDB answers MySQL\'s pattern too; MySQL alone is MySQL');
  assert.ok(scan.hosts.every(h => h.ports.every(p => p.findings.length === 0 && p.state === 'open')));
});

test('a web port: the server on the port, the application a piece of its own', () => {
  const scan = result();
  const grafana = port(scan, '10.0.2.11', 443);
  assert.deepEqual(grafana.service, { name: 'https', product: 'nginx', version: '1.24.0' });
  assert.deepEqual(grafana.application, { id: 'grafana', label: 'Grafana', product: 'Grafana', version: '10.2.3' }, 'the version of the application that was recognised, not of one whose pattern fits too');
  // A server that names no version, and a management page behind it.
  const fw = port(scan, '10.0.2.14', 443);
  assert.deepEqual([fw.service.product, fw.service.version, fw.application.product, fw.manages], ['nginx', null, 'pfSense', true]);
  // An embedded server is a server like any other.
  const jenkins = port(scan, '10.0.2.15', 8080);
  assert.deepEqual([jenkins.service.product, jenkins.service.version, jenkins.application.product, jenkins.application.version], ['Jetty', '10.0.18', 'Jenkins', '2.440.1']);
  // The application answers by itself: one piece.
  const webmin = port(scan, '10.0.2.16', 10000);
  assert.deepEqual([webmin.service, webmin.application, webmin.manages], [{ name: null, product: 'Webmin', version: '2.105' }, undefined, true]);
  const pve = port(scan, '10.0.2.13', 8006);
  assert.deepEqual([pve.service.product, pve.service.version, pve.application], ['Proxmox VE', '8.1.4', undefined], 'no Server header');
  // No application: the server; its name as nmap has it.
  assert.deepEqual(port(scan, '10.0.2.12', 443).service, { name: 'https', product: 'Apache httpd', version: '2.4.57' });
  assert.deepEqual(port(scan, '10.0.2.61', 443).service.product, 'Microsoft IIS httpd');
  // Nothing named: the port is open, and what it said is said.
  assert.equal(port(scan, '10.0.2.62', 8000).service, null);
  assert.deepEqual(Nu.notes(scan), ['10.0.2.62 · title on tcp/8000: Printer status.']);
});

test('the names a certificate bears, with the port they were seen on', () => {
  const scan = result();
  assert.deepEqual(host(scan, '10.0.2.11').names, [
    { name: 'grafana.corp.example', from: 'certificate', port: 443 },
    { name: 'metrics.corp.example', from: 'certificate', port: 443 },
    { name: '*.corp.example', from: 'certificate', port: 443 },
  ]);
  const p = N.plan(E.empty(), null, scan, '10.0.2.0/24', {});
  const row = p.hosts.find(h => h.addresses.includes('10.0.2.11'));
  assert.deepEqual([row.label, row.names, row.saidNames], ['grafana.corp.example', ['grafana.corp.example', 'metrics.corp.example'], ['*.corp.example']]);
  const bare = p.hosts.find(h => h.addresses.includes('10.0.2.16'));
  assert.deepEqual([bare.label, bare.names, bare.saidNames], ['10.0.2.16', [], ['10.0.2.16']], 'an address is no name');
});

test('review focus 1: a paste of nuclei\'s own results and effractor\'s reads both', () => {
  const own = fs.readFileSync('scripts/fixtures/nuclei/lab.jsonl', 'utf8');
  const scan = Nu.read(own + text()).scan;
  assert.deepEqual([scan.results, scan.informational, scan.answers], [12, 6, lines().length]);
  assert.ok(host(scan, '10.0.1.40').ports.find(p => p.port === 3000).findings.length === 3);
  assert.equal(port(scan, '10.0.2.5', 22).service.product, 'OpenSSH');
  assert.equal(Nu.notes(scan)[0], '6 of 12 results are informational: they say a port is open, not what is wrong.');
});

test('review focus 2: an answer this version does not know is counted, and draws nothing', () => {
  const [first] = lines();
  const newer = Object.assign({}, first, { 'extractor-name': 'from-a-newer-template', 'extracted-results': ['x'] });
  const other = Object.assign({}, first, { 'template-id': 'effractor-of-tomorrow', 'extractor-name': 'openssh' });
  const stolen = Object.assign({}, first, { 'template-id': 'effractor-web', 'extractor-name': 'openssh' });
  const scan = Nu.read(written([first, newer, other, stolen, Object.assign({}, first, { 'extractor-name': 7 }), Object.assign({}, first, { 'extractor-name': '__proto__' })])).scan;
  assert.equal(scan.unknown, 5);
  assert.equal(scan.hosts.length, 1);
  assert.match(Nu.notes(scan).join(' '), /5 answers this version does not know; not drawn\./);
  // Only unknown answers: no host, said as any result without one.
  assert.equal(Nu.read(written([newer])).problem.code, 'no-host');
});

test('review focus 3: hostile values are cleaned, cut, or refused by their shape', () => {
  const find = name => lines().find(r => r['extractor-name'] === name);
  const bad = (name, values, more) => Object.assign({}, find(name), { 'extracted-results': values }, more || {});
  const scan = Nu.read(written([
    bad('openssh', ['9.6p1; rm -rf /']),
    bad('openssh', ['<img src=x onerror=alert(1)>']),
    bad('openssh', [{ not: 'text' }, 7, null]),
    bad('openssh', 'not a list'),
    bad('jenkins-version', ['2.440.1\u0000\u0007']),
    bad('jenkins', ['X-Jenkins:']),
    bad('server', ['<script>alert(1)</script>/1.0'], { 'matched-at': 'http://10.0.2.15:8080/' }),
    bad('names', ['a'.repeat(5000) + '.example', 'ok.corp.example', '\u0000', '<b>x</b>', '10.0.2.11']),
    bad('title', ['t'.repeat(5000)], { 'matched-at': 'http://10.0.2.62:8000/' }),
  ])).scan;
  assert.equal(scan.refused, 5, 'four versions that are none, and a server whose name is markup');
  assert.equal(host(scan, '10.0.2.5'), undefined, 'an answer without its shape names nothing and opens no port');
  const j = port(scan, '10.0.2.15', 8080);
  assert.deepEqual([j.service.product, j.service.version], ['Jenkins', '2.440.1'], 'a server\'s name begins with a letter and holds no markup');
  const p = N.plan(E.empty(), null, scan, '', {});
  const named = p.hosts.find(h => h.addresses.includes('10.0.2.11'));
  assert.deepEqual(named.names, ['ok.corp.example']);
  assert.ok(named.saidNames.every(n => n.length <= 120 && !/[\u0000-\u001f]/.test(n)));
  for (const n of Nu.notes(scan)) assert.ok(n.length < 200 && !/[\u0000-\u001f]/.test(n), n);
});

// Beyond the plan's lab: applications that name themselves in their Server header.
test('an application whose own server answers is one piece', () => {
  const scan = result();
  const one = (address, number) => {
    const p = port(scan, address, number);
    return [p.service.product, p.service.version, p.application];
  };
  assert.deepEqual(one('10.0.2.108', 8081), ['Nexus Repository', '3.64.0-04', undefined]);
  assert.deepEqual(one('10.0.2.131', 443), ['HPE iLO', '2.98', undefined]);
  assert.deepEqual(one('10.0.2.134', 443), ['OPNsense', null, undefined]);
  assert.deepEqual(one('10.0.2.140', 8000), ['SAP NetWeaver', null, undefined]);
  // Every server word of the table is one a Server header can begin with, in lower case.
  for (const a of T.ANSWERS.filter(a => a.server)) for (const word of [].concat(a.server)) assert.match(word, /^[a-z][a-z0-9_.+-]*$/, a.name);
  // Nothing in the lab is an application behind itself.
  for (const h of scan.hosts) for (const p of h.ports) if (p.application) assert.notEqual(p.application.product.toLowerCase().split(' ')[0], String(p.service.product).toLowerCase().split(/[ -]/)[0], h.addresses[0] + ':' + p.port);
});

// The lab as nmap drew it before: a server with ssh under nmap's own label,
// an ftp nobody named, a mail service named otherwise, and a web host whose
// server has a name and no version.
function drawn() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.2.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.2.2'] },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
    srv: { kind: 'host', label: 'Server', addresses: ['10.0.2.5'] },
    sshd: { kind: 'service', label: 'ssh' },
    ftpd: { kind: 'service', label: 'ftp' },
    smtpd: { kind: 'service', label: 'smtp' },
    openssh: { kind: 'product', label: 'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5' },
    noftp: { kind: 'product', label: 'unidentified ftp on Server' },
    exim: { kind: 'product', label: 'Exim smtpd 4.96' },
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.2.11'] },
    https: { kind: 'service', label: 'https' },
    nginx: { kind: 'product', label: 'nginx' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a2: { kind: 'attached', from: 'srv', to: 'lan' },
    a3: { kind: 'attached', from: 'web', to: 'lan' },
    a4: { kind: 'hosts', from: 'box', to: 'nmap', privilege: 'user' },
    a5: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
    a6: { kind: 'hosts', from: 'srv', to: 'sshd', privilege: 'unknown' },
    a7: { kind: 'hosts', from: 'srv', to: 'ftpd', privilege: 'unknown' },
    a8: { kind: 'hosts', from: 'srv', to: 'smtpd', privilege: 'unknown' },
    a9: { kind: 'hosts', from: 'web', to: 'https', privilege: 'unknown' },
    b1: { kind: 'instance-of', from: 'sshd', to: 'openssh' },
    b2: { kind: 'instance-of', from: 'ftpd', to: 'noftp' },
    b3: { kind: 'instance-of', from: 'smtpd', to: 'exim' },
    b4: { kind: 'instance-of', from: 'https', to: 'nginx' },
  };
  d.flows = {
    f1: { label: 'ssh on Server', source: 'nmap', target: 'sshd', route: ['lan'], protocol: 'tcp/22' },
    f2: { label: 'ftp on Server', source: 'nmap', target: 'ftpd', route: ['lan'], protocol: 'tcp/21' },
    f3: { label: 'smtp on Server', source: 'nmap', target: 'smtpd', route: ['lan'], protocol: 'tcp/25' },
    f4: { label: 'https on Web 1', source: 'nmap', target: 'https', route: ['lan'], protocol: 'tcp/443' },
  };
  return d;
}
// Only the two drawn hosts of the result, to keep what is asserted small.
const few = () => {
  const scan = result();
  scan.hosts = scan.hosts.filter(h => ['10.0.2.5', '10.0.2.11'].includes(h.addresses[0]));
  return scan;
};
const row = (p, address, proto) => p.hosts.find(h => h.addresses.includes(address)).ports.find(r => r.proto === proto);

test('spec §7: a product is named once; what is drawn is left, what differs is said', () => {
  const d = drawn();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const ssh = row(p, '10.0.2.5', 'tcp/22');
  assert.deepEqual([ssh.known, ssh.addsFlow, ssh.identifies, ssh.differs], ['sshd', false, null, null], 'nmap\'s longer label is the same product; nmap beside it already reaches it');
  assert.deepEqual(row(p, '10.0.2.5', 'tcp/21').identifies, { product: 'noftp', from: 'unidentified ftp on Server', to: 'vsftpd 3.0.5', existing: null });
  const smtp = row(p, '10.0.2.5', 'tcp/25');
  assert.deepEqual([smtp.identifies, smtp.differs], [null, 'drawn: Exim smtpd 4.96 · nuclei: Postfix smtpd']);
  const web = row(p, '10.0.2.11', 'tcp/443');
  assert.deepEqual(web.identifies, { product: 'nginx', from: 'nginx', to: 'nginx 1.24.0', existing: null }, 'a name without a version takes the version');
  assert.deepEqual(web.application, { label: 'Grafana', product: { label: 'Grafana 10.2.3', existing: null }, known: null, differs: null });
  const t = N.defaults(p);
  assert.deepEqual([t.identifies, t.applications], [{ 'h0/tcp/21': true, 'h1/tcp/443': true }, { 'h1/tcp/443': true }]);
  const s = N.summary(d, p, t, { entities: 500, relationships: 2000 });
  assert.deepEqual([s.hosts, s.services, s.products, s.flows, s.told, s.named], [0, 4, 4, 4, 2, 1]);
  assert.equal(N.said(s), 'Adds 4 services, 4 products, 4 flows, names for 1 drawn host, names 2 products.');
});

test('spec §5.4: the server passes on to the application, both on the host', () => {
  const d = drawn();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP()).doc;
  const id = name => Object.keys(out.entities).find(k => out.entities[k].label === name);
  const link = (kind, from) => Object.values(out.associations).filter(a => a.kind === kind && a.from === from).map(a => a.to);
  // The unnamed product took the name and kept its id; so did the one without a version.
  assert.equal(out.entities.noftp.label, 'vsftpd 3.0.5');
  assert.equal(out.entities.nginx.label, 'nginx 1.24.0');
  assert.equal(out.entities.exim.label, 'Exim smtpd 4.96', 'what differs is not changed');
  assert.equal(out.entities.openssh.label, 'OpenSSH 9.6p1 Ubuntu 3ubuntu13.5');
  assert.deepEqual(link('instance-of', 'sshd'), ['openssh']);
  const grafana = id('Grafana');
  assert.equal(out.entities[grafana].kind, 'service');
  assert.deepEqual(link('hosts', 'web').sort(), ['https', grafana].sort());
  assert.deepEqual(Object.values(out.associations).find(a => a.kind === 'hosts' && a.to === grafana).privilege, 'unknown');
  assert.deepEqual(link('instance-of', grafana), [id('Grafana 10.2.3')]);
  const pass = Object.values(out.flows).find(f => f.target === grafana);
  assert.deepEqual([pass.label, pass.source, pass.route, pass.protocol], ['Grafana behind https on Web 1', 'https', ['lan'], 'http']);
  assert.deepEqual(out.entities.web.names, ['grafana.corp.example', 'metrics.corp.example']);
  assert.equal(Object.values(out.flows).filter(f => f.protocol === 'tcp/443').length, 1, 'the port stays the server\'s');

  // Review focus 5: again, nothing new.
  const again = N.plan(out, 'nuclei', few(), '10.0.2.0/24', {});
  const s = N.summary(out, again, N.defaults(again), null);
  assert.deepEqual([s.hosts, s.services, s.products, s.flows, s.told, s.named], [0, 0, 0, 0, 0, 0]);
  assert.equal(N.apply(out, again, N.defaults(again), specOf, STAMP()), null);
  const web = row(again, '10.0.2.11', 'tcp/443');
  assert.deepEqual([web.identifies, web.differs, web.application.known, web.application.differs], [null, null, grafana, null]);

  // An application drawn in another version is said, not changed.
  out.entities[id('Grafana 10.2.3')].label = 'Grafana 9.5.1';
  const other = N.plan(out, 'nuclei', few(), '10.0.2.0/24', {});
  assert.equal(row(other, '10.0.2.11', 'tcp/443').application.differs, 'drawn: Grafana 9.5.1 · nuclei: Grafana 10.2.3');
});

test('unticked, nothing is named and no application drawn; a product others use is not renamed', () => {
  const d = drawn();
  d.entities.ftp2 = { kind: 'service', label: 'ftp 2' };
  d.associations.c1 = { kind: 'hosts', from: 'web', to: 'ftp2', privilege: 'unknown' };
  d.associations.c2 = { kind: 'instance-of', from: 'ftp2', to: 'noftp' };
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const t = N.defaults(p);
  t.identifies['h1/tcp/443'] = false;
  t.applications['h1/tcp/443'] = false;
  const out = N.apply(d, p, t, specOf, STAMP()).doc;
  assert.equal(out.entities.nginx.label, 'nginx');
  assert.equal(Object.values(out.entities).some(e => e.label === 'Grafana'), false);
  // Shared by another service: a product of its own is made, the shared one stays.
  assert.equal(out.entities.noftp.label, 'unidentified ftp on Server');
  const to = Object.values(out.associations).find(a => a.kind === 'instance-of' && a.from === 'ftpd').to;
  assert.equal(out.entities[to].label, 'vsftpd 3.0.5');
  assert.equal(Object.values(out.associations).find(a => a.kind === 'instance-of' && a.from === 'ftp2').to, 'noftp');
});

// What a drawing holds, whatever the ids and the labels' tails: hosts by
// address, their ports, each port's product, applications, names.
function shape(doc) {
  const e = doc.entities, out = [];
  const links = kind => Object.values(doc.associations).filter(a => a.kind === kind);
  const product = s => (links('instance-of').find(a => a.from === s) || {}).to;
  for (const id of Object.keys(e).filter(k => e[k].kind === 'host')) {
    const at = (e[id].addresses || []).join(',') || e[id].label;
    out.push(at + ' names ' + (e[id].names || []).slice().sort().join(','));
    for (const a of links('hosts').filter(a => a.from === id && e[a.to].kind === 'service')) {
      const flows = Object.values(doc.flows).filter(f => f.target === a.to);
      const ports = [...new Set(flows.map(f => f.protocol))].sort().join(',');
      const from = [...new Set(flows.map(f => e[f.source].kind === 'service' ? 'service ' + e[f.source].label : e[f.source].kind))].sort().join(',');
      out.push(at + ' ' + ports + ' ' + P.key(e[product(a.to)].label) + ' from ' + from);
    }
  }
  return out.sort();
}
// nmap's view of the same two hosts.
function nmapped() {
  const blank = (addresses, names, ports) => ({ addresses, hostname: names[0] || null, names: names.map(n => ({ name: n, from: 'DNS' })), identities: [], os: null, device: [], self: false, scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [], ports: ports.map(([port, name, product, version]) => ({ protocol: 'tcp', port, state: 'open', reason: 'syn-ack', service: { name, product, version }, scripts: [], findings: [] })) });
  return { tool: 'nmap', args: 'nmap -sV 10.0.2.0/24', date: '2026-09-27', silentUdp: 0, probed: {}, types: [], sharedMacs: 0, hosts: [
    blank(['10.0.2.5'], [], [[21, 'ftp', 'vsftpd', '3.0.5'], [22, 'ssh', 'OpenSSH', '9.6p1 Ubuntu 3ubuntu13.5'], [3306, 'mysql', 'MariaDB', '10.11.6']]),
    blank(['10.0.2.11'], ['grafana.corp.example'], [[443, 'https', 'nginx', '1.24.0']]),
  ] };
}
function start() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.2.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.2.2'] },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a4: { kind: 'hosts', from: 'box', to: 'nmap', privilege: 'user' },
    a5: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
  };
  return d;
}
const add = (doc, app, scan) => {
  const p = N.plan(doc, app, scan, '10.0.2.0/24', {});
  const edit = N.apply(doc, p, N.defaults(p), specOf, app === 'nmap' ? { date: '2026-09-28', recipes: ['services'], range: '10.0.2.0/24' } : STAMP());
  return edit ? edit.doc : doc;
};

test('spec §7.1: nmap then nuclei draws what nuclei then nmap draws, and a second import adds nothing', () => {
  const first = add(add(start(), 'nmap', nmapped()), 'nuclei', few());
  const second = add(add(start(), 'nuclei', few()), 'nmap', nmapped());
  assert.deepEqual(shape(first), shape(second));
  assert.deepEqual(shape(first), [
    '10.0.2.11 http grafana 10.2.3 from service https',
    '10.0.2.11 names grafana.corp.example,metrics.corp.example',
    '10.0.2.11 tcp/443 nginx 1.24.0 from application',
    '10.0.2.2 names ',
    '10.0.2.5 names ',
    '10.0.2.5 tcp/143 dovecot from application',
    '10.0.2.5 tcp/21 vsftpd 3.0.5 from application',
    '10.0.2.5 tcp/22 openssh 9.6p1 from application',
    '10.0.2.5 tcp/2222 dropbear sshd 2022.83 from application',
    '10.0.2.5 tcp/25 postfix smtpd from application',
    '10.0.2.5 tcp/3306 mariadb 10.11.6 from application',
  ]);
  const label = doc => Object.values(doc.entities).find(e => e.kind === 'product' && /^OpenSSH/.test(e.label)).label;
  assert.deepEqual([label(first), label(second)], ['OpenSSH 9.6p1 Ubuntu 3ubuntu13.5', 'OpenSSH 9.6p1'], 'a product keeps the label of whoever named it first');
  for (const doc of [first, second]) {
    assert.equal(Object.values(doc.entities).filter(e => e.kind === 'product').length, 8);
    assert.deepEqual(shape(add(add(doc, 'nmap', nmapped()), 'nuclei', few())), shape(doc));
    const q = N.plan(doc, 'nmap', nmapped(), '10.0.2.0/24', {});
    assert.deepEqual(q.changes.list.filter(c => c.kind === 'version'), [], 'nmap offers no other version of what is the same product');
  }
});

test('the imported document is the one the Rust and wasm checks validate', () => {
  const d = drawn();
  const scan = result();
  const p = N.plan(d, 'nuclei', scan, '10.0.2.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP()).doc;
  const file = 'scripts/fixtures/nuclei/imported-identify.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

// Beyond the plan: found when the pinned document was read.
test('a drawn product that takes a version is not the product of servers that named none', () => {
  const d = drawn();
  const scan = result();
  scan.hosts = scan.hosts.filter(h => ['10.0.2.11', '10.0.2.14'].includes(h.addresses[0]));
  const productOf = (doc, address) => {
    const host = Object.keys(doc.entities).find(k => (doc.entities[k].addresses || []).includes(address));
    const links = kind => Object.values(doc.associations).filter(a => a.kind === kind);
    const service = links('hosts').map(a => a.from === host && a.to).find(s => s && doc.entities[s].label === 'https');
    return doc.entities[links('instance-of').find(a => a.from === service).to].label;
  };
  const count = doc => Object.values(doc.entities).filter(e => e.kind === 'product').length;
  for (const order of [scan.hosts.slice(), scan.hosts.slice().reverse()]) {
    const p = N.plan(d, 'nuclei', Object.assign({}, scan, { hosts: order }), '10.0.2.0/24', {});
    const t = N.defaults(p);
    const s = N.summary(d, p, t, null);
    const out = N.apply(d, p, t, specOf, STAMP()).doc;
    assert.equal(productOf(out, '10.0.2.11'), 'nginx 1.24.0');
    assert.equal(productOf(out, '10.0.2.14'), 'nginx', 'its server named no version');
    assert.equal(s.products, count(out) - count(d), 'the summary counts the products that are made');
    const again = N.plan(out, 'nuclei', Object.assign({}, scan, { hosts: order }), '10.0.2.0/24', {});
    assert.equal(N.apply(out, again, N.defaults(again), specOf, STAMP()), null, 'again, nothing new');
  }
  // Shared by a drawn service: the product made for the one that is named is counted.
  const shared = drawn();
  shared.entities.ftp2 = { kind: 'service', label: 'ftp 2' };
  shared.associations.c1 = { kind: 'hosts', from: 'web', to: 'ftp2', privilege: 'unknown' };
  shared.associations.c2 = { kind: 'instance-of', from: 'ftp2', to: 'noftp' };
  const q = N.plan(shared, 'nuclei', few(), '10.0.2.0/24', {});
  const made = N.apply(shared, q, N.defaults(q), specOf, STAMP()).doc;
  assert.equal(N.summary(shared, q, N.defaults(q), null).products, count(made) - count(shared));
});

// ---- from the review of the branch ----
// A reading whatever the order: hosts by address, ports by number.
const reading = scan => scan.hosts.map(h => [h.addresses[0] || h.hostname, h.names, h.said.slice().sort(), h.ports.map(p => [p.port, p.service, p.application, p.manages, p.signs, p.login])]).sort((a, b) => a[0] < b[0] ? -1 : 1);
function shuffled(list, seed) {
  const out = list.slice();
  let x = seed;
  for (let i = out.length - 1; i > 0; i--) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const j = x % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

test('review: what a port comes to does not depend on the order nuclei wrote its answers in', () => {
  const all = lines();
  const as = reading(Nu.read(written(all)).scan);
  for (let seed = 1; seed <= 25; seed++) assert.deepEqual(reading(Nu.read(written(shuffled(all, seed))).scan), as, 'seed ' + seed);
  // Two applications, two servers, two products on one port: the same whichever came first.
  const like = (name, values, at) => Object.assign({}, lines().find(r => r['extractor-name'] === name), { 'extracted-results': values, 'matched-at': at, host: '10.0.2.200', ip: '10.0.2.200', port: '80', url: 'http://10.0.2.200' });
  const web = [like('server', ['Apache/2.4.57'], 'http://10.0.2.200/'), like('server', ['nginx'], 'http://10.0.2.200/x'), like('wordpress', ['x'], 'http://10.0.2.200/'), like('phpmyadmin', ['x'], 'http://10.0.2.200/phpmyadmin/'), like('openssh', ['9.6p1'], '10.0.2.200:2222'), like('dropbear', ['2022.83'], '10.0.2.200:2222')];
  const one = reading(Nu.read(written(web)).scan);
  assert.deepEqual(one[0][3].map(p => [p[0], p[1].product, p[1].version, (p[2] || {}).product]), [[80, 'Apache httpd', '2.4.57', 'WordPress'], [2222, 'OpenSSH', '9.6p1', undefined]], 'the first of the table; the server that names its version');
  for (let seed = 1; seed <= 10; seed++) assert.deepEqual(reading(Nu.read(written(shuffled(web, seed))).scan), one, 'seed ' + seed);
});

test('review: a year or an edition before the version belongs to the name', () => {
  assert.deepEqual(P.parts('Microsoft SQL Server 2019 15.00.2000.00; RTM'), { name: 'microsoft sql server 2019', version: '15.00.2000.00' });
  assert.deepEqual(P.parts('Oracle Database 11g 11.2.0.4'), { name: 'oracle database 11g', version: '11.2.0.4' });
  assert.deepEqual(P.parts('Log4j 2 2.17.0'), { name: 'log4j 2', version: '2.17.0' });
  assert.equal(P.same('Microsoft SQL Server 2019 15.00.2000.00; RTM', 'Microsoft SQL Server 2019 15.00.4355.00; CU26'), false);
  assert.equal(P.same('Log4j 2 2.14.1', 'Log4j 2 2.17.0'), false);
  assert.equal(P.same('Microsoft SQL Server 2019 15.00.2000.00; RTM', 'microsoft sql server 2019 15.00.2000.00'), true);
  assert.equal(P.lacks('Microsoft SQL Server 2019', 'Microsoft SQL Server 2019 15.00.2000.00'), false, 'without its version the year is taken for one: said, not named');
  // As before.
  assert.deepEqual(P.parts('OpenSSH 9.6p1 Ubuntu 3ubuntu13.5'), { name: 'openssh', version: '9.6p1' });
  assert.deepEqual(P.parts('Microsoft IIS httpd 10.0'), { name: 'microsoft iis httpd', version: '10.0' });
});

// A drawn product with what its author and an earlier import wrote on it.
function noted(d, id) {
  d.entities[id].description = 'pinned by the vendor';
  d.entities[id].defenses = { patched: false };
  d.entities[id].parameters = { 'find-exploit': { status: 'unknown', note: 'nuclei: High 7.5, cve-2024-0001 (x).' } };
  return d;
}
const made = (d, out) => Object.keys(out.entities).filter(k => out.entities[k].kind === 'product' && !d.entities[k]).length;
const productOf = (doc, service) => doc.entities[Object.values(doc.associations).find(a => a.kind === 'instance-of' && a.from === service).to];
const two = (...addresses) => { const s = result(); s.hosts = addresses.map(a => s.hosts.find(h => h.addresses[0] === a)); return s; };

test('review: a product that is named keeps what was written on it, whatever the order of the hosts', () => {
  for (const order of [['10.0.2.11', '10.0.2.50'], ['10.0.2.50', '10.0.2.11']]) {
    // Web 1's nginx is drawn without a version and noted; the proxy at 10.0.2.50 is new and runs nginx 1.24.0 too.
    const d = noted(drawn(), 'nginx');
    const p = N.plan(d, 'nuclei', two(...order), '10.0.2.0/24', {});
    const t = N.defaults(p);
    const s = N.summary(d, p, t, null);
    const out = N.apply(d, p, t, specOf, STAMP()).doc;
    assert.deepEqual([out.entities.nginx.label, out.entities.nginx.description, out.entities.nginx.defenses.patched], ['nginx 1.24.0', 'pinned by the vendor', false], String(order));
    assert.equal(Object.values(out.entities).filter(e => e.kind === 'product' && P.key(e.label) === 'nginx 1.24.0').length, 1, 'named once');
    assert.equal(s.products, made(d, out), 'the summary counts the products that are made: ' + order);
  }
  // Two drawn services share it and are told the same: named in place.
  const same = noted(drawn(), 'nginx');
  same.entities.web2 = { kind: 'host', label: 'Web 2', addresses: ['10.0.2.50'] };
  same.entities.https2 = { kind: 'service', label: 'https' };
  Object.assign(same.associations, { c1: { kind: 'hosts', from: 'web2', to: 'https2', privilege: 'unknown' }, c2: { kind: 'instance-of', from: 'https2', to: 'nginx' }, c3: { kind: 'attached', from: 'web2', to: 'lan' } });
  same.flows.f9 = { label: 'https on Web 2', source: 'nmap', target: 'https2', route: ['lan'], protocol: 'tcp/443' };
  const q = N.plan(same, 'nuclei', two('10.0.2.11', '10.0.2.50'), '10.0.2.0/24', {});
  const o = N.apply(same, q, N.defaults(q), specOf, STAMP()).doc;
  assert.deepEqual([o.entities.nginx.label, o.entities.nginx.defenses.patched, productOf(o, 'https').label, productOf(o, 'https2').label], ['nginx 1.24.0', false, 'nginx 1.24.0', 'nginx 1.24.0']);
  assert.equal(N.summary(same, q, N.defaults(q), null).products, made(same, o));
  // A product of that name is drawn already: the service takes it, and what was written goes with it.
  const there = noted(drawn(), 'noftp');
  there.entities.vs = { kind: 'product', label: 'vsftpd 3.0.5 (Debian)' };
  const r = N.plan(there, 'nuclei', two('10.0.2.5'), '10.0.2.0/24', {});
  const u = N.apply(there, r, N.defaults(r), specOf, STAMP()).doc;
  assert.equal(productOf(u, 'ftpd'), u.entities.vs);
  assert.equal(u.entities.noftp, undefined, 'nothing else ran it');
  assert.deepEqual([u.entities.vs.label, u.entities.vs.defenses.patched, u.entities.vs.description, u.entities.vs.parameters['find-exploit'].note], ['vsftpd 3.0.5 (Debian)', false, 'pinned by the vendor', 'nuclei: High 7.5, cve-2024-0001 (x).']);
  assert.equal(N.summary(there, r, N.defaults(r), null).products, made(there, u));
});

test('review: the application of a port is reached by http; a database the server talks to is none', () => {
  const d = drawn();
  d.entities.db = { kind: 'service', label: 'mysql' };
  d.entities.maria = { kind: 'product', label: 'MariaDB 10.11.6' };
  Object.assign(d.associations, { d1: { kind: 'hosts', from: 'web', to: 'db', privilege: 'unknown' }, d2: { kind: 'instance-of', from: 'db', to: 'maria' } });
  d.flows.f8 = { label: 'the site reads its database', source: 'https', target: 'db', route: ['lan'], protocol: 'tcp/3306' };
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  assert.deepEqual(row(p, '10.0.2.11', 'tcp/443').application, { label: 'Grafana', product: { label: 'Grafana 10.2.3', existing: null }, known: null, differs: null });
  // One the author drew by another protocol is known by its product.
  d.entities.g = { kind: 'service', label: 'Dashboards' };
  d.entities.gp = { kind: 'product', label: 'Grafana' };
  Object.assign(d.associations, { d3: { kind: 'hosts', from: 'web', to: 'g', privilege: 'unknown' }, d4: { kind: 'instance-of', from: 'g', to: 'gp' } });
  d.flows.f7 = { label: 'dashboards', source: 'https', target: 'g', route: ['lan'], protocol: 'tcp/3000' };
  assert.equal(row(N.plan(d, 'nuclei', few(), '10.0.2.0/24', {}), '10.0.2.11', 'tcp/443').application.known, 'g');
});
