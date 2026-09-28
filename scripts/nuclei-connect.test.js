const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const Nu = require('../assets/js/nuclei.js');
const S = require('../assets/js/scanners.js');
const T = require('../assets/js/nuclei-templates.js');
const E = require('../assets/js/architecture-edit.js');

// How it connects (nuclei templates spec §6): logins, single sign-on,
// management pages and what a name points to. connect.jsonl is what nuclei
// 3.11.0 wrote against the lab of scripts/dev/nuclei-lab.py; it is read
// together with identify.jsonl, as one paste after both were run.
const CATALOG = require('./fixtures/catalog.json');
const specOf = kind => CATALOG.entities.filter(e => e.kind === kind)[0];
const fixture = name => fs.readFileSync('scripts/fixtures/nuclei/' + name + '.jsonl', 'utf8');
const lines = () => fixture('connect').trim().split('\n').map(l => JSON.parse(l));
const result = () => Nu.read(fixture('identify') + fixture('connect')).scan;
const STAMP = () => S.stampFor('nuclei', result(), '10.0.2.0/24', '2026-09-28');
const LAB = ['10.0.2.11', '10.0.2.12', '10.0.2.13', '10.0.2.14', '10.0.2.15', '10.0.2.16', '10.0.2.50', '10.0.2.60', '10.0.2.61'];
// The hosts the tests speak of, in that order, whatever else the lab holds.
const few = () => {
  const scan = result();
  scan.hosts = LAB.map(a => scan.hosts.find(h => h.addresses[0] === a));
  return scan;
};
function start() {
  const d = E.empty();
  d.entities = {
    lan: { kind: 'network', label: 'Lab network', addresses: ['10.0.2.0/24'] },
    box: { kind: 'host', label: 'Admin box', addresses: ['10.0.2.2'] },
    nmap: { kind: 'application', label: 'nmap', tool: 'nmap' },
    nuclei: { kind: 'application', label: 'nuclei', tool: 'nuclei' },
  };
  d.associations = {
    a1: { kind: 'attached', from: 'box', to: 'lan' },
    a2: { kind: 'hosts', from: 'box', to: 'nuclei', privilege: 'user' },
    a3: { kind: 'hosts', from: 'box', to: 'nmap', privilege: 'user' },
  };
  return d;
}
const all = p => {
  const t = N.defaults(p);
  for (const c of p.connections.list) if (c.can) t.connections[c.key] = true;
  return t;
};
const drawn = (d, t) => {
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  return N.apply(d, p, t ? t(p) : all(p), specOf, STAMP()).doc;
};
const id = (doc, label, kind) => Object.keys(doc.entities).find(k => doc.entities[k].label === label && (!kind || doc.entities[k].kind === kind));
const links = (doc, kind) => Object.values(doc.associations).filter(a => a.kind === kind);
const hostOf = (doc, x) => links(doc, 'hosts').find(a => a.to === x).from;
const accepted = (doc, account) => links(doc, 'authorizes').filter(a => a.from === id(doc, account, 'account')).map(a => doc.entities[a.to].label + ' on ' + doc.entities[hostOf(doc, a.to)].label).sort();

test('the fixture holds every answer of the connect templates that the lab can give', () => {
  const seen = new Set(lines().map(r => r['extractor-name']));
  const asked = T.ANSWERS.filter(a => T.TEMPLATES.find(t => t.id === a.template).group === 'connect').map(a => a.name);
  assert.deepEqual(asked.filter(n => !seen.has(n)), [], 'record again: python3 scripts/dev/nuclei-lab.py record connect');
  for (const r of lines()) assert.match(r['template-id'], /^effractor-(login|points-to)$/);
});

