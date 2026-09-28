const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/js/nmap-products.js');

// One comparison of products for every scanner (nuclei templates spec §7.3).
test('a product is its name and the first word of its version, whatever their case', () => {
  assert.deepEqual(P.parts('OpenSSH 9.6p1 Ubuntu 3ubuntu13.5'), { name: 'openssh', version: '9.6p1' });
  assert.deepEqual(P.parts('  Apache   httpd 2.4.57 ((Debian)) '), { name: 'apache httpd', version: '2.4.57' });
  assert.deepEqual(P.parts('Microsoft IIS httpd 10.0'), { name: 'microsoft iis httpd', version: '10.0' });
  assert.deepEqual(P.parts('nginx'), { name: 'nginx', version: null });
  assert.deepEqual(P.parts('Dovecot imapd'), { name: 'dovecot imapd', version: null });
  assert.deepEqual(P.parts('Gitea v1.21.4'), { name: 'gitea', version: '1.21.4' });
  assert.deepEqual(P.parts('3Com switch'), { name: '3com switch', version: null }, 'a first word is a name, whatever it begins with');
  assert.deepEqual(P.parts('unidentified ssh on 10.0.1.7'), { name: 'unidentified ssh on 10.0.1.7', version: null }, 'what nobody named has no version');
  assert.deepEqual(P.parts(null), { name: '', version: null });
  assert.equal(P.key('OpenSSH 9.6p1 Ubuntu 3ubuntu13.5'), 'openssh 9.6p1');
  assert.equal(P.key('nginx'), 'nginx');
});

test('the same product, and one that says more of another', () => {
  assert.equal(P.same('OpenSSH 9.6p1 Ubuntu 3ubuntu13.5', 'openssh 9.6p1'), true);
  assert.equal(P.same('OpenSSH 9.6p1', 'OpenSSH 9.7p1'), false);
  assert.equal(P.same('nginx', 'nginx 1.24.0'), false);
  assert.equal(P.same('unidentified ssh on Server', 'unidentified ssh on Server'), true);
  assert.equal(P.same('unidentified ssh on A', 'unidentified ssh on B'), false);
  assert.equal(P.lacks('unidentified ftp on Server', 'vsftpd 3.0.5'), true);
  assert.equal(P.lacks('unidentified ftp on Server', 'unidentified ftp on Server'), false);
  assert.equal(P.lacks('nginx', 'nginx 1.24.0'), true, 'the name, and no version');
  assert.equal(P.lacks('nginx', 'Apache httpd 2.4.57'), false);
  assert.equal(P.lacks('nginx 1.24.0', 'nginx 1.25.3'), false, 'another version is a difference, not a lack');
  assert.equal(P.lacks('nginx', 'nginx'), false);
  assert.equal(P.unidentified('Unidentified ssh on Server'), true);
  assert.equal(P.unidentified('OpenSSH'), false);
});

// The plan and the changes compare by it (nmap-plan.js, nmap-changes.js).
const fs = require('node:fs');
const N = require('../assets/js/nmap.js');
const E = require('../assets/js/architecture-edit.js');
const catalog = JSON.parse(fs.readFileSync('scripts/fixtures/catalog.json', 'utf8'));
const specOf = kind => catalog.entities.filter(e => e.kind === kind)[0];
const day1 = () => N.read(fs.readFileSync('scripts/fixtures/nmap/day1.xml', 'utf8')).scan;
const imported = doc => {
  const p = N.plan(doc, 'nmap', day1(), '', {});
  return N.apply(doc, p, N.defaults(p), specOf, N.stampFor(day1(), '', day1().date)).doc;
};
const products = (doc, key) => Object.values(doc.entities).filter(e => e.kind === 'product' && P.key(e.label) === key);

test('a drawn product that says more after its version is the scanned one: no other version, no second product', () => {
  const doc = imported(N.addNmap(E.empty(), null, 'nmap', specOf).doc);
  const [drawn] = products(doc, 'openssh 8.9p1');
  assert.equal(drawn.label, 'OpenSSH 8.9p1');
  drawn.label = 'openssh 8.9p1 Ubuntu 3ubuntu0.6';
  const p = N.plan(doc, 'nmap', day1(), '', {});
  assert.deepEqual(p.changes.list.filter(c => c.kind === 'version').map(c => c.line), []);
  // A drawing that holds the product and no host: the services drawn take it.
  const bare = N.addNmap(E.empty(), null, 'nmap', specOf).doc;
  bare.entities.known = { kind: 'product', label: 'openssh 8.9p1 Ubuntu 3ubuntu0.6', parameters: drawn.parameters, defenses: drawn.defenses };
  const q = N.plan(bare, 'nmap', day1(), '', {});
  const s = N.summary(bare, q, N.defaults(q), null);
  const out = imported(bare);
  assert.equal(products(out, 'openssh 8.9p1').length, 1);
  assert.equal(Object.values(out.associations).filter(a => a.kind === 'instance-of' && a.to === 'known').length, 2, 'both ssh services run the drawn product');
  assert.equal(s.products, Object.values(out.entities).filter(e => e.kind === 'product').length - 1, 'and it is not counted as new');
});
