// The Controls tab (spec 3.4, 4): each control with its switch, and what the
// last solve said it is worth. The switch edits `enabled` in the document; the
// numbers are the solver's. results-view.js decides the order, this draws it.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var E = window.effractorEdit;
  var view = window.effractorResults;
  var $ = function (id) {
    return document.getElementById(id);
  };

  // ---- the right panel's tabs ----

  function showTab(name) {
    document.querySelectorAll("[data-tab]").forEach(function (tab) {
      var on = tab.getAttribute("data-tab") === name;
      tab.setAttribute("aria-selected", String(on));
      $("tab-" + tab.getAttribute("data-tab")).hidden = !on;
    });
  }
  document.querySelectorAll("[data-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () {
      tab.blur();
      showTab(tab.getAttribute("data-tab"));
    });
  });
  // The rail's shield: straight to the controls, opening the panel if need be.
  document.querySelector('[data-tool="controls"]').addEventListener("click", function (e) {
    e.currentTarget.blur();
    var toggle = document.querySelector('[data-toggle="right"]');
    if ($("app").getAttribute("data-right") === "closed" && toggle) toggle.click();
    showTab("controls");
  });

  // ---- the list ----

  function amount(measure, v, currency) {
    return measure === "expected_loss" ? app.format.money(v, currency) : app.format.probability(v);
  }

  function worth(row, solved, currency) {
    if (row.value === null) return solved ? "not valued" : "not solved";
    var m = solved.measure;
    var text = row.enabled ? "adds " + amount(m, row.value, currency) + " if removed" : "saves " + amount(m, row.value, currency);
    if (row.ci) text += " (" + amount(m, row.ci.lo, currency) + " – " + amount(m, row.ci.hi, currency) + ")";
    if (row.perCost !== null) text += " · " + view.number(row.perCost) + " per " + (currency || "unit");
    if (row.close) text += " · too close to call";
    return text;
  }

  // An edit from this tab leaves the canvas selection where it was. Resolves
  // to whether it was applied; a refusal has been said on the canvas by then.
  function edit(change) {
    if (!change) {
      app.say("that is not possible here");
      return Promise.resolve(false);
    }
    change.select = app.state.selected;
    change.parent = app.state.parent;
    return app.applyEdit(change).then(function (applied) {
      if (!applied) render(); // the fields go back to what the document says
      return applied;
    }, function (e) {
      console.error(e);
      app.say("the edit failed: " + e.message);
      render();
      return false;
    });
  }

  var openControl = null; // the one control being edited, if any
  // The presets, and the one that blocks a step.
  var TTC_WORDS = ["Infinity", "VeryHardAndUncertain", "VeryHardAndCertain", "HardAndUncertain", "HardAndCertain", "EasyAndUncertain", "EasyAndCertain", "Exponential(0.01)", "Bernoulli(0.1)"];

  function labelled(form, id, text, control) {
    var l = document.createElement("label");
    l.htmlFor = id;
    l.textContent = text;
    control.id = id;
    form.appendChild(l);
    form.appendChild(control);
    return control;
  }

  function textInput(value, mono) {
    var i = document.createElement("input");
    i.type = "text";
    i.value = value == null ? "" : value;
    if (mono) {
      i.classList.add("mono");
      window.effractorMenu.suggest(i, TTC_WORDS);
    }
    return i;
  }

  function nodeLabel(id) {
    var n = app.state.doc.nodes[id];
    return n && n.label ? n.label : id;
  }

  function editor(id) {
    var doc = app.state.doc;
    var control = doc.controls[id];
    var form = document.createElement("div");
    form.className = "properties-inner asset-form control-form";

    var label = labelled(form, "control-label", "Label", textInput(control.label));
    label.addEventListener("change", function () {
      edit(E.setControl(app.state.doc, id, "label", label.value));
    });
    var cost = labelled(form, "control-cost", "Cost", textInput(control.cost, false));
    cost.classList.add("mono");
    cost.inputMode = "decimal";
    cost.title = "What the control costs over the horizon, in " + (doc.currency || "money");
    cost.addEventListener("change", function () {
      edit(E.setControl(app.state.doc, id, "cost", cost.value));
    });

    var title = document.createElement("p");
    title.className = "hint";
    title.textContent = "Effects: likelihood while on";
    form.appendChild(title);

    (control.effects || []).forEach(function (effect, index) {
      var row = document.createElement("div");
      row.className = "effect";
      var name = document.createElement("span");
      name.className = "effect-node";
      name.textContent = nodeLabel(effect.node);
      name.title = effect.node;
      var ttc = textInput(effect.ttc, true);
      ttc.id = "effect-ttc-" + index;
      ttc.setAttribute("aria-label", "Likelihood of " + nodeLabel(effect.node) + " while the control is on");
      ttc.addEventListener("change", function () {
        edit(E.setEffect(app.state.doc, id, index, ttc.value));
      });
      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost btn-small";
      remove.textContent = "×";
      remove.title = "Remove this effect";
      remove.setAttribute("aria-label", "Remove the effect on " + nodeLabel(effect.node));
      remove.addEventListener("click", function () {
        edit(E.removeEffect(app.state.doc, id, index));
      });
      row.appendChild(name);
      row.appendChild(ttc);
      row.appendChild(remove);
      form.appendChild(row);
    });

    var targets = E.effectTargets(doc, id);
    if (targets.length) {
      var add = document.createElement("div");
      add.className = "effect effect-add";
      var leaf = window.effractorMenu.dropdown(targets.map(function (node) {
        return [node, nodeLabel(node)];
      }), targets[0]);
      leaf.id = "effect-leaf";
      leaf.setAttribute("aria-label", "Leaf to act on");
      // The leaf selected on the canvas is the likely one.
      if (targets.indexOf(app.state.selected) >= 0) leaf.value = app.state.selected;
      var to = textInput("", true);
      to.id = "effect-new-ttc";
      to.placeholder = "likelihood";
      to.setAttribute("aria-label", "Its likelihood while the control is on");
      var go = document.createElement("button");
      go.type = "button";
      go.className = "btn btn-ghost btn-small";
      go.textContent = "Add";
      var commit = function () {
        if (!to.value.trim()) return to.focus();
        edit(E.addEffect(app.state.doc, id, leaf.value, to.value));
      };
      go.addEventListener("click", commit);
      to.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        }
      });
      add.appendChild(leaf);
      add.appendChild(to);
      add.appendChild(go);
      form.appendChild(add);
    }

    var hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Infinity blocks the step. Overlapping controls: the stronger applies.";
    form.appendChild(hint);

    var removeControl = document.createElement("button");
    removeControl.type = "button";
    removeControl.className = "btn btn-ghost btn-small asset-remove";
    removeControl.textContent = "Remove";
    removeControl.addEventListener("click", function () {
      var name = control.label || id;
      openControl = null;
      edit(E.removeControl(app.state.doc, id)).then(function (applied) {
        if (applied) app.say("removed the control “" + name + "” · Ctrl+Z undoes");
      });
    });
    form.appendChild(removeControl);
    return form;
  }

  function toggle(id) {
    var solvedBefore = !!app.state.results;
    var edit = E.toggleControl(app.state.doc, id);
    if (!edit) return;
    edit.select = app.state.selected;
    edit.parent = app.state.parent;
    app.applyEdit(edit).then(function (applied) {
      // What was on screen described the other state: say the new one.
      if (applied && solvedBefore) app.solve();
    });
  }

  function render() {
    var doc = app.state.doc;
    var results = app.state.results;
    var solved = (results && results.controls && results.controls.available) || null;
    var rows = view.controlRows(doc, results);
    var list = $("controls");
    var keepFocus = document.activeElement && list.contains(document.activeElement) ? document.activeElement.id : null;
    list.replaceChildren();
    if (openControl && !(doc.controls || {})[openControl]) openControl = null;
    $("controls-count").textContent = rows.length || "";
    $("controls-empty").hidden = rows.length > 0 || !$("control-new").hidden;
    $("controls-note").hidden = !(rows.length && solved);
    var baseline = $("controls-baseline");
    baseline.hidden = !(rows.length && solved);
    if (solved) baseline.textContent = (solved.measure === "expected_loss" ? "Expected loss as written: " : "P(top) as written: ") + amount(solved.measure, solved.baseline, results.currency);
    var unavailable = results && results.controls && results.controls.unavailable;

    rows.forEach(function (row) {
      var item = document.createElement("li");
      item.className = "control";
      var head = document.createElement("div");
      head.className = "control-head";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = row.enabled;
      box.addEventListener("change", function () {
        toggle(row.id);
      });
      box.setAttribute("aria-label", "Enabled: " + row.label);
      box.title = "Enabled in the model as written";
      // The name opens the control to be edited; the box alone switches it.
      var name = document.createElement("button");
      name.type = "button";
      name.className = "control-name";
      name.textContent = row.label;
      name.title = row.id;
      name.setAttribute("aria-expanded", String(openControl === row.id));
      name.addEventListener("click", function () {
        openControl = openControl === row.id ? null : row.id;
        render();
      });
      head.appendChild(box);
      head.appendChild(name);
      if (row.rank !== null) {
        var rank = document.createElement("span");
        rank.className = "control-rank num";
        rank.textContent = "#" + row.rank;
        rank.title = "Rank among the disabled controls, by value for money";
        head.appendChild(rank);
      }
      item.appendChild(head);
      var facts = document.createElement("p");
      facts.className = "control-facts";
      var cost = row.cost === null ? "no cost" : app.format.money(row.cost, doc.currency);
      var reach = row.effects === 1 ? "1 leaf" : row.effects + " leaves";
      facts.textContent = cost + " · " + reach;
      item.appendChild(facts);
      var value = document.createElement("p");
      value.className = "control-worth";
      value.textContent = unavailable ? unavailable.reason : worth(row, solved, results && results.currency);
      item.appendChild(value);
      if (openControl === row.id) item.appendChild(editor(row.id));
      list.appendChild(item);
    });
    if (keepFocus && $(keepFocus)) $(keepFocus).focus();
  }

  // ---- a new control: by name, like an asset ----

  $("control-add").addEventListener("click", function () {
    var name = $("control-new");
    name.hidden = false;
    name.value = "";
    $("controls-empty").hidden = true;
    name.focus();
  });
  $("control-new").addEventListener("keydown", function (e) {
    var name = $("control-new");
    if (e.key === "Escape") {
      name.hidden = true;
      return render();
    }
    if (e.key !== "Enter") return;
    e.preventDefault();
    var made = E.addControl(app.state.doc, name.value);
    if (!made) return;
    name.hidden = true;
    openControl = made.control;
    edit(made).then(function (applied) {
      var next = $("effect-new-ttc") || $("control-cost");
      if (applied && next) next.focus();
    });
  });
  $("control-new").addEventListener("blur", function () {
    $("control-new").hidden = true;
    if (app.state.doc) render();
  });

  app.onChange(function () {
    if (app.state.doc) render();
  });
})();
