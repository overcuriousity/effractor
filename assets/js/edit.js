// Structure edits (spec 7.2), as pure functions from a document to a new
// document. They change the JSON image only; whether the result is a model is
// for the wasm module to say when it is serialised — JS never decides that.
//
// Every function returns {doc, select} — `select` is the node the editor should
// land on — or null when the edit does not apply.
(function () {
  var LEAF_KEYS = ["leaf", "p", "rate", "ttc", "cost", "detection"];
  var PLACEHOLDER = "New event";

  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }

  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  // `[a-z0-9][a-z0-9-]*`, readable: umlauts spelled out, the rest dashed.
  function slug(label) {
    var s = String(label)
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return s || "node";
  }

  function uniqueId(doc, base, except) {
    var id = base;
    for (var n = 2; has(doc.nodes, id) && id !== except; n++) id = base + "-" + n;
    return id;
  }

  function parentsOf(doc, id) {
    return Object.keys(doc.nodes).filter(function (p) {
      return (doc.nodes[p].children || []).indexOf(id) >= 0;
    });
  }

  // Is `target` reachable from `from`? Iterative: a model is user input.
  function reaches(doc, from, target) {
    var stack = [from];
    var seen = Object.create(null);
    while (stack.length) {
      var at = stack.pop();
      if (at === target) return true;
      if (seen[at] || !has(doc.nodes, at)) continue;
      seen[at] = true;
      (doc.nodes[at].children || []).forEach(function (c) {
        stack.push(c);
      });
    }
    return false;
  }

  // A key-order-preserving rebuild of `nodes`, with `fn(id, node)` → [id, node].
  function rebuild(doc, fn) {
    var out = {};
    Object.keys(doc.nodes).forEach(function (id) {
      var pair = fn(id, doc.nodes[id]);
      if (pair) out[pair[0]] = pair[1];
    });
    doc.nodes = out;
  }

  function toGate(node) {
    if (node.gate) return;
    var gate = { label: node.label };
    if (node.description != null) gate.description = node.description;
    gate.gate = "or";
    gate.children = [];
    Object.keys(node).forEach(function (k) {
      if (LEAF_KEYS.indexOf(k) < 0 && !has(gate, k)) gate[k] = node[k];
    });
    Object.keys(node).forEach(function (k) {
      delete node[k];
    });
    Object.keys(gate).forEach(function (k) {
      node[k] = gate[k];
    });
  }

  function toLeaf(node) {
    delete node.gate;
    delete node.k;
    delete node.children;
    node.leaf = "basic";
  }

  function newLeaf(doc) {
    var id = uniqueId(doc, slug(PLACEHOLDER));
    doc.nodes[id] = { label: PLACEHOLDER, leaf: "basic" };
    return id;
  }

  // Tab. On a leaf: it becomes an `or` gate first.
  function addChild(doc, id) {
    if (!has(doc.nodes, id)) return null;
    doc = clone(doc);
    toGate(doc.nodes[id]);
    var child = newLeaf(doc);
    doc.nodes[id].children.push(child);
    return { doc: doc, select: child, fresh: child };
  }

  // Enter. Next to `id`, under `parent`.
  function addSibling(doc, id, parent) {
    if (!has(doc.nodes, id) || !parent || !has(doc.nodes, parent)) return null;
    doc = clone(doc);
    var sibling = newLeaf(doc);
    var children = doc.nodes[parent].children;
    children.splice(children.indexOf(id) + 1, 0, sibling);
    return { doc: doc, select: sibling, fresh: sibling };
  }

  function renameId(doc, from, to) {
    rebuild(doc, function (id, node) {
      if (node.children) node.children = node.children.map(function (c) { return c === from ? to : c; });
      return [id === from ? to : id, node];
    });
    if (doc.top === from) doc.top = to;
    Object.keys(doc.controls || {}).forEach(function (c) {
      (doc.controls[c].effects || []).forEach(function (e) {
        if (e.node === from) e.node = to;
      });
    });
  }

  // F2 / typing. `fresh` says the id has not been derived yet: it is derived
  // from the first real label, once, and is stable from then on.
  function rename(doc, id, label, fresh) {
    if (!has(doc.nodes, id) || !String(label).trim()) return null;
    doc = clone(doc);
    doc.nodes[id].label = String(label).trim();
    var next = fresh ? uniqueId(doc, slug(label), id) : id;
    if (next !== id) renameId(doc, id, next);
    return { doc: doc, select: next };
  }

  // The id field of the panel.
  function setId(doc, id, wanted) {
    var next = slug(wanted);
    if (!has(doc.nodes, id) || next === id || has(doc.nodes, next)) return null;
    doc = clone(doc);
    renameId(doc, id, next);
    return { doc: doc, select: next };
  }

  // G: or → and → vote → or.
  function cycleGate(doc, id) {
    var node = doc.nodes[id];
    if (!node || !node.gate) return null;
    doc = clone(doc);
    node = doc.nodes[id];
    node.gate = { or: "and", and: "vote", vote: "or" }[node.gate] || "or";
    if (node.gate === "vote") {
      // Rebuilt so `k` sits where the canonical form has it.
      var k = Math.max(1, Math.min(2, node.children.length));
      var out = {};
      Object.keys(node).forEach(function (key) {
        out[key] = node[key];
        if (key === "gate") out.k = k;
      });
      doc.nodes[id] = out;
    } else delete node.k;
    return { doc: doc, select: id };
  }

  // B / U.
  function setLeafKind(doc, id, kind) {
    var node = doc.nodes[id];
    if (!node || !node.leaf || node.leaf === kind) return null;
    doc = clone(doc);
    doc.nodes[id].leaf = kind;
    return { doc: doc, select: id };
  }

  // L, and Ctrl-drop: an existing node as one more child. This is how a
  // repeated event is made. Refused if it would close a cycle.
  function link(doc, parent, child) {
    if (!has(doc.nodes, parent) || !has(doc.nodes, child) || parent === child) return null;
    if ((doc.nodes[parent].children || []).indexOf(child) >= 0) return null;
    if (reaches(doc, child, parent)) return null;
    doc = clone(doc);
    toGate(doc.nodes[parent]);
    doc.nodes[parent].children.push(child);
    return { doc: doc, select: child };
  }

  function dropNodes(doc, orphans) {
    // A node goes when its last parent edge goes, and so, in turn, may its
    // children. Worklist, not recursion.
    while (orphans.length) {
      var id = orphans.pop();
      if (!has(doc.nodes, id) || id === doc.top || parentsOf(doc, id).length) continue;
      var children = doc.nodes[id].children || [];
      delete doc.nodes[id];
      children.forEach(function (c) {
        orphans.push(c);
      });
      Object.keys(doc.controls || {}).forEach(function (c) {
        var control = doc.controls[c];
        if (control.effects) control.effects = control.effects.filter(function (e) { return e.node !== id; });
      });
    }
  }

  // Del: this edge. A gate that loses its last child is a leaf again.
  function removeEdge(doc, parent, child) {
    if (!parent || !has(doc.nodes, parent)) return null;
    var at = (doc.nodes[parent].children || []).indexOf(child);
    if (at < 0) return null;
    doc = clone(doc);
    var children = doc.nodes[parent].children;
    children.splice(at, 1);
    if (!children.length) toLeaf(doc.nodes[parent]);
    else if (doc.nodes[parent].gate === "vote") doc.nodes[parent].k = Math.min(doc.nodes[parent].k, children.length);
    var before = Object.keys(doc.nodes).length;
    dropNodes(doc, [child]);
    return { doc: doc, select: has(doc.nodes, child) ? child : parent, removed: before - Object.keys(doc.nodes).length };
  }

  // Every edge into the node at once: the node goes, wherever it was used.
  function deleteNode(doc, id) {
    if (!has(doc.nodes, id) || id === doc.top) return null;
    var parents = parentsOf(doc, id);
    if (!parents.length) return null;
    var before = Object.keys(doc.nodes).length;
    var out = doc;
    parents.forEach(function (parent) {
      out = removeEdge(out, parent, id).doc;
    });
    return { doc: out, select: has(out.nodes, parents[0]) ? parents[0] : out.top, removed: before - Object.keys(out.nodes).length };
  }

  // What removing would mean, for whoever words the button: a shared node can
  // be unlinked from one parent and stay; `below` is what goes with the node.
  function removal(doc, id) {
    var gone = deleteNode(doc, id);
    if (!gone) return null;
    var parents = parentsOf(doc, id);
    return { shared: parents.length > 1, parents: parents, below: gone.removed - 1 };
  }


  // Drop without Ctrl: from one parent to another.
  function reparent(doc, id, from, to) {
    if (!has(doc.nodes, to) || to === id || from === to || reaches(doc, id, to)) return null;
    if ((doc.nodes[to].children || []).indexOf(id) >= 0) return null;
    var linked = link(doc, to, id);
    if (!linked) return null;
    var removed = from ? removeEdge(linked.doc, from, id) : null;
    return { doc: removed ? removed.doc : linked.doc, select: id };
  }

  // The panel: one key of one node. `undefined`/"" removes it. `p`, `rate` and
  // `ttc` are one quantity: setting one removes the others.
  function setAttribute(doc, id, key, value) {
    if (!has(doc.nodes, id)) return null;
    doc = clone(doc);
    var node = doc.nodes[id];
    if (["p", "rate", "ttc"].indexOf(key) >= 0) ["p", "rate", "ttc"].forEach(function (k) { delete node[k]; });
    if (value === undefined || value === "" || value === null) delete node[key];
    else node[key] = value;
    return { doc: doc, select: id };
  }

  // ---- assets: what a consequence costs. Made by name, so the id is right
  // from the start; the id is what consequences hold, so a new label keeps it.

  function addAsset(doc, label) {
    label = String(label == null ? "" : label).trim();
    if (!label) return null;
    doc = clone(doc);
    doc.assets = doc.assets || {};
    var base = slug(label);
    var id = base;
    for (var n = 2; has(doc.assets, id); n++) id = base + "-" + n;
    doc.assets[id] = { label: label, loss: {} };
    return { doc: doc, select: null, asset: id };
  }

  function setAssetLabel(doc, id, label) {
    label = String(label == null ? "" : label).trim();
    if (!has(doc.assets || {}, id) || !label) return null;
    doc = clone(doc);
    doc.assets[id].label = label;
    return { doc: doc, select: null, asset: id };
  }

  // `value` as typed: empty removes the dimension, a number is a number, the
  // rest is a distribution for wasm to judge.
  function setAssetLoss(doc, id, dim, value) {
    if (!has(doc.assets || {}, id) || ["c", "i", "a"].indexOf(dim) < 0) return null;
    doc = clone(doc);
    var asset = doc.assets[id];
    var typed = String(value == null ? "" : value).trim();
    var loss = {};
    // Rebuilt in c, i, a order, whatever was there before.
    ["c", "i", "a"].forEach(function (d) {
      var v = d === dim ? typed : (asset.loss || {})[d];
      if (v === undefined || v === "") return;
      loss[d] = d === dim && /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(typed) ? Number(typed) : v;
    });
    Object.keys(asset.loss || {}).forEach(function (k) {
      if (!has(loss, k) && ["c", "i", "a"].indexOf(k) < 0) loss[k] = asset.loss[k]; // x- keys
    });
    asset.loss = loss;
    return { doc: doc, select: null, asset: id };
  }

  function usesOfAsset(doc, id) {
    var n = 0;
    Object.keys(doc.nodes).forEach(function (node) {
      (doc.nodes[node].consequences || []).forEach(function (c) {
        if (c.asset === id) n++;
      });
    });
    return n;
  }

  function removeAsset(doc, id) {
    if (!has(doc.assets || {}, id)) return null;
    doc = clone(doc);
    delete doc.assets[id];
    if (!Object.keys(doc.assets).length) delete doc.assets;
    Object.keys(doc.nodes).forEach(function (node) {
      var list = doc.nodes[node].consequences;
      if (!list) return;
      list = list.filter(function (c) { return c.asset !== id; });
      if (list.length) doc.nodes[node].consequences = list;
      else delete doc.nodes[node].consequences;
    });
    return { doc: doc, select: null, removed: 1 };
  }

  // A rate is how the format says "how often"; people say it the other way
  // round: once every so long. Both directions, in the document's time unit.
  var HOURS = { h: 1, d: 24, y: 8760 };

  function rateFrom(every, unit, docUnit) {
    if (!(every > 0) || !HOURS[unit] || !HOURS[docUnit]) return null;
    return HOURS[docUnit] / (every * HOURS[unit]);
  }

  // The largest unit in which the mean time is at least one.
  function meanTime(rate, docUnit) {
    if (!(rate > 0) || !HOURS[docUnit]) return null;
    var hours = HOURS[docUnit] / rate;
    var unit = hours >= HOURS.y ? "y" : hours >= HOURS.d ? "d" : "h";
    return { every: Number((hours / HOURS[unit]).toPrecision(4)), unit: unit };
  }

  // The left panel: the DAG as an outline. A repeated node appears under each
  // parent, marked, and is opened only the first time, so the outline is no
  // bigger than the graph. Iterative.
  function outline(doc) {
    var rows = [];
    var opened = Object.create(null);
    var stack = has(doc.nodes || {}, doc.top) ? [{ id: doc.top, depth: 0, parent: null }] : [];
    while (stack.length) {
      var at = stack.pop();
      var node = doc.nodes[at.id];
      var again = !!opened[at.id];
      rows.push({ id: at.id, label: node.label || at.id, depth: at.depth, parent: at.parent, gate: node.gate || null, repeated: again });
      if (again) continue;
      opened[at.id] = true;
      var children = (node.children || []).filter(function (c) { return has(doc.nodes, c); });
      for (var i = children.length - 1; i >= 0; i--) stack.push({ id: children[i], depth: at.depth + 1, parent: at.id });
    }
    return rows;
  }

  // Arrows. `parent` is the edge the selection was reached by.
  function walk(doc, id, parent, key) {
    var node = doc.nodes[id];
    if (!node) return null;
    if (key === "ArrowDown") return node.children && node.children.length ? { id: node.children[0], parent: id } : null;
    var up = parent && has(doc.nodes, parent) ? parent : parentsOf(doc, id)[0];
    if (!up) return null;
    if (key === "ArrowUp") return { id: up, parent: parentsOf(doc, up)[0] || null };
    var siblings = doc.nodes[up].children;
    var next = siblings[siblings.indexOf(id) + (key === "ArrowRight" ? 1 : -1)];
    return next ? { id: next, parent: up } : null;
  }

  // Undo / redo over document snapshots (texts).
  function createHistory(limit) {
    var past = [];
    var future = [];
    return {
      push: function (text) {
        past.push(text);
        if (past.length > (limit || 200)) past.shift();
        future = [];
      },
      undo: function (current) {
        if (!past.length) return null;
        future.push(current);
        return past.pop();
      },
      redo: function (current) {
        if (!future.length) return null;
        past.push(current);
        return future.pop();
      },
      canUndo: function () {
        return past.length > 0;
      },
      canRedo: function () {
        return future.length > 0;
      },
    };
  }

  var api = {
    slug: slug, parentsOf: parentsOf, addChild: addChild, addSibling: addSibling, rename: rename, setId: setId,
    cycleGate: cycleGate, setLeafKind: setLeafKind, link: link, removeEdge: removeEdge, deleteNode: deleteNode, removal: removal,
    reparent: reparent, setAttribute: setAttribute, outline: outline, rateFrom: rateFrom, meanTime: meanTime,
    addAsset: addAsset, setAssetLabel: setAssetLabel, setAssetLoss: setAssetLoss, removeAsset: removeAsset, usesOfAsset: usesOfAsset, walk: walk, createHistory: createHistory,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorEdit = api;
})();
