// The attack graph in the page (spec 10): the view switch, a generated step
// in the inspector with the sources it came from, a component's steps, the
// attack results and the full step table in the results panel, and the keys
// and menus of the attack view. What a step is and where a source leads is
// attack-view.js's; what the results say, graph-results.js's. A generated
// step is never edited here: edits are made to the architecture.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var V = window.effractorAttackView;
  var R = window.effractorGraphResults;
  var P = window.effractorProfiles;
  var U = window.effractorArchitectureUi;
  var $ = function (id) {
    return document.getElementById(id);
  };

  function doc() {
    return app.state.doc;
  }
  function arch() {
    return P.isArchitecture(doc());
  }
  // The attack graph is on the canvas: chosen, and generated for this text.
  function attack() {
    return arch() && app.state.mode === "attack" && !!app.state.generated;
  }
  function generated() {
    return app.state.generated;
  }
  function stepOf(id) {
    return typeof id === "string" && id.indexOf("step/") === 0 ? id.slice(5) : null;
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
  function entityName(id) {
    var e = doc() && Object.prototype.hasOwnProperty.call(doc().entities || {}, id) ? doc().entities[id] : null;
    return e && e.label ? e.label : id;
  }

  // ---- the two views ----

  function toggle() {
    return app.setMode(attack() ? "architecture" : "attack");
  }
  $("view-architecture").addEventListener("click", function () {
    app.setMode("architecture");
  });
  $("view-attack").addEventListener("click", function () {
    app.setMode("attack");
  });

  // A step, selected in the attack view.
  function showStep(id) {
    return app.setMode("attack").then(function (shown) {
      if (shown) app.select("step/" + id);
    });
  }

  // A source field, followed back into the architecture: its component with
  // that parameter or control open, or else its line in the source.
  function follow(path) {
    var target = V.sourceTarget(doc(), path);
    return app.setMode("architecture").then(function () {
      if (target.source) return app.showSourcePath(target.source);
      app.select(target.select);
      if (target.slot) U.openParameter(target.select, target.slot);
      else if (target.field) U.focusField(target.field);
    });
  }

  function sourceLink(path) {
    return button(path, "Show where this is set", function () {
      follow(path);
    }, "source-link");
  }

  // ---- the inspector: a generated step ----

  function stepSection(form, id) {
    var g = generated();
    var s = g ? V.inspect(g.graph, g.support, id) : null;
    if (!s) return;
    var facts = el("dl", null, "step-facts");
    function row(term, content, title) {
      var dd = el("dd");
      if (typeof content === "string") dd.textContent = content;
      else content.forEach(function (c) {
        dd.appendChild(c);
      });
      if (title) dd.title = title;
      facts.appendChild(el("dt", term));
      facts.appendChild(dd);
    }
    row("Step", s.kind + (s.rules.length ? " · " + s.rules.join(", ") : ""), s.assumptions.join("\n"));
    row("State", s.status + (s.reason ? " · " + s.reason : ""));
    if (s.kind !== "fact") {
      var evidence = s.timing.status === "unknown" ? "? Unknown" : (s.timing.expression || "") + " · " + s.timing.status;
      row("TTC", evidence, s.timing.note || (/^(illustrative|assumed|calibrated)$/.test(s.timing.status) ? "no reason given" : ""));
    }
    if (s.components.length) {
      row("Components", s.components.map(function (c) {
        var b = button(entityName(c), c, function () {
          app.select("entity/" + c);
        }, "link-row end");
        return b;
      }));
    }
    if (s.paths.length) row("Source", s.paths.map(sourceLink));
    if (s.missing.length) row("Missing", s.missing.map(sourceLink));
    form.appendChild(facts);
    var note = el("p", "generated · read-only", "hint");
    note.title = "Edit the architecture: its steps are generated again";
    form.appendChild(note);
  }
  U.sections.step = stepSection;

  // ---- the inspector: a component's generated steps ----

  var MAX_LISTED = 12;
  function stepsBlock(form, qualified) {
    var block = el("div", null, "link-block");
    var head = el("div", null, "link-head");
    head.appendChild(el("span", "Attack steps"));
    block.appendChild(head);
    var g = generated();
    if (!g) {
      head.appendChild(button("Generate", "Generate the attack graph (G)", function () {
        app.setMode("attack");
      }, "btn btn-ghost btn-small link-add"));
      form.appendChild(block);
      return;
    }
    var steps = V.stepsFor(g.graph, qualified);
    head.appendChild(el("span", String(steps.length), "num"));
    var list = el("ul", null, "link-list");
    if (!steps.length) list.appendChild(el("li", "none: no rule applies to it", "empty"));
    steps.slice(0, MAX_LISTED).forEach(function (id) {
      var item = el("li");
      var inspected = V.inspect(g.graph, g.support, id);
      var b = button(null, id, function () {
        showStep(id);
      }, "link-row");
      b.appendChild(el("span", inspected.label, "name"));
      if (inspected.status && inspected.status !== "possible") b.appendChild(el("span", inspected.status, "privilege"));
      item.appendChild(b);
      list.appendChild(item);
    });
    if (steps.length > MAX_LISTED) list.appendChild(el("li", "+" + (steps.length - MAX_LISTED) + " in the step table", "empty"));
    block.appendChild(list);
    form.appendChild(block);
  }
  ["entity", "flow", "association"].forEach(function (kind) {
    var before = U.sections[kind];
    U.sections[kind] = function (form, id) {
      if (before) before(form, id);
      stepsBlock(form, kind + "/" + id);
    };
  });

  // ---- the results panel: probability, assumptions, sample route, steps ----

  var query = "";
  var MAX_ROWS = 500; // the table is searched whole; this many are drawn

  function heading(parent, text, count) {
    var h = el("h3", text);
    if (count != null) h.appendChild(el("span", String(count), "count num"));
    parent.appendChild(h);
  }

  function tableOf(headers, numeric) {
    var scroll = el("div", null, "analysis-scroll");
    var t = el("table", null, "analysis-table");
    var tr = el("tr");
    headers.forEach(function (h, i) {
      var th = el("th", h, numeric[i] ? "num" : "");
      th.scope = "col";
      tr.appendChild(th);
    });
    var head = el("thead");
    head.appendChild(tr);
    var body = el("tbody");
    t.appendChild(head);
    t.appendChild(body);
    scroll.appendChild(t);
    return { scroll: scroll, body: body };
  }

  function activeRow(row, act) {
    row.tabIndex = 0;
    row.addEventListener("click", act);
    row.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      e.stopPropagation();
      act();
    });
  }

  function cells(row, values, numeric) {
    values.forEach(function (v, i) {
      row.appendChild(el("td", v, numeric[i] ? "num" : ""));
    });
  }

  function renderHeadline(box, results) {
    var h = R.headline(results);
    var line = el("p", null, "attack-headline");
    line.appendChild(el("span", h.label + " by " + h.by, "label"));
    line.appendChild(el("span", h.p === null ? "—" : R.number(h.p), "stat num"));
    box.appendChild(line);
    box.appendChild(el("p", h.qualifier, "hint num"));
    var half = R.timeTo(results, 0.5);
    if (half) box.appendChild(el("p", half.indexOf("not") === 0 ? "50% " + half : "50% by " + half, "hint num"));
    if (h.missing.length) {
      heading(box, "Missing");
      h.missing.forEach(function (path) {
        box.appendChild(sourceLink(path));
      });
    }
  }

  function renderAssumptions(box, results) {
    var rows = R.assumptions(results.baseline);
    if (!rows.length) return;
    heading(box, "Assumptions", rows.length);
    var numeric = [false, false, true];
    var t = tableOf(["Source", "Evidence", "TTC"], numeric);
    rows.forEach(function (a) {
      var row = el("tr");
      cells(row, [a.path, a.status, a.expression || "?"], numeric);
      row.title = (a.note || (a.status === "policy" || a.status === "unknown" ? "" : "no reason given")) + (a.paths.length > 1 ? "\n" + a.paths.join("\n") : "");
      activeRow(row, function () {
        follow(a.path);
      });
      t.body.appendChild(row);
    });
    box.appendChild(t.scroll);
  }

  function renderRoute(box, results) {
    var w = R.witness(results.baseline, generated() ? generated().graph : null);
    if (!w) return;
    heading(box, w.title, w.steps.length);
    box.appendChild(el("p", "sample " + w.sample + " · target at " + R.number(w.time) + " " + results.time_unit, "hint num"));
    var numeric = [true, false];
    var t = tableOf([results.time_unit, "Step"], numeric);
    w.steps.forEach(function (s) {
      var row = el("tr");
      row.setAttribute("data-step", s.id);
      cells(row, [R.number(s.time), s.label], numeric);
      if (s.inputs.length > 1) row.title = "after " + s.inputs.length + " prerequisites";
      activeRow(row, function () {
        showStep(s.id);
      });
      t.body.appendChild(row);
    });
    box.appendChild(t.scroll);
  }

  // Every step of the graph, searchable; its state from the graph, its
  // probability from the latest results.
  function renderSteps(box, body) {
    var g = generated();
    var results = R.isGraphResults(app.state.results) ? app.state.results : null;
    var ids = V.search(g.graph, query);
    body.replaceChildren();
    var numeric = [false, false, true];
    ids.slice(0, MAX_ROWS).forEach(function (id) {
      var s = V.inspect(g.graph, g.support, id);
      var facts = results ? R.nodeFacts(results, id) : [];
      var p = facts.filter(function (f) {
        return f[0] === "P(step)";
      })[0];
      var row = el("tr");
      row.setAttribute("data-step", id);
      cells(row, [s.label, s.status || "", p ? p[1] : "—"], numeric);
      row.title = id;
      activeRow(row, function () {
        showStep(id);
      });
      body.appendChild(row);
    });
    var more = ids.length - MAX_ROWS;
    var extra = box.querySelector(".steps-more");
    extra.textContent = !ids.length ? "no step matches" : more > 0 ? "+" + more + " · narrow the search" : "";
    extra.hidden = !extra.textContent;
    box.querySelector(".steps-count").textContent = ids.length === g.graph.nodes.length ? String(ids.length) : ids.length + " of " + g.graph.nodes.length;
    markRows();
  }

  function renderStepTable(box) {
    var h = el("h3", "Steps");
    h.appendChild(el("span", "", "count num steps-count"));
    box.appendChild(h);
    var search = el("input", null, "step-search");
    search.type = "search";
    search.placeholder = "search steps";
    search.setAttribute("aria-label", "Search the generated steps");
    search.value = query;
    var numeric = [false, false, true];
    var t = tableOf(["Step", "State", "P"], numeric);
    box.appendChild(search);
    box.appendChild(t.scroll);
    var extra = el("p", "", "hint steps-more");
    box.appendChild(extra);
    search.addEventListener("input", function () {
      query = search.value;
      renderSteps(box, t.body);
    });
    renderSteps(box, t.body);
  }

  function markRows() {
    var selected = stepOf(app.state.selected);
    document.querySelectorAll("#attack-results tr[data-step]").forEach(function (row) {
      row.classList.toggle("is-selected", row.getAttribute("data-step") === selected);
    });
  }

  function renderResults() {
    var box = $("attack-results");
    box.replaceChildren();
    var results = R.isGraphResults(app.state.results) ? app.state.results : null;
    if (results) {
      renderHeadline(box, results);
      renderAssumptions(box, results);
      renderRoute(box, results);
    } else {
      box.appendChild(el("p", "Solve (Ctrl+Enter) to see the target's probability.", "empty"));
    }
    if (generated()) renderStepTable(box);
    else box.appendChild(el("p", "Generate (G) to list the attack steps.", "empty"));
  }

  // ---- the attack view's keys ----

  function typingElsewhere(e) {
    return !!e.target.closest(".analysis-chart, .chart-table, summary, .menu, .attack-results") || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || !!document.querySelector("dialog[open]");
  }

  // What would edit the architecture from the attack view, by key.
  var EDITS = { a: "addComponent", Tab: "addChild", F2: "rename", p: "properties", l: "link", Delete: "deleteNode", Backspace: "deleteNode" };

  // Before the architecture editor's own keys: in the attack view they are
  // refused here, and say why.
  document.addEventListener(
    "keydown",
    function (e) {
      if (e.defaultPrevented || !arch() || e.ctrlKey || e.metaKey || e.altKey || typingElsewhere(e)) return;
      var key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "g") {
        e.preventDefault();
        return toggle();
      }
      if (!attack()) return;
      var step = stepOf(app.state.selected);
      if (key === "Enter" && step) {
        // From a step to its component, in the architecture.
        e.preventDefault();
        return app.setMode("architecture");
      }
      if (EDITS[key]) {
        e.preventDefault();
        app.say(step ? V.refuse(EDITS[key]) : "edits are made in the architecture · G");
      }
    },
    true
  );

  U.keyList.push(["G", "Attack graph or architecture"]);
  U.keyList.push(["Enter", "From a step to its component"]);
  U.keyList.push(["right-click a step", "Its sources and component"]);

  // ---- the attack view's pointer ----

  app.renderer.on("context", function (e) {
    if (!attack()) return;
    var step = stepOf(e.id);
    if (!step) {
      return app.showMenu([
        ["Architecture view", "G", function () {
          app.setMode("architecture");
        }],
        ["Fit", "F", app.renderer.fit],
      ], e.x, e.y);
    }
    app.select(e.id);
    var g = generated();
    var s = V.inspect(g.graph, g.support, step);
    var items = [["Show component", "Enter", function () {
      app.setMode("architecture");
    }]];
    items.push(s.paths.length ? ["Source", "", s.paths.map(function (path) {
      return [path, "", function () {
        follow(path);
      }];
    })] : ["no source field: logical", "", null]);
    items.push(["generated · read-only", "", null]);
    app.showMenu(items, e.x, e.y);
  });
  app.renderer.on("activate", function (e) {
    if (attack() && stepOf(e.id)) app.setMode("architecture");
  });

  // ---- when the document, the view or the selection changes ----

  var rail = {
    addChild: document.querySelector('[data-action="addChild"]'),
    link: document.querySelector('[data-action="linkComponent"]'),
    deleteNode: document.querySelector('[data-action="deleteNode"]'),
  };
  var shownResults;
  var shownGraph;
  app.onChange(function () {
    if (!doc()) return;
    var on = attack();
    $("view-architecture").setAttribute("aria-pressed", String(!on));
    $("view-attack").setAttribute("aria-pressed", String(on));
    $("view-attack").title = generated() ? "Attack graph (G)" : "Generate the attack graph (G)";
    var count = app.state.stepCount;
    $("attack-count").textContent = !count ? "" : count.shown === count.total ? count.total + " steps" : count.shown + " of " + count.total + " steps shown";
    if (!arch()) {
      shownResults = shownGraph = undefined;
      return;
    }
    // The architecture editor's rail acts on components; in the attack view
    // there are none to act on.
    if (on) {
      Object.keys(rail).forEach(function (k) {
        rail[k].disabled = true;
        rail[k].title = "Edits are made in the architecture (G)";
      });
    }
    if (shownResults !== app.state.results || shownGraph !== generated()) {
      shownResults = app.state.results;
      shownGraph = generated();
      renderResults();
    } else {
      markRows();
    }
  });
})();
