// sync.js's rename of a document bound in another mode: it is opened there
// first, and when that fails the rename says so once instead of trying again
// for ever. sync.js is page wiring, so it runs here on the least of a page.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const JS = path.join(__dirname, "../assets/js/");

function page(answer) {
  const el = () => ({ hidden: false, textContent: "", title: "", classList: { toggle() {} }, addEventListener() {}, click() {} });
  const els = {};
  const said = [];
  let requests = 0, over = false;
  // Bound in the attack-tree mode; the page shows the fault-tree mode.
  const store = {
    binding: async (p) => (p === "attack-tree" ? { user: 1, id: 5, base: 1, saved: "s", text: "s" } : null),
    bind: async () => {},
  };
  const window = {
    addEventListener() {},
    indexedDB: null,
    effractorStore: { createStore: () => store, fileName: (n) => n },
    effractor: {
      state: { text: "fault-tree text", doc: { profile: "fault-tree", name: "X" } },
      onText() {}, ready: Promise.resolve(), say: (t) => said.push(t),
      replaceDocument: async () => true, adoptSource: async () => [],
      solver: { parse: async () => ({ ok: {} }), serialize: async () => ({ ok: "t" }) },
    },
  };
  const document = { getElementById: (id) => els[id] || (els[id] = el()), querySelector: () => el() };
  window.effractorAccounts = {
    // After the test nothing answers, so a loop cannot outlive it.
    client: { request: () => { requests++; return new Promise((r) => { if (!over) setTimeout(() => r(answer), 1); }); } },
    documents: require(JS + "accounts/documents.js"),
    session: { user: null, onChange() {} },
  };
  const ctx = vm.createContext({ window, document, setTimeout, clearTimeout, Promise, URL });
  for (const f of ["accounts/autosave.js", "accounts/sync-core.js", "accounts/sync.js"]) {
    vm.runInContext(fs.readFileSync(JS + f, "utf8"), ctx);
  }
  return { A: window.effractorAccounts, said, requests: () => requests, end: () => { over = true; } };
}

for (const [why, answer] of [["unreachable", { ok: false, status: 0, data: "offline" }], ["gone", { ok: false, status: 404, data: null }]]) {
  test(`renaming a document of another mode that will not open (${why}) says so once`, async () => {
    const p = page(answer);
    await new Promise((r) => setTimeout(r, 10)); // the records are read
    // A loop never ends: waited for a while only.
    await Promise.race([p.A.sync.rename(5, "New name"), new Promise((r) => setTimeout(r, 200))]);
    const after = p.requests();
    await new Promise((r) => setTimeout(r, 50));
    p.end();
    assert.equal(p.requests(), after, "no more requests");
    assert.equal(after, 1, "one try to open it");
    assert.equal(p.said.filter((t) => t === "not renamed").length, 1);
  });
}
