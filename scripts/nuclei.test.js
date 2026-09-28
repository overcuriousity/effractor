const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const Nu = require('../assets/js/nuclei.js');
const G = require('../assets/js/greenbone.js');
const M = require('../assets/js/masscan.js');
const S = require('../assets/js/scanners.js');
const E = require('../assets/js/architecture-edit.js');

// nuclei beside nmap (roadmap nuclei-import): its JSON lines read into the
// scan nmap.js plans from. The fixture's lines are what nuclei 3.11.0 wrote
// against throwaway servers on 127.0.0.1, with the addresses, names, ports
// and times rewritten to the lab's.
const fixture = name => fs.readFileSync('scripts/fixtures/' + name, 'utf8');
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const result = () => Nu.read(fixture('nuclei/lab.jsonl')).scan;
const lines = () => fixture('nuclei/lab.jsonl').trim().split('\n').map(l => JSON.parse(l));
const written = list => list.map(r => JSON.stringify(r)).join('\n') + '\n';

test('a result reads its hosts by address, their names, and the ports nuclei reached', () => {
  const scan = result();
  assert.equal(scan.tool, 'nuclei');
  assert.equal(scan.date, '2026-09-27');
  assert.deepEqual(scan.hosts.map(h => h.addresses), [['10.0.1.40'], ['10.0.1.5'], ['10.0.1.7']]);
  const [app, srv, other] = scan.hosts;
  assert.deepEqual(app.names, [{ name: 'app.lab', from: 'nuclei' }], 'reached by address and by name: one host');
  assert.equal(app.hostname, 'app.lab');
  assert.deepEqual(srv.names, [{ name: 'srv-01.lab', from: 'nuclei' }]);
  assert.deepEqual(other.names, []);
  assert.deepEqual(app.ports.map(p => [p.protocol + '/' + p.port, p.state, p.service]), [
    ['tcp/80', 'open', { name: 'http', product: null, version: null }],
    ['tcp/3000', 'open', null],
  ], 'named by the number, as nmap\'s table would: a finding on tcp/3000 is not tcp/80\'s');
  assert.deepEqual(srv.ports.map(p => [p.protocol + '/' + p.port, p.service.name]), [['tcp/22', 'ssh'], ['tcp/8443', 'https-alt']]);
  assert.deepEqual(other.ports.map(p => p.port), [22]);
  assert.ok(scan.hosts.every(h => h.os === null && h.identities.length === 0), 'nuclei names no OS and no identity');
});

test('a finding: low and above, with CVE and score, once per port; info only says the port is open', () => {
  const [app, srv, other] = result().hosts;
  assert.deepEqual(app.ports[1].findings, [
    { source: 'nuclei', key: 'CVE-2021-43798', title: 'Grafana v8.x - Arbitrary File Read', state: 'High 7.5', ids: ['CVE:CVE-2021-43798'] },
    { source: 'nuclei', key: 'git-config', title: 'Git Configuration - Detect', state: 'Medium 5.3', ids: [] },
    { source: 'nuclei', key: 'laravel-env', title: 'Laravel - Sensitive Information Disclosure', state: 'High 8.3', ids: [] },
  ], 'found by address and by name: once');
  assert.deepEqual(app.ports[0].findings, [], 'what runs there is not a finding');
  assert.deepEqual(srv.ports[1].findings.map(f => [f.key, f.state, f.ids]), [
    ['CVE-2021-42013', 'Critical 9.8', ['CVE:CVE-2021-42013']],
    ['self-signed-ssl', 'Low', []],
  ], 'a severity without a score stands alone');
  assert.deepEqual(srv.ports[0].findings, []);
  assert.deepEqual(other.ports[0].findings, []);
  assert.deepEqual(app.findings, [], 'an info DNS result on its name adds nothing');
  assert.deepEqual(Nu.notes(result()), ['6 of 12 results are informational: they say a port is open, not what is wrong.']);
});