test('what is read: a login, where logins are sent, what a name points to', () => {
  const scan = result();
  const at = (a, n) => scan.hosts.find(h => h.addresses[0] === a).ports.find(p => p.port === n);
  assert.deepEqual(at('10.0.2.11', 443).login, { password: true, sso: null });
  assert.deepEqual(at('10.0.2.12', 443).login, { password: false, sso: { product: 'Keycloak', host: 'sso.corp.example' } });
  assert.deepEqual(at('10.0.2.61', 443).login, { password: false, sso: { product: 'Microsoft Entra ID', host: 'login.microsoftonline.com' } }, 'a link on the page names it as a redirect does');
  assert.equal(at('10.0.2.50', 443).login, undefined);
  assert.deepEqual(scan.points.filter(x => /^(grafana|metrics|wiki|pve1)\./.test(x.name)), [
    { name: 'grafana.corp.example', address: '10.0.2.50', alias: 'proxy.corp.example' },
    { name: 'metrics.corp.example', address: '10.0.2.11', alias: null },
    { name: 'pve1.corp.example', address: '203.0.113.7', alias: 'pve1.cdn.example.net' },
    { name: 'wiki.corp.example', address: '10.0.2.99', alias: null },
  ]);
  // Answers about names alone are a result too: they draw no host.
  const names = Nu.read(written(lines().filter(r => r.type === 'dns'))).scan;
  assert.deepEqual([names.hosts.length, names.points.length > 0], [0, true]);
});
const written = list => list.map(r => JSON.stringify(r)).join('\n') + '\n';

test('spec §6: every connection is offered unticked, but a name on the host it points to', () => {
  const d = start();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  assert.deepEqual(p.connections.list.map(c => [c.key, c.ticked, c.can, c.line, c.what]), [
    ['login:h0/tcp/443', false, true, 'Grafana on grafana.corp.example has a login', 'draws “Grafana accounts”, which it accepts'],
    ['sso:h1/tcp/443', false, true, 'https on wiki.corp.example sends its logins to Keycloak at sso.corp.example', 'draws “Keycloak accounts at sso.corp.example” and the host sso.corp.example'],
    ['administration:h2', false, true, 'Proxmox VE on pve1.corp.example is a management page', '“pve1.corp.example” is administered from “Lab network”'],
    ['admin-login:h2/tcp/8006', false, true, 'Proxmox VE on pve1.corp.example has a login', 'draws “Proxmox VE accounts”, admin on “pve1.corp.example”'],
    ['administration:h3', false, true, 'pfSense on fw.corp.example is a management page', '“fw.corp.example” is administered from “Lab network”'],
    ['admin-login:h3/tcp/443', false, true, 'pfSense on fw.corp.example has a login', 'draws “pfSense accounts”, admin on “fw.corp.example”'],
    ['login:h4/tcp/8080', false, true, 'Jenkins on 10.0.2.15 has a login', 'draws “Jenkins accounts”, which it accepts'],
    ['administration:h5', false, true, 'Webmin on 10.0.2.16 is a management page', '“10.0.2.16” is administered from “Lab network”'],
    ['admin-login:h5/tcp/10000', false, true, 'Webmin on 10.0.2.16 has a login', 'draws “Webmin accounts”, admin on “10.0.2.16”'],
    ['login:h7/tcp/8080', false, true, 'http-proxy on 10.0.2.60 has a login', 'draws “accounts of http-proxy on 10.0.2.60”, which it accepts'],
    ['sso:h8/tcp/443', false, true, 'https on portal.corp.example sends its logins to Microsoft Entra ID at login.microsoftonline.com', 'draws “Microsoft Entra ID accounts at login.microsoftonline.com” and the host login.microsoftonline.com'],
    ['name:grafana.corp.example', true, true, 'grafana.corp.example points to “proxy.corp.example” (10.0.2.50)', 'keeps the name on it'],
    ['pass-on:grafana.corp.example>h0', false, true, '“proxy.corp.example” stands in front of “grafana.corp.example” for grafana.corp.example?', 'draws the flow from it to grafana.corp.example on tcp/443'],
    ['host:wiki.corp.example', false, true, 'wiki.corp.example points to 10.0.2.99, which is not drawn', 'draws the host'],
  ]);
  assert.deepEqual(p.connections.notes, ['pve1.corp.example points outside, to pve1.cdn.example.net.']);
  const t = N.defaults(p);
  assert.deepEqual(Object.keys(t.connections).filter(k => t.connections[k]), ['name:grafana.corp.example']);
  // As offered: no account, no administration, no flow between hosts; the name is kept.
  const out = N.apply(d, p, t, specOf, STAMP()).doc;
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'account').length, 0);
  assert.equal(links(out, 'administration').length + links(out, 'authorizes').length + links(out, 'grants').length, 0);
  assert.deepEqual(out.entities[id(out, 'proxy.corp.example')].names, ['proxy.corp.example', 'grafana.corp.example']);
  assert.match(N.said(N.summary(d, p, t, null)), /, draws 1 connection\.$/);
});

