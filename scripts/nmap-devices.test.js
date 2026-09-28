const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../assets/js/nmap-devices.js');

// Scan workflow spec §6.1, §6.2. The shapes are those nmap's scripts
// write (broadcast-dhcp-discover.nse, snmp-interfaces.nse of nmap 7.92).
const answer = elems => ({ key: 'Response 1 of 1:', elems, items: [], tables: [] });
const dhcp = tables => ({ id: 'broadcast-dhcp-discover', output: '', data: { key: null, elems: {}, items: [], tables } });

test('the router a DHCP answer names, each once', () => {
  assert.deepEqual(D.gateways([dhcp([answer({ 'IP Offered': '192.168.1.114', Router: '192.168.1.1', 'Domain Name Server': '192.168.1.2' })])]), ['192.168.1.1']);
  // Several routers are a table of their own (dhcp.lua's read_ip, nmap 7.92).
  const several = Object.assign(answer({}), { tables: [{ key: 'Router', elems: {}, items: ['10.0.1.1', '10.0.1.2'], tables: [] }] });
  assert.deepEqual(D.gateways([dhcp([several, answer({ Router: '10.0.1.1' }), answer({ 'IP Offered': '10.0.1.9' })])]), ['10.0.1.1', '10.0.1.2']);
  assert.deepEqual(D.gateways([{ id: 'broadcast-ping', output: '', data: { tables: [answer({ Router: '10.0.1.1' })] } }]), [], 'another script\'s word is not read');
  for (const bad of ['gw.lab', '10.0.1', '10.0.1.1;id', '<b>10.0.1.1</b>', '']) assert.deepEqual(D.gateways([dhcp([answer({ Router: bad })])]), [], bad);
  assert.deepEqual(D.gateways([dhcp([])]), []);
  assert.deepEqual(D.gateways([{ id: 'broadcast-dhcp-discover' }, null]), []);
  assert.deepEqual(D.gateways(null), []);
});

test('a netmask is a run of ones, then zeros', () => {
  assert.equal(D.prefixOf('255.255.255.0'), 24);
  assert.equal(D.prefixOf('255.255.240.0'), 20);
  assert.equal(D.prefixOf('255.255.255.255'), 32);
  assert.equal(D.prefixOf('0.0.0.0'), 0);
  for (const bad of ['255.0.255.0', '255.255.255.1', '24', '', null, 'ffff:ffff::', '255.255.255']) assert.equal(D.prefixOf(bad), null, String(bad));
});

const SNMP = [
  '',
  '  lo',
  '    IP address: 127.0.0.1  Netmask: 255.0.0.0',
  '    Type: softwareLoopback  Speed: 10 Mbps',
  '    Status: up',
  '  eth0',
  '    IP address: 10.0.1.1  Netmask: 255.255.255.0',
  '    MAC address: 00:0c:29:01:e2:74 (VMware)',
  '    Type: ethernetCsmacd  Speed: 1 Gbps',
  '    Status: up',
  '    Traffic stats: 6.45 Mb sent, 15.01 Mb received',
  '  eth1',
  '    IP address: 10.0.2.1  Netmask: 255.255.255.0',
  '    Status: up',
  '  eth2',
  '    IP address: 10.0.9.1  Netmask: 255.255.255.0',
  '    Status: down',
  '  eth3',
  '    MAC address: 00:0c:29:01:e2:77 (VMware)',
  '    Status: up',
  '  tun0',
  '    IP address: 172.16.0.1  Netmask: 255.255.255.252',
  '    Status: up',
].join('\n');

test('the interfaces that are up and have an address of their own', () => {
  assert.deepEqual(D.interfaces(SNMP), [
    { name: 'eth0', address: '10.0.1.1', cidr: '10.0.1.0/24' },
    { name: 'eth1', address: '10.0.2.1', cidr: '10.0.2.0/24' },
    { name: 'tun0', address: '172.16.0.1', cidr: '172.16.0.0/30' },
  ]);
  // Without a status line an interface counts as up: older devices say none.
  assert.deepEqual(D.interfaces('  eth0\n    IP address: 10.0.1.1  Netmask: 255.255.255.0'), [{ name: 'eth0', address: '10.0.1.1', cidr: '10.0.1.0/24' }]);
});

