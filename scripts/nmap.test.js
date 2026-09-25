const { test } = require('node:test');
const assert = require('node:assert/strict');
const N = require('../assets/js/nmap.js');

test('four levels, Standard first offered, root only where the scan needs it', () => {
  assert.deepEqual(N.LEVELS.map(l => l.id), ['discover', 'standard', 'deep', 'complete']);
  assert.deepEqual(N.LEVELS.map(l => l.root), [false, false, true, true]);
  assert.equal(N.level('standard').name, 'Standard');
  assert.equal(N.level('nope'), null);
});

test('each level prints XML to the terminal for the range', () => {
  const r = '10.0.1.0/24';
  assert.equal(N.command('discover', r).text, 'nmap -sn -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', r).text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.equal(N.command('deep', r).text, 'sudo nmap -sS -sU -sV -O --top-ports 1000 -oX - 10.0.1.0/24');
  assert.equal(N.command('complete', r).text, 'sudo nmap -sS -sU -sV -O -p T:1-65535,U:1-1024 -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', '  10.0.1.0/24   10.0.2.0/24 ').text, 'nmap -sT -sV -oX - 10.0.1.0/24 10.0.2.0/24');
  assert.equal(N.command('standard', 'srv-01.lab,10.0.2.1-20').text, 'nmap -sT -sV -oX - srv-01.lab,10.0.2.1-20');
});

test('a range never carries shell syntax or an nmap option', () => {
  for (const bad of ['10.0.0.1; rm -rf ~', '$(id)', '10.0.0.1 | tee x', '`id`', "10.0.0.1'", '10.0.0.1 -iL /etc/shadow', '-oN x 10.0.0.1', '10.0.0.1\n-sC']) {
    const c = N.command('standard', bad);
    assert.equal(c.text, undefined, bad);
    assert.match(c.problem, /range/, bad);
  }
  assert.match(N.command('standard', '   ').problem, /range/);
  assert.equal(N.command('bogus', '10.0.0.1'), null);
});

const fs = require('node:fs');
const fixture = name => fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8');

test('a real Standard scan reads its hosts, open ports and services; hints are not hosts', () => {
  const text = fixture('standard-localhost.xml');
  const { scan } = N.read(text);
  assert.equal(scan.hosts.length, 1, 'the <hosthint> is not a second host');
  const h = scan.hosts[0];
  assert.deepEqual(h.addresses, ['127.0.0.1']);
  assert.equal(h.hostname, 'localhost');
  assert.equal(h.os, null);
  const open = [...text.matchAll(/<port protocol="(\w+)" portid="(\d+)"><state state="open"/g)].map(m => m[1] + '/' + m[2]);
  assert.deepEqual(h.ports.filter(p => p.state === 'open').map(p => p.protocol + '/' + p.port), open);
  assert.ok(h.ports.every(p => p.service === null || typeof p.service.name === 'string'));
  assert.match(scan.args, /^nmap -sT -sV --top-ports 100 -oX - 127\.0\.0\.1$/, 'entities in attributes are decoded');
});

test('a discover scan has hosts without ports', () => {
  const { scan } = N.read(fixture('discover-localhost.xml'));
  assert.equal(scan.hosts.length, 1);
  assert.deepEqual(scan.hosts[0].ports, []);
});

test('a deep scan: MAC left out, TCP and UDP, products, OS guess, silent UDP counted, down hosts dropped', () => {
  const { scan } = N.read(fixture('deep-lab.xml'));
  assert.deepEqual(scan.hosts.map(h => h.addresses), [['10.0.1.5'], ['10.0.1.7']]);
  const [srv, other] = scan.hosts;
  assert.equal(srv.hostname, 'srv-01.lab');
  assert.equal(other.hostname, null);
  assert.deepEqual(srv.os, { name: 'Linux 5.0 - 5.4', accuracy: 96 });
  assert.deepEqual(srv.ports.map(p => [p.protocol, p.port, p.state]), [
    ['tcp', 22, 'open'], ['tcp', 8443, 'open'], ['udp', 53, 'open'], ['udp', 123, 'open|filtered'], ['udp', 161, 'open|filtered'],
  ]);
  assert.deepEqual(srv.ports[0].service, { name: 'ssh', product: 'OpenSSH', version: '9.6p1' });
  assert.equal(srv.ports[1].service, null);
  assert.deepEqual(srv.ports[2].service, { name: 'domain', product: 'dnsmasq', version: '2.90' });
  assert.equal(scan.silentUdp, 2);
});

test('what is not a usable result says why', () => {
  const code = t => N.read(t).problem && N.read(t).problem.code;
  assert.equal(code(''), 'empty');
  assert.equal(code('   \n '), 'empty');
  assert.equal(code('hello'), 'not-xml');
  assert.equal(code(fixture('normal.txt')), 'normal-output');
  assert.equal(code('<?xml version="1.0"?><html><body/></html>'), 'not-nmap');
  assert.equal(code(fixture('truncated.xml')), 'truncated');
  assert.equal(code('<nmaprun><host>'), 'truncated');
  assert.equal(code('<nmaprun></host></nmaprun>'), 'not-xml');
  assert.equal(code(fixture('down.xml')), 'no-host-up');
  const error = N.read(fixture('error.xml')).problem;
  assert.equal(error.code, 'nmap-error');
  assert.match(error.message, /requires root privileges/);
  for (const t of ['', 'x', fixture('normal.txt'), '<a/>', '<nmaprun>', fixture('down.xml')]) {
    assert.ok(N.read(t).problem.message.length > 10, 'every problem is said in words');
  }
});

test('names from the network are kept verbatim, decoded, never interpreted', () => {
  const { scan } = N.read(fixture('hostile.xml'));
  assert.equal(scan.hosts[0].hostname, '<img src=x onerror=alert(1)>&ünï');
  assert.equal(scan.hosts[0].ports[0].service.product, 'x">y');
});

test('a byte-order mark and CRLF line ends read the same', () => {
  const text = fixture('deep-lab.xml');
  assert.deepEqual(N.read('﻿' + text.replace(/\n/g, '\r\n')), N.read(text));
});

const E = require('../assets/js/architecture-edit.js');

// A small lab: an nmap on "Admin box" in 10.0.1.0/24, a known server with
// an SSH service reached by an existing flow, a hand-drawn host without
// addresses, an existing OpenSSH 9.6p1 product.
function lab() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.1.0/24'] },
    'admin-box': { kind: 'host', label: 'Admin box', parameters: { escape: { status: 'unknown' } } },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    srv: { kind: 'host', label: 'Server', addresses: ['10.0.1.5'] },
    sshd: { kind: 'service', label: 'ssh' },
    openssh: { kind: 'product', label: 'OpenSSH 9.6p1' },
    printer: { kind: 'host', label: 'Printer' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'admin-box', to: 'lan' },
    a2: { kind: 'attached', from: 'srv', to: 'lan' },
    a3: { kind: 'hosts', from: 'admin-box', to: 'nmap', privilege: 'user' },
    a4: { kind: 'hosts', from: 'srv', to: 'sshd', privilege: 'admin' },
    a5: { kind: 'instance-of', from: 'sshd', to: 'openssh' },
  };
  d.flows = { f1: { label: 'ssh on Server', source: 'nmap', target: 'sshd', route: ['lan'], protocol: 'tcp/22', parameters: { connect: { status: 'unknown' } } } };
  return d;
}
const deep = () => N.read(fixture('deep-lab.xml')).scan;

