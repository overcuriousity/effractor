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
  t.asked = false;
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

test('all hosts at once leaves out another machine on a drawn host\'s address', () => {
  const doc = afterDay1();
  const p = N.plan(doc, 'nmap', day10(), '', {});
  const t = N.tickHosts(p, N.defaults(p), true);
  assert.deepEqual(p.hosts.map(h => t.hosts[h.key]), [true, true, false]);
  assert.equal(N.identityWords(['mac:52:54:00:00:00:05', 'ssh-ed25519:aaaa0005', 'ecdsa-sha2-nistp256:ff'], 'QEMU virtual NIC'), 'MAC 52:54:00:00:00:05 (QEMU virtual NIC), SSH key ed25519, SSH key ecdsa-sha2-nistp256');
});

const named = (names, addresses) => ({
  tool: 'nuclei', args: '', date: '2026-09-28', silentUdp: 0, probed: {}, types: [], sharedMacs: 0,
  hosts: [{ addresses: addresses || [], hostname: names[0] || null, names: names.map(n => ({ name: n, from: 'certificate' })), identities: [], os: null, device: [], self: false, ports: [{ protocol: 'tcp', port: 443, state: 'open', reason: null, service: { name: 'https', product: null, version: null }, scripts: [], findings: [] }], scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [] }],
});
function drawing() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'LAN', addresses: ['10.0.1.0/24'] },
    box: { kind: 'host', label: 'Admin box' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
    web: { kind: 'host', label: 'Web 1', addresses: ['10.0.1.40'], names: ['grafana.corp.example'] },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a2: { kind: 'attached', from: 'web', to: 'lan' },
    a3: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
  };
  return d;
}

test('names a scan reads are kept on the host, each once, in lower case', () => {
  const d = drawing();
  const scan = named(['Grafana.corp.example', 'metrics.corp.example.', '*.corp.example', 'WEB 01'], ['10.0.1.40']);
  const p = N.plan(d, 'nuclei', scan, '10.0.1.0/24', {});
  const [h] = p.hosts;
  assert.equal(h.known, 'web');
  assert.deepEqual(h.names, ['grafana.corp.example', 'metrics.corp.example']);
  assert.deepEqual(h.newNames, ['metrics.corp.example']);
  assert.deepEqual(h.saidNames, ['*.corp.example', 'WEB 01']);
  const t = N.defaults(p);
  assert.equal(t.names[h.key], true);
  assert.equal(N.summary(d, p, t, null).named, 1);
  const out = N.apply(d, p, t, specOf, { line: 'Last nuclei import: 2026-09-28, scan.', pattern: /^Last nuclei import: .*$/m }).doc;
  assert.deepEqual(out.entities.web.names, ['grafana.corp.example', 'metrics.corp.example']);
  // Unticked, they are not kept.
  t.names[h.key] = false;
  const without = N.apply(d, p, t, specOf, { line: 'Last nuclei import: 2026-09-28, scan.', pattern: /^Last nuclei import: .*$/m }).doc;
  assert.deepEqual(without.entities.web.names, ['grafana.corp.example']);
  // Again: nothing to name.
  const again = N.plan(out, 'nuclei', scan, '10.0.1.0/24', {});
  assert.deepEqual(again.hosts[0].newNames, []);
  assert.equal(N.summary(out, again, N.defaults(again), null).named, 0);
});

test('a new host is drawn with its names', () => {
  const d = drawing();
  const scan = named(['wiki.corp.example'], ['10.0.1.41']);
  const p = N.plan(d, 'nuclei', scan, '10.0.1.0/24', {});
  const out = N.apply(d, p, N.defaults(p), specOf, { line: 'Last nuclei import: 2026-09-28, scan.', pattern: /^Last nuclei import: .*$/m }).doc;
  const id = Object.keys(out.entities).find(k => out.entities[k].label === 'wiki.corp.example');
  assert.deepEqual(out.entities[id].names, ['wiki.corp.example']);
  assert.equal(N.summary(d, p, N.defaults(p), null).named, 0, 'a new host is counted as a host');
});