test('what is no interface of a network is left out, whatever the device says', () => {
  const one = (address, netmask) => D.interfaces('  x\n    IP address: ' + address + '  Netmask: ' + netmask + '\n    Status: up');
  assert.deepEqual(one('169.254.3.4', '255.255.0.0'), [], 'link-local');
  assert.deepEqual(one('::1', '255.0.0.0'), [], 'IPv6 loopback: a netmask is IPv4\'s');
  assert.deepEqual(one('fe80::1', '255.255.255.0'), [], 'IPv6 link-local');
  assert.deepEqual(one('0.0.0.0', '255.0.0.0'), [], 'this network, no address');
  assert.deepEqual(one('224.0.0.1', '255.255.255.0'), [], 'multicast');
  assert.deepEqual(one('10.0.1.1', '255.255.255.255'), [], 'a /32 holds no host beside it');
  assert.deepEqual(one('10.0.1.1', '255.255.255.254'), [], 'a /31');
  assert.deepEqual(one('10.0.1.1', '0.0.0.0'), [], 'no network at all');
  assert.deepEqual(one('10.0.1.1', '255.0.255.0'), [], 'no netmask');
  assert.deepEqual(one('10.0.1.300', '255.255.255.0'), []);
  assert.deepEqual(one('gw.lab', '255.255.255.0'), []);
  assert.deepEqual(one('10.0.1.1;id', '255.255.255.0'), []);
  assert.deepEqual(D.interfaces('  a\n    IP address: 10.0.1.1  Netmask: 255.255.255.0\n  b\n    IP address: 10.0.1.1  Netmask: 255.255.255.0'), [{ name: 'a', address: '10.0.1.1', cidr: '10.0.1.0/24' }], 'an address once');
  assert.deepEqual(D.interfaces('    IP address: 10.0.1.1  Netmask: 255.255.255.0'), [], 'an address without its interface');
  assert.equal(D.interfaces('  ' + 'e'.repeat(500) + '\u0007\n    IP address: 10.0.1.1  Netmask: 255.255.255.0')[0].name, 'e'.repeat(60));
  for (const nothing of ['', null, undefined, '\n\n', 'ERROR: No response', 42]) assert.deepEqual(D.interfaces(nothing), [], String(nothing));
});

// ---- what an import draws of them ----

const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const E = require('../assets/js/architecture-edit.js');
const catalog = JSON.parse(fs.readFileSync('scripts/fixtures/catalog.json', 'utf8'));
const specOf = kind => catalog.entities.filter(e => e.kind === kind)[0];
const read = name => N.read(fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8')).scan;
const STAMP = scan => N.stampFor(scan, '', scan.date);

// An office network with the scanner on a workstation, and a server
// network nobody scanned yet.
function office() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Office LAN', addresses: ['10.0.1.0/24'] },
    srv: { kind: 'network', label: 'Server LAN', addresses: ['10.0.2.0/24'] },
    pc: { kind: 'host', label: 'pc', addresses: ['10.0.1.5'] },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'pc', to: 'lan' },
    a2: { kind: 'hosts', from: 'pc', to: 'nmap', privilege: 'user' },
  };
  return d;
}
const rowAt = (p, a) => p.hosts.filter(h => h.addresses.includes(a))[0];
const at = (doc, a) => Object.keys(doc.entities).filter(id => (doc.entities[id].addresses || []).includes(a))[0];
const linksOf = (doc, kind, from) => Object.values(doc.associations).filter(x => x.kind === kind && x.from === from).map(x => x.to);

