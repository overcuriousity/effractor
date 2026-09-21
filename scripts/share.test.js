const { test } = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const share = require('../assets/js/share.js');

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
  assert.equal(share.link('https://example.test', id, key), `https://example.test/s/${id}#${key}`);
  assert.equal(share.shareId('/s/' + id), id);
  assert.equal(share.shareId('/'), null);
  assert.throws(() => share.shareId('/s/../oops'), /incomplete or corrupted/);
});

test('the default TTL lets the server apply its cap', () => {
  assert.equal(share.createPath('default'), '/api/share');
  assert.equal(share.createPath('30d'), '/api/share?ttl=30d');
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
