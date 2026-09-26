const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const share = require('../assets/js/share.js');
const { gzipSync, gunzipSync } = require('node:zlib');
const { readFileSync, readdirSync } = require('node:fs');
const { randomBytes } = require('node:crypto');

function fragment(bytes) { return '#tree=v1.' + gzipSync(bytes).toString('base64url'); }

test('self-contained links preserve Unicode YAML in a versioned fragment at the app base', async () => {
  const text = 'name: Café 🔒\ndescription: "# ? & / +"\nnodes: {}\n';
  const link = new URL(await share.inlineLink(text, 'https://example.test/effractor/?samples=3#old'));
  assert.equal(link.origin + link.pathname, 'https://example.test/effractor/');
  assert.equal(link.search, '');
  assert.match(link.hash, /^#tree=v1\.[A-Za-z0-9_-]+$/);
  assert.equal(gunzipSync(Buffer.from(link.hash.slice(9), 'base64url')).toString('utf8'), text);
  assert.equal(await share.inlineText(link.hash), text);
});

test('every template and course file fits a self-contained link and round-trips exactly', async () => {
  const files = ['assets/templates', 'docs/course'].flatMap(dir =>
    readdirSync(dir).filter(name => name.endsWith('.yaml')).map(name => dir + '/' + name));
  for (const name of files) {
    const yaml = readFileSync(name, 'utf8');
    const link = await share.inlineLink(yaml, 'https://overcuriousity.github.io/effractor/');
    assert.ok(link.length <= 8192, name);
    assert.equal(await share.inlineText(new URL(link).hash), yaml, name);
  }
});

test('self-contained decoding ignores unrelated fragments and rejects unsupported versions', async () => {
  for (const hash of ['', '#help', '#' + 'A'.repeat(43)]) assert.equal(await share.inlineText(hash), null);
  await assert.rejects(share.inlineText('#tree=v2.abc'), /unsupported.*version/);
});

test('self-contained decoding rejects malformed base64, gzip, and UTF-8', async () => {
  const good = fragment('name: intact\n');
  const corrupt = gzipSync('name: intact\n'); corrupt[corrupt.length - 8] ^= 1;
  for (const hash of ['#tree=', '#tree=v1.', good + '=', good.slice(0, -4), '#tree=v1.YWJj',
    '#tree=v1.' + corrupt.toString('base64url'), fragment(Buffer.from([0xff]))]) {
    await assert.rejects(share.inlineText(hash), /incomplete or corrupted/, hash);
  }
});

test('self-contained links bound input bytes, URL length, and decompressed bytes', async () => {
  await assert.rejects(share.inlineLink('é'.repeat(524289), 'https://example.test/'), /too large/);
  await assert.rejects(share.inlineLink(randomBytes(10000).toString('hex'), 'https://example.test/'), /too long.*YAML/);
  await assert.rejects(share.inlineLink('a', 'https://example.test/' + 'a'.repeat(8192)), /too long/);
  await assert.rejects(share.inlineText('#tree=v1.' + 'a'.repeat(8192)), /too long/);
  await assert.rejects(share.inlineText(fragment('a'.repeat(1048577))), /too large/);
  assert.equal((await share.inlineText(fragment('a'.repeat(1048576)))).length, 1048576);
});

test('encrypted snapshots round-trip Unicode with independent keys and nonces', async () => {
  const text = 'name: Café 🔒\nnodes: {}\n';
  const a = await share.encrypt(text, webcrypto);
  const b = await share.encrypt(text, webcrypto);
  assert.match(a.key, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.key, b.key);
  assert.notDeepEqual(a.blob, b.blob);
  assert.equal(await share.decrypt(a.blob, a.key, webcrypto), text);
  assert.equal(Buffer.from(a.blob).includes(Buffer.from(text)), false);
});

test('wrong keys, altered blobs and incomplete links cannot decrypt', async () => {
  const a = await share.encrypt('secret', webcrypto);
  const b = await share.encrypt('other', webcrypto);
  await assert.rejects(share.decrypt(a.blob, b.key, webcrypto), /incomplete or corrupted/);
  const bad = new Uint8Array(a.blob); bad[bad.length - 1] ^= 1;
  await assert.rejects(share.decrypt(bad, a.key, webcrypto), /incomplete or corrupted/);
  for (const key of ['', 'abc', a.key + '=']) {
    await assert.rejects(share.decrypt(a.blob, key, webcrypto), /incomplete or corrupted/);
  }
});

test('share links keep keys in the fragment and reject invalid ids', () => {
  const id = 'a'.repeat(22), key = 'A'.repeat(43);
  assert.equal(share.link('https://example.test/', id, key), `https://example.test/s/${id}#${key}`);
  assert.equal(share.shareId('/s/' + id), id);
  assert.equal(share.shareId('/'), null);
  assert.throws(() => share.shareId('/s/../oops'), /incomplete or corrupted/);
});

test('under a path prefix, links and ids are found below it', () => {
  const id = 'a'.repeat(22), key = 'A'.repeat(43);
  assert.equal(share.link('https://example.org/effractor/', id, key), `https://example.org/effractor/s/${id}#${key}`);
  assert.equal(share.shareId('/effractor/s/' + id, '/effractor/'), id);
  assert.equal(share.shareId('/effractor/', '/effractor/'), null);
  assert.equal(share.shareId('/s/' + id, '/effractor/'), null);
});

test('the create path is relative to the page base', () => {
  assert.equal(share.createPath('30d'), 'api/share?ttl=30d');
});

test('expiry choices stop at the server cap and start at 90 days or the cap', () => {
  const values = (max) => share.ttlChoices(max).options.map((o) => o[0]);
  assert.deepEqual(values('1y'), ['1d', '30d', '90d', '1y']);
  assert.deepEqual(values('never'), ['1d', '30d', '90d', '1y', 'never']);
  assert.deepEqual(values('30d'), ['1d', '30d']);
  assert.equal(share.ttlChoices('1y').value, '90d');
  assert.equal(share.ttlChoices('30d').value, '30d');
  assert.equal(share.ttlChoices('1d').value, '1d');
  // An unknown cap (an older page) offers what every server allows.
  assert.deepEqual(values(undefined), ['1d']);
});

test('opening detaches from the immutable link only after successful adoption', async () => {
  let detached = false;
  await share.adoptLocal('yaml', async () => false, () => { detached = true; });
  assert.equal(detached, false);
  await share.adoptLocal('yaml', async text => text === 'yaml', () => { detached = true; });
  assert.equal(detached, true);
});

test('deletion can be undone during grace, never after the request starts', async () => {
  let trigger, removed = 0, resolve;
  const removal = new Promise(r => { resolve = r; });
  const deletion = share.deferredDelete(() => { removed++; return removal; }, cb => { trigger = cb; return 1; }, () => {});
  assert.equal(deletion.undo(), true);
  await trigger();
  assert.equal(removed, 0);
  const second = share.deferredDelete(() => { removed++; return removal; }, cb => { trigger = cb; return 2; }, () => {});
  const running = trigger();
  assert.equal(second.undo(), false);
  assert.equal(removed, 1);
  resolve(); await running;
});

test('a share past its expiry says so; one without says that', () => {
  const now = Date.UTC(2026, 8, 25);
  assert.equal(share.expiry(null, now), 'No expiry');
  assert.match(share.expiry(now / 1000 - 60, now), /^Expired · /);
  assert.doesNotMatch(share.expiry(now / 1000 + 60, now), /Expired/);
});
