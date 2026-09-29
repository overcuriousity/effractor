const { test } = require('node:test');
const assert = require('node:assert/strict');
const G = require('../assets/js/scan-gaps.js');
const T = require('../assets/js/scan-targets.js');

// Scan workflow spec §2: what the bulb says, from the drawing alone.
const DAY = '2026-09-28';
function empty() {
  return { profile: 'architecture', entities: {}, associations: {}, flows: {} };
}
// An office network with the scanner on a workstation, scanned: two hosts
// with services, one named, one not.
function office() {
  const d = empty();
  d.entities = {
    lan: { kind: 'network', label: 'Office LAN', addresses: ['10.0.1.0/24'] },
    pc: { kind: 'host', label: 'pc', addresses: ['10.0.1.5'], seen: DAY, asked: { ports: DAY, products: DAY, connections: DAY } },
    web: { kind: 'host', label: 'web', addresses: ['10.0.1.40'], seen: DAY, asked: { ports: DAY, products: DAY, connections: DAY } },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    ssh: { kind: 'service', label: 'ssh' },
    https: { kind: 'service', label: 'https' },
    openssh: { kind: 'product', label: 'OpenSSH 9.6p1' },
    nginx: { kind: 'product', label: 'nginx 1.24.0' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'pc', to: 'lan' },
    a2: { kind: 'attached', from: 'web', to: 'lan' },
    a3: { kind: 'hosts', from: 'pc', to: 'nmap', privilege: 'user' },
    a4: { kind: 'hosts', from: 'pc', to: 'ssh', privilege: 'unknown' },
    a5: { kind: 'hosts', from: 'web', to: 'https', privilege: 'unknown' },
    a6: { kind: 'instance-of', from: 'ssh', to: 'openssh' },
    a7: { kind: 'instance-of', from: 'https', to: 'nginx' },
  };
  return d;
}
const says = (d, silenced) => G.steps(d, silenced).map(s => s.says);
const step = (d, id) => G.steps(d).filter(s => s.id === id)[0];

test('a drawing that lacks nothing says nothing; one that is no architecture is not asked', () => {
  assert.deepEqual(G.steps(office()), []);
  assert.deepEqual(G.steps(Object.assign(office(), { profile: 'attack-tree' })), []);
  for (const none of [null, undefined, {}, { profile: 'architecture' }]) assert.deepEqual(G.steps(none), []);
});

test('1. without a scanner: scan a network with nmap, as the bulb said before', () => {
  const d = empty();
  assert.deepEqual(G.steps(d), [{ id: 'scanner', tool: 'nmap', count: 0, says: 'Scan a network with nmap', purposes: null, adjust: null, targets: null }]);
  d.entities.gb = { kind: 'application', label: 'Greenbone', tool: 'greenbone' };
  assert.deepEqual(G.steps(d), [], 'any scanner is one');
  d.entities.gb = { kind: 'application', label: 'a browser' };
  assert.equal(G.steps(d).length, 1, 'an application without a tool is none');
});

test('2. a drawn network no scan saw a host on: nmap, its whole range', () => {
  const d = office();
  d.entities.srv = { kind: 'network', label: 'Server LAN', addresses: ['10.0.2.0/24'] };
  assert.deepEqual(step(d, 'network'), { id: 'network', tool: 'nmap', count: 1, says: 'Server LAN not scanned · nmap', purposes: ['services'], adjust: null, targets: { kind: 'range', network: 'srv' } });
  assert.equal(T.words(d, step(d, 'network').targets).text, '10.0.2.0/24');
  // The scanner on it: who is on this LAN, too. (Its host was drawn by
  // hand: one a scan saw would be a host seen on the network.)
  delete d.entities.pc.seen;
  d.associations.a8 = { kind: 'attached', from: 'pc', to: 'srv' };
  assert.deepEqual(step(d, 'network').purposes, ['lan', 'services']);
  delete d.associations.a8;
  // A host drawn by hand on it is no scan of it; one a scan saw is.
  d.entities.db = { kind: 'host', label: 'db', addresses: ['10.0.2.9'], asked: { ports: DAY, products: DAY, route: DAY } };
  assert.ok(step(d, 'network'));
  d.entities.db.seen = DAY;
  assert.equal(step(d, 'network'), undefined);
  // A network without addresses cannot be scanned.
  d.entities.dmz = { kind: 'network', label: 'DMZ' };
  assert.equal(step(d, 'network'), undefined);
});

