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
  assert.equal(N.command('standard', '  10.0.1.0/24   fd00::/64 ').text, 'nmap -sT -sV -oX - 10.0.1.0/24 fd00::/64');
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
  assert.deepEqual(p.hosts[1].networks, [], 'a merged host keeps its own links');
  assert.deepEqual(p.hosts[1].route, [], 'Printer is attached nowhere yet');
  // A merge into a host that has addresses, or into a known one, is ignored.
  assert.equal(N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h1: 'srv' }).hosts[1].merged, null);
  assert.equal(N.plan(lab(), 'nmap', deep(), '10.0.1.0/24', { h0: 'printer' }).hosts[0].merged, null);
});

test('a range no network holds is proposed as a new network; a nmap on no host gives no routes', () => {
  const d = lab();
  delete d.entities.lan.addresses;
  const p = N.plan(d, 'nmap', deep(), ' 10.0.1.0/24 ', {});
  assert.deepEqual(p.network, { label: '10.0.1.0/24', addresses: ['10.0.1.0/24'] });
  assert.deepEqual(p.hosts[1].networks, ['new']);
  assert.deepEqual(p.hosts[1].route, [], 'nmap is not attached to the new network');
  assert.equal(N.plan(d, 'nmap', deep(), '10.0.1.0/24 10.0.2.0/24', {}).network, null, 'only one CIDR');
  assert.equal(N.plan(d, 'nmap', deep(), 'srv-01.lab', {}).network, null);
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