test('a device with interfaces on several networks is offered as a router, on each of them', () => {
  const d = office();
  const scan = read('snmp.xml');
  assert.deepEqual(scan.asks, [], 'one UDP port asks no host which ports are open');
  const p = N.plan(d, 'nmap', scan, '', {});
  const gw = rowAt(p, '10.0.1.1');
  assert.deepEqual(gw.interfaces, [
    { name: 'eth0', address: '10.0.1.1', cidr: '10.0.1.0/24' },
    { name: 'eth1', address: '10.0.2.1', cidr: '10.0.2.0/24' },
    { name: 'eth2', address: '10.0.9.1', cidr: '10.0.9.0/24' },
  ]);
  assert.deepEqual(gw.gains, ['10.0.2.1', '10.0.9.1']);
  assert.deepEqual(gw.networks, ['lan', 'srv', 'new:10.0.9.0/24']);
  assert.equal(gw.role, 'router');
  assert.equal(gw.device, '3 interfaces by SNMP');
  // A printer lists its one interface: a host, as before.
  const printer = rowAt(p, '10.0.1.20');
  assert.equal(printer.role, 'host');
  assert.deepEqual(printer.gains, []);
  assert.deepEqual(printer.networks, ['lan']);
  assert.deepEqual(rowAt(p, '10.0.1.30').interfaces, []);
  assert.ok(p.hosts.every(h => h.unread.length === 0 && h.ports.every(r => r.unread.length === 0)), 'what is read is not said unread');

  const s = N.summary(d, p, N.defaults(p), null);
  assert.deepEqual([s.hosts, s.networks, s.routers, s.services], [3, 1, 1, 2]);
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP(scan)).doc;
  const box = at(out, '10.0.1.1');
  assert.deepEqual(out.entities[box].addresses, ['10.0.1.1', '10.0.2.1', '10.0.9.1']);
  const made = Object.keys(out.entities).filter(id => out.entities[id].kind === 'network' && !d.entities[id]);
  assert.deepEqual(made.map(id => [out.entities[id].label, out.entities[id].addresses]), [['10.0.9.0/24', ['10.0.9.0/24']]]);
  assert.deepEqual(linksOf(out, 'attached', box).sort(), ['lan', 'srv', made[0]].sort());
  const router = linksOf(out, 'hosts', box).filter(id => out.entities[id].kind === 'router')[0];
  assert.ok(router, 'the router on its box');
  assert.deepEqual(linksOf(out, 'attached', router).sort(), ['lan', 'srv', made[0]].sort(), 'on every network the box is on');
  assert.equal(Object.keys(out.entities).length, s.entities);
  assert.equal(Object.keys(out.associations).length + Object.keys(out.flows).length, s.relationships);

  // Again: the addresses, the network and the router are there.
  const again = N.plan(out, 'nmap', scan, '', {});
  assert.deepEqual(rowAt(again, '10.0.1.1').gains, []);
  assert.deepEqual(rowAt(again, '10.0.1.1').networks, []);
  assert.equal(rowAt(again, '10.0.1.1').roleOffered, false);
  assert.equal(N.apply(out, again, N.defaults(again), specOf, STAMP(scan)), null);

  const file = 'scripts/fixtures/nmap/imported-snmp.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test('an interface at another machine\'s address is not this device\'s', () => {
  const d = office();
  d.entities.db = { kind: 'host', label: 'db', addresses: ['10.0.2.1'] };
  const p = N.plan(d, 'nmap', read('snmp.xml'), '', {});
  const gw = rowAt(p, '10.0.1.1');
  assert.deepEqual(gw.interfaces.map(i => i.address), ['10.0.1.1', '10.0.9.1'], 'drawn on “db”');
  assert.deepEqual(gw.networks, ['lan', 'new:10.0.9.0/24']);
  // Nor one that another scanned host answers at.
  const scan = read('snmp.xml');
  scan.hosts[1].addresses = ['10.0.9.1'];
  const q = N.plan(office(), 'nmap', scan, '', {});
  assert.deepEqual(rowAt(q, '10.0.1.1').interfaces.map(i => i.address), ['10.0.1.1', '10.0.2.1']);
});

test('a drawn host gains the addresses of its interfaces; unticked, nothing of it', () => {
  const d = office();
  d.entities.gw = { kind: 'host', label: 'gateway', addresses: ['10.0.1.1'] };
  d.associations.a3 = { kind: 'attached', from: 'gw', to: 'lan' };
  const scan = read('snmp.xml');
  const p = N.plan(d, 'nmap', scan, '', {});
  assert.equal(rowAt(p, '10.0.1.1').known, 'gw');
  assert.deepEqual(rowAt(p, '10.0.1.1').networks, ['srv', 'new:10.0.9.0/24']);
  assert.equal(N.summary(d, p, N.defaults(p), null).filled, 1);
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP(scan)).doc;
  assert.deepEqual(out.entities.gw.addresses, ['10.0.1.1', '10.0.2.1', '10.0.9.1']);
  const t = N.defaults(p);
  N.tickHost(rowAt(p, '10.0.1.1'), t, false);
  const without = N.apply(d, p, t, specOf, STAMP(scan)).doc;
  assert.deepEqual(without.entities.gw.addresses, ['10.0.1.1']);
  assert.equal(Object.values(without.entities).filter(e => e.kind === 'network').length, 2, 'no network of an unticked host\'s interface');
});

test('two devices on one undrawn network make it once', () => {
  const scan = read('snmp.xml');
  const other = scan.hosts[1].ports[0].scripts[0];
  other.output = '\n  en0\n    IP address: 10.0.1.20  Netmask: 255.255.255.0\n    Status: up\n  en1\n    IP address: 10.0.9.20  Netmask: 255.255.255.0\n    Status: up\n';
  const d = office();
  const p = N.plan(d, 'nmap', scan, '', {});
  assert.equal(N.summary(d, p, N.defaults(p), null).networks, 1);
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP(scan)).doc;
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'network' && e.label === '10.0.9.0/24').length, 1);
});