test('2. a range of more than 1,024 addresses is masscan\'s first; several networks are counted', () => {
  const d = office();
  d.entities.campus = { kind: 'network', label: 'Campus', addresses: ['192.168.176.0/20'] };
  assert.deepEqual(step(d, 'network'), { id: 'network', tool: 'masscan', count: 1, says: 'Campus not scanned · masscan', purposes: null, adjust: null, targets: { kind: 'range', network: 'campus' } });
  d.entities.campus.addresses = ['10.1.0.0/22'];
  assert.equal(step(d, 'network').tool, 'nmap', '1,024 addresses are nmap\'s');
  d.entities.campus.addresses = ['10.1.0.0/23', '10.2.0.0/23', '10.3.0.0/30'];
  assert.equal(step(d, 'network').tool, 'masscan', 'its ranges together');
  d.entities.campus.addresses = ['fd00::/64'];
  assert.equal(step(d, 'network').tool, 'nmap', 'masscan is not given an IPv6 range');
  d.entities.lab = { kind: 'network', label: 'Lab', addresses: ['10.9.0.0/24'] };
  assert.equal(step(d, 'network').says, '2 networks not scanned · nmap');
  assert.deepEqual(step(d, 'network').targets, { kind: 'range', network: 'campus' }, 'the first of them');
});

test('3. hosts no scan asked what runs there: those hosts, and the ports drawn where all have some', () => {
  const d = office();
  d.entities.p1 = { kind: 'host', label: 'printer', addresses: ['10.0.1.20'], seen: DAY };
  d.associations.a8 = { kind: 'attached', from: 'p1', to: 'lan' };
  assert.deepEqual(step(d, 'runs'), { id: 'runs', tool: 'nmap', count: 1, says: '1 host not asked what runs there · nmap', purposes: ['services'], adjust: null, targets: { kind: 'selection', networks: [], hosts: ['p1'] } });
  assert.equal(T.words(d, step(d, 'runs').targets).text, '10.0.1.20');
  // Asked, with nothing open: said no more.
  d.entities.p1.asked = { ports: DAY };
  assert.equal(step(d, 'runs'), undefined);
  // What masscan drew: ports without products.
  d.entities.smb = { kind: 'service', label: 'microsoft-ds' };
  d.entities.u1 = { kind: 'product', label: 'unidentified microsoft-ds on printer' };
  d.associations.a9 = { kind: 'hosts', from: 'p1', to: 'smb', privilege: 'unknown' };
  d.associations.a10 = { kind: 'instance-of', from: 'smb', to: 'u1' };
  // A port is drawn as a flow to the service, as the command reads it.
  assert.equal(step(d, 'runs').adjust, null, 'a service without a flow gives no port');
  d.flows = { f1: { label: 'masscan to microsoft-ds', source: 'nmap', target: 'smb', protocol: 'tcp/445', route: [] } };
  assert.deepEqual(step(d, 'runs').adjust, { ports: 'drawn' });
  assert.deepEqual(T.drawnPorts(d, T.words(d, step(d, 'runs').targets).text), ['tcp/445']);
  assert.equal(step(d, 'runs').says, '1 host not asked what runs there · nmap');
  // Beside a host without any port, the usual ports are asked.
  d.entities.p2 = { kind: 'host', label: 'scanner', addresses: ['10.0.1.21'] };
  assert.equal(step(d, 'runs').count, 2);
  assert.equal(step(d, 'runs').adjust, null);
  delete d.entities.p2;
  // Asked what runs there, and nmap could not tell: said no more.
  d.entities.p1.asked = { ports: DAY, products: DAY };
  assert.equal(step(d, 'runs'), undefined);
});

test('3. a drawing made before hosts noted what they were asked is no gap where it has ports and products', () => {
  const d = office();
  for (const id of ['pc', 'web']) delete d.entities[id].asked;
  assert.equal(step(d, 'runs'), undefined);
  assert.equal(step(d, 'connect').count, 2, 'whether its connections were looked for, nothing says');
  // A service without a product at all is one nobody named.
  delete d.associations.a7;
  assert.deepEqual(step(d, 'runs').targets.hosts, ['web']);
});

