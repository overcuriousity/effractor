// The architecture editor (spec 10): the component outline, the type picker,
// the selected component's form in the inspector, its keys and menus. It
// decides *which* edit; architecture-edit.js makes it; app.js sends it through
// wasm, which alone says whether it is valid. Nothing here acts on a tree.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var A = window.effractorArchitectureEdit;
  var L = window.effractorArchitectureLinks;
  var P = window.effractorProfiles;
  var W = window.effractorWords;
  var $ = function (id) {
    return document.getElementById(id);
  };

  function doc() {
    return app.state.doc;
  }
  function arch() {
    return P.isArchitecture(doc());
  }
  function entityId() {
    var q = P.qualified(app.state.selected);
    return q && q.kind === "entity" ? q.id : null;
  }
  // The selection as {kind, id} — entity, association or flow — or null.
  function selection() {
    return P.qualified(app.state.selected);
  }
  var COLLECTION = { entity: "entities", association: "associations", flow: "flows" };
  function entity() {
    var id = entityId();
    return id ? doc().entities[id] : null;
  }
  function word(kind) {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
  }
  // A kind's icon, as the canvas draws it, for a menu or the legend.
  function icon(kind) {
    return window.effractorArchitectureIcons.svg(document, kind, 16);
  }

  // The component library's catalog, from the wasm module, asked for once.
  var catalog = null;
  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    return app.solver.catalog().then(function (answer) {
      if (!answer.ok) throw new Error("no component catalog");
      catalog = answer.ok;
      return catalog;
    });
  }
  function kindSpec(kind) {
    return (catalog.entities || []).filter(function (e) {
      return e.kind === kind;
    })[0];
  }
  function slotHint(slot) {
    var p = catalog ? catalog.parameters.filter(function (x) { return x.slot === slot; })[0] : null;
    return p ? p.description : "";
  }

  // Edits run one after another, each built from the document the one before
  // it left: a note changed on blur and the Apply clicked next both land.
  // `build` returns the edit, or null — refused, which is said, unless
  // `quiet` (nothing to change). One that is applied says what it did when
  // there is something to say.
  var queue = Promise.resolve();
  function apply(build, then, quiet) {
    function run() {
      var edit = build();
      if (!edit) {
        if (!quiet) app.say("that edit is not possible here");
        return false;
      }
      return app.applyEdit(edit).then(function (applied) {
        if (applied && edit.notice) app.say(edit.notice);
        if (applied && then) then();
        return applied;
      }, function (e) {
        console.error(e);
        app.say("the edit failed: " + e.message);
        return false;
      });
    }
    queue = queue.then(run, run);
    return queue;
  }

  function focusLabel() {
    var field = $("prop-label") || $("prop-cluster-label");
    if (!field) return;
    field.focus();
    field.select();
  }

  // ---- the actions ----

  // A new component is named after its kind until it is renamed: "Host",
  // "Host 2" — a label, so the id made from it never has to change.
  function freeLabel(kind) {
    var taken = Object.create(null);
    Object.keys(doc().entities).forEach(function (id) {
      taken[doc().entities[id].label] = true;
    });
    var label = word(kind);
    for (var n = 2; taken[label]; n++) label = word(kind) + " " + n;
    return label;
  }

  function create(kind) {
    loadCatalog().then(function () {
      apply(function () {
        return A.addEntity(doc(), kind, freeLabel(kind), kindSpec(kind));
      }, focusLabel);
    }, function (e) {
      console.error(e);
      app.say("the component library could not be read");
    });
  }

  // Tab: what can be added linked to the selected component — a kind, and
  // where there is more than one way to link it, the way. The new component
  // is linked, selected and named in one step, as Tab adds a child in a tree.
  function optionWord(o) {
    return L.phrase(o.relation, o.direction, o.privilege, o.fields);
  }
  // The file's name for the relation and its fields, for the tooltip.
  function optionTitle(o) {
    var fields = o.fields || {};
    var said = Object.keys(fields).map(function (k) { return fields[k]; }).join(" · ");
    return o.relation + (said ? " · " + said : "");
  }
  function addLinked(id, kind, option) {
    apply(function () {
      return L.addLinked(doc(), A, id, kind, freeLabel(kind), kindSpec(kind), option);
    }, focusLabel);
  }
  // What can be added linked to `id`, by kind and then by way; when nothing
  // can, one greyed note that says why.
  function addLinkedItems(id) {
    return loadCatalog().then(function (c) {
      var items = L.addChoices(doc(), c, id).map(function (choice) {
        if (choice.options.length === 1) {
          var only = choice.options[0];
          return [word(choice.kind), "", function () { addLinked(id, choice.kind, only); }, { hint: optionWord(only), title: optionTitle(only), icon: icon(choice.kind) }];
        }
        return [word(choice.kind), "", choice.options.map(function (o) {
          return [optionWord(o), "", function () { addLinked(id, choice.kind, o); }, { title: optionTitle(o) }];
        }), { icon: icon(choice.kind) }];
      });
      linkedExtras.forEach(function (more) {
        items = items.concat(more(id));
      });
      if (!items.length) return [[L.emptyLink(doc(), c, id) || "nothing can be linked to “" + doc().entities[id].label + "”", "", null]];
      L.notes(doc(), id).forEach(function (n) {
        items.push([word(n.kind), "", null, { hint: n.hint, icon: icon(n.kind) }]);
      });
      return items;
    }, function () {
      return [["the component library could not be read", "", null]];
    });
  }
  function addLinkedMenu(id, x, y) {
    addLinkedItems(id).then(function (items) {
      if (!items.some(function (item) { return item[2] != null; })) return app.say(items[0][0]);
      app.showMenu(items, x, y);
    });
  }
  // Beside the selected component on the canvas, or beside a control.
  function addLinkedAt(id, anchor) {
    var at = anchor || document.querySelector("#canvas .node.hl-selected") || $("canvas");
    var box = at.getBoundingClientRect();
    if (anchor) addLinkedMenu(id, box.right + 4, box.top);
    else addLinkedMenu(id, box.left + box.width / 2, box.top + box.height / 2);
  }

  // Filled in by nmap-ui.js: more ways to add a kind, and more to add
  // linked to a component. A kind with extras becomes a submenu.
  var kindExtras = {};
  var linkedExtras = [];

  // The kinds, grouped by the families the canvas colours.
  function kindMenu() {
    return A.GROUPS.map(function (g) {
      return [g[0], "", g[1].map(function (kind) {
        var plain = [word(kind), "", function () { create(kind); }, { icon: icon(kind), title: W.meaning(catalog, kind) }];
        if (!kindExtras[kind]) return plain;
        return [word(kind), "", [plain].concat(kindExtras[kind]()), { icon: icon(kind) }];
      })];
    });
  }

  // The type picker: the kinds by family.
  function pickKind(x, y) {
    loadCatalog().catch(function () {}).then(function () {
      app.showMenu(kindMenu(), x, y);
    });
  }
  // The background's menu: add a component, put every one back where the
  // automatic layout wants it, show or hide the firewalls' permissions.
  function backgroundMenu(x, y) {
    var shown = app.permits();
    var items = [
      ["Add", "A", kindMenu()],
      ["Arrange automatically", "", app.arrange],
      [shown ? "Hide firewall permissions" : "Show firewall permissions", "", function () { app.setPermits(!shown); }],
    ];
    backgroundItems.forEach(function (more) {
      items = items.concat(more());
    });
    app.showMenu(items, x, y);
  }
  // Filled in by cluster-ui.js: more items for the background menu.
  var backgroundItems = [];
  function pickKindAt(anchor) {
    var box = (anchor || $("canvas")).getBoundingClientRect();
    if (anchor) pickKind(box.right + 4, box.top);
    else pickKind(box.left + box.width / 2, box.top + box.height / 3);
  }

  function picked() {
    return app.state.picked || [];
  }

  // With everything that named it; the notice counts what went along.
  // Several selected, or a cluster: every component in them, in one edit.
  function remove() {
    var q = selection();
    if (picked().length > 1 || (q && q.kind === "cluster")) {
      var members = window.effractorClusters.entitiesOf(doc(), picked().length > 1 ? picked() : [app.state.selected]);
      return apply(function () {
        return L.removeAll(doc(), members);
      }, null, true);
    }
    if (!q || !COLLECTION[q.kind]) return;
    apply(function () {
      return L.remove(doc(), COLLECTION[q.kind], q.id);
    }, null, true);
  }

  // ↑ ↓ walk the components in document order.
  function walk(step) {
    var ids = Object.keys(doc().entities);
    if (!ids.length) return;
    var at = ids.indexOf(entityId());
    var next = at < 0 ? (step > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, at + step));
    app.select("entity/" + ids[next]);
  }

  // `keep`: the menu of a component listed elsewhere (a cluster's members):
  // what is selected stays until an action that needs the component runs.
  function menuFor(id, x, y, keep) {
    if (!keep) app.select("entity/" + id);
    var items = [["Add linked", "Tab", { items: function () { return addLinkedItems(id); } }], ["Rename", "F2", focusLabel]];
    if (window.effractorArchitectureView.shownSlots(doc(), id).length) items.push(["Edit parameters", "P", firstParameter]);
    extraItems.forEach(function (more) {
      items = items.concat(more(id));
    });
    items.push(["Show in source", "", function () { app.showSourcePath("entities." + id); }]);
    items.push(["Delete", "Del", remove]);
    if (keep) {
      items = items.map(function (item) {
        if (typeof item[2] !== "function") return item;
        var run = item[2];
        return [item[0], item[1], function () {
          app.select("entity/" + id);
          run();
        }].concat(item.slice(3));
      });
    }
    app.showMenu(items, x, y);
  }

  // A relationship's or a flow's menu, from its line on the canvas.
  function edgeMenu(qualified, x, y) {
    var q = P.qualified(qualified);
    app.select(qualified);
    app.showMenu([
      ["Show in source", "", function () { app.showSourcePath(COLLECTION[q.kind] + "." + q.id); }],
      [q.kind === "association" ? "Unlink" : "Delete", "Del", remove],
    ], x, y);
  }
  var extraItems = [];

  // ---- keys ----

  function typingElsewhere(e) {
    return !!e.target.closest(".analysis-chart, .chart-table, summary, .menu") || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || document.querySelector("dialog[open]");
  }

  var KEYS = [
    ["A", "Add a component"],
    ["Tab", "Add a component linked to the selected one"],
    ["F2", "Rename"],
    ["P", "Edit parameters"],
    ["Del", "Delete, with its links"],
    ["↑ ↓", "Previous, next component"],
    ["click", "Select a component"],
    ["double-click", "Rename it"],
    ["drag a component", "Move it (kept in this browser)"],
    ["Ctrl-click", "Add to the selection, or take out"],
    ["Shift + drag", "Select in a rectangle"],
    ["right-click", "Its actions; on the background, add or arrange"],
  ];

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || !arch() || typingElsewhere(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "a") {
      e.preventDefault();
      return pickKindAt(null);
    }
    if (key === "Tab" && !e.shiftKey && entityId()) {
      e.preventDefault();
      return addLinkedAt(entityId(), null);
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      return walk(key === "ArrowDown" ? 1 : -1);
    }
    if ((key === "Delete" || key === "Backspace") && (selection() || picked().length > 1)) {
      e.preventDefault();
      return remove();
    }
    if (!entityId()) return;
    if (key === "F2") {
      e.preventDefault();
      return focusLabel();
    }
    if (key === "p") {
      e.preventDefault();
      return firstParameter();
    }
    if (key === "Delete" || key === "Backspace") {
      e.preventDefault();
      return remove();
    }
  });

  // ---- pointer ----

  // In the attack view the canvas holds generated steps: attack-ui.js's.
  // Filled in by cluster-ui.js: each gets the event first, true if it answered.
  var contextHooks = [];
  app.renderer.on("context", function (e) {
    if (!arch() || app.state.mode === "attack") return;
    for (var i = 0; i < contextHooks.length; i++) if (contextHooks[i](e)) return;
    if (e.edge && P.selectionExists(doc(), e.edge, null)) return edgeMenu(e.edge, e.x, e.y);
    var q = P.qualified(e.id);
    if (q && q.kind === "entity") return menuFor(q.id, e.x, e.y);
    backgroundMenu(e.x, e.y);
  });
  app.renderer.on("activate", function (e) {
    if (!arch() || app.state.mode === "attack") return;
    if (e.id !== app.state.selected) app.select(e.id);
    focusLabel();
  });

  // ---- the rail: + adds a component, the bin deletes one ----

  var rail = {
    addChild: document.querySelector('[data-action="addChild"]'),
    deleteNode: document.querySelector('[data-action="deleteNode"]'),
  };
  // Only the + changes its title here; the bin's is set by editor.js per selection.
  var treeTitles = { addChild: rail.addChild.title };
  // With a component selected the + adds one linked to it, as Tab does.
  rail.addChild.addEventListener("click", function () {
    if (!arch()) return;
    if (entityId()) addLinkedAt(entityId(), rail.addChild);
    else pickKindAt(rail.addChild);
  });
  rail.deleteNode.addEventListener("click", function () {
    if (arch()) remove();
  });
  $("component-add").addEventListener("click", function () {
    $("component-add").blur();
    pickKindAt($("component-add"));
  });

  function renderRail() {
    rail.addChild.disabled = false;
    rail.addChild.title = entityId() ? "Add linked to “" + entity().label + "” (Tab)" : "Add a component (A)";
    rail.addChild.setAttribute("aria-label", entityId() ? "Add linked component" : "Add a component");
    rail.deleteNode.disabled = !selection() && picked().length < 2;
    rail.deleteNode.title = picked().length > 1 ? "Delete " + picked().length + " selected (Del)" : selection() ? "Delete “" + app.labelOf(app.state.selected) + "” (Del)" : "Delete";
    document.querySelectorAll('[data-action="undo"], [data-action="redo"]').forEach(function (b) {
      b.disabled = b.getAttribute("data-action") === "undo" ? !app.canUndo() : !app.canRedo();
    });
  }

  // ---- the outline: every component, in document order ----

  var outlineEmpty = $("outline-empty").textContent;

  function renderOutline() {
    var list = $("outline");
    list.replaceChildren();
    var ids = Object.keys(doc().entities);
    $("outline-empty").hidden = ids.length > 0;
    $("outline-empty").textContent = "No components.";
    ids.forEach(function (id) {
      var e = doc().entities[id];
      var item = document.createElement("li");
      item.setAttribute("role", "treeitem");
      item.classList.toggle("is-selected", app.state.selected === "entity/" + id);
      var kind = document.createElement("span");
      kind.className = "kind-word";
      kind.textContent = e.kind;
      var name = document.createElement("span");
      name.className = "name";
      name.textContent = e.label;
      item.appendChild(kind);
      item.appendChild(name);
      item.title = e.label + " · " + id;
      item.addEventListener("click", function () {
        app.select("entity/" + id);
      });
      item.addEventListener("contextmenu", function (ev) {
        ev.preventDefault();
        menuFor(id, ev.clientX, ev.clientY);
      });
      list.appendChild(item);
    });
  }

  // ---- the inspector: label, kind, note, switch, parameters ----

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
    i.value = value == null ? "" : value;
    return i;
  }

  var SWITCH = [["unknown", "Unknown"], ["true", "On"], ["false", "Off"]];
  var STATUS = [["unknown", "Unknown"], ["illustrative", "Illustrative"], ["assumed", "Assumed"], ["calibrated", "Calibrated"]];

  // One parameter open at a time; what is typed into it is a draft, kept
  // here until status, TTC and note are applied together. The document never
  // holds half a parameter.
  var openSlot = null; // ownerKey + "\u0000" + slot
  // Made by the first change in the form, with the parameter it started from:
  // if that parameter changes underneath (undo, the source, another file),
  // the draft is dropped rather than written over it.
  var drafts = Object.create(null);
  var documents = -1;

  // An owner is {entity: id} or {flow: id}.
  function ownerKey(owner) {
    return owner.flow != null ? "flow/" + owner.flow : "entity/" + owner.entity;
  }
  function slotKey(owner, slot) {
    return ownerKey(owner) + "\u0000" + slot;
  }
  function ownerRecord(key) {
    var q = P.qualified(key);
    var map = q && q.kind === "flow" ? doc().flows : q && q.kind === "entity" ? doc().entities : null;
    return map && Object.prototype.hasOwnProperty.call(map, q.id) ? map[q.id] : null;
  }

  function given(p) {
    if (!p || p.status === "unknown") return "? Unknown";
    return p.ttc + " · " + p.status;
  }

  function firstParameter() {
    var e = entity();
    var slots = e ? window.effractorArchitectureView.shownSlots(doc(), entityId()) : [];
    var why = !e || !e.parameters ? "" : e.parameters.escape ? " that runs on no host" : e.parameters["take-over"] ? " no content reaches" : "";
    if (!slots.length) return app.say("no parameters for a " + (e ? e.kind : "selection") + why);
    var unknown = slots.filter(function (s) { return e.parameters[s].status === "unknown"; })[0];
    openSlot = slotKey({ entity: entityId() }, unknown || slots[0]);
    renderProperties();
    var first = $("param-status") || $("param-ttc");
    if (first) first.focus();
  }

  function parameterForm(owner, slot, current) {
    var key = slotKey(owner, slot);
    var draft = drafts[key] || { status: current.status, ttc: current.ttc || "", note: current.note || "", base: JSON.stringify(current) };
    function keep() {
      drafts[key] = draft;
    }
    var form = document.createElement("div");
    form.className = "parameter-form";
    var status = field(form, "param-status", "Confidence", window.effractorMenu.dropdown(STATUS, draft.status));
    status.addEventListener("change", function () {
      draft.status = status.value;
      keep();
      renderProperties();
      var next = $(draft.status === "unknown" ? "param-status" : "param-ttc");
      if (next) next.focus();
    });
    if (draft.status !== "unknown") {
      var ttc = input("text", draft.ttc);
      ttc.classList.add("mono");
      ttc.id = "param-ttc";
      var timing = window.effractorTtc.attach(ttc, doc().time_unit);
      var l = document.createElement("label");
      l.htmlFor = "param-ttc";
      l.textContent = "Time";
      l.title = "Time to compromise: how long this takes the attacker";
      form.appendChild(l);
      form.appendChild(timing);
      ttc.addEventListener("input", function () { draft.ttc = ttc.value; keep(); });
      ttc.addEventListener("change", function () { draft.ttc = ttc.value; keep(); });
      var note = field(form, "param-note", "Reason", input("textarea", draft.note));
      note.placeholder = "why this value · required if calibrated";
      note.addEventListener("input", function () { draft.note = note.value; keep(); });
    }
    var actions = document.createElement("div");
    actions.className = "actions";
    var applyButton = document.createElement("button");
    applyButton.type = "button";
    applyButton.className = "btn btn-small";
    applyButton.textContent = "Apply";
    applyButton.addEventListener("click", function () {
      apply(function () {
        return A.setParameter(doc(), owner, slot, draft);
      }, function () {
        delete drafts[key];
        openSlot = null;
        renderProperties();
      });
    });
    var cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn btn-ghost btn-small";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", function () {
      delete drafts[key];
      openSlot = null;
      renderProperties();
    });
    actions.appendChild(applyButton);
    actions.appendChild(cancel);
    form.appendChild(actions);
    form.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.tagName === "INPUT") {
        e.preventDefault();
        applyButton.click();
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        cancel.click();
      }
    });
    return form;
  }

  // An entity's slots as the view shows them (an escape only where hosted);
  // a flow's all.
  function parameters(form, owner, e) {
    var slots = owner.entity ? window.effractorArchitectureView.shownSlots(doc(), owner.entity) : Object.keys(e.parameters || {});
    if (!slots.length) return;
    var list = document.createElement("ul");
    list.className = "parameters";
    slots.forEach(function (slot) {
      var p = e.parameters[slot];
      var key = slotKey(owner, slot);
      var item = document.createElement("li");
      var head = document.createElement("button");
      head.type = "button";
      head.className = "parameter-head";
      head.setAttribute("aria-expanded", String(openSlot === key));
      // A reason is only required of a calibrated value; its absence shows.
      var reason = p.note ? p.note : p.status === "unknown" ? "" : "no reason given";
      head.title = slotHint(slot) + (reason ? "\n" + reason : "") + "\n" + slot;
      var name = document.createElement("span");
      name.className = "slot";
      name.textContent = W.slot(catalog, slot);
      var value = document.createElement("span");
      value.className = "given" + (p.status === "unknown" ? " is-unknown" : "");
      value.textContent = drafts[key] ? "draft" : given(p);
      head.appendChild(name);
      head.appendChild(value);
      head.addEventListener("click", function () {
        openSlot = openSlot === key ? null : key;
        renderProperties();
      });
      item.appendChild(head);
      if (openSlot === key) item.appendChild(parameterForm(owner, slot, p));
      list.appendChild(item);
    });
    form.appendChild(list);
  }

  // The diagnostics at `prefix` (a document path) or under it.
  function problems(form, prefix) {
    var here = (app.state.diagnostics || []).filter(function (d) {
      return d.path === prefix || d.path.indexOf(prefix + ".") === 0 || d.path.indexOf(prefix + "[") === 0;
    });
    if (!here.length) return;
    var list = document.createElement("ul");
    list.className = "diagnostics";
    window.effractorProblems.items(doc(), here).forEach(function (p) {
      var item = document.createElement("li");
      item.textContent = p.text;
      if (p.blocks) {
        item.className = "is-blocking";
        item.title = "blocks the attack graph";
      }
      if (p.hint) {
        var hint = document.createElement("span");
        hint.className = "diagnostic-hint";
        hint.textContent = p.hint;
        item.appendChild(hint);
      }
      list.appendChild(item);
    });
    form.appendChild(list);
  }

  function renderProperties() {
    var form = $("properties");
    var keepFocus = document.activeElement && form.contains(document.activeElement) ? document.activeElement.id : null;
    form.replaceChildren();
    if (picked().length > 1 && sections.picked) {
      form.hidden = false;
      sections.picked(form);
      return;
    }
    var q = selection();
    var e = entity();
    if (q && !e && sections[q.kind]) {
      // A relationship or a flow: its form is architecture-links-ui.js's.
      form.hidden = false;
      if (openSlot && openSlot.indexOf(q.kind + "/" + q.id + "\u0000") !== 0) openSlot = null;
      sections[q.kind](form, q.id);
      if (keepFocus && $(keepFocus)) $(keepFocus).focus();
      return;
    }
    form.hidden = !e;
    if (!e) return;
    var id = entityId();
    if (openSlot && openSlot.indexOf("entity/" + id + "\u0000") !== 0) openSlot = null;

    var label = field(form, "prop-label", "Label", input("text", e.label));
    label.addEventListener("change", function () {
      apply(function () {
        return A.renameEntity(doc(), id, label.value);
      });
    });
    label.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== "Escape") return;
      ev.preventDefault();
      if (ev.key === "Escape") label.value = e.label;
      label.blur();
    });
    var kind = document.createElement("span");
    kind.textContent = e.kind;
    kind.className = "mono";
    field(form, "prop-kind", "Kind", kind);

    // Shown where it matters: guarding software only where content reaches it.
    var defense = window.effractorArchitectureView.shownDefense(doc(), id);
    if (defense) {
      var current = e.defenses[defense];
      var toggle = field(form, "prop-defense", catalog ? W.defense(catalog, defense) : word(defense), window.effractorMenu.dropdown(SWITCH, String(current)));
      toggle.addEventListener("change", function () {
        var v = toggle.value === "true" ? true : toggle.value === "false" ? false : "unknown";
        apply(function () {
          return A.setDefense(doc(), id, defense, v);
        }, null, true);
      });
    }
    parameters(form, { entity: id }, e);
    if (sections.entity) sections.entity(form, id);

    if (e.kind === "host" || e.kind === "network") {
      var addresses = field(form, "prop-addresses", e.kind === "host" ? "Addresses" : "Ranges", input("text", (e.addresses || []).join(", ")));
      addresses.placeholder = e.kind === "host" ? "10.0.1.5" : "10.0.1.0/24";
      addresses.spellcheck = false;
      addresses.addEventListener("change", function () {
        apply(function () {
          return A.setAddresses(doc(), id, addresses.value);
        }, null, true);
      });
    }
    var note = field(form, "prop-description", "Note", input("textarea", e.description));
    note.addEventListener("change", function () {
      apply(function () {
        return A.setDescription(doc(), id, note.value);
      }, null, true);
    });
    problems(form, "entities." + id);
    if (keepFocus && $(keepFocus)) $(keepFocus).focus();
  }
  // Filled in by architecture-links-ui.js: entity(form, id) adds to a
  // component's form, association/flow(form, id) are theirs whole.
  var sections = {};

  // ---- when the document or selection changes ----

  var wasArch = false;
  app.onChange(function () {
    if (!doc()) return;
    if (!arch()) {
      if (wasArch) {
        // Back to a tree: what this module changed in the shared chrome.
        rail.addChild.title = treeTitles.addChild;
        rail.addChild.setAttribute("aria-label", "Add child");
        $("outline-empty").textContent = outlineEmpty;
        openSlot = null;
        drafts = Object.create(null);
      }
      wasArch = false;
      return;
    }
    if (!wasArch) {
      var had = !!catalog;
      loadCatalog().then(function () {
        if (!had && P.isArchitecture(app.state.doc)) app.redraw();
      }, function () {});
      // Only the results tab has a meaning here, and it says so.
      if (window.effractorTabs) window.effractorTabs.show("results");
    }
    wasArch = true;
    // Drafts belong to the document and the parameter they started from.
    if (documents !== app.state.documents) {
      documents = app.state.documents;
      drafts = Object.create(null);
      openSlot = null;
    }
    Object.keys(drafts).forEach(function (key) {
      var at = key.split("\u0000");
      var e = ownerRecord(at[0]);
      var p = e && Object.prototype.hasOwnProperty.call(e.parameters || {}, at[1]) ? e.parameters[at[1]] : null;
      if (!p || JSON.stringify(p) !== drafts[key].base) delete drafts[key];
    });
    renderRail();
    renderOutline();
    renderProperties();
  });

  window.effractorArchitectureUi = {
    keys: function () {
      return KEYS;
    },
    legend: function () {
      return A.KINDS.map(function (kind) {
        var sample = window.effractorArchitectureIcons.svg(document, kind, 22);
        sample.setAttribute("class", sample.getAttribute("class") + " is-plate");
        return [sample, word(kind), W.meaning(catalog, kind)];
      });
    },
    // A parameter of the selected component or flow, opened as if clicked:
    // where a generated step's source leads.
    openParameter: function (owner, slot) {
      var record = ownerRecord(owner);
      if (!record || !Object.prototype.hasOwnProperty.call(record.parameters || {}, slot)) return;
      openSlot = owner + "\u0000" + slot;
      renderProperties();
      var first = $("param-status");
      if (first) first.focus();
    },
    // A control of the selected item's form, by what it sets.
    focusField: function (field) {
      var control = $({ defense: "prop-defense", foothold: "prop-foothold", target: "prop-target", allowed: "prop-allowed", privilege: "prop-privilege", factor: "prop-factor", contained: "prop-contained", decrypts: "prop-decrypts", mode: "prop-mode", route: "prop-route-add" }[field] || "");
      if (control) control.focus();
    },
    // For architecture-links-ui.js: the same edit queue, form parts and hooks.
    apply: apply,
    field: field,
    input: input,
    parameters: parameters,
    problems: problems,
    render: renderProperties,
    sections: sections,
    menuItems: extraItems,
    menuFor: menuFor,
    contextHooks: contextHooks,
    backgroundItems: backgroundItems,
    kindExtras: kindExtras,
    linkedExtras: linkedExtras,
    keyList: KEYS,
    loadCatalog: loadCatalog,
    // The catalog if it has arrived, else null: words fall back to ids.
    catalog: function () {
      return catalog;
    },
    word: word,
    SWITCH: SWITCH,
  };
})();
