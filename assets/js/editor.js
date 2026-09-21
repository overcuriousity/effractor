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
    ["Ctrl+S", "Save as a .yaml file"],
    ["Ctrl+O", "Open a .yaml file"],
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
    // In a field, undo is the field's own: a typo is not a document edit.
    var inText = /^(INPUT|TEXTAREA)$/.test(e.target.tagName);
    if (mod && !inText && e.key.toLowerCase() === "z") {
      e.preventDefault();
      return e.shiftKey ? app.redo() : app.undo();
    }
    if (mod && !inText && e.key.toLowerCase() === "y") {
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
      note.textContent = "within the horizon: " + window.effractorResults.number(answer.ok.p_horizon);
    }, function () {});
  }

  function consequences(form, n) {
    var assets = Object.keys(doc().assets || {});
    if (!assets.length && !(n.consequences || []).length) {
      // Said where it is looked for: a consequence needs something to cost.
      hint(form, "Consequences: none possible yet — add an asset under Assets, on the left, and this node can cost something.");
      return;
    }
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

  // What the canvas does not need: the note, and the id the YAML knows the
  // node by. Closed until asked for.
  var moreOpen = false;

  function more(form, n, id) {
    var details = document.createElement("details");
    details.className = "more";
    details.open = moreOpen;
    details.addEventListener("toggle", function () {
      moreOpen = details.open;
    });
    var summary = document.createElement("summary");
    summary.textContent = "More";
    details.appendChild(summary);
    var inner = document.createElement("div");
    inner.className = "properties-inner";
    details.appendChild(inner);
    var note = field(inner, "prop-description", "Note", input("textarea", n.description));
    note.addEventListener("change", function () {
      apply(E.setAttribute(doc(), id, "description", note.value.trim()));
    });
    var idField = field(inner, "prop-id", "Id", input("text", id));
    idField.classList.add("mono");
    idField.title = "The name this node has in the YAML; made from its first label";
    idField.addEventListener("change", function () {
      apply(E.setId(doc(), id, idField.value)).then(function (applied) {
        if (!applied) idField.value = id;
      });
    });
    form.appendChild(details);
  }

  function hint(form, text) {
    var p = document.createElement("p");
    p.className = "hint field-hint";
    p.textContent = text;
    form.appendChild(p);
    return p;
  }

  var UNIT = { h: "hour", d: "day", y: "year" };
  // securiCAD's words for a time to compromise, and the shapes behind them.
  var TTC_EXAMPLES = [
    "EasyAndCertain", "EasyAndUncertain", "HardAndCertain", "HardAndUncertain", "VeryHardAndCertain", "VeryHardAndUncertain",
    "Exponential(0.1)", "LogNormal(1.5, 0.8)", "Gamma(2, 10)", "Bernoulli(0.2) * LogNormal(1.5, 0.8)", "Infinity",
  ];

  // A kind of likelihood picked but not yet given a number: the field is there
  // and empty, and the document is untouched until something is typed. No
  // number is ever made up.
  var pending = { id: null, kind: "" };

  // The fields under Likelihood, each said in the words of the question it
  // answers, with the document's own unit and horizon.
  function likelihood(form, n, id) {
    var unit = doc().time_unit || "h";
    var horizon = doc().horizon + " " + unit;
    var given = quantityOf(n);
    var quantity = pending.id === id && pending.kind ? pending.kind : given;
    var how = field(form, "prop-quantity", "Likelihood", choice([["", "not given"], ["p", "probability"], ["rate", "how often (rate)"], ["ttc", "time to compromise"]], quantity));
    how.addEventListener("change", function () {
      pending = { id: id, kind: how.value };
      if (!how.value) return void apply(E.setAttribute(doc(), id, "p", ""));
      renderProperties();
      var value = $("prop-every") || $("prop-value");
      if (value) value.focus();
    });
    function commit(key, value) {
      pending = { id: null, kind: "" };
      apply(E.setAttribute(doc(), id, key, value));
    }

    if (!quantity) {
      hint(form, "No number yet: the tree still gives its cut sets, but no probabilities.");
    } else if (quantity === "p") {
      var p = field(form, "prop-value", "p", input("number", given === "p" ? n.p : ""));
      p.min = 0; p.max = 1; p.placeholder = "0 … 1";
      p.addEventListener("change", function () {
        if (p.value.trim() !== "") commit("p", Number(p.value));
      });
      hint(form, "The chance that this happens at all within the horizon (" + horizon + "): 0 never, 1 certainly. It does not depend on time.");
    } else if (quantity === "rate") {
      var mean = given === "rate" ? E.meanTime(n.rate, unit) : null;
      var row = document.createElement("div");
      row.className = "every";
      var every = input("number", mean ? mean.every : "");
      every.id = "prop-every";
      every.min = 0; every.placeholder = "e.g. 10";
      var per = choice([["h", "hours"], ["d", "days"], ["y", "years"]], mean ? mean.unit : "y");
      per.setAttribute("aria-label", "Unit");
      row.appendChild(every);
      row.appendChild(per);
      var l = document.createElement("label");
      l.htmlFor = "prop-every";
      l.textContent = "once every";
      form.appendChild(l);
      form.appendChild(row);
      var fromEvery = function () {
        var rate = E.rateFrom(Number(every.value), per.value, unit);
        if (rate) commit("rate", Number(rate.toPrecision(6)));
      };
      every.addEventListener("change", fromEvery);
      per.addEventListener("change", fromEvery);
      var rate = field(form, "prop-value", "rate / " + unit, input("number", given === "rate" ? n.rate : ""));
      rate.addEventListener("change", function () {
        if (rate.value.trim() !== "") commit("rate", Number(rate.value));
      });
      hint(form, "For things that happen by themselves, like a failure: how long, on average, between two of them. The rate is the same thing the other way round — occurrences per " + UNIT[unit] + " — and is what the file stores.");
    } else {
      var ttc = field(form, "prop-value", "ttc", input("text", given === "ttc" ? n.ttc : ""));
      ttc.classList.add("mono");
      ttc.placeholder = "HardAndUncertain";
      ttc.setAttribute("list", "ttc-examples");
      var list = document.createElement("datalist");
      list.id = "ttc-examples";
      TTC_EXAMPLES.forEach(function (example) {
        var option = document.createElement("option");
        option.value = example;
        list.appendChild(option);
      });
      form.appendChild(list);
      ttc.addEventListener("change", function () {
        if (ttc.value.trim() !== "") commit("ttc", ttc.value.trim());
      });
      hint(form, "For an attacker's step: how long until it succeeds, in " + UNIT[unit] + "s, as a distribution. securiCAD's words work (EasyAndCertain … VeryHardAndUncertain); so do Exponential(λ) with mean 1/λ, LogNormal, Gamma, and Bernoulli(p) * … for a step that is possible at all only with chance p.");
    }
    if (given && given === quantity) sketch(form, n);
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
      likelihood(form, n, id);
      if (doc().profile === "attack-tree") {
        var cost = field(form, "prop-cost", "Cost", input("number", n.cost));
        cost.title = "What this step costs the attacker, in " + (doc().currency || "money");
        numeric(cost, "cost");
        var detection = field(form, "prop-detection", "Detection", input("number", n.detection));
        detection.title = "The chance that this step is noticed: 0 never, 1 always";
        detection.placeholder = "0 … 1";
        numeric(detection, "detection");
      }
    }
    consequences(form, n);
    more(form, n, id);
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
      // The same signs as on the canvas: what is inscribed in a gate, the
      // shape of a leaf.
      var n = doc().nodes[row.id];
      var kind = document.createElement("span");
      kind.className = "kind";
      kind.textContent = row.gate ? window.effractorGraph.inscription(n, doc().profile === "attack-tree") : n.leaf === "undeveloped" ? "◇" : "○";
      item.appendChild(kind);
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = row.label;
      item.appendChild(name);
      if (row.repeated) {
        var again = document.createElement("span");
        again.className = "repeat";
        again.textContent = "↺";
        again.title = "Repeated: the same node as above";
        item.appendChild(again);
      }
      item.title = row.label + (row.repeated ? " — repeated" : "");
      item.addEventListener("click", function () {
        app.select(row.id, row.parent);
      });
      item.addEventListener("contextmenu", function (e) {
        e.preventDefault();
        openMenu(row.id, row.parent, e.clientX, e.clientY);
      });
      list.appendChild(item);
    });

    renderAssets();
  }
  $("help").addEventListener("click", openHelp);
  $("help-close").addEventListener("click", function () {
    $("help-dialog").close();
  });

  // ---- assets: listed closed, one opened at a time to be edited ----

  var openAsset = null;

  // An asset edit leaves the selection where it was.
  function applyAsset(edit, then) {
    if (edit) {
      edit.select = selected();
      edit.parent = app.state.parent;
    }
    return apply(edit, then);
  }

  function renderAssets() {
    var assets = doc().assets || {};
    var ids = Object.keys(assets);
    var list = $("assets");
    var keepFocus = document.activeElement && list.contains(document.activeElement) ? document.activeElement.id : null;
    list.replaceChildren();
    $("assets-empty").hidden = ids.length > 0 || !$("asset-new").hidden;
    ids.forEach(function (id) {
      var asset = assets[id];
      var loss = asset.loss || {};
      var block = document.createElement("div");
      block.className = "asset";
      var head = document.createElement("button");
      head.type = "button";
      head.className = "asset-head";
      head.setAttribute("aria-expanded", String(openAsset === id));
      head.title = id;
      head.textContent = asset.label || id;
      head.addEventListener("click", function () {
        openAsset = openAsset === id ? null : id;
        renderAssets();
      });
      block.appendChild(head);

      if (openAsset !== id) {
        var summary = document.createElement("dl");
        summary.className = "asset-loss";
        ["c", "i", "a"].forEach(function (dim) {
          if (loss[dim] == null) return;
          var dt = document.createElement("dt");
          dt.textContent = dim.toUpperCase();
          var dd = document.createElement("dd");
          dd.textContent = loss[dim];
          summary.appendChild(dt);
          summary.appendChild(dd);
        });
        if (summary.children.length) block.appendChild(summary);
      } else {
        var form = document.createElement("div");
        form.className = "properties-inner asset-form";
        var label = field(form, "asset-label", "Label", input("text", asset.label));
        label.addEventListener("change", function () {
          applyAsset(E.setAssetLabel(doc(), id, label.value));
        });
        [["c", "Confidentiality"], ["i", "Integrity"], ["a", "Availability"]].forEach(function (dim) {
          var f = field(form, "asset-" + dim[0], dim[1], input("text", loss[dim[0]]));
          f.classList.add("mono");
          f.placeholder = "—";
          f.addEventListener("change", function () {
            applyAsset(E.setAssetLoss(doc(), id, dim[0], f.value)).then(function (applied) {
              if (!applied) f.value = loss[dim[0]] == null ? "" : loss[dim[0]];
            });
          });
        });
        hint(form, "What it costs, in " + (doc().currency || "money") + ", when that property of the asset is lost. A number, or a distribution such as Pert(least, likely, most). Leave empty what does not apply.");
        var uses = E.usesOfAsset(doc(), id);
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn btn-ghost btn-small asset-remove";
        remove.textContent = uses ? "Remove, with its " + uses + " consequence" + (uses > 1 ? "s" : "") : "Remove";
        remove.addEventListener("click", function () {
          var name = asset.label || id;
          openAsset = null;
          applyAsset(E.removeAsset(doc(), id), function () {
            app.say("removed the asset “" + name + "” · Ctrl+Z undoes");
          });
        });
        form.appendChild(remove);
        block.appendChild(form);
      }
      list.appendChild(block);
    });
    if (keepFocus && $(keepFocus)) $(keepFocus).focus();
  }

  $("asset-add").addEventListener("click", function () {
    var name = $("asset-new");
    name.hidden = false;
    name.value = "";
    $("assets-empty").hidden = true;
    name.focus();
  });
  $("asset-new").addEventListener("keydown", function (e) {
    var name = $("asset-new");
    if (e.key === "Escape") {
      name.hidden = true;
      return renderAssets();
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    var edit = E.addAsset(doc(), name.value);
    if (!edit) return;
    name.hidden = true;
    openAsset = edit.asset;
    applyAsset(edit, function () {
      var first = $("asset-c");
      if (first) first.focus();
    });
  });
  $("asset-new").addEventListener("blur", function () {
    $("asset-new").hidden = true;
    if (doc()) renderAssets();
  });

  app.onChange(function () {
    if (!doc()) return;
    renderActions();
    renderProperties();
    renderOutline();
  });
})();