test('3, 5. a host without an address, or one that is gone, is not asked', () => {
  const d = office();
  d.entities.ghost = { kind: 'host', label: 'ghost' };
  d.entities.gone = { kind: 'host', label: 'gone', addresses: ['10.0.1.99'], missed: DAY };
  d.entities.old = { kind: 'service', label: 'telnet' };
  d.associations.a8 = { kind: 'hosts', from: 'gone', to: 'old', privilege: 'unknown' };
  assert.deepEqual(G.steps(d), []);
});

test('4. a network with hosts that no drawn router joins to the scanner\'s: the hosts on it', () => {
  const d = office();
  d.entities.srv = { kind: 'network', label: 'Server LAN', addresses: ['10.0.2.0/24'] };
  d.entities.db = { kind: 'host', label: 'db', addresses: ['10.0.2.9'], seen: DAY, asked: { ports: DAY, products: DAY, connections: DAY } };
  d.associations.a8 = { kind: 'attached', from: 'db', to: 'srv' };
  assert.deepEqual(step(d, 'way'), { id: 'way', tool: 'nmap', count: 1, says: 'No way drawn to Server LAN · nmap', purposes: ['route', 'snmp', 'managed'], adjust: null, targets: { kind: 'selection', networks: [], hosts: ['db'] } });
  // Asked, and nmap found no router (one network over a bridge): said no more.
  d.entities.db.asked.route = DAY;
  assert.equal(step(d, 'way'), undefined);
  delete d.entities.db.asked.route;
  // A router on both joins them: attached itself, or on a box that is.
  d.entities.r1 = { kind: 'router', label: 'gw router' };
  d.associations.a9 = { kind: 'attached', from: 'r1', to: 'lan' };
  assert.ok(step(d, 'way'), 'on one of them only');
  d.associations.a10 = { kind: 'attached', from: 'r1', to: 'srv' };
  assert.equal(step(d, 'way'), undefined);
  delete d.associations.a9;
  delete d.associations.a10;
  d.entities.gw = { kind: 'host', label: 'gw', addresses: ['10.0.1.1'], seen: DAY, asked: { ports: DAY, products: DAY, connections: DAY } };
  d.associations.a11 = { kind: 'hosts', from: 'gw', to: 'r1', privilege: 'admin' };
  d.associations.a12 = { kind: 'attached', from: 'gw', to: 'lan' };
  d.associations.a13 = { kind: 'attached', from: 'gw', to: 'srv' };
  assert.equal(step(d, 'way'), undefined);
  // A host that is on both is no router.
  delete d.associations.a11;
  assert.ok(step(d, 'way'));
});

test('4. over two routers; several far networks are counted; without a place for the scanner nothing is said', () => {
  const d = office();
  d.entities.mid = { kind: 'network', label: 'Transfer', addresses: ['172.16.0.0/30'] };
  d.entities.srv = { kind: 'network', label: 'Server LAN', addresses: ['10.0.2.0/24'] };
  d.entities.db = { kind: 'host', label: 'db', addresses: ['10.0.2.9'], seen: DAY, asked: { ports: DAY, products: DAY, connections: DAY } };
  d.entities.r1 = { kind: 'router', label: 'r1' };
  d.entities.r2 = { kind: 'router', label: 'r2' };
  d.associations.a8 = { kind: 'attached', from: 'db', to: 'srv' };
  d.associations.a9 = { kind: 'attached', from: 'r1', to: 'lan' };
  d.associations.a10 = { kind: 'attached', from: 'r1', to: 'mid' };
  d.associations.a11 = { kind: 'attached', from: 'r2', to: 'mid' };
  assert.equal(step(d, 'way').says, 'No way drawn to Server LAN · nmap');
  d.associations.a12 = { kind: 'attached', from: 'r2', to: 'srv' };
  assert.equal(step(d, 'way'), undefined);
  delete d.associations.a12;
  d.entities.dmz = { kind: 'network', label: 'DMZ', addresses: ['10.0.3.0/24'] };
  d.entities.www = { kind: 'host', label: 'www', addresses: ['10.0.3.9'], seen: DAY, asked: { ports: DAY, products: DAY, connections: DAY } };
  assert.equal(step(d, 'way').says, 'No way drawn to 2 networks · nmap');
  assert.deepEqual(step(d, 'way').targets.hosts, ['db'], 'the first of them');
  delete d.associations.a3;
  assert.equal(step(d, 'way'), undefined, 'nmap on no host');
  // Another scanner's host stands in where nmap has none.
  d.entities.nuclei = { kind: 'application', label: 'nuclei', tool: 'nuclei' };
  d.associations.a14 = { kind: 'hosts', from: 'web', to: 'nuclei', privilege: 'user' };
  assert.ok(step(d, 'way'));
});

