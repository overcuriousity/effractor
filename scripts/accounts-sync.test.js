// The sync core (accounts spec §6): which server document each mode's text
// is, and keeping it saved. Every test here is a way the review found to
// write one document's text into another, or to lose an edit.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSyncCore } = require("../assets/js/accounts/sync-core.js");

// ---- fakes ----

function fakeTimers() {
  let now = 0, next = 1;
  const queue = new Map();
  return {
    set(fn, ms) { const id = next++; queue.set(id, { at: now + ms, fn }); return id; },
    clear(id) { queue.delete(id); },
    async advance(ms) {
      const until = now + ms;
      for (;;) {
        await settle();
        const due = [...queue.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].fn();
      }
      now = until;
      await settle();
    },
  };
}

async function settle() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

// A text is "profile|name|content", so the fake page can read its profile.
const doc = (profile, name, content) => `${profile}|${name}|${content}`;
const profileOf = (text) => text.split("|")[0];
const nameOf = (text) => text.split("|")[1];

function fakeServer() {
  const docs = new Map(); // id -> {profile, name, body, version, folder}
  const folders = new Set([7]);
  let nextId = 100, up = true;
  const log = [];
  async function request(method, path, body) {
    log.push({ method, path, body });
    if (!up) return { ok: false, status: 0, data: "offline" };
    let m;
    if (method === "POST" && path === "/api/documents") {
      if (body.folder != null && !folders.has(body.folder)) return { ok: false, status: 404, data: null };
      if (body.body.length > 1000) return { ok: false, status: 400, data: "a document is at most 1 MiB" };
      const id = nextId++;
      docs.set(id, { profile: body.profile, name: body.name, body: body.body, version: 1, folder: body.folder });
      return { ok: true, status: 201, data: { id, version: 1, name: body.name, role: "owner" } };
    }
    if ((m = /^\/api\/documents\/(\d+)$/.exec(path))) {
      const d = docs.get(Number(m[1]));
      if (!d) return { ok: false, status: 404, data: null };
      if (method === "GET") return { ok: true, status: 200, data: { id: Number(m[1]), ...d, role: d.role || "owner" } };
      if (method === "PUT") {
        if (server.unauthorized) return { ok: false, status: 401, data: null };
        if (body.base !== d.version) {
          return { ok: false, status: 409, data: { version: d.version, updated_by: "alice", updated_at: 1 } };
        }
        d.version++;
        d.body = body.body;
        d.name = body.name;
        return { ok: true, status: 200, data: { version: d.version, updated_at: 2 } };
      }
    }
    return { ok: false, status: 404, data: null };
  }
  const server = {
    docs, folders, log, request, unauthorized: false,
    down() { up = false; },
    up() { up = true; },
    add(profile, name, content, extra) {
      const id = nextId++;
      docs.set(id, { profile, name, body: doc(profile, name, content), version: 1, folder: null, ...extra });
      return id;
    },
    body(id) { return docs.get(id).body; },
  };
  return server;
}

function fakeStore(shared) {
  const map = shared || new Map();
  return {
    map,
    binding: async (p) => (map.has(p) ? JSON.parse(map.get(p)) : null),
    bind: async (p, rec) => { if (rec) map.set(p, JSON.stringify(rec)); else map.delete(p); },
  };
}

// A tab: the page (one text per mode, like app.js), a store, and the core.
function tab(server, opts = {}) {
  const timers = opts.timers || fakeTimers();
  const store = fakeStore(opts.shared);
  const said = [];
  const slots = {};
  const page = {
    current: null,
    text: () => (page.current ? slots[page.current] : null),
    profile: () => page.current,
    name: () => (page.current ? nameOf(slots[page.current]) : ""),
    folder: () => (opts.folder ? opts.folder() : null),
    say: (text, actions, sticky) => said.push({ text, actions: actions || [], sticky: !!sticky }),
    // As app.replaceDocument: lands in the text's own mode, then tells the core.
    replace: async (text, _said, o) => {
      const p = profileOf(text);
      slots[p] = text;
      page.current = p;
      core.text(text, p, (o && o.origin) || "other");
      return true;
    },
  };
  const states = [];
  const loggedOut = [];
  const created = [];
  const core = createSyncCore({
    request: server.request,
    store,
    page,
    timers,
    delay: 800,
    onState: (s) => states.push(s),
    onSaved: () => {},
    onLoggedOut: () => loggedOut.push(1),
    onCreated: (id) => created.push(id),
  });
  return {
    core, page, timers, said, states, loggedOut, store, created,
    // An edit, as app.js's onText reports it.
    edit(text) {
      const p = profileOf(text);
      slots[p] = text;
      page.current = p;
      core.text(text, p, null);
    },
    // A mode switch: the mode's last text comes back (app.switchMode).
    switchTo(p) {
      page.current = p;
      core.text(slots[p], p, null);
    },
    click(label) {
      const note = [...said].reverse().find((s) => s.actions.some((a) => a[0] === label));
      assert.ok(note, `no notice offers ${label}: ${JSON.stringify(said.map((s) => s.text))}`);
      return note.actions.find((a) => a[0] === label)[1]();
    },
  };
}

