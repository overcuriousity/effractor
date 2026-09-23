// Document → what is drawn, and what ELK is asked to lay out. Pure: no DOM, no
// ELK, no SVG. The one place that knows how a profile labels its symbols.
(function () {
  // One geometry for both profiles (spec 7.1). A node is a description box, a
  // stem, and its symbol under it; an attack-tree leaf adds a strip for cost
  // and detection between box and stem. A shared node is drawn once; its
  // incoming edges are what say it is shared.
  var SIZE = { width: 148, box: 44, stem: 10, symbol: 40, strip: 18, plate: 48, halo: 4, reach: 190, clear: 20 };
  SIZE.gate = SIZE.box + SIZE.stem + SIZE.symbol;
  SIZE.leaf = SIZE.gate;
  // An architecture's component: its plate, and two lines of name under it.
  SIZE.component = SIZE.plate + 36;

  var LABEL = { chars: 22, lines: 2 };

  // Greedy word wrap by character count — the renderer has no text metrics
  // until it is in a browser, and the layout is needed before that. What does
  // not fit ends in an ellipsis; the full label is the node's tooltip.
  function wrap(text, chars, lines) {
    var words = String(text).split(/\s+/).filter(Boolean);
    var out = [];
    var line = "";
    for (var i = 0; i < words.length; i++) {
      var next = line ? line + " " + words[i] : words[i];
      if (next.length <= chars) {
        line = next;
        continue;
      }
      if (out.length === lines - 1 || !line) {
        // The last line, or a word no line can hold: cut here.
        var rest = (line ? next : words[i]).slice(0, chars - 1).replace(/\s+$/, "");
        out.push(rest + "…");
        return out;
      }
      out.push(line);
      line = words[i];
      if (line.length > chars) {
        out.push(line.slice(0, chars - 1) + "…");
        return out;
      }
    }
    out.push(line);
    return out;
  }

  function inscription(node, attack) {
    var n = (node.children || []).length;
    if (node.gate === "and") return attack ? "AND" : "&";
    if (node.gate === "or") return attack ? "OR" : "≥1";
    return attack ? node.k + "/" + n : "≥" + node.k;
  }

  // An id is any word, `constructor` and `__proto__` included, so a map keyed
  // by id is an object with no prototype, and a lookup asks for an own key.
  function dict() {
    return Object.create(null);
  }

  function has(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function shown(v) {
    return typeof v === "number" ? String(v) : "—";
  }

  function describe(doc) {
    var attack = doc.profile === "attack-tree";
    var ids = Object.keys(doc.nodes || {});
    var parents = dict();
    var edges = [];
    ids.forEach(function (id) {
      (doc.nodes[id].children || []).forEach(function (child) {
        // A dangling child is a diagnostic elsewhere; here it is just no edge.
        if (!has(doc.nodes, child)) return;
        parents[child] = (parents[child] || 0) + 1;
        edges.push({ id: id + ">" + child, from: id, to: child });
      });
    });

    // Reachability from the top, iteratively: a model is user input.
    var reached = dict();
    var stack = has(doc.nodes || {}, doc.top) ? [doc.top] : [];
    while (stack.length) {
      var at = stack.pop();
      if (reached[at]) continue;
      reached[at] = true;
      (doc.nodes[at].children || []).forEach(function (c) {
        if (has(doc.nodes, c)) stack.push(c);
      });
    }

    var nodes = ids.map(function (id) {
      var node = doc.nodes[id];
      var gate = typeof node.gate === "string";
      var n = parents[id] || 0;
      return {
        id: id,
        label: String(node.label == null ? id : node.label),
        lines: wrap(node.label == null ? id : node.label, LABEL.chars, LABEL.lines),
        symbol: gate ? "gate" : node.leaf === "undeveloped" ? "undeveloped" : "basic",
        inscription: gate ? inscription(node, attack) : null,
        attributes: !gate && attack ? "cost " + shown(node.cost) + " · det " + shown(node.detection) : null,
        parents: n,
        // No p, rate or ttc: the tree is still good for cut sets, not for numbers.
        unquantified: !gate && node.p === undefined && node.rate === undefined && node.ttc === undefined,
        top: id === doc.top,
        unreachable: !reached[id],
      };
    });
    return { profile: doc.profile, nodes: nodes, edges: edges };
  }

  // An architecture's component is its plate and name: no stem, no symbol.
  function height(node) {
    if (node.symbol === "component") return SIZE.component;
    return SIZE.gate + (node.attributes ? SIZE.strip : 0);
  }

  // `arrivals` maps a shared node to its parents, left to right: each then
  // arrives at a port of its own along the top. With one port for all of them
  // the incoming edges merge, and merge with whatever else passes — the drawing
  // would give a gate children it does not have. Without `arrivals` (the first
  // pass, before anyone knows where the parents are) everything arrives centre.
  function toElk(graph, arrivals) {
    if (graph.profile === "architecture") return toStress(graph);
    arrivals = arrivals || dict();
    function inPort(e) {
      var order = arrivals[e.to];
      return e.to + ":in" + (order ? ":" + order.indexOf(e.from) : "");
    }
    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "DOWN",
        "elk.edgeRouting": "ORTHOGONAL",
        // Children left to right in the order the document lists them.
        "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
        "elk.layered.spacing.nodeNodeBetweenLayers": "36",
        "elk.spacing.nodeNode": "24",
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      },
      children: graph.nodes.map(function (n) {
        var h = height(n);
        var order = arrivals[n.id];
        var ins = order
          ? order.map(function (_, i) {
              return { id: n.id + ":in:" + i, x: (SIZE.width * (i + 1)) / (order.length + 1), y: 0, width: 0, height: 0 };
            })
          : [{ id: n.id + ":in", x: SIZE.width / 2, y: 0, width: 0, height: 0 }];
        return {
          id: n.id,
          width: SIZE.width,
          height: h,
          // Edges leave under the symbol and arrive on top of the box.
          layoutOptions: { "elk.portConstraints": "FIXED_POS" },
          ports: ins.concat([{ id: n.id + ":out", x: SIZE.width / 2, y: h, width: 0, height: 0 }]),
        };
      }),
      edges: graph.edges.map(function (e) {
        return { id: e.id, sources: [e.from + ":out"], targets: [inPort(e)] };
      }),
    };
  }

  // An architecture is a network, not a tree: ELK's stress layout puts linked
  // components near each other and the rest apart, with no rows and no
  // ports. A firewall is pulled towards both ends of every flow it rules on,
  // so it settles beside its router, among the traffic it governs; the pulls
  // shape the layout and are never drawn.
  function toStress(graph) {
    var flows = dict();
    graph.edges.forEach(function (e) {
      flows[e.id] = e;
    });
    var pulls = [];
    (graph.permits || []).forEach(function (p) {
      var f = flows[p.flow];
      if (!f) return;
      [f.from, f.to].forEach(function (end) {
        if (end !== p.firewall) pulls.push({ id: "pull/" + pulls.length, sources: [p.firewall], targets: [end] });
      });
    });
    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "stress",
        "elk.stress.desiredEdgeLength": String(SIZE.reach),
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      },
      children: graph.nodes.map(function (n) {
        return { id: n.id, width: SIZE.width, height: height(n) };
      }),
      edges: graph.edges
        .map(function (e) {
          return { id: e.id, sources: [e.from], targets: [e.to] };
        })
        .concat(pulls),
    };
  }

  // Boxes that overlap, or come closer than `gap`, pushed apart along the
  // axis where they overlap least, half each way, until none do; then the
  // whole moved back to the origin. Deterministic: the order is the input's.
  function separate(boxes, gap) {
    var out = boxes.map(function (b) {
      return Object.assign({}, b);
    });
    for (var round = 0; round < 200; round++) {
      var moved = false;
      for (var i = 0; i < out.length; i++) {
        for (var j = i + 1; j < out.length; j++) {
          var a = out[i];
          var b = out[j];
          var dx = b.x + b.width / 2 - (a.x + a.width / 2);
          var dy = b.y + b.height / 2 - (a.y + a.height / 2);
          var ox = (a.width + b.width) / 2 + gap - Math.abs(dx);
          var oy = (a.height + b.height) / 2 + gap - Math.abs(dy);
          if (ox <= 1e-9 || oy <= 1e-9) continue;
          moved = true;
          if (ox <= oy) {
            var sx = dx < 0 ? -1 : 1;
            a.x -= (sx * ox) / 2;
            b.x += (sx * ox) / 2;
          } else {
            var sy = dy < 0 ? -1 : 1;
            a.y -= (sy * oy) / 2;
            b.y += (sy * oy) / 2;
          }
        }
      }
      if (!moved) break;
    }
    var x0 = Infinity, y0 = Infinity;
    out.forEach(function (b) {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
    });
    out.forEach(function (b) {
      b.x -= x0;
      b.y -= y0;
    });
    return out;
  }

  // Lay out, and if anything is shared, once more now that the parents have
  // places. `run` is ELK's `layout`, wherever it lives (a worker, in the page).
  function layoutWith(run, graph) {
    if (graph.profile === "architecture") {
      return run(toElk(graph)).then(function (result) {
        return fromElk(graph, result);
      });
    }
    return run(toElk(graph)).then(function (first) {
      var x = dict();
      (first.children || []).forEach(function (c) {
        x[c.id] = c.x;
      });
      var arrivals = dict();
      var any = false;
      graph.edges.forEach(function (e) {
        (arrivals[e.to] = arrivals[e.to] || []).push(e.from);
      });
      Object.keys(arrivals).forEach(function (id) {
        if (arrivals[id].length < 2) return void delete arrivals[id];
        any = true;
        arrivals[id].sort(function (a, b) {
          return x[a] - x[b];
        });
      });
      if (!any) return fromElk(graph, first);
      return run(toElk(graph, arrivals)).then(function (second) {
        return fromElk(graph, second);
      });
    });
  }

  // ELK's answer, reduced to what a renderer draws.
  function fromElk(graph, result) {
    var described = dict();
    graph.nodes.forEach(function (n) {
      described[n.id] = n;
    });
    var ends = dict();
    graph.edges.forEach(function (e) {
      ends[e.id] = e;
    });
    if (graph.profile === "architecture") return fromStress(graph, result, described);
    return {
      width: result.width || 0,
      height: result.height || 0,
      nodes: (result.children || []).map(function (c) {
        return { id: c.id, x: c.x, y: c.y, width: c.width, height: c.height, node: described[c.id] };
      }),
      edges: (result.edges || []).map(function (e) {
        var points = [];
        (e.sections || []).forEach(function (s) {
          points.push(s.startPoint);
          (s.bendPoints || []).forEach(function (p) {
            points.push(p);
          });
          points.push(s.endPoint);
        });
        var out = { id: e.id, from: ends[e.id].from, to: ends[e.id].to, points: points };
        if (ends[e.id].label) out.label = ends[e.id].label;
        return out;
      }),
    };
  }

  // An architecture's layout: its components clear of each other, every one
  // with the ring round its plate (`hub`, relative to its box) as the place
  // its lines end; its lines are curves drawn
  // later (positions.js), so ELK's routes and the pulls are dropped, and the
  // firewalls' permissions ride along to be drawn as lines of their own.
  function fromStress(graph, result, described) {
    var nodes = separate(
      (result.children || []).map(function (c) {
        return { id: c.id, x: c.x || 0, y: c.y || 0, width: c.width, height: c.height, node: described[c.id], hub: { x: SIZE.width / 2, y: SIZE.plate / 2, r: SIZE.plate / 2 + SIZE.halo } };
      }),
      SIZE.clear
    );
    var width = 0, height = 0;
    nodes.forEach(function (n) {
      width = Math.max(width, n.x + n.width);
      height = Math.max(height, n.y + n.height);
    });
    return {
      width: width,
      height: height,
      nodes: nodes,
      edges: graph.edges.map(function (e) {
        var out = { id: e.id, from: e.from, to: e.to, points: [] };
        if (e.label) out.label = e.label;
        if (e.title) out.title = e.title;
        return out;
      }),
      permits: (graph.permits || []).slice(),
    };
  }

  var api = { inscription: inscription, describe: describe, wrap: wrap, toElk: toElk, fromElk: fromElk, layoutWith: layoutWith, separate: separate, SIZE: SIZE };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorGraph = api;
})();
