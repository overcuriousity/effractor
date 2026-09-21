// The contract of spec 7.1 — mount · render · highlight · fit · on — which any
// renderer must keep, exercised on the SVG one. Everything above the renderer
// speaks node ids and class names; these tests do too.
const { test } = require("node:test");
const assert = require("node:assert");
const dom = require("./fixtures/fake-dom.js");
const { createSvgRenderer, EVENTS } = require("../assets/js/renderer-svg.js");
const { describe } = require("../assets/js/graph.js");
const { attack } = require("./fixtures/docs.js");

// A layout by hand: the contract does not depend on ELK.
function layout() {
  const g = describe(attack);
  return {
    width: 600,
    height: 400,
    nodes: g.nodes.map((n, i) => ({ id: n.id, x: 10 + 160 * (i % 3), y: 10 + 130 * Math.floor(i / 3), width: 148, height: 94, node: n })),
    edges: g.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, points: [{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 5, y: 10 }] })),
  };
}

function mounted() {
  const host = dom.element("div");
  const r = createSvgRenderer(dom.document);
  r.mount(host);
  return { r, host, node: (id) => dom.byClass(host, "node").find((n) => n.getAttribute("data-id") === id) };
}

test("mount adds one drawing to the host, and render fills it", () => {
  const { r, host } = mounted();
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].tag, "svg");
  r.render(layout(), {});
  assert.equal(dom.byClass(host, "node").length, 7);
  assert.equal(dom.byClass(host, "edge").length, 7);
});

test("rendering again replaces the drawing", () => {
  const { r, host } = mounted();
  r.render(layout(), {});
  const smaller = layout();
  smaller.nodes.length = 2;
  smaller.edges.length = 0;
  r.render(smaller, {});
  assert.equal(dom.byClass(host, "node").length, 2);
  assert.equal(dom.byClass(host, "edge").length, 0);
});

test("a node says what it is in classes and in text", () => {
  const { r, node } = mounted();
  r.render(layout(), {});
  const physical = node("physical");
  assert.ok(physical.classList.contains("node-gate"));
  assert.deepEqual(dom.text(physical).sort(), ["2/3", "Get in"].sort());
  const phish = node("phish");
  assert.ok(phish.classList.contains("node-basic"));
  assert.ok(phish.classList.contains("is-shared"));
  assert.ok(dom.text(phish).includes("shared · 2 parents"));
  assert.ok(dom.text(phish).includes("cost 200 · det 0.3"));
  assert.ok(node("key").classList.contains("node-undeveloped"));
  assert.ok(node("files").classList.contains("is-top"));
  // The whole label is there for a pointer to find, however it was wrapped.
  assert.equal(phish.children.find((c) => c.tag === "title").textContent, "Phishing");
});

test("styles are classes and a printed value, by node id, and do not pile up", () => {
  const { r, node } = mounted();
  r.render(layout(), { phish: { classes: ["imp-4", "spof"], value: "0.46" } });
  assert.ok(node("phish").classList.contains("imp-4"));
  assert.ok(node("phish").classList.contains("spof"));
  assert.ok(dom.text(node("phish")).includes("0.46"));
  assert.ok(!node("mfa").classList.contains("imp-4"));
  r.render(layout(), { phish: { classes: ["imp-1"] } });
  assert.ok(node("phish").classList.contains("imp-1"));
  assert.ok(!node("phish").classList.contains("imp-4"));
  assert.ok(!dom.text(node("phish")).includes("0.46"));
  // A style for a node that is not drawn is not an error.
  r.render(layout(), { ghost: { classes: ["imp-5"] } });
});

test("highlight marks nodes and the edges between them, one kind at a time", () => {
  const { r, host, node } = mounted();
  r.render(layout(), {});
  r.highlight(["account", "phish", "mfa"], "cutset");
  const lit = dom.byClass(host, "hl-cutset");
  assert.deepEqual(lit.filter((e) => e.classList.contains("node")).map((n) => n.getAttribute("data-id")).sort(), ["account", "mfa", "phish"]);
  assert.deepEqual(lit.filter((e) => e.classList.contains("edge")).map((e) => e.getAttribute("data-id")).sort(), ["account>mfa", "account>phish"]);

  r.highlight(["key"], "selected");
  assert.ok(node("key").classList.contains("hl-selected"));
  assert.ok(node("phish").classList.contains("hl-cutset"), "another kind is untouched");
  r.highlight([], "cutset");
  assert.equal(dom.byClass(host, "hl-cutset").length, 0);
  assert.ok(node("key").classList.contains("hl-selected"));

  // A highlight outlives a re-render: solving restyles, it does not deselect.
  r.render(layout(), {});
  assert.ok(node("key").classList.contains("hl-selected"));
  // Ids that are not drawn are ignored.
  r.highlight(["ghost"], "selected");
});