test('the router a DHCP answer names is offered as one', () => {
  const d = office();
  const scan = read('announced.xml');
  assert.deepEqual(D.gateways(scan.pre), ['10.0.1.1']);
  assert.deepEqual(scan.asks, []);
  const p = N.plan(d, 'nmap', scan, '', {});
  assert.equal(rowAt(p, '10.0.1.1').role, 'router');
  assert.equal(rowAt(p, '10.0.1.1').device, 'gateway by DHCP');
  assert.equal(rowAt(p, '10.0.1.40').role, 'host', 'what announced itself is a host as any');
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP(scan)).doc;
  assert.ok(linksOf(out, 'hosts', at(out, '10.0.1.1')).some(id => out.entities[id].kind === 'router'));
  assert.equal(out.entities.nmap.description, 'Last nmap import: 2026-09-28, scan of 10.0.1.0/24 · who announces itself.');
  // What nmap calls the device stands before what DHCP says.
  scan.hosts[0].device = ['firewall'];
  assert.equal(rowAt(N.plan(d, 'nmap', scan, '', {}), '10.0.1.1').role, 'firewall');
  // An answer that names nobody scanned names nobody.
  scan.pre[0].data.tables[0].elems.Router = '10.0.1.254';
  scan.hosts[0].device = [];
  assert.equal(rowAt(N.plan(d, 'nmap', scan, '', {}), '10.0.1.1').role, 'host');
});

test('a router with a management port open to the scanner is offered as administered from its network', () => {
  const d = office();
  const scan = read('snmp.xml');
  const p = N.plan(d, 'nmap', scan, '', {});
  assert.deepEqual(p.connections.list.map(c => [c.kind, c.line, c.what, c.ticked, c.can]), [
    ['administration', 'udp/161 on gw.lab is open to the scanner', '“gw.lab” is administered from “Office LAN”', false, true],
  ], 'the printer is no router');
  const t = N.defaults(p);
  assert.equal(Object.values(N.apply(d, p, t, specOf, STAMP(scan)).doc.associations).filter(a => a.kind === 'administration').length, 0, 'offered, not ticked');
  t.connections[p.connections.list[0].key] = true;
  const out = N.apply(d, p, t, specOf, STAMP(scan)).doc;
  const router = linksOf(out, 'hosts', at(out, '10.0.1.1')).filter(id => out.entities[id].kind === 'router')[0];
  assert.deepEqual(Object.values(out.associations).filter(a => a.kind === 'administration').map(a => [a.from, a.to]), [['lan', router]]);
  assert.deepEqual(N.plan(out, 'nmap', scan, '', {}).connections.list, [], 'drawn: not offered again');
  // Without a place for the scanner it cannot be said where from.
  const loose = office();
  delete loose.associations.a2;
  const q = N.plan(loose, 'nmap', scan, '', {});
  assert.deepEqual(q.connections.list.map(c => [c.can, c.why]), [[false, 'Put nmap on a host to say where from']]);
});

test('a route to a device on networks not drawn yet ends on the networks the import makes', () => {
  const iface = (name, a) => '&#xa;  ' + name + '&#xa;    IP address: ' + a + '  Netmask: 255.255.255.0&#xa;    Status: up';
  const xml = '<?xml version="1.0"?><nmaprun scanner="nmap" args="nmap -sU -p U:161 --script snmp-interfaces --traceroute -oX - 172.16.5.1" start="1790553600" version="7.92">' +
    '<scaninfo type="udp" protocol="udp" numservices="1" services="161"/>' +
    '<host><status state="up" reason="udp-response"/><address addr="172.16.5.1" addrtype="ipv4"/><hostnames/>' +
    '<ports><port protocol="udp" portid="161"><state state="open" reason="udp-response"/><service name="snmp"/>' +
    '<script id="snmp-interfaces" output="' + iface('eth0', '172.16.5.1') + iface('eth1', '172.16.6.1') + '&#xa;"/></port></ports>' +
    '<trace port="161" proto="udp"><hop ttl="1" ipaddr="10.0.1.254" rtt="1.00"/><hop ttl="2" ipaddr="172.16.5.1" rtt="2.00"/></trace></host>' +
    '<runstats><finished time="1790553660" exit="success"/><hosts up="1" down="0" total="1"/></runstats></nmaprun>';
  const d = office();
  const scan = N.read(xml).scan;
  const p = N.plan(d, 'nmap', scan, '', {});
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP(scan)).doc;
  for (const [id, a] of Object.entries(out.associations)) {
    assert.ok(out.entities[a.from] && out.entities[a.to], id + ': ' + a.from + ' → ' + a.to);
  }
  const made = Object.keys(out.entities).filter(id => out.entities[id].kind === 'network' && !d.entities[id]);
  assert.deepEqual(made.map(id => out.entities[id].label).sort(), ['172.16.5.0/24', '172.16.6.0/24']);
});
