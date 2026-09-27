const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const E = require('../assets/js/architecture-edit.js');
const fixture = name => fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8');
const catalog = JSON.parse(fs.readFileSync('scripts/fixtures/catalog.json', 'utf8'));
const specOf = kind => catalog.entities.filter(e => e.kind === kind)[0];
const clone = x => JSON.parse(JSON.stringify(x));

// An empty drawing with nmap on no host.
function empty() {
  return N.addNmap(E.empty(), null, 'nmap', specOf).doc;
}
function imported(doc, name, change) {
  const scan = N.read(fixture(name)).scan;
  const p = N.plan(doc, 'nmap', scan, '', {});
  const t = N.defaults(p);
  if (change) change(p, t);
  return N.apply(doc, p, t, specOf, N.stampFor(scan, '', scan.date)).doc;
}
const afterDay1 = () => imported(empty(), 'day1.xml');
const day10 = () => N.read(fixture('day10.xml')).scan;
const hostBy = (doc, addr) => Object.keys(doc.entities).filter(id => (doc.entities[id].addresses || []).includes(addr))[0];
const rowAt = (p, addr) => p.hosts.filter(h => h.addresses.includes(addr))[0];

test('a first import keeps each host\'s MAC, SSH key, vendor and the day it was seen', () => {
  const doc = afterDay1();
  const db = doc.entities[hostBy(doc, '10.0.2.5')];
  assert.deepEqual(db.identities, ['mac:52:54:00:00:00:05', 'ssh-ed25519:aaaa0005']);
  assert.equal(db.vendor, 'QEMU virtual NIC');
  assert.equal(db.seen, '2026-09-17');
  assert.equal(db.label, 'db1.lab');
  assert.equal(doc.entities[hostBy(doc, '10.0.2.6')].label, '10.0.2.6');
});

test('the MAC is the identity: a host at a new address is that host, its address updated', () => {
  const doc = afterDay1();
  const web = hostBy(doc, '10.0.2.6');
  const p = N.plan(doc, 'nmap', day10(), '', {});
  const row = rowAt(p, '10.0.2.16');
  assert.equal(row.known, web);
  assert.equal(row.matchedBy, 'identity');
  assert.deepEqual(row.moved, { from: ['10.0.2.6'], to: ['10.0.2.16'], others: [] });
  assert.deepEqual(row.ports.map(r => !!r.known), [true], 'its drawn service is known at the new address');
  const next = imported(doc, 'day10.xml');
  assert.deepEqual(next.entities[web].addresses, ['10.0.2.16']);
  assert.equal(next.entities[web].seen, '2026-09-27');
  assert.equal(Object.keys(next.entities).filter(id => next.entities[id].kind === 'host').length, 4, 'no host drawn twice');
  // Unticked, the address stays as drawn.
  const kept = imported(doc, 'day10.xml', (pl, t) => { t.moves[rowAt(pl, '10.0.2.16').key] = false; });
  assert.deepEqual(kept.entities[web].addresses, ['10.0.2.6']);
});

test('an address the scan did not look at is not one the host left', () => {
  const doc = afterDay1();
  const web = hostBy(doc, '10.0.2.6');
  doc.entities[web].addresses = ['10.0.2.6', '10.0.9.6'];
  const p = N.plan(doc, 'nmap', day10(), '', {});
  assert.deepEqual(rowAt(p, '10.0.2.16').moved.from, ['10.0.2.6']);
});

test('identity beats address: the drawn host holding the new address may give it up, unticked', () => {
  const doc = afterDay1();
  const web = hostBy(doc, '10.0.2.6'), other = hostBy(doc, '10.0.2.8');
  doc.entities[other].addresses = ['10.0.2.8', '10.0.2.16'];
  const p = N.plan(doc, 'nmap', day10(), '', {});
  const row = rowAt(p, '10.0.2.16');
  assert.equal(row.known, web);
  assert.deepEqual(row.moved.others, [other]);
  assert.equal(N.defaults(p).strips[row.key], false);
  const kept = imported(doc, 'day10.xml');
  assert.deepEqual(kept.entities[other].addresses, ['10.0.2.8', '10.0.2.16']);
  const stripped = imported(doc, 'day10.xml', (pl, t) => { t.strips[rowAt(pl, '10.0.2.16').key] = true; });
  assert.deepEqual(stripped.entities[other].addresses, ['10.0.2.8']);
});