test("clicks are reported as ids: select, activate, context", () => {
  const { r, host, node } = mounted();
  r.render(layout(), {});
  const seen = [];
  r.on("select", (e) => seen.push(["select", e.id]));
  r.on("activate", (e) => seen.push(["activate", e.id]));
  r.on("context", (e) => seen.push(["context", e.id, e.x, e.y]));

  // The click lands on a shape inside the node, as it would.
  // The press lands on a shape inside the node, as it would; the release is
  // what selects, and the browser's click, wherever it lands, adds nothing.
  node("mfa").children[0].dispatch("pointerdown", { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  node("mfa").children[0].dispatch("pointerup", { clientX: 10, clientY: 10, pointerId: 1 });
  host.children[0].dispatch("click", {});
  host.children[0].dispatch("pointerdown", { clientX: 1, clientY: 1, button: 0, pointerId: 1 });
  host.children[0].dispatch("pointerup", { clientX: 1, clientY: 1, pointerId: 1 });
  node("mfa").children[0].dispatch("dblclick", {});
  let prevented = false;
  node("key").dispatch("contextmenu", { clientX: 40, clientY: 50, preventDefault: () => (prevented = true) });
  assert.deepEqual(seen, [["select", "mfa"], ["select", null], ["activate", "mfa"], ["context", "key", 40, 50]]);
  assert.ok(prevented, "the browser's own menu is suppressed");
});

test("dragging a node onto another is a drop; a click is not", () => {
  const { r, node } = mounted();
  r.render(layout(), {});
  const drops = [];
  const selects = [];
  r.on("drop", (e) => drops.push(e));
  r.on("select", (e) => selects.push(e.id));

  node("mfa").dispatch("pointerdown", { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  node("mfa").dispatch("pointermove", { clientX: 60, clientY: 80, pointerId: 1 });
  node("physical").dispatch("pointerup", { clientX: 60, clientY: 80, ctrlKey: true, pointerId: 1 });
  // The click the browser sends after a drag is not a selection.
  node("physical").dispatch("click", {});
  assert.deepEqual(drops, [{ id: "mfa", target: "physical", ctrl: true }]);
  assert.deepEqual(selects, []);

  // No movement: a click. Onto itself, or onto nothing: no drop.
  node("mfa").dispatch("pointerdown", { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  node("mfa").dispatch("pointerup", { clientX: 11, clientY: 10, pointerId: 1 });
  node("mfa").dispatch("click", {});
  assert.equal(drops.length, 1);
  assert.deepEqual(selects, ["mfa"]);
});

test("dragging the background pans, the wheel zooms, fit undoes both", () => {
  const { r, host } = mounted();
  r.render(layout(), {});
  const svg = host.children[0];
  const viewport = dom.byClass(host, "viewport")[0];
  r.fit();
  const fitted = viewport.getAttribute("transform");
  // 600×400 in 800×600: no scaling, centred.
  assert.equal(fitted, "translate(100 100) scale(1)");

  svg.dispatch("pointerdown", { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
  svg.dispatch("pointermove", { clientX: 35, clientY: 25, pointerId: 1 });
  svg.dispatch("pointerup", { clientX: 35, clientY: 25, pointerId: 1 });
  assert.equal(viewport.getAttribute("transform"), "translate(130 120) scale(1)");

  svg.dispatch("wheel", { clientX: 0, clientY: 0, deltaY: -100 });
  assert.notEqual(viewport.getAttribute("transform"), "translate(130 120) scale(1)");
  r.fit();
  assert.equal(viewport.getAttribute("transform"), fitted);
});

test("the events are the four of the interface, and no others", () => {
  const { r } = mounted();
  assert.deepEqual(EVENTS, ["select", "activate", "context", "drop"]);
  assert.throws(() => r.on("hover", () => {}), /hover/);
});

test("ids that are also property names of every object are just ids", () => {
  const { r, host, node } = mounted();
  const l = layout();
  l.nodes[0].id = l.nodes[0].node.id = "constructor";
  r.render(l, {});
  assert.deepEqual([...node("constructor").classList.set].filter((c) => c.startsWith("hl-") || c === "undefined"), []);
  r.highlight(["mfa"], "selected");
  assert.ok(!node("constructor").classList.contains("hl-selected"));
  assert.equal(dom.byClass(host, "hl-selected").length, 1);
});

test("a style may carry a tag, drawn as words: colour is never the only channel", () => {
  const { r, node } = mounted();
  r.render(layout(), { phish: { classes: ["imp-5"], value: "0.61", tag: "SPOF" } });
  assert.ok(dom.text(node("phish")).includes("SPOF"));
  assert.ok(node("phish").classList.contains("has-tag"));
  assert.ok(!dom.text(node("mfa")).includes("SPOF"));
  r.render(layout(), {});
  assert.ok(!dom.text(node("phish")).includes("SPOF"));
});
