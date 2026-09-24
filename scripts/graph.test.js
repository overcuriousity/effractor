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

test("an architecture's component is its plate and name; lines meet the plate", () => {
  const V = require("../assets/js/architecture-view.js");
  const graph = V.describe({ profile: "architecture", entities: { ws: { kind: "host", label: "Workstation" } }, associations: {}, flows: {}, attacker: { footholds: [] } });
  assert.equal(toElk(graph).children[0].height, SIZE.component);
  const laid = fromElk(graph, { width: 148, height: SIZE.component, children: [{ id: "entity/ws", x: 5, y: 7, width: SIZE.width, height: SIZE.component }], edges: [] });
  assert.deepEqual(laid.nodes[0].hub, { x: SIZE.width / 2, y: SIZE.plate / 2, r: SIZE.plate / 2 + SIZE.halo });
  // A tree's node has no plate: its lines keep to the box.
  const tree = describe(webserver);
  const first = tree.nodes[0];
  assert.equal(fromElk(tree, { children: [{ id: first.id, x: 0, y: 0, width: 1, height: 1 }], edges: [] }).nodes[0].hub, undefined);
});

test("an architecture is laid out as a network: stress, no ports, flows never pull, a firewall pulled to its flows", () => {
  const V = require("../assets/js/architecture-view.js");
  const graph = V.describe({
    profile: "architecture",
    entities: { fw: { kind: "firewall", label: "FW" }, cli: { kind: "application", label: "Client" }, sshd: { kind: "service", label: "SSH" } },
    associations: { p: { kind: "permits", from: "fw", to: "ssh", allowed: true } },
    flows: { ssh: { label: "SSH", source: "cli", target: "sshd", route: [] } },
    attacker: { footholds: [] },
  });
  const elk = toElk(graph);
  assert.equal(elk.layoutOptions["elk.algorithm"], "stress");
  assert.ok(elk.children.every((c) => !c.ports));
  assert.deepEqual(elk.edges.map((e) => [e.sources[0], e.targets[0]]), [["entity/fw", "entity/cli"], ["entity/fw", "entity/sshd"]]);
});

test("ELK's stress layout of an architecture leaves no two components overlapping, and draws no pulls", async () => {
  const ELK = require("elkjs");
  const V = require("../assets/js/architecture-view.js");
  const { layoutWith } = require("../assets/js/graph.js");
  const entities = {};
  ["network", "router", "firewall", "host", "application", "service", "account", "credential"].forEach((kind, i) => {
    entities["e" + i] = { kind, label: kind };
    entities["f" + i] = { kind, label: kind + " 2" };
  });
  const graph = V.describe({
    profile: "architecture",
    entities,
    associations: { a: { kind: "hosts", from: "e3", to: "e4", privilege: "user" }, b: { kind: "attached", from: "e3", to: "e0" }, p: { kind: "permits", from: "e2", to: "fl", allowed: false } },
    flows: { fl: { label: "x", source: "e4", target: "e5", route: [] } },
    attacker: { footholds: [] },
  });
  const run = (g) => new ELK().layout(g);
  const laid = await layoutWith(run, graph);
  assert.equal(laid.nodes.length, 16);
  for (let i = 0; i < laid.nodes.length; i++) {
    for (let j = i + 1; j < laid.nodes.length; j++) {
      const a = laid.nodes[i], b = laid.nodes[j];
      const apart = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
      assert.ok(apart, a.id + " overlaps " + b.id);
    }
  }
  assert.deepEqual(laid.edges.map((e) => e.id).sort(), ["association/a", "association/b", "flow/fl"]);
  assert.deepEqual(laid.permits, [{ id: "association/p", firewall: "entity/e2", flow: "flow/fl", allowed: false }]);
  assert.deepEqual((await layoutWith(run, graph)).nodes, laid.nodes, "the same file is arranged the same way");
});