test('a host labelled by its address is offered its better name; a name the author gave is not', () => {
  const doc = afterDay1();
  const web = hostBy(doc, '10.0.2.6');
  let p = N.plan(doc, 'nmap', day10(), '', {});
  assert.deepEqual(rowAt(p, '10.0.2.16').rename, { to: 'WEB1', from: 'NetBIOS' });
  assert.equal(imported(doc, 'day10.xml').entities[web].label, 'WEB1');
  assert.equal(imported(doc, 'day10.xml', (pl, t) => { t.renames[rowAt(pl, '10.0.2.16').key] = false; }).entities[web].label, '10.0.2.6');
  const named = clone(doc);
  named.entities[web].label = 'the web box';
  p = N.plan(named, 'nmap', day10(), '', {});
  assert.equal(rowAt(p, '10.0.2.16').rename, null);
  assert.equal(rowAt(p, '10.0.2.5').rename, null, 'db1.lab is a name already');
});

test('same address, another MAC and key: left out until the author says which it is', () => {
  const doc = afterDay1();
  const old = hostBy(doc, '10.0.2.7');
  let p = N.plan(doc, 'nmap', day10(), '', {});
  let row = rowAt(p, '10.0.2.7');
  assert.equal(row.known, null);
  assert.deepEqual(row.conflict, { host: old, type: 'mac', was: 'mac:52:54:00:00:00:07', now: 'mac:52:54:00:00:00:77', choice: 'new' });
  assert.equal(N.defaults(p).hosts[row.key], false);
  const untouched = imported(doc, 'day10.xml');
  assert.deepEqual(untouched.entities[old], doc.entities[old], 'unticked: nothing of it changes');

  // Another machine: a new host, and the address leaves the old one.
  const apart = imported(doc, 'day10.xml', (pl, t) => { t.hosts[rowAt(pl, '10.0.2.7').key] = true; });
  assert.equal(apart.entities[old].addresses, undefined);
  assert.deepEqual(apart.entities[old].identities, doc.entities[old].identities);
  const fresh = hostBy(apart, '10.0.2.7');
  assert.notEqual(fresh, old);
  assert.deepEqual(apart.entities[fresh].identities, ['mac:52:54:00:00:00:77', 'ssh-ed25519:bbbb0007']);

  // The same machine: its identities of those kinds are the new ones.
  const scan = day10();
  p = N.plan(doc, 'nmap', scan, '', { conflicts: { [row.key]: 'same' } });
  row = rowAt(p, '10.0.2.7');
  assert.equal(row.known, old);
  assert.equal(row.conflict.choice, 'same');
  const same = N.apply(doc, p, N.defaults(p), specOf, N.stampFor(scan, '', scan.date)).doc;
  assert.deepEqual(same.entities[old].identities, ['mac:52:54:00:00:00:77', 'ssh-ed25519:bbbb0007']);
  assert.deepEqual(same.entities[old].addresses, ['10.0.2.7']);
  assert.equal(Object.keys(same.entities).filter(id => same.entities[id].kind === 'host').length, 4);
});

test('a new network card is not another machine while the SSH key is the same', () => {
  const doc = afterDay1();
  const db = hostBy(doc, '10.0.2.5');
  const scan = day10();
  scan.hosts[0].identities = ['mac:52:54:00:00:00:55', 'ssh-ed25519:aaaa0005'];
  const p = N.plan(doc, 'nmap', scan, '', {});
  assert.equal(p.hosts[0].known, db);
  assert.equal(p.hosts[0].conflict, null);
  assert.deepEqual(p.hosts[0].newIdentities, ['mac:52:54:00:00:00:55']);
});

test('two drawn hosts sharing a MAC: said, and the address decides', () => {
  const doc = afterDay1();
  const db = hostBy(doc, '10.0.2.5'), twin = hostBy(doc, '10.0.2.8');
  doc.entities[twin].identities = ['mac:52:54:00:00:00:05'];
  doc.entities[db].identities = ['mac:52:54:00:00:00:05'];
  const p = N.plan(doc, 'nmap', day10(), '', {});
  const row = rowAt(p, '10.0.2.5');
  assert.equal(row.sharedIdentity, 'mac:52:54:00:00:00:05');
  assert.equal(row.known, db);
  assert.equal(row.matchedBy, 'address');
});