test('a result without a port is on the host; one without an address is matched by name', () => {
  const [, cve, git] = lines();
  // DNS: no address, no port; its host is the one already read by that name.
  const takeover = Object.assign({}, lines()[11], { 'template-id': 'azure-takeover-detection', host: 'app.lab.', 'matched-at': 'app.lab' });
  takeover.info = Object.assign({}, takeover.info, { name: 'Microsoft Azure Takeover Detection', severity: 'high', classification: { 'cve-id': null, 'cwe-id': ['cwe-404'], 'cvss-score': 7.2 } });
  // A name nuclei gave no address for.
  const wiki = Object.assign({}, git, { host: 'wiki.lab', url: 'http://wiki.lab:3000', 'matched-at': 'http://wiki.lab:3000/.git/config' });
  delete wiki.ip;
  const scan = Nu.read(written([cve, takeover, wiki])).scan;
  assert.deepEqual(scan.hosts.map(h => [h.addresses, h.hostname]), [[['10.0.1.40'], 'app.lab'], [[], 'wiki.lab']]);
  assert.deepEqual(scan.hosts[0].findings, [{ source: 'nuclei', key: 'azure-takeover-detection', title: 'Microsoft Azure Takeover Detection', state: 'High 7.2', ids: [] }]);
  assert.deepEqual(scan.hosts[1].ports.map(p => [p.port, p.findings.map(f => f.key)]), [[3000, ['git-config']]]);
});

test('the port: nuclei\'s own, else the URL\'s, else the scheme\'s', () => {
  const [cve] = lines();
  const at = change => {
    const r = Object.assign({}, cve, change);
    Object.keys(change).forEach(k => { if (change[k] === undefined) delete r[k]; });
    const h = Nu.read(written([r])).scan.hosts[0];
    return h.ports.map(p => p.protocol + '/' + p.port).join(',') + (h.findings.length ? ' host' : '');
  };
  assert.equal(at({}), 'tcp/3000');
  assert.equal(at({ port: undefined }), 'tcp/3000', 'from the URL');
  assert.equal(at({ port: undefined, url: undefined, 'matched-at': 'https://10.0.1.40/login' }), 'tcp/443');
  assert.equal(at({ port: undefined, url: undefined, 'matched-at': 'http://10.0.1.40/login' }), 'tcp/80');
  assert.equal(at({ port: undefined, url: undefined, scheme: undefined, 'matched-at': '10.0.1.40:6379', host: '10.0.1.40:6379' }), 'tcp/6379');
  assert.equal(at({ port: undefined, url: undefined, 'matched-at': 'https://[fd00::40]:8443/x', host: '[fd00::40]:8443', ip: 'fd00::40' }), 'tcp/8443');
  assert.equal(at({ port: '0' }), 'tcp/3000', 'a port that is none is not nuclei\'s word');
  assert.equal(at({ port: '70000', url: undefined, scheme: undefined, 'matched-at': '10.0.1.40' }), ' host');
});

test('nuclei\'s export file (a JSON list) and what stands between the lines read too', () => {
  const text = fixture('nuclei/lab.jsonl');
  const list = JSON.stringify(lines(), null, 2);
  assert.deepEqual(Nu.read(list).scan.hosts, result().hosts);
  const noisy = '\u001b[34mINF\u001b[0m] Templates loaded for current scan: 38\n\n' + text.replace(/\n/g, '\r\n') + '[INF] Scan completed in 20s. 12 matches found.\n';
  assert.deepEqual(Nu.read(noisy).scan.hosts, result().hosts);
});

test('what is not a result is said, with where it goes', () => {
  const text = fixture('nuclei/lab.jsonl');
  assert.equal(Nu.read('  ').problem.code, 'empty');
  assert.match(Nu.read('  ').problem.message, /found nothing/);
  assert.match(Nu.read(fixture('nmap/deep-lab.xml')).problem.message, /^This result is from nmap, not nuclei; add nmap/);
  assert.match(Nu.read(fixture('masscan/lab.xml')).problem.message, /^This result is from masscan, not nuclei; add masscan/);
  assert.match(Nu.read(fixture('greenbone/lab.xml')).problem.message, /^This result is from Greenbone, not nuclei; add Greenbone/);
  assert.equal(Nu.read('[git-config] [http] [medium] http://10.0.1.40:3000/.git/config').problem.code, 'normal-output');
  assert.match(Nu.read('[git-config] [http] [medium] http://10.0.1.40:3000/.git/config').problem.message, /-jsonl/);
  assert.equal(Nu.read('{"hello": "there"}').problem.code, 'not-nuclei');
  assert.equal(Nu.read('hello').problem.code, 'not-nuclei');
  assert.equal(Nu.read(text.slice(0, text.length - 200)).problem.code, 'truncated');
  assert.equal(Nu.read(JSON.stringify(lines()).slice(0, 900)).problem.code, 'truncated');
  // Results that name no machine at all.
  const nowhere = Object.assign({}, lines()[0], { host: '', url: '', 'matched-at': '' });
  delete nowhere.ip;
  assert.equal(Nu.read(written([nowhere])).problem.code, 'no-host');
  // Pasted into another tool's dialog, it says where it goes.
  for (const [id, name] of [['nmap', 'nmap'], ['masscan', 'masscan'], ['greenbone', 'Greenbone']]) {
    assert.equal(S.read(id, text).problem.message, 'This result is from nuclei, not ' + name + '; add nuclei and paste it there.');
  }
  assert.equal(M.read(text).problem != null && G.read(text).problem != null, true);
});

