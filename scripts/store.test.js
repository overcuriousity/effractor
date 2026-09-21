const { test } = require("node:test");
const assert = require("node:assert");
const { createStore, fileName } = require("../assets/js/store.js");
const { fakeIndexedDB } = require("./fixtures/fake-idb.js");

test("the working text survives: saved, loaded, replaced, cleared", async () => {
  const idb = fakeIndexedDB();
  const store = createStore(idb);
  assert.equal(await store.load(), null, "nothing yet");
  await store.save("effractor: 1\n");
  assert.equal(await store.load(), "effractor: 1\n");
  await store.save("effractor: 1\nname: Two\n");
  // A second page over the same database sees what the first one left.
  assert.equal(await createStore(idb).load(), "effractor: 1\nname: Two\n");
  await store.clear();
  assert.equal(await store.load(), null);
});

test("without IndexedDB nothing is kept and nothing fails", async () => {
  for (const idb of [undefined, fakeIndexedDB({ refuses: true })]) {
    const store = createStore(idb);
    await store.save("text");
    assert.equal(await store.load(), null);
    await store.clear();
  }
});

test("a document's name becomes a file name a file system will take", () => {
  assert.equal(fileName("Web server unavailable"), "web-server-unavailable.yaml");
  assert.equal(fileName("Büro: Zugriff / Fileserver"), "buero-zugriff-fileserver.yaml");
  assert.equal(fileName("../../etc/passwd"), "etc-passwd.yaml");
  assert.equal(fileName(""), "untitled.yaml");
  assert.equal(fileName(undefined), "untitled.yaml");
  assert.ok(fileName("x".repeat(500)).length <= 65);
});

test("upgrading a working database preserves text and persists independent share records", async () => {
  const idb = fakeIndexedDB({ version: 1, working: 'my existing document' });
  const store = createStore(idb);
  assert.equal(await store.load(), 'my existing document');
  const a = { id: 'a', delete_token: 'token-a', expires_at: null, url: '/s/a#key', name: 'A' };
  const b = { id: 'b', delete_token: 'token-b', expires_at: 123, url: '/s/b#key', name: 'B' };
  assert.equal(await store.saveShare(a), true);
  assert.equal(await store.saveShare(b), true);
  assert.deepEqual(await createStore(idb).shares(), [a, b]);
  assert.equal(await store.removeShare('a'), true);
  assert.deepEqual(await store.shares(), [b]);
  assert.equal(await store.load(), 'my existing document');
});

test("share storage reports refused or aborted writes instead of losing deletion tokens silently", async () => {
  for (const idb of [undefined, fakeIndexedDB({ refuses: true }), fakeIndexedDB({ abort: true })]) {
    const store = createStore(idb);
    assert.equal(await store.saveShare({ id: 'a', delete_token: 'token' }), false);
  }
});
