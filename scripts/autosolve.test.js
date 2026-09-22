const { test } = require("node:test");
const assert = require("node:assert");
const { createAutoSolve, samplesAutomatically, DELAY_MS, SAMPLE_BUDGET_MS } = require("../assets/js/autosolve.js");

// A fake clock and a fake solver: each start is a run the test settles by hand.
function harness() {
  const timers = new Map();
  let nextTimer = 1;
  const runs = [];
  let cancels = 0;
  const auto = createAutoSolve({
    start(explicit) {
      let settle;
      const done = new Promise((resolve) => { settle = resolve; });
      runs.push({ explicit, settle });
      return done;
    },
    cancel() { cancels++; },
    setTimeout(f, ms) { const id = nextTimer++; timers.set(id, { f, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  return {
    auto, runs,
    cancels: () => cancels,
    pending: () => timers.size,
    tick() { const all = [...timers.values()]; timers.clear(); all.forEach((t) => t.f()); },
    flush: () => new Promise(setImmediate),
  };
}

test("sampling is automatic until a sampled run took longer than the budget", () => {
  assert.equal(SAMPLE_BUDGET_MS, 2000);
  assert.equal(samplesAutomatically(null), true);
  assert.equal(samplesAutomatically(1999), true);
  assert.equal(samplesAutomatically(2000), true);
  assert.equal(samplesAutomatically(2001), false);
});

test("a change is solved once, after a pause", async () => {
  const h = harness();
  h.auto.changed(); h.auto.changed(); h.auto.changed();
  assert.equal(h.runs.length, 0);
  assert.equal(h.pending(), 1);
  assert.ok(DELAY_MS > 0);
  h.tick(); await h.flush();
  assert.deepEqual(h.runs.map((r) => r.explicit), [false]);
});

test("a change during a run cancels it at once and solves again after the pause", async () => {
  const h = harness();
  h.auto.changed(); h.tick(); await h.flush();
  h.auto.changed();
  assert.equal(h.cancels(), 1);
  h.runs[0].settle(); await h.flush();
  assert.equal(h.runs.length, 1, "nothing starts before the pause is over");
  h.tick(); await h.flush();
  assert.equal(h.runs.length, 2);
  assert.equal(h.runs[1].explicit, false);
});

test("a run never overlaps another: the next one waits for the cancelled one to end", async () => {
  const h = harness();
  h.auto.changed(); h.tick(); await h.flush();
  h.auto.changed(); h.tick(); await h.flush(); // the pause ends before the cancel lands
  assert.equal(h.runs.length, 1);
  h.runs[0].settle(); await h.flush();
  assert.equal(h.runs.length, 2);
});

test("an explicit solve starts now, and an edit during it keeps it explicit", async () => {
  const h = harness();
  h.auto.changed();
  h.auto.now();
  assert.equal(h.pending(), 0, "the pending automatic run is folded in");
  await h.flush();
  assert.deepEqual(h.runs.map((r) => r.explicit), [true]);
  h.auto.changed();
  h.runs[0].settle(); await h.flush();
  h.tick(); await h.flush();
  assert.deepEqual(h.runs.map((r) => r.explicit), [true, true]);
  h.runs[1].settle(); await h.flush();
  h.auto.changed(); h.tick(); await h.flush();
  assert.equal(h.runs[2].explicit, false, "the next plain edit is automatic again");
});

test("stop cancels the run and forgets what was waiting", async () => {
  const h = harness();
  h.auto.now(); await h.flush();
  h.auto.changed();
  h.auto.stop();
  assert.equal(h.pending(), 0);
  h.runs[0].settle(); await h.flush();
  h.tick(); await h.flush();
  assert.equal(h.runs.length, 1);
  assert.equal(h.auto.running(), false);
});

test("a failed run does not stop the next one", async () => {
  const h = harness();
  const auto = createAutoSolve({
    start() { h.runs.push(1); return Promise.reject(new Error("crashed")); },
    cancel() {},
    setTimeout: (f) => { f(); return 1; },
    clearTimeout() {},
  });
  auto.changed(); await h.flush();
  auto.changed(); await h.flush();
  assert.equal(h.runs.length, 2);
  assert.equal(auto.running(), false);
});