test('spec §6.1: a login is a stand-in account the service accepts', () => {
  const out = drawn(start());
  assert.deepEqual(accepted(out, 'Grafana accounts'), ['Grafana on grafana.corp.example'], 'the application logs in, not the server in front of it');
  assert.deepEqual(accepted(out, 'Jenkins accounts'), ['Jenkins on 10.0.2.15']);
  assert.deepEqual(accepted(out, 'accounts of http-proxy on 10.0.2.60'), ['http-proxy on 10.0.2.60']);
  const account = out.entities[id(out, 'Grafana accounts')];
  assert.equal(account.kind, 'account');
  assert.equal(links(out, 'authenticates').length, 0, 'no credential: who logs in is the author\'s to say');
  assert.equal(links(out, 'grants').filter(a => a.from === id(out, 'Grafana accounts')).length, 0);
});

test('spec §6.2: one account per sign-on, accepted by it and by all who send their logins there; its host drawn', () => {
  const out = drawn(start());
  assert.deepEqual(accepted(out, 'Keycloak accounts at sso.corp.example'), ['https on sso.corp.example', 'https on wiki.corp.example']);
  const sso = out.entities[id(out, 'sso.corp.example', 'host')];
  assert.deepEqual([sso.addresses, sso.names], [undefined, ['sso.corp.example']], 'by its name, without an address: nothing was asked of it');
  const service = links(out, 'hosts').find(a => a.from === id(out, 'sso.corp.example', 'host')).to;
  assert.equal(out.entities[links(out, 'instance-of').find(a => a.from === service).to].label, 'Keycloak');
  assert.deepEqual(accepted(out, 'Microsoft Entra ID accounts at login.microsoftonline.com'), ['https on login.microsoftonline.com', 'https on portal.corp.example'], 'a sign-on outside is drawn the same way');
  assert.equal(id(out, 'accounts of https on wiki.corp.example'), undefined, 'no login of its own where the page holds no password field');

  // A second service of the same sign-on joins the account that is there.
  const scan = few();
  const wiki = scan.hosts.find(h => h.addresses[0] === '10.0.2.12');
  const other = JSON.parse(JSON.stringify(wiki));
  other.addresses = ['10.0.2.77'];
  other.names = [];
  scan.hosts = [other];
  scan.points = [];
  const p = N.plan(out, 'nuclei', scan, '10.0.2.0/24', {});
  assert.deepEqual(p.connections.list.map(c => [c.key, c.what]), [['sso:h0/tcp/443', 'joins “Keycloak accounts at sso.corp.example”']]);
  const more = N.apply(out, p, all(p), specOf, STAMP()).doc;
  assert.deepEqual(accepted(more, 'Keycloak accounts at sso.corp.example'), ['https on 10.0.2.77', 'https on sso.corp.example', 'https on wiki.corp.example']);
  assert.equal(Object.values(more.entities).filter(e => e.label === 'sso.corp.example').length, 1);
  assert.equal(Object.values(more.entities).filter(e => e.label === 'Keycloak accounts at sso.corp.example').length, 1);
});

