// Document → what is drawn, and what ELK is asked to lay out. Pure: no DOM, no
// ELK, no SVG. The one place that knows how a profile labels its symbols.
(function () {
  // One geometry for both profiles (spec 7.1). A node is a description box, a
  // stem, and its symbol under it; an attack-tree leaf adds a strip for cost
  // and detection between box and stem, and a shared node a row in its box for
  // the badge — inside the node, because the space between nodes is not its own.
  var SIZE = { width: 148, box: 44, stem: 10, symbol: 40, strip: 18, badge: 16 };
  SIZE.gate = SIZE.box + SIZE.stem + SIZE.symbol;
  SIZE.leaf = SIZE.gate;

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
        badge: n > 1 ? "shared · " + n + " parents" : null,
        // No p, rate or ttc: the tree is still good for cut sets, not for numbers.
        unquantified: !gate && node.p === undefined && node.rate === undefined && node.ttc === undefined,
        top: id === doc.top,
        unreachable: !reached[id],
      };
    });
    return { profile: doc.profile, nodes: nodes, edges: edges };
  }

  function height(node) {
    return SIZE.gate + (node.attributes ? SIZE.strip : 0) + (node.badge ? SIZE.badge : 0);
  }

  // `arrivals` maps a shared node to its parents, left to right: each then
  // arrives at a port of its own along the top. With one port for all of them
  // the incoming edges merge, and merge with whatever else passes — the drawing
  // would give a gate children it does not have. Without `arrivals` (the first
  // pass, before anyone knows where the parents are) everything arrives centre.
  function toElk(graph, arrivals) {
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

  // Lay out, and if anything is shared, once more now that the parents have
  // places. `run` is ELK's `layout`, wherever it lives (a worker, in the page).
  function layoutWith(run, graph) {
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
        return { id: e.id, from: ends[e.id].from, to: ends[e.id].to, points: points };
      }),
    };
  }

  var api = { inscription: inscription, describe: describe, wrap: wrap, toElk: toElk, fromElk: fromElk, layoutWith: layoutWith, SIZE: SIZE };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorGraph = api;
})();
