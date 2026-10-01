const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const E = require('../assets/js/architecture-edit.js');
const fixture = name => fs.readFileSync('scripts/fixtures/nmap/' + name, 'utf8');
const catalog = JSON.parse(fs.readFileSync('scripts/fixtures/catalog.json', 'utf8'));
const specOf = kind => catalog.entities.filter(e => e.kind === kind)[0];
const clone = x => JSON.parse(JSON.stringify(x));
const read = name => N.read(fixture(name)).scan;

function imported(doc, scan, change, merges) {
  const p = N.plan(doc, 'nmap', scan, '', merges || {});
  const t = N.defaults(p);
  if (change) change(p, t);
  const edit = N.apply(doc, p, t, specOf, N.stampFor(scan, '', scan.date));
  return edit && edit.doc;
}
const afterDay1 = () => imported(N.addNmap(E.empty(), null, 'nmap', specOf).doc, read('day1.xml'));
const hostBy = (doc, addr) => Object.keys(doc.entities).filter(id => (doc.entities[id].addresses || []).includes(addr))[0];
const byLabel = (doc, label) => Object.keys(doc.entities).filter(id => doc.entities[id].label === label);
const lines = p => p.changes.list.map(c => c.line);
const tick = kind => (p, t) => p.changes.list.filter(c => c.kind === kind).forEach(c => { t.changes[c.key] = true; });

test('day 10 against day 1: a closed port, a new version, a host gone quiet; nothing of it ticked', () => {
  const doc = afterDay1();
  const p = N.plan(doc, 'nmap', read('day10.xml'), '', {});
  assert.equal(p.changes.since, '2026-09-17');
  assert.deepEqual(lines(p), [
    'tcp/3306 on “db1.lab” is closed now (“mysql”)',
    'ssh on “db1.lab”: OpenSSH 8.9p1 → OpenSSH 9.6p1',
    '“10.0.2.8” did not answer (seen 2026-09-17)',
  ]);
  assert.deepEqual(p.changes.list.map(c => c.action), ['remove the service', 'make it the product of the service', 'mark it as not seen since 2026-09-27']);
  const t = N.defaults(p);
  assert.deepEqual(Object.values(t.changes), [false, false, false]);
  // Unticked, nothing of it is done.
  const next = imported(doc, read('day10.xml'));
  assert.equal(byLabel(next, 'mysql').length, 1);
  assert.equal(next.entities[hostBy(next, '10.0.2.8')].missed, undefined);
  assert.equal(byLabel(next, 'OpenSSH 9.6p1').length, 0);
});

test('a closed port ticked removes the service with its flows; the product another service runs stays', () => {
  const doc = afterDay1();
  const next = imported(doc, read('day10.xml'), tick('closed'));
  assert.equal(byLabel(next, 'mysql').length, 0);
  assert.ok(!Object.values(next.flows).some(f => f.protocol === 'tcp/3306'));
  assert.equal(byLabel(next, 'ssh').length, 2);
});

test('a new version ticked: the service runs the new product; the old one stays while another runs it', () => {
  const doc = afterDay1();
  const next = imported(doc, read('day10.xml'), tick('version'));
  const fresh = byLabel(next, 'OpenSSH 9.6p1');
  assert.equal(fresh.length, 1);
  const db = hostBy(next, '10.0.2.5');
  const ssh = Object.values(next.associations).filter(a => a.kind === 'hosts' && a.from === db).map(a => a.to).filter(id => next.entities[id].label === 'ssh')[0];
  assert.deepEqual(Object.values(next.associations).filter(a => a.kind === 'instance-of' && a.from === ssh).map(a => a.to), fresh);
  assert.equal(byLabel(next, 'OpenSSH 8.9p1').length, 1, 'the host at 10.0.2.7 still runs it');
  // With nothing else running it, it goes — unless its author set something on it.
  const alone = clone(doc);
  const other = Object.keys(alone.associations).filter(k => alone.associations[k].kind === 'instance-of' && alone.associations[k].from !== ssh && alone.entities[alone.associations[k].to].label === 'OpenSSH 8.9p1')[0];
  alone.associations[other].to = byLabel(alone, 'nginx 1.24.0')[0];
  assert.equal(byLabel(imported(alone, read('day10.xml'), tick('version')), 'OpenSSH 8.9p1').length, 0);
  alone.entities[byLabel(alone, 'OpenSSH 8.9p1')[0]].description = 'pinned by the vendor';
  assert.equal(byLabel(imported(alone, read('day10.xml'), tick('version')), 'OpenSSH 8.9p1').length, 1);
});

