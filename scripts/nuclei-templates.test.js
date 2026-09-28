const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const T = require('../assets/js/nuclei-templates.js');

// effractor's own nuclei templates (nuclei templates spec §2): the table of
// what they answer, and their text written from it.
const texts = () => T.TEMPLATES.map(t => [t.id, T.text(t.id)]);

test('five templates, in two groups', () => {
  assert.deepEqual(T.TEMPLATES.map(t => [t.id, t.group, t.protocol]), [
    ['effractor-banner', 'identify', 'tcp'],
    ['effractor-web', 'identify', 'http'],
    ['effractor-certificate', 'identify', 'ssl'],
    ['effractor-login', 'connect', 'http'],
    ['effractor-points-to', 'connect', 'dns'],
  ]);
  assert.equal(T.text('nope'), null);
});

test('spec §2.1: no backslash, no single quote, printable ASCII; they only read', () => {
  for (const [id, text] of texts()) {
    assert.doesNotMatch(text, /[\\']/, id);
    assert.doesNotMatch(text, /[^\n\x20-\x7e]/, id);
    assert.ok(text.endsWith('\n') && !text.endsWith('\n\n'), id);
    assert.ok(text.startsWith('id: ' + id + '\ninfo:\n  name: '), id);
    assert.match(text, /\n  author: effractor\n  severity: info\n(tcp|http|ssl|dns):\n/, id);
    assert.equal((text.match(/^(tcp|http|ssl|dns|javascript|code|headless|file|workflows?|websocket|whois):/gm) || []).length, 1, id);
    assert.doesNotMatch(text, /interactsh|payloads?:|body:|raw:|fuzzing:|attack:|\{\{(?!BaseURL|Hostname|Host|Port|FQDN)[^}]*\}\}/, id);
    for (const m of text.match(/^\s+- method: .*$/gm) || []) assert.equal(m.trim(), '- method: GET', id);
    // A value that holds a double quote is a folded block; any other is quoted.
    for (const line of text.split('\n')) if (/^\s+- "/.test(line)) assert.match(line, /^\s+- "[^"]*"$/, id + ': ' + line);
  }
});

test('spec §2.1: every extractor is named, each name once, and the table knows each', () => {
  const names = T.ANSWERS.map(a => a.name);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
  for (const a of T.ANSWERS) {
    assert.match(a.name, /^[a-z][a-z0-9-]*$/, a.name);
    assert.ok(T.TEMPLATES.some(t => t.id === a.template), a.name);
    assert.equal(T.answer(a.name), a);
    assert.ok(['product', 'server', 'application', 'version', 'names', 'login', 'sso', 'address', 'alias', 'said'].includes(a.is), a.name);
    if (a.is === 'version') assert.equal((T.answer(a.of) || {}).is, 'application', a.name + ' of ' + a.of);
    if (a.is === 'product' || a.is === 'application') assert.ok(a.product && !/[0-9]$/.test(a.product), a.name);
    if (a.unless) assert.ok(T.answer(a.unless), a.name);
    const http = T.TEMPLATES.find(t => t.id === a.template).protocol === 'http';
    assert.equal(Array.isArray(a.paths) && a.paths.length > 0, http, a.name + ': paths are an http answer\'s');
    for (const p of T.pattern(a)) assert.ok(p instanceof RegExp, a.name);
  }
  for (const [id, text] of texts()) {
    const written = (text.match(/^        name: .*$/gm) || []).map(l => l.trim().slice(6));
    const mine = T.ANSWERS.filter(a => a.template === id).map(a => a.name);
    assert.deepEqual([...new Set(written)].sort(), mine.slice().sort(), id);
    assert.equal((text.match(/^      - type: /gm) || []).length, written.length, id + ': an extractor without a name');
  }
});

test('spec §5.3: the web template asks the root page and at most sixteen further paths', () => {
  const paths = [...new Set(T.ANSWERS.filter(a => a.paths).flatMap(a => a.paths))];
  assert.ok(paths.includes('/'));
  assert.ok(paths.length - 1 <= 16, paths.join(' '));
  for (const p of paths) assert.match(p, /^\/[0-9A-Za-z._\/?=+-]*$/, p);
  const web = T.text('effractor-web');
  assert.equal((web.match(/host-redirects: true\n    max-redirects: 3/g) || []).length, 1, 'redirects are followed from the root page, on the same host');
  assert.doesNotMatch(web, /\n    redirects: true/);
});

test('about fifty applications, the management pages and sign-ons among them marked', () => {
  const apps = T.ANSWERS.filter(a => a.is === 'application');
  assert.equal(apps.length, 49);
  assert.deepEqual(apps.filter(a => a.signs).map(a => a.name), ['keycloak', 'adfs']);
  assert.deepEqual(apps.filter(a => a.manages).map(a => a.name), ['fortigate', 'big-ip', 'sonicwall', 'vcenter', 'esxi', 'proxmox-ve', 'hpe-ilo', 'dell-idrac', 'synology-dsm', 'pfsense', 'opnsense', 'fritzbox', 'mikrotik-routeros', 'webmin', 'portainer']);
});

test('the files the page serves are what the table writes', () => {
  for (const [id, text] of texts()) assert.equal(fs.readFileSync('assets/nuclei/' + id + '.yaml', 'utf8'), text, id + ': run node scripts/dev/nuclei-templates-write.js');
  assert.deepEqual(fs.readdirSync('assets/nuclei').sort(), ['README.md'].concat(T.TEMPLATES.map(t => t.id + '.yaml')).sort());
});
