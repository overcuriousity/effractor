const { test } = require("node:test");
const assert = require("node:assert");
const ELK = require("elkjs");
const { describe, wrap, toElk, fromElk, SIZE } = require("../assets/js/graph.js");
const { webserver, attack } = require("./fixtures/docs.js");

const byId = (nodes) => Object.fromEntries(nodes.map((n) => [n.id, n]));

test("a repeated node is described once, with its parents counted", () => {
  const g = describe(webserver);
  assert.equal(g.nodes.length, 9);
  assert.equal(g.nodes.filter((n) => n.id === "server-outage").length, 1);
  const n = byId(g.nodes);
  assert.equal(n["server-outage"].parents, 2);
  // The incoming edges say it; no badge repeats it.
  assert.equal(n["server-outage"].badge, undefined);
  assert.equal(n["loss-of-availability"].top, true);
  // One edge per parent-child pair, in the order the children are written.
  assert.equal(g.edges.length, 9);
  assert.deepEqual(
    g.edges.filter((e) => e.from === "no-function").map((e) => e.to),
    ["hardware", "software", "malware", "server-outage"]
  );
});

test("fault-tree gates are inscribed as DIN 25424 has them", () => {
  const n = byId(describe(webserver).nodes);
  assert.equal(n["no-access"].symbol, "gate");
  assert.equal(n["no-access"].inscription, "≥1");
  assert.equal(n.hardware.symbol, "basic");
  assert.equal(n.malware.symbol, "undeveloped");
  assert.equal(n.hardware.attributes, null);
  const doc = JSON.parse(JSON.stringify(webserver));
  doc.nodes["no-access"].gate = "and";
  doc.nodes["no-function"].gate = "vote";
  doc.nodes["no-function"].k = 3;
  const m = byId(describe(doc).nodes);
  assert.equal(m["no-access"].inscription, "&");
  assert.equal(m["no-function"].inscription, "≥3");
});

test("attack trees say AND and OR, and leaves show cost and detection", () => {
  const n = byId(describe(attack).nodes);
  assert.equal(n.files.inscription, "OR");
  assert.equal(n.account.inscription, "AND");
  assert.equal(n.physical.inscription, "2/3");
  assert.equal(n.phish.attributes, "cost 200 · det 0.3");
  assert.equal(n.mfa.attributes, "cost 50 · det —");
  assert.equal(n.key.attributes, "cost — · det —");
});

test("nodes the top cannot reach are drawn too, and said to be unreachable", () => {
  const doc = JSON.parse(JSON.stringify(attack));
  doc.nodes.spare = { label: "Spare", leaf: "basic" };
  const n = byId(describe(doc).nodes);
  assert.equal(n.spare.unreachable, true);
  assert.equal(n.phish.unreachable, false);
});

test("a dangling child makes no edge and no crash", () => {
  const doc = JSON.parse(JSON.stringify(attack));
  doc.nodes.account.children.push("nobody");
  assert.equal(describe(doc).edges.filter((e) => e.to === "nobody").length, 0);
});

test("labels wrap on words, and what does not fit ends in an ellipsis", () => {
  assert.deepEqual(wrap("Malware", 20, 2), ["Malware"]);
  assert.deepEqual(wrap("Error in the administration", 20, 2), ["Error in the", "administration"]);
  assert.deepEqual(wrap("one two three four five six seven eight nine ten", 12, 2), ["one two", "three four…"]);
  // A word longer than a line is cut rather than allowed to overflow its box.
  assert.deepEqual(wrap("Donaudampfschifffahrtsgesellschaft", 12, 2), ["Donaudampfs…"]);
  assert.deepEqual(wrap("", 12, 2), [""]);
});

test("the ELK graph pins edges to the bottom and top centres, in written order", () => {
  const elk = toElk(describe(webserver));
  assert.equal(elk.layoutOptions["elk.algorithm"], "layered");
  assert.equal(elk.layoutOptions["elk.direction"], "DOWN");
  const top = elk.children.find((c) => c.id === "loss-of-availability");
  assert.deepEqual([top.width, top.height], [SIZE.width, SIZE.gate]);
  assert.deepEqual(top.ports.map((p) => [p.id, p.x, p.y]), [
    ["loss-of-availability:in", SIZE.width / 2, 0],
    ["loss-of-availability:out", SIZE.width / 2, SIZE.gate],
  ]);
  const leaf = elk.children.find((c) => c.id === "hardware");
  assert.equal(leaf.height, SIZE.leaf);
  assert.deepEqual(elk.edges[0], {
    id: "loss-of-availability>no-access",
    sources: ["loss-of-availability:out"],
    targets: ["no-access:in"],
  });
  // The attribute strip makes an attack-tree leaf taller; being shared does not.
  const a = toElk(describe(attack));
  assert.equal(a.children.find((c) => c.id === "mfa").height, SIZE.leaf + SIZE.strip);
  assert.equal(a.children.find((c) => c.id === "phish").height, SIZE.leaf + SIZE.strip);
});