test('a host gone quiet ticked is marked, not deleted; seen again, the mark goes', () => {
  const doc = afterDay1();
  const next = imported(doc, read('day10.xml'), tick('missed'));
  const quiet = hostBy(next, '10.0.2.8');
  assert.equal(next.entities[quiet].missed, '2026-09-27');
  assert.equal(next.entities[quiet].seen, '2026-09-17');
  // Marked already: not offered again.
  assert.ok(!lines(N.plan(next, 'nmap', read('day10.xml'), '', {})).some(l => /10\.0\.2\.8/.test(l)));
  const back = read('day1.xml');
  back.date = '2026-10-01';
  const again = imported(next, back);
  assert.equal(again.entities[quiet].missed, undefined);
  assert.equal(again.entities[quiet].seen, '2026-10-01');
});

test('a scan speaks only for what it looked at: other ranges, other ports', () => {
  const doc = afterDay1();
  const far = read('day10.xml');
  far.args = far.args.replace('10.0.2.0/24', '10.0.2.0/29');
  assert.ok(!lines(N.plan(doc, 'nmap', far, '', {})).some(l => /10\.0\.2\.8/.test(l)), '10.0.2.8 is outside a /29');
  const few = read('day10.xml');
  few.probed = { tcp: [[22, 22], [80, 80]] };
  assert.ok(!lines(N.plan(doc, 'nmap', few, '', {})).some(l => /3306/.test(l)), 'tcp/3306 was not probed');
});

test('a scan without a date or of names only offers no host as gone; one without what it probed closes nothing', () => {
  const doc = afterDay1();
  const undated = read('day10.xml');
  undated.date = null;
  undated.probed = {};
  assert.deepEqual(lines(N.plan(doc, 'nmap', undated, '', {})), ['ssh on “db1.lab”: OpenSSH 8.9p1 → OpenSSH 9.6p1']);
  const names = read('day10.xml');
  names.args = 'nmap -sL -oX - 10.0.2.0/24';
  assert.deepEqual(lines(N.plan(doc, 'nmap', names, '', {})), []);
});

// ---- the firewalls' permissions (spec §5.3) ----

// nmap on the admin box in the lab network; a gateway with a firewall to
// the DMZ; a web host there with three drawn services and their flows.
function walled() {
  const d = E.empty();
  const host = (label, addresses) => ({ kind: 'host', label, addresses, parameters: { escape: { status: 'unknown' } } });
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.1.0/24'] },
    dmz: { kind: 'network', label: 'DMZ', addresses: ['10.0.5.0/24'] },
    office: { kind: 'network', label: 'Office', addresses: ['10.0.7.0/24'] },
    admin: host('Admin box', ['10.0.1.50']),
    desk: host('Desk', ['10.0.7.20']),
    gw: host('Gateway', ['10.0.1.1']),
    gwr: { kind: 'router', label: 'Gateway router' },
    fw: { kind: 'firewall', label: 'Gateway firewall' },
    web: host('web', ['10.0.5.10']),
    https: { kind: 'service', label: 'https' },
    rdp: { kind: 'service', label: 'rdp' },
    ssh: { kind: 'service', label: 'ssh' },
    browser: { kind: 'application', label: 'Browser' },
  };
  const a = (kind, from, to, extra) => Object.assign({ kind, from, to }, extra || {});
  d.associations = {
    a1: a('attached', 'admin', 'lan'), a2: a('attached', 'gw', 'lan'), a3: a('attached', 'gw', 'dmz'), a4: a('attached', 'gwr', 'lan'), a5: a('attached', 'gwr', 'dmz'),
    a6: a('attached', 'web', 'dmz'), a7: a('attached', 'desk', 'office'), a8: a('attached', 'gwr', 'office'),
    h1: a('hosts', 'gw', 'gwr', { privilege: 'admin' }), h2: a('hosts', 'web', 'https', { privilege: 'unknown' }), h3: a('hosts', 'web', 'rdp', { privilege: 'unknown' }),
    h4: a('hosts', 'web', 'ssh', { privilege: 'unknown' }), h5: a('hosts', 'desk', 'browser', { privilege: 'user' }),
    f1: a('filters', 'gwr', 'fw'),
    'allow-https': a('permits', 'fw', 'to-https', { allowed: true }),
    'deny-rdp': a('permits', 'fw', 'to-rdp', { allowed: false }),
  };
  let doc = N.addNmap(d, 'admin', 'nmap', specOf).doc;
  const flow = (target, protocol, source, first) => ({ label: protocol, source: source || 'nmap', target, route: [first || 'lan', 'gwr', 'dmz'], protocol, parameters: { connect: { status: 'unknown' } } });
  doc.flows = { 'to-https': flow('https', 'tcp/443'), 'to-rdp': flow('rdp', 'tcp/3389'), 'to-ssh': flow('ssh', 'tcp/22'), browse: flow('https', 'tcp/443', 'browser', 'office') };
  return doc;
}

