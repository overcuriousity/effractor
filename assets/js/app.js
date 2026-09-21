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

  // ?example=office opens the attack tree, ?example=new and new-attack an empty
  // one to build in; anything else, the reference tree.
  var EXAMPLES = ["webserver", "office", "new", "new-attack"];

  function exampleName(search) {
    var m = /[?&]example=([a-z0-9-]+)(&|$)/.exec(search);
    return m && EXAMPLES.indexOf(m[1]) >= 0 ? m[1] : "webserver";
  }

  if (typeof module !== "undefined") {
    module.exports = { exampleName: exampleName, grouped: grouped, probability: probability, money: money, analysisLabel: analysisLabel, samplesOverride: samplesOverride };
  }
  if (typeof document === "undefined") return;

  var EXAMPLE = "/assets/examples/" + exampleName(location.search) + ".yaml";
  var $ = function (id) {
    return document.getElementById(id);
  };
  var solver = window.createSolver(function () {
    return new Worker("/assets/js/solver-worker.js");
  });
  // For the console: effractor.solver.crash() shows the recovery path.
  window.effractor = { solver: solver };
  var listeners = []; // told after every load and every selection

  var state = { text: null, doc: null, running: false, selected: null, parent: null, laid: null, results: null, ranked: [], measure: "fussell_vesely", activeRow: null, lastExactMs: null };
  var view = window.effractorResults;
  var MAX_ROWS = 200; // a table is for reading; ten thousand rows are not read

  var renderer = window.effractorRenderer.createSvgRenderer(document);
  var layout = window.effractorLayout.createLayout();
  renderer.mount($("canvas"));

  function fact(list, term, value) {
    var dt = document.createElement("dt");
    var dd = document.createElement("dd");
    dt.textContent = term;
    dd.textContent = value;
    list.appendChild(dt);
    list.appendChild(dd);
    return dd;
  }

  // `parent` is the edge the selection came along, which is what Enter, Del
  // and the arrows act on; without one it is the node's first parent.
  function select(id, parent) {
    state.selected = id && Object.prototype.hasOwnProperty.call(state.doc.nodes, id) ? id : null;
    var parents = state.selected ? window.effractorEdit.parentsOf(state.doc, state.selected) : [];
    state.parent = parents.indexOf(parent) >= 0 ? parent : parents[0] || null;
    renderer.highlight(state.selected ? [state.selected] : [], "selected");
    var facts = $("selected-facts");
    facts.replaceChildren();
    facts.hidden = !state.selected;
    $("selected-empty").hidden = !!state.selected;
    notify();
    if (!state.selected) return;
    view.nodeFacts(state.results, state.selected).forEach(function (f) {
      fact(facts, f[0], f[1]).classList.add("num");
    });
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
    var node = state.doc.nodes[id];
    return node && node.label ? node.label : id;
  }

  function showCutSets(results) {
    var body = $("cutsets-body");
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
    $("cutsets-empty").textContent = cuts ? "No cut sets: the top event cannot occur." : "Not available.";
    $("cutsets-count").textContent = cuts ? cuts.total : "";
    var more = state.ranked.length - MAX_ROWS;
    $("cutsets-more").hidden = more <= 0;
    $("cutsets-more").textContent = more > 0 ? "and " + grouped(more) + " less likely ones" : "";
    markRows();
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

  // Colour the leaves from what is known: `results` is a finished solve, or
  // the exact part of one that is still sampling.
  function paint() {
    if (!state.laid) return;
    renderer.render(state.laid, state.results ? view.leafStyles(state.results, state.measure) : {});
  }

  function notify() {
    listeners.forEach(function (f) {
      f();
    });
  }

  renderer.on("select", function (e) {
    select(e.id);
    markRows();
  });

  function draw(fit) {
    return layout(window.effractorGraph.describe(state.doc)).then(function (laid) {
      state.laid = laid;
      paint();
      if (fit) renderer.fit();
    });
  }

  function chip(text) {
    $("analysis-chip").textContent = text;
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
    state.text = text;
    state.doc = doc;
    $("model-name").textContent = doc.name;
    $("profile-chip").textContent = doc.profile;
    chip(analysisLabel(doc.analysis));
    $("solve").disabled = false;
    return draw(fit);
  }

  // What was solved is no longer what is on the canvas.
  function clearResults() {
    state.results = null;
    state.ranked = [];
    hud("hud-p", "—");
    hud("hud-p-ci", "");
    hud("hud-eal", "—");
    hud("hud-p95", "");
    $("cutsets-body").replaceChildren();
    $("cutsets").hidden = true;
    $("cutsets-empty").hidden = false;
    $("cutsets-empty").textContent = "Solve to list them.";
    $("cutsets-count").textContent = "";
    $("cutsets-more").hidden = true;
    $("notices").hidden = true;
    renderer.highlight([], "cutset");
  }

  // A text becomes the document: the one way in, for an edit, an undo, a redo.
  function adopt(text, selectId, parent) {
    return solver.parse(text).then(function (parsed) {
      if (!parsed.ok) throw new Error(describe(parsed.diagnostics[0]));
      clearResults();
      return loaded(text, parsed.ok, false).then(function () {
        select(selectId, parent);
        documentChanged();
      });
    });
  }

  // Every edit goes document → serialize → parse, in wasm (spec 7.2): what the
  // canvas shows is always what the canonical text says. An edit the format
  // refuses changes nothing and says why. Resolves to whether it was applied.
  function applyEdit(edit) {
    if (!edit || state.running) return Promise.resolve(false);
    var before = state.text;
    return solver.serialize(edit.doc).then(function (written) {
      if (!written.ok) {
        chip(describe(written.diagnostics[0]));
        return false;
      }
      if (written.ok === before) return false;
      undoStack.push(before);
      return adopt(written.ok, edit.select, edit.parent).then(function () {
        return true;
      });
    });
  }

  var undoStack = window.effractorEdit.createHistory();
  function timeTravel(direction) {
    var text = undoStack[direction](state.text);
    if (text !== null) adopt(text, state.selected, state.parent);
  }

  function load() {
    return fetch(EXAMPLE)
      .then(function (res) {
        if (!res.ok) throw new Error("could not load " + EXAMPLE);
        return res.text();
      })
      .then(function (text) {
        return solver.parse(text).then(function (parsed) {
          if (!parsed.ok) throw new Error(describe(parsed.diagnostics[0]));
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
    var exact = begun.exact.available;
    hud("hud-p", exact ? probability(exact.p_top) : "—");
    hud("hud-p-ci", exact ? "exact" : begun.exact.unavailable.reason);
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
    showResults(results);
    showCutSets(results);
    showNotices(results);
    paint();
    select(state.selected);
    markRows();
  }

  function finished() {
    state.running = false;
    $("solve").textContent = "Solve";
  }

  function solve() {
    if (state.running) return solver.cancel();
    if (!state.text) return;
    state.running = true;
    $("solve").textContent = "Cancel";
    chip("solving…");
    var started = performance.now();
    solver
      .solve(state.text, {
        onExact: function (begun) {
          state.lastExactMs = performance.now() - started;
          showExact(begun);
          // The cut sets are exact too: list them while the sampling runs.
          showCutSets(begun);
        },
        onProgress: function (done, total) {
          chip("sampling " + grouped(done) + " / " + grouped(total) + " chunks");
        },
      })
      .then(function (outcome) {
        finished();
        if (outcome.cancelled) return chip("cancelled · " + analysisLabel(state.doc.analysis));
        if (!outcome.result.ok) return chip(describe(outcome.result.diagnostics[0]));
        showAll(outcome.result.ok);
        chip(analysisLabel(state.doc.analysis));
      })
      .catch(function (e) {
        finished();
        chip("the solver crashed and was restarted");
        console.error(e);
      });
  }

  // After an edit: refresh what is exact, if the last time showed that to be
  // cheap. Sampled numbers wait for an explicit Solve. (Nothing edits yet; the
  // editor calls this.)
  function documentChanged() {
    if (state.running || !view.shouldAutoSolve(state.lastExactMs)) return;
    var started = performance.now();
    solver.exact(state.text).then(function (answer) {
      if (!answer.ok) return;
      state.lastExactMs = performance.now() - started;
      showExact(answer.ok);
      showCutSets(answer.ok);
    }, console.error);
  }
  window.effractor.state = state;
  window.effractor.renderer = renderer;
  window.effractor.select = select;
  window.effractor.applyEdit = applyEdit;
  window.effractor.undo = function () {
    timeTravel("undo");
  };
  window.effractor.redo = function () {
    timeTravel("redo");
  };
  window.effractor.onChange = function (f) {
    listeners.push(f);
  };

  $("measure").addEventListener("click", function () {
    state.measure = state.measure === "fussell_vesely" ? "birnbaum" : "fussell_vesely";
    $("measure").textContent = state.measure === "birnbaum" ? "Birnbaum" : "Fussell-Vesely";
    paint();
  });

  $("solve").addEventListener("click", solve);
  $("fit").addEventListener("click", renderer.fit);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      solve();
    } else if (e.key === "f" && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) {
      renderer.fit();
    }
  });

  load().then(notify).catch(function (e) {
    chip("no document: " + e.message);
    console.error(e);
  });
})();