test('a host known only by name is the drawn host that keeps the name', () => {
  const d = drawing();
  const p = N.plan(d, 'nuclei', named(['grafana.corp.example']), '', {});
  assert.deepEqual([p.hosts[0].merged, p.hosts[0].guessedBy, p.hosts[0].matchedBy], ['web', 'name', 'name']);
  // Kept on two hosts, it names neither.
  d.entities.other = { kind: 'host', label: 'Web 2', addresses: ['10.0.1.42'], names: ['grafana.corp.example'] };
  const q = N.plan(d, 'nuclei', named(['grafana.corp.example']), '', {});
  assert.equal(q.hosts[0].merged, null);
  // With an address of its own it is not matched by a name: names are shared.
  const r = N.plan(drawing(), 'nuclei', named(['grafana.corp.example'], ['10.0.1.99']), '10.0.1.0/24', {});
  assert.deepEqual([r.hosts[0].known, r.hosts[0].merged], [null, null]);
});

test('a wildcard labels nothing and renames nothing', () => {
  const scan = named(['*.corp.example', 'Wiki.corp.example'], ['10.0.1.41']);
  const p = N.plan(drawing(), 'nuclei', scan, '10.0.1.0/24', {});
  assert.deepEqual([p.hosts[0].label, p.hosts[0].names, p.hosts[0].saidNames], ['Wiki.corp.example', ['wiki.corp.example'], ['*.corp.example']]);
  const d = drawing();
  d.entities.web.label = '10.0.1.40';
  const q = N.plan(d, 'nuclei', named(['*.corp.example'], ['10.0.1.40']), '10.0.1.0/24', {});
  assert.equal(q.hosts[0].rename, null);
  const r = N.plan(d, 'nuclei', named(['*.corp.example', 'shop.corp.example'], ['10.0.1.40']), '10.0.1.0/24', {});
  assert.deepEqual(r.hosts[0].rename, { to: 'shop.corp.example', from: 'certificate' });
});

// From the review of the branch: a host matched by a name it keeps.
const both = (...hosts) => Object.assign(named([], []), { hosts: hosts.map(h => h.hosts[0]) });
const STAMPED = { line: 'Last nuclei import: 2026-09-28, scan.', pattern: /^Last nuclei import: .*$/m };

test('a host asked by its address and by its name is one row, its port drawn once', () => {
  const d = drawing();
  const scan = both(named([], ['10.0.1.40']), named(['grafana.corp.example']));
  const p = N.plan(d, 'nuclei', scan, '10.0.1.0/24', {});
  assert.deepEqual(p.hosts.map(h => [h.key, h.known, h.merged, h.ports.map(r => r.proto)]), [['h0', 'web', null, ['tcp/443']]]);
  const s = N.summary(d, p, N.defaults(p), null);
  assert.deepEqual([s.hosts, s.services, s.flows, s.filled], [0, 1, 1, 0]);
  const out = N.apply(d, p, N.defaults(p), specOf, STAMPED).doc;
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'service').length, 1);
  // The other way round: the name first.
  const q = N.plan(d, 'nuclei', both(named(['grafana.corp.example']), named([], ['10.0.1.40'])), '10.0.1.0/24', {});
  assert.deepEqual(q.hosts.map(h => [h.known || h.merged, h.ports.length]), [['web', 1]]);
});

test('two names of one drawn host are that host, not a second one', () => {
  const d = drawing();
  d.entities.web.names = ['grafana.corp.example', 'metrics.corp.example'];
  const p = N.plan(d, 'nuclei', both(named(['grafana.corp.example']), named(['metrics.corp.example'])), '', {});
  assert.deepEqual(p.hosts.map(h => [h.key, h.merged, h.matchedBy]), [['h0', 'web', 'name']]);
  const out = N.apply(d, p, N.defaults(p), specOf, STAMPED).doc;
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'host').length, 2, 'the admin box and the web host');
  assert.deepEqual(out.entities.web.names, ['grafana.corp.example', 'metrics.corp.example']);
});

test('a host known by its name gains no address, and nothing is said of addresses', () => {
  const d = drawing();
  const scan = named(['grafana.corp.example']);
  const p = N.plan(d, 'nuclei', scan, '', {});
  const s = N.summary(d, p, N.defaults(p), null);
  assert.equal(s.filled, 0);
  assert.equal(N.said(s), 'Adds 1 service, 1 product, 1 flow.');
  const out = N.apply(d, p, N.defaults(p), specOf, STAMPED).doc;
  assert.deepEqual(out.entities.web.addresses, ['10.0.1.40']);
  // A drawn host without addresses keeps none.
  const bare = drawing();
  delete bare.entities.web.addresses;
  const b = N.plan(bare, 'nuclei', scan, '', {});
  assert.equal(N.apply(bare, b, N.defaults(b), specOf, STAMPED).doc.entities.web.addresses, undefined);
  // Again: nothing new, and no edit.
  const again = N.plan(out, 'nuclei', scan, '', {});
  const t = N.defaults(again);
  t.seen = false;
  assert.equal(N.apply(out, again, t, specOf, STAMPED), null);
});

