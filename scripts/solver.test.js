const { test } = require("node:test");
const assert = require("node:assert");
const { createSolver } = require("../assets/js/solver.js");

function harness() {
  const workers = [];
  const solver = createSolver(function makeWorker() {
    const w = { sent: [], terminated: false, postMessage: (m) => w.sent.push(m), terminate: () => (w.terminated = true) };
    workers.push(w);
    return w;
  });
  const last = () => workers[workers.length - 1];
  const reply = (m) => last().onmessage({ data: m });
  return { solver, workers, last, reply };
}

test("no worker exists until something is asked of it", () => {
  const h = harness();
  assert.equal(h.workers.length, 0);
  h.solver.validate("x");
  assert.equal(h.workers.length, 1);
});

test("requests resolve by id, in whatever order the answers come", async () => {
  const h = harness();
  const a = h.solver.validate("a");
  const b = h.solver.parse("b");
  const [ma, mb] = h.last().sent;
  assert.deepEqual([ma.type, ma.text, mb.type, mb.text], ["validate", "a", "parse", "b"]);
  h.reply({ id: mb.id, type: "result", result: { ok: "B" } });
  h.reply({ id: ma.id, type: "result", result: { ok: "A" } });
  assert.deepEqual(await a, { ok: "A" });
  assert.deepEqual(await b, { ok: "B" });
});

test("the catalog is a plain request with no text", async () => {
  const h = harness();
  const catalog = h.solver.catalog();
  const m = h.last().sent[0];
  assert.deepEqual(m, { id: m.id, type: "catalog" });
  h.reply({ id: m.id, type: "result", result: { ok: { rules: [] } } });
  assert.deepEqual(await catalog, { ok: { rules: [] } });
});

test("generate sends the text and the caller's revision, nothing else", async () => {
  const h = harness();
  const generated = h.solver.generate("doc", "rev-3");
  const m = h.last().sent[0];
  assert.deepEqual(m, { id: m.id, type: "generate", text: "doc", revision: "rev-3" });
  h.reply({ id: m.id, type: "result", result: { ok: { revision: "rev-3" } } });
  assert.deepEqual(await generated, { ok: { revision: "rev-3" } });
});

test("a solve reports exact results and progress, then resolves", async () => {
  const h = harness();
  const seen = [];
  const solved = h.solver.solve("doc", { onExact: (e) => seen.push(["exact", e]), onProgress: (d, t) => seen.push([d, t]) });
  const id = h.last().sent[0].id;
  h.reply({ id, type: "exact", result: { p: 1 } });
  h.reply({ id, type: "progress", done: 1, total: 2 });
  h.reply({ id, type: "result", result: { ok: "R" } });
  assert.deepEqual(await solved, { result: { ok: "R" } });
  assert.deepEqual(seen, [["exact", { p: 1 }], [1, 2]]);
});

test("cancel asks the worker and the solve resolves as cancelled", async () => {
  const h = harness();
  const solved = h.solver.solve("doc", {});
  const id = h.last().sent[0].id;
  h.solver.cancel();
  assert.deepEqual(h.last().sent[1], { id, type: "cancel" });
  h.reply({ id, type: "cancelled" });
  assert.deepEqual(await solved, { cancelled: true });
  // With nothing running, cancel has nothing to say.
  h.solver.cancel();
  assert.equal(h.last().sent.length, 2);
});

test("a crash rejects what was pending and the next call gets a fresh worker", async () => {
  const h = harness();
  const crashes = [];
  h.solver.onCrash = (m) => crashes.push(m);
  const solved = h.solver.solve("doc", {});
  const other = h.solver.validate("x");
  h.reply({ type: "crashed", message: "panicked: boom" });
  await assert.rejects(solved, /boom/);
  await assert.rejects(other, /boom/);
  assert.deepEqual(crashes, ["panicked: boom"]);
  assert.ok(h.workers[0].terminated);

  const again = h.solver.validate("y");
  assert.equal(h.workers.length, 2);
  h.reply({ id: h.last().sent[0].id, type: "result", result: { ok: true } });
  assert.deepEqual(await again, { ok: true });
});

test("a worker that fails to load is a crash too", async () => {
  const h = harness();
  const pending = h.solver.validate("x");
  h.last().onerror({ message: "script error" });
  await assert.rejects(pending, /script error/);
  assert.ok(h.workers[0].terminated);
});