test('IPv6: a MAC at a new address is a move by what the address is, and IPv4 addresses stay', () => {
  const doc = afterDay1();
  const db = hostBy(doc, '10.0.2.5');
  doc.entities[db].addresses = ['10.0.2.5', 'fd00:0::5'];
  const scan = { args: 'nmap -6 -sS -oX - fd00::/120', date: '2026-09-27', probed: {}, types: ['syn'], silentUdp: 0,
    hosts: [{ addresses: ['fd00::9'], identities: ['mac:52:54:00:00:00:05'], vendor: null, names: [], hostnames: [], hostname: null, os: null, device: [], self: false, ports: [], scripts: [], trace: [], extraports: [] }] };
  const p = N.plan(doc, 'nmap', scan, '', {});
  assert.deepEqual(p.hosts[0].moved, { from: ['fd00:0::5'], to: ['fd00::9'], others: [] });
  const next = N.apply(doc, p, N.defaults(p), specOf, N.stampFor(scan, '', scan.date)).doc;
  assert.deepEqual(next.entities[db].addresses, ['10.0.2.5', 'fd00::9']);
  // The same address in another spelling is no move.
  scan.hosts[0].addresses = ['fd00::5'];
  assert.equal(N.plan(doc, 'nmap', scan, '', {}).hosts[0].moved, null);
});

test('a drawn host without addresses that has the scanned name is guessed to be it', () => {
  const doc = empty();
  doc.entities.db = { kind: 'host', label: 'db1' };
  doc.entities.other = { kind: 'host', label: 'mail' };
  const scan = N.read(fixture('day1.xml')).scan;
  let p = N.plan(doc, 'nmap', scan, '', {});
  const row = rowAt(p, '10.0.2.5');
  assert.equal(row.merged, 'db');
  assert.equal(row.guessed, true);
  assert.equal(row.guessedBy, 'name');
  assert.equal(rowAt(p, '10.0.2.7').merged, null);
  // A chosen "new" stands: no guess returns.
  p = N.plan(doc, 'nmap', scan, '', { [row.key]: '' });
  assert.equal(rowAt(p, '10.0.2.5').merged, null);
});

test('the same scan applied twice adds nothing twice', () => {
  const once = afterDay1();
  const scan = N.read(fixture('day1.xml')).scan;
  const p = N.plan(once, 'nmap', scan, '', {});
  assert.ok(p.hosts.every(h => h.known && !h.newIdentities.length && !h.moved && !h.rename && !h.conflict));
  assert.equal(N.apply(once, p, N.defaults(p), specOf, N.stampFor(scan, '', scan.date)), null);
  assert.equal(N.said(N.summary(once, p, N.defaults(p), null)), 'Nothing new to add.');
});

test('a rescan that finds nothing new still notes the day; without a date it is no edit', () => {
  const doc = afterDay1();
  const scan = N.read(fixture('day1.xml')).scan;
  scan.date = '2026-09-20';
  let p = N.plan(doc, 'nmap', scan, '', {});
  assert.equal(N.said(N.summary(doc, p, N.defaults(p), null)), 'Notes 4 hosts as seen.');
  const next = N.apply(doc, p, N.defaults(p), specOf, N.stampFor(scan, '', scan.date)).doc;
  assert.equal(next.entities[hostBy(doc, '10.0.2.5')].seen, '2026-09-20');
  const t = N.defaults(p);
  t.seen = false;
  assert.equal(N.apply(doc, p, t, specOf, N.stampFor(scan, '', scan.date)), null);
  scan.date = null;
  p = N.plan(doc, 'nmap', scan, '', {});
  assert.equal(N.apply(doc, p, N.defaults(p), specOf, N.stampFor(scan, '', '2026-09-27')), null);
});

test('what a scan covered: addresses, CIDR, octet ranges; never a name', () => {
  const covers = N.covers;
  assert.equal(covers('10.0.2.0/24', '10.0.2.6'), true);
  assert.equal(covers('10.0.2.0/24', '10.0.9.6'), false);
  assert.equal(covers('10.0.1-5.1-254', '10.0.3.200'), true);
  assert.equal(covers('10.0.1-5.1-254', '10.0.3.255'), false);
  assert.equal(covers('10.0.2.1,5,9', '10.0.2.5'), true);
  assert.equal(covers('srv.lab 10.0.2.7', '10.0.2.7'), true);
  assert.equal(covers('srv.lab', '10.0.2.7'), false);
  assert.equal(covers('fd00::/120', 'fd00:0::5'), true);
  assert.equal(covers('fe80::1%eth0', 'fe80::1'), true);
  assert.equal(covers('', '10.0.2.7'), false);
});
