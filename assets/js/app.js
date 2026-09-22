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
  // ?new=attack-tree an attack tree. No example ships.
  function templateName(search) {
    var m = /[?&]new=([a-z-]+)(&|$)/.exec(search);
    return m && m[1] === "attack-tree" ? "new-attack" : "new";
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

  var state = { text: null, doc: null, running: false, selected: null, parent: null, parentChosen: false, laid: null, results: null, ranked: [], measure: "fussell_vesely", activeRow: null, lastSampledMs: null };
  var view = window.effractorResults;
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
  function select(id, parent) {
    state.selected = id && Object.prototype.hasOwnProperty.call(state.doc.nodes, id) ? id : null;
    var parents = state.selected ? window.effractorEdit.parentsOf(state.doc, state.selected) : [];
    // `parentChosen`: the edge was named (a tree row, an arrow key), not guessed.
    state.parentChosen = parents.indexOf(parent) >= 0;
    state.parent = state.parentChosen ? parent : parents[0] || null;
    renderer.highlight(state.selected ? [state.selected] : [], "selected");
    // The edge a shared node was reached along, when that was said: it is what
    // Del and Unlink act on.
    renderer.highlight(state.selected && state.parentChosen && parents.length > 1 ? [state.selected, state.parent] : [], "via");
    var facts = $("selected-facts");
    facts.replaceChildren();
    facts.hidden = !state.selected;
    // The inspector on the canvas is the selection made visible: there while
    // something is selected, gone when nothing is. No panel opens for it.
    $("inspector").hidden = !state.selected;
    $("inspector-name").textContent = state.selected ? labelOf(state.selected) : "";
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
    $("cutsets-empty").textContent = cuts ? "No cut sets: the top event cannot occur." : "Not available.";
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
  function paint() {
    if (!state.laid) return;
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
    select(e.id, e.parent);
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
    $("cutsets-empty").textContent = "Solve to list them.";
    $("cutsets-count").textContent = "";
    $("cutsets-more").hidden = true;
    $("notices").hidden = true;
    state.activeRow = null;
    renderer.highlight([], "cutset");
    mark("none");
  }

  // A text becomes the document: the one way in, for an edit, an undo, a redo.
  function adopt(text, selectId, parent, fit, beforeCommit) {
    return solver.parse(text).then(function (parsed) {
      if (!parsed.ok) throw new Error(describe(parsed.diagnostics[0]));
      if (beforeCommit && !beforeCommit()) return false;
      // Another document starts from nothing; an edit keeps what was said
      // about the last text, faded, until the next solve replaces it.
      if (fit) {
        clearResults();
        state.lastSampledMs = null;
      } else if (state.exactResults || state.results) {
        mark("updating");
      }
      store.save(text);
      return loaded(text, parsed.ok, !!fit).then(function () {
        select(selectId, parent);
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
      undoStack.push(before);
      return adopt(written.ok, edit.select, edit.parent).then(function () {
        return true;
      });
    });
  }

  // From the source view: the text as typed. Resolves to what the parser had
  // to say; with no error among it, the text is now the document — as typed,
  // not rewritten, or the caret would jump.
  // Until the architecture editor exists, an architecture parses but cannot be
  // shown: everything on this page reads `doc.nodes`. The current document
  // stays, and the page says why. The architecture-editor roadmap item
  // replaces this guard with the editor.
  var UNAVAILABLE = "Architecture editor unavailable";
  function unavailable(doc) {
    return doc.profile === "architecture";
  }

  function adoptSource(text) {
    if (text === state.text) return Promise.resolve([]);
    return solver.parse(text).then(function (parsed) {
      if (!parsed.ok) return parsed.diagnostics;
      if (unavailable(parsed.ok)) return [{ severity: "error", code: "unsupported", path: "profile", message: UNAVAILABLE }];
      if (state.text !== null) undoStack.push(state.text);
      return adopt(text, state.selected, state.parent).then(function () {
        return parsed.diagnostics || [];
      });
    });
  }

  var undoStack = window.effractorEdit.createHistory();
  function timeTravel(direction) {
    var text = undoStack[direction](state.text);
    if (text !== null) adopt(text, state.selected, state.parent);
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
          return parsed.ok && !unavailable(parsed.ok) ? kept : template(TEMPLATE);
        });
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

  function finished() {
    state.running = false;
    state.explicit = false;
    $("solve").textContent = "Solve";
  }

  // One solve of the text as it is now; the scheduler (autosolve.js) decides
  // when. Automatic runs sample only while that has been quick; an explicit
  // one always does, and is the one that opens the results.
  function run(explicit) {
    var text = state.text;
    if (!text) return Promise.resolve();
    var full = explicit || auto.samplesAutomatically(state.lastSampledMs);
    var current = function () {
      return state.text === text;
    };
    var exactShown = false;
    state.running = true;
    state.explicit = explicit;
    state.stopped = false;
    chip("solving…");
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
        onProgress: function (done, total) {
          if (current()) chip("sampling " + grouped(done) + " / " + grouped(total) + " chunks");
        },
      })
      .then(function (outcome) {
        finished();
        // A newer text is on its way to being solved: it will say.
        if (!current()) return;
        if (outcome.cancelled) {
          if (state.stopped) return chip("cancelled · " + analysisLabel(state.doc.analysis));
          if (!full && exactShown) return chip("exact only · Ctrl+Enter samples");
          return;
        }
        if (!outcome.result.ok) return chip(describe(outcome.result.diagnostics[0]));
        state.lastSampledMs = performance.now() - started;
        showAll(outcome.result.ok);
        chip(analysisLabel(state.doc.analysis));
      })
      .catch(function (e) {
        finished();
        chip("the solver crashed and was restarted");
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
    if (state.text) autosolve.now();
  }

  window.effractor.state = state;
  window.effractor.renderer = renderer;
  window.effractor.select = select;
  window.effractor.applyEdit = applyEdit;
  window.effractor.say = say;
  window.effractor.format = { money: money, probability: probability };
  window.effractor.adoptSource = adoptSource;
  // A crash with nothing waiting on the worker would otherwise pass unseen.
  solver.onCrash = function (message) {
    console.error("solver crashed:", message);
    say("the solver crashed and was restarted");
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
      if (!parsed.ok) return say("not opened: " + describe(parsed.diagnostics[0]));
      if (unavailable(parsed.ok)) {
        say("not opened: " + UNAVAILABLE);
        return false;
      }
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
  window.effractor.ready = load().then(function () {
    notify();
    autosolve.changed();
  }).catch(function (e) {
    chip("no document: " + e.message);
    console.error(e);
  });
})();