test('hostile text stays text and stays short', () => {
  const [cve] = lines();
  const bad = Object.assign({}, cve, { host: 'a'.repeat(5000) + '.lab', 'template-id': 'x\u0000y\n' + 'z'.repeat(5000) });
  bad.info = Object.assign({}, bad.info, { name: '<img src=x onerror=alert(1)>\u0007' + 'n'.repeat(5000), severity: { not: 'a word' }, classification: { 'cve-id': ['cve-2021-43798', 'DROP TABLE', 7, 'CVE-2021-1'], 'cvss-score': '9; rm -rf' } });
  delete bad.ip;
  const h = Nu.read(written([bad, 7, null, 'text', [], { 'template-id': 5 }])).scan;
  assert.equal(h, undefined, 'a severity that is no word is no finding, and no port opens a host');
  bad.info.severity = 'HIGH';
  const scan = Nu.read(written([bad])).scan;
  const f = scan.hosts[0].ports[0].findings[0];
  assert.ok(scan.hosts[0].hostname.length <= 200);
  assert.ok(f.key.length <= 200 && !/[\u0000-\u001f]/.test(f.key));
  assert.ok(f.title.length <= 200 && !/[\u0000-\u001f]/.test(f.title));
  assert.equal(f.state, 'High');
  assert.deepEqual(f.ids, ['CVE:CVE-2021-43798', 'CVE:CVE-2021-1']);
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
function withNuclei(doc) {
  const added = S.addScanner(doc, 'nuclei', 'admin-box', 'nuclei', specOf);
  assert.equal(added.doc.entities[added.entity].tool, 'nuclei');
  return { doc: added.doc, app: added.entity };
}
const label = (doc, id) => doc.entities[id].label;

test('after nmap: findings land on the ports and products nmap drew; no host twice', () => {
  const { doc, app } = withNuclei(nmapped());
  const p = N.plan(doc, app, result(), '10.0.1.0/24', {});
  const [web, srv, other] = p.hosts;
  assert.deepEqual([web.known, srv.known, other.known && label(doc, other.known)], [null, 'srv', '10.0.1.7']);
  assert.equal(web.label, 'app.lab');
  assert.equal(web.os, null);
  const ssh = srv.ports.find(r => r.proto === 'tcp/22');
  assert.deepEqual([ssh.known, ssh.addsFlow, ssh.findings], ['sshd', false, []], 'nmap beside it already reaches it');
  const tls = srv.ports.find(r => r.proto === 'tcp/8443');
  assert.deepEqual(tls.findings.map(f => [f.tag, f.id, label(doc, f.product), f.line]), [
    ['Critical 9.8', 'CVE-2021-42013', 'unidentified tcp/8443 on Server', 'nuclei: Critical 9.8, CVE-2021-42013 (Apache 2.4.49/2.4.50 - Path Traversal and Remote Code Execution).'],
    ['Low', 'self-signed-ssl', 'unidentified tcp/8443 on Server', 'nuclei: Low, self-signed-ssl (Self Signed SSL Certificate).'],
  ], 'the product nmap drew, whatever it knew');
  const grafana = web.ports.find(r => r.proto === 'tcp/3000');
  assert.deepEqual(grafana.findings.map(f => f.id), ['CVE-2021-43798', 'git-config', 'laravel-env']);
  assert.deepEqual(web.unplaced, []);

  const t = N.defaults(p);
  const s = N.summary(doc, p, t, { entities: 500, relationships: 2000 });
  assert.deepEqual([s.hosts, s.networks, s.attached, s.services, s.products, s.flows, s.unpatched], [1, 0, 0, 2, 2, 2, 2]);
  assert.equal(N.said(s), 'Adds 1 host, 2 services, 2 products, 2 flows, marks 2 products unpatched.');
  assert.deepEqual(p.changes.list, [], 'nuclei names no product: no version change offered');

  const out = N.apply(doc, p, t, specOf, S.stampFor('nuclei', result(), '10.0.1.0/24', '2026-09-28')).doc;
  assert.equal(out.entities[app].description, 'Last nuclei import: 2026-09-28, scan of 10.0.1.0/24 (scanned 2026-09-27).');
  const id = name => Object.keys(out.entities).find(k => out.entities[k].label === name);
  assert.deepEqual(out.entities[id('app.lab')].addresses, ['10.0.1.40']);
  const marked = out.entities[id('unidentified tcp/8443 on Server')];
  assert.equal(marked.defenses.patched, false);
  assert.equal(marked.parameters['find-exploit'].note, [
    'nuclei: Critical 9.8, CVE-2021-42013 (Apache 2.4.49/2.4.50 - Path Traversal and Remote Code Execution).',
    'nuclei: Low, self-signed-ssl (Self Signed SSL Certificate).',
  ].join('\n'));
  assert.equal(out.entities.openssh.defenses == null || out.entities.openssh.defenses.patched !== false, true, 'nothing found on ssh');
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'host').length, 4);

  // Again: nothing new.
  const again = N.plan(out, app, result(), '10.0.1.0/24', {});
  const s2 = N.summary(out, again, N.defaults(again), null);
  assert.deepEqual([s2.hosts, s2.services, s2.products, s2.flows, s2.unpatched], [0, 0, 0, 0, 0]);
  // nmap afterwards: nuclei's lines are a scan's, not the author's.
  const q = N.plan(out, 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(N.summary(out, q, N.defaults(q), null).hosts, 0);

  const file = 'scripts/fixtures/nuclei/imported.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('before nmap: nuclei draws, nmap afterwards draws no host twice', () => {
  const { doc, app } = withNuclei(lab());
  const p = N.plan(doc, app, result(), '10.0.1.0/24', {});
  const out = N.apply(doc, p, N.defaults(p), specOf, S.stampFor('nuclei', result(), '10.0.1.0/24', '2026-09-28')).doc;
  const q = N.plan(out, 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(N.summary(out, q, N.defaults(q), null).hosts, 0);
  assert.deepEqual(q.hosts.map(h => label(out, h.known)), ['Server', '10.0.1.7']);
});

test('a host nuclei knows only by name: the drawn host of that name, else a new one without an address', () => {
  const git = lines()[2];
  const named = name => {
    const r = Object.assign({}, git, { host: name, url: 'http://' + name + ':3000', 'matched-at': 'http://' + name + ':3000/.git/config' });
    delete r.ip;
    return r;
  };
  const start = lab();
  start.entities.wiki = { kind: 'host', label: 'wiki.lab' };
  const { doc, app } = withNuclei(start);
  const scan = Nu.read(written([named('wiki.lab'), named('other.lab')])).scan;
  const p = N.plan(doc, app, scan, '', {});
  assert.deepEqual(p.hosts.map(h => [h.label, h.merged, h.guessedBy, h.addresses]), [['wiki.lab', 'wiki', 'name', []], ['other.lab', null, null, []]]);
  const out = N.apply(doc, p, N.defaults(p), specOf, S.stampFor('nuclei', scan, '', '2026-09-28')).doc;
  const hosts = Object.keys(out.entities).filter(k => out.entities[k].kind === 'host').map(k => [out.entities[k].label, out.entities[k].addresses || []]);
  assert.deepEqual(hosts, [['Admin box', []], ['Server', ['10.0.1.5']], ['wiki.lab', []], ['other.lab', []]]);
  assert.equal(out.entities[app].description, 'Last nuclei import: 2026-09-28, scan (scanned 2026-09-27).');
  const again = N.plan(out, app, scan, '', {});
  assert.equal(N.summary(out, again, N.defaults(again), null).hosts, 0, 'by its name the second time too');
});

test('nuclei is a scanner of its own in the menus', () => {
  assert.deepEqual(S.TOOLS.map(t => [t.id, t.name]), [['nmap', 'nmap'], ['masscan', 'masscan'], ['greenbone', 'Greenbone'], ['nuclei', 'nuclei']]);
});