test('addresses and CIDR ranges compare as numbers, IPv4 and IPv6', () => {
  assert.deepEqual(N.bytes('10.0.1.5'), [10, 0, 1, 5]);
  assert.equal(N.bytes('10.0.1.256'), null);
  assert.equal(N.bytes('fd00::1').length, 16);
  assert.equal(N.bytes('nonsense'), null);
  assert.ok(N.inCidr('10.0.1.5', '10.0.1.0/24'));
  assert.ok(!N.inCidr('10.0.2.5', '10.0.1.0/24'));
  assert.ok(N.inCidr('10.0.1.5', '0.0.0.0/0'));
  assert.ok(N.inCidr('fd00::5', 'fd00::/64'));
  assert.ok(!N.inCidr('fd01::5', 'fd00::/64'));
  assert.ok(!N.inCidr('10.0.1.5', 'fd00::/64'));
  assert.ok(!N.inCidr('10.0.1.5', '10.0.1.0'));
});

test('a known host by address, a new one in a known network, a known port with its flow adds nothing', () => {
  const p = N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(p.appHost, 'admin-box');
  assert.equal(p.network, null, 'the range is a network already');
  assert.deepEqual(p.candidates, ['admin-box', 'printer']);
  assert.equal(p.silentUdp, 2);
  const [srv, other] = p.hosts;
  assert.equal(srv.known, 'srv');
  assert.equal(srv.label, 'Server');
  assert.deepEqual(srv.route, ['lan']);
  assert.deepEqual(srv.ports.map(x => [x.proto, x.label, x.known, x.addsFlow]), [
    ['tcp/22', 'ssh', 'sshd', false],
    ['tcp/8443', 'tcp/8443', null, true],
    ['udp/53', 'domain', null, true],
  ], 'open|filtered ports are not rows');
  assert.deepEqual(srv.ports[1].product, { label: 'unidentified tcp/8443 on Server', existing: null, identified: false });
  assert.deepEqual(srv.ports[2].product, { label: 'dnsmasq 2.90', existing: null, identified: true });
  assert.equal(other.known, null);
  assert.equal(other.label, '10.0.1.7');
  assert.deepEqual(other.networks, ['lan']);
  assert.deepEqual(other.route, ['lan']);
  assert.deepEqual(other.ports[0].product, { label: 'OpenSSH 9.6p1', existing: 'openssh', identified: true });
  assert.equal(other.ports.length, 1, 'filtered tcp/80 is not a row');
  const t = N.defaults(p);
  assert.deepEqual(t.hosts, { h0: true, h1: true });
  assert.deepEqual(Object.keys(t.ports), ['h0/tcp/8443', 'h0/udp/53', 'h1/tcp/22']);
});

test('merging a scanned host into a hand-drawn one makes it that host', () => {
  const p = N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h1: 'printer' });
  assert.equal(p.hosts[1].merged, 'printer');
  assert.equal(p.hosts[1].label, 'Printer');
  assert.deepEqual(p.hosts[1].networks, ['lan'], 'its address is in the lab network: it is attached there');
  assert.deepEqual(p.hosts[1].route, ['lan']);
  // A merge into a host that has addresses, or into a known one, is ignored.
  assert.equal(N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h1: 'srv' }).hosts[1].merged, null);
  assert.equal(N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h0: 'printer' }).hosts[0].merged, null);
});