// ---- what a host was asked (scan workflow spec §3) ----

test('what a scan asked is read from what nmap says it ran', () => {
  const asks = N.asksOf;
  assert.deepEqual(asks('nmap -sT -sV -oX - 10.0.1.0/24', ['connect']), ['ports', 'products']);
  assert.deepEqual(asks('nmap -sS -oX - 10.0.1.0/24', ['syn']), ['ports']);
  assert.deepEqual(asks('nmap -sS -sU --top-ports 100 -sV --traceroute -oX - 10.0.1.0/24', ['syn', 'udp']), ['ports', 'products', 'route']);
  assert.deepEqual(asks('nmap -A -oX - 10.0.1.0/24', ['syn']), ['ports', 'products', 'route']);
  assert.deepEqual(asks('nmap -sn --traceroute -oX - 10.0.1.0/24', []), ['route']);
  assert.deepEqual(asks('nmap -PR -sn -oX - 10.0.1.0/24', []), [], 'who is there is no question to a host');
  assert.deepEqual(asks('nmap -sL -oX - 10.0.1.0/24', []), []);
  // What a filter passes is not which ports are open.
  for (const type of ['ack', 'window', 'fin', 'null', 'xmas', 'maimon', 'sctpinit', 'ipproto']) {
    assert.deepEqual(asks('nmap -sV -oX - 10.0.1.0/24', [type]), [], type);
  }
  assert.deepEqual(asks('nmap -sVx --tracerouteX -oX - 10.0.1.0/24', ['connect']), ['ports'], 'whole words only');
  assert.deepEqual(asks('', ['connect']), ['ports'], 'a result without its command');
  assert.deepEqual(asks(null, null), []);
  // A few ports looked at for another purpose leave the question open;
  // what runs on them was asked all the same.
  const few = { tcp: [[22, 23], [443, 443]] }, twenty = { tcp: [[1, 10], [21, 30]] };
  assert.deepEqual(asks('nmap -sS -sV -p 22-23,443 -oX - 10.0.1.0/24', ['syn'], few), ['products']);
  assert.deepEqual(asks('nmap -sS -p 22-23,443 -oX - 10.0.1.0/24', ['syn'], few), []);
  assert.deepEqual(asks('nmap -sS -oX - 10.0.1.0/24', ['syn'], twenty), ['ports']);
  assert.deepEqual(asks('nmap -sS -oX - 10.0.1.0/24', ['syn'], { tcp: [[1, 19]] }), []);
  assert.deepEqual(asks('nmap -sU -sV -p U:161 -oX - 10.0.1.0/24', ['udp'], { udp: [[161, 161]] }), ['products'], 'UDP alone is not which ports are open');
  assert.deepEqual(asks('nmap -sS -sU -oX - 10.0.1.0/24', ['syn', 'udp'], { tcp: [[1, 1000]], udp: [[1, 100]] }), ['ports']);
  assert.deepEqual(asks('nmap -sS -oX - 10.0.1.0/24', ['syn'], {}), ['ports'], 'nmap did not say what it probed');
  // nmap takes the scan letters together.
  assert.deepEqual(asks('nmap -sCV -oX - 10.0.1.0/24', ['syn']), ['ports', 'products']);
  assert.deepEqual(asks('nmap -sSV -oX - 10.0.1.0/24', ['syn']), ['ports', 'products']);
});

test('results of different scans pasted together note nothing: none asked the others\' hosts', () => {
  const scan = N.read(fixture('lan-arp.xml') + fixture('discover-localhost.xml')).scan;
  assert.equal(scan.hosts.length, 5);
  assert.deepEqual(scan.asks, []);
});