test("separate pushes overlapping boxes apart by the gap, and leaves clear ones as they are", () => {
  const { separate } = require("../assets/js/graph.js");
  const clear = [{ id: "a", x: 0, y: 0, width: 10, height: 10 }, { id: "b", x: 50, y: 0, width: 10, height: 10 }];
  assert.deepEqual(separate(clear, 5), clear);
  const out = separate([{ id: "a", x: 0, y: 0, width: 10, height: 10 }, { id: "b", x: 4, y: 1, width: 10, height: 10 }, { id: "c", x: 4, y: 1, width: 10, height: 10 }], 5);
  for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
    const a = out[i], b = out[j];
    assert.ok(a.x + a.width + 5 <= b.x + 1e-6 || b.x + b.width + 5 <= a.x + 1e-6 || a.y + a.height + 5 <= b.y + 1e-6 || b.y + b.height + 5 <= a.y + 1e-6, a.id + " " + b.id);
  }
  assert.equal(Math.min(...out.map((b) => b.x)), 0);
  assert.equal(Math.min(...out.map((b) => b.y)), 0);
});

// ---- grouped by host (owner, 2026-09-24): a host, its software, their products ----

const V = require("../assets/js/architecture-view.js");
const { blocks, layoutWith } = require("../assets/js/graph.js");

// Two hosts on one network: "box" runs dns and http (each with its own
// product) and a router; "pc" runs ssh on OpenSSH, which "box"'s http also
// uses, so OpenSSH is shared and stays out of both blocks.
function lan() {
  return {
    profile: "architecture",
    entities: {
      net: { kind: "network", label: "LAN" },
      box: { kind: "host", label: "Box" },
      rt: { kind: "router", label: "Box router" },
      dns: { kind: "service", label: "dns" },
      nsd: { kind: "product", label: "NSD" },
      http: { kind: "service", label: "http" },
      web: { kind: "product", label: "Web UI" },
      pc: { kind: "host", label: "PC" },
      ssh: { kind: "service", label: "ssh" },
      openssh: { kind: "product", label: "OpenSSH" },
      nmap: { kind: "application", label: "nmap" },
      lone: { kind: "host", label: "Lone" },
    },
    associations: {
      a1: { kind: "attached", from: "box", to: "net" },
      a2: { kind: "attached", from: "pc", to: "net" },
      a3: { kind: "hosts", from: "box", to: "dns", privilege: "unknown" },
      a4: { kind: "hosts", from: "box", to: "http", privilege: "unknown" },
      a5: { kind: "instance-of", from: "dns", to: "nsd" },
      a6: { kind: "instance-of", from: "http", to: "web" },
      a7: { kind: "hosts", from: "pc", to: "ssh", privilege: "unknown" },
      a8: { kind: "instance-of", from: "ssh", to: "openssh" },
      a9: { kind: "instance-of", from: "http", to: "openssh" },
      a10: { kind: "hosts", from: "box", to: "rt", privilege: "admin" },
      a11: { kind: "attached", from: "rt", to: "net" },
      a12: { kind: "hosts", from: "pc", to: "nmap", privilege: "user" },
    },
    flows: {
      f1: { label: "dns", source: "nmap", target: "dns", route: ["net"] },
      f2: { label: "http", source: "nmap", target: "http", route: ["net"] },
    },
    attacker: { footholds: [] },
  };
}

test("a block is a host with the software it runs and the products only that software uses", () => {
  const b = blocks(V.describe(lan()));
  assert.deepEqual(Object.keys(b.blocks), ["entity/box", "entity/pc"], "a host that runs nothing is no block");
  assert.deepEqual(b.blocks["entity/box"].members, ["entity/box", "entity/dns", "entity/nsd", "entity/http", "entity/web"]);
  assert.deepEqual(b.blocks["entity/pc"].members, ["entity/pc", "entity/ssh", "entity/nmap"]);
  assert.equal(b.of["entity/openssh"], undefined, "a product two hosts use is shared");
  assert.equal(b.of["entity/rt"], undefined, "a router on its box keeps its own place, between its networks");
  const at = b.blocks["entity/box"].at;
  // The host on top, centred; its services in a row under it; each product under its service.
  assert.ok(at["entity/dns"].y > at["entity/box"].y && at["entity/dns"].y === at["entity/http"].y);
  assert.ok(at["entity/nsd"].y > at["entity/dns"].y && at["entity/nsd"].x === at["entity/dns"].x);
  assert.equal(at["entity/web"].x, at["entity/http"].x);
  assert.ok(at["entity/dns"].x < at["entity/http"].x, "in the file's order");
  const w = b.blocks["entity/box"].width;
  assert.equal(at["entity/box"].x + SIZE.width / 2, w / 2, "the host is centred over its row");
});

