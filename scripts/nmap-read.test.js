const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../assets/js/nmap-read.js');
const Ad = require('../assets/js/nmap-address.js');
const fixture = name => fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8');

test('a MAC is an identity with its vendor; addresses stay IP addresses', () => {
  const { scan } = R.read(fixture('lan-arp.xml'));
  const gw = scan.hosts[0];
  assert.deepEqual(gw.addresses, ['10.0.1.1']);
  assert.deepEqual(gw.identities, ['mac:00:1a:2b:3c:4d:01']);
  assert.equal(gw.vendor, 'Ubiquiti Networks');
  assert.deepEqual(gw.hostnames, [{ name: 'gw.lab', type: 'PTR' }]);
  assert.deepEqual(gw.names, [{ name: 'gw.lab', from: 'DNS' }]);
});

test('many addresses behind one MAC stay separate hosts, and that MAC identifies none of them', () => {
  const { scan } = R.read(fixture('lan-arp.xml'));
  const pair = scan.hosts.filter(h => h.vendor === 'Cisco Systems');
  assert.deepEqual(pair.map(h => h.addresses), [['10.0.1.200'], ['10.0.1.201']]);
  assert.deepEqual(pair.map(h => h.identities), [[], []]);
  assert.equal(scan.sharedMacs, 1);
});

test('one machine listed by its IPv4 and its IPv6 address is one host by its MAC', () => {
  const xml = fixture('lan-arp.xml').replace('<address addr="10.0.1.201" addrtype="ipv4"/>\n<address addr="00:1A:2B:3C:4D:99"', '<address addr="fd00::5" addrtype="ipv6"/>\n<address addr="52:54:00:12:34:56"');
  const { scan } = R.read(xml);
  const srv = scan.hosts.filter(h => h.addresses.includes('10.0.1.5'))[0];
  assert.deepEqual(srv.addresses, ['10.0.1.5', 'fd00::5']);
  assert.deepEqual(srv.identities, ['mac:52:54:00:12:34:56']);
});

test('the scan says its date, what it probed and how', () => {
  const { scan } = R.read(fixture('lan-arp.xml'));
  assert.equal(scan.date, '2026-09-27');
  assert.deepEqual(scan.types, ['syn']);
  assert.equal(R.probed(scan, 'tcp', 22), true);
  assert.equal(R.probed(scan, 'tcp', 8443), true);
  assert.equal(R.probed(scan, 'tcp', 8444), false);
  assert.equal(R.probed(scan, 'udp', 53), false);
  const srv = scan.hosts[1];
  assert.equal(srv.ports[0].reason, 'syn-ack');
  assert.equal(R.portState(srv, scan, 'tcp', 22), 'open');
  assert.equal(R.portState(srv, scan, 'tcp', 80), 'closed', 'the one grouped state');
  assert.equal(R.portState(srv, scan, 'tcp', 8444), 'not-probed');
});

test('identity scripts: SSH keys, NetBIOS and certificate names, the NetBIOS MAC once', () => {
  const { scan } = R.read(fixture('identity.xml'));
  const fs1 = scan.hosts[0];
  assert.deepEqual(fs1.identities, ['mac:00:0c:29:aa:bb:cc', 'ssh-ed25519:d5c1f0aa', 'ssh-rsa:11223344']);
  assert.deepEqual(fs1.names, [
    { name: 'filesrv.lab', from: 'NetBIOS' },
    { name: 'FILESRV', from: 'NetBIOS' },
    { name: 'files.lab', from: 'certificate' },
    { name: 'fs.lab', from: 'certificate' },
  ]);
});

test('odd names are plain text: no <unknown>, no control characters, no all-zero MAC, cut long', () => {
  const { scan } = R.read(fixture('identity.xml'));
  const odd = scan.hosts[1];
  assert.deepEqual(odd.identities, []);
  assert.deepEqual(odd.names, [{ name: '<script>xy', from: 'NetBIOS' }]);
  const long = fixture('identity.xml').replace('&lt;script&gt;x&#x7;y', 'A'.repeat(5000));
  assert.equal(R.read(long).scan.hosts[1].names[0].name.length, 120);
});

test('a trace keeps its hops in order, a hop that did not answer as a missing ttl', () => {
  const xml = fixture('lan-arp.xml').replace('<address addr="52:54:00:12:34:56" addrtype="mac" vendor="QEMU virtual NIC"/>\n<hostnames>\n</hostnames>',
    '<address addr="52:54:00:12:34:56" addrtype="mac" vendor="QEMU virtual NIC"/>\n<hostnames>\n</hostnames>\n<trace port="22" proto="tcp">\n<hop ttl="3" ipaddr="10.0.1.5" rtt="1.10"/>\n<hop ttl="1" ipaddr="10.0.1.1" rtt="0.40" host="gw.lab"/>\n</trace>');
  const srv = R.read(xml).scan.hosts[1];
  assert.deepEqual(srv.trace, [{ ttl: 1, address: '10.0.1.1', name: 'gw.lab' }, { ttl: 3, address: '10.0.1.5', name: null }]);
});

