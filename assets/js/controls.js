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
    if (row.value === null) return solved ? "not valued" : "Solve to see what it is worth.";
    var m = solved.measure;
    var text = (row.enabled ? "removing it adds " : "enabling it saves ") + amount(m, row.value, currency);
    if (row.ci) text += " (" + amount(m, row.ci.lo, currency) + " – " + amount(m, row.ci.hi, currency) + ")";
    if (row.perCost !== null) text += " · " + view.number(row.perCost) + " per " + (currency || "unit") + " spent";
    if (row.close) text += " · too close to another to call: more samples would settle it";
    return text;
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
    list.replaceChildren();
    $("controls-count").textContent = rows.length || "";
    $("controls-empty").hidden = rows.length > 0;
    $("controls-note").hidden = !(rows.length && solved);
    var baseline = $("controls-baseline");
    baseline.hidden = !(rows.length && solved);
    if (solved) baseline.textContent = (solved.measure === "expected_loss" ? "Expected loss as written: " : "P(top) as written: ") + amount(solved.measure, solved.baseline, results.currency);
    var unavailable = results && results.controls && results.controls.unavailable;

    rows.forEach(function (row) {
      var item = document.createElement("li");
      item.className = "control";
      var head = document.createElement("label");
      head.className = "control-head";
      var box = document.createElement("input");
      box.type = "checkbox";
      box.checked = row.enabled;
      box.addEventListener("change", function () {
        toggle(row.id);
      });
      var name = document.createElement("span");
      name.className = "control-name";
      name.textContent = row.label;
      name.title = row.id;
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
      var cost = row.cost === null ? "no cost given" : "costs " + app.format.money(row.cost, doc.currency);
      var reach = row.effects === 1 ? "1 leaf" : row.effects + " leaves";
      facts.textContent = cost + " · acts on " + reach;
      item.appendChild(facts);
      var value = document.createElement("p");
      value.className = "control-worth";
      value.textContent = unavailable ? unavailable.reason : worth(row, solved, results && results.currency);
      item.appendChild(value);
      list.appendChild(item);
    });
  }

  app.onChange(function () {
    if (app.state.doc) render();
  });
})();