const USER = { id: 1, name: "alice" };

// ---- C1: New / Open file must never write into the previous document ----

test("offline, a new document's edits never reach the document it replaced", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(F);
  server.down();
  await t.page.replace(doc("fault-tree", "New", "n0"), "new", { origin: "new" });
  t.edit(doc("fault-tree", "New", "n1"));
  t.edit(doc("fault-tree", "New", "n2"));
  await t.timers.advance(5000);
  server.up();
  await t.timers.advance(120000);
  assert.equal(server.body(F), doc("fault-tree", "F", "f0"), "F is untouched");
  assert.ok(t.said.some((s) => s.actions.some((a) => a[0] === "Save")), "the new one is offered once back");
});

test("an edit to the old document made just before New is saved into the old one", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(F);
  t.edit(doc("fault-tree", "F", "f1"));
  await t.page.replace(doc("fault-tree", "New", "n0"), "new", { origin: "new" });
  t.edit(doc("fault-tree", "New", "n1"));
  await t.timers.advance(5000);
  assert.equal(server.body(F), doc("fault-tree", "F", "f1"), "F got its own last edit");
  const created = [...server.docs.entries()].find(([, d]) => d.name === "New");
  assert.ok(created, "the new document exists");
  assert.equal(created[1].body, doc("fault-tree", "New", "n1"), "and has its edit");
});

test("New in a folder deleted meanwhile lands at the top, not in the old document", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const t = tab(server, { folder: () => 99 });
  await t.core.login(USER);
  await t.core.open(F);
  await t.page.replace(doc("fault-tree", "New", "n0"), "new", { origin: "new" });
  await t.timers.advance(100);
  t.edit(doc("fault-tree", "New", "n1"));
  await t.timers.advance(5000);
  assert.equal(server.body(F), doc("fault-tree", "F", "f0"));
  const created = [...server.docs.values()].find((d) => d.name === "New");
  assert.equal(created.folder, null);
  assert.equal(created.body, doc("fault-tree", "New", "n1"));
});

test("a file the server refuses stays local and is never written into the old document", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(F);
  await t.page.replace(doc("fault-tree", "Big", "x".repeat(2000)), "opened", { origin: "file" });
  t.edit(doc("fault-tree", "Big", "y".repeat(2000)));
  await t.timers.advance(60000);
  assert.equal(server.body(F), doc("fault-tree", "F", "f0"));
  assert.ok(t.said.some((s) => /not kept on the server/.test(s.text)));
});

// ---- I1: two tabs and a reload ----

test("a conflicted tab that reloads does not overwrite the other tab's save", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const shared = new Map();
  const one = tab(server, { shared });
  const two = tab(server, { shared });
  for (const t of [one, two]) {
    await t.core.login(USER);
    await t.core.open(F);
  }
  one.edit(doc("fault-tree", "F", "from one"));
  await one.timers.advance(1000);
  two.edit(doc("fault-tree", "F", "from two"));
  await two.timers.advance(1000);
  assert.ok(two.said.some((s) => /Changed by/.test(s.text)), "tab two is told");
  // Tab two reloads instead of choosing: a new core on the same storage,
  // with tab two's text on the page.
  const again = tab(server, { shared });
  again.page.current = "fault-tree";
  again.edit.call(again, doc("fault-tree", "F", "from two"));
  await again.core.login(USER);
  await again.timers.advance(5000);
  assert.equal(server.body(F), doc("fault-tree", "F", "from one"), "tab one's save stands");
});

// ---- I2: the queue belongs to the document, not to the mode on screen ----