test('5. hosts with services the templates never asked: nuclei, both of effractor\'s', () => {
  const d = office();
  delete d.entities.web.asked.connections;
  assert.deepEqual(step(d, 'connect'), { id: 'connect', tool: 'nuclei', count: 1, says: '1 host not asked how they connect · nuclei', purposes: ['identify', 'connect'], adjust: null, targets: { kind: 'selection', networks: [], hosts: ['web'] } });
  // A host with nothing running has nothing to connect.
  d.entities.p1 = { kind: 'host', label: 'printer', addresses: ['10.0.1.20'], seen: DAY, asked: { ports: DAY } };
  assert.equal(step(d, 'connect').count, 1);
});

test('the steps stand in their order, and what is silenced is left out', () => {
  const d = empty();
  d.entities = {
    lan: { kind: 'network', label: 'Office LAN', addresses: ['10.0.1.0/24'] },
    srv: { kind: 'network', label: 'Server LAN', addresses: ['10.0.2.0/24'] },
    pc: { kind: 'host', label: 'pc', addresses: ['10.0.1.5'] },
    db: { kind: 'host', label: 'db', addresses: ['10.0.2.9'] },
    ssh: { kind: 'service', label: 'ssh' },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'pc', to: 'lan' },
    a2: { kind: 'hosts', from: 'pc', to: 'nmap', privilege: 'user' },
    a3: { kind: 'hosts', from: 'db', to: 'ssh', privilege: 'unknown' },
  };
  assert.deepEqual(says(d), [
    '2 networks not scanned · nmap',
    '2 hosts not asked what runs there · nmap',
    'No way drawn to Server LAN · nmap',
    '1 host not asked how they connect · nuclei',
  ]);
  assert.deepEqual(says(d, ['network', 'way']), ['2 hosts not asked what runs there · nmap', '1 host not asked how they connect · nuclei']);
  assert.deepEqual(says(d, G.IDS), []);
  assert.deepEqual(says(d, ['nope', null]), says(d));
  delete d.entities.nmap;
  delete d.associations.a2;
  assert.equal(says(d)[0], 'Scan a network with nmap');
  assert.deepEqual(G.steps(d).map(s => s.id), ['scanner', 'network', 'runs', 'connect']);
});

test('every purpose, block and choice a step names is one the tools have', () => {
  const N = require('../assets/js/nmap-command.js');
  const Nu = require('../assets/js/nuclei.js');
  const d = empty();
  d.entities = {
    lan: { kind: 'network', label: 'Office LAN', addresses: ['10.0.1.0/24'] },
    srv: { kind: 'network', label: 'Server LAN', addresses: ['10.0.2.0/24'] },
    pc: { kind: 'host', label: 'pc', addresses: ['10.0.1.5'] },
    db: { kind: 'host', label: 'db', addresses: ['10.0.2.9'] },
    ssh: { kind: 'service', label: 'ssh' },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
  };
  d.associations = { a1: { kind: 'attached', from: 'pc', to: 'lan' }, a2: { kind: 'hosts', from: 'pc', to: 'nmap', privilege: 'user' }, a3: { kind: 'hosts', from: 'db', to: 'ssh', privilege: 'unknown' } };
  d.flows = { f1: { label: 'ssh on db', source: 'nmap', target: 'ssh', route: [], protocol: 'tcp/22' } };
  const all = G.steps(d);
  assert.equal(all.length, 4);
  for (const s of all) {
    const words = T.words(d, s.targets, s.tool === 'nuclei');
    assert.ok(words.text, s.id + ' is aimed at something');
    const of = s.tool === 'nuclei' ? Nu : N;
    for (const id of s.purposes) assert.ok(of.RECIPES.some(r => r.id === id), s.id + ': ' + id);
    const c = of.command(s.purposes, s.adjust || {}, words.text, { doc: d, asDrawn: T.drawnPorts(d, words.text) });
    assert.ok(c.text, s.id + ': ' + c.problem);
  }
  // The ports as drawn, where every host of the step has some.
  delete d.entities.pc;
  const runs = G.steps(d).filter(s => s.id === 'runs')[0];
  assert.deepEqual(runs.adjust, { ports: 'drawn' });
  assert.equal(N.command(runs.purposes, runs.adjust, '10.0.2.9', { asDrawn: T.drawnPorts(d, '10.0.2.9') }).text, 'nmap -sT -p 22 -sV -oX - 10.0.2.9');
});