test('spec §6.3: a management page is administered from the scanner\'s network; its login has admin rights there', () => {
  const out = drawn(start());
  const pve = id(out, 'pve1.corp.example', 'host');
  assert.deepEqual(links(out, 'administration').map(a => [a.from, out.entities[a.to].label]), [['lan', 'pve1.corp.example'], ['lan', 'fw.corp.example'], ['lan', '10.0.2.16']]);
  assert.deepEqual(links(out, 'grants').filter(a => a.from === id(out, 'Proxmox VE accounts')).map(a => [a.to, a.privilege]), [[pve, 'admin']]);
  assert.deepEqual(accepted(out, 'pfSense accounts'), ['pfSense on fw.corp.example']);
  assert.equal(id(out, 'Proxmox VE accounts on pve1.corp.example'), undefined);
  assert.equal(Object.values(out.entities).filter(e => e.kind === 'account' && /Proxmox/.test(e.label)).length, 1, 'it replaces the plain login of that service');

  // On a host that runs a router, the router is what is administered.
  const d = start();
  d.entities.fw = { kind: 'host', label: 'Firewall box', addresses: ['10.0.2.14'] };
  d.entities.rt = { kind: 'router', label: 'Firewall box router' };
  d.associations.r1 = { kind: 'hosts', from: 'fw', to: 'rt', privilege: 'admin' };
  d.associations.r2 = { kind: 'attached', from: 'fw', to: 'lan' };
  d.associations.r3 = { kind: 'attached', from: 'rt', to: 'lan' };
  const routed = drawn(d);
  assert.ok(links(routed, 'administration').some(a => a.from === 'lan' && a.to === 'rt'));
  assert.deepEqual(links(routed, 'grants').filter(a => a.from === id(routed, 'pfSense accounts')).map(a => [a.to, a.privilege]), [['rt', 'admin']]);

  // nuclei on no host: said, and not to be ticked.
  const nowhere = start();
  delete nowhere.associations.a2;
  const p = N.plan(nowhere, 'nuclei', few(), '10.0.2.0/24', {});
  const row = p.connections.list.find(c => c.key === 'administration:h2');
  assert.deepEqual([row.can, row.why], [false, 'Put nuclei on a host to say where from']);
  const t = all(p);
  t.connections[row.key] = true;
  assert.equal(links(N.apply(nowhere, p, t, specOf, STAMP()).doc, 'administration').length, 0);
});

test('spec §6.4: a name is kept on the host it points to; who stands in front is offered; outside is only said', () => {
  const out = drawn(start());
  const proxy = id(out, 'proxy.corp.example', 'host'), web = id(out, 'grafana.corp.example', 'host');
  assert.deepEqual(out.entities[proxy].names, ['proxy.corp.example', 'grafana.corp.example']);
  assert.deepEqual(out.entities[web].names, ['grafana.corp.example', 'metrics.corp.example'], 'the bearer keeps it too');
  const pass = Object.values(out.flows).find(f => f.protocol === 'tcp/443' && out.entities[f.source].kind === 'service');
  assert.deepEqual([hostOf(out, pass.source), hostOf(out, pass.target), pass.route, pass.label], [proxy, web, ['lan'], 'https on grafana.corp.example behind proxy.corp.example']);
  const fresh = out.entities[id(out, '10.0.2.99', 'host')];
  assert.deepEqual([fresh.addresses, fresh.names], [['10.0.2.99'], ['wiki.corp.example']]);
  assert.equal(Object.values(out.entities).some(e => (e.addresses || []).includes('203.0.113.7') || /cdn\.example\.net/.test(e.label)), false, 'what is outside is never drawn');
});

test('review focus 5: again, nothing is offered and nothing drawn twice', () => {
  const out = drawn(start());
  const again = N.plan(out, 'nuclei', few(), '10.0.2.0/24', {});
  assert.deepEqual(again.connections.list, []);
  assert.deepEqual(again.connections.notes, ['pve1.corp.example points outside, to pve1.cdn.example.net.']);
  assert.equal(N.apply(out, again, all(again), specOf, STAMP()), null);
  // A service that already accepts an account of the author's is offered no login.
  const d = start();
  const first = drawn(d, p => N.defaults(p));
  const grafana = id(first, 'Grafana', 'service');
  first.entities.alice = { kind: 'account', label: 'Alice' };
  first.associations.z1 = { kind: 'authorizes', from: 'alice', to: grafana };
  const p = N.plan(first, 'nuclei', few(), '10.0.2.0/24', {});
  assert.equal(p.connections.list.some(c => c.key === 'login:h0/tcp/443'), false);
});

test('a connection whose port is left out is left out; another scanner\'s result offers none', () => {
  const d = start();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const t = all(p);
  N.tickHost(p.hosts[0], t, false);
  const out = N.apply(d, p, t, specOf, STAMP()).doc;
  assert.equal(id(out, 'Grafana accounts'), undefined);
  assert.equal(id(out, 'grafana.corp.example', 'host'), undefined);
  const scan = few();
  scan.tool = 'nmap';
  assert.deepEqual(N.plan(d, 'nuclei', scan, '10.0.2.0/24', {}).connections, { list: [], notes: [] });
});

