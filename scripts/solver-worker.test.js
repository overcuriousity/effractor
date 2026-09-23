const { test } = require("node:test");
const assert = require("node:assert");
const { createHandler, SLICE_MS } = require("../assets/js/solver-worker.js");

// A wasm module that solves in `total` chunks, each taking `chunkMs` on a
// clock the test owns.
function fake(total, chunkMs) {
  const clock = { now: 0 };
  let done = null;
  const calls = [];
  const api = {
    validate: (text) => JSON.stringify({ ok: true, diagnostics: [], echo: text }),
    parse: (text) => JSON.stringify({ ok: { name: text }, diagnostics: [] }),
    serialize: (json) => JSON.stringify({ ok: "text of " + json, diagnostics: [] }),
    generate: (text, revision) => {
      calls.push("generate");
      return JSON.stringify({ ok: { revision, source: text, graph: { nodes: [] } }, diagnostics: [] });
    },
    component_catalog: () => JSON.stringify({ ok: { library: { id: "core-components", version: 1 } }, diagnostics: [] }),
    solve_begin(text) {
      calls.push("begin");
      if (text === "bad") return JSON.stringify({ diagnostics: [{ code: "syntax" }] });
      done = 0;
      return JSON.stringify({ ok: { exact: { p: 0.5 }, progress: { done: 0, total } }, diagnostics: [] });
    },
    solve_step() {
      calls.push("step");
      if (text_panics.on) throw new Error("unreachable");
      clock.now += chunkMs;
      done += 1;
      return JSON.stringify({ ok: { done, total }, diagnostics: [] });
    },
    solve_finish() {
      calls.push("finish");
      return JSON.stringify({ ok: { "effractor-results": 1 }, diagnostics: [] });
    },
    solve_cancel: () => calls.push("cancel"),
    crash() {
      throw new Error("unreachable");
    },
  };
  const text_panics = { on: false };
  const posted = [];
  const scheduled = [];
  const handle = createHandler({
    api,
    post: (m) => posted.push(m),
    schedule: (f) => scheduled.push(f),
    now: () => clock.now,
    panicMessage: () => "panicked at src/lib.rs: boom",
  });
  const runAll = () => {
    while (scheduled.length) scheduled.shift()();
  };
  return { handle, posted, scheduled, runAll, calls, clock, text_panics };
}

test("a request is answered with the parsed result under its id", () => {
  const w = fake(1, 1);
  w.handle({ id: 7, type: "parse", text: "T" });
  assert.deepEqual(w.posted, [{ id: 7, type: "result", result: { ok: { name: "T" }, diagnostics: [] } }]);
  w.handle({ id: 8, type: "serialize", document: { a: 1 } });
  assert.equal(w.posted[1].result.ok, 'text of {"a":1}');
  w.handle({ id: 9, type: "catalog" });
  assert.deepEqual(w.posted[2], { id: 9, type: "result", result: { ok: { library: { id: "core-components", version: 1 } }, diagnostics: [] } });
});

test("generate passes text and revision to the module and never begins a solve", () => {
  const w = fake(3, 1);
  w.handle({ id: 4, type: "generate", text: "arch", revision: "r1" });
  assert.deepEqual(w.posted, [
    { id: 4, type: "result", result: { ok: { revision: "r1", source: "arch", graph: { nodes: [] } }, diagnostics: [] } },
  ]);
  assert.deepEqual(w.calls, ["generate"]);
});

test("generate without text or revision is answered, not a crash", () => {
  const w = fake(3, 1);
  w.handle({ id: 5, type: "generate", text: "arch" });
  w.handle({ id: 6, type: "generate", revision: "r" });
  assert.deepEqual(w.posted.map((m) => [m.id, m.type, typeof m.result.error]), [
    [5, "result", "string"],
    [6, "result", "string"],
  ]);
  assert.deepEqual(w.calls, []);
  w.handle({ id: 7, type: "catalog" });
  assert.equal(w.posted[2].type, "result");
});

test("a solve posts exact results first, then progress, then the results", () => {
  const w = fake(3, 1);
  w.handle({ id: 1, type: "solve", text: "ok" });
  assert.deepEqual(w.posted.map((m) => m.type), ["exact"]);
  assert.deepEqual(w.posted[0].result.exact, { p: 0.5 });
  // Nothing is sampled in the turn that delivered the exact results.
  assert.deepEqual(w.calls, ["begin"]);
  w.runAll();
  assert.deepEqual(w.posted.map((m) => m.type), ["exact", "progress", "result"]);
  assert.deepEqual(w.posted[1], { id: 1, type: "progress", done: 3, total: 3 });
  assert.equal(w.posted[2].result.ok["effractor-results"], 1);
});

test("sampling yields to the event loop once a slice is used up", () => {
  const w = fake(10, SLICE_MS / 2 + 1);
  w.handle({ id: 1, type: "solve", text: "ok" });
  w.scheduled.shift()();
  // Two chunks overrun the slice; the rest waits for another turn.
  assert.equal(w.calls.filter((c) => c === "step").length, 2);
  assert.deepEqual(w.posted[1], { id: 1, type: "progress", done: 2, total: 10 });
  assert.equal(w.scheduled.length, 1);
});

test("a cancel between slices stops the solve and says so", () => {
  const w = fake(10, SLICE_MS);
  w.handle({ id: 1, type: "solve", text: "ok" });
  w.scheduled.shift()();
  w.handle({ id: 1, type: "cancel" });
  w.runAll();
  assert.equal(w.calls.filter((c) => c === "step").length, 1);
  assert.ok(w.calls.includes("cancel"));
  assert.ok(!w.calls.includes("finish"));
  assert.deepEqual(w.posted[w.posted.length - 1], { id: 1, type: "cancelled" });
});

test("a cancel for a solve that is not running is ignored", () => {
  const w = fake(2, 1);
  w.handle({ id: 9, type: "cancel" });
  assert.deepEqual(w.posted, []);
});

test("a new solve replaces a running one", () => {
  const w = fake(10, SLICE_MS);
  w.handle({ id: 1, type: "solve", text: "ok" });
  w.scheduled.shift()();
  w.handle({ id: 2, type: "solve", text: "ok" });
  w.runAll();
  const types = w.posted.map((m) => m.id + ":" + m.type);
  assert.ok(types.includes("1:cancelled"));
  assert.equal(types[types.length - 1], "2:result");
  assert.ok(!types.includes("1:result"));
});

test("a document with errors ends the solve with its diagnostics", () => {
  const w = fake(2, 1);
  w.handle({ id: 1, type: "solve", text: "bad" });
  assert.deepEqual(w.posted, [{ id: 1, type: "result", result: { diagnostics: [{ code: "syntax" }] } }]);
  assert.equal(w.scheduled.length, 0);
});

test("a panic is reported with the hook's message, once, and nothing runs after it", () => {
  const w = fake(5, 1);
  w.handle({ id: 1, type: "solve", text: "ok" });
  w.text_panics.on = true;
  w.runAll();
  assert.deepEqual(w.posted[w.posted.length - 1], { type: "crashed", message: "panicked at src/lib.rs: boom" });
  w.handle({ id: 2, type: "validate", text: "x" });
  assert.equal(w.posted.filter((m) => m.type === "crashed").length, 1);
  assert.equal(w.posted[w.posted.length - 1].type, "crashed");
});