test('a script\'s tables nested twenty thousand deep are read, not a stack overflow', () => {
  const deep = 20000;
  const xml = fixture('lan-arp.xml').replace('<hostnames>\n<hostname name="gw.lab" type="PTR"/>', '<hostnames>\n<hostname name="gw.lab" type="PTR"/>\n</hostnames>\n<hostscript><script id="deep" output="x">' + '<table key="t">'.repeat(deep) + '<elem key="leaf">end</elem>' + '</table>'.repeat(deep) + '</script></hostscript>\n<hostnames>');
  const r = R.read(xml);
  assert.equal(r.problem, undefined);
  const gw = r.scan.hosts[0];
  let t = gw.scripts.filter(s => s.id === 'deep')[0].data, depth = 0;
  while (t.tables.length) {
    t = t.tables[0];
    depth++;
  }
  assert.equal(depth, deep);
  assert.deepEqual(t.elems, { leaf: 'end' });
  // A table's tables keep their order.
  const two = R.read(fixture('lan-arp.xml').replace('<hostnames>\n<hostname name="gw.lab" type="PTR"/>', '<hostnames>\n<hostname name="gw.lab" type="PTR"/>\n</hostnames>\n<hostscript><script id="two" output="x"><table key="a"><table key="a1"/><table key="a2"/></table><table key="b"/></script></hostscript>\n<hostnames>'));
  const data = two.scan.hosts[0].scripts.filter(s => s.id === 'two')[0].data;
  assert.deepEqual(data.tables.map(x => x.key), ['a', 'b']);
  assert.deepEqual(data.tables[0].tables.map(x => x.key), ['a1', 'a2']);
});

test('an address that is none and a port without a number or protocol are skipped, and said', () => {
  const S = require('../assets/js/scanners.js');
  const head = '<?xml version="1.0"?><nmaprun scanner="nmap" args="nmap -sV -oX - 10.0.0.0/24" start="1790000000"><scaninfo type="connect" protocol="tcp" services="1-1000"/>';
  const host = (address, ports) => '<host><status state="up"/>' + address + '<ports>' + ports + '</ports></host>';
  const port = attrs => '<port ' + attrs + '><state state="open"/><service name="ssh"/></port>';
  const xml = head
    + host('<address addrtype="ipv4"/>', port('protocol="tcp" portid="22"'))
    + host('<address addr="zzz" addrtype="ipv4"/>', port('protocol="tcp" portid="22"'))
    + host('<address addr="10.0.0.7" addrtype="ipv4"/><address addr="10.0.0.300" addrtype="ipv4"/>', port('protocol="tcp"') + port('portid="22"') + port('protocol="tcp" portid="70000"') + port('protocol="tcp" portid="x22"') + port('protocol="tcp" portid="443"'))
    + '<runstats><finished exit="success"/></runstats></nmaprun>';
  const { scan } = R.read(xml);
  assert.deepEqual(scan.hosts.map(h => h.addresses), [['10.0.0.7']]);
  assert.deepEqual(scan.hosts[0].ports.map(p => p.protocol + '/' + p.port), ['tcp/443']);
  assert.deepEqual(scan.skipped, { addresses: 3, ports: 4 });
  assert.deepEqual(S.notes('nmap', scan), ['3 addresses that are no IP address and 4 ports without a number or protocol were skipped.']);
  assert.deepEqual(R.readNotes({ skipped: { addresses: 1, ports: 0 } }), ['1 address that is no IP address was skipped.']);
  assert.deepEqual(R.readNotes({ skipped: { addresses: 0, ports: 1 } }), ['1 port without a number or protocol was skipped.']);
  assert.deepEqual(R.readNotes(R.read(fixture('lan-arp.xml')).scan), []);
  // Only what is left is imported.
  const N = require('../assets/js/nmap.js');
  const E = require('../assets/js/architecture-edit.js');
  const catalog = JSON.parse(fs.readFileSync('scripts/fixtures/catalog.json', 'utf8'));
  const specOf = kind => catalog.entities.filter(e => e.kind === kind)[0];
  const doc = N.addNmap(E.empty(), null, 'nmap', specOf).doc;
  const p = N.plan(doc, 'nmap', scan, '', {});
  const out = N.apply(doc, p, N.defaults(p), specOf, N.stampFor(scan, '', scan.date)).doc;
  assert.deepEqual(Object.values(out.entities).filter(e => e.kind === 'host').map(e => e.addresses), [['10.0.0.7']]);
  assert.deepEqual(Object.values(out.entities).filter(e => e.kind === 'service').map(e => e.label), ['ssh']);
  // A result with no host left says why.
  assert.deepEqual(R.read(head + host('<address addr="zzz" addrtype="ipv4"/>', '') + '<runstats><finished exit="success"/></runstats></nmaprun>').problem, { code: 'no-address', message: 'No host here has an IP address that can be read.' });
});

test('a reader that fails says why, never nothing', () => {
  const S = require('../assets/js/scanners.js');
  const nmap = S.TOOLS.filter(t => t.id === 'nmap')[0];
  const was = nmap.read, error = console.error;
  nmap.read = () => { throw new RangeError('Maximum call stack size exceeded'); };
  console.error = () => {};
  try {
    const r = S.read('nmap', '<nmaprun/>');
    assert.equal(r.problem.code, 'unreadable');
    assert.equal(r.problem.message, 'This result could not be read: Maximum call stack size exceeded.');
  } finally {
    nmap.read = was;
    console.error = error;
  }
});

test('private space: RFC 1918, shared, link-local, loopback, ULA', () => {
  for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1', '169.254.1.1', '127.0.0.1', 'fd00::1', 'fe80::1', '::1']) assert.equal(Ad.isPrivate(ip), true, ip);
  for (const ip of ['172.32.0.1', '8.8.8.8', '100.128.0.1', '2001:db8::1', 'srv.lab']) assert.equal(Ad.isPrivate(ip), false, ip);
});