test("a host with many services wraps them into rows of five", () => {
  const doc = lan();
  for (let i = 0; i < 7; i++) {
    doc.entities["s" + i] = { kind: "service", label: "s" + i };
    doc.associations["h" + i] = { kind: "hosts", from: "lone", to: "s" + i, privilege: "unknown" };
  }
  const block = blocks(V.describe(doc)).blocks["entity/lone"];
  const ys = [...new Set(["s0", "s1", "s2", "s3", "s4", "s5", "s6"].map((s) => block.at["entity/" + s].y))];
  assert.equal(ys.length, 2, "two rows");
  assert.equal(block.at["entity/s5"].x, block.at["entity/s0"].x, "the sixth starts the second row");
});

test("arranged: every block keeps its shape, nothing overlaps, and flows move nothing", async () => {
  const run = (g) => new ELK().layout(g);
  const graph = V.describe(lan());
  const laid = await layoutWith(run, graph);
  const pos = byId(laid.nodes);
  const b = blocks(graph);
  for (const [host, block] of Object.entries(b.blocks)) {
    for (const m of block.members) {
      assert.equal(pos[m].x - pos[host].x, block.at[m].x - block.at[host].x, m + " keeps its place in " + host);
      assert.equal(pos[m].y - pos[host].y, block.at[m].y - block.at[host].y, m + " keeps its place in " + host);
    }
  }
  for (let i = 0; i < laid.nodes.length; i++) {
    for (let j = i + 1; j < laid.nodes.length; j++) {
      const a = laid.nodes[i], c = laid.nodes[j];
      const apart = a.x + a.width <= c.x || c.x + c.width <= a.x || a.y + a.height <= c.y || c.y + c.height <= a.y;
      assert.ok(apart, a.id + " overlaps " + c.id);
    }
  }
  const noFlows = lan();
  noFlows.flows = {};
  const bare = await layoutWith(run, V.describe(noFlows));
  assert.deepEqual(bare.nodes.map((n) => [n.id, n.x, n.y]), laid.nodes.map((n) => [n.id, n.x, n.y]), "flows are drawn, never pulled");
  assert.deepEqual(laid.edges.map((e) => e.id).sort(), Object.keys(lan().associations).map((k) => "association/" + k).concat(["flow/f1", "flow/f2"]).sort(), "every line is still drawn");
});

test("an open cluster is laid out as a block, its first member on top", () => {
  const G = require("../assets/js/graph.js");
  const node = (id, component) => ({ id: "entity/" + id, component, symbol: "component", lines: [id] });
  const graph = {
    nodes: [node("box", "host"), node("r", "router"), node("a", "service"), node("p", "product"), node("x", "host")],
    edges: [
      { id: "h1", from: "entity/box", to: "entity/r", kind: "hosts" },
      { id: "h2", from: "entity/box", to: "entity/a", kind: "hosts" },
      { id: "i1", from: "entity/a", to: "entity/p", kind: "instance-of" },
    ],
    groups: [{ id: "cluster/c", label: "c", members: ["entity/box", "entity/r", "entity/a", "entity/p"] }],
  };
  const b = G.blocks(graph);
  assert.deepStrictEqual(Object.keys(b.blocks), ["entity/box"]);
  const block = b.blocks["entity/box"];
  assert.deepStrictEqual(block.members, ["entity/box", "entity/r", "entity/a", "entity/p"]);
  assert.strictEqual(block.at["entity/box"].y, 0);
  assert.strictEqual(block.at["entity/r"].y, block.at["entity/a"].y, "router in the software row");
  assert.strictEqual(block.at["entity/p"].x, block.at["entity/a"].x, "product under its user");
  assert.ok(block.at["entity/p"].y > block.at["entity/a"].y);
  assert.strictEqual(b.of["entity/x"], undefined);
});
