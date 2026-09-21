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
});

test("removing says what it is going to do, and did: unlink a shared node, delete any other", () => {
  // One parent: the node goes, and what hangs under it alone.
  assert.deepEqual(E.removal(attack, "account"), { shared: false, parents: ["files"], below: 1 });
  assert.deepEqual(E.removal(attack, "mfa"), { shared: false, parents: ["account"], below: 0 });
  // Two parents: each edge can go by itself; deleting takes them all.
  assert.deepEqual(E.removal(attack, "phish"), { shared: true, parents: ["account", "physical"], below: 0 });
  assert.equal(E.removal(attack, "files"), null, "the top event stays");

  assert.equal(E.removeEdge(attack, "account", "phish").removed, 0);
  assert.equal(E.removeEdge(attack, "files", "account").removed, 2);

  const r = E.deleteNode(attack, "phish");
  assert.equal(r.doc.nodes.phish, undefined);
  assert.deepEqual(r.doc.nodes.account.children, ["mfa"]);
  assert.deepEqual(r.doc.nodes.physical.children, ["key", "alarm"]);
  assert.deepEqual([r.removed, r.select], [1, "account"]);
  assert.equal(E.deleteNode(attack, "files"), null);
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

test("a rate can be said as once every so long, and back", () => {
  // 1e-6 per hour: once in about 114 years.
  assert.deepEqual(E.meanTime(1e-6, "h"), { every: 114.2, unit: "y" });
  assert.deepEqual(E.meanTime(0.5, "d"), { every: 2, unit: "d" });
  assert.deepEqual(E.meanTime(2, "d"), { every: 12, unit: "h" });
  assert.equal(E.rateFrom(2, "y", "y"), 0.5);
  assert.equal(E.rateFrom(10, "d", "h"), 1 / 240);
  assert.equal(E.rateFrom(0, "d", "h"), null);
  assert.equal(E.meanTime(0, "h"), null);
});

test("assets are made by name, given losses, and taken away with what points at them", () => {
  let r = E.addAsset(attack, "Personnel files");
  assert.equal(r.asset, "personnel-files");
  assert.deepEqual(r.doc.assets["personnel-files"], { label: "Personnel files", loss: {} });
  assert.equal(E.addAsset(r.doc, "Personnel files").asset, "personnel-files-2", "ids stay unique");
  assert.equal(E.addAsset(attack, "   "), null);

  // A plain number is a number; anything else is a distribution, as text.
  let d = E.setAssetLoss(r.doc, "personnel-files", "c", "40000").doc;
  d = E.setAssetLoss(d, "personnel-files", "a", " Pert(1, 2, 3) ").doc;
  assert.deepEqual(d.assets["personnel-files"].loss, { c: 40000, a: "Pert(1, 2, 3)" });
  d = E.setAssetLoss(d, "personnel-files", "c", "").doc;
  assert.deepEqual(d.assets["personnel-files"].loss, { a: "Pert(1, 2, 3)" });
  assert.equal(E.setAssetLoss(d, "nobody", "c", "1"), null);
  assert.equal(E.setAssetLoss(d, "personnel-files", "x", "1"), null);

  d = E.setAssetLabel(d, "personnel-files", "HR files").doc;
  assert.equal(d.assets["personnel-files"].label, "HR files");
  assert.equal(Object.keys(d.assets)[0], "personnel-files", "the id is what consequences hold: it stays");

  // Removing it removes the consequences that name it, and the empty lists.
  d.nodes.files.consequences = [{ asset: "personnel-files", dim: "c" }];
  d.nodes.mfa.consequences = [{ asset: "personnel-files", dim: "a" }, { asset: "other", dim: "a" }];
  d.assets.other = { label: "Other", loss: {} };
  const gone = E.removeAsset(d, "personnel-files").doc;
  assert.deepEqual(Object.keys(gone.assets), ["other"]);
  assert.equal(gone.nodes.files.consequences, undefined);
  assert.deepEqual(gone.nodes.mfa.consequences, [{ asset: "other", dim: "a" }]);
  assert.equal(E.removeAsset(gone, "other").doc.assets, undefined, "no assets: no key");
  assert.equal(E.usesOfAsset(d, "personnel-files"), 2);
});

test("a control is switched in the document", () => {
  const doc = { nodes: {}, controls: { mfa: { label: "MFA", cost: 1, enabled: false } } };
  const r = E.toggleControl(doc, "mfa");
  assert.equal(r.doc.controls.mfa.enabled, true);
  assert.equal(doc.controls.mfa.enabled, false, "the original is left alone");
  assert.equal(E.toggleControl(r.doc, "mfa").doc.controls.mfa.enabled, false);
  assert.equal(E.toggleControl(doc, "nobody"), null);
});

test("controls are made by name, given a cost and effects on leaves, and taken away", () => {
  let r = E.addControl(attack, "Phishing training");
  assert.equal(r.control, "phishing-training");
  assert.deepEqual(r.doc.controls["phishing-training"], { label: "Phishing training", cost: 0, enabled: false, effects: [] });
  assert.equal(E.addControl(r.doc, "Phishing training").control, "phishing-training-2");
  assert.equal(E.addControl(attack, " "), null);

  let d = E.setControl(r.doc, "phishing-training", "cost", "2500").doc;
  d = E.setControl(d, "phishing-training", "label", " Awareness ").doc;
  assert.deepEqual([d.controls["phishing-training"].cost, d.controls["phishing-training"].label], [2500, "Awareness"]);
  assert.equal(E.setControl(d, "phishing-training", "cost", "cheap"), null, "a cost is a number");
  assert.equal(E.setControl(d, "phishing-training", "cost", "-1"), null);
  assert.equal(E.setControl(d, "phishing-training", "label", ""), null);

  // An effect names a leaf and the likelihood it has while the control is on.
  d = E.addEffect(d, "phishing-training", "phish", "VeryHardAndUncertain").doc;
  assert.deepEqual(d.controls["phishing-training"].effects, [{ node: "phish", ttc: "VeryHardAndUncertain" }]);
  assert.equal(E.addEffect(d, "phishing-training", "account", "Infinity"), null, "a gate has no likelihood to replace");
  assert.equal(E.addEffect(d, "phishing-training", "phish", "Infinity"), null, "one effect per leaf");
  assert.equal(E.addEffect(d, "phishing-training", "mfa", " "), null);
  d = E.setEffect(d, "phishing-training", 0, "Infinity").doc;
  assert.equal(d.controls["phishing-training"].effects[0].ttc, "Infinity");
  assert.deepEqual(E.effectTargets(d, "phishing-training"), ["mfa", "key", "alarm"], "leaves it does not act on yet");
  d = E.removeEffect(d, "phishing-training", 0).doc;
  assert.deepEqual(d.controls["phishing-training"].effects, []);
  assert.equal(E.removeEffect(d, "phishing-training", 3), null);

  assert.equal(E.removeControl(d, "phishing-training").doc.controls, undefined, "no controls: no key");
  assert.equal(E.removeControl(d, "nobody"), null);
});