test('the firewall recipe takes the ports of the flows drawn through a firewall into the range', () => {
  assert.deepEqual(N.drawnPorts(walled(), 'nmap', '10.0.5.0/24'), ['tcp/443', 'tcp/3389', 'tcp/22']);
  assert.deepEqual(N.drawnPorts(walled(), 'nmap', '10.0.9.0/24'), []);
  const open = walled();
  delete open.associations.f1;
  assert.deepEqual(N.drawnPorts(open, 'nmap', '10.0.5.0/24'), [], 'a router without a firewall filters nothing');
});

test('what got through is held against what the firewall permits', () => {
  const p = N.plan(walled(), 'nmap', read('firewall.xml'), '', {});
  assert.deepEqual(p.changes.list.map(c => [c.kind, !!c.warn, c.line, c.action || null]), [
    ['permit', false, 'the firewall on “Gateway router” blocks tcp/443 to “https” on “web”', 'set the permission to denied'],
    ['permit', true, 'the firewall on “Gateway router” lets tcp/3389 to “rdp” on “web” through', 'set the permission to allowed'],
    ['permit', false, 'the firewall on “Gateway router” has no permission for tcp/22 to “ssh” on “web”; the scan says it is let through', 'give it that permission'],
    ['said', false, 'blocked on the way to “web”: tcp/445 · nothing drawn to say it on', null],
    ['opening', false, 'unplanned opening: tcp/8080 on “web” through “Gateway router”', 'allow the flow it adds on that firewall'],
  ]);
  assert.deepEqual(p.changes.notes, ['1 flow through a firewall starts elsewhere; from where nmap stands the scan cannot tell about it.']);
  assert.ok(!lines(p).some(l => /is filtered now/.test(l)), 'a port a firewall blocks is not a service gone');
});

test('ticked, the permissions are set as the scan found them; the opening is allowed on its new flow', () => {
  const doc = walled();
  const next = imported(doc, read('firewall.xml'), (p, t) => { p.changes.list.forEach(c => { if (c.action) t.changes[c.key] = true; }); });
  assert.equal(next.associations['allow-https'].allowed, false);
  assert.equal(next.associations['deny-rdp'].allowed, true);
  const permits = Object.values(next.associations).filter(a => a.kind === 'permits');
  assert.equal(permits.length, 4);
  assert.deepEqual(permits.filter(a => a.to === 'to-ssh').map(a => [a.from, a.allowed]), [['fw', true]]);
  const opened = Object.keys(next.flows).filter(k => next.flows[k].protocol === 'tcp/8080');
  assert.equal(opened.length, 1);
  assert.deepEqual(next.flows[opened[0]].route, ['lan', 'gwr', 'dmz']);
  assert.deepEqual(permits.filter(a => a.to === opened[0]).map(a => [a.from, a.allowed]), [['fw', true]]);
  // Unticked: the flow is added, the permissions are as they were.
  const plain = imported(doc, read('firewall.xml'));
  assert.equal(plain.associations['allow-https'].allowed, true);
  assert.equal(Object.values(plain.associations).filter(a => a.kind === 'permits').length, 2);
});

test('a scan that was not the firewall recipe says nothing of permissions', () => {
  const s = read('firewall.xml');
  s.args = s.args.replace(' --reason', '');
  const p = N.plan(walled(), 'nmap', s, '', {});
  assert.deepEqual(p.changes.list.map(c => c.kind), ['closed']);
  assert.equal(lines(p)[0], 'tcp/443 on “web” is filtered now (“https”)');
});

