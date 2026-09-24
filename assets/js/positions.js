// Where an architecture's components are, once the author has moved them:
// the automatic layout places everything, a component that was dragged stays
// where it was put. Positions are this browser's, per document — never in
// the file. Edges are drawn as in an investigation graph: a straight line
// from box border to box border, the label halfway, links between the same
// two components side by side. Pure but for the storage handed in.
(function () {
  var PREFIX = "effractor.positions:";
  var SPREAD = 20; // px between links that share their two ends

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  // A node with a `hub` ({x, y, r}, relative to its box) is met on that
  // circle — an architecture component's plate — and not on its box.
  function center(n) {
    if (n.hub) return { x: n.x + n.hub.x, y: n.y + n.hub.y };
    return { x: n.x + n.width / 2, y: n.y + n.height / 2 };
  }

  // Where the ray from a box's centre towards `toward` leaves the box.
  function border(n, toward) {
    var c = center(n);
    var dx = toward.x - c.x;
    var dy = toward.y - c.y;
    if (!dx && !dy) return c;
    if (n.hub) {
      var len = Math.sqrt(dx * dx + dy * dy);
      return { x: c.x + (dx / len) * n.hub.r, y: c.y + (dy / len) * n.hub.r };
    }
    var t = Math.min(dx ? n.width / 2 / Math.abs(dx) : Infinity, dy ? n.height / 2 / Math.abs(dy) : Infinity);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  // Where the ray from `p`, inside the box, along the unit direction `d`
  // leaves it; `p` itself when it is not inside.
  function exit(n, p, d) {
    if (n.hub) {
      var c = center(n);
      var ox = p.x - c.x;
      var oy = p.y - c.y;
      var b = ox * d.x + oy * d.y;
      var q = b * b - (ox * ox + oy * oy - n.hub.r * n.hub.r);
      if (q < 0) return p;
      var s = Math.max(0, -b + Math.sqrt(q));
      return { x: p.x + d.x * s, y: p.y + d.y * s };
    }
    var tx = d.x > 0 ? (n.x + n.width - p.x) / d.x : d.x < 0 ? (n.x - p.x) / d.x : Infinity;
    var ty = d.y > 0 ? (n.y + n.height - p.y) / d.y : d.y < 0 ? (n.y - p.y) / d.y : Infinity;
    var t = Math.max(0, Math.min(tx, ty));
    return { x: p.x + d.x * t, y: p.y + d.y * t };
  }

  function byId(nodes) {
    var out = Object.create(null);
    nodes.forEach(function (n) {
      out[n.id] = n;
    });
    return out;
  }

  // The line of `edge` between its two boxes as they now stand. `edge.bend`
  // is its sideways offset from the line between the centres, measured in
  // the frame of the two ids in sorted order, so a→b and b→a lie on
  // different sides.
  function route(nodes, edge) {
    var at = Array.isArray(nodes) ? byId(nodes) : nodes;
    var a = at[edge.from];
    var b = at[edge.to];
    if (!a || !b) return null;
    var ca = center(a);
    var cb = center(b);
    var first = edge.from < edge.to ? ca : cb;
    var second = edge.from < edge.to ? cb : ca;
    var dx = second.x - first.x;
    var dy = second.y - first.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var bend = edge.bend || 0;
    var start, end;
    if (bend) {
      var off = { x: (-dy / len) * bend, y: (dx / len) * bend };
      var ab = Math.hypot(cb.x - ca.x, cb.y - ca.y) || 1;
      var d = { x: (cb.x - ca.x) / ab, y: (cb.y - ca.y) / ab };
      start = exit(a, { x: ca.x + off.x, y: ca.y + off.y }, d);
      end = exit(b, { x: cb.x + off.x, y: cb.y + off.y }, { x: -d.x, y: -d.y });
    } else {
      start = border(a, cb);
      end = border(b, ca);
    }
    var mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    return Object.assign({}, edge, { start: start, end: end, mid: mid });
  }

  var WORD = { true: "allows", false: "blocks", null: "?" };

  // The point a fraction `t` along a routed line.
  function along(r, t) {
    return { x: r.start.x + (r.end.x - r.start.x) * t, y: r.start.y + (r.end.y - r.start.y) * t };
  }

  // A firewall's permission: a straight line from the firewall's ring to the
  // flow it rules on, `flow` as that flow's line now stands. It lands a
  // third of the way in from whichever end is nearer the firewall, clear of
  // the flow's own label in the middle.
  // One that ends on a component or a cluster (`permit.node`) meets its ring.
  function attach(nodes, flow, permit) {
    var at = Array.isArray(nodes) ? byId(nodes) : nodes;
    var fw = at[permit.firewall];
    if (permit.node) {
      var to = at[permit.node];
      if (!fw || !to) return null;
      var from = border(fw, center(to));
      var into = border(to, center(fw));
      return { id: permit.id, firewall: permit.firewall, flow: null, node: permit.node, allowed: permit.allowed, label: permit.label || WORD[permit.allowed], start: from, end: into, mid: { x: (from.x + into.x) / 2, y: (from.y + into.y) / 2 } };
    }
    if (!fw || !flow) return null;
    var c = center(fw);
    var near = along(flow, 0.35);
    var far = along(flow, 0.65);
    var end = Math.hypot(near.x - c.x, near.y - c.y) <= Math.hypot(far.x - c.x, far.y - c.y) ? near : far;
    var start = border(fw, end);
    return {
      id: permit.id,
      firewall: permit.firewall,
      flow: permit.flow,
      allowed: permit.allowed,
      label: permit.label || WORD[permit.allowed],
      start: start,
      end: end,
      mid: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    };
  }

  var PAD = 10; // px round an open cluster's members

  // An open cluster's outline round its members as they now stand, or null
  // when none of them is drawn.
  function outline(at, group) {
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    group.members.forEach(function (id) {
      var n = at[id];
      if (!n) return;
      any = true;
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height);
    });
    if (!any) return null;
    return { id: group.id, label: group.label, members: group.members, x: x0 - PAD, y: y0 - PAD, width: x1 - x0 + 2 * PAD, height: y1 - y0 + 2 * PAD };
  }

  // The layout with the stored positions laid over it, its size and origin
  // measured from what is on it, every edge routed as a line, and — unless
  // `options.permits` is false — every firewall's permissions drawn to the
  // flows they rule on; unless `options.outlines` is false, an outline round
  // each open cluster.
  function place(laid, stored, options) {
    var nodes = (laid.nodes || []).map(function (n) {
      var p = has(stored, n.id) ? stored[n.id] : null;
      return p ? Object.assign({}, n, { x: p.x, y: p.y }) : n;
    });
    var groups = Object.create(null);
    var edges = (laid.edges || []).map(function (e) {
      var key = e.from < e.to ? e.from + "\u0000" + e.to : e.to + "\u0000" + e.from;
      (groups[key] = groups[key] || []).push(e.id);
      return { id: e.id, from: e.from, to: e.to, label: e.label, title: e.title, key: key };
    });
    var at = byId(nodes);
    edges = edges
      .map(function (e) {
        var group = groups[e.key];
        var bend = (group.indexOf(e.id) - (group.length - 1) / 2) * SPREAD;
        return route(at, { id: e.id, from: e.from, to: e.to, label: e.label, title: e.title, bend: bend });
      })
      .filter(Boolean);
    var routed = Object.create(null);
    edges.forEach(function (e) {
      routed[e.id] = e;
    });
    var permits = options && options.permits === false ? [] : laid.permits || [];
    var attachments = permits
      .map(function (p) {
        return attach(at, routed[p.flow], p);
      })
      .filter(Boolean);
    var outlines = (options && options.outlines === false ? [] : laid.groups || []).map(function (g) {
      return outline(at, g);
    }).filter(Boolean);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.concat(outlines).forEach(function (n) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height);
    });
    if (!nodes.length) x0 = y0 = x1 = y1 = 0;
    return { free: true, x0: x0, y0: y0, width: x1 - x0, height: y1 - y0, nodes: nodes, edges: edges, attachments: attachments, outlines: outlines };
  }

  // `storage`: localStorage or anything with its three methods, or null.
  // Every call survives a storage that refuses (private windows, blocked
  // site data): the positions are a convenience, never a requirement.
  function createStore(storage) {
    function load(name) {
      try {
        var text = storage ? storage.getItem(PREFIX + name) : null;
        var value = text ? JSON.parse(text) : null;
        return value && typeof value === "object" && !Array.isArray(value) ? value : {};
      } catch (e) {
        return {};
      }
    }
    function move(name, id, x, y) {
      var all = load(name);
      all[id] = { x: Math.round(x), y: Math.round(y) };
      try {
        if (storage) storage.setItem(PREFIX + name, JSON.stringify(all));
      } catch (e) {
        /* kept for this page only */
      }
    }
    // Several at once, one write: {id: {x, y}}, or null to forget one.
    function moveAll(name, places) {
      var all = load(name);
      Object.keys(places).forEach(function (id) {
        var p = places[id];
        if (p) all[id] = { x: Math.round(p.x), y: Math.round(p.y) };
        else delete all[id];
      });
      try {
        if (storage) storage.setItem(PREFIX + name, JSON.stringify(all));
      } catch (e) {
        /* kept for this page only */
      }
    }
    function clear(name) {
      try {
        if (storage) storage.removeItem(PREFIX + name);
      } catch (e) {
        /* nothing to clear */
      }
    }
    return { load: load, move: move, moveAll: moveAll, clear: clear };
  }

  var api = { place: place, route: route, attach: attach, along: along, outline: outline, createStore: createStore };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorPositions = api;
})();