test('what was silenced, as the browser keeps it', () => {
  assert.deepEqual(G.silenced('["runs","way"]', null), ['runs', 'way']);
  assert.deepEqual(G.silenced(null, 'dismissed'), ['scanner'], 'the key written before silenced the first step');
  assert.deepEqual(G.silenced('["scanner","runs"]', 'dismissed'), ['scanner', 'runs']);
  assert.deepEqual(G.silenced('["runs","runs","nope",3,null]', null), ['runs']);
  for (const odd of ['', 'x', '{}', '"runs"', '[', null, undefined]) assert.deepEqual(G.silenced(odd, null), [], String(odd));
  assert.deepEqual(G.silenced(null, 'other'), []);
});

test('2. the scanner at an address the range holds is on it; a wide network gives masscan its IPv4 ranges only', () => {
  const d = office();
  d.entities.srv = { kind: 'network', label: 'Server LAN', addresses: ['10.0.2.0/24'] };
  delete d.entities.pc.seen;
  d.entities.pc.addresses = ['10.0.1.5', '10.0.2.5'];
  assert.deepEqual(step(d, 'network').purposes, ['lan', 'services']);
  delete d.entities.srv;
  d.entities.campus = { kind: 'network', label: 'Campus', addresses: ['10.8.0.0/16', 'fd00::/64'] };
  const s = step(d, 'network');
  assert.equal(s.tool, 'masscan');
  assert.equal(T.words(d, s.targets).text, '10.8.0.0/16');
});

test('4. a network without a range, with hosts on it, is a network a way may lack', () => {
  const d = office();
  d.entities.dmz = { kind: 'network', label: 'DMZ' };
  d.entities.www = { kind: 'host', label: 'www', addresses: ['192.0.2.9'], seen: DAY, asked: { ports: DAY, products: DAY, connections: DAY } };
  d.associations.a8 = { kind: 'attached', from: 'www', to: 'dmz' };
  assert.equal(step(d, 'way').says, 'No way drawn to DMZ · nmap');
  assert.equal(step(d, 'network'), undefined, 'nothing to scan whole');
});

test('5. a host nuclei can reach by its name is asked how it connects', () => {
  const d = office();
  d.entities.app = { kind: 'host', label: 'app.lab' };
  d.entities.api = { kind: 'service', label: 'https' };
  d.associations.a8 = { kind: 'hosts', from: 'app', to: 'api', privilege: 'unknown' };
  assert.deepEqual(step(d, 'connect').targets.hosts, ['app']);
  assert.equal(T.words(d, step(d, 'connect').targets, true).text, 'app.lab');
  assert.equal(step(d, 'runs'), undefined, 'nmap is given addresses only');
});

test('a thousand hosts are answered at once: the bulb is asked on every change', () => {
  const d = office();
  d.entities.big = { kind: 'network', label: 'Big', addresses: ['10.50.0.0/16'] };
  for (let i = 0; i < 1000; i++) {
    const h = 'h' + i;
    d.entities[h] = { kind: 'host', label: h, addresses: ['10.50.' + (i >> 8) + '.' + (i & 255)], seen: DAY };
    d.associations['at' + i] = { kind: 'attached', from: h, to: 'big' };
    for (let j = 0; j < 3; j++) {
      d.entities[h + 's' + j] = { kind: 'service', label: 's' + j };
      d.entities[h + 'p' + j] = { kind: 'product', label: 'unidentified s' + j + ' on ' + h };
      d.associations[h + 'h' + j] = { kind: 'hosts', from: h, to: h + 's' + j, privilege: 'unknown' };
      d.associations[h + 'i' + j] = { kind: 'instance-of', from: h + 's' + j, to: h + 'p' + j };
    }
  }
  const t = Date.now();
  const all = G.steps(d);
  assert.ok(Date.now() - t < 300, (Date.now() - t) + ' ms');
  assert.equal(all.filter(s => s.id === 'runs')[0].count, 1000);
});