test('an ACK scan says whether a firewall keeps state, and nothing else', () => {
  const p = N.plan(walled(), 'nmap', read('firewall-ack.xml'), '', {});
  assert.deepEqual(p.changes.list.map(c => [c.kind, c.line]), [
    ['said', 'tcp/443 to “https” on “web”: an ACK is dropped, so a firewall on the way keeps state or blocks it'],
    ['said', 'tcp/3389 to “rdp” on “web”: an ACK gets through, so no firewall on the way keeps state for it'],
    ['said', 'tcp/22 to “ssh” on “web”: an ACK gets through, so no firewall on the way keeps state for it'],
  ]);
  assert.ok(p.hosts.every(h => h.ports.length === 0), 'it adds no service');
});

// Scan workflow spec §5.1: window, FIN, NULL and Xmas scans are read as the
// ACK scan is. A reset came through the filter, whatever nmap calls the port.
test('a window, FIN, NULL or Xmas scan says what a filter passes, and draws no port', () => {
  const as = (type, flag, states) => {
    let text = fs.readFileSync('scripts/fixtures/nmap/firewall-ack.xml', 'utf8').replace('nmap -sA', 'nmap ' + flag).replace('type="ack"', 'type="' + type + '"');
    for (const port of Object.keys(states)) text = text.replace(new RegExp('(portid="' + port + '"><state state=")[a-z|]+'), '$1' + states[port]);
    return N.read(text).scan;
  };
  const cases = [
    ['window', '-sW', { 22: 'open', 443: 'filtered', 3389: 'closed' }, 'an ACK'],
    ['fin', '-sF', { 22: 'closed', 443: 'filtered', 3389: 'closed' }, 'a FIN'],
    ['null', '-sN', { 22: 'closed', 443: 'filtered', 3389: 'closed' }, 'a packet without flags'],
    ['xmas', '-sX', { 22: 'closed', 443: 'filtered', 3389: 'closed' }, 'an Xmas packet'],
  ];
  for (const [type, flag, states, sent] of cases) {
    const scan = as(type, flag, states);
    assert.deepEqual(scan.types, [type]);
    assert.deepEqual(scan.asks, [], type + ' asks no host which ports are open');
    const p = N.plan(walled(), 'nmap', scan, '', {});
    assert.deepEqual(p.changes.list.map(c => [c.kind, c.line]), [
      ['said', 'tcp/443 to “https” on “web”: ' + sent + ' is dropped, so a firewall on the way keeps state or blocks it'],
      ['said', 'tcp/3389 to “rdp” on “web”: ' + sent + ' gets through, so no firewall on the way keeps state for it'],
      ['said', 'tcp/22 to “ssh” on “web”: ' + sent + ' gets through, so no firewall on the way keeps state for it'],
    ], type);
    assert.ok(p.hosts.every(h => h.ports.length === 0), type + ': a window scan\'s open port is no service');
  }
  // No answer says nothing: the port may be open, or the packet dropped.
  const silent = N.plan(walled(), 'nmap', as('fin', '-sF', { 22: 'open|filtered', 443: 'open|filtered', 3389: 'open|filtered' }), '', {});
  assert.deepEqual(silent.changes.list, []);
  // Beside a scan that finds ports, ports are found.
  assert.equal(N.passing({ types: ['syn', 'ack'] }), null);
  assert.equal(N.passing({ types: [] }), null);
  assert.equal(N.passing(null), null);
  assert.equal(N.passing({ types: ['ack', 'fin'] }), 'an ACK');
});

// A scan in nmap's shape of `addresses`, each with SSH open and its MAC
// when given ({address: mac}).
function scanOf(args, addresses, start, macs) {
  return N.read('<?xml version="1.0"?><nmaprun scanner="nmap" args="' + args + '" start="' + start + '"><scaninfo type="connect" protocol="tcp" services="1-1000"/>' + addresses.map(a => '<host><status state="up"/><address addr="' + a + '" addrtype="ipv4"/>' + ((macs || {})[a] ? '<address addr="' + macs[a] + '" addrtype="mac"/>' : '') + '<ports><port protocol="tcp" portid="22"><state state="open"/><service name="ssh"/></port></ports></host>').join('') + '<runstats><finished exit="success"/></runstats></nmaprun>').scan;
}