test('an import notes what it asked on every host it adds or knows, for the day of the scan', () => {
  const scan = N.read(fixture('day1.xml')).scan;
  assert.deepEqual(scan.asks, ['products'], 'four ports, with versions: ' + scan.args);
  const doc = afterDay1();
  const hosts = Object.keys(doc.entities).filter(id => doc.entities[id].kind === 'host');
  assert.equal(hosts.length, 4);
  for (const id of hosts) assert.deepEqual(doc.entities[id].asked, { products: '2026-09-17' }, id);
  // Ten days later: the day moves, a key the later scan did not ask keeps its own.
  const later = day10();
  later.asks = ['ports'];
  const p = N.plan(doc, 'nmap', later, '', {});
  assert.deepEqual(p.asked, { keys: ['ports'], day: '2026-09-27', also: [] });
  const db = hostBy(doc, '10.0.2.5');
  assert.deepEqual(rowAt(p, '10.0.2.5').unasked, ['ports']);
  const next = N.apply(doc, p, N.defaults(p), specOf, N.stampFor(later, '', later.date)).doc;
  assert.deepEqual(next.entities[db].asked, { ports: '2026-09-27', products: '2026-09-17' });
  assert.deepEqual(Object.keys(next.entities[db].asked), ['ports', 'products'], 'in the file\'s order');
  // Unticked, nothing is noted; a key nobody knows is not written.
  const t = N.defaults(p);
  t.asked = false;
  assert.deepEqual(N.apply(doc, p, t, specOf, N.stampFor(later, '', later.date)).doc.entities[db].asked, { products: '2026-09-17' });
  later.asks = ['ports', 'weaknesses', '__proto__'];
  assert.deepEqual(N.plan(doc, 'nmap', later, '', {}).asked.keys, ['ports']);
});

test('a host that was asked and has nothing is noted all the same; the same day again is no edit', () => {
  const doc = afterDay1();
  const scan = N.read(fixture('day1.xml')).scan;
  scan.hosts.forEach(h => { h.ports = []; });
  scan.date = '2026-09-20';
  scan.asks = ['ports', 'products'];
  const p = N.plan(doc, 'nmap', scan, '', {});
  const t = N.defaults(p);
  t.seen = false;
  assert.equal(N.said(N.summary(doc, p, t, null)), 'Notes 4 hosts as asked.');
  const next = N.apply(doc, p, t, specOf, N.stampFor(scan, '', scan.date)).doc;
  assert.equal(next.entities[hostBy(doc, '10.0.2.5')].asked.ports, '2026-09-20');
  const again = N.plan(next, 'nmap', scan, '', {});
  assert.equal(N.apply(next, again, t, specOf, N.stampFor(scan, '', scan.date)), null);
});

test('a scan without a day takes the day of the import; without either nothing is noted', () => {
  const doc = afterDay1();
  const scan = N.read(fixture('day1.xml')).scan;
  scan.date = null;
  scan.asks = ['ports'];
  assert.deepEqual(N.plan(doc, 'nmap', scan, '', {}, '2026-09-30').asked, { keys: ['ports'], day: '2026-09-30', also: [] });
  assert.deepEqual(N.plan(doc, 'nmap', scan, '', {}).asked, { keys: [], day: null, also: [] });
});

test('a scanner that only writes what it found notes the drawn hosts its targets held', () => {
  const doc = afterDay1();
  const scan = N.read(fixture('day1.xml')).scan;
  // One host answered; the targets held the whole network.
  scan.hosts = scan.hosts.filter(h => h.addresses.includes('10.0.2.5'));
  scan.date = '2026-09-21';
  scan.asks = ['connections'];
  scan.covers = '10.0.2.0/24';
  const hosts = Object.keys(doc.entities).filter(id => doc.entities[id].kind === 'host');
  doc.entities[hosts.filter(id => id !== hostBy(doc, '10.0.2.5'))[0]].missed = '2026-09-19';
  const p = N.plan(doc, 'nmap', scan, '', {});
  assert.equal(p.asked.also.length, hosts.length - 2, 'not the one with a row, not the one that is gone');
  const t = N.defaults(p);
  assert.equal(N.summary(doc, p, t, null).asked, hosts.length - 1);
  assert.equal(N.askedCount(p, t), hosts.length - 1);
  assert.equal(N.askedCount(p, Object.assign({}, t, { asked: false })), 0);
  const next = N.apply(doc, p, t, specOf, N.stampFor(scan, '', scan.date)).doc;
  for (const id of p.asked.also) assert.equal(next.entities[id].asked.connections, '2026-09-21', id);
  assert.equal(next.entities[hostBy(doc, '10.0.2.5')].asked.connections, '2026-09-21');
  t.asked = false;
  const not = N.apply(doc, p, t, specOf, N.stampFor(scan, '', scan.date));
  assert.ok(!not || p.asked.also.every(id => !(not.doc.entities[id].asked || {}).connections));
});

test('what was asked, in words', () => {
  assert.equal(N.askedWords(['connections']), 'how they connect');
  assert.equal(N.askedWords(['products', 'connections']), 'what runs there and how they connect');
  assert.equal(N.askedWords(['nope']), '');
  assert.equal(N.askedWords(null), '');
});
