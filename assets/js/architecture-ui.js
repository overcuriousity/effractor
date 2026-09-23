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
  function entity() {
    var id = entityId();
    return id ? doc().entities[id] : null;
  }
  function word(kind) {
    return kind.charAt(0).toUpperCase() + kind.slice(1);
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
    var field = $("prop-label");
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

  // The type picker: one menu of the eight kinds.
  function pickKind(x, y) {
    app.showMenu(A.KINDS.map(function (kind) {
      return [word(kind), "", function () { create(kind); }];
    }), x, y);
  }
  function pickKindAt(anchor) {
    var box = (anchor || $("canvas")).getBoundingClientRect();
    if (anchor) pickKind(box.right + 4, box.top);
    else pickKind(box.left + box.width / 2, box.top + box.height / 3);
  }

  // With everything that named it; the notice counts what went along.
  function remove() {
    var id = entityId();
    if (!id) return;
    apply(function () {
      return L.remove(doc(), "entities", id);
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

  function menuFor(id, x, y) {
    app.select("entity/" + id);
    var items = [["Rename", "F2", focusLabel]];
    if (Object.keys(doc().entities[id].parameters || {}).length) items.push(["Edit parameters", "P", firstParameter]);
    items.push(["Show in source", "", function () { app.showSourcePath("entities." + id); }]);
    items.push(["Delete", "Del", remove]);
    app.showMenu(items, x, y);
  }

  // ---- keys ----

  function typingElsewhere(e) {
    return !!e.target.closest(".analysis-chart, .chart-table, summary, .menu") || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || document.querySelector("dialog[open]");
  }

  var KEYS = [
    ["A", "Add a component"],
    ["F2", "Rename"],
    ["P", "Edit parameters"],
    ["Del", "Delete, with its links"],
    ["↑ ↓", "Previous, next component"],
    ["click", "Select a component"],
    ["double-click", "Rename it"],
    ["right-click", "Its actions; on the background, add a component"],
  ];

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || !arch() || typingElsewhere(e) || e.ctrlKey || e.metaKey || e.altKey) return;
    var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === "a") {
      e.preventDefault();
      return pickKindAt(null);
    }
    if (key === "ArrowDown" || key === "ArrowUp") {
      e.preventDefault();
      return walk(key === "ArrowDown" ? 1 : -1);
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

  app.renderer.on("context", function (e) {
    if (!arch()) return;
    var q = P.qualified(e.id);
    if (q && q.kind === "entity") return menuFor(q.id, e.x, e.y);
    pickKind(e.x, e.y);
  });
  app.renderer.on("activate", function (e) {
    if (!arch()) return;
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
  rail.addChild.addEventListener("click", function () {
    if (arch()) pickKindAt(rail.addChild);
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
    rail.addChild.title = "Add a component (A)";
    rail.addChild.setAttribute("aria-label", "Add a component");
    rail.deleteNode.disabled = !entityId();
    rail.deleteNode.title = entityId() ? "Delete “" + entity().label + "” (Del)" : "Delete";
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
  var openSlot = null; // "entity-id\u0000slot"
  // Made by the first change in the form, with the parameter it started from:
  // if that parameter changes underneath (undo, the source, another file),
  // the draft is dropped rather than written over it.
  var drafts = Object.create(null);
  var documents = -1;

  function slotKey(id, slot) {
    return id + "\u0000" + slot;
  }

  function given(p) {
    if (!p || p.status === "unknown") return "? Unknown";
    return p.ttc + " · " + p.status;
  }

  function firstParameter() {
    var e = entity();
    var slots = e ? Object.keys(e.parameters || {}) : [];
    if (!slots.length) return app.say("no parameters for a " + (e ? e.kind : "selection"));
    var unknown = slots.filter(function (s) { return e.parameters[s].status === "unknown"; })[0];
    openSlot = slotKey(entityId(), unknown || slots[0]);
    renderProperties();
    var first = $("param-status") || $("param-ttc");
    if (first) first.focus();
  }

  function parameterForm(id, slot, current) {
    var key = slotKey(id, slot);
    var draft = drafts[key] || { status: current.status, ttc: current.ttc || "", note: current.note || "", base: JSON.stringify(current) };
    function keep() {
      drafts[key] = draft;
    }
    var form = document.createElement("div");
    form.className = "parameter-form";
    var status = field(form, "param-status", "Evidence", window.effractorMenu.dropdown(STATUS, draft.status));
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
      l.textContent = "TTC";
      form.appendChild(l);
      form.appendChild(timing);
      ttc.addEventListener("input", function () { draft.ttc = ttc.value; keep(); });
      ttc.addEventListener("change", function () { draft.ttc = ttc.value; keep(); });
      var note = field(form, "param-note", "Basis", input("textarea", draft.note));
      note.placeholder = "source or assumption";
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
        return A.setParameter(doc(), { entity: id }, slot, draft);
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

  function parameters(form, id, e) {
    var slots = Object.keys(e.parameters || {});
    if (!slots.length) return;
    var list = document.createElement("ul");
    list.className = "parameters";
    slots.forEach(function (slot) {
      var p = e.parameters[slot];
      var key = slotKey(id, slot);
      var item = document.createElement("li");
      var head = document.createElement("button");
      head.type = "button";
      head.className = "parameter-head";
      head.setAttribute("aria-expanded", String(openSlot === key));
      head.title = slotHint(slot) + (p.note ? "\n" + p.note : "");
      var name = document.createElement("span");
      name.className = "slot";
      name.textContent = slot;
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
      if (openSlot === key) item.appendChild(parameterForm(id, slot, p));
      list.appendChild(item);
    });
    form.appendChild(list);
  }

  function problems(form, id) {
    var here = (app.state.diagnostics || []).filter(function (d) {
      return d.path === "entities." + id || d.path.indexOf("entities." + id + ".") === 0;
    });
    if (!here.length) return;
    var list = document.createElement("ul");
    list.className = "diagnostics";
    here.forEach(function (d) {
      var item = document.createElement("li");
      item.textContent = d.message;
      list.appendChild(item);
    });
    form.appendChild(list);
  }

  function renderProperties() {
    var form = $("properties");
    var keepFocus = document.activeElement && form.contains(document.activeElement) ? document.activeElement.id : null;
    form.replaceChildren();
    var e = entity();
    form.hidden = !e;
    if (!e) return;
    var id = entityId();
    if (openSlot && openSlot.indexOf(id + "\u0000") !== 0) openSlot = null;

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

    var defense = Object.keys(e.defenses || {})[0];
    if (defense) {
      var current = e.defenses[defense];
      var toggle = field(form, "prop-defense", word(defense), window.effractorMenu.dropdown(SWITCH, String(current)));
      toggle.addEventListener("change", function () {
        var v = toggle.value === "true" ? true : toggle.value === "false" ? false : "unknown";
        apply(function () {
          return A.setDefense(doc(), id, defense, v);
        }, null, true);
      });
    }
    parameters(form, id, e);

    var note = field(form, "prop-description", "Note", input("textarea", e.description));
    note.addEventListener("change", function () {
      apply(function () {
        return A.setDescription(doc(), id, note.value);
      }, null, true);
    });
    problems(form, id);
    if (keepFocus && $(keepFocus)) $(keepFocus).focus();
  }

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
      loadCatalog().catch(function () {});
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
      var e = Object.prototype.hasOwnProperty.call(doc().entities, at[0]) ? doc().entities[at[0]] : null;
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
  };
})();
