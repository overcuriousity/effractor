const { test } = require("node:test");
const assert = require("node:assert");
const view = require("../assets/js/results-view.js");
const { bin, leafStyles, rankCutSets, reasons, nodeFacts, rowsContaining, shouldAutoSolve } = view;
const snapshot = require("../crates/effractor-solver/tests/snapshots/webserver.json");

test("importance bins are the fixed thresholds of the spec", () => {
  // <0.01  <0.05  <0.2  <0.5  ≥0.5 — the same colour means the same thing in
  // every model.
  const cases = [[0, 1], [0.0099, 1], [0.01, 2], [0.0499, 2], [0.05, 3], [0.1999, 3], [0.2, 4], [0.4999, 4], [0.5, 5], [1, 5]];
  for (const [v, want] of cases) assert.equal(bin(v), want, String(v));
  assert.equal(bin(null), null);
  assert.equal(bin(undefined), null);
  assert.equal(bin(NaN), null);
});

test("leaves are styled by Fussell-Vesely, or by Birnbaum when asked", () => {
  const fv = leafStyles(snapshot, "fussell_vesely");
  // server: FV 0.487 → bin 4; every leaf of this tree is a cut set of its own.
  assert.deepEqual(fv.server, { classes: ["imp-4"], value: "0.49", tag: "SPOF" });
  assert.deepEqual(fv.software.classes, ["imp-2"]);
  const b = leafStyles(snapshot, "birnbaum");
  assert.deepEqual(b.server.classes, ["imp-5"]);
  assert.equal(b.server.value, "0.98");
  // Short enough for a circle, whatever the number.
  for (const v of [1, 0.5, 0.0452, 0.00123, 1e-9]) assert.ok(leafStyles({ leaves: [{ id: "x", fussell_vesely: v }] }, "fussell_vesely").x.value.length <= 6, String(v));
  // Gates are never coloured.
  assert.equal(fv.top, undefined);
});

test("a leaf without numbers has no colour and no value, but is still a SPOF", () => {
  const results = { leaves: [{ id: "a", p: null, birnbaum: null, fussell_vesely: null, spof: true }, { id: "b", p: null, birnbaum: null, fussell_vesely: null, spof: false }] };
  assert.deepEqual(leafStyles(results, "fussell_vesely"), { a: { classes: [], value: null, tag: "SPOF" }, b: { classes: [], value: null, tag: null } });
});

test("cut sets are ranked by probability, then by size, and SPOFs are flagged", () => {
  const ranked = rankCutSets([
    { leaves: ["a", "b"], probability: 0.5 },
    { leaves: ["c"], probability: 0.01 },
    { leaves: ["d", "e", "f"], probability: null },
    { leaves: ["g"], probability: 0.5 },
    { leaves: ["h"], probability: null },
  ]);
  assert.deepEqual(ranked.map((s) => s.leaves.join("+")), ["g", "a+b", "c", "h", "d+e+f"]);
  assert.deepEqual(ranked.map((s) => s.spof), [true, false, true, true, false]);
  assert.deepEqual(ranked.map((s) => s.rank), [1, 2, 3, 4, 5]);
  assert.equal(ranked[0].text, "0.500");
  assert.equal(ranked[3].text, "—");
});

test("whatever is missing or cut short is said, with the solver's reason", () => {
  assert.deepEqual(reasons(snapshot), []);
  const partial = {
    cut_sets: { available: { total: "123456789012345678901234567890", truncated: "stopped at 10000 sets", sets: [] } },
    exact: { unavailable: { reason: "the BDD exceeded 1000000 nodes" } },
    sampled: { available: {} },
    controls: { unavailable: { reason: "no controls" } },
    attacker: null,
  };
  assert.deepEqual(reasons(partial), [
    "Cut sets: stopped at 10000 sets (123456789012345678901234567890 in all)",
    "Exact results: the BDD exceeded 1000000 nodes",
  ]);
  // A model without controls is not a shortcoming to report.
  assert.ok(!reasons(partial).some((r) => r.includes("no controls")));
});

test("a node's facts are what the solver said about it", () => {
  assert.deepEqual(nodeFacts(snapshot, "server"), [
    ["P within horizon", "0.0217"],
    ["sampled", "0.0173"],
    ["Fussell-Vesely", "0.487"],
    ["Birnbaum", "0.977"],
    ["single point of failure", "yes"],
  ]);
  // A gate has probabilities and no importance.
  assert.deepEqual(nodeFacts(snapshot, "top").map((f) => f[0]), ["P within horizon", "sampled"]);
  assert.deepEqual(nodeFacts(snapshot, "nobody"), []);
  assert.deepEqual(nodeFacts(null, "server"), []);
});

test("selecting a node finds the cut sets it is in", () => {
  const ranked = rankCutSets([{ leaves: ["a", "b"], probability: 0.2 }, { leaves: ["b"], probability: 0.1 }, { leaves: ["c"], probability: 0.05 }]);
  assert.deepEqual(rowsContaining(ranked, "b"), [0, 1]);
  assert.deepEqual(rowsContaining(ranked, "constructor"), []);
  assert.deepEqual(rowsContaining(ranked, null), []);
});

test("exact results refresh by themselves only when that is cheap", () => {
  assert.equal(shouldAutoSolve(12), true);
  assert.equal(shouldAutoSolve(99.9), true);
  assert.equal(shouldAutoSolve(100), false);
  // Never solved: nothing is known about the cost, so do not presume.
  assert.equal(shouldAutoSolve(null), false);
});

test("controls are listed best buy first, then the enabled ones; too close to call is said", () => {
  const doc = { controls: { edr: { label: "EDR", cost: 3000, enabled: true, effects: [{}] }, psu: { label: "Second PSU", cost: 1800, enabled: false, effects: [{}, {}] }, cluster: { cost: 4000, enabled: false } } };
  // Before a solve: the document's order, nothing claimed.
  assert.deepEqual(view.controlRows(doc, null).map((r) => [r.id, r.rank, r.value]), [["edr", null, null], ["psu", null, null], ["cluster", null, null]]);
  const results = { controls: { available: { measure: "expected_loss", baseline: 6000, controls: [
    { id: "cluster", enabled: false, cost: 4000, flipped: 3600, value: 2400, value_ci: { lo: 1400, hi: 3400 }, value_per_cost: 0.6, rank: 2 },
    { id: "psu", enabled: false, cost: 1800, flipped: 4500, value: 1500, value_ci: { lo: 1200, hi: 1800 }, value_per_cost: 0.83, rank: 1 },
    { id: "edr", enabled: true, cost: 3000, flipped: 6500, value: 500, value_ci: { lo: 300, hi: 700 }, value_per_cost: null, rank: null },
  ] } } };
  const rows = view.controlRows(doc, results);
  assert.deepEqual(rows.map((r) => r.id), ["psu", "cluster", "edr"]);
  assert.deepEqual([rows[0].label, rows[0].effects, rows[0].perCost], ["Second PSU", 2, 0.83]);
  assert.equal(rows[1].label, "cluster", "no label: the id");
  // cluster's interval reaches psu's value; psu's own does not reach cluster's.
  assert.deepEqual(rows.map((r) => r.close), [false, true, false]);
  assert.deepEqual(view.controlRows({}, results), []);
});