test('the imported document is the one the Rust and wasm checks validate', () => {
  const d = start();
  const p = N.plan(d, 'nuclei', result(), '10.0.2.0/24', {});
  const out = N.apply(d, p, all(p), specOf, STAMP()).doc;
  const file = 'scripts/fixtures/nuclei/imported-connect.doc.json';
  const text = JSON.stringify(out, null, 2) + '\n';
  if (process.env.NMAP_FIXTURE === 'write') fs.writeFileSync(file, text);
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

// ---- from the reviews of the branch and of the dialog ----
const entitiesOf = doc => Object.keys(doc.entities).length;
const relationsOf = doc => Object.keys(doc.associations).length + Object.keys(doc.flows).length;
const only = (p, ...keys) => {
  const t = N.defaults(p);
  for (const k of Object.keys(t.connections)) t.connections[k] = keys.includes(k);
  return t;
};

test('review: a name that points is a DNS name and what it points to an address, or the answer is refused', () => {
  const dns = lines().find(r => r.type === 'dns' && r['extractor-name'] === 'address');
  const bad = (host, values) => Object.assign({}, dns, { host, 'matched-at': host, 'extracted-results': values });
  const scan = Nu.read(fixture('identify') + written([bad('<img src=x onerror=alert(1)>', ['10.0.2.50']), bad('Evil Name.example', ['10.0.2.50']), bad('1.2.3', ['10.0.2.50']), bad('ok.corp.example', ['010.000.002.095']), bad('fine.corp.example', ['10.0.2.50'])])).scan;
  assert.equal(scan.refused, 4);
  assert.deepEqual(scan.points, [{ name: 'fine.corp.example', address: '10.0.2.50', alias: null }]);
});

test('review: a sign-on that joins an account is applied, also where it is all there is', () => {
  const out = drawn(start());
  const wiki = links(out, 'hosts').find(a => a.from === id(out, 'wiki.corp.example', 'host') && out.entities[a.to].label === 'https').to;
  const account = id(out, 'Keycloak accounts at sso.corp.example', 'account');
  for (const k of Object.keys(out.associations)) if (out.associations[k].kind === 'authorizes' && out.associations[k].from === account && out.associations[k].to === wiki) delete out.associations[k];
  const p = N.plan(out, 'nuclei', few(), '10.0.2.0/24', {});
  assert.deepEqual(p.connections.list.map(c => [c.key, c.what]), [['sso:h1/tcp/443', 'joins “Keycloak accounts at sso.corp.example”']]);
  const t = only(p, 'sso:h1/tcp/443');
  t.seen = false;
  const s = N.summary(out, p, t, null);
  assert.deepEqual(s.connected, { entities: 0, relationships: 1, accounts: 0, hosts: 0, links: 1 });
  assert.equal(N.said(s), 'Draws 1 connection.');
  const more = N.apply(out, p, t, specOf, STAMP()).doc;
  assert.deepEqual(accepted(more, 'Keycloak accounts at sso.corp.example'), ['https on sso.corp.example', 'https on wiki.corp.example']);
});

test('review: what is counted of a connection is what is made of it, never less', () => {
  const docs = { empty: start(), 'the sign-on\'s host drawn without a service': Object.assign(start(), {}) };
  docs['the sign-on\'s host drawn without a service'].entities.idp = { kind: 'host', label: 'sso.corp.example' };
  for (const [name, d] of Object.entries(docs)) {
    const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
    const base = N.apply(d, p, only(p), specOf, STAMP()).doc;
    for (const c of p.connections.list.filter(c => c.can)) {
      const t = only(p, c.key);
      const counted = N.summary(d, p, t, null).connected;
      const out = N.apply(d, p, t, specOf, STAMP()).doc;
      const made = [entitiesOf(out) - entitiesOf(base), relationsOf(out) - relationsOf(base)];
      assert.ok(counted.entities >= made[0] && counted.relationships >= made[1], name + ', ' + c.key + ': counted ' + [counted.entities, counted.relationships] + ', made ' + made);
      if (c.kind !== 'pass-on') assert.deepEqual([counted.entities, counted.relationships], made, name + ', ' + c.key);
    }
  }
});

test('review: two names that point to one address nobody drew are one host', () => {
  const scan = few();
  scan.points.push({ name: 'one.example', address: '10.0.2.99', alias: null }, { name: 'two.example', address: '10.0.2.99', alias: null });
  const d = start();
  const p = N.plan(d, 'nuclei', scan, '10.0.2.0/24', {});
  assert.deepEqual(p.connections.list.filter(c => c.kind === 'host').map(c => [c.key, c.line, c.what]), [['host:wiki.corp.example', 'wiki.corp.example, one.example and two.example point to 10.0.2.99, which is not drawn', 'draws the host']]);
  const out = N.apply(d, p, all(p), specOf, STAMP()).doc;
  const there = Object.values(out.entities).filter(e => (e.addresses || []).includes('10.0.2.99'));
  assert.deepEqual(there.map(e => e.names), [['wiki.corp.example', 'one.example', 'two.example']]);
});

test('review: a login\'s account is its service\'s own: two machines of one product share none, an author\'s is not taken', () => {
  const scan = few();
  const twin = JSON.parse(JSON.stringify(scan.hosts.find(h => h.addresses[0] === '10.0.2.14')));
  twin.addresses = ['10.0.2.114'];
  twin.names = [{ name: 'fw2.corp.example', from: 'certificate', port: 443 }];
  twin.hostname = 'fw2.corp.example';
  scan.hosts.push(twin);
  const d = start();
  d.entities.payroll = { kind: 'service', label: 'Payroll' };
  d.entities.theirs = { kind: 'account', label: 'grafana accounts' };
  Object.assign(d.associations, { y1: { kind: 'hosts', from: 'box', to: 'payroll', privilege: 'unknown' }, y2: { kind: 'authorizes', from: 'theirs', to: 'payroll' } });
  const p = N.plan(d, 'nuclei', scan, '10.0.2.0/24', {});
  const what = key => p.connections.list.find(c => c.key === key).what;
  assert.equal(what('login:h0/tcp/443'), 'draws “Grafana accounts on grafana.corp.example”, which it accepts');
  assert.equal(what('admin-login:h3/tcp/443'), 'draws “pfSense accounts”, admin on “fw.corp.example”');
  assert.equal(what('admin-login:h9/tcp/443'), 'draws “pfSense accounts on fw2.corp.example”, admin on “fw2.corp.example”');
  const out = N.apply(d, p, all(p), specOf, STAMP()).doc;
  assert.deepEqual(accepted(out, 'grafana accounts'), ['Payroll on Admin box']);
  assert.deepEqual(accepted(out, 'pfSense accounts'), ['pfSense on fw.corp.example']);
  assert.deepEqual(accepted(out, 'pfSense accounts on fw2.corp.example'), ['pfSense on fw2.corp.example']);
  for (const label of ['pfSense accounts', 'pfSense accounts on fw2.corp.example']) assert.equal(links(out, 'grants').filter(a => a.from === id(out, label, 'account')).length, 1, label);
  // Again, nothing.
  assert.deepEqual(N.plan(out, 'nuclei', scan, '10.0.2.0/24', {}).connections.list, []);
});

test('review of the dialog: a connection whose host, port or application is left out is neither counted nor said', () => {
  const d = start();
  const p = N.plan(d, 'nuclei', few(), '10.0.2.0/24', {});
  const none = { entities: 0, relationships: 0, accounts: 0, hosts: 0, links: 0 };
  const left = (keys, change) => {
    const t = only(p, ...keys);
    change(t);
    const s = N.summary(d, p, t, null);
    const edit = N.apply(d, p, t, specOf, STAMP());
    return [s.connected, /draws/i.test(N.said(s)), edit && Object.values(edit.doc.entities).filter(e => e.kind === 'account').length];
  };
  const noHosts = t => { N.tickHosts(p, t, false); t.seen = false; };
  assert.deepEqual(left(['login:h0/tcp/443'], noHosts), [none, false, null], 'every host unticked: nothing to add');
  assert.deepEqual(left(['sso:h1/tcp/443', 'administration:h2', 'admin-login:h2/tcp/8006', 'pass-on:grafana.corp.example>h0', 'name:grafana.corp.example'], noHosts), [none, false, null]);
  assert.deepEqual(left(['login:h0/tcp/443'], t => { t.ports['h0/tcp/443'] = false; }), [none, false, 0], 'its port unticked');
  assert.deepEqual(left(['login:h0/tcp/443'], t => { t.applications['h0/tcp/443'] = false; }), [none, false, 0], 'its application unticked');
  assert.deepEqual(left(['pass-on:grafana.corp.example>h0'], t => { N.tickHost(p.hosts[0], t, false); }), [none, false, 0], 'the bearer unticked');
  assert.deepEqual(left(['login:h0/tcp/443'], () => {})[0], { entities: 1, relationships: 1, accounts: 1, hosts: 0, links: 0 });
  // What the page asks: whether a row hangs on something that is left out.
  const t = only(p, 'login:h0/tcp/443');
  const row = p.connections.list.find(c => c.key === 'login:h0/tcp/443');
  assert.equal(N.connectionThere(p, t, row), true);
  t.applications['h0/tcp/443'] = false;
  assert.equal(N.connectionThere(p, t, row), false);
});

test('review: connections are read the same whatever the order of the answers', () => {
  const recs = (fixture('identify') + fixture('connect')).trim().split('\n').map(l => JSON.parse(l));
  const logins = scan => scan.hosts.map(h => [h.addresses[0], h.ports.map(p => [p.port, p.login])]).sort((a, b) => a[0] < b[0] ? -1 : 1);
  const as = logins(Nu.read(written(recs)).scan);
  assert.deepEqual(logins(Nu.read(written(recs.slice().reverse())).scan), as);
  assert.deepEqual(Nu.read(written(recs.slice().reverse())).scan.points.slice().sort((a, b) => a.name < b.name ? -1 : 1), Nu.read(written(recs)).scan.points);
});

// ---- what a host was asked (scan workflow spec §3) ----

test('nuclei says what it found, not what it asked: the ticked templates and the targets stand in', () => {
  const scan = Nu.asking(few(), ['identify', 'connect'], '10.0.2.0/24');
  assert.deepEqual(scan.asks, ['products', 'connections']);
  assert.equal(scan.covers, '10.0.2.0/24');
  assert.deepEqual(Nu.asking(few(), ['connect', 'connect'], '10.0.2.11').asks, ['connections']);
  // nuclei's own checks ask nothing the drawing notes.
  assert.deepEqual(Nu.asking(few(), ['cves', 'tls'], '10.0.2.0/24').asks, []);
  assert.equal(Nu.asking(few(), ['cves'], '10.0.2.0/24').covers, '');
  assert.deepEqual(Nu.asking(few(), null, null).asks, []);
  // A result without one answer of effractor's templates is another run's.
  const other = few();
  other.answers = 0;
  assert.deepEqual(Nu.asking(other, ['identify', 'connect'], '10.0.2.0/24').asks, []);
});

test('an import of the templates notes every drawn host the targets held, answered or not', () => {
  const d = start();
  d.entities.quiet = { kind: 'host', label: 'quiet', addresses: ['10.0.2.200'] };
  d.entities.far = { kind: 'host', label: 'far', addresses: ['10.0.9.1'] };
  const scan = Nu.asking(few(), ['identify', 'connect'], '10.0.2.0/24');
  const p = N.plan(d, 'nuclei', scan, '10.0.2.0/24', {}, '2026-09-28');
  assert.deepEqual(p.asked.keys, ['products', 'connections']);
  assert.ok(p.asked.day);
  assert.deepEqual(p.asked.also, ['box', 'quiet'], 'drawn, held by the targets, without an answer');
  const out = N.apply(d, p, N.defaults(p), specOf, STAMP()).doc;
  const want = { products: p.asked.day, connections: p.asked.day };
  assert.deepEqual(out.entities.quiet.asked, want);
  assert.deepEqual(out.entities.box.asked, want);
  assert.equal(out.entities.far.asked, undefined, 'outside the targets');
  const answered = Object.keys(out.entities).filter(id => (out.entities[id].addresses || []).includes('10.0.2.11'))[0];
  assert.deepEqual(out.entities[answered].asked, want);
  // Again: nobody is left to note.
  assert.deepEqual(N.plan(out, 'nuclei', scan, '10.0.2.0/24', {}, '2026-09-28').asked.also, []);
});
