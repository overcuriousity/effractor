const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAutosave } = require("../assets/js/accounts/autosave.js");

function fakeTimers() {
  let now = 0, next = 1;
  const queue = new Map();
  return {
    set(fn, ms) { const id = next++; queue.set(id, { at: now + ms, fn }); return id; },
    clear(id) { queue.delete(id); },
    async advance(ms) {
      now += ms;
      for (;;) {
        const due = [...queue.entries()].filter(([, t]) => t.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        queue.delete(due[0]);
        await due[1].fn();
        await new Promise((r) => setImmediate(r));
      }
    },
  };
}

function server(answers) {
  const calls = [];
  const put = async (name, body, base) => {
    calls.push({ name, body, base });
    const a = answers.shift() || { ok: true, status: 200, data: { version: base + 1 } };
    return a;
  };
  put.calls = calls;
  return put;
}

test("edits settle, then one save goes with the version it was based on", async () => {
  const timers = fakeTimers(), put = server([]), states = [];
  const a = createAutosave({ put, delay: 800, timers, onState: (s) => states.push(s) });
  a.bind({ version: 3, saved: "v0" });
  a.change("v1", "N");
  a.change("v2", "N");
  await timers.advance(799);
  assert.equal(put.calls.length, 0);
  await timers.advance(1);
  assert.deepEqual(put.calls, [{ name: "N", body: "v2", base: 3 }]);
  assert.equal(a.state(), "saved");
  a.change("v3", "N");
  await timers.advance(800);
  assert.equal(put.calls[1].base, 4, "the next save builds on the new version");
});

test("the text it already has is not saved again", async () => {
  const timers = fakeTimers(), put = server([]);
  const a = createAutosave({ put, delay: 800, timers });
  a.bind({ version: 1, saved: "same" });
  a.change("same", "N");
  await timers.advance(5000);
  assert.equal(put.calls.length, 0);
});

test("a second tab's save is a conflict: reported once, never retried or overwritten", async () => {
  const timers = fakeTimers(), conflicts = [];
  const put = server([{ ok: false, status: 409, data: { version: 5, updated_by: "alice", updated_at: 99 } }]);
  const a = createAutosave({ put, delay: 800, timers, onConflict: (c) => conflicts.push(c) });
  a.bind({ version: 4, saved: "base" });
  a.change("mine", "N");
  await timers.advance(800);
  a.change("mine and more", "N");
  await timers.advance(60_000);
  assert.equal(put.calls.length, 1);
  assert.deepEqual(conflicts, [{ theirs: { version: 5, updated_by: "alice", updated_at: 99 }, mine: "mine" }]);
  assert.equal(a.state(), "conflict");
});

test("no network retries with growing waits and says so", async () => {
  const timers = fakeTimers(), states = [];
  const put = server([{ ok: false, status: 0 }, { ok: false, status: 502 }]);
  const a = createAutosave({ put, delay: 800, timers, onState: (s) => states.push(s) });
  a.bind({ version: 1, saved: "a" });
  a.change("b", "N");
  await timers.advance(800);
  assert.equal(a.state(), "retrying");
  await timers.advance(2000);
  assert.equal(put.calls.length, 2);
  await timers.advance(3999);
  assert.equal(put.calls.length, 2, "waits longer the second time");
  await timers.advance(1);
  assert.equal(put.calls.length, 3);
  assert.equal(a.state(), "saved");
  assert.ok(states.includes("retrying"));
});

test("a document that went away (404) stops saving and says it is lost", async () => {
  const timers = fakeTimers(), lost = [];
  const put = server([{ ok: false, status: 404 }]);
  const a = createAutosave({ put, delay: 800, timers, onLost: () => lost.push(1) });
  a.bind({ version: 1, saved: "a" });
  a.change("b", "N");
  await timers.advance(800);
  assert.equal(a.state(), "lost");
  assert.equal(lost.length, 1);
});

test("flush saves now", async () => {
  const timers = fakeTimers(), put = server([]);
  const a = createAutosave({ put, delay: 800, timers });
  a.bind({ version: 1, saved: "a" });
  a.change("b", "N");
  await a.flush();
  assert.equal(put.calls.length, 1);
});

test("logged out (401) stops at once and says so, no retries", async () => {
  const timers = fakeTimers(), out = [];
  const put = server([{ ok: false, status: 401 }]);
  const a = createAutosave({ put, delay: 800, timers, onLoggedOut: () => out.push(1) });
  a.bind({ version: 1, saved: "a" });
  a.change("b", "N");
  await timers.advance(60_000);
  assert.equal(put.calls.length, 1);
  assert.equal(a.state(), "loggedout");
  assert.equal(out.length, 1);
});

test("a save the server refuses (400, 413) stops with the reason", async () => {
  for (const status of [400, 413]) {
    const timers = fakeTimers(), why = [];
    const put = server([{ ok: false, status, data: "a document is at most 1 MiB" }]);
    const a = createAutosave({ put, delay: 800, timers, onRefused: (w) => why.push(w) });
    a.bind({ version: 1, saved: "a" });
    a.change("b", "N");
    await timers.advance(60_000);
    assert.equal(put.calls.length, 1, `status ${status}`);
    assert.equal(a.state(), "refused");
    assert.deepEqual(why, ["a document is at most 1 MiB"]);
  }
});

test("the queue remembers the name it last saved under", () => {
  const a = createAutosave({ put: server([]), delay: 800, timers: fakeTimers() });
  a.bind({ version: 1, saved: "a" });
  a.change("b", "Plant");
  assert.equal(a.name(), "Plant");
});

test("after a refused save, a different text is saved again", async () => {
  const timers = fakeTimers();
  const put = server([{ ok: false, status: 400, data: "too large" }]);
  const a = createAutosave({ put, delay: 800, timers });
  a.bind({ version: 1, saved: "a" });
  a.change("huge", "N");
  await timers.advance(1000);
  assert.equal(a.state(), "refused");
  a.change("small", "N");
  await timers.advance(1000);
  assert.equal(put.calls.length, 2);
  assert.equal(put.calls[1].body, "small");
  assert.equal(a.state(), "saved");
});
