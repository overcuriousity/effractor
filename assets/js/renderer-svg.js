// The SVG renderer, behind the interface of spec 7.1:
//
//   mount(el) · render(layout, styles) · highlight(ids, kind) · fit() · zoomBy(factor) · on(event, handler)
//   · reveal(id, inset) — pan a node out from under an overlay at the right edge
//
// A layout is ELK's, with routed edges, or `free` (positions.js): nodes where
// the author put them and edges as curves between them. In a free layout a
// dragged node moves and is reported with `move`; in the other a node
// dragged onto another is a `drop`.
//
// It is told node ids, class names and positions, and tells back node ids.
// Nothing above it sees SVG, so a canvas or WebGL renderer can take its place.
// All appearance is in 30-graph.css: the CSP forbids style attributes, and the
// classes are the interface anyway.
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var EVENTS = ["select", "activate", "context", "drop", "move"];
  var DRAG_PX = 4; // movement below this is a click
  var PADDING = 32;

  function createSvgRenderer(doc) {
    var geometry = (typeof module !== "undefined" ? require("./graph.js") : window.effractorGraph).SIZE;
    var icons = typeof module !== "undefined" ? require("./architecture-icons.js") : window.effractorArchitectureIcons;
    var viewMath = typeof module !== "undefined" ? require("./view.js") : window.effractorView;

    var svg = null;
    var viewport = null;
    var edgeLayer = null;
    var nodeLayer = null;
    // Keyed by node id, which may be any word (`constructor`…): no prototype.
    var drawn = { nodes: Object.create(null), edges: [] };
    var size = { width: 0, height: 0 };
    var view = { k: 1, x: 0, y: 0 };
    var highlights = {}; // kind -> {id: true}
    var handlers = {};
    var gesture = null; // {id | null, x, y, moved}
    var fitted = false; // the view is as fit() left it: a resize may fit again
    var free = null; // the free layout on screen, if it is one
    var boxes = Object.create(null); // node id -> its box in drawing coordinates
    var panning = null; // an animation frame in flight
    var routes = (typeof module !== "undefined" ? require("./positions.js") : window.effractorPositions);

    function el(tag, attrs, classes, parent) {
      var e = doc.createElementNS(NS, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      (classes || []).forEach(function (c) {
        e.classList.add(c);
      });
      if (parent) parent.appendChild(e);
      return e;
    }

    function text(parent, x, y, content, cls) {
      var t = el("text", { x: x, y: y, "text-anchor": "middle" }, [cls], parent);
      t.textContent = content;
      return t;
    }

    function emit(name, payload) {
      (handlers[name] || []).forEach(function (h) {
        h(payload);
      });
    }

    function idAt(target) {
      var node = target && target.closest ? target.closest(".node") : null;
      return node ? node.getAttribute("data-id") : null;
    }

    // An edge under the pointer, as {from, to}: a press on a line means the
    // child *along that line*, which for a shared node is the whole point.
    function edgeAt(target) {
      var hit = target && target.closest ? target.closest(".edge-hit") : null;
      return hit ? { id: hit.getAttribute("data-id"), from: hit.getAttribute("data-from"), to: hit.getAttribute("data-to") } : null;
    }

    function applyView() {
      viewport.setAttribute("transform", "translate(" + view.x + " " + view.y + ") scale(" + view.k + ")");
    }

    function mount(host) {
      // Focusable: a press on the canvas takes the keyboard back from whatever
      // button or field had it, so the editor's keys go where the eye is.
      svg = el("svg", { role: "group", "aria-label": "Graph", tabindex: "0" }, ["graph"], host);
      // The arrowhead of a free layout's edges.
      var defs = el("defs", {}, [], svg);
      var marker = el("marker", { id: "edge-arrow", viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }, [], defs);
      el("path", { d: "M0 0L10 5L0 10z" }, ["arrow-head"], marker);
      viewport = el("g", {}, ["viewport"], svg);
      edgeLayer = el("g", {}, ["edges"], viewport);
      nodeLayer = el("g", {}, ["nodes"], viewport);

      svg.addEventListener("dblclick", function (e) {
        var id = idAt(e.target);
        if (id) emit("activate", { id: id });
      });
      svg.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        var edge = edgeAt(e.target);
        emit("context", { id: edge ? edge.to : idAt(e.target), parent: edge ? edge.from : undefined, edge: edge ? edge.id : undefined, x: e.clientX, y: e.clientY });
      });

      svg.addEventListener("pointerdown", function (e) {
        stopReveal(); // the author's hand wins over an animation
        if (e.button !== 0) return;
        gesture = { id: idAt(e.target), edge: edgeAt(e.target), x: e.clientX, y: e.clientY, moved: false };
        if (svg.focus) svg.focus();
      });
      svg.addEventListener("pointermove", function (e) {
        if (!gesture) return;
        var dx = e.clientX - gesture.x;
        var dy = e.clientY - gesture.y;
        if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < DRAG_PX) return;
        // Captured only once it is a drag: a captured pointer sends its click
        // to the svg, not to the node under it.
        if (!gesture.moved) svg.setPointerCapture(e.pointerId);
        gesture.moved = true;
        svg.classList.add(gesture.id ? (free ? "is-moving" : "is-dragging") : "is-panning");
        if (gesture.id && free) {
          // A free layout's node goes where the pointer takes it, lines and all.
          moveBy(gesture.id, dx / view.k, dy / view.k);
          gesture.x = e.clientX;
          gesture.y = e.clientY;
          return;
        }
        if (gesture.id) return; // a node in hand: nothing moves until it is dropped
        fitted = false;
        view = viewMath.pan(view, dx, dy);
        gesture.x = e.clientX;
        gesture.y = e.clientY;
        applyView();
      });
      svg.addEventListener("pointerup", function (e) {
        if (!gesture) return;
        var g = gesture;
        gesture = null;
        svg.classList.remove("is-dragging", "is-moving", "is-panning");
        // A press and release in place is the selection: of the node the press
        // landed on, whatever the browser makes the target of its click.
        if (!g.moved) return emit("select", g.edge ? { id: g.edge.to, parent: g.edge.from, edge: g.edge.id } : { id: g.id, parent: undefined });
        svg.releasePointerCapture(e.pointerId);
        if (free && g.id) {
          var p = free.at[g.id];
          if (p) emit("move", { id: g.id, x: p.x, y: p.y });
          return;
        }
        var target = idAt(dropTarget(e));
        if (g.id && target && target !== g.id) emit("drop", { id: g.id, target: target, ctrl: !!(e.ctrlKey || e.metaKey) });
      });
      svg.addEventListener("pointercancel", function () {
        gesture = null;
        svg.classList.remove("is-dragging", "is-moving", "is-panning");
      });
      // A panel opening or the window changing size: a view nobody has moved
      // since it was fitted is fitted again; one the author placed stays put.
      if (typeof ResizeObserver !== "undefined") {
        new ResizeObserver(function () {
          if (fitted) fit();
        }).observe(svg);
      }
      svg.addEventListener("wheel", function (e) {
        e.preventDefault();
        stopReveal();
        var box = svg.getBoundingClientRect();
        var point = { x: e.clientX - box.left, y: e.clientY - box.top };
        fitted = false;
        view = viewMath.zoomAt(view, point, Math.pow(1.0015, -e.deltaY));
        applyView();
      });
    }

    // With the pointer captured, the event's target is the svg; what is under
    // the pointer has to be asked for.
    function dropTarget(e) {
      if (typeof doc.elementFromPoint === "function") return doc.elementFromPoint(e.clientX, e.clientY) || e.target;
      return e.target;
    }

    function symbol(group, n, top) {
      var cx = geometry.width / 2;
      var s = geometry.symbol;
      if (n.symbol === "gate") {
        el("rect", { x: cx - s / 2 - 2, y: top, width: s + 4, height: s, rx: 2 }, ["shape", "symbol"], group);
        text(group, cx, top + s / 2 + 4.5, n.inscription, "inscription");
      } else if (n.symbol === "undeveloped") {
        var h = s / 2;
        var points = [cx, top, cx + h, top + h, cx, top + s, cx - h, top + h].join(" ");
        el("polygon", { points: points }, ["shape", "symbol"], group);
      } else {
        el("circle", { cx: cx, cy: top + s / 2, r: s / 2 }, ["shape", "symbol"], group);
      }
    }

    // An architecture's component, as an investigation graph draws an
    // entity: its kind's icon on a plate in its family's colour, the name
    // under it. A count on the plate says how many values are still unknown;
    // a badge beside it, that the attacker starts or ends here.
    function drawComponent(g, n) {
      var cx = geometry.width / 2;
      var r = geometry.plate / 2;
      el("circle", { cx: cx, cy: r, r: r + geometry.halo }, ["halo"], g);
      el("circle", { cx: cx, cy: r, r: r }, ["plate"], g);
      var scale = 26 / 24;
      var glyph = el("g", { transform: "translate(" + (cx - 13) + " " + (r - 13) + ") scale(" + scale + ")" }, ["glyph"], g);
      icons.parts(n.component).forEach(function (part) {
        el(part[0], part[1], [], glyph);
      });
      n.lines.forEach(function (line, i) {
        text(g, cx, geometry.plate + 16 + i * 14, line, "label-line");
      });
      if (n.unknown) {
        var cw = String(n.unknown).length * 6 + 14;
        var at = cx + r * 0.7;
        el("rect", { x: at - cw / 2, y: r * 0.3 - 16, width: cw, height: 16, rx: 8 }, ["count"], g);
        text(g, at, r * 0.3 - 4.5, n.unknown + "?", "count-text");
      }
      if (n.badge) {
        var bw = String(n.badge).length * 5.6 + 12;
        el("rect", { x: cx + r + 6, y: r - 8, width: bw, height: 16, rx: 3 }, ["tag", "badge"], g);
        text(g, cx + r + 6 + bw / 2, r + 3.5, n.badge, "tag-text");
      }
      return g;
    }

    function drawNode(item, style) {
      var n = item.node;
      var classes = ["node", "node-" + n.symbol];
      if (n.component) classes.push("component-" + n.component);
      if (n.top) classes.push("is-top");
      if (n.parents > 1) classes.push("is-shared");
      if (n.unreachable) classes.push("is-unreachable");
      if (n.unquantified) classes.push("is-unquantified");
      (style.classes || []).forEach(function (c) {
        classes.push(c);
      });
      if (n.symbol === "component") classes.push("family-" + (icons.family(n.component) || "none"));
      var g = el("g", { "data-id": n.id, transform: "translate(" + item.x + " " + item.y + ")" }, classes, nodeLayer);
      var tip = el("title", {}, [], g);
      tip.textContent = n.label;
      if (n.symbol === "component") {
        tip.textContent = n.label + " — " + n.component + (n.unknown ? " · " + n.unknown + " unknown" : "");
        return drawComponent(g, n);
      }

      var w = geometry.width;
      var boxHeight = geometry.box;
      el("rect", { x: 0, y: 0, width: w, height: boxHeight, rx: 2 }, ["shape", "box"], g);
      var first = geometry.box / 2 + 4 - (n.lines.length - 1) * 7;
      n.lines.forEach(function (line, i) {
        text(g, w / 2, first + i * 14, line, "label-line");
      });

      var below = boxHeight;
      if (n.attributes) {
        el("rect", { x: 0, y: below, width: w, height: geometry.strip }, ["shape", "strip"], g);
        text(g, w / 2, below + geometry.strip / 2 + 3.5, n.attributes, "attributes");
        below += geometry.strip;
      }
      el("line", { x1: w / 2, y1: below, x2: w / 2, y2: below + geometry.stem }, ["stem"], g);
      symbol(g, n, below + geometry.stem);
      if (style.value != null && n.symbol !== "gate") {
        text(g, w / 2, below + geometry.stem + geometry.symbol / 2 + 3.5, style.value, "value");
      } else if (n.unquantified) {
        // Said in a sign as well as in the dashes: a number is still owed.
        text(g, w / 2, below + geometry.stem + geometry.symbol / 2 + 4.5, "?", "value");
      }

      if (style.tag) {
        // Left of the symbol.
        g.classList.add("has-tag");
        var tw = String(style.tag).length * 5.6 + 12;
        var ty = below + geometry.stem + geometry.symbol / 2;
        var tx = w / 2 - geometry.symbol / 2 - 8 - tw;
        el("rect", { x: tx, y: ty - 8, width: tw, height: 16, rx: 3 }, ["tag"], g);
        text(g, tx + tw / 2, ty + 3, style.tag, "tag-text");
      }

      return g;
    }

    // A free layout's edge: a curve from box to box, a wide unseen copy to
    // take the pointer, its label halfway.
    function curve(r) {
      return "M" + r.start.x + " " + r.start.y + "Q" + r.control.x + " " + r.control.y + " " + r.end.x + " " + r.end.y;
    }
    function drawCurve(r) {
      var line = el("path", { d: curve(r), "data-id": r.id, "data-from": r.from, "data-to": r.to, "marker-end": "url(#edge-arrow)" }, ["edge"], edgeLayer);
      var hit = el("path", { d: curve(r), "data-id": r.id, "data-from": r.from, "data-to": r.to }, ["edge-hit"], edgeLayer);
      // The file's own term, where the line says it in other words.
      if (r.title) el("title", {}, [], hit).textContent = r.title;
      var label = null;
      if (r.label) {
        label = el("text", { x: r.mid.x, y: r.mid.y - 4, "data-id": r.id }, ["edge-label"], edgeLayer);
        label.textContent = r.label;
      }
      return { line: line, hit: hit, label: label };
    }
    function redrawCurve(item, r) {
      item.line.setAttribute("d", curve(r));
      item.hit.setAttribute("d", curve(r));
      if (item.label) {
        item.label.setAttribute("x", r.mid.x);
        item.label.setAttribute("y", r.mid.y - 4);
      }
    }

    // A firewall's permission: a dotted line from the firewall to the middle
    // of the flow it rules on, with a word — allows, blocks, ?.
    function straight(a) {
      return "M" + a.start.x + " " + a.start.y + "L" + a.end.x + " " + a.end.y;
    }
    function drawAttachment(a) {
      var line = el("path", { d: straight(a), "data-id": a.id, "data-from": a.firewall, "data-to": a.flow }, ["edge", "permit", "permit-" + a.label.replace("?", "unknown")], edgeLayer);
      var hit = el("path", { d: straight(a), "data-id": a.id, "data-from": a.firewall, "data-to": a.flow }, ["edge-hit"], edgeLayer);
      var label = el("text", { x: a.mid.x, y: a.mid.y - 4, "data-id": a.id }, ["edge-label", "permit-label"], edgeLayer);
      label.textContent = a.label;
      // Where the rule applies: a dot on the flow.
      var dot = el("circle", { cx: a.end.x, cy: a.end.y, r: 3.5, "data-id": a.id }, ["permit-dot"], edgeLayer);
      return { line: line, hit: hit, label: label, dot: dot };
    }
    function redrawAttachment(parts, a) {
      parts.line.setAttribute("d", straight(a));
      parts.hit.setAttribute("d", straight(a));
      parts.dot.setAttribute("cx", a.end.x);
      parts.dot.setAttribute("cy", a.end.y);
      parts.label.setAttribute("x", a.mid.x);
      parts.label.setAttribute("y", a.mid.y - 4);
    }

    function moveBy(id, dx, dy) {
      var p = free.at[id];
      if (!p) return;
      p.x += dx;
      p.y += dy;
      drawn.nodes[id].setAttribute("transform", "translate(" + p.x + " " + p.y + ")");
      var flows = Object.create(null);
      drawn.edges.forEach(function (e) {
        if (!e.route) return;
        if (e.from === id || e.to === id) {
          var r = routes.route(free.at, e.route);
          if (r) {
            e.now = r;
            redrawCurve(e.parts, r);
          }
        }
        flows[e.id] = e;
      });
      drawn.attachments.forEach(function (a) {
        var flow = flows[a.permit.flow];
        if (a.permit.firewall !== id && !(flow && (flow.from === id || flow.to === id))) return;
        var again = routes.attach(free.at, flow ? flow.now : null, a.permit);
        if (again) redrawAttachment(a.parts, again);
      });
    }

    function drawEdge(edge) {
      var d = edge.points
        .map(function (p, i) {
          return (i ? "L" : "M") + p.x + " " + p.y;
        })
        .join(" ");
      var line = el("path", { d: d, "data-id": edge.id, "data-from": edge.from, "data-to": edge.to }, ["edge"], edgeLayer);
      // A line is thin; what takes the pointer is a wide, unseen one over it —
      // over its last stretch only, into the child: siblings share the rest.
      var last = edge.points.slice(-2);
      if (last.length === 2) {
        var into = "M" + last[0].x + " " + last[0].y + "L" + last[1].x + " " + last[1].y;
        el("path", { d: into, "data-id": edge.id, "data-from": edge.from, "data-to": edge.to }, ["edge-hit"], edgeLayer);
      }
      return line;
    }

    function applyHighlights() {
      Object.keys(highlights).forEach(function (kind) {
        var ids = highlights[kind];
        var cls = "hl-" + kind;
        Object.keys(drawn.nodes).forEach(function (id) {
          drawn.nodes[id].classList.toggle(cls, !!ids[id]);
        });
        drawn.edges.forEach(function (e) {
          e.el.classList.toggle(cls, !!((ids[e.from] && ids[e.to]) || (e.id && ids[e.id])));
        });
      });
    }

    function render(layout, styles) {
      styles = styles || {};
      edgeLayer.replaceChildren();
      nodeLayer.replaceChildren();
      drawn = { nodes: Object.create(null), edges: [], attachments: [] };
      size = { width: layout.width, height: layout.height, x0: layout.x0 || 0, y0: layout.y0 || 0 };
      free = null;
      boxes = Object.create(null);
      layout.nodes.forEach(function (n) {
        boxes[n.id] = { x: n.x, y: n.y, width: n.width, height: n.height };
      });
      if (layout.free) {
        free = { at: Object.create(null) };
        layout.nodes.forEach(function (n) {
          free.at[n.id] = { id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, hub: n.hub };
        });
        layout.edges.forEach(function (e) {
          var parts = drawCurve(e);
          drawn.edges.push({ el: parts.line, parts: parts, route: e, now: e, id: e.id, from: e.from, to: e.to });
        });
        (layout.attachments || []).forEach(function (a) {
          var parts = drawAttachment(a);
          drawn.attachments.push({ parts: parts, permit: a });
          // Highlighted by its own id only: its ends are a node and a line.
          drawn.edges.push({ el: parts.line, id: a.id, from: null, to: null });
        });
      } else {
        layout.edges.forEach(function (e) {
          drawn.edges.push({ el: drawEdge(e), id: e.id, from: e.from, to: e.to });
        });
      }
      layout.nodes.forEach(function (item) {
        var style = Object.prototype.hasOwnProperty.call(styles, item.id) ? styles[item.id] : {};
        drawn.nodes[item.id] = drawNode(item, style);
      });
      applyHighlights();
    }

    // If node `id` would sit under an overlay `inset` px wide at the right
    // edge, pan left just enough to show it — smoothly where the browser can
    // animate, and never past the left edge. A visible node does not move.
    function reveal(id, inset) {
      var b = free && free.at[id] ? free.at[id] : boxes[id];
      if (!b || !svg) return;
      var width = svg.getBoundingClientRect().width;
      var margin = 16;
      var right = (b.x + b.width) * view.k + view.x;
      var left = b.x * view.k + view.x;
      var shift = Math.min(right - (width - inset - margin), left - margin);
      if (shift <= 0) return;
      fitted = false;
      var from = view.x;
      var to = view.x - shift;
      var raf = typeof window !== "undefined" && window.requestAnimationFrame;
      stopReveal();
      if (!raf) {
        view = { k: view.k, x: to, y: view.y };
        return applyView();
      }
      var start = null;
      var step = function (t) {
        if (start === null) start = t;
        var u = Math.min(1, (t - start) / 180);
        var eased = 1 - Math.pow(1 - u, 3);
        view = { k: view.k, x: from + (to - from) * eased, y: view.y };
        applyView();
        panning = u < 1 ? window.requestAnimationFrame(step) : null;
      };
      panning = window.requestAnimationFrame(step);
    }

    function stopReveal() {
      if (panning && typeof window !== "undefined" && window.cancelAnimationFrame) window.cancelAnimationFrame(panning);
      panning = null;
    }

    function highlight(ids, kind) {
      var set = Object.create(null);
      ids.forEach(function (id) {
        set[id] = true;
      });
      highlights[kind] = set;
      applyHighlights();
    }

    function fit() {
      var box = svg.getBoundingClientRect();
      view = viewMath.fit(size, { width: box.width, height: box.height }, PADDING);
      // A drawing need not start at the origin: a free one goes where it was dragged.
      view.x -= size.x0 * view.k;
      view.y -= size.y0 * view.k;
      fitted = true;
      applyView();
    }

    // The wheel zooms about the pointer; a button or a key has none, and
    // zooms about the middle.
    function zoomBy(factor) {
      var box = svg.getBoundingClientRect();
      fitted = false;
      view = viewMath.zoomAt(view, { x: box.width / 2, y: box.height / 2 }, factor);
      applyView();
    }

    function on(name, handler) {
      if (EVENTS.indexOf(name) < 0) throw new Error("the renderer has no event called " + name);
      (handlers[name] = handlers[name] || []).push(handler);
    }

    return { mount: mount, render: render, highlight: highlight, fit: fit, zoomBy: zoomBy, on: on, reveal: reveal };
  }

  var api = { createSvgRenderer: createSvgRenderer, EVENTS: EVENTS };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorRenderer = api;
})();