test("ELK lays the reference tree out top-down without overlaps", async () => {
  const graph = describe(webserver);
  const layout = fromElk(graph, await new ELK().layout(toElk(graph)));
  assert.equal(layout.nodes.length, 9);
  assert.ok(layout.width > 0 && layout.height > 0);
  const at = byId(layout.nodes);
  for (const e of layout.edges) {
    assert.ok(at[e.from].y + at[e.from].height <= at[e.to].y, `${e.from} is above ${e.to}`);
    assert.ok(e.points.length >= 2);
    // An edge starts under its gate's symbol and ends on top of its child.
    assert.equal(e.points[0].x, at[e.from].x + SIZE.width / 2);
    assert.equal(e.points[e.points.length - 1].y, at[e.to].y);
  }
  const boxes = layout.nodes;
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      assert.ok(apart, `${a.id} overlaps ${b.id}`);
    }
  // Children left to right as written.
  assert.ok(at["no-access"].x < at["no-function"].x);
  // The description rides along for the renderer.
  assert.equal(at.malware.node.symbol, "undeveloped");
});

test("an id may be any word, including the ones JavaScript objects are born with", () => {
  const doc = {
    profile: "fault-tree",
    top: "constructor",
    nodes: {
      constructor: { label: "C", gate: "or", children: ["tostring", "valueof", "hasownproperty"] },
      tostring: { label: "T", leaf: "basic" },
      valueof: { label: "V", gate: "and", children: ["tostring", "__proto__"] },
      hasownproperty: { label: "H", leaf: "basic" },
    },
  };
  const g = describe(doc);
  const n = byId(g.nodes);
  assert.equal(n.constructor.parents, 0);
  assert.equal(n.tostring.parents, 2);
  assert.equal(n.valueof.unreachable, false);
  // `__proto__` is no node here, so it is no edge.
  assert.equal(g.edges.length, 4);
});

// Two edges from different gates running along the same line read as one
// connection: the drawing would then claim children a gate does not have.
function overlaps(layout) {
  const segments = [];
  for (const e of layout.edges)
    for (let i = 1; i < e.points.length; i++) segments.push({ from: e.from, a: e.points[i - 1], b: e.points[i], id: e.id });
  const found = [];
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const [s, t] = [segments[i], segments[j]];
      if (s.from === t.from) continue; // one gate's own branches share a trunk
      for (const [u, v] of [["x", "y"], ["y", "x"]]) {
        if (s.a[u] !== s.b[u] || t.a[u] !== t.b[u] || s.a[u] !== t.a[u]) continue;
        const lo = Math.max(Math.min(s.a[v], s.b[v]), Math.min(t.a[v], t.b[v]));
        const hi = Math.min(Math.max(s.a[v], s.b[v]), Math.max(t.a[v], t.b[v]));
        if (hi - lo > 0.5) found.push(s.id + " ∥ " + t.id);
      }
    }
  return found;
}

for (const [name, doc] of Object.entries({ webserver, attack })) {
  test(`in ${name}, edges from different gates never share a line`, async () => {
    const { layoutWith } = require("../assets/js/graph.js");
    const layout = await layoutWith((g) => new ELK().layout(g), describe(doc));
    assert.deepEqual(overlaps(layout), []);
    // A shared node takes each parent at a place of its own, left parent left.
    const shared = describe(doc).nodes.find((n) => n.parents > 1).id;
    const at = byId(layout.nodes);
    const arrivals = layout.edges
      .filter((e) => e.to === shared)
      .map((e) => ({ parent: at[e.from].x, x: e.points[e.points.length - 1].x }))
      .sort((p, q) => p.parent - q.parent);
    assert.ok(arrivals.length > 1);
    for (let i = 1; i < arrivals.length; i++) assert.ok(arrivals[i - 1].x < arrivals[i].x, JSON.stringify(arrivals));
  });
}

test("a tree with nothing shared is laid out once", async () => {
  const { layoutWith } = require("../assets/js/graph.js");
  let calls = 0;
  const doc = JSON.parse(JSON.stringify(attack));
  doc.nodes.physical.children = ["key", "alarm"];
  doc.nodes.physical.k = 1;
  await layoutWith((g) => (calls++, new ELK().layout(g)), describe(doc));
  assert.equal(calls, 1);
});
