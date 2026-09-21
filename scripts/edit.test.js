// The editing operations, by what the keys promise (spec 7.2). Kept to the
// behaviour that would be expensive to get wrong; validity itself is the wasm
// module's to judge.
const { test } = require("node:test");
const assert = require("node:assert");
const E = require("../assets/js/edit.js");
const { attack } = require("./fixtures/docs.js");

test("Tab on a leaf makes it a gate; the new child's id comes from its first label, once", () => {
  let r = E.addChild(attack, "key");
  assert.equal(r.doc.nodes.key.gate, "or");
  assert.equal(r.doc.nodes.key.leaf, undefined);
  assert.deepEqual(r.doc.nodes.key.children, ["new-event"]);
  assert.equal(attack.nodes.key.leaf, "undeveloped", "the original is untouched");
  r = E.rename(r.doc, r.fresh, "Schlüssel kopieren", true);
  assert.equal(r.select, "schluessel-kopieren");
  assert.deepEqual(r.doc.nodes.key.children, ["schluessel-kopieren"]);
  // Renamed again, the id stays.
  r = E.rename(r.doc, r.select, "Etwas anderes", false);
  assert.equal(r.select, "schluessel-kopieren");
  assert.equal(E.slug("  ***  "), "node");
});

test("Enter adds a sibling after the node; ids stay unique", () => {
  const a = E.addSibling(attack, "phish", "account");
  assert.deepEqual(a.doc.nodes.account.children, ["phish", "new-event", "mfa"]);
  const b = E.addSibling(a.doc, "phish", "account");
  assert.equal(b.select, "new-event-2");
  assert.equal(E.addSibling(attack, "files", null), null);
});

test("an id change follows every reference, in place", () => {
  const doc = JSON.parse(JSON.stringify(attack));
  doc.controls = { c: { label: "C", cost: 1, enabled: true, effects: [{ node: "phish", ttc: "Infinity" }] } };
  const r = E.setId(doc, "phish", "Spear Phishing");
  assert.deepEqual(Object.keys(r.doc.nodes), ["files", "account", "physical", "spear-phishing", "mfa", "key", "alarm"]);
  assert.deepEqual(r.doc.nodes.account.children, ["spear-phishing", "mfa"]);
  assert.equal(r.doc.controls.c.effects[0].node, "spear-phishing");
  assert.equal(E.setId(doc, "phish", "mfa"), null, "taken");
  assert.equal(E.setId(attack, "files", "root").doc.top, "root");
});

test("G cycles or → and → vote → or, with a k that is in range", () => {
  let r = E.cycleGate(attack, "files");
  assert.equal(r.doc.nodes.files.gate, "and");
  r = E.cycleGate(r.doc, "files");
  assert.deepEqual([r.doc.nodes.files.gate, r.doc.nodes.files.k], ["vote", 2]);
  assert.deepEqual(Object.keys(r.doc.nodes.files).slice(0, 3), ["label", "gate", "k"]);
  r = E.cycleGate(r.doc, "files");
  assert.deepEqual([r.doc.nodes.files.gate, r.doc.nodes.files.k], ["or", undefined]);
  assert.equal(E.cycleGate(attack, "key"), null);
});

test("L links an existing node — a repeated event — and refuses a cycle", () => {
  const r = E.link(attack, "account", "key");
  assert.deepEqual(r.doc.nodes.account.children, ["phish", "mfa", "key"]);
  assert.equal(E.link(attack, "account", "phish"), null, "already a child");
  assert.equal(E.link(attack, "account", "files"), null, "files is above account");
  assert.equal(E.link(attack, "account", "account"), null);
});

test("Del removes the edge; the node goes with its last edge, and its orphans with it", () => {
  // phish has two parents: one edge less, still there.
  let r = E.removeEdge(attack, "account", "phish");
  assert.ok(r.doc.nodes.phish);
  assert.deepEqual(r.doc.nodes.account.children, ["mfa"]);
  // account has one: it goes, and mfa with it; phish survives under physical.
  r = E.removeEdge(attack, "files", "account");
  assert.deepEqual(Object.keys(r.doc.nodes), ["files", "physical", "phish", "key", "alarm"]);
  assert.equal(r.select, "files");
  // A vote gate's k follows its children down; a gate with none is a leaf again.
  r = E.removeEdge(E.removeEdge(attack, "physical", "key").doc, "physical", "alarm");
  assert.equal(r.doc.nodes.physical.k, 1);
  r = E.removeEdge(r.doc, "physical", "phish");
  assert.deepEqual([r.doc.nodes.physical.leaf, r.doc.nodes.physical.gate, r.doc.nodes.physical.k], ["basic", undefined, undefined]);
  assert.equal(E.losesAttributes(attack, "account", "mfa"), true);
  assert.equal(E.losesAttributes(attack, "account", "phish"), false, "it stays, under its other parent");
  assert.equal(E.losesAttributes(attack, "physical", "key"), false, "nothing typed into it");
});

test("a drop reparents, unless that would close a cycle", () => {
  const r = E.reparent(attack, "mfa", "account", "physical");
  assert.deepEqual(r.doc.nodes.account.children, ["phish"]);
  assert.deepEqual(r.doc.nodes.physical.children, ["key", "alarm", "phish", "mfa"]);
  assert.equal(E.reparent(attack, "files", null, "account"), null);
});

test("p, rate and ttc are one quantity", () => {
  const r = E.setAttribute(attack, "mfa", "rate", 0.5);
  assert.deepEqual([r.doc.nodes.mfa.p, r.doc.nodes.mfa.rate], [undefined, 0.5]);
  assert.equal(E.setAttribute(r.doc, "mfa", "rate", "").doc.nodes.mfa.rate, undefined);
});

test("the outline shows a repeated node under each parent and opens it once", () => {
  const rows = E.outline(attack);
  assert.deepEqual(rows.map((r) => "  ".repeat(r.depth) + r.id + (r.repeated ? "*" : "")), [
    "files", "  account", "    phish", "    mfa", "  physical", "    key", "    alarm", "    phish*",
  ]);
});

test("arrows walk the DAG by the edge they came along", () => {
  assert.deepEqual(E.walk(attack, "files", null, "ArrowDown"), { id: "account", parent: "files" });
  assert.deepEqual(E.walk(attack, "phish", "physical", "ArrowLeft"), { id: "alarm", parent: "physical" });
  assert.deepEqual(E.walk(attack, "phish", "account", "ArrowRight"), { id: "mfa", parent: "account" });
  assert.deepEqual(E.walk(attack, "phish", "physical", "ArrowUp"), { id: "physical", parent: "files" });
  assert.equal(E.walk(attack, "files", null, "ArrowUp"), null);
});

test("undo and redo are snapshots", () => {
  const h = E.createHistory();
  h.push("a");
  h.push("b");
  assert.equal(h.undo("c"), "b");
  assert.equal(h.undo("b"), "a");
  assert.equal(h.undo("a"), null);
  assert.equal(h.redo("a"), "b");
  h.push("x");
  assert.equal(h.redo("y"), null, "a new edit ends the redo line");
});

test("the history says whether there is anywhere to go, for its buttons", () => {
  const h = E.createHistory();
  assert.deepEqual([h.canUndo(), h.canRedo()], [false, false]);
  h.push("a");
  assert.deepEqual([h.canUndo(), h.canRedo()], [true, false]);
  h.undo("b");
  assert.deepEqual([h.canUndo(), h.canRedo()], [false, true]);
});
