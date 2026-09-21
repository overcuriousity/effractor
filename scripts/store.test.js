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
