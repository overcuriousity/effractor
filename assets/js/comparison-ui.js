// The Compare tab: the document's defence scenarios, edited as named overlays,
// and the comparison of the baseline with the one chosen. Choosing is the
// workspace's (app.setScenario); editing goes through app.applyEdit like
// every other edit. Numbers and states come from comparison.js, which takes
// them from the solver.
(function () {
  var app = window.effractor;
  var C = window.effractorComparison;
  var R = window.effractorGraphResults;
  var P = window.effractorProfiles;
  var menu = window.effractorMenu;

  function $(id) {
    return document.getElementById(id);
  }

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }

  function button(text, title, act, cls) {
    var b = el("button", text, cls || "btn btn-ghost btn-small");
    b.type = "button";
    if (title) b.title = title;
    b.addEventListener("click", act);
    return b;
  }

  function doc() {
    return app.state.doc;
  }

  function catalog() {
    var U = window.effractorArchitectureUi;
    return U ? U.catalog() : null;
  }

  function attackUi() {
    return window.effractorAttackUi;
  }

  // An edit of the document; the scenario it names becomes the one compared.
  function apply(edit) {
    if (!edit) return;
    app.applyEdit(edit).then(function (applied) {
      if (!applied) return;
      if (edit.notice) app.say(edit.notice);
      app.setScenario(edit.scenario === undefined ? app.state.scenario : edit.scenario);
    });
  }

  var VALUES = {
    defense: [["true", "on"], ["false", "off"], ["unknown", "unknown"]],
    permission: [["true", "allowed"], ["false", "denied"], ["unknown", "unknown"]],
  };

  function valueOf(text) {
    return text === "true" ? true : text === "false" ? false : "unknown";
  }

  function word(sw, value) {
    var list = VALUES[sw.association != null ? "permission" : "defense"];
    return list.filter(function (v) {
      return v[0] === String(value);
    })[0][1];
  }

  // ---- choosing and naming ----

  function newScenario() {
    var d = doc();
    if (!P.isArchitecture(d)) return;
    var n = C.ids(d).length + 1;
    var label = "Scenario " + n;
    apply(C.putScenario(d, C.freshId(d, label), label, []));
  }

  function picker(d) {
    var options = [["", "nothing · baseline only"]].concat(
      C.ids(d).map(function (id) {
        return [id, d.scenarios[id].label];
      })
    );
    var pick = menu.dropdown(options, app.state.scenario);
    pick.setAttribute("aria-label", "Compare the baseline with");
    pick.addEventListener("change", function () {
      app.setScenario(pick.value);
    });
    return pick;
  }

  // ---- one scenario's settings ----

  function addMenu(anchor, d, id, set) {
    var all = C.switches(d, catalog());
    var free = all.filter(function (s) {
      return !(s.key in set.values);
    });
    // The value a change would first make: the other one from the baseline.
    function first(s) {
      return s.association != null ? s.baseline !== false ? false : true : s.baseline !== true;
    }
    var defences = free
      .filter(function (s) {
        return s.entity != null;
      })
      .map(function (s) {
        return [s.label + " · " + s.word, null, function () {
          apply(C.setChange(d, id, s, first(s)));
        }];
      });
    var permissions = free
      .filter(function (s) {
        return s.association != null;
      })
      .map(function (s) {
        return [s.label, null, function () {
          apply(C.setChange(d, id, s, first(s)));
        }];
      });
    var items = [];
    items.push(defences.length ? ["Defence", null, defences] : ["No defence left · add a component that has one", null, null]);
    items.push(permissions.length ? ["Permission", null, permissions] : ["No permission left · a firewall's permits a flow", null, null]);
    app.showMenu(items, 0, 0, anchor.getBoundingClientRect());
  }

  function settingsForm(box, d, id) {
    var set = C.settings(d, id);
    var form = el("div", null, "compare-form");

    var name = el("input");
    name.type = "text";
    name.className = "compare-name";
    name.value = set.label;
    name.setAttribute("aria-label", "Name of the scenario");
    name.addEventListener("change", function () {
      var label = name.value.trim();
      if (!label) {
        name.value = set.label;
        return app.say("a scenario needs a name");
      }
      apply(C.rename(doc(), id, label));
    });
    name.addEventListener("keydown", function (e) {
      if (e.key === "Enter") name.blur();
    });
    form.appendChild(name);

    var speedRow = el("label", null, "compare-row");
    speedRow.appendChild(el("span", "Attacker speed", "compare-term"));
    var speed = el("input");
    speed.type = "text";
    speed.inputMode = "decimal";
    speed.className = "compare-speed num";
    speed.placeholder = "as written";
    speed.value = set.speed === null ? "" : String(set.speed);
    speed.title = "2 is twice as fast, 0.5 half · empty: as the times are written";
    speed.addEventListener("change", function () {
      var text = speed.value.trim();
      if (!text) return apply(C.setSpeed(doc(), id, null));
      var v = Number(text);
      if (!(isFinite(v) && v > 0)) {
        speed.value = set.speed === null ? "" : String(set.speed);
        return app.say("a speed is a number above 0: 2 is twice as fast");
      }
      apply(C.setSpeed(doc(), id, v));
    });
    speed.addEventListener("keydown", function (e) {
      if (e.key === "Enter") speed.blur();
    });
    speedRow.appendChild(speed);
    speedRow.appendChild(el("span", "×", "hint"));
    form.appendChild(speedRow);

    var head = el("h3", "Changes");
    var add = button("+", "Set a defence or a permission", function () {
      addMenu(add, doc(), id, C.settings(doc(), id));
    }, "label-action");
    add.setAttribute("aria-label", "Set a defence or a permission");
    head.appendChild(add);
    form.appendChild(head);

    var byKey = Object.create(null);
    C.switches(d, catalog()).forEach(function (s) {
      byKey[s.key] = s;
    });
    var keys = Object.keys(set.values);
    if (!keys.length) form.appendChild(el("p", "No changes · + sets a defence or a permission", "empty"));
    var list = el("ul", null, "compare-changes");
    keys.forEach(function (key) {
      var s = byKey[key];
      var li = el("li", null, "compare-change");
      if (!s) {
        // A switch the catalog does not offer here: the file says why.
        li.appendChild(el("span", key, "mono"));
        li.title = "not a switch of this component · see the source";
        list.appendChild(li);
        return;
      }
      var text = el("span", s.label + (s.entity != null ? " · " + s.word : ""), "compare-what");
      text.title = key + " · as written: " + word(s, s.baseline);
      li.appendChild(text);
      var pick = menu.dropdown(VALUES[s.association != null ? "permission" : "defense"], String(set.values[key]));
      pick.setAttribute("aria-label", s.label + " in this scenario");
      pick.addEventListener("change", function () {
        apply(C.setChange(doc(), id, s, valueOf(pick.value)));
      });
      li.appendChild(pick);
      var remove = button("×", "Back to as written (" + word(s, s.baseline) + ")", function () {
        apply(C.setChange(doc(), id, s, null));
      }, "btn btn-ghost btn-small compare-remove");
      remove.setAttribute("aria-label", "Remove this change");
      li.appendChild(remove);
      list.appendChild(li);
    });
    form.appendChild(list);
    form.appendChild(
      button("Remove scenario", "Remove “" + set.label + "” from the document · Ctrl+Z undoes", function () {
        apply(C.removeScenario(doc(), id));
      })
    );
    box.appendChild(form);
  }

  // ---- the comparison ----

  function said(side) {
    if (side.p === null) return "unknown";
    return R.number(side.p) + (side.ci && side.ci.lo !== side.ci.hi ? " [" + R.number(side.ci.lo) + ", " + R.number(side.ci.hi) + "]" : "");
  }

  function stepList(box, title, ids, graph, empty) {
    var h = el("h3", title);
    h.appendChild(el("span", String(ids.length), "count num"));
    box.appendChild(h);
    if (!ids.length) {
      box.appendChild(el("p", empty, "empty"));
      return;
    }
    var labels = Object.create(null);
    graph.nodes.forEach(function (n) {
      labels[n.id] = n.label;
    });
    var ul = el("ul", null, "compare-steps");
    ids.forEach(function (id) {
      var li = el("li");
      li.appendChild(button(labels[id] || id, id, function () {
        if (attackUi()) attackUi().showStep(id);
      }, "compare-step"));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function comparison(box, d, id) {
    var results = app.state.results;
    var now = R.isGraphResults(results) ? C.state(results, id, app.state.solvedRevision, app.state.revision) : "none";
    if (now === "none") {
      box.appendChild(el("p", "Calculate to compare", "empty"));
      return;
    }
    // Numbers of an older text: said as such, and no routes are read from them.
    if (now === "stale") {
      box.classList.add("is-stale");
      box.appendChild(el("p", "outdated · for the text before the last edit", "hint"));
    }
    var s = C.summary(results);
    var by = results.horizon + " " + results.time_unit;
    var t = el("dl", null, "compare-facts");
    function row(term, value, title) {
      var dt = el("dt", term);
      var dd = el("dd", value, "num");
      if (title) dd.title = title;
      t.append(dt, dd);
    }
    row("Baseline", said(s.baseline) + (s.illustrative.baseline ? " · illustrative" : ""), "P(target) by " + by);
    row(d.scenarios[id].label, said(s.scenario) + (s.illustrative.scenario ? " · illustrative" : ""), "P(target) by " + by);
    if (s.benefit === null) {
      row("Difference", "unknown", s.reason || "");
    } else {
      var v = s.verdict === "same" ? "no change" : (s.verdict === "lower" ? "−" : "+") + R.number(Math.abs(s.benefit));
      var ci = s.ci ? " [" + R.number(-s.ci.hi) + ", " + R.number(-s.ci.lo) + "]" : "";
      row("Difference", v + ci, s.ci ? Math.round(results.confidence * 100) + "% paired interval, scenario minus baseline" : s.ciReason || "");
    }
    box.appendChild(t);
    box.appendChild(el("p", "P(target) by " + by + (s.ci === null && s.ciReason ? " · " + s.ciReason : ""), "hint num"));
    if (s.missing.length) {
      var h = el("h3", "Unknown inputs");
      box.appendChild(h);
      s.missing.forEach(function (path) {
        box.appendChild(button(path, "Show where this is set", function () {
          if (attackUi()) attackUi().follow(path);
        }, "source-link"));
      });
    }
    if (now === "stale") return;
    var g = app.state.generated;
    if (!g || g.revision !== app.state.revision) {
      // Built on request only: a build of its own would overtake one the
      // attack view is waiting for.
      box.appendChild(button("Build the attack graph", "Routes need the attack graph", function () {
        app.generate().then(function () {
          render(true);
        });
      }));
      return;
    }
    var r = C.routes(g.graph, results, d, id);
    var changed = C.changedSteps(g.graph, d, id);
    if (changed.speed !== null) box.appendChild(el("p", "every timed step " + R.number(changed.speed) + " × as fast", "hint num"));
    stepList(box, "Blocked", r.blocked, g.graph, "nothing blocked that was open");
    stepList(box, "Changed, still open", r.changed, g.graph, "no changed step stays open");
    stepList(box, "Still open to the target", r.remaining, g.graph, "no way to the target is left");
  }

  // ---- the tab ----

  var shown = {};

  function render(force) {
    var box = $("compare-view");
    if (!box) return;
    var d = doc();
    var key = { doc: d, scenario: app.state.scenario, results: app.state.results, generated: app.state.generated, revision: app.state.revision, solved: app.state.solvedRevision };
    if (!force && Object.keys(key).every(function (k) { return key[k] === shown[k]; })) return;
    // Typing in a field is not interrupted: this is drawn when focus leaves it.
    var active = document.activeElement;
    if (active && box.contains(active) && active.tagName === "INPUT") return;
    shown = key;
    box.replaceChildren();
    if (!P.isArchitecture(d)) return;
    var ids = C.ids(d);
    if (!ids.length) {
      box.appendChild(el("p", "No scenarios · + adds one", "empty"));
      return;
    }
    var line = el("p", null, "compare-pick");
    line.appendChild(el("span", "Baseline vs", "compare-term"));
    line.appendChild(picker(d));
    box.appendChild(line);
    var id = app.state.scenario;
    if (!id) {
      box.appendChild(el("p", "Choose a scenario to compare", "empty"));
      return;
    }
    settingsForm(box, d, id);
    var results = el("div", null, "compare-results");
    comparison(results, d, id);
    box.appendChild(results);
  }

  var add = $("scenario-add");
  if (add) add.addEventListener("click", newScenario);
  var view = $("compare-view");
  if (view) view.addEventListener("focusout", function () {
    // After the field has let go of focus, and before anything else changes.
    setTimeout(function () {
      render(false);
    }, 0);
  });
  app.onChange(function () {
    render(false);
  });
})();
