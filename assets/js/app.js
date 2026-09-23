// The page: loads a document, asks the solver about it, shows what it says.
// The document is only ever read and rewritten by the wasm module; this file
// moves text and results between it and the DOM.
(function () {
  function grouped(n) {
    return String(n).replace(/\B(?=(\d{3})+$)/g, " ");
  }

  function probability(p) {
    if (p === 0) return "0";
    return p < 1e-4 ? p.toExponential(2) : p.toPrecision(3);
  }

  function money(value, currency) {
    try {
      return new Intl.NumberFormat("en", { style: "currency", currency: currency, maximumFractionDigits: 0 }).format(value);
    } catch (e) {
      var n = new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
      return currency ? n + " " + currency : n;
    }
  }

  function analysisLabel(analysis) {
    return grouped(analysis.samples) + " samples · seed " + analysis.seed;
  }

  // ?samples=N solves the loaded document with N samples: a way to make a run
  // long enough to watch and to cancel, until documents can be edited here.
  function samplesOverride(search) {
    var m = /[?&]samples=(\d+)(&|$)/.exec(search);
    var n = m ? Number(m[1]) : 0;
    return n >= 1 && Number.isSafeInteger(n) ? n : null;
  }

  // The page opens on an empty document: a fault tree, or with
  // ?new=attack-tree an attack tree, ?new=architecture an architecture. No
  // example ships.
  function templateName(search) {
    var m = /[?&]new=([a-z-]+)(&|$)/.exec(search);
    if (m && m[1] === "attack-tree") return "new-attack";
    return m && m[1] === "architecture" ? "new-architecture" : "new";
  }

  if (typeof module !== "undefined") {
    module.exports = { templateName: templateName, grouped: grouped, probability: probability, money: money, analysisLabel: analysisLabel, samplesOverride: samplesOverride };
  }
  if (typeof document === "undefined") return;

  // Resolve from this script, including on /s/id and repository Pages URLs.
  var assets = new URL("../", document.currentScript.src);
  var TEMPLATE = new URL("templates/" + templateName(location.search) + ".yaml", assets).href;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var store = window.effractorStore.createStore(window.indexedDB);
  var solver = window.createSolver(function () {
    return new Worker(new URL("js/solver-worker.js", assets));
  });
  // For the console: effractor.solver.crash() shows the recovery path.
  window.effractor = { solver: solver };
  var listeners = []; // told after every load and every selection

  var P = window.effractorProfiles;
  // Every asynchronous answer (parse, layout, solve) carries a token of the
  // revision it was asked about; one that arrives after an edit, an undo,
  // another file or new source text is dropped (revisions.js).
  var gate = window.effractorRevisions.create();
  // `mode` is the architecture's view: "architecture" or "attack", its
  // generated graph. `generated`: {graph, support, revision} of the text on
  // the page, or null. `sourceValid`: the source view's text is the document's.
  var state = { text: null, doc: null, running: false, selected: null, parent: null, parentChosen: false, laid: null, results: null, ranked: [], measure: "fussell_vesely", activeRow: null, lastSampledMs: null, revision: gate.current(), sourceValid: true, mode: "architecture", generated: null, blockers: null, diagnostics: [], documents: 0 };
  var view = window.effractorResults;
  var AV = window.effractorAttackView;
  var GR = window.effractorGraphResults;
  var PR = window.effractorProblems;
  var MAX_ROWS = 200; // a table is for reading; ten thousand rows are not read

  var renderer = window.effractorRenderer.createSvgRenderer(document);
  var layout = window.effractorLayout.createLayout();
  renderer.mount($("stage"));
  var auto = window.effractorAutoSolve;
  var autosolve = auto.createAutoSolve({
    start: run,
    cancel: solver.cancel,
    // Wrapped: a browser's timers refuse to be called as another object's methods.
    setTimeout: function (f, ms) {
      return setTimeout(f, ms);
    },
    clearTimeout: function (id) {
      clearTimeout(id);
    },
  });

  function fact(list, term, value) {
    var dt = document.createElement("dt");
    var dd = document.createElement("dd");
    dt.textContent = term;
    if (view.HINTS[term]) dt.title = view.HINTS[term];
    dd.textContent = value;
    list.appendChild(dt);
    list.appendChild(dd);
    return dd;
  }

  // `parent` is the edge the selection came along, which is what Enter, Del
  // and the arrows act on; without one it is the node's first parent.
  // An architecture's selection is qualified (`entity/web`); it has no edge
  // it was reached along and no solved facts yet.

  // The inspector is as tall as what it holds: its content is measured, and
  // the height eases there from the last selection's. Opened, it takes its
  // height at once; there is nothing to ease from.
  var inspectorShown = false;
  function fitInspector() {
    var box = $("inspector");
    if (box.hidden) {
      inspectorShown = false;
      return;
    }
    var edges = box.offsetHeight - box.clientHeight;
    var height = box.firstElementChild.offsetHeight + edges + "px";
    if (inspectorShown) {
      box.style.height = height;
      return;
    }
    box.classList.add("is-placing");
    box.style.height = height;
    void box.offsetHeight;
    box.classList.remove("is-placing");
    inspectorShown = true;
  }
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(fitInspector).observe($("inspector").firstElementChild);

  function graphOf() {
    return state.generated ? state.generated.graph : null;
  }
  function attackShown() {
    return state.mode === "attack" && !!state.generated && P.isArchitecture(state.doc);
  }
  function stepOf(id) {
    return typeof id === "string" && id.indexOf("step/") === 0 ? id.slice(5) : null;
  }

  function select(id, parent) {
    var arch = P.isArchitecture(state.doc);
    state.selected = P.selectionExists(state.doc, id, graphOf()) ? id : null;
    var parents = state.selected && !arch ? window.effractorEdit.parentsOf(state.doc, state.selected) : [];
    // `parentChosen`: the edge was named (a tree row, an arrow key), not guessed.
    state.parentChosen = parents.indexOf(parent) >= 0;
    state.parent = state.parentChosen ? parent : parents[0] || null;
    renderer.highlight(state.selected ? [state.selected] : [], "selected");
    // A selected flow shows where it goes: the networks and routers on its
    // route, which its line from end to end does not.
    var flow = arch && state.selected && state.selected.indexOf("flow/") === 0 ? state.selected.slice(5) : null;
    renderer.highlight(flow && !attackShown() ? window.effractorArchitectureView.route(state.doc, flow) : [], "route");
    // In the attack graph a component lights the steps its rules produced.
    var lit = attackShown() && state.selected && !stepOf(state.selected) ? AV.stepsFor(graphOf(), state.selected) : [];
    renderer.highlight(lit.map(function (s) {
      return "step/" + s;
    }), "steps");
    // A step outside the window on the canvas, or a component none of whose
    // steps are in it, brings the window there, and the step into view.
    var outside = attackShown() && state.selected && state.shownSteps && (stepOf(state.selected)
      ? !state.shownSteps[state.selected]
      : lit.length > 0 && !lit.some(function (s) {
          return state.shownSteps["step/" + s];
        }));
    if (outside) {
      var wanted = state.focus = state.selected;
      draw(false).then(function () {
        if (state.selected === wanted) renderer.reveal(wanted, $("inspector").getBoundingClientRect().width + 8);
      });
    }
    // The edge a shared node was reached along, when that was said: it is what
    // Del and Unlink act on.
    renderer.highlight(state.selected && state.parentChosen && parents.length > 1 ? [state.selected, state.parent] : [], "via");
    var facts = $("selected-facts");
    facts.replaceChildren();
    var step = arch ? stepOf(state.selected) : null;
    // The inspector on the canvas is the selection made visible: there while
    // something is selected, gone when nothing is. No panel opens for it.
    $("inspector").hidden = !state.selected;
    // The inspector floats over the canvas: what it would cover is panned
    // into view, and nothing else moves.
    if (state.selected) renderer.reveal(state.selected, $("inspector").getBoundingClientRect().width + 8);
    $("inspector-name").textContent = state.selected ? labelOf(state.selected) : "";
    notify();
    // A step's state is the inspector's own line; its numbers are listed here.
    var said = !state.selected ? [] : !arch ? view.nodeFacts(state.results, state.selected) : step && GR.isGraphResults(state.results) ? GR.nodeFacts(state.results, step).filter(function (f) {
      return f[0] !== "State";
    }) : [];
    said.forEach(function (f) {
      fact(facts, f[0], f[1]).classList.add("num");
    });
    facts.hidden = said.length === 0 && (arch || !state.selected);
  }

  // Canvas → table: the rows holding the selected node.
  function markRows() {
    var rows = $("cutsets-body").children;
    var holding = view.rowsContaining(state.ranked.slice(0, MAX_ROWS), state.selected);
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("has-selected", holding.indexOf(i) >= 0);
  }

  // Table → canvas: a row lights its leaves, and again puts them out.
  function activateRow(index) {
    state.activeRow = state.activeRow === index ? null : index;
    var rows = $("cutsets-body").children;
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("is-active", i === state.activeRow);
    renderer.highlight(state.activeRow === null ? [] : state.ranked[state.activeRow].leaves, "cutset");
  }

  function labelOf(id) {
    if (P.isArchitecture(state.doc)) {
      var q = P.qualified(id);
      var own = function (map, key) {
        return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
      };
      var name = function (entity) {
        var e = own(state.doc.entities, entity);
        return e && e.label ? e.label : entity;
      };
      if (q && q.kind === "step") {
        var inspected = AV.inspect(graphOf(), null, q.id);
        return inspected ? inspected.label : q.id;
      }
      if (q && q.kind === "association") {
        var a = own(state.doc.associations, q.id);
        if (a) return a.kind + " · " + name(a.from) + " → " + (a.kind === "permits" ? labelOf("flow/" + a.to) : name(a.to));
      }
      var record = !q ? null : q.kind === "entity" ? own(state.doc.entities, q.id) : q.kind === "flow" ? own(state.doc.flows, q.id) : null;
      return record && record.label ? record.label : q ? q.id : id;
    }
    var node = state.doc.nodes[id];
    return node && node.label ? node.label : id;
  }

  function showCutSets(results) {
    var body = $("cutsets-body");
    // A lit row stays lit across a new solve, if the set is still there.
    var lit = state.activeRow === null ? null : state.ranked[state.activeRow].leaves.join("\u0000");
    body.replaceChildren();
    state.activeRow = null;
    renderer.highlight([], "cutset");
    var cuts = results.cut_sets.available;
    state.ranked = cuts ? view.rankCutSets(cuts.sets) : [];
    state.ranked.slice(0, MAX_ROWS).forEach(function (set, index) {
      var row = document.createElement("tr");
      row.tabIndex = 0;
      var cells = [String(set.rank), set.leaves.map(labelOf).join(" · "), set.text];
      cells.forEach(function (content, i) {
        var cell = document.createElement("td");
        cell.textContent = content;
        if (i !== 1) cell.className = "num";
        row.appendChild(cell);
      });
      row.title = set.leaves.join(", ");
      if (set.spof) {
        var flag = document.createElement("span");
        flag.className = "spof-flag";
        flag.textContent = "SPOF";
        row.children[1].appendChild(flag);
      }
      row.addEventListener("click", function () {
        activateRow(index);
      });
      row.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activateRow(index);
        }
      });
      body.appendChild(row);
    });
    $("cutsets").hidden = state.ranked.length === 0;
    $("cutsets-empty").hidden = state.ranked.length > 0;
    $("cutsets-empty").textContent = cuts ? "No cut sets: the " + P.words(state.doc).top + " cannot occur." : "Not available.";
    $("cutsets-count").textContent = cuts ? cuts.total : "";
    var more = state.ranked.length - MAX_ROWS;
    $("cutsets-more").hidden = more <= 0;
    $("cutsets-more").textContent = more > 0 ? "and " + grouped(more) + " less likely ones" : "";
    markRows();
    for (var i = 0; lit !== null && i < Math.min(state.ranked.length, MAX_ROWS); i++) {
      if (state.ranked[i].leaves.join("\u0000") === lit) activateRow(i);
    }
  }

  function showNotices(results) {
    var list = $("notices");
    list.replaceChildren();
    view.reasons(results).forEach(function (reason) {
      var item = document.createElement("li");
      item.textContent = reason;
      list.appendChild(item);
    });
    list.hidden = list.children.length === 0;
  }

  // Colour the leaves from what is known: the exact part of the latest solve,
  // which is there before its sampling is.
  // An architecture's components stay where the author dragged them, in this
  // browser, per document name; the rest is placed automatically.
  var positions = window.effractorPositions.createStore(browserStorage());
  function browserStorage() {
    try {
      return window.localStorage || null;
    } catch (e) {
      return null;
    }
  }
  renderer.on("move", function (e) {
    if (P.isArchitecture(state.doc)) positions.move(state.doc.name, e.id, e.x, e.y);
  });
  // A firewall's permissions on the canvas, shown or not; this browser
  // remembers which.
  var PERMITS = "effractor.permits";
  var showPermits = (function () {
    try {
      var s = browserStorage();
      return !s || s.getItem(PERMITS) !== "hidden";
    } catch (e) {
      return true;
    }
  })();
  function setPermits(on) {
    showPermits = !!on;
    try {
      var s = browserStorage();
      if (s && showPermits) s.removeItem(PERMITS);
      else if (s) s.setItem(PERMITS, "hidden");
    } catch (e) {
      /* kept for this page only */
    }
    markPermits();
    paint();
  }
  function markPermits() {
    var b = $("permits");
    if (!b) return;
    b.setAttribute("aria-pressed", String(showPermits));
    b.title = "Firewall permissions on flows · click to " + (showPermits ? "hide" : "show");
  }
  if ($("permits")) {
    markPermits();
    $("permits").addEventListener("click", function () {
      setPermits(!showPermits);
    });
  }

  function arrange() {
    positions.clear(state.doc.name);
    paint();
    renderer.fit();
  }

  function paint() {
    if (!state.laid) return;
    if (state.laidView === "attack") return renderer.render(state.laid, {});
    if (P.isArchitecture(state.doc)) return renderer.render(window.effractorPositions.place(state.laid, positions.load(state.doc.name), { permits: showPermits }), {});
    var known = state.exactResults || state.results;
    renderer.render(state.laid, known ? view.leafStyles(known, state.measure) : {});
  }

  // How far the results on screen describe the document on the canvas:
  // "none", "updating" (an older text's), "exact" (sampled parts are an older
  // text's) or "current". What is out of date is shown faded, not removed.
  function mark(level) {
    $("app").setAttribute("data-results", level);
  }

  function notify() {
    listeners.forEach(function (f) {
      f();
    });
  }

  renderer.on("select", function (e) {
    // An architecture's edge is a relationship or a flow of its own.
    if (e.edge && P.isArchitecture(state.doc) && P.selectionExists(state.doc, e.edge, graphOf())) return select(e.edge);
    select(e.id, e.parent);
    markRows();
  });

  // A layout of a document that has since changed is not drawn; a fit it
  // was to make is left to the next one.
  var fitOwed = false;
  function draw(fit) {
    var token = gate.issue("layout");
    fitOwed = fitOwed || !!fit;
    var shown = attackShown();
    var described;
    if (shown) {
      // At most a window of the generated graph, round what is in focus.
      var windowed = AV.describe(state.generated.graph, state.generated.support, { id: state.focus });
      described = windowed.graph;
      state.shownSteps = Object.create(null);
      described.nodes.forEach(function (n) {
        state.shownSteps[n.id] = true;
      });
      state.stepCount = { shown: windowed.shown, total: windowed.total };
    } else {
      state.shownSteps = null;
      state.stepCount = null;
      described = P.isArchitecture(state.doc) ? window.effractorArchitectureView.describe(state.doc, stateWord) : window.effractorGraph.describe(state.doc);
    }
    return layout(described).then(function (laid) {
      if (!gate.accept(token)) return;
      state.laid = laid;
      state.laidView = shown ? "attack" : "document";
      paint();
      if (fitOwed) renderer.fit();
      fitOwed = false;
    });
  }

  function chip(text) {
    $("analysis-chip").textContent = text;
  }

  // A word on the canvas that goes away again: why something did not happen.
  var noteTimer = null;
  function say(text) {
    var note = $("note");
    note.textContent = text;
    note.hidden = false;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(function () {
      note.hidden = true;
    }, 6000);
  }

  function hud(id, text) {
    $(id).textContent = text || " ";
  }

  function describe(problem) {
    var where = problem.line ? " (line " + problem.line + ")" : "";
    return problem.message + where;
  }

  // `fit` on a fresh document; an edit leaves the view where the author put it.
  function loaded(text, doc, fit) {
    // A selection means nothing in another profile, even before select() runs.
    if (state.doc && state.doc.profile !== doc.profile) {
      state.selected = null;
      state.parent = null;
    }
    state.text = text;
    state.doc = doc;
    state.sourceValid = true;
    // The graph of the text before: what a vanished step's selection falls
    // back from. The graph itself is stale the moment the text changes.
    state.lastGraph = graphOf() || state.lastGraph || null;
    state.generated = null;
    state.focus = null;
    if (!P.isArchitecture(doc)) state.mode = "architecture";
    $("app").setAttribute("data-profile", doc.profile);
    $("model-name").textContent = doc.name;
    $("profile-chip").textContent = doc.profile;
    $("hud-p-label").textContent = P.words(doc).p;
    chip(P.capabilities(doc).solve ? analysisLabel(doc.analysis) : "not calculated");
    solvable();
    if (state.mode !== "attack") return showView() && draw(fit);
    return followGraph(fit);
  }

  // The attack graph on screen follows the text: generated again, or given
  // up for the architecture if this text has none. Overtaken by a newer text,
  // it leaves the drawing to that one; overtaken by typing in the source,
  // which brings no text of its own, the canvas shows the architecture until
  // the source is valid again.
  var OVERTAKEN = {};
  function followGraph(fit) {
    return generate().then(function (answer) {
      if (answer.stale && state.sourceValid) return OVERTAKEN;
      if (!answer.ok && !answer.stale) state.mode = "architecture";
      showView();
      return draw(fit);
    });
  }

  function showView() {
    $("app").setAttribute("data-view", attackShown() ? "attack" : "architecture");
    return true;
  }

  // A selection carried over to the text now on the page: a generated step
  // that is gone falls back to the component it was about.
  function carried(id) {
    var step = stepOf(id);
    if (!step || P.selectionExists(state.doc, id, graphOf())) return id;
    var origin = state.lastGraph ? AV.originOf(state.lastGraph, step) : null;
    return origin && P.selectionExists(state.doc, origin, null) ? origin : null;
  }

  // The attack graph of the text on the page, asked of the module with the
  // revision it is about. Resolves to {ok}, or {stale} when the text moved on
  // while it was on its way — the newer text will be generated in its turn.
  function generate() {
    if (!P.capabilities(state.doc).generate) {
      say("an attack graph is generated from an architecture");
      return Promise.resolve({ ok: false });
    }
    if (!state.sourceValid) {
      say("the source is not valid");
      return Promise.resolve({ ok: false });
    }
    var token = gate.issue("generate");
    var text = state.text;
    var revision = state.revision;
    return solver.generate(text, revision).then(function (answer) {
      if (!gate.accept(token) || state.text !== text) return { stale: true };
      if (!answer.ok) {
        refused(answer.diagnostics);
        say(PR.headline(answer.diagnostics) || "no attack graph · " + describe(answer.diagnostics[0]));
        return { ok: false };
      }
      if (answer.ok.revision !== revision || answer.ok.source !== text) return { stale: true };
      state.blockers = null;
      state.generated = { graph: answer.ok.graph, support: answer.ok.support, revision: revision };
      return { ok: true };
    }, function (e) {
      console.error(e);
      say("the calculation crashed and was restarted");
      return { ok: false };
    });
  }

  // What stops the attack graph of the text on the page, as the module said
  // it: attack-ui.js lists it where the graph was asked for.
  function refused(diagnostics) {
    state.blockers = (diagnostics || []).filter(PR.blocks);
  }

  // Architecture or attack graph. The attack graph is generated if the page
  // has none for this text; a step selected there falls back to its
  // component in the architecture. Resolves to whether the view changed to it.
  function setView(mode) {
    // The latest choice wins over a generation still on its way.
    var intent = gate.issue("view");
    // Already there: nothing is drawn again and nothing moves.
    if (mode === state.mode && (mode !== "attack" || attackShown())) return Promise.resolve(true);
    if (mode !== "attack") {
      var step = stepOf(state.selected);
      if (step && graphOf()) state.selected = AV.originOf(graphOf(), step);
      state.mode = "architecture";
      state.focus = null;
      showView();
      return draw(true).then(function () {
        select(state.selected);
        return true;
      });
    }
    var ready = state.generated ? Promise.resolve({ ok: true }) : generate();
    return ready.then(function (answer) {
      if (!answer.ok || !gate.accept(intent)) return false;
      state.mode = "attack";
      state.focus = state.selected;
      showView();
      return draw(true).then(function () {
        select(state.selected);
        return true;
      });
    });
  }

  function solvable() {
    $("solve").disabled = !state.doc || !P.capabilities(state.doc).solve || !state.sourceValid;
  }

  function invalidate() {
    gate.invalidate();
    state.revision = gate.current();
  }

  // What was solved is no longer what is on the canvas.
  function clearResults() {
    state.results = null;
    state.exactResults = null;
    state.chartResults = null;
    state.ranked = [];
    hud("hud-p", "—");
    hud("hud-p-ci", "");
    hud("hud-eal", "—");
    hud("hud-p95", "");
    $("hud-stats").hidden = true;
    $("cutsets-body").replaceChildren();
    $("cutsets").hidden = true;
    $("cutsets-empty").hidden = false;
    $("cutsets-empty").textContent = "Calculate to list them.";
    $("cutsets-count").textContent = "";
    $("cutsets-more").hidden = true;
    $("notices").hidden = true;
    state.activeRow = null;
    renderer.highlight([], "cutset");
    mark("none");
  }

  // A text becomes the document: the one way in, for an edit, an undo, a redo.
  function adopt(text, selectId, parent, fit, beforeCommit) {
    var token = gate.issue("document");
    return solver.parse(text).then(function (parsed) {
      if (!parsed.ok) throw new Error(describe(parsed.diagnostics[0]));
      // A newer text was sent for adoption meanwhile, or the source changed.
      if (!gate.accept(token)) return false;
      if (beforeCommit && !beforeCommit()) return false;
      invalidate();
      state.diagnostics = parsed.diagnostics || [];
      // Another profile is another document, and is fitted as one.
      if (state.doc && state.doc.profile !== parsed.ok.profile) fit = true;
      // Another document starts from nothing; an edit keeps what was said
      // about the last text, faded, until the next solve replaces it.
      if (fit) {
        // Another document: counted, so drafts about the last one can go.
        state.documents++;
        clearResults();
        state.lastSampledMs = null;
      } else if (state.exactResults || state.results) {
        mark("updating");
      }
      store.save(text);
      return loaded(text, parsed.ok, !!fit).then(function (outcome) {
        // A newer text overtook this one's attack graph: the selection, and
        // what is solved, are that text's to settle.
        if (outcome === OVERTAKEN) return true;
        select(carried(selectId), parent);
        autosolve.changed();
        return true;
      });
    });
  }

  // Every edit goes document → serialize → parse, in wasm (spec 7.2): what the
  // canvas shows is always what the canonical text says. An edit the format
  // refuses changes nothing and says why. Resolves to whether it was applied.
  function applyEdit(edit) {
    if (!edit) return Promise.resolve(false);
    var before = state.text;
    return solver.serialize(edit.doc).then(function (written) {
      if (!written.ok) {
        say(describe(written.diagnostics[0]));
        return false;
      }
      if (written.ok === before) {
        say("that changes nothing");
        return false;
      }
      // Into the history only if it is committed: a text overtaken by a
      // newer one on its way through the worker leaves no trace.
      return adopt(written.ok, edit.select, edit.parent, false, function () {
        undoStack.push(state.text);
        return true;
      }).then(function (applied) {
        if (!applied) say("an edit was overtaken by a newer one");
        return applied;
      });
    });
  }

  // The source view's text changed and is not parsed yet: from now on no
  // answer about the document as it was is shown, and nothing is solved,
  // until a text that parses is adopted (or the typing comes back to it).
  // The document itself has not changed, so its layout still stands; what
  // is expired is any text on its way in and any solve of the old text.
  function markSourceDirty() {
    gate.issue("source");
    gate.issue("document");
    gate.issue("solve");
    gate.issue("generate");
    state.sourceValid = false;
    solvable();
  }

  // From the source view: the text as typed. Resolves to what the parser had
  // to say; with no error among it, the text is now the document — as typed,
  // not rewritten, or the caret would jump. Resolves to null when more typing
  // overtook this text: its problems are no longer the ones to show.
  function adoptSource(text) {
    var token = gate.issue("source");
    if (text === state.text) {
      if (!state.sourceValid) {
        state.sourceValid = true;
        solvable();
        autosolve.changed();
        // The attack graph it gave up while the source was not valid.
        if (state.mode === "attack" && !state.generated) followGraph(false).then(notify);
      }
      return Promise.resolve([]);
    }
    return solver.parse(text).then(function (parsed) {
      if (!gate.accept(token)) return null;
      if (!parsed.ok) return parsed.diagnostics;
      return adopt(text, state.selected, state.parent, false, function () {
        if (state.text !== null) undoStack.push(state.text);
        return true;
      }).then(function (applied) {
        return applied ? parsed.diagnostics || [] : null;
      });
    });
  }

  var undoStack = window.effractorEdit.createHistory();
  // One step at a time: a Ctrl+Z repeated while the last is still on its
  // way is ignored, and a step that is overtaken goes back into the history.
  var travelling = false;
  function timeTravel(direction) {
    if (travelling) return;
    var text = undoStack[direction](state.text);
    if (text === null) return;
    travelling = true;
    adopt(text, state.selected, state.parent).then(function (applied) {
      travelling = false;
      // The opposite step with the text that did not arrive restores both lists.
      if (!applied) undoStack[direction === "undo" ? "redo" : "undo"](text);
    }, function (e) {
      travelling = false;
      console.error(e);
    });
  }

  function template(url) {
    return fetch(url).then(function (res) {
      if (!res.ok) throw new Error("could not load " + url);
      return res.text();
    });
  }

  // What was being worked on in this browser, or else an empty document.
  function load() {
    return store
      .load()
      .then(function (kept) {
        if (kept === null || /[?&]new=/.test(location.search)) return template(TEMPLATE);
        // Kept text that no longer parses (an older version's, say), or that
        // this page cannot show, must not lock the page out of itself.
        return solver.parse(kept).then(function (parsed) {
          return parsed.ok ? kept : template(TEMPLATE);
        });
      })
      .then(function (text) {
        return solver.parse(text).then(function (parsed) {
          if (!parsed.ok) throw new Error(describe(parsed.diagnostics[0]));
          state.diagnostics = parsed.diagnostics || [];
          var samples = samplesOverride(location.search);
          if (samples === null) return loaded(text, parsed.ok, true);
          // The edit goes the way every edit will: through the document and
          // back into canonical text.
          parsed.ok.analysis.samples = samples;
          return solver.serialize(parsed.ok).then(function (written) {
            if (!written.ok) throw new Error(describe(written.diagnostics[0]));
            return loaded(written.ok, parsed.ok, true);
          });
        });
      });
  }

  function showExact(begun) {
    state.exactResults = begun;
    // The sampled curves of the last solve stay, faded, until new ones come.
    var before = state.chartResults;
    state.chartResults = window.effractorCharts.exactSnapshot(begun, state.doc);
    if (before && before.sampled) state.chartResults.sampled = before.sampled;
    notify();
    $("hud-stats").hidden = false;
    var exact = begun.exact.available;
    hud("hud-p", exact ? probability(exact.p_top) : "—");
    hud("hud-p-ci", exact ? "exact" : begun.exact.unavailable.reason);
    showCutSets(begun);
    paint();
    mark("exact");
  }

  function showResults(results) {
    var sampled = results.sampled.available;
    if (!sampled) {
      hud("hud-eal", "—");
      hud("hud-p95", results.sampled.unavailable.reason);
      return;
    }
    var ci = sampled.p_top_ci;
    var interval = Math.round(sampled.confidence * 100) + "% CI " + probability(ci.lo) + "–" + probability(ci.hi);
    if (results.exact.available) {
      // The exact value stays the headline; the sample is its cross-check.
      hud("hud-p-ci", "sampled " + probability(sampled.p_top) + " · " + interval);
    } else {
      hud("hud-p", probability(sampled.p_top));
      hud("hud-p-ci", interval);
    }
    hud("hud-eal", sampled.loss ? money(sampled.loss.mean, results.currency) : "—");
    hud("hud-p95", sampled.loss ? "p95 " + money(sampled.loss.p95, results.currency) : "no assets");
  }

  function showAll(results) {
    state.results = results;
    state.chartResults = results;
    showResults(results);
    showNotices(results);
    paint();
    select(state.selected);
    markRows();
    mark("current");
  }

  // A generated graph's results: the target's probability on the canvas, the
  // rest in the panels, which read state.results.
  function showGraph(results) {
    state.results = results;
    state.chartResults = results;
    $("hud-stats").hidden = false;
    var h = GR.headline(results);
    hud("hud-p", h.p === null ? "—" : probability(h.p));
    hud("hud-p-ci", h.qualifier);
    paint();
    select(state.selected);
    mark("current");
  }

  // A state as the pins say it: the catalog's word once it has arrived.
  function stateWord(s) {
    var U = window.effractorArchitectureUi;
    return window.effractorWords && U ? window.effractorWords.state(U.catalog(), s) : s;
  }

  function finished() {
    state.running = false;
    state.explicit = false;
    $("solve").textContent = "Calculate";
  }

  // One solve of the text as it is now; the scheduler (autosolve.js) decides
  // when. Automatic runs sample only while that has been quick; an explicit
  // one always does, and is the one that opens the results.
  function run(explicit) {
    var text = state.text;
    if (!text || !P.capabilities(state.doc).solve || !state.sourceValid) return Promise.resolve();
    var arch = P.isArchitecture(state.doc);
    var revision = state.revision;
    var full = explicit || auto.samplesAutomatically(state.lastSampledMs);
    var token = gate.issue("solve");
    var current = function () {
      return gate.accept(token);
    };
    var exactShown = false;
    state.running = true;
    state.explicit = explicit;
    state.stopped = false;
    chip("calculating…");
    if (explicit) {
      $("solve").textContent = "Cancel";
      if (window.effractorWorkspace) window.effractorWorkspace.open("right");
      if (window.effractorTabs) window.effractorTabs.show("results");
    }
    var started = performance.now();
    return solver
      .solve(text, {
        onExact: function (begun) {
          if (!full) solver.cancel();
          if (!current()) return;
          exactShown = true;
          showExact(begun);
        },
        // A generated graph has no exact part: it begins, then samples.
        onBegin: function () {
          if (!full) solver.cancel();
        },
        onProgress: function (done, total) {
          if (current()) chip("sampling " + grouped(done) + " / " + grouped(total) + " chunks");
        },
      }, arch ? { scenario: "", revision: revision } : undefined)
      .then(function (outcome) {
        finished();
        // A newer text is on its way to being solved: it will say. Typing in
        // the source has no solve of its own until it parses.
        if (!current()) {
          if (!state.sourceValid) chip("not calculated · source not valid");
          return;
        }
        if (outcome.cancelled) {
          if (state.stopped) return chip("cancelled · " + analysisLabel(state.doc.analysis));
          if (!full && exactShown) return chip("exact only · Ctrl+Enter samples");
          if (!full && arch) return chip("not sampled · Ctrl+Enter samples");
          return;
        }
        if (!outcome.result.ok) {
          var problems = outcome.result.diagnostics;
          if (!arch) return chip(describe(problems[0]));
          refused(problems);
          notify();
          return chip(PR.headline(problems) || "not calculated · " + describe(problems[0]));
        }
        // An architecture's answer names the text and revision it is about.
        var answer = outcome.result.ok;
        if (arch && (answer.revision !== revision || answer.source !== text)) return;
        if (arch) state.blockers = null;
        state.lastSampledMs = performance.now() - started;
        if (arch) showGraph(answer.result);
        else showAll(answer);
        chip(analysisLabel(state.doc.analysis));
      })
      .catch(function (e) {
        finished();
        chip("the calculation crashed and was restarted");
        console.error(e);
      });
  }

  // Solve / Ctrl+Enter: sample now, or stop the explicit solve that is running.
  // An automatic run is not the author's to cancel: the next edit replaces it.
  function solve() {
    if (state.running && state.explicit) {
      state.stopped = true;
      return autosolve.stop();
    }
    if (!state.text) return;
    if (!state.sourceValid) return say("the source is not valid");
    autosolve.now();
  }

  window.effractor.state = state;
  window.effractor.renderer = renderer;
  window.effractor.select = select;
  window.effractor.labelOf = labelOf;
  window.effractor.arrange = arrange;
  window.effractor.permits = function () {
    return showPermits;
  };
  window.effractor.setPermits = setPermits;
  // The architecture drawn again as it is: its pins' words have arrived.
  window.effractor.redraw = function () {
    return attackShown() ? Promise.resolve() : draw(false);
  };
  window.effractor.applyEdit = applyEdit;
  window.effractor.say = say;
  window.effractor.format = { money: money, probability: probability };
  window.effractor.adoptSource = adoptSource;
  // A crash with nothing waiting on the worker would otherwise pass unseen.
  solver.onCrash = function (message) {
    console.error("solver crashed:", message);
    say("the calculation crashed and was restarted");
  };
  window.effractor.undo = function () {
    timeTravel("undo");
  };
  window.effractor.redo = function () {
    timeTravel("redo");
  };
  // ---- New, open, save. Another document is an edit like any other: the one
  // it replaces is a Ctrl+Z away, so nothing is asked and nothing is lost.

  function replaceDocument(text, said, isCurrent) {
    return solver.parse(text).then(function (parsed) {
      if (isCurrent && !isCurrent()) return false;
      if (!parsed.ok) return notOpened(text, parsed.diagnostics);
      // In canonical form, as every other text the page holds.
      return solver.serialize(parsed.ok).then(function (written) {
        if (isCurrent && !isCurrent()) return false;
        if (!written.ok) return say("not opened: " + describe(written.diagnostics[0]));
        return adopt(written.ok, null, null, true, function () {
          // Link navigation may have changed during the worker round trips.
          // Check before touching either the document or its undo history.
          if (isCurrent && !isCurrent()) return false;
          if (state.text !== null) undoStack.push(state.text);
          return true;
        }).then(function (applied) {
          if (!applied || (isCurrent && !isCurrent())) return false;
          say(said + " · Ctrl+Z goes back");
          return true;
        });
      });
    }).catch(function (e) {
      if (isCurrent && !isCurrent()) return false;
      console.error(e);
      say("not opened: " + e.message);
    });
  }

  // A text that does not read as a document still opens — in the source
  // view, with every problem listed there, so it can be put right; the
  // canvas keeps the document it had.
  function notOpened(text, diagnostics) {
    var errors = diagnostics.filter(function (d) {
      return d.severity === "error";
    }).length;
    if (!window.effractor.showSourceText) return say("not opened: " + describe(diagnostics[0]));
    window.effractor.showSourceText(text, diagnostics);
    say("not opened · " + errors + (errors === 1 ? " problem" : " problems") + " · listed under the source");
    return false;
  }

  function saveFile() {
    if (state.text === null) return;
    var url = URL.createObjectURL(new Blob([state.text], { type: "text/yaml" }));
    var a = document.createElement("a");
    a.href = url;
    a.download = window.effractorStore.fileName(state.doc.name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
  }

  var fileActions = {
    new: function () {
      template(new URL("templates/new.yaml", assets).href).then(function (text) {
        replaceDocument(text, "new fault tree");
      });
    },
    "new-attack": function () {
      template(new URL("templates/new-attack.yaml", assets).href).then(function (text) {
        replaceDocument(text, "new attack tree");
      });
    },
    "new-architecture": function () {
      template(new URL("templates/new-architecture.yaml", assets).href).then(function (text) {
        replaceDocument(text, "new architecture");
      });
    },
    open: function () {
      $("open-file").click();
    },
    save: saveFile,
  };

  $("open-file").addEventListener("change", function () {
    var file = $("open-file").files[0];
    $("open-file").value = ""; // the same file again is a change again
    if (!file) return;
    file.text().then(function (text) {
      replaceDocument(text, "opened " + file.name);
    });
  });

  function closeFileMenu() {
    $("file-menu").hidden = true;
    $("file").setAttribute("aria-expanded", "false");
  }
  $("file").addEventListener("click", function () {
    var menu = $("file-menu");
    if (!menu.hidden) return closeFileMenu();
    var box = $("file").getBoundingClientRect();
    menu.style.setProperty("--menu-x", box.left + "px");
    menu.style.setProperty("--menu-y", box.bottom + 4 + "px");
    menu.hidden = false;
    $("file").setAttribute("aria-expanded", "true");
  });
  document.querySelectorAll("[data-file]").forEach(function (button) {
    button.addEventListener("click", function () {
      closeFileMenu();
      fileActions[button.getAttribute("data-file")]();
    });
  });
  document.addEventListener("pointerdown", function (e) {
    if (!$("file-menu").contains(e.target) && !$("file").contains(e.target)) closeFileMenu();
  });

  window.effractor.canUndo = undoStack.canUndo;
  window.effractor.canRedo = undoStack.canRedo;
  window.effractor.solve = solve;
  window.effractor.onChange = function (f) {
    listeners.push(f);
  };

  var MEASURES = [["fussell_vesely", "Fussell-Vesely"], ["birnbaum", "Birnbaum"]];
  function setMeasure(measure) {
    state.measure = measure;
    var name = measure === "birnbaum" ? "Birnbaum" : "Fussell-Vesely";
    $("measure").textContent = name;
    $("measure").title = view.HINTS[name] + " · click to switch";
    paint();
  }
  // A click switches; a right-click offers both by name.
  $("measure").addEventListener("contextmenu", function (e) {
    if (!window.effractor.showMenu) return;
    e.preventDefault();
    window.effractor.showMenu(MEASURES.map(function (m) {
      return [m[1], m[0] === state.measure ? "✓" : "", function () { setMeasure(m[0]); }];
    }), e.clientX, e.clientY);
  });
  $("measure").addEventListener("click", function () {
    setMeasure(state.measure === "fussell_vesely" ? "birnbaum" : "fussell_vesely");
  });

  $("solve").addEventListener("click", solve);
  $("fit").addEventListener("click", renderer.fit);
  $("zoom-in").addEventListener("click", function () {
    renderer.zoomBy(1.25);
  });
  $("zoom-out").addEventListener("click", function () {
    renderer.zoomBy(0.8);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      solve();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "o")) {
      e.preventDefault();
      fileActions[e.key === "s" ? "save" : "open"]();
    } else if (e.key === "Escape") {
      closeFileMenu();
    } else if (e.key === "f" && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      renderer.fit();
    } else if ((e.key === "+" || e.key === "-") && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      renderer.zoomBy(e.key === "+" ? 1.25 : 0.8);
    }
  });

  window.effractor.replaceDocument = replaceDocument;
  window.effractor.markSourceDirty = markSourceDirty;
  window.effractor.revisions = gate;
  // Architecture or attack graph (setView); `generate` asks for the graph
  // of the text on the page without changing the view.
  window.effractor.setMode = function (mode) {
    return setView(mode).then(function (changed) {
      notify();
      return changed;
    });
  };
  window.effractor.generate = generate;
  window.effractor.ready = load().then(function () {
    notify();
    autosolve.changed();
  }).catch(function (e) {
    chip("no document: " + e.message);
    console.error(e);
  });
})();
