// Where an architecture's components are, once the author has moved them:
// the automatic layout places everything, a component that was dragged stays
// where it was put. Positions are this browser's, per document — never in
// the file. Edges are drawn as in an investigation graph: a gentle curve from
// box border to box border, the label halfway, links between the same two
// components bent apart. Pure but for the storage handed in.
(function () {
  var PREFIX = "effractor.positions:";
  var SPREAD = 36; // px between links that share their two ends
  var SINGLE = 14; // a lone link still bends a little

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

  function byId(nodes) {
    var out = Object.create(null);
    nodes.forEach(function (n) {
      out[n.id] = n;
    });
    return out;
  }

  // The curve of `edge` between its two boxes as they now stand. `edge.bend`
  // is its offset from the straight line, measured in the frame of the two
  // ids in sorted order, so a→b and b→a bend to different sides.
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
    var control = { x: (ca.x + cb.x) / 2 - (dy / len) * bend * 2, y: (ca.y + cb.y) / 2 + (dx / len) * bend * 2 };
    var start = border(a, control);
    var end = border(b, control);
    var mid = {
      x: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
      y: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
    };
    return Object.assign({}, edge, { start: start, control: control, end: end, mid: mid });
  }

  // The layout with the stored positions laid over it, its size and origin
  // measured from what is on it, and every edge routed as a curve.
  function place(laid, stored) {
    var nodes = (laid.nodes || []).map(function (n) {
      var p = has(stored, n.id) ? stored[n.id] : null;
      return p ? Object.assign({}, n, { x: p.x, y: p.y }) : n;
    });
    var groups = Object.create(null);
    var edges = (laid.edges || []).map(function (e) {
      var key = e.from < e.to ? e.from + "\u0000" + e.to : e.to + "\u0000" + e.from;
      (groups[key] = groups[key] || []).push(e.id);
      return { id: e.id, from: e.from, to: e.to, label: e.label, key: key };
    });
    var at = byId(nodes);
    edges = edges
      .map(function (e) {
        var group = groups[e.key];
        var bend = group.length === 1 ? SINGLE : (group.indexOf(e.id) - (group.length - 1) / 2) * SPREAD;
        return route(at, { id: e.id, from: e.from, to: e.to, label: e.label, bend: bend });
      })
      .filter(Boolean);
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    nodes.forEach(function (n) {
      x0 = Math.min(x0, n.x);
      y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + n.width);
      y1 = Math.max(y1, n.y + n.height);
    });
    if (!nodes.length) x0 = y0 = x1 = y1 = 0;
    return { free: true, x0: x0, y0: y0, width: x1 - x0, height: y1 - y0, nodes: nodes, edges: edges };
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
    function clear(name) {
      try {
        if (storage) storage.removeItem(PREFIX + name);
      } catch (e) {
        /* nothing to clear */
      }
    }
    return { load: load, move: move, clear: clear };
  }

  var api = { place: place, route: route, createStore: createStore };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorPositions = api;
})();
