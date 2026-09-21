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

  function apply(edit, then) {
    return app.applyEdit(edit).then(function (applied) {
      if (applied && then) then();
      return applied;
    });
  }

  function focusLabel() {
    var field = $("prop-label");
    if (!field) return;
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
    link: openLinkDialog,
    remove: function () {
      var id = selected();
      var parent = app.state.parent;
      if (!id) return;
      if (!parent) return app.say("the top event cannot be removed");
      if (E.losesAttributes(doc(), parent, id) && !window.confirm("Delete “" + doc().nodes[id].label + "” and what was entered for it?")) return;
      var edit = E.removeEdge(doc(), parent, id);
      if (edit) edit.parent = E.parentsOf(edit.doc, edit.select)[0] || null;
      apply(edit);
    },
  };

  var MENU = [
    ["addChild", "Add child", "Tab", function () { return true; }],
    ["addSibling", "Add sibling", "Enter", function () { return !!app.state.parent; }],
    ["rename", "Rename", "F2", function () { return true; }],
    ["properties", "Edit properties", "P", function () { return true; }],
    ["cycleGate", "Gate: or → and → vote", "G", function (n) { return !!n.gate; }],
    ["basic", "Basic event", "B", function (n) { return n.leaf === "undeveloped"; }],
    ["undeveloped", "Undeveloped event", "U", function (n) { return n.leaf === "basic"; }],
    ["link", "Link existing…", "L", function () { return true; }],
    ["remove", "Remove this edge", "Del", function () { return !!app.state.parent; }],
  ];

  // ---- keyboard ----

  function typingElsewhere(e) {
    return /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || $("link-dialog").open;
  }

  var KEYS = { p: "properties", Tab: "addChild", Enter: "addSibling", F2: "rename", g: "cycleGate", b: "basic", u: "undeveloped", l: "link", Delete: "remove", Backspace: "remove" };

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
    if (typingElsewhere(e) || mod || e.altKey || !selected()) return;

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
    if (e.key.length === 1 && e.key !== " " && e.key.toLowerCase() !== "f") {
      var field = $("prop-label");
      if (!field) return;
      e.preventDefault();
      field.focus();
      field.value = e.key;
    }
  });

  // ---- pointer: drop reparents, Ctrl-drop links; the rail mirrors two keys ----

  app.renderer.on("drop", function (e) {
    if (e.ctrl) return apply(E.link(doc(), e.target, e.id));
    var edit = E.reparent(doc(), e.id, E.parentsOf(doc(), e.id)[0] || null, e.target);
    if (edit) edit.parent = e.target;
    apply(edit);
  });

  document.querySelectorAll('[data-tool="add"], [data-tool="link"]').forEach(function (button) {
    button.addEventListener("click", function () {
      actions[button.getAttribute("data-tool") === "add" ? "addChild" : "link"]();
    });
  });

  // ---- context menu ----

  function closeMenu() {
    $("context-menu").hidden = true;
  }

  app.renderer.on("context", function (e) {
    closeMenu();
    if (!e.id) return;
    app.select(e.id);
    var menu = $("context-menu");
    menu.replaceChildren();
    MENU.forEach(function (item) {
      if (!item[3](node())) return;
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.appendChild(document.createTextNode(item[1]));
      var key = document.createElement("kbd");
      key.textContent = item[2];
      button.appendChild(key);
      button.addEventListener("click", function () {
        closeMenu();
        actions[item[0]]();
      });
      menu.appendChild(button);
    });
    menu.style.setProperty("--menu-x", Math.min(e.x, window.innerWidth - 210) + "px");
    menu.style.setProperty("--menu-y", Math.min(e.y, window.innerHeight - 30 * menu.children.length - 12) + "px");
    menu.hidden = false;
  });
  document.addEventListener("pointerdown", function (e) {
    if (!$("context-menu").contains(e.target)) closeMenu();
  });

  // ---- link existing: a search over the nodes ----

  var linkChoice = 0;

  function linkCandidates(query) {
    var q = query.trim().toLowerCase();
    var children = (node() && node().children) || [];
    return Object.keys(doc().nodes).filter(function (id) {
      if (id === selected() || children.indexOf(id) >= 0) return false;
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
    var parent = selected();
    var edit = E.link(doc(), parent, id);
    if (!edit) return;
    edit.parent = parent;
    apply(edit);
  }

  function openLinkDialog() {
    if (!selected()) return;
    $("link-search").value = "";
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
      list.appendChild(item);
    });

    var assets = doc().assets || {};
    var body = $("assets-body");
    body.replaceChildren();
    Object.keys(assets).forEach(function (id) {
      var tr = document.createElement("tr");
      var loss = assets[id].loss || {};
      [assets[id].label || id, loss.c, loss.i, loss.a].forEach(function (value, i) {
        var td = document.createElement("td");
        td.textContent = value == null ? "—" : value;
        if (i) td.className = "num";
        tr.appendChild(td);
      });
      tr.title = id;
      body.appendChild(tr);
    });
    $("assets").hidden = !body.children.length;
    $("assets-empty").hidden = !!body.children.length;
  }

  app.onChange(function () {
    if (!doc()) return;
    renderProperties();
    renderOutline();
  });
})();