test('a host the scan was told to leave out is not one that did not answer', () => {
  const first = imported(N.addNmap(E.empty(), null, 'nmap', specOf).doc, scanOf('nmap -sT -oX - 10.0.0.0/24', ['10.0.0.1', '10.0.0.5', '10.0.0.6'], 1790000000));
  const rescan = N.command(['services'], { exclude: 'typed' }, '10.0.0.0/24', { exclude: '10.0.0.5' }).text;
  assert.equal(rescan, 'nmap --exclude 10.0.0.5 -sT -sV -oX - 10.0.0.0/24');
  const p = N.plan(first, 'nmap', scanOf(rescan, ['10.0.0.1'], 1790100000), '', {});
  assert.deepEqual(lines(p), ['“10.0.0.6” did not answer (seen 2026-09-21)']);
  // So too written --exclude=…, after the targets, or as a range.
  for (const args of ['nmap -sT -oX - 10.0.0.0/24 --exclude=10.0.0.5', 'nmap --exclude 10.0.0.4-5 -sT -oX - 10.0.0.0/24', 'nmap --exclude 10.0.0.5,10.0.0.6 -sT -oX - 10.0.0.0/24']) {
    const q = N.plan(first, 'nmap', scanOf(args, ['10.0.0.1'], 1790100000), '', {});
    assert.ok(!lines(q).some(l => l.startsWith('“10.0.0.5”')), args);
  }
  // Or by a name the host keeps.
  const named = clone(first);
  named.entities[hostBy(named, '10.0.0.6')].names = ['printer.lab'];
  const byName = N.plan(named, 'nmap', scanOf('nmap --exclude 10.0.0.5,printer.lab -sT -oX - 10.0.0.0/24', ['10.0.0.1'], 1790100000), '', {});
  assert.deepEqual(lines(byName), []);
});

test('a scan told to leave out what a file lists says the file was not read', () => {
  const first = imported(N.addNmap(E.empty(), null, 'nmap', specOf).doc, scanOf('nmap -sT -oX - 10.0.0.0/24', ['10.0.0.1', '10.0.0.5'], 1790000000));
  const said = p => p.changes.notes.filter(n => /excludefile/.test(n));
  for (const args of ['nmap --excludefile skip.txt -sT -oX - 10.0.0.0/24', 'nmap -sT -oX - 10.0.0.0/24 --excludefile=skip.txt', 'nmap -sT -oX - 10.0.0.0/24 -excludefile skip.txt']) {
    const p = N.plan(first, 'nmap', scanOf(args, ['10.0.0.1'], 1790100000), '', {});
    assert.equal(said(p).length, 1, args);
    // The file is not a target: a host it does not cover is still one the scan looked at.
    assert.deepEqual(lines(p), ['“10.0.0.5” did not answer (seen 2026-09-21)'], args);
  }
  assert.deepEqual(said(N.plan(first, 'nmap', scanOf('nmap -sT -oX - 10.0.0.0/24', ['10.0.0.1'], 1790100000), '', {})), []);
});

test('an address left out of the scan is not one a moved host left', () => {
  const macs = { '10.0.0.5': '52:54:00:00:00:05', '10.0.0.9': '52:54:00:00:00:05' };
  const first = imported(N.addNmap(E.empty(), null, 'nmap', specOf).doc, scanOf('nmap -sT -oX - 10.0.0.0/24', ['10.0.0.5'], 1790000000, macs));
  const row = args => N.plan(first, 'nmap', scanOf(args, ['10.0.0.9'], 1790100000, macs), '', {}).hosts[0];
  assert.deepEqual(row('nmap -sT -oX - 10.0.0.0/24').moved.from, ['10.0.0.5']);
  assert.deepEqual(row('nmap --exclude 10.0.0.5 -sT -oX - 10.0.0.0/24').moved, { from: [], to: ['10.0.0.9'], others: [] });
});

test('another way to a host is offered for nmap\'s flows to it', () => {
  const doc = walled();
  doc.flows['to-ssh'].route = [];
  const p = N.plan(doc, 'nmap', read('firewall.xml'), '', {});
  const way = p.changes.list.filter(c => c.kind === 'route')[0];
  assert.equal(way.line, 'the way to “web” crosses Gateway');
  assert.deepEqual(way.flows, ['to-ssh']);
  const next = imported(doc, read('firewall.xml'), tick('route'));
  assert.deepEqual(next.flows['to-ssh'].route, ['lan', 'gwr', 'dmz']);
  assert.deepEqual(next.flows.browse.route, ['office', 'gwr', 'dmz'], 'not a flow of nmap: left alone');
});
