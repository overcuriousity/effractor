// The editor (spec 7.2): keys, drops, the context menu, link-existing, the
// property panel and the model tree. It decides *which* edit; edit.js makes the
// new document, and app.js sends it through wasm and redraws. No positions are
// stored and nothing is dragged about: ELK owns the layout.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var E = window.effractorEdit;
  var NS = "http://www.w3.org/2000/svg";
  var $ = function (id) {
    return document.getElementById(id);
  };
  // Ids still named after the placeholder: the first real label names them.
  var fresh = Object.create(null);

  function doc() {
    return app.state.doc;
  }
  function selected() {
    return app.state.selected;
  }
  function node() {
    return selected() ? doc().nodes[selected()] : null;
  }

  // An edit that fails says so on the canvas: nothing is refused in silence.
  function apply(edit, then) {
    if (!edit) {
      app.say("that edit is not possible here");
      return Promise.resolve(false);
    }
    return app.applyEdit(edit).then(
      function (applied) {
        if (applied && then) then();
        return applied;
      },
      function (e) {
        console.error(e);
        app.say("the edit failed: " + e.message);
        return false;
      }
    );
  }

  // The fields live in the right panel; an action that goes there opens it.
  function openPanel() {
    var toggle = document.querySelector('[data-toggle="right"]');
    if ($("app").getAttribute("data-right") === "closed" && toggle) toggle.click();
  }

  function focusLabel() {
    var field = $("prop-label");
    if (!field) return;
    openPanel();
    field.focus();
    field.select();
  }

  // ---- the actions: one list, used by keys, menu and rail alike ----

  var actions = {
    addChild: function () {
      if (!selected()) return;
      var edit = E.addChild(doc(), selected());
      edit.parent = selected();
      apply(edit, function () {
        fresh[edit.fresh] = true;
        focusLabel();
      });
    },
    addSibling: function () {
      var edit = E.addSibling(doc(), selected(), app.state.parent);
      if (!edit) return;
      edit.parent = app.state.parent;
      apply(edit, function () {
        fresh[edit.fresh] = true;
        focusLabel();
      });
    },
    rename: focusLabel,
    // Into the panel by keyboard: Tab is taken, and the spec wants the whole
    // tree buildable without a pointer. Esc comes back out.
    properties: function () {
      var first = $("prop-quantity") || $("prop-gate");
      openPanel();
      if (first) first.focus();
    },
    cycleGate: function () {
      apply(E.cycleGate(doc(), selected()));
    },
    basic: function () {
      apply(E.setLeafKind(doc(), selected(), "basic"));
    },
    undeveloped: function () {
      apply(E.setLeafKind(doc(), selected(), "undeveloped"));
    },
    link: function () {
      openLinkDialog("link");
    },
    // What a drop does, for those who do not drag.
    move: function () {
      if (!selected()) return;
      if (!app.state.parent) return app.say("the top event cannot be moved");
      openLinkDialog("move");
    },
    // The rail's two halves of Del, for those who want to say which.
    deleteNode: function () {
      var ways = removals();
      if (ways.length) ways[ways.length - 1][2]();
    },
    unlink: function () {
      var ways = removals().slice(0, -1);
      var chosen = ways.filter(function (w) { return w[1]; })[0];
      if (chosen) return chosen[2]();
      if (ways.length) showMenuAtSelection(ways);
    },
    undo: function () {
      app.undo();
    },
    redo: function () {
      app.redo();
    },
    // Del. A node with one parent is deleted; a shared one is unlinked from
    // the parent it was reached through — and if it was not reached through
    // any (a click on the canvas, where it is drawn once), the choice is shown.
    remove: function () {
      var ways = removals();
      if (!selected()) return;
      if (!ways.length) return app.say("the top event cannot be removed");
      if (ways.length === 1) return ways[0][2]();
      var chosen = ways.filter(function (w) { return w[1]; })[0];
      if (chosen) return chosen[2]();
      showMenuAtSelection(ways);
    },
  };

  function quoted(id) {
    return "“" + (doc().nodes[id].label || id) + "”";
  }

  function andBelow(n) {
    return n ? " and " + n + " below" : "";
  }

  // No question is asked before a removal: what it did is said, and how to
  // take it back.
  function removeWith(edit, done) {
    if (edit) edit.parent = E.parentsOf(edit.doc, edit.select)[0] || null;
    apply(edit, function () {
      app.say(done + " · Ctrl+Z undoes");
    });
  }

  // The ways the selection can go, worded as what will happen: [label, key,
  // run]. The key is on the one that Del takes without asking.
  function removals() {
    var id = selected();
    var r = id ? E.removal(doc(), id) : null;
    if (!r) return [];
    var name = quoted(id);
    function del() {
      removeWith(E.deleteNode(doc(), id), "deleted " + name + andBelow(r.below));
    }
    if (!r.shared) return [["Delete " + name + andBelow(r.below), "Del", del]];
    var ways = r.parents.map(function (parent) {
      var from = quoted(parent);
      return ["Unlink from " + from, app.state.parentChosen && parent === app.state.parent ? "Del" : "", function () {
        removeWith(E.removeEdge(doc(), parent, id), "unlinked " + name + " from " + from);
      }];
    });
    return ways.concat([["Delete everywhere" + andBelow(r.below), "", del]]);
  }

  var MENU = [
    ["addChild", "Add child", "Tab", function () { return true; }],
    ["addSibling", "Add sibling", "Enter", function () { return !!app.state.parent; }],
    ["rename", "Rename", "F2", function () { return true; }],
    ["properties", "Edit properties", "P", function () { return true; }],
    ["cycleGate", "Cycle gate", "G", function (n) { return !!n.gate; }],
    ["basic", "Basic event", "B", function (n) { return n.leaf === "undeveloped"; }],
    ["undeveloped", "Undeveloped event", "U", function (n) { return n.leaf === "basic"; }],
    ["link", "Link existing…", "L", function () { return true; }],
    ["move", "Move under…", "M", function () { return !!app.state.parent; }],
    ["remove", "Delete, or unlink a shared node", "Del", function () { return !!app.state.parent; }],
  ];

  // ---- keyboard ----

  function typingElsewhere(e) {
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || $("link-dialog").open;
  }

  // Everything the page does by key or pointer that is not in MENU: the help
  // dialog lists both, so a key that exists is a key that is shown.
  var OTHER_KEYS = [
    ["↑ ↓ ← →", "Walk the tree: parent, child, siblings"],
    ["any letter", "Rename, starting with that letter"],
    ["Esc", "Leave a field, close a menu"],
    ["Ctrl+Z", "Undo"],
    ["Ctrl+Shift+Z", "Redo"],
    ["Ctrl+Enter", "Solve, or cancel a running solve"],
    ["F", "Fit to view"],
    ["+  −", "Zoom in, zoom out"],
    ["?", "This list"],
    ["click", "Select a node"],
    ["right-click", "Menu of the node's actions"],
    ["click a line", "Select the child along that edge: Del unlinks exactly it"],
    ["drag the background", "Pan"],
    ["wheel", "Zoom at the pointer"],
    ["drag a node onto another", "Move it under that node"],
    ["Ctrl + drag onto another", "Link it under that node as well"],
  ];

  var KEYS = { m: "move", p: "properties", Tab: "addChild", Enter: "addSibling", F2: "rename", g: "cycleGate", b: "basic", u: "undeveloped", l: "link", Delete: "remove", Backspace: "remove" };

  document.addEventListener("keydown", function (e) {
    var mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? app.redo() : app.undo();
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      return app.redo();
    }
    if (e.key === "Escape") {
      closeMenu();
      if ($("properties").contains(document.activeElement)) document.activeElement.blur();
    }
    if (typingElsewhere(e) || mod || e.altKey) return;
    if (e.key === "?") {
      e.preventDefault();
      return openHelp();
    }
    if (!selected()) return;

    if (e.key.indexOf("Arrow") === 0) {
      var to = E.walk(doc(), selected(), app.state.parent, e.key);
      if (to) app.select(to.id, to.parent);
      return e.preventDefault();
    }
    var action = KEYS[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (action) {
      e.preventDefault();
      return actions[action]();
    }
    // Any other character starts a rename with that character.
    if (e.key.length === 1 && " +-".indexOf(e.key) < 0 && e.key.toLowerCase() !== "f") {
      var field = $("prop-label");
      if (!field) return;
      e.preventDefault();
      field.focus();
      field.value = e.key;
    }
  });

  // ---- pointer: drop reparents, Ctrl-drop links ----

  app.renderer.on("drop", function (e) {
    if (e.ctrl) return apply(E.link(doc(), e.target, e.id));
    var edit = E.reparent(doc(), e.id, E.parentsOf(doc(), e.id)[0] || null, e.target);
    if (edit) edit.parent = e.target;
    apply(edit);
  });

  // ---- context menu ----

  function closeMenu() {
    $("context-menu").hidden = true;
  }

  // The same menu wherever a node is shown: on the canvas, and in the model
  // tree, where `parent` is the edge the row stands for.
  function showMenuAtSelection(items) {
    var at = document.querySelector("#canvas .node.hl-selected");
    var box = (at || $("canvas")).getBoundingClientRect();
    showMenu(items, box.left + box.width / 2, box.top + box.height / 2);
  }

  // `items`: [label, key, run].
  function showMenu(items, x, y) {
    closeMenu();
    var menu = $("context-menu");
    menu.replaceChildren();
    items.forEach(function (item) {
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.appendChild(document.createTextNode(item[0]));
      var key = document.createElement("kbd");
      key.textContent = item[1];
      button.appendChild(key);
      button.addEventListener("click", function () {
        closeMenu();
        item[2]();
      });
      menu.appendChild(button);
    });
    menu.style.setProperty("--menu-x", Math.max(0, Math.min(x, window.innerWidth - 260)) + "px");
    menu.style.setProperty("--menu-y", Math.max(0, Math.min(y, window.innerHeight - 30 * menu.children.length - 12)) + "px");
    menu.hidden = false;
    menu.children[0].focus(); // Tab and Enter work from here; Esc closes
  }

  function openMenu(id, parent, x, y) {
    closeMenu();
    if (!id) return;
    app.select(id, parent);
    var items = MENU.filter(function (item) {
      return item[0] !== "remove" && item[3](node());
    }).map(function (item) {
      return [item[1], item[2], actions[item[0]]];
    });
    showMenu(items.concat(removals()), x, y);
  }

  app.renderer.on("context", function (e) {
    openMenu(e.id, e.parent, e.x, e.y);
  });
  document.addEventListener("pointerdown", function (e) {
    if (!$("context-menu").contains(e.target)) closeMenu();
  });

  // ---- link existing: a search over the nodes ----

  var linkChoice = 0;
  var linkMode = "link"; // "link": pick a child for the selection; "move": pick its new parent

  function linkEdit(id) {
    if (linkMode === "move") {
      var moved = E.reparent(doc(), selected(), app.state.parent, id);
      if (moved) moved.parent = id;
      return moved;
    }
    var linked = E.link(doc(), selected(), id);
    if (linked) linked.parent = selected();
    return linked;
  }

  function linkCandidates(query) {
    var q = query.trim().toLowerCase();
    return Object.keys(doc().nodes).filter(function (id) {
      if (!linkEdit(id)) return false;
      return !q || id.indexOf(q) >= 0 || String(doc().nodes[id].label).toLowerCase().indexOf(q) >= 0;
    });
  }

  function renderLinkResults() {
    var ids = linkCandidates($("link-search").value);
    linkChoice = Math.max(0, Math.min(linkChoice, ids.length - 1));
    var list = $("link-results");
    list.replaceChildren();
    ids.slice(0, 50).forEach(function (id, i) {
      var item = document.createElement("li");
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(i === linkChoice));
      var label = document.createElement("span");
      label.textContent = doc().nodes[id].label;
      var code = document.createElement("span");
      code.className = "id";
      code.textContent = id;
      item.appendChild(label);
      item.appendChild(code);
      item.addEventListener("click", function () {
        chooseLink(id);
      });
      list.appendChild(item);
    });
    return ids;
  }

  function chooseLink(id) {
    $("link-dialog").close();
    apply(linkEdit(id));
  }

  function openLinkDialog(mode) {
    if (!selected()) return;
    linkMode = mode;
    $("link-search").value = "";
    $("link-search").placeholder = mode === "move" ? "Move under which node…" : "Link an existing node…";
    linkChoice = 0;
    renderLinkResults();
    $("link-dialog").showModal();
  }

  $("link-search").addEventListener("input", function () {
    linkChoice = 0;
    renderLinkResults();
  });
  $("link-search").addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      linkChoice += e.key === "ArrowDown" ? 1 : -1;
      renderLinkResults();
    } else if (e.key === "Enter") {
      e.preventDefault();
      var ids = renderLinkResults();
      if (ids.length) chooseLink(ids[linkChoice]);
    }
  });

  // ---- the property panel ----

  function field(form, id, label, control) {
    var l = document.createElement("label");
    l.htmlFor = id;
    l.textContent = label;
    control.id = id;
    form.appendChild(l);
    form.appendChild(control);
    return control;
  }

  function input(type, value) {
    var i = document.createElement(type === "textarea" ? "textarea" : "input");
    if (type !== "textarea") i.type = type;
    if (type === "number") i.step = "any";
    i.value = value == null ? "" : value;
    return i;
  }

  function choice(options, value) {
    var s = document.createElement("select");
    options.forEach(function (o) {
      var option = document.createElement("option");
      option.value = o[0];
      option.textContent = o[1];
      s.appendChild(option);
    });
    s.value = value;
    return s;
  }

  // A number field commits a number; an empty one removes the key.
  function numeric(control, key) {
    control.addEventListener("change", function () {
      var v = control.value.trim();
      apply(E.setAttribute(doc(), selected(), key, v === "" ? "" : Number(v)));
    });
  }

  function quantityOf(n) {
    return n.p !== undefined ? "p" : n.rate !== undefined ? "rate" : n.ttc !== undefined ? "ttc" : "";
  }

  function expressionOf(n) {
    var kind = quantityOf(n);
    return kind === "p" ? "Bernoulli(" + n.p + ")" : kind === "rate" ? "Exponential(" + n.rate + ")" : kind === "ttc" ? String(n.ttc) : null;
  }

  // The distribution at a glance: where in [0, T] the probability arrives.
  // The numbers are the wasm module's; this only draws them.
  function sketch(form, n) {
    var expression = expressionOf(n);
    if (!expression) return;
    var box = document.createElement("div");
    box.className = "sketch";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 64 20");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Probability over the horizon");
    var note = document.createElement("span");
    note.className = "num";
    box.appendChild(svg);
    box.appendChild(note);
    form.appendChild(box);
    app.solver.sketch(expression, doc().horizon).then(function (answer) {
      if (!answer.ok) {
        note.textContent = answer.error;
        note.classList.add("problem");
        return;
      }
      var cdf = answer.ok.cdf;
      // Mass per bin; what is already there at t = 0 goes into the first.
      var mass = cdf.slice(1).map(function (v, i) {
        return v - cdf[i] + (i === 0 ? cdf[0] : 0);
      });
      var top = Math.max.apply(null, mass) || 1;
      mass.forEach(function (m, i) {
        var h = (19 * m) / top;
        var bar = document.createElementNS(NS, "rect");
        bar.setAttribute("x", i * 2 + 0.2);
        bar.setAttribute("y", 20 - h);
        bar.setAttribute("width", 1.6);
        bar.setAttribute("height", h);
        svg.appendChild(bar);
      });
      note.textContent = "p(T) = " + window.effractorResults.number(answer.ok.p_horizon);
    }, function () {});
  }

  function consequences(form, n) {
    var assets = Object.keys(doc().assets || {});
    if (!assets.length && !(n.consequences || []).length) return;
    var title = document.createElement("p");
    title.className = "hint";
    title.textContent = "Consequences";
    form.appendChild(title);
    var list = document.createElement("ul");
    list.className = "consequences";
    (n.consequences || []).forEach(function (c, index) {
      var item = document.createElement("li");
      var text = document.createElement("span");
      text.textContent = c.asset + " · " + c.dim + (c.fraction == null ? "" : " · " + c.fraction);
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost btn-small";
      remove.textContent = "Remove";
      remove.addEventListener("click", function () {
        var rest = n.consequences.filter(function (_, i) { return i !== index; });
        apply(E.setAttribute(doc(), selected(), "consequences", rest.length ? rest : ""));
      });
      item.appendChild(text);
      item.appendChild(remove);
      list.appendChild(item);
    });
    form.appendChild(list);
    if (!assets.length) return;
    var row = document.createElement("div");
    row.className = "consequence-add";
    var asset = choice(assets.map(function (a) { return [a, a]; }), assets[0]);
    var dim = choice([["c", "C"], ["i", "I"], ["a", "A"]], "a");
    var fraction = input("number", "");
    fraction.placeholder = "1";
    fraction.setAttribute("aria-label", "Fraction");
    asset.setAttribute("aria-label", "Asset");
    dim.setAttribute("aria-label", "Dimension");
    var add = document.createElement("button");
    add.type = "button";
    add.className = "btn btn-ghost btn-small";
    add.textContent = "Add";
    add.addEventListener("click", function () {
      var c = { asset: asset.value, dim: dim.value };
      if (fraction.value.trim() !== "") c.fraction = Number(fraction.value);
      apply(E.setAttribute(doc(), selected(), "consequences", (n.consequences || []).concat([c])));
    });
    [asset, dim, fraction, add].forEach(function (el) { row.appendChild(el); });
    form.appendChild(row);
  }

  function renderProperties() {
    var form = $("properties");
    var keepFocus = document.activeElement && document.activeElement.id;
    form.replaceChildren();
    var n = node();
    form.hidden = !n;
    if (!n) return;
    var id = selected();

    var label = field(form, "prop-label", "Label", input("text", n.label));
    label.addEventListener("change", function () {
      var wasFresh = !!fresh[id];
      apply(E.rename(doc(), id, label.value, wasFresh), function () {
        delete fresh[id];
      });
    });
    label.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      if (e.key === "Escape") label.value = n.label;
      label.blur(); // back to the canvas's keys
    });
    var idField = field(form, "prop-id", "Id", input("text", id));
    idField.classList.add("mono");
    idField.addEventListener("change", function () {
      apply(E.setId(doc(), id, idField.value)).then(function (applied) {
        if (!applied) idField.value = id;
      });
    });
    var note = field(form, "prop-description", "Note", input("textarea", n.description));
    note.addEventListener("change", function () {
      apply(E.setAttribute(doc(), id, "description", note.value.trim()));
    });

    if (n.gate) {
      var gate = field(form, "prop-gate", "Gate", choice([["or", "or"], ["and", "and"], ["vote", "vote (k of n)"]], n.gate));
      gate.addEventListener("change", function () {
        var edit = { doc: doc(), select: id };
        for (var i = 0; i < 3 && edit.doc.nodes[id].gate !== gate.value; i++) edit = E.cycleGate(edit.doc, id);
        apply(edit);
      });
      if (n.gate === "vote") numeric(field(form, "prop-k", "k of " + n.children.length, input("number", n.k)), "k");
    } else {
      var kind = field(form, "prop-leaf", "Event", choice([["basic", "basic"], ["undeveloped", "undeveloped"]], n.leaf));
      kind.addEventListener("change", function () {
        apply(E.setLeafKind(doc(), id, kind.value));
      });
      var quantity = quantityOf(n);
      var how = field(form, "prop-quantity", "Likelihood", choice([["", "not given"], ["p", "p — probability"], ["rate", "rate — per " + (doc().time_unit || "h")], ["ttc", "ttc — distribution"]], quantity));
      how.addEventListener("change", function () {
        var start = { "": "", p: 0.5, rate: 1e-6, ttc: "Exponential(1)" }[how.value];
        apply(E.setAttribute(doc(), id, how.value || "p", start));
      });
      if (quantity === "ttc") {
        var ttc = field(form, "prop-value", "ttc", input("text", n.ttc));
        ttc.classList.add("mono");
        ttc.addEventListener("change", function () {
          apply(E.setAttribute(doc(), id, "ttc", ttc.value.trim()));
        });
      } else if (quantity) numeric(field(form, "prop-value", quantity, input("number", n[quantity])), quantity);
      sketch(form, n);
      if (doc().profile === "attack-tree") {
        numeric(field(form, "prop-cost", "Cost", input("number", n.cost)), "cost");
        numeric(field(form, "prop-detection", "Detection", input("number", n.detection)), "detection");
      }
    }
    consequences(form, n);
    if (keepFocus && $(keepFocus)) $(keepFocus).focus();
  }

  // ---- left panel: the model as an outline, and the assets ----

  function renderOutline() {
    var list = $("outline");
    list.replaceChildren();
    var rows = E.outline(doc());
    $("outline-empty").hidden = rows.length > 0;
    rows.forEach(function (row) {
      var item = document.createElement("li");
      item.setAttribute("role", "treeitem");
      item.style.setProperty("--depth", row.depth);
      item.classList.toggle("is-selected", row.id === selected() && (row.parent === app.state.parent || row.parent === null));
      var kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = row.gate ? row.gate : "·";
      item.appendChild(kind);
      item.appendChild(document.createTextNode(row.label));
      if (row.repeated) {
        var again = document.createElement("span");
        again.className = "repeat";
        again.textContent = "↺ repeated";
        item.appendChild(again);
      }
      item.title = row.id;
      item.addEventListener("click", function () {
        app.select(row.id, row.parent);
      });
      item.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        openMenu(row.id, row.parent, e.clientX, e.clientY);
      });
      list.appendChild(item);
    });

    var assets = doc().assets || {};
    var body = $("assets-body");
    body.replaceChildren();
    Object.keys(assets).forEach(function (id) {
      // One block per asset, a line per dimension: a loss may be a number or
      // a whole distribution, and the panel is narrow.
      var head = document.createElement("tr");
      var name = document.createElement("th");
      name.colSpan = 2;
      name.scope = "rowgroup";
      name.textContent = assets[id].label || id;
      head.title = id;
      head.appendChild(name);
      body.appendChild(head);
      var loss = assets[id].loss || {};
      ["c", "i", "a"].forEach(function (dim) {
        if (loss[dim] == null) return;
        var tr = document.createElement("tr");
        var key = document.createElement("td");
        key.className = "dim";
        key.textContent = dim.toUpperCase();
        var value = document.createElement("td");
        value.className = "num";
        value.textContent = loss[dim];
        tr.appendChild(key);
        tr.appendChild(value);
        body.appendChild(tr);
      });
    });
    $("assets").hidden = !body.children.length;
    $("assets-empty").hidden = !!body.children.length;
  }

  // ---- every action as a button, with its key; and the list of all keys ----

  // The rail: each action as an icon, its key in the tooltip; the context menu
  // and the keys list (?) spell them out. Off where the action does not apply.
  var railButtons = document.querySelectorAll("[data-action]");
  railButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      button.blur(); // the keys stay with the canvas
      actions[button.getAttribute("data-action")]();
    });
  });

  function renderActions() {
    var n = node();
    var allowed = { undo: app.canUndo(), redo: app.canRedo() };
    MENU.forEach(function (item) {
      allowed[item[0]] = !!n && !!item[3](n);
    });
    var ways = removals();
    allowed.deleteNode = ways.length > 0;
    allowed.unlink = ways.length > 1;
    railButtons.forEach(function (button) {
      var action = button.getAttribute("data-action");
      button.disabled = !allowed[action];
      if (action === "deleteNode") button.title = ways.length ? ways[ways.length - 1][0] + (ways.length === 1 ? " (Del)" : "") : "Delete";
      if (action === "unlink") button.title = ways.length > 1 ? "Unlink from a parent… (Del)" : "Unlink — for a node with several parents";
    });
  }

  function openHelp() {
    var list = $("help-keys");
    list.replaceChildren();
    MENU.map(function (item) {
      return [item[2], item[1]];
    })
      .concat(OTHER_KEYS)
      .forEach(function (row) {
        var dt = document.createElement("dt");
        var k = document.createElement("kbd");
        k.textContent = row[0];
        dt.appendChild(k);
        var dd = document.createElement("dd");
        dd.textContent = row[1];
        list.appendChild(dt);
        list.appendChild(dd);
      });
    $("help-dialog").showModal();
  }
  $("help").addEventListener("click", openHelp);
  $("help-close").addEventListener("click", function () {
    $("help-dialog").close();
  });

  app.onChange(function () {
    if (!doc()) return;
    renderActions();
    renderProperties();
    renderOutline();
  });
})();
