// Document → what is drawn, and what ELK is asked to lay out. Pure: no DOM, no
// ELK, no SVG. The one place that knows how a profile labels its symbols.
(function () {
  // One geometry for both profiles (spec 7.1). A node is a description box, a
  // stem, and its symbol under it; an attack-tree leaf adds a strip for cost
  // and detection between box and stem. A shared node is drawn once; its
  // incoming edges are what say it is shared.
  var SIZE = { width: 148, box: 44, stem: 10, symbol: 40, strip: 18, plate: 48, halo: 4, ring: 5, reach: 190, clear: 20 };
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
  //
  // An attack graph runs the other way: every line from a prerequisite to what
  // depends on it, drawn upwards, so the target is on top as a tree's top event
  // is. A line leaves the top of the prerequisite's box and arrives under the
  // dependent's symbol.
  function toElk(graph, arrivals) {
    if (graph.profile === "architecture") return toStress(graph);
    var up = graph.profile === "attack-graph";
    arrivals = arrivals || dict();
    function inPort(e) {
      var order = arrivals[e.to];
      return e.to + ":in" + (order ? ":" + order.indexOf(e.from) : "");
    }
    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": up ? "UP" : "DOWN",
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
        var inY = up ? h : 0;
        var ins = order
          ? order.map(function (_, i) {
              return { id: n.id + ":in:" + i, x: (SIZE.width * (i + 1)) / (order.length + 1), y: inY, width: 0, height: 0 };
            })
          : [{ id: n.id + ":in", x: SIZE.width / 2, y: inY, width: 0, height: 0 }];
        return {
          id: n.id,
          width: SIZE.width,
          height: h,
          // Edges leave under the symbol and arrive on top of the box; in an
          // attack graph, the other way round.
          layoutOptions: { "elk.portConstraints": "FIXED_POS" },
          ports: ins.concat([{ id: n.id + ":out", x: SIZE.width / 2, y: up ? 0 : h, width: 0, height: 0 }]),
        };
      }),
      edges: graph.edges.map(function (e) {
        return { id: e.id, sources: [e.from + ":out"], targets: [inPort(e)] };
      }),
    };
  }

  // A host and what it runs, laid out as one block (owner, 2026-09-24): the
  // host on top, centred; its software in rows of BLOCK.columns under it, in
  // the file's order; under each, the products only this host's software
  // uses. A product used on two hosts, a router or guest on the box, and
  // everything else keep places of their own. An open cluster
  // (`graph.groups`) is a block of its own, its first member on top, and
  // what is in one is in no host's block. Returns {blocks: {top:
  // {members, at: {id: {x, y}}, width, height}}, of: {member: top}}.
  var BLOCK = { columns: 5, gap: 12 };
  var SOFTWARE = { application: true, service: true };

  // One block: `top` centred on top, `row` in rows of BLOCK.columns under
  // it, each of `under[id]` in a column under its user.
  function arrange(top, row, under) {
    var cell = SIZE.width + BLOCK.gap, step = SIZE.component + BLOCK.gap;
    var columns = Math.max(1, Math.min(BLOCK.columns, row.length));
    var width = columns * cell - BLOCK.gap;
    var at = dict(), members = [top], y = step;
    at[top] = { x: (width - SIZE.width) / 2, y: 0 };
    for (var start = 0; start < row.length; start += BLOCK.columns) {
      var tier = row.slice(start, start + BLOCK.columns), deepest = 0;
      tier.forEach(function (id, i) {
        at[id] = { x: i * cell, y: y };
        members.push(id);
        (under[id] || []).forEach(function (product, k) {
          at[product] = { x: i * cell, y: y + (k + 1) * step };
          members.push(product);
        });
        deepest = Math.max(deepest, (under[id] || []).length);
      });
      y += (deepest + 1) * step;
    }
    return { members: members, at: at, width: width, height: y - BLOCK.gap };
  }

  // Room round a cluster's block for its outline, and above it for the
  // name on its tab (positions.js draws them 10 px out, the tab 9 px above).
  var FRAME = { side: 12, top: 22 };
  function framed(block) {
    Object.keys(block.at).forEach(function (id) {
      block.at[id] = { x: block.at[id].x + FRAME.side, y: block.at[id].y + FRAME.top };
    });
    block.width += 2 * FRAME.side;
    block.height += FRAME.top + FRAME.side;
    return block;
  }

  function blocks(graph) {
    var node = dict(), order = dict();
    graph.nodes.forEach(function (n, i) {
      node[n.id] = n;
      order[n.id] = i;
    });
    var groups = (graph.groups || []).map(function (g) {
      return g.members.filter(function (m) { return node[m]; });
    }).filter(function (members) {
      return members.length > 1;
    });
    var taken = dict();
    groups.forEach(function (members) {
      members.forEach(function (m) { taken[m] = true; });
    });
    var runs = dict(), hostOf = dict(), usedBy = dict();
    graph.edges.forEach(function (e) {
      if (!node[e.from] || !node[e.to] || taken[e.from] || taken[e.to]) return;
      if (e.kind === "hosts" && node[e.from].component === "host" && SOFTWARE[node[e.to].component] && !hostOf[e.to]) {
        hostOf[e.to] = e.from;
        (runs[e.from] = runs[e.from] || []).push(e.to);
      }
      if (e.kind === "instance-of") (usedBy[e.to] = usedBy[e.to] || []).push(e.from);
    });
    // A product goes under the first of its users when every user runs on one host.
    var under = dict();
    Object.keys(usedBy).sort(function (a, b) { return order[a] - order[b]; }).forEach(function (product) {
      var users = usedBy[product];
      var host = hostOf[users[0]];
      if (!host || !users.every(function (u) { return hostOf[u] === host; })) return;
      var first = users.slice().sort(function (a, b) { return order[a] - order[b]; })[0];
      (under[first] = under[first] || []).push(product);
    });
    var out = { blocks: dict(), of: dict() };
    Object.keys(runs).sort(function (a, b) { return order[a] - order[b]; }).forEach(function (host) {
      var software = runs[host].slice().sort(function (a, b) { return order[a] - order[b]; });
      var block = arrange(host, software, under);
      block.members.forEach(function (m) { out.of[m] = host; });
      out.blocks[host] = block;
    });
    groups.forEach(function (members) {
      var inside = dict();
      members.forEach(function (m) { inside[m] = true; });
      var top = members[0];
      // A product under its first user in the group, when every user is in it.
      var users = dict(), outsider = dict();
      graph.edges.forEach(function (e) {
        if (e.kind !== "instance-of" || !inside[e.to]) return;
        if (inside[e.from]) (users[e.to] = users[e.to] || []).push(e.from);
        else outsider[e.to] = true;
      });
      var under2 = dict(), placed = dict();
      members.forEach(function (p) {
        if (p === top || !users[p] || outsider[p]) return;
        var first = members.filter(function (m) { return m !== top && m !== p && users[p].indexOf(m) >= 0; })[0];
        if (!first) return;
        (under2[first] = under2[first] || []).push(p);
        placed[p] = true;
      });
      var row = members.filter(function (m) { return m !== top && !placed[m]; });
      var block = framed(arrange(top, row, under2));
      block.members.forEach(function (m) { out.of[m] = top; });
      out.blocks[top] = block;
    });
    return out;
  }

  // An architecture is a network, not a tree: ELK's stress layout places each
  // host's block (see blocks) and every component outside one, linked ones
  // near each other, with no rows and no ports. Only links pull: flows are
  // drawn, never pulled, so a scanner does not drag everything to itself. A
  // firewall is pulled towards both ends of every flow it rules on, so it
  // settles beside its router, among the traffic it governs; the pulls shape
  // the layout and are never drawn.
  function toStress(graph, grouped) {
    grouped = grouped || blocks(graph);
    function place(id) {
      return grouped.of[id] || id;
    }
    var flows = dict();
    graph.edges.forEach(function (e) {
      flows[e.id] = e;
    });
    var pulls = [];
    (graph.permits || []).forEach(function (p) {
      var f = flows[p.flow];
      if (!f) return;
      [f.from, f.to].forEach(function (end) {
        if (place(end) !== place(p.firewall)) pulls.push({ id: "pull/" + pulls.length, sources: [place(p.firewall)], targets: [place(end)] });
      });
    });
    var seen = dict();
    var links = [];
    graph.edges.forEach(function (e) {
      if (e.kind === "flow") return;
      var from = place(e.from), to = place(e.to);
      if (from === to || seen[from + "\u0000" + to]) return;
      seen[from + "\u0000" + to] = true;
      links.push({ id: e.id, sources: [from], targets: [to] });
    });
    return {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "stress",
        "elk.stress.desiredEdgeLength": String(SIZE.reach),
        "elk.padding": "[top=0,left=0,bottom=0,right=0]",
      },
      children: graph.nodes
        .filter(function (n) {
          return !grouped.of[n.id] || grouped.of[n.id] === n.id;
        })
        .map(function (n) {
          var block = grouped.blocks[n.id];
          return block ? { id: n.id, width: block.width, height: block.height } : { id: n.id, width: SIZE.width, height: height(n) };
        }),
      edges: links.concat(pulls),
    };
  }

  // Boxes that overlap, or come closer than `gap`, pushed apart along the
  // axis where they overlap least, half each way, until none do; then the
  // whole moved back to the origin. A crowd too dense to push apart (dozens
  // of hosts) jams, so every SPREAD rounds without success the centres are
  // spread from their middle and pushing goes on: that always ends, as far
  // enough apart nothing overlaps. Deterministic: the order is the input's.
  var SPREAD = 100;
  function separate(boxes, gap) {
    var out = boxes.map(function (b) {
      return Object.assign({}, b);
    });
    // (60 spreads is a quarter million times as far: past any real crowd.)
    for (var round = 1; round <= SPREAD * 60; round++) {
      if (round % SPREAD === 0) spread(out, 1.25);
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

  // Every box's centre moved `factor` times as far from the middle of all.
  function spread(boxes, factor) {
    var cx = 0, cy = 0;
    boxes.forEach(function (b) {
      cx += b.x + b.width / 2;
      cy += b.y + b.height / 2;
    });
    cx /= boxes.length;
    cy /= boxes.length;
    boxes.forEach(function (b) {
      b.x = cx + (b.x + b.width / 2 - cx) * factor - b.width / 2;
      b.y = cy + (b.y + b.height / 2 - cy) * factor - b.height / 2;
    });
  }

  // Lay out, and if anything is shared, once more now that the parents have
  // places. `run` is ELK's `layout`, wherever it lives (a worker, in the page).
  function layoutWith(run, graph) {
    if (graph.profile === "architecture") {
      // Its blocks worked out once, for the layout and for reading it back.
      var grouped = blocks(graph);
      return run(toStress(graph, grouped)).then(function (result) {
        return fromElk(graph, result, grouped);
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

  // ELK's answer, reduced to what a renderer draws. `grouped`: an
  // architecture's blocks, if already worked out.
  function fromElk(graph, result, grouped) {
    var described = dict();
    graph.nodes.forEach(function (n) {
      described[n.id] = n;
    });
    var ends = dict();
    graph.edges.forEach(function (e) {
      ends[e.id] = e;
    });
    if (graph.profile === "architecture") return fromStress(graph, result, described, grouped);
    return {
      width: result.width || 0,
      height: result.height || 0,
      // An attack graph's lines carry arrowheads: they say which way it runs.
      arrows: graph.profile === "attack-graph",
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
  // its lines end; its straight lines are drawn
  // later (positions.js), so ELK's routes and the pulls are dropped, and the
  // firewalls' permissions ride along to be drawn as lines of their own.
  function fromStress(graph, result, described, grouped) {
    grouped = grouped || blocks(graph);
    var hub = { x: SIZE.width / 2, y: SIZE.plate / 2, r: SIZE.plate / 2 + SIZE.halo };
    // A ringed component's lines end outside its ring.
    var ringed = { x: hub.x, y: hub.y, r: hub.r + SIZE.ring + 2 };
    // Blocks and single components pushed clear of each other as wholes,
    // then each block filled in round its host.
    var placed = separate(
      (result.children || []).map(function (c) {
        return { id: c.id, x: c.x || 0, y: c.y || 0, width: c.width, height: c.height };
      }),
      SIZE.clear
    );
    var nodes = [];
    placed.forEach(function (p) {
      var block = grouped.blocks[p.id];
      (block ? block.members : [p.id]).forEach(function (id) {
        var off = block ? block.at[id] : { x: 0, y: 0 };
        var n = described[id];
        // Whole pixels: crisp, and a block's shape exact (the gap absorbs it).
        nodes.push({ id: id, x: Math.round(p.x) + off.x, y: Math.round(p.y) + off.y, width: SIZE.width, height: height(n), node: n, hub: n && ((n.rings && n.rings.length) || (n.cluster && n.cluster.states.some(Boolean))) ? ringed : hub });
      });
    });
    var right = 0, bottom = 0;
    nodes.forEach(function (n) {
      right = Math.max(right, n.x + n.width);
      bottom = Math.max(bottom, n.y + n.height);
    });
    return {
      width: right,
      height: bottom,
      nodes: nodes,
      edges: graph.edges.map(function (e) {
        var out = { id: e.id, from: e.from, to: e.to, points: [] };
        if (e.label) out.label = e.label;
        if (e.title) out.title = e.title;
        return out;
      }),
      permits: (graph.permits || []).slice(),
      groups: (graph.groups || []).slice(),
    };
  }

  var api = { inscription: inscription, describe: describe, wrap: wrap, toElk: toElk, fromElk: fromElk, layoutWith: layoutWith, separate: separate, blocks: blocks, SIZE: SIZE };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorGraph = api;
})();
