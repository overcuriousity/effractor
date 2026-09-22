// The SVG renderer, behind the interface of spec 7.1:
//
//   mount(el) · render(layout, styles) · highlight(ids, kind) · fit() · zoomBy(factor) · on(event, handler)
//
// It is told node ids, class names and positions, and tells back node ids.
// Nothing above it sees SVG, so a canvas or WebGL renderer can take its place.
// All appearance is in 30-graph.css: the CSP forbids style attributes, and the
// classes are the interface anyway.
(function () {
  var NS = "http://www.w3.org/2000/svg";
  var EVENTS = ["select", "activate", "context", "drop"];
  var DRAG_PX = 4; // movement below this is a click
  var PADDING = 32;

  function createSvgRenderer(doc) {
    var geometry = (typeof module !== "undefined" ? require("./graph.js") : window.effractorGraph).SIZE;
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
      return hit ? { from: hit.getAttribute("data-from"), to: hit.getAttribute("data-to") } : null;
    }

    function applyView() {
      viewport.setAttribute("transform", "translate(" + view.x + " " + view.y + ") scale(" + view.k + ")");
    }

    function mount(host) {
      // Focusable: a press on the canvas takes the keyboard back from whatever
      // button or field had it, so the editor's keys go where the eye is.
      svg = el("svg", { role: "group", "aria-label": "Graph", tabindex: "0" }, ["graph"], host);
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
        emit("context", { id: edge ? edge.to : idAt(e.target), parent: edge ? edge.from : undefined, x: e.clientX, y: e.clientY });
      });

      svg.addEventListener("pointerdown", function (e) {
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
        svg.classList.add(gesture.id ? "is-dragging" : "is-panning");
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
        svg.classList.remove("is-dragging", "is-panning");
        // A press and release in place is the selection: of the node the press
        // landed on, whatever the browser makes the target of its click.
        if (!g.moved) return emit("select", g.edge ? { id: g.edge.to, parent: g.edge.from } : { id: g.id, parent: undefined });
        svg.releasePointerCapture(e.pointerId);
        var target = idAt(dropTarget(e));
        if (g.id && target && target !== g.id) emit("drop", { id: g.id, target: target, ctrl: !!(e.ctrlKey || e.metaKey) });
      });
      svg.addEventListener("pointercancel", function () {
        gesture = null;
        svg.classList.remove("is-dragging", "is-panning");
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
      var g = el("g", { "data-id": n.id, transform: "translate(" + item.x + " " + item.y + ")" }, classes, nodeLayer);
      el("title", {}, [], g).textContent = n.label;

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
      // An architecture's component: the box is all of it, with a badge on
      // its top edge when the attacker starts or ends there.
      if (n.symbol === "component") {
        if (n.badge) {
          var bw = String(n.badge).length * 5.6 + 12;
          el("rect", { x: w - bw - 6, y: -8, width: bw, height: 16, rx: 3 }, ["tag", "badge"], g);
          text(g, w - 6 - bw / 2, 3, n.badge, "tag-text");
        }
        return g;
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
        el("path", { d: into, "data-from": edge.from, "data-to": edge.to }, ["edge-hit"], edgeLayer);
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
          e.el.classList.toggle(cls, !!(ids[e.from] && ids[e.to]));
        });
      });
    }

    function render(layout, styles) {
      styles = styles || {};
      edgeLayer.replaceChildren();
      nodeLayer.replaceChildren();
      drawn = { nodes: Object.create(null), edges: [] };
      size = { width: layout.width, height: layout.height };
      layout.edges.forEach(function (e) {
        drawn.edges.push({ el: drawEdge(e), from: e.from, to: e.to });
      });
      layout.nodes.forEach(function (item) {
        var style = Object.prototype.hasOwnProperty.call(styles, item.id) ? styles[item.id] : {};
        drawn.nodes[item.id] = drawNode(item, style);
      });
      applyHighlights();
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

    return { mount: mount, render: render, highlight: highlight, fit: fit, zoomBy: zoomBy, on: on };
  }

  var api = { createSvgRenderer: createSvgRenderer, EVENTS: EVENTS };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorRenderer = api;
})();