test("an edit is still saved when the mode is switched right after it", async () => {
  const server = fakeServer();
  const A = server.add("fault-tree", "A", "a0");
  const B = server.add("attack-tree", "B", "b0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(A);
  await t.core.open(B);
  t.switchTo("fault-tree");
  t.edit(doc("fault-tree", "A", "a1"));
  t.switchTo("attack-tree");
  await t.timers.advance(5000);
  assert.equal(server.body(A), doc("fault-tree", "A", "a1"));
  assert.equal(server.body(B), doc("attack-tree", "B", "b0"));
});

test("a save that answers after a mode switch does not give the other document its version", async () => {
  const server = fakeServer();
  const A = server.add("fault-tree", "A", "a0");
  const B = server.add("attack-tree", "B", "b0");
  server.docs.get(A).version = 5;
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(B);
  await t.core.open(A);
  t.edit(doc("fault-tree", "A", "a1"));
  await t.timers.advance(800); // A's PUT goes out
  t.switchTo("attack-tree");
  await t.timers.advance(100);
  t.edit(doc("attack-tree", "B", "b1"));
  await t.timers.advance(5000);
  assert.equal(server.body(B), doc("attack-tree", "B", "b1"), "B saved on its own version");
  assert.ok(!t.said.some((s) => /Changed by/.test(s.text)), "no conflict with oneself");
});

test("keep mine as a copy after switching mode copies the conflicted document", async () => {
  const server = fakeServer();
  const A = server.add("fault-tree", "A", "a0");
  const B = server.add("attack-tree", "B", "b0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(B);
  await t.core.open(A);
  server.docs.get(A).version = 9; // someone else saved A
  t.edit(doc("fault-tree", "A", "mine"));
  await t.timers.advance(1000);
  t.switchTo("attack-tree");
  await t.click("Keep mine as copy");
  await t.timers.advance(1000);
  const copy = [...server.docs.values()].find((d) => d.body === doc("fault-tree", "A", "mine"));
  assert.ok(copy, "a copy of A's text");
  assert.equal(copy.profile, "fault-tree");
  assert.equal(server.body(B), doc("attack-tree", "B", "b0"), "B untouched");
});

test("editing the profile line never writes into the other mode's document", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const Y = server.add("attack-tree", "Y", "y0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(Y);
  await t.core.open(F);
  // The source editor turns F into an attack tree: the text lands in the
  // attack-tree mode, where Y is.
  t.edit(doc("attack-tree", "F", "f0"));
  await t.timers.advance(5000);
  assert.equal(server.body(Y), doc("attack-tree", "Y", "y0"), "Y untouched");
  assert.equal(server.body(F), doc("fault-tree", "F", "f0"), "F untouched");
});

// ---- I7: logged out, refused, logging out ----

test("a save refused for being logged out stops and says so, no endless retry", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(F);
  server.unauthorized = true;
  t.edit(doc("fault-tree", "F", "f1"));
  await t.timers.advance(60000);
  assert.equal(server.log.filter((r) => r.method === "PUT").length, 1);
  assert.equal(t.loggedOut.length, 1);
});

test("logging out saves the last edit first, and logging back in picks it up again", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(F);
  t.edit(doc("fault-tree", "F", "f1"));
  await t.core.logout();
  assert.equal(server.body(F), doc("fault-tree", "F", "f1"));
  t.said.length = 0;
  await t.core.login(USER);
  await t.timers.advance(1000);
  assert.equal(t.core.openId(), F, "still F, not a new document");
  assert.ok(!t.said.some((s) => s.actions.some((a) => a[0] === "Save")), "no offer to save it again");
});

test("another user's login never saves into the first user's documents", async () => {
  const server = fakeServer();
  const F = server.add("fault-tree", "F", "f0");
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(F);
  await t.core.logout();
  await t.core.login({ id: 2, name: "bob" });
  t.edit(doc("fault-tree", "F", "bob's"));
  await t.timers.advance(5000);
  assert.equal(server.body(F), doc("fault-tree", "F", "f0"));
  assert.equal(t.core.openId(), null);
});

test("a viewer's copy is never saved", async () => {
  const server = fakeServer();
  const V = server.add("fault-tree", "V", "v0", { role: "viewer" });
  const t = tab(server);
  await t.core.login(USER);
  await t.core.open(V);
  t.edit(doc("fault-tree", "V", "mine"));
  await t.timers.advance(5000);
  assert.equal(server.log.filter((r) => r.method === "PUT").length, 0);
});

test("a new document is announced, so the Documents list can show it", async () => {
  const server = fakeServer();
  const t = tab(server);
  await t.core.login(USER);
  await t.page.replace(doc("fault-tree", "New", "n0"), "new", { origin: "new" });
  await t.timers.advance(100);
  assert.equal(t.created.length, 1);
  assert.ok(server.docs.has(t.created[0]));
  assert.equal(t.core.openId(), t.created[0]);
});
