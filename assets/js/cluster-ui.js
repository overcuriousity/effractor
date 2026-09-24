// Clusters and several selected components (clustering spec §3, §5): the
// inspector's sections, the rail's cluster button, keys and menus. The
// edits are clusters.js's; this is the DOM.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var C = window.effractorClusters;
  var icons = window.effractorArchitectureIcons;
  var P = window.effractorProfiles;
  var L = window.effractorArchitectureLinks;
  var SIZE = window.effractorGraph.SIZE;

  function doc() {
    return app.state.doc;
  }
  function $(id) {
    return document.getElementById(id);
  }

  // A row per component: its icon and name; a click selects it. `extra`
  // adds to the row (a button, a drag).
  function row(list, id, extra) {
    var e = doc().entities[id];
    var item = document.createElement("li");
    var sample = icons.svg(document, e.kind, 18);
    sample.setAttribute("class", sample.getAttribute("class") + " is-plate");
    item.appendChild(sample);
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = e.label;
    item.appendChild(name);
    item.title = e.label + " · " + e.kind;
    item.addEventListener("click", function (ev) {
      if (ev.target.closest("button")) return;
      app.select("entity/" + id);
    });
    item.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      U.menuFor(id, ev.clientX, ev.clientY, true);
    });
    if (extra) extra(item);
    list.appendChild(item);
    return item;
  }

  // Several selected: how many, and which.
  U.sections.picked = function (form) {
    var members = C.entitiesOf(doc(), app.state.picked);
    $("inspector-name").textContent = members.length + " components";
    var list = document.createElement("ul");
    list.className = "cluster-members";
    members.forEach(function (id) {
      row(list, id);
    });
    form.appendChild(list);
  };

  // ---- the edits, with places kept in place ----

  function own(map, key) {
    return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  }

  // Before an edit lands: a cluster closing stands amid its members, which
  // keep their places for opening; a cluster opening puts them round where
  // it stands (spec §4.3).
  function inPlace(before, after) {
    var was = before.clusters || {}, now = after.clusters || {};
    Object.keys(now).forEach(function (cid) {
      var c = now[cid];
      var old = own(was, cid);
      var entity = function (m) { return "entity/" + m; };
      if (c.closed && (!old || !old.closed)) {
        var at = app.positionsOf(c.members.map(entity));
        app.putPositions(at);
        var centre = C.closeAt(Object.keys(at).map(function (k) { return at[k]; }));
        if (centre) {
          var put = {};
          put["cluster/" + cid] = centre;
          app.putPositions(put);
        }
      } else if (!c.closed && old && old.closed) {
        var here = app.positionsOf(["cluster/" + cid])["cluster/" + cid];
        if (!here) return;
        var stored = app.storedPositions();
        var mine = {};
        c.members.forEach(function (m) {
          if (own(stored, "entity/" + m)) mine[m] = stored["entity/" + m];
        });
        var moved = C.reopen(here, c.members, mine);
        var put2 = {};
        Object.keys(moved).forEach(function (m) { put2["entity/" + m] = moved[m]; });
        app.putPositions(put2);
      }
    });
  }

  // Every cluster edit: `select: undefined` keeps what is selected.
  function act(build) {
    return U.apply(function () {
      var edit = build();
      if (!edit) return null;
      if (edit.select === undefined) edit.select = app.state.selected;
      inPlace(doc(), edit.doc);
      return edit;
    }, null, true);
  }

  function toggleAll() {
    if (!C.toggleAll(doc())) return app.say("nothing runs together here · select two or more and press C");
    act(function () { return C.toggleAll(doc()); });
  }
  // K and the rail (owner, 2026-09-25): nothing selected, everything; one
  // cluster or a member of one, open or close it; several, one cluster of them.
  function pressK() {
    var picked = app.state.picked || [];
    var edit = C.pressK(doc(), picked);
    if (edit.refusal) return app.say(edit.refusal);
    act(function () { return C.pressK(doc(), picked); });
  }
  function railTitle() {
    var picked = app.state.picked || [];
    if (!picked.length) return "Cluster · uncluster all (K)";
    if (picked.length > 1) return "Cluster the " + picked.length + " selected (K)";
    var q = P.qualified(picked[0]);
    var cid = q && q.kind === "cluster" ? q.id : q && q.kind === "entity" ? C.clusterOf(doc(), q.id) : null;
    return cid && own(doc().clusters, cid) ? (doc().clusters[cid].closed ? "Open" : "Close") + " “" + C.label(doc(), cid) + "” (K)" : "Cluster · uncluster (K)";
  }
  function buildMissing() {
    if (!C.build(doc())) return app.say("nothing more runs together");
    act(function () { return C.build(doc()); });
  }
  function clusterPicked() {
    var members = C.entitiesOf(doc(), app.state.picked || []);
    if (members.length < 2) return app.say("select two or more to cluster · Ctrl-click or Shift + drag");
    act(function () { return C.make(doc(), members); });
  }
  function selectedCluster() {
    var q = P.qualified(app.state.selected);
    return q && q.kind === "cluster" && own(doc().clusters, q.id) ? q.id : null;
  }
  function openClose(cid) {
    act(function () { return C.setClosed(doc(), cid, !doc().clusters[cid].closed); });
  }
  function takeOut(cid, m) {
    act(function () { return C.takeOut(doc(), cid, m); });
  }
  function focusName() {
    var field = $("prop-cluster-label");
    if (!field) return;
    field.focus();
    field.select();
  }
  function arch() {
    return P.isArchitecture(doc()) && app.state.mode !== "attack";
  }

  // ---- the rail and keys ----

  var railButton = document.querySelector('[data-action="clusterAll"]');
  railButton.addEventListener("click", function () {
    if (arch()) pressK();
  });
  app.onChange(function () {
    if (!doc() || !P.isArchitecture(doc())) return;
    railButton.title = railTitle();
  });

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || !arch() || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || e.target.closest(".menu") || document.querySelector("dialog[open]")) return;
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "k") {
      e.preventDefault();
      return pressK();
    }
    var cid = selectedCluster();
    if (key === "c") {
      e.preventDefault();
      return cid ? openClose(cid) : clusterPicked();
    }
    if (key === "F2" && cid) {
      e.preventDefault();
      return focusName();
    }
  });
  U.keyList.push(["C", "Cluster the selected; open or close a cluster"], ["K", "Nothing selected: cluster · uncluster all; one: open or close its cluster; several: merge into one"]);

  // ---- menus ----

  // A component's menu: cluster what is selected, or take it out of its own.
  U.menuItems.push(function (id) {
    var items = [];
    var cid = C.clusterOf(doc(), id);
    if (cid) {
      var name = C.label(doc(), cid);
      if ((doc().clusters[cid].shown || []).indexOf(id) >= 0) items.push(["Back into “" + name + "”", "", function () { act(function () { return C.unpeel(doc(), cid, id); }); }]);
      items.push(["Take out of “" + name + "”", "", function () { takeOut(cid, id); }]);
      if (!doc().clusters[cid].closed) items.push(["Close “" + name + "”", "", function () { openClose(cid); }]);
    }
    return items;
  });

  function clusterMenu(cid, x, y) {
    app.select("cluster/" + cid);
    var c = doc().clusters[cid];
    var name = C.label(doc(), cid);
    var members = c.members.filter(function (m) { return own(doc().entities, m); });
    app.showMenu([
      [c.closed ? "Open" : "Close", "C", function () { openClose(cid); }],
      ["Dissolve", "", function () { act(function () { return C.dissolve(doc(), cid); }); }],
      ["Rename", "F2", focusName],
      ["Take out", "", members.map(function (m) {
        return [doc().entities[m].label, "", function () { takeOut(cid, m); }];
      })],
      ["Show in source", "", function () { app.showSourcePath("clusters." + cid); }],
      ["Delete “" + name + "” and " + members.length + " components", "Del", function () {
        U.apply(function () { return L.removeAll(doc(), members); }, null, true);
      }],
    ], x, y);
  }

  function pickedMenu(x, y) {
    var members = C.entitiesOf(doc(), app.state.picked);
    app.showMenu([
      ["Cluster " + members.length + " components", "C", clusterPicked],
      ["Delete " + members.length + " components", "Del", function () {
        U.apply(function () { return L.removeAll(doc(), members); }, null, true);
      }],
    ], x, y);
  }

  U.contextHooks.push(function (e) {
    if (e.edge) return false;
    var q = P.qualified(e.id);
    if (q && q.kind === "cluster" && own(doc().clusters, q.id)) {
      clusterMenu(q.id, e.x, e.y);
      return true;
    }
    var picked = app.state.picked || [];
    if (picked.length > 1 && picked.indexOf(e.id) >= 0) {
      pickedMenu(e.x, e.y);
      return true;
    }
    return false;
  });

  U.backgroundItems.push(function () {
    return [["Cluster · uncluster all", "K", toggleAll], ["Cluster what runs together", "", buildMissing]];
  });

  // A merged line: which of its lines.
  app.renderer.on("select", function (e) {
    if (!e.edge || !/^(links|flows|permits)\//.test(e.edge) || !app.state.bundles) return;
    var held = app.state.bundles[e.edge] || [];
    app.showMenu(held.map(function (id) {
      return [app.labelOf(id), "", function () { app.select(id); }];
    }), e.x, e.y);
  });

  // ---- the cluster's inspector ----

  U.sections.cluster = function (form, cid) {
    var c = doc().clusters[cid];
    var label = U.field(form, "prop-cluster-label", "Label", U.input("text", c.label || ""));
    label.placeholder = C.label(doc(), cid);
    label.addEventListener("change", function () {
      act(function () { return C.rename(doc(), cid, label.value); });
    });
    label.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== "Escape") return;
      ev.preventDefault();
      if (ev.key === "Escape") label.value = c.label || "";
      label.blur();
    });
    var shown = U.field(form, "prop-cluster-closed", "Shown", window.effractorMenu.dropdown([["closed", "Closed"], ["open", "Open"]], c.closed ? "closed" : "open"));
    shown.addEventListener("change", function () {
      act(function () { return C.setClosed(doc(), cid, shown.value === "closed"); });
    });
    var list = document.createElement("ul");
    list.className = "cluster-members";
    c.members.filter(function (m) { return own(doc().entities, m); }).forEach(function (m) {
      row(list, m, function (item) {
        item.title += " · drag out onto the canvas";
        var out = document.createElement("button");
        out.type = "button";
        out.className = "btn-icon member-out";
        out.textContent = "×";
        out.title = "Take out";
        out.setAttribute("aria-label", "Take " + doc().entities[m].label + " out");
        out.addEventListener("click", function () {
          takeOut(cid, m);
        });
        item.appendChild(out);
        item.addEventListener("pointerdown", function (ev) {
          if (ev.button === 0 && !ev.target.closest("button")) startDrag(cid, m, ev);
        });
      });
    });
    form.appendChild(list);
  };

  // ---- a member dragged out of the inspector ----

  var DRAG_PX = 4;
  var drag = null; // {cid, member, x, y, moved, ghost, over}

  function clusterAt(x, y) {
    var hit = document.elementFromPoint(x, y);
    var node = hit && hit.closest ? hit.closest("#canvas .node") : null;
    var q = node ? P.qualified(node.getAttribute("data-id")) : null;
    return q && q.kind === "cluster" && own(doc().clusters, q.id) ? q.id : null;
  }
  function overCanvas(x, y) {
    var hit = document.elementFromPoint(x, y);
    return !!(hit && hit.closest && hit.closest("#canvas") && !hit.closest("#inspector"));
  }
  function startDrag(cid, member, ev) {
    drag = { cid: cid, member: member, x: ev.clientX, y: ev.clientY, moved: false, ghost: null, over: null };
  }
  function endDrag() {
    if (!drag) return;
    if (drag.ghost) drag.ghost.remove();
    app.renderer.highlight([], "pin-drop");
    document.body.classList.remove("is-pinning");
    drag = null;
  }
  document.addEventListener("pointermove", function (e) {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < DRAG_PX) return;
    if (!drag.moved) {
      drag.moved = true;
      drag.ghost = document.createElement("div");
      drag.ghost.className = "pin-ghost member-ghost";
      drag.ghost.textContent = doc().entities[drag.member].label;
      document.body.appendChild(drag.ghost);
      document.body.classList.add("is-pinning");
    }
    drag.ghost.style.setProperty("--pin-x", e.clientX + "px");
    drag.ghost.style.setProperty("--pin-y", e.clientY + "px");
    var over = clusterAt(e.clientX, e.clientY);
    if (over !== drag.over) {
      drag.over = over;
      app.renderer.highlight(over ? ["cluster/" + over] : [], "pin-drop");
    }
  });
  document.addEventListener("pointerup", function (e) {
    if (!drag) return;
    var d = drag;
    endDrag();
    if (!d.moved) return; // a click: the row's own click selects it
    var into = clusterAt(e.clientX, e.clientY);
    if (into) return dropInto(d.member, into);
    if (!overCanvas(e.clientX, e.clientY)) return;
    // Onto the canvas (owner, 2026-09-25): out of the stack, still a member,
    // standing where it was dropped inside the cluster's outline.
    var p = app.renderer.pointAt(e.clientX, e.clientY);
    var put = {};
    put["entity/" + d.member] = { x: Math.round(p.x - SIZE.width / 2), y: Math.round(p.y - SIZE.plate / 2) };
    app.putPositions(put);
    if (doc().clusters[d.cid].closed) return act(function () { return C.peel(doc(), d.cid, d.member); });
    app.redraw();
  });

  // A member's row dropped on a cluster: see merge.
  function dropInto(entity, cid) {
    if (!C.merge(doc(), "entity/" + entity, "cluster/" + cid)) return;
    act(function () { return C.merge(doc(), "entity/" + entity, "cluster/" + cid); });
  }
  // One component or cluster dragged on the canvas onto another: merged
  // (owner, 2026-09-25); already together, it only moved.
  app.renderer.on("drop", function (e) {
    if (!arch() || !/^(entity|cluster)\//.test(e.id) || !/^(entity|cluster)\//.test(e.target)) return;
    if (!C.merge(doc(), e.id, e.target)) return;
    act(function () { return C.merge(doc(), e.id, e.target); });
  });
  document.addEventListener("pointercancel", endDrag);
  document.addEventListener("keydown", function (e) {
    if (drag && e.key === "Escape") {
      e.stopPropagation();
      endDrag();
    }
  }, true);

  window.effractorClusterUi = { row: row, toggleAll: toggleAll };
})();