test('a range no network holds is proposed as a new network; a nmap on no host gives no routes', () => {
  const d = lab();
  delete d.entities.lan.addresses;
  const p = N.plan(d, 'nmap', deep(), ' 10.0.1.0/24 ', { network: '' });
  assert.deepEqual(p.network, { label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  assert.deepEqual(p.hosts[1].networks, ['new']);
  assert.deepEqual(p.hosts[1].route, [], 'nmap is not attached to the new network');
  // Without nmap's own args, the field decides: only one CIDR proposes.
  const bare = Object.assign({}, deep(), { args: '' });
  assert.equal(N.plan(d, 'nmap', bare, '10.0.1.0/24 10.0.2.0/24', {}).network, null, 'only one CIDR');
  assert.equal(N.plan(d, 'nmap', bare, 'srv-01.lab', {}).network, null);
  const loose = lab();
  delete loose.associations.a3;
  const q = N.plan(loose, 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(q.appHost, null);
  assert.deepEqual(q.hosts[1].route, []);
});

test('a second nmap sees a known port but still needs its own flow', () => {
  const d = lab();
  d.entities.nmap2 = { kind: 'application', label: 'nmap 2', tool: 'nmap' };
  d.associations.a6 = { kind: 'hosts', from: 'srv', to: 'nmap2', privilege: 'user' };
  const p = N.plan(d, 'nmap2', deep(), '10.0.1.0/24', {});
  assert.deepEqual([p.hosts[0].ports[0].known, p.hosts[0].ports[0].addsFlow], ['sshd', true]);
  assert.ok(N.defaults(p).ports['h0/tcp/22']);
});

test('the summary counts what ticking adds and refuses to pass the limits', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  const t = N.defaults(p);
  const limits = { entities: 500, relationships: 2000 };
  const s = N.summary(d, p, t, limits);
  // New: host 10.0.1.7; services tcp/8443, domain, ssh(10.0.1.7); products
  // unidentified-8443, dnsmasq (OpenSSH reused). Flows: three.
  assert.deepEqual([s.hosts, s.networks, s.services, s.products, s.flows], [1, 0, 3, 2, 3]);
  assert.equal(s.entities, Object.keys(d.entities).length + 6);
  // attached 1 + hosts 3 + instance-of 3 + flows 3
  assert.equal(s.relationships, Object.keys(d.associations).length + Object.keys(d.flows).length + 10);
  assert.equal(s.tooMany, null);
  t.hosts.h1 = false;
  assert.deepEqual([N.summary(d, p, t, limits).hosts, N.summary(d, p, t, limits).services], [0, 2], 'an unticked host takes its ports along');
  const tight = N.summary(d, p, N.defaults(p), { entities: 10, relationships: 2000 });
  assert.match(tight.tooMany, /13 components; the limit is 10/);
  assert.match(N.summary(d, p, N.defaults(p), { entities: 500, relationships: 12 }).tooMany, /16 links and flows; the limit is 12/);
});

test('unidentified software is never shared, not even in the count', () => {
  const two = { args: '', silentUdp: 0, hosts: [{ addresses: ['10.0.1.8'], hostname: null, os: null, ports: [
    { protocol: 'tcp', port: 80, state: 'open', service: { name: 'http', product: null, version: null } },
    { protocol: 'tcp', port: 81, state: 'open', service: { name: 'http', product: null, version: null } },
  ] }] };
  const p = N.plan(lab(), 'nmap', two, '10.0.1.0/24', {});
  assert.equal(N.summary(lab(), p, N.defaults(p), null).products, 2);
});

const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const STAMP = { date: '2026-09-24', level: 'Deep', range: '10.0.1.0/24' };

test('applying adds exactly what was ticked, once, and leaves the rest alone', () => {
  const d = lab();
  const before = JSON.stringify(d);
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  const edit = N.apply(d, p, N.defaults(p), specOf, STAMP);
  assert.equal(JSON.stringify(d), before, 'pure');
  assert.equal(edit.select, 'entity/nmap');
  const out = edit.doc;
  for (const id of Object.keys(d.entities)) {
    if (id !== 'nmap') assert.deepEqual(out.entities[id], d.entities[id], 'untouched: ' + id);
  }
  for (const id of Object.keys(d.associations)) assert.deepEqual(out.associations[id], d.associations[id]);
  assert.deepEqual(out.flows.f1, d.flows.f1);
  assert.equal(out.entities.nmap.description, 'Last nmap import: 2026-09-24, Deep scan of 10.0.1.0/24.');
  const host = Object.keys(out.entities).find(id => out.entities[id].label === '10.0.1.7');
  assert.deepEqual(out.entities[host].addresses, ['10.0.1.7']);
  assert.equal(out.entities[host].kind, 'host');
  assert.ok(Object.values(out.associations).some(a => a.kind === 'attached' && a.from === host && a.to === 'lan'));
  // nmap cannot see the account a service runs as: unknown, not a guess.
  const imported = Object.values(out.associations).filter(a => a.kind === 'hosts' && out.entities[a.to].kind === 'service' && a.to !== 'sshd');
  assert.equal(imported.length, 3);
  assert.ok(imported.every(a => a.privilege === 'unknown' && a.description === undefined), JSON.stringify(imported));
  const openssh = Object.values(out.associations).filter(a => a.kind === 'instance-of' && a.to === 'openssh');
  assert.equal(openssh.length, 2, 'the known product is shared');
  const flows = Object.values(out.flows).filter(f => f.source === 'nmap');
  assert.deepEqual(flows.map(f => [f.label, f.protocol, f.route]).sort(), [
    ['domain on Server', 'udp/53', ['lan']],
    ['ssh on 10.0.1.7', 'tcp/22', ['lan']],
    ['ssh on Server', 'tcp/22', ['lan']],
    ['tcp/8443 on Server', 'tcp/8443', ['lan']],
  ]);
  // Scanning again changes nothing but the stamp.
  const again = N.plan(out, 'nmap', deep(), '10.0.1.0/24', {});
  const s = N.summary(out, again, N.defaults(again), { entities: 500, relationships: 2000 });
  assert.deepEqual([s.hosts, s.services, s.products, s.flows], [0, 0, 0, 0]);
});

test('merging fills the chosen host; a proposed network is made and used', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', { h1: 'printer' });
  const merged = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  assert.deepEqual(merged.entities.printer.addresses, ['10.0.1.7']);
  assert.equal(merged.entities.printer.label, 'Printer');

  const bare = lab();
  delete bare.entities.lan.addresses;
  const one = { args: '', silentUdp: 0, hosts: [{ addresses: ['10.0.1.9'], hostname: null, os: null, ports: [] }] };
  const q = N.plan(bare, 'nmap', one, '10.0.1.0/24', { network: '' });
  const out = N.apply(bare, q, N.defaults(q), specOf, STAMP).doc;
  const net = Object.keys(out.entities).find(id => out.entities[id].label === '10.0.1.0/24');
  assert.deepEqual(out.entities[net], { kind: 'network', label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  const h = Object.keys(out.entities).find(id => out.entities[id].label === '10.0.1.9');
  assert.ok(Object.values(out.associations).some(a => a.kind === 'attached' && a.from === h && a.to === net));
});

test('nothing ticked is no edit; a second import keeps the rest of the description', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  assert.equal(N.apply(d, p, { hosts: {}, ports: {}, network: false }, specOf, STAMP), null);
  d.entities.nmap.description = 'Runs from the admin box.\nLast nmap import: 2026-09-01, Standard scan of 10.0.1.0/24.';
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  assert.equal(out.entities.nmap.description, 'Runs from the admin box.\nLast nmap import: 2026-09-24, Deep scan of 10.0.1.0/24.');
});

test('a hostile name becomes a label as it is and a valid id', () => {
  const d = lab();
  const scan = N.read(fixture('hostile.xml')).scan;
  const p = N.plan(d, 'nmap', scan, '10.0.3.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  const id = Object.keys(out.entities).find(k => out.entities[k].label === '<img src=x onerror=alert(1)>&ünï');
  assert.match(id, /^[a-z0-9][a-z0-9-]*$/);
  assert.match(id, /[a-z-]/);
});

test('a new nmap application runs on its host as user and says it is nmap', () => {
  const d = lab();
  const e = N.addNmap(d, 'srv', 'nmap', specOf);
  assert.equal(e.doc.entities[e.entity].tool, 'nmap');
  assert.equal(e.doc.entities[e.entity].kind, 'application');
  assert.ok(Object.values(e.doc.associations).some(a => a.kind === 'hosts' && a.from === 'srv' && a.to === e.entity && a.privilege === 'user'));
  assert.equal(e.select, 'entity/' + e.entity);
  const loose = N.addNmap(E.empty(), null, 'nmap', specOf);
  assert.deepEqual(Object.keys(loose.doc.associations), []);
});

test('the imported lab document is the one the Rust test validates', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', { h1: 'printer' });
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  const file = 'scripts/fixtures/nmap/imported.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

// ---- review fixes ----

test('a host nmap lists twice (named twice in the range) is one host with every port once', () => {
  const { scan } = N.read(fixture('duplicate-no-sv.xml'));
  assert.equal(scan.hosts.length, 1);
  assert.equal(scan.hosts[0].hostname, 'localhost');
  const open = scan.hosts[0].ports.map(p => p.protocol + '/' + p.port);
  assert.deepEqual(open, [...new Set(open)], 'no port twice');
  assert.ok(open.length >= 1);
  const p = N.plan(E.empty(), 'nmap', scan, '127.0.0.1 localhost', {});
  assert.equal(p.hosts.length, 1);
});

test('two rows cannot become the same hand-drawn host; the first choice wins', () => {
  const scan = { args: '', silentUdp: 0, hosts: [
    { addresses: ['10.0.1.20'], hostname: null, os: null, ports: [] },
    { addresses: ['10.0.1.21'], hostname: null, os: null, ports: [] },
  ] };
  const p = N.plan(lab(), 'nmap', scan, '10.0.1.0/24', { h0: 'printer', h1: 'printer' });
  assert.deepEqual([p.hosts[0].merged, p.hosts[1].merged], ['printer', null]);
});

test('IPv6 ranges get -6; IPv4 and IPv6 are never mixed in one command', () => {
  assert.equal(N.command('standard', 'fd00::/120').text, 'nmap -6 -sT -sV -oX - fd00::/120');
  assert.equal(N.command('deep', 'fd00::5 fd00::6').text, 'sudo nmap -6 -sS -sU -sV -O --top-ports 1000 -oX - fd00::5 fd00::6');
  const mixed = N.command('standard', '10.0.1.0/24 fd00::/64');
  assert.equal(mixed.text, undefined);
  assert.match(mixed.problem, /IPv4 and IPv6/);
  assert.match(N.command('standard', 'fd00::/64').note, /\/64/, 'a wide IPv6 range is said to be slow');
  assert.equal(N.command('standard', '10.0.1.0/24').note, undefined);
});

test('text around the XML is skipped; a result missing its start is cut off, not "not XML"', () => {
  const xml = fixture('deep-lab.xml');
  const bare = N.read(xml);
  assert.deepEqual(N.read('user@box:~$ sudo nmap -sS -oX - 10.0.1.0/24\n[sudo] password for user: \n' + xml), bare);
  assert.deepEqual(N.read(xml.replace(/^[\s\S]*?(<nmaprun)/, '$1')), bare, 'from <nmaprun> on');
  const tail = xml.slice(xml.indexOf('<host>'));
  assert.equal(N.read(tail).problem.code, 'truncated');
  assert.match(N.read(tail).problem.message, /cut off/);
  assert.equal(N.read('user@box:~$ nmap -sT 10.0.1.0/24\nhello').problem.code, 'not-xml');
});

test('the stamp says what nmap says it ran, and never "of ."', () => {
  const deepScan = N.read(fixture('deep-lab.xml')).scan;
  assert.deepEqual(N.stampFor(deepScan, '', '2026-09-24'), { date: '2026-09-24', level: 'Deep', range: '10.0.1.0/24' });
  const own = { args: 'nmap -sT --top-ports 100 -oX - 127.0.0.1 localhost', hosts: [], silentUdp: 0 };
  assert.deepEqual(N.stampFor(own, '', '2026-09-24'), { date: '2026-09-24', level: null, range: '127.0.0.1 localhost' });
  assert.equal(N.stampLine({ date: '2026-09-24', level: null, range: '127.0.0.1 localhost' }), 'Last nmap import: 2026-09-24, scan of 127.0.0.1 localhost.');
  assert.equal(N.stampLine({ date: '2026-09-24', level: 'Deep', range: '' }), 'Last nmap import: 2026-09-24, Deep scan.');
  const noArgs = { args: '', hosts: [], silentUdp: 0 };
  assert.deepEqual(N.stampFor(noArgs, ' 10.0.1.0/24 ', '2026-09-24'), { date: '2026-09-24', level: null, range: '10.0.1.0/24' });
});

// ---- the scanning host, and attachment by address (owner, 2026-09-24) ----

// The owner's case: nmap on a drawn "altiera" without addresses or network;
// the scan of 192.168.2.138/24 finds altiera.fritz.box at .138 and a box.
function laptop() {
  const d = E.empty();
  d.entities = {
    altiera: { kind: 'host', label: 'altiera' },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
  };
  d.associations = { a1: { kind: 'hosts', from: 'altiera', to: 'nmap', privilege: 'admin' } };
  return d;
}
const home = () => ({ args: 'nmap -sT -sV -oX - 192.168.2.138/24', silentUdp: 0, hosts: [
  { addresses: ['192.168.2.1'], hostname: 'fritz.box', os: null, self: false, ports: [
    { protocol: 'tcp', port: 80, state: 'open', service: { name: 'http', product: null, version: null } }] },
  { addresses: ['192.168.2.138'], hostname: 'altiera.fritz.box', os: null, self: false, ports: [] },
] });

test('the host nmap runs on is recognised by name and offered as the merge', () => {
  const p = N.plan(laptop(), 'nmap', home(), '192.168.2.138/24', {});
  assert.deepEqual([p.hosts[0].merged, p.hosts[1].merged], [null, 'altiera']);
  assert.equal(p.hosts[1].guessed, true);
  assert.equal(p.hosts[1].label, 'altiera');
  // Choosing "new" in the preview is kept: the guess does not come back.
  assert.equal(N.plan(laptop(), 'nmap', home(), '192.168.2.138/24', { h1: '' }).hosts[1].merged, null);
  // A root scan marks nmap's own address; the name does not matter then.
  const marked = home();
  marked.hosts[1].hostname = 'something-else';
  marked.hosts[1].self = true;
  assert.equal(N.plan(laptop(), 'nmap', marked, '192.168.2.138/24', {}).hosts[1].merged, 'altiera');
  // Only nmap's own host is guessed, and only when it has no addresses.
  const d = laptop();
  d.entities.altiera.addresses = ['10.9.9.9'];
  assert.equal(N.plan(d, 'nmap', home(), '192.168.2.138/24', {}).hosts[1].merged, null);
});

test('a root scan says which address is nmap itself', () => {
  const xml = fixture('deep-lab.xml').replace('<status state="up" reason="arp-response" reason_ttl="0"/>\n<address addr="10.0.1.7"', '<status state="up" reason="localhost-response" reason_ttl="0"/>\n<address addr="10.0.1.7"');
  const { scan } = N.read(xml);
  assert.deepEqual(scan.hosts.map(h => h.self), [false, true]);
});

test('the scanning host joins the network its address is in, and the flows get their route', () => {
  const d = laptop();
  const p = N.plan(d, 'nmap', home(), '192.168.2.138/24', {});
  assert.deepEqual(p.network, { label: '192.168.2.0/24', addresses: ['192.168.2.0/24'] }, 'the network, not the address typed');
  assert.deepEqual(p.hosts[1].networks, ['new']);
  assert.deepEqual(p.hosts[0].route, ['new']);
  const s = N.summary(d, p, N.defaults(p), null);
  assert.deepEqual([s.hosts, s.networks, s.attached, s.services, s.flows], [1, 1, 1, 1, 1]);
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  const net = Object.keys(out.entities).find(id => out.entities[id].kind === 'network');
  assert.deepEqual(out.entities.altiera.addresses, ['192.168.2.138']);
  assert.ok(Object.values(out.associations).some(a => a.kind === 'attached' && a.from === 'altiera' && a.to === net));
  assert.deepEqual(Object.values(out.flows).map(f => f.route), [[net]]);
  // Unticking the scanning host leaves it off the network: the flow has no route.
  const t = N.defaults(p);
  t.hosts.h1 = false;
  assert.deepEqual(Object.values(N.apply(d, p, t, specOf, STAMP).doc.flows).map(f => f.route), [[]]);
});

test('a known host is attached where its address says, once', () => {
  const d = lab();
  delete d.associations.a2; // Server lost its attachment to the lab network
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  assert.deepEqual(p.hosts[0].networks, ['lan']);
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  assert.equal(Object.values(out.associations).filter(a => a.kind === 'attached' && a.from === 'srv' && a.to === 'lan').length, 1);
  const again = N.plan(out, 'nmap', deep(), '10.0.1.0/24', {});
  assert.deepEqual(again.hosts[0].networks, []);
  // Only attaching is still an edit.
  const only = N.plan(d, 'nmap', { args: '', silentUdp: 0, hosts: [{ addresses: ['10.0.1.5'], hostname: null, os: null, self: false, ports: [] }] }, '10.0.1.0/24', {});
  assert.ok(N.apply(d, only, N.defaults(only), specOf, STAMP));
});

// ---- routers and firewalls (roadmap nmap-routers, spec §4.5) ----

const routers = () => N.read(fixture('router-lab.xml')).scan;

test("nmap's device class is read from its best OS match", () => {
  assert.deepEqual(routers().hosts.map(h => h.device), [['WAP', 'broadband router'], ['firewall', 'general purpose'], ['printer']]);
  assert.deepEqual(N.read(fixture('standard-localhost.xml')).scan.hosts[0].device, [], 'no OS detection, no class');
});

test('the role is preselected from the class only: router, router with firewall, host', () => {
  const p = N.plan(laptop(), 'nmap', routers(), '192.168.2.0/24', {});
  assert.deepEqual(p.hosts.map(h => [h.role, h.roleOffered, h.device]), [
    ['router', true, 'WAP'], ['firewall', true, 'firewall'], ['host', true, 'printer'],
  ]);
  assert.deepEqual(N.defaults(p).roles, { h0: 'router', h1: 'firewall', h2: 'host' });
  // No OS detection: every row is a host, still offered.
  const plain = N.plan(laptop(), 'nmap', home(), '192.168.2.138/24', {});
  assert.deepEqual(plain.hosts.map(h => [h.role, h.roleOffered, h.device]), [['host', true, null], ['host', true, null]]);
});

test('a host that already runs a router is offered no role', () => {
  const d = laptop();
  d.entities.gw = { kind: 'host', label: 'Gateway', addresses: ['192.168.2.1'] };
  d.entities['gw-router'] = { kind: 'router', label: 'Gateway router' };
  d.associations.a2 = { kind: 'hosts', from: 'gw', to: 'gw-router', privilege: 'admin' };
  const p = N.plan(d, 'nmap', routers(), '192.168.2.0/24', {});
  assert.deepEqual([p.hosts[0].known, p.hosts[0].role, p.hosts[0].roleOffered], ['gw', 'host', false]);
});

test('router adds the router on its box, on every network the box is on; firewall adds its filter', () => {
  const d = laptop();
  const p = N.plan(d, 'nmap', routers(), '192.168.2.0/24', {});
  const t = N.defaults(p);
  const s = N.summary(d, p, t, null);
  assert.deepEqual([s.hosts, s.networks, s.routers, s.firewalls], [3, 1, 2, 1]);
  const out = N.apply(d, p, t, specOf, STAMP).doc;
  const byLabel = l => Object.keys(out.entities).find(id => out.entities[id].label === l);
  const box = byLabel('fritz.box'), router = byLabel('fritz.box router'), net = byLabel('192.168.2.0/24');
  assert.equal(out.entities[router].kind, 'router');
  const as = Object.values(out.associations);
  assert.ok(as.some(a => a.kind === 'hosts' && a.from === box && a.to === router && a.privilege === 'admin'));
  assert.ok(as.some(a => a.kind === 'attached' && a.from === router && a.to === net));
  assert.ok(as.some(a => a.kind === 'attached' && a.from === box && a.to === net), 'the box stays on the network');
  assert.ok(as.some(a => a.kind === 'hosts' && a.from === box && out.entities[a.to].label === 'http'), 'services run on the box');
  const fw = byLabel('opnsense.lab firewall');
  assert.equal(out.entities[fw].kind, 'firewall');
  assert.ok(as.some(a => a.kind === 'filters' && a.from === byLabel('opnsense.lab router') && a.to === fw));
  assert.equal(byLabel('printer.fritz.box router'), undefined);
  // Counts match what was made.
  assert.equal(Object.keys(out.entities).length, s.entities);
  assert.equal(Object.keys(out.associations).length + Object.keys(out.flows).length, s.relationships);
  // Importing again adds no second router.
  const again = N.plan(out, 'nmap', routers(), '192.168.2.0/24', {});
  assert.deepEqual(again.hosts.map(h => h.roleOffered), [false, false, true]);
  const s2 = N.summary(out, again, N.defaults(again), null);
  assert.deepEqual([s2.routers, s2.firewalls, s2.hosts], [0, 0, 0]);
});

test('the author decides: a class can be set back to host, a plain host made a router', () => {
  const d = laptop();
  const p = N.plan(d, 'nmap', routers(), '192.168.2.0/24', {});
  const t = N.defaults(p);
  t.roles = { h0: 'host', h1: 'host', h2: 'router' };
  const out = N.apply(d, p, t, specOf, STAMP).doc;
  const kinds = Object.values(out.entities).map(e => e.kind);
  assert.equal(kinds.filter(k => k === 'router').length, 1);
  assert.equal(kinds.filter(k => k === 'firewall').length, 0);
  assert.ok(Object.values(out.entities).some(e => e.label === 'printer.fritz.box router'));
});

test('the router import is the document the Rust and wasm checks validate', () => {
  const d = laptop();
  const p = N.plan(d, 'nmap', routers(), '192.168.2.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  const file = 'scripts/fixtures/nmap/imported-router.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('an old scan pasted without a range still names its network, from what nmap ran', () => {
  const d = lab();
  delete d.entities.lan.addresses;
  // deep-lab.xml was run on 10.0.1.0/24; the range field is empty.
  const p = N.plan(d, 'nmap', deep(), '', { network: '' });
  assert.deepEqual(p.network, { label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  // What the scan says it covered wins over a field showing something else.
  assert.deepEqual(N.plan(d, 'nmap', deep(), '10.9.0.0/16', { network: '' }).network, { label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  // A scan of single addresses or names says no network: the field is used.
  const named = Object.assign({}, deep(), { args: 'nmap -sT -sV -oX - srv-01.lab 10.0.1.7' });
  assert.deepEqual(N.plan(d, 'nmap', named, '10.0.1.0/24', { network: '' }).network, { label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  assert.equal(N.plan(d, 'nmap', named, '', {}).network, null);
});

test('a tcpwrapped port is no service: counted in a note, never a row', () => {
  const xml = fixture('deep-lab.xml').replace('<port protocol="tcp" portid="8443"><state state="open" reason="syn-ack" reason_ttl="64"/></port>',
    '<port protocol="tcp" portid="8443"><state state="open" reason="syn-ack" reason_ttl="64"/><service name="tcpwrapped" method="probed" conf="8"/></port>');
  const scan = N.read(xml).scan;
  assert.equal(scan.hosts[0].ports[1].service.name, 'tcpwrapped', 'read as nmap says');
  const p = N.plan(lab(), 'nmap', scan, '10.0.1.0/24', {});
  assert.deepEqual(p.hosts[0].ports.map(r => r.proto), ['tcp/22', 'udp/53']);
  assert.equal(p.tcpwrapped, 1);
  assert.equal(N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', {}).tcpwrapped, 0);
});

test('the nmap hint shows on an architecture until it has an nmap, never once dismissed', () => {
  const d = lab();
  assert.equal(N.hintWanted(d, false), false, 'it has an nmap already');
  delete d.entities.nmap;
  assert.equal(N.hintWanted(d, false), true);
  assert.equal(N.hintWanted(E.empty(), false), true, 'an empty architecture too');
  assert.equal(N.hintWanted(d, true), false, 'dismissed');
  assert.equal(N.hintWanted({ profile: 'attack-tree', nodes: {} }, false), false);
  assert.equal(N.hintWanted(null, false), false);
});

// ---- checks (spec §3.2, §4.6) ----

test('checks add nmap\'s vulnerability scripts, never one that asks a third party', () => {
  assert.deepEqual(N.CHECKS.map(c => c.id), ['none', 'safe', 'all']);
  assert.ok(N.CHECKS.filter(c => c.script).every(c => / and not external$/.test(c.script)));
  assert.ok(N.CHECKS.every(c => !!c.warning === (c.id === 'all')));
  const r = '10.0.1.0/24';
  assert.equal(N.command('standard', r, 'none').text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', r).text, 'nmap -sT -sV -oX - 10.0.1.0/24');
  assert.equal(N.command('standard', r, 'safe').text, "nmap -sT -sV --script 'vuln and safe and not external' -oX - 10.0.1.0/24");
  assert.equal(N.command('deep', r, 'all').text, "sudo nmap -sS -sU -sV -O --top-ports 1000 --script 'vuln and not external' -oX - 10.0.1.0/24");
  assert.equal(N.command('discover', r, 'all').text, 'nmap -sn -oX - 10.0.1.0/24', 'no ports, no checks');
  assert.equal(N.checksOffered('discover'), false);
  assert.equal(N.checksOffered('standard'), true);
});

const checks = () => N.read(fixture('checks-lab.xml')).scan;

test('scripts are read with their structured findings, on ports and on hosts', () => {
  const scan = checks();
  const web = scan.hosts[0];
  const https = web.ports.find(p => p.port === 443);
  assert.deepEqual(https.scripts.map(s => s.id), ['http-server-header', 'ssl-heartbleed', 'ssl-poodle', 'http-git']);
  const hb = https.scripts[1];
  assert.deepEqual(hb.vulns, [{ key: 'CVE-2014-0160', title: 'The Heartbleed Bug is a serious vulnerability in the popular OpenSSL cryptographic software library. It allows for stealing information intended to be protected by SSL/TLS encryption.', state: 'VULNERABLE', ids: ['CVE:CVE-2014-0160'] }]);
  assert.match(https.scripts[3].output, /^\n {2}10\.0\.1\.5:443\/\.git\/\n/);
  assert.deepEqual(https.scripts[3].vulns, []);
  assert.deepEqual(web.ports.find(p => p.port === 22).scripts, []);
  assert.deepEqual(web.scripts, []);
  assert.deepEqual(scan.hosts[2].scripts.map(s => [s.id, s.vulns[0].state]), [['smb-vuln-ms17-010', 'VULNERABLE']]);
});

// A lab for the checks: nmap in 10.0.1.0/24, nginx 1.4.6 already drawn and
// said to be patched on nothing yet.
function checksLab() {
  const d = lab();
  delete d.entities.srv.addresses;
  return d;
}

test('a finding marks the product of its port; a shared product once; what is not read is shown', () => {
  const d = checksLab();
  const p = N.plan(d, 'nmap', checks(), '10.0.1.0/24', {});
  const [web, web2, win, nas, bare] = p.hosts;
  const https = web.ports.find(r => r.proto === 'tcp/443');
  assert.deepEqual(https.findings.map(f => [f.script, f.id, f.state, f.product, f.productLabel]), [
    ['ssl-heartbleed', 'CVE-2014-0160', 'VULNERABLE', null, 'nginx 1.4.6'],
  ]);
  assert.equal(https.findings[0].line, 'nmap ssl-heartbleed: VULNERABLE, CVE-2014-0160 (The Heartbleed Bug is a serious vulnerability in the popular OpenSSL cryptographic software library).');
  // version scripts are left out, NOT VULNERABLE says nothing, others are shown
  assert.deepEqual(https.unread, [{ script: 'http-git', text: 'not read · 10.0.1.5:443/.git/' }]);
  assert.deepEqual(web.ports.find(r => r.proto === 'tcp/8080').unread, [{ script: 'http-vuln-cve2015-1635', text: 'could not test' }]);
  assert.deepEqual(web.ports.find(r => r.proto === 'tcp/8080').findings, []);
  assert.equal(web2.ports[0].findings.length, 1);
  // host checks talk SMB: tcp/445, else tcp/139, else not applied
  assert.deepEqual(win.ports.find(r => r.proto === 'tcp/445').findings.map(f => f.id), ['CVE-2017-0143']);
  assert.deepEqual(win.ports.find(r => r.proto === 'tcp/139').findings, []);
  assert.deepEqual(nas.ports.find(r => r.proto === 'tcp/139').findings.map(f => [f.id, f.state]), [['ms17-010', 'LIKELY VULNERABLE']]);
  assert.deepEqual(bare.ports, []);
  assert.deepEqual(bare.unplaced.map(f => [f.script, f.id]), [['smb-vuln-ms17-010', 'CVE-2017-0143']]);
  const t = N.defaults(p);
  assert.equal(t.findings[https.findings[0].key], true);
  const s = N.summary(d, p, t, null);
  assert.equal(s.unpatched, 3, 'nginx once, the Windows share, the Samba one');
  t.findings[https.findings[0].key] = false;
  assert.equal(N.summary(d, p, t, null).unpatched, 3, 'the second nginx still marks it');
  t.findings[web2.ports[0].findings[0].key] = false;
  assert.equal(N.summary(d, p, t, null).unpatched, 2);
  const u = N.defaults(p);
  u.ports[win.ports.find(r => r.proto === 'tcp/445').key] = false;
  assert.equal(N.summary(d, p, u, null).unpatched, 2, 'an unticked new port takes its findings along');
});

test('applying a finding marks unpatched and says why, and never writes a time', () => {
  const d = checksLab();
  const p = N.plan(d, 'nmap', checks(), '10.0.1.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  const nginx = Object.values(out.entities).filter(e => e.label === 'nginx 1.4.6');
  assert.equal(nginx.length, 1);
  assert.equal(nginx[0].defenses.patched, false);
  assert.deepEqual(nginx[0].parameters['find-exploit'], { status: 'unknown', note: 'nmap ssl-heartbleed: VULNERABLE, CVE-2014-0160 (The Heartbleed Bug is a serious vulnerability in the popular OpenSSL cryptographic software library).' });
  assert.deepEqual(nginx[0].parameters['find-exploit-patched'], { status: 'unknown' });
  const samba = Object.values(out.entities).find(e => e.label === 'Samba smbd 3.X - 4.X');
  assert.equal(samba.parameters['find-exploit'].note, 'nmap smb2-vuln-uptime: LIKELY VULNERABLE, ms17-010 (MS17-010: Security update for Windows SMB Server).');
  const iis = Object.values(out.entities).find(e => e.label === 'Microsoft IIS httpd 8.5');
  assert.equal(iis.defenses.patched, 'unknown', 'could not test is no finding');
  // Scanning again marks nothing new.
  const again = N.plan(out, 'nmap', checks(), '10.0.1.0/24', {});
  assert.equal(N.summary(out, again, N.defaults(again), null).unpatched, 0);
  assert.ok(again.hosts[0].ports.find(r => r.proto === 'tcp/443').findings[0].known);
});

test('a finding on a known product adds its line; one the author marked patched is left alone', () => {
  const d = checksLab();
  d.entities.nginx = { kind: 'product', label: 'nginx 1.4.6', parameters: { 'find-exploit': { status: 'assumed', ttc: 'Exponential(mean 3)', note: 'Old.' } }, defenses: { patched: 'unknown' } };
  let p = N.plan(d, 'nmap', checks(), '10.0.1.0/24', {});
  let out = N.apply(d, p, N.defaults(p), specOf, STAMP).doc;
  assert.equal(out.entities.nginx.defenses.patched, false);
  assert.deepEqual(out.entities.nginx.parameters['find-exploit'], { status: 'assumed', ttc: 'Exponential(mean 3)', note: 'Old.\nnmap ssl-heartbleed: VULNERABLE, CVE-2014-0160 (The Heartbleed Bug is a serious vulnerability in the popular OpenSSL cryptographic software library).' });
  d.entities.nginx.defenses.patched = true;
  p = N.plan(d, 'nmap', checks(), '10.0.1.0/24', {});
  const f = p.hosts[0].ports.find(r => r.proto === 'tcp/443').findings[0];
  assert.equal(f.patchedByAuthor, true);
  assert.equal(N.defaults(p).findings[f.key], false);
  out = N.apply(d, p, Object.assign(N.defaults(p), { findings: { [f.key]: true } }), specOf, STAMP).doc;
  assert.deepEqual(out.entities.nginx, d.entities.nginx, 'even ticked, the author\'s word stands');
});

test('the stamp names the checks nmap ran', () => {
  assert.deepEqual(N.stampFor(checks(), '', '2026-09-24'), { date: '2026-09-24', level: 'Standard', checks: 'safe', range: '10.0.1.0/24' });
  assert.equal(N.stampLine(N.stampFor(checks(), '', '2026-09-24')), 'Last nmap import: 2026-09-24, Standard scan with safe checks of 10.0.1.0/24.');
  const all = { args: 'nmap -sT -sV --script "vuln and not external" -oX - 10.0.1.0/24', hosts: [] };
  assert.equal(N.stampLine(N.stampFor(all, '', '2026-09-24')), 'Last nmap import: 2026-09-24, Standard scan with all checks of 10.0.1.0/24.');
  const own = { args: 'nmap -sT -sV --script vulners -oX - 10.0.1.0/24', hosts: [] };
  assert.equal(N.stampLine(N.stampFor(own, '', '2026-09-24')), 'Last nmap import: 2026-09-24, scan of 10.0.1.0/24.');
});

test('the checks import is the document the Rust and wasm checks validate', () => {
  const d = checksLab();
  const p = N.plan(d, 'nmap', checks(), '10.0.1.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, { date: '2026-09-24', level: 'Standard', checks: 'safe', range: '10.0.1.0/24' }).doc;
  const file = 'scripts/fixtures/nmap/imported-checks.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('a known port with nothing to add still marks its product', () => {
  const d = lab(); // Server 10.0.1.5 runs ssh on OpenSSH 9.6p1, already reached by nmap
  const scan = checks();
  scan.hosts[0].ports.find(p => p.port === 22).scripts = [{ id: 'sshv1', output: '', vulns: [{ key: 'X', title: 'SSHv1 enabled', state: 'VULNERABLE', ids: [] }] }];
  const p = N.plan(d, 'nmap', scan, '10.0.1.0/24', {});
  const ssh = p.hosts[0].ports.find(r => r.proto === 'tcp/22');
  assert.deepEqual([ssh.known, ssh.addsFlow, ssh.findings[0].product], ['sshd', false, 'openssh']);
  const t = N.defaults(p);
  assert.equal(t.ports[ssh.key], undefined);
  const out = N.apply(d, p, t, specOf, STAMP).doc;
  assert.equal(out.entities.openssh.defenses.patched, false);
  assert.equal(out.entities.openssh.parameters['find-exploit'].note, 'nmap sshv1: VULNERABLE, X (SSHv1 enabled).');
});

test('two scanned hosts that are one drawn host by address are one row: every port once, one router', () => {
  const d = lab();
  d.entities.lan2 = { kind: 'network', label: 'Second network', addresses: ['10.0.2.0/24'] };
  d.entities.srv.addresses = ['10.0.1.5', '10.0.2.5'];
  const port = (n, product) => ({ protocol: 'tcp', port: n, state: 'open', service: { name: 'svc' + n, product: product, version: null }, scripts: [] });
  const scan = { args: '', silentUdp: 0, hosts: [
    { addresses: ['10.0.1.5'], hostname: null, os: null, device: ['WAP'], ports: [port(80, 'nginx'), port(443, 'nginx')] },
    { addresses: ['10.0.1.9'], hostname: null, os: null, ports: [] },
    { addresses: ['10.0.2.5'], hostname: null, os: null, ports: [port(443, 'nginx'), port(8080, null)] },
  ] };
  const p = N.plan(d, 'nmap', scan, '', {});
  assert.deepEqual(p.hosts.map(h => [h.key, h.known]), [['h0', 'srv'], ['h1', null]], 'keys stay those of the first listing');
  const srv = p.hosts[0];
  assert.deepEqual(srv.addresses, ['10.0.1.5', '10.0.2.5']);
  assert.deepEqual(srv.ports.map(r => r.proto), ['tcp/80', 'tcp/443', 'tcp/8080']);
  assert.deepEqual(srv.networks, ['lan2'], 'attached where its second address says');
  assert.equal(srv.role, 'router', 'the device class of either listing');
  const t = N.defaults(p);
  const out = N.apply(d, p, t, specOf, STAMP).doc;
  const labels = Object.values(out.entities).map(e => e.label);
  assert.equal(labels.filter(l => l === 'svc443').length, 1, 'one service per port');
  assert.equal(labels.filter(l => l === 'Server router').length, 1, 'one router');
  assert.equal(Object.values(out.flows).filter(f => f.protocol === 'tcp/443').length, 1);
});

test('a host listed with every port reads in time (ports are keyed, not searched)', () => {
  let x = '<?xml version="1.0"?><nmaprun args="nmap -oX - 10.0.0.5"><host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/><ports>';
  for (let i = 1; i <= 65535; i++) x += '<port protocol="tcp" portid="' + i + '"><state state="open"/></port>';
  x += '</ports></host><host><status state="up"/><address addr="10.0.0.5" addrtype="ipv4"/><ports><port protocol="tcp" portid="7"><state state="open"/></port></ports></host>';
  x += '<runstats><finished exit="success"/></runstats></nmaprun>';
  const t = Date.now();
  const { scan } = N.read(x);
  const ms = Date.now() - t;
  assert.equal(scan.hosts.length, 1);
  assert.equal(scan.hosts[0].ports.length, 65535);
  assert.ok(ms < 3000, 'read took ' + ms + ' ms');
});

test('an IPv6 link-local address may name its interface; nothing else gets through with it', () => {
  assert.equal(N.command('standard', 'fe80::1%eth0').text, 'nmap -6 -sT -sV -oX - fe80::1%eth0');
  assert.equal(N.command('standard', 'fe80::1%enp0s3.100 fe80::2%wlan_0').text, 'nmap -6 -sT -sV -oX - fe80::1%enp0s3.100 fe80::2%wlan_0');
  for (const bad of ['10.0.0.1%eth0', 'fe80::1%', 'fe80::1%eth0;id', 'fe80::1%$(id)', 'fe80::1%eth0%eth1', '%eth0', 'fe80::1%-x', 'host%eth0']) {
    assert.equal(N.command('standard', bad).text, undefined, bad);
  }
  assert.match(N.command('standard', 'fe80::/64%eth0').note, /too wide/);
});

test('the summary says what Add does, a merge that only fills addresses included', () => {
  const d = lab();
  const one = { args: '', silentUdp: 0, hosts: [{ addresses: ['10.0.1.7'], hostname: null, os: null, ports: [] }] };
  const p = N.plan(d, 'nmap', one, '10.0.1.0/24', { h0: 'printer' });
  const t = N.defaults(p);
  const s = N.summary(d, p, t, null);
  assert.equal(s.filled, 1);
  assert.equal(N.said(s), 'Adds 1 attachment, addresses for 1 drawn host.');
  assert.equal(N.said(Object.assign({}, s, { attached: 0 })), 'Adds addresses for 1 drawn host.');
  assert.equal(N.said(Object.assign({}, s, { attached: 0, filled: 0 })), 'Nothing new to add.');
  assert.equal(N.said(Object.assign({}, s, { attached: 0, filled: 0, unpatched: 2 })), 'Marks 2 products unpatched.');
  assert.equal(N.said(Object.assign({}, s, { hosts: 2, services: 1, attached: 0, filled: 0, unpatched: 1 })), 'Adds 2 hosts, 1 service, marks 1 product unpatched.');
  t.hosts.h0 = false;
  assert.equal(N.summary(d, p, t, null).filled, 0);
});

test('past the limits the summary says what to untick: hosts, or ports of the one host', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  const t = N.defaults(p);
  assert.match(N.summary(d, p, t, { entities: 10, relationships: 2000 }).tooMany, /Untick some hosts, or scan a smaller range\.$/);
  t.hosts.h1 = false;
  assert.match(N.summary(d, p, t, { entities: 10, relationships: 2000 }).tooMany, /Untick some ports\.$/);
});

test('a drawn network without addresses may be the proposed one: filled, not drawn twice', () => {
  const d = lab();
  delete d.entities.lan.addresses; // admin-box and srv are attached to it
  const p0 = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  assert.deepEqual(p0.networkCandidates, ['lan']);
  // nmap's host is on it, and on no other without addresses: a guess, said.
  assert.equal(p0.network.merged, 'lan');
  assert.equal(p0.network.guessed, true);
  // "" is a chosen "new": no guess returns.
  const fresh = N.plan(d, 'nmap', deep(), '10.0.1.0/24', { network: '' });
  assert.ok(!fresh.network.merged);
  // nmap's host on no such network: new.
  const off = JSON.parse(JSON.stringify(d));
  for (const [k, a] of Object.entries(off.associations)) if (a.kind === 'attached' && a.to === 'lan' && a.from === 'admin-box') delete off.associations[k];
  assert.ok(!N.plan(off, 'nmap', deep(), '10.0.1.0/24', {}).network.merged);

  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', { network: 'lan' });
  assert.equal(p.network.merged, 'lan');
  assert.ok(!p.network.guessed, 'chosen, not guessed');
  assert.deepEqual(p.hosts.map(h => h.networks), [[], ['lan']], 'the server is on it already');
  assert.deepEqual(p.hosts.map(h => h.route), [['lan'], ['lan']]);
  const t = N.defaults(p);
  const s = N.summary(d, p, t, null);
  assert.deepEqual([s.networks, s.filledNetworks, s.attached, s.hosts], [0, 1, 0, 1]);
  assert.equal(N.said({ hosts: 0, filled: 0, filledNetworks: 1 }), 'Adds addresses for 1 drawn network.');
  const out = N.apply(d, p, t, specOf, STAMP).doc;
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'network').length, 1);
  assert.deepEqual(out.entities.lan.addresses, ['10.0.1.0/24']);
  const h = Object.keys(out.entities).find(id => out.entities[id].label === '10.0.1.7');
  assert.ok(Object.values(out.associations).some(a => a.kind === 'attached' && a.from === h && a.to === 'lan'));
  assert.ok(Object.values(out.flows).every(f => f.route.length === 1 && f.route[0] === 'lan'));

  // Unticked, the drawn network is left as it is and nobody joins it.
  t.network = false;
  const s2 = N.summary(d, p, t, null);
  assert.deepEqual([s2.filledNetworks, s2.attached], [0, 0]);
  const kept = N.apply(d, p, t, specOf, STAMP).doc;
  assert.equal(kept.entities.lan.addresses, undefined);
  // A chosen network with addresses, or not a network, is no choice.
  assert.ok(!N.plan(d, 'nmap', deep(), '10.0.1.0/24', { network: 'srv' }).network.merged);
});

test('ticking a host ticks what it offers; all hosts at once', () => {
  const d = lab();
  const p = N.plan(d, 'nmap', deep(), '10.0.1.0/24', {});
  const t = N.defaults(p);
  N.tickHosts(p, t, false);
  assert.deepEqual(t.hosts, { h0: false, h1: false });
  assert.ok(Object.values(t.ports).every(v => !v));
  assert.equal(N.summary(d, p, t, null).hosts, 0);
  N.tickHosts(p, t, true);
  const on = o => Object.keys(o).filter(k => o[k]);
  const d0 = N.defaults(p);
  assert.deepEqual([on(t.hosts), on(t.ports), on(t.findings)], [on(d0.hosts), on(d0.ports), on(d0.findings)], 'back to what was offered');
  N.tickHost(p.hosts[1], t, false);
  assert.deepEqual([t.hosts.h0, t.hosts.h1, t.ports['h1/tcp/22']], [true, false, false]);
});
