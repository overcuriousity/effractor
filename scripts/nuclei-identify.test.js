const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const Nu = require('../assets/js/nuclei.js');
const S = require('../assets/js/scanners.js');
const T = require('../assets/js/nuclei-templates.js');
const E = require('../assets/js/architecture-edit.js');

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
  for (const a of T.ANSWERS.filter(a => a.server)) assert.match(a.server, /^[a-z][a-z0-9_.+-]*$/, a.name);
  // Nothing in the lab is an application behind itself.
  for (const h of scan.hosts) for (const p of h.ports) if (p.application) assert.notEqual(p.application.product.toLowerCase().split(' ')[0], String(p.service.product).toLowerCase().split(/[ -]/)[0], h.addresses[0] + ':' + p.port);
});
