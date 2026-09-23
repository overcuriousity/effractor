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
  assert.ok(!dom.text(phish).some((t) => t.includes("shared")));
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

test("an edge can be pressed too: it selects the child along that edge", () => {
  const { r, host } = mounted();
  r.render(layout(), {});
  const seen = [];
  r.on("select", (e) => seen.push([e.id, e.parent]));
  r.on("context", (e) => seen.push(["context", e.id, e.parent]));
  // The wide, unseen path over the line is what takes the press.
  const hit = dom.byClass(host, "edge-hit").find((e) => e.getAttribute("data-from") === "physical" && e.getAttribute("data-to") === "key");
  hit.dispatch("pointerdown", { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  hit.dispatch("pointerup", { clientX: 10, clientY: 10, pointerId: 1 });
  hit.dispatch("contextmenu", { clientX: 4, clientY: 5 });
  assert.deepEqual(seen, [["key", "physical"], ["context", "key", "physical"]]);
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

  // A button has no pointer: it zooms about the middle of the 800×600 view.
  r.zoomBy(2);
  assert.equal(viewport.getAttribute("transform"), "translate(-200 -100) scale(2)");
  r.zoomBy(0.5);
  assert.equal(viewport.getAttribute("transform"), fitted);
});

test("the events are the five of the interface, and no others", () => {
  const { r } = mounted();
  assert.deepEqual(EVENTS, ["select", "activate", "context", "drop", "move"]);
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

test("an architecture's component is its kind's icon on a plate, its name, its count and badge", () => {
  const arch = require("../assets/js/architecture-view.js").describe({
    profile: "architecture",
    entities: { ws: { kind: "host", label: "Workstation" }, sshd: { kind: "service", label: "SSH server", parameters: { login: { status: "unknown" } } } },
    associations: {},
    flows: {},
    attacker: { footholds: [{ entity: "ws", state: "admin" }] },
  });
  const { r, host, node } = mounted();
  r.render({ width: 400, height: 100, nodes: arch.nodes.map((n, i) => ({ id: n.id, x: 160 * i, y: 0, width: 148, height: 84, node: n })), edges: [] }, {});
  const ws = node("entity/ws");
  assert.ok(ws.classList.contains("node-component"));
  assert.ok(ws.classList.contains("component-host"));
  assert.ok(ws.classList.contains("family-compute"));
  assert.equal(dom.byClass(ws, "plate").length, 1);
  assert.ok(dom.byClass(ws, "glyph").length >= 1);
  assert.equal(dom.byClass(ws, "box").length, 0);
  assert.equal(dom.byClass(ws, "symbol").length, 0);
  assert.equal(dom.byClass(ws, "stem").length, 0);
  // The kind is the icon; in words it is the tooltip.
  const tip = (g) => g.children.find((c) => c.tag === "title").textContent;
  assert.equal(tip(ws), "Workstation — host");
  assert.deepEqual(dom.text(ws), ["Workstation", "foothold · admin"]);
  const sshd = node("entity/sshd");
  assert.ok(sshd.classList.contains("is-unquantified"));
  assert.equal(tip(sshd), "SSH server — service · 1 unknown");
  assert.deepEqual(dom.text(sshd), ["SSH server", "1?"]);
  assert.equal(dom.byClass(host, "stem").length, 0);
});

// An architecture is laid out free: components where the author dragged them,
// edges as curves between their boxes (positions.js).
const Pos = require("../assets/js/positions.js");
function freeLayout() {
  const box = (id, x, y) => ({ id, x, y, width: 148, height: 62, node: { id, label: id, lines: [id], symbol: "component", component: "host", attributes: "host", parents: 0 } });
  return Pos.place({
    nodes: [box("entity/a", 0, 0), box("entity/b", 300, 0)],
    edges: [{ id: "association/ab", from: "entity/a", to: "entity/b", label: "attached" }],
  }, {});
}

test("in a free layout a dragged node moves, its lines follow, and the move is reported", () => {
  const { r, host, node } = mounted();
  r.render(freeLayout(), {});
  const moves = [], drops = [], selects = [];
  r.on("move", (e) => moves.push(e));
  r.on("drop", (e) => drops.push(e));
  r.on("select", (e) => selects.push(e.id));
  const line = dom.byClass(host, "edge")[0];
  const before = line.getAttribute("d");
  assert.match(before, /^M[-\d. ]+Q[-\d. ]+$/);
  assert.equal(line.getAttribute("marker-end"), "url(#edge-arrow)");
  assert.deepEqual(dom.text(host).filter((t) => t === "attached"), ["attached"]);

  node("entity/b").dispatch("pointerdown", { clientX: 10, clientY: 10, button: 0, pointerId: 1 });
  node("entity/b").dispatch("pointermove", { clientX: 30, clientY: 110, pointerId: 1 });
  assert.equal(node("entity/b").getAttribute("transform"), "translate(320 100)");
  assert.notEqual(line.getAttribute("d"), before, "the line follows while dragging");
  node("entity/a").dispatch("pointerup", { clientX: 30, clientY: 110, pointerId: 1 });
  assert.deepEqual(moves, [{ id: "entity/b", x: 320, y: 100 }]);
  assert.deepEqual(drops, [], "a free layout has no drops");
  assert.deepEqual(selects, []);
});

test("a free layout that starts left of or above zero is fitted whole", () => {
  const { r, host } = mounted();
  const l = freeLayout();
  const moved = Pos.place({ nodes: l.nodes, edges: [] }, { "entity/a": { x: -200, y: -100 } });
  r.render(moved, {});
  r.fit();
  const viewport = dom.byClass(host, "viewport")[0];
  // 648 x 162 drawn from (-200, -100) in an 800 x 600 view: centred, unscaled.
  assert.equal(viewport.getAttribute("transform"), "translate(276 319) scale(1)");
});

test("reveal pans a node out from under an inset, and leaves a visible one alone", () => {
  const { r, host } = mounted();
  r.render(freeLayout(), {});
  const viewport = dom.byClass(host, "viewport")[0];
  const before = viewport.getAttribute("transform");
  // Without a transform yet the view is the identity: b spans 300..448 of 800.
  r.reveal("entity/a", 296);
  assert.equal(viewport.getAttribute("transform"), before, "a is far from the inset");
  r.reveal("entity/b", 400);
  // 800 - 400 - 16 = 384 is the free width; b ends at 448: 64 to the left.
  assert.equal(viewport.getAttribute("transform"), "translate(-64 0) scale(1)");
  r.reveal("entity/absent", 400);
  r.reveal("association/ab", 400);
  assert.equal(viewport.getAttribute("transform"), "translate(-64 0) scale(1)");
});

test("a firewall's permission is a dotted line to its flow's middle that follows either end", () => {
  const hub = { x: 74, y: 24, r: 28 };
  const comp = (id, x, y) => ({ id, x, y, width: 148, height: 84, hub, node: { id, label: id, lines: [id], symbol: "component", component: "host", attributes: null, parents: 0 } });
  const laid = Pos.place({
    nodes: [comp("entity/fw", 150, 0), comp("entity/a", 0, 200), comp("entity/b", 300, 200)],
    edges: [{ id: "flow/f", from: "entity/a", to: "entity/b", label: "f →" }],
    permits: [{ id: "association/p", firewall: "entity/fw", flow: "flow/f", allowed: true }],
  }, {});
  const { r, host, node } = mounted();
  r.render(laid, {});
  const permit = dom.byClass(host, "permit")[0];
  assert.equal(permit.getAttribute("data-id"), "association/p");
  assert.ok(dom.text(host).includes("allows"));
  const before = permit.getAttribute("d");
  const drag = (id, dx) => {
    node(id).dispatch("pointerdown", { clientX: 0, clientY: 0, button: 0, pointerId: 1 });
    node(id).dispatch("pointermove", { clientX: dx, clientY: 0, pointerId: 1 });
    node(id).dispatch("pointerup", { clientX: dx, clientY: 0, pointerId: 1 });
  };
  drag("entity/b", 40);
  const afterFlow = permit.getAttribute("d");
  assert.notEqual(afterFlow, before, "moving an end of the flow moves the line's end");
  drag("entity/fw", -40);
  assert.notEqual(permit.getAttribute("d"), afterFlow, "moving the firewall moves its start");
  r.highlight(["association/p"], "selected");
  assert.ok(permit.classList.contains("hl-selected"));
});

test("an attack graph's step says its junction, badge and state in words, and its lines carry arrowheads", () => {
  const V = require("../assets/js/attack-view.js");
  const { graph, support } = require("./fixtures/graph/lecture-graph.json");
  const blocked = JSON.parse(JSON.stringify(support));
  blocked.nodes.find((n) => n.id === "input/flow-permission/filter/ssh").status = "blocked";
  const drawn = V.describe(graph, blocked, null).graph;
  const { r, host, node } = mounted();
  r.render({
    width: 900, height: 900, arrows: true,
    nodes: drawn.nodes.map((n, i) => ({ id: n.id, x: 160 * (i % 5), y: 110 * Math.floor(i / 5), width: 148, height: 94, node: n })),
    edges: drawn.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, points: [{ x: 0, y: 0 }, { x: 0, y: 10 }] })),
  }, {});
  const login = node("step/action/service-login/server-account/sshd");
  assert.ok(dom.text(login).includes("ALL"));
  assert.ok(login.classList.contains("kind-action"));
  const target = node("step/state/host/server/admin");
  assert.ok(dom.text(target).includes("ANY"));
  assert.ok(dom.text(target).includes("target"));
  assert.ok(target.classList.contains("is-top"));
  assert.ok(dom.text(node("step/input/foothold/workstation/admin")).includes("foothold"));
  const policy = node("step/input/flow-permission/filter/ssh");
  assert.ok(policy.classList.contains("is-blocked"));
  assert.ok(dom.text(policy).includes("blocked"));
  const admin = node("step/state/network/admin-net/access");
  assert.ok(admin.classList.contains("is-unreachable"));
  assert.ok(dom.text(admin).includes("unreachable"));
  // No importance colour: the tree's classes are not borrowed.
  dom.byClass(host, "node").forEach((g) => assert.ok(![...g.classList.set].some((c) => /^imp-/.test(c))));
  const lines = dom.byClass(host, "edge");
  assert.equal(lines.length, drawn.edges.length);
  lines.forEach((l) => assert.equal(l.getAttribute("marker-end"), "url(#edge-arrow)"));
  // A tree's lines stay as they were.
  r.render(layout(), {});
  dom.byClass(host, "edge").forEach((l) => assert.equal(l.getAttribute("marker-end"), null));
});
