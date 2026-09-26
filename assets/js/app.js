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

  // ?samples=N solves the loaded document with N samples: a run long enough
  // to watch and to cancel.
  function samplesOverride(search) {
    var m = /[?&]samples=(\d+)(&|$)/.exec(search);
    var n = m ? Number(m[1]) : 0;
    return n >= 1 && Number.isSafeInteger(n) ? n : null;
  }

  // The three modes, in the order of their tabs, and the empty document each
  // starts from. No example ships.
  var MODES = ["fault-tree", "attack-tree", "architecture"];
  var TEMPLATES = { "fault-tree": "new", "attack-tree": "new-attack", architecture: "new-architecture" };
  var MODE_NAMES = { "fault-tree": "Fault tree", "attack-tree": "Attack tree", architecture: "Architecture" };

  // ?new=attack-tree opens an empty attack tree, ?new=architecture an empty
  // architecture, ?new=fault-tree an empty fault tree; anything else, null.
  function newProfile(search) {
    var m = /[?&]new=([a-z-]+)(&|$)/.exec(search);
    return m && TEMPLATES[m[1]] && Object.prototype.hasOwnProperty.call(TEMPLATES, m[1]) ? m[1] : null;
  }

  // The address without ?new=: a reload goes back to what was worked on,
  // not to another empty document.
  function withoutNew(search) {
    var rest = search.replace(/^\?/, "").split("&").filter(function (part) {
      return part !== "" && !/^new=/.test(part);
    });
    return rest.length ? "?" + rest.join("&") : "";
  }

  // A field that takes typing: a textarea, or an input that is not a switch,
  // a slider or a button.
  function textField(el) {
    return !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|number|email|url|tel|password)$/.test(el.type || "text")));
  }

  // A form built again (`build`) under the author's hands — a solve arrived,
  // another field committed. The field being typed in keeps its focus and,
  // for the same `key` (what the form is about) and where it is built with
  // what it was built with before, the text not yet committed and the caret.
  var builtWith = new WeakMap();
  var keyOfForm = new WeakMap();
  function rebuild(document, box, key, build) {
    var active = document.activeElement && document.activeElement.id && box.contains(document.activeElement) ? document.activeElement : null;
    var typing = textField(active) && keyOfForm.get(box) === key && builtWith.has(active) && active.value !== builtWith.get(active)
      ? { value: active.value, base: builtWith.get(active), start: active.selectionStart, end: active.selectionEnd }
      : null;
    build();
    keyOfForm.set(box, key);
    box.querySelectorAll("input, textarea").forEach(function (field) {
      builtWith.set(field, field.value);
    });
    var again = active ? document.getElementById(active.id) : null;
    if (!again || !box.contains(again)) return;
    again.focus();
    if (!typing || !textField(again) || again.value !== typing.base) return;
    again.value = typing.value;
    try {
      again.setSelectionRange(typing.start, typing.end);
    } catch (e) {
      /* a number field has no caret to set */
    }
    // A value set here is not the author's typing to a browser, which
    // then sends no change on leaving the field unless more is typed:
    // leaving it commits what was carried over all the same.
    var changed = false;
    again.addEventListener("change", function () {
      changed = true;
    }, { once: true });
    again.addEventListener("blur", function () {
      if (!changed && again.value !== typing.base) again.dispatchEvent(new Event("change"));
    }, { once: true });
  }

  // A key that is not the canvas's or the tree's: typed into a field, on a
  // link, in a menu, a chart or a table, or with a dialog open over the page.
  function keyElsewhere(document, e) {
    var t = e.target;
    return /^(INPUT|TEXTAREA|SELECT|A)$/.test(t.tagName) ||
      !!(t.closest && t.closest(".menu, .analysis-chart, .chart-table, .cutsets, summary")) ||
      !!document.querySelector("dialog[open]");
  }

  if (typeof module !== "undefined") {
    module.exports = { MODES: MODES, newProfile: newProfile, withoutNew: withoutNew, textField: textField, rebuild: rebuild, keyElsewhere: keyElsewhere, grouped: grouped, probability: probability, money: money, analysisLabel: analysisLabel, samplesOverride: samplesOverride };
  }
  if (typeof document === "undefined") return;

  // Resolve from this script, including on /s/id and repository Pages URLs.
  var assets = new URL("../", document.currentScript.src);
  function templateOf(profile) {
    return new URL("templates/" + TEMPLATES[profile] + ".yaml", assets).href;
  }
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
  // Told every accepted text with where it came from (accounts: sync.js).
  var textListeners = [];
  var replacing = null; // the origin of the replacement being adopted
  var firstText = null; // the page's first text, for listeners that come later

  var P = window.effractorProfiles;
  // Every asynchronous answer (parse, layout, solve) carries a token of the
  // revision it was asked about; one that arrives after an edit, an undo,
  // another file or new source text is dropped (revisions.js).
  var gate = window.effractorRevisions.create();
  // `mode` is the architecture's view: "architecture" or "attack", its
  // generated graph. `generated`: {graph, support, revision} of the text on
  // the page, or null. `sourceValid`: the source view's text is the document's.
  var state = { text: null, doc: null, running: false, selected: null, parent: null, parentChosen: false, laid: null, results: null, ranked: [], measure: "fussell_vesely", activeRow: null, lastSampledMs: null, revision: gate.current(), sourceValid: true, mode: "architecture", generated: null, blockers: null, diagnostics: [], documents: 0, scenario: "", hidden: null, bundles: null, picked: [], placed: null };
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

  // Several at once (clustering spec §3), in the architecture view only:
  // `ids` qualified components or clusters; `add` keeps what was picked.
  function pick(ids, add) {
    if (!P.isArchitecture(state.doc) || attackShown()) return;
    var next = add ? window.effractorClusters.pickable(state.picked) : [];
    ids.forEach(function (id) {
      if (/^(entity|cluster)\//.test(id) && P.selectionExists(state.doc, id, null) && next.indexOf(id) < 0) next.push(id);
    });
    setPicked(next);
  }
  function togglePick(id) {
    // A line selected before is not one of several.
    var next = window.effractorClusters.pickable(state.picked);
    var at = next.indexOf(id);
    if (at >= 0) next.splice(at, 1);
    else if (P.selectionExists(state.doc, id, null)) next.push(id);
    setPicked(next);
  }
  function setPicked(list) {
    state.picked = list;
    select(list.length === 1 ? list[0] : null, undefined, true);
  }

  // Where `id` is drawn: a member of a closed cluster is drawn as the cluster.
  function shown(id) {
    var q = P.qualified(id);
    return q && q.kind === "entity" && state.hidden && Object.prototype.hasOwnProperty.call(state.hidden, q.id) ? state.hidden[q.id] : id;
  }

  // `keepPicked`: the several selected stay (pick() calls with it).
  function select(id, parent, keepPicked) {
    var arch = P.isArchitecture(state.doc);
    state.selected = P.selectionExists(state.doc, id, graphOf()) ? id : null;
    if (!keepPicked) state.picked = state.selected ? [state.selected] : [];
    var parents = state.selected && !arch ? window.effractorEdit.parentsOf(state.doc, state.selected) : [];
    // `parentChosen`: the edge was named (a tree row, an arrow key), not guessed.
    state.parentChosen = parents.indexOf(parent) >= 0;
    state.parent = state.parentChosen ? parent : parents[0] || null;
    // An open cluster selected lights its members too, so they move together.
    // A line inside a merged one lights the merged line.
    renderer.highlight(window.effractorClusters.lit(state.doc, state.picked).map(shown).map(function (id) {
      return window.effractorClusters.drawnLine(state.bundles, id);
    }), "selected");
    // A selected flow shows where it goes: the networks and routers on its
    // route, which its line from end to end does not.
    var flow = arch && state.selected && state.selected.indexOf("flow/") === 0 ? state.selected.slice(5) : null;
    renderer.highlight(flow && !attackShown() ? window.effractorArchitectureView.route(state.doc, flow).map(shown) : [], "route");
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
    $("inspector").hidden = !state.selected && state.picked.length < 2;
    // The inspector floats over the canvas: what it would cover is panned
    // into view, and nothing else moves.
    if (state.selected) renderer.reveal(shown(state.selected), $("inspector").getBoundingClientRect().width + 8);
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

  // The same selection shown again (new numbers): the several selected, and
  // an edge that was named, stay.
  function reselect() {
    select(state.selected, state.parentChosen ? state.parent : undefined, true);
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
      if (q && q.kind === "cluster" && own(state.doc.clusters, q.id)) return window.effractorClusters.label(state.doc, q.id);
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
    if (P.isArchitecture(state.doc)) positions.moveAll(state.doc.name, e.places);
  });
  renderer.on("pick", function (e) {
    pick(e.ids, e.add);
  });

  // {id: {x, y}}, or null to forget one; one write.
  function putPositions(map) {
    positions.moveAll(state.doc.name, map);
  }
  // A canvas switch this browser remembers (`key` in localStorage, "hidden"
  // when off; on unless said), with its bottom-bar button `button`, if the
  // page has one. Switched, the canvas is drawn again.
  function rememberedSwitch(key, button, title) {
    var on = (function () {
      try {
        var s = browserStorage();
        return !s || s.getItem(key) !== "hidden";
      } catch (e) {
        return true;
      }
    })();
    function mark() {
      var b = $(button);
      if (!b) return;
      b.setAttribute("aria-pressed", String(on));
      b.title = title + " · click to " + (on ? "hide" : "show");
    }
    function set(value) {
      on = !!value;
      try {
        var s = browserStorage();
        if (s && on) s.removeItem(key);
        else if (s) s.setItem(key, "hidden");
      } catch (e) {
        /* kept for this page only */
      }
      mark();
      paint();
    }
    if ($(button)) {
      mark();
      $(button).addEventListener("click", function () {
        set(!on);
      });
    }
    return { on: function () { return on; }, set: set };
  }
  // A firewall's permissions on the canvas, shown or not.
  var permits = rememberedSwitch("effractor.permits", "permits", "Firewall permissions on flows");
  // Open clusters' outlines on the canvas, shown or not (owner, 2026-09-25).
  var outlines = rememberedSwitch("effractor.outlines", "outlines", "Outlines of open clusters");

  function arrange() {
    positions.clear(state.doc.name);
    paint();
    renderer.fit();
  }

  var SPREAD_GAP = 24; // px clear round an opened cluster

  // The architecture last painted, for the glide from it: which document it
  // was (state.documents when laid out) and where its clustered members
  // were drawn.
  var painted = null;
  // Places set by hand for the change on its way (cluster-ui.js: a member
  // dropped out of its stack), which opening in place leaves where they are.
  var handPlaced = null;
  function paint() {
    if (!state.laid) return;
    if (state.laidView === "attack") {
      painted = null;
      return renderer.render(state.laid, {});
    }
    if (P.isArchitecture(state.doc)) {
      var C = window.effractorClusters;
      var Pos = window.effractorPositions;
      // The same document glides to its new drawing; another one — even of
      // the same name — just appears.
      var motion = painted && painted.document === state.laidDocument ? C.transitions(painted.hidden, state.hidden) : null;
      painted = { document: state.laidDocument, hidden: state.hidden };
      var stored = positions.load(state.doc.name);
      var kept = {};
      var keep = function (places) {
        Object.keys(places).forEach(function (id) {
          kept[id] = stored[id] = { x: Math.round(places[id].x), y: Math.round(places[id].y) };
        });
      };
      var opened = motion ? C.opened(motion) : [];
      var closing = motion && Object.keys(motion.origins).some(function (id) {
        return id.indexOf("cluster/") === 0;
      });
      // Clusters closing or opening, by an edit, an undo or the source: in
      // place, from where things stood when last drawn.
      if ((opened.length || closing) && state.placed) {
        var prev = {};
        state.placed.nodes.forEach(function (n) {
          prev[n.id] = Object.prototype.hasOwnProperty.call(stored, n.id) ? stored[n.id] : { x: n.x, y: n.y };
        });
        keep(C.inPlace(motion, prev, stored, handPlaced));
        // The rest stays where it was, not where the new layout puts it.
        keep(C.held(state.placed.nodes, state.laid.nodes, stored));
      }
      var options = { permits: permits.on(), outlines: outlines.on() };
      // A cluster that just opened pushes what it now covers out of its way,
      // and those places are kept.
      if (opened.length) keep(C.spread(Pos.place(state.laid, stored, { permits: false, outlines: true }), opened, SPREAD_GAP));
      if (Object.keys(kept).length) positions.moveAll(state.doc.name, kept);
      state.placed = Pos.place(state.laid, stored, options);
      return renderer.render(state.placed, {}, motion);
    }
    painted = null;
    // Colour the leaves from what is known: the exact part of the latest
    // solve, which is there before its sampling is.
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
    // A merged line holds several: cluster-ui.js asks which.
    if (e.edge && /^(links|flows|permits)\//.test(e.edge)) return;
    // Ctrl-click adds a component or cluster to the selection, or takes it out.
    if (e.ctrl && e.id && !e.edge && P.isArchitecture(state.doc) && !attackShown() && /^(entity|cluster)\//.test(e.id)) return togglePick(e.id);
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
    var documentNo = state.documents;
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
      // Which document it draws: a paint before the next layout arrives is
      // still of this one.
      state.laidDocument = documentNo;
      // Where each member of a closed cluster is drawn, and what merged lines
      // hold: this layout's, set with it.
      state.hidden = !shown && described.hidden ? described.hidden : null;
      state.bundles = !shown && described.bundles ? described.bundles : null;
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
  // With actions ([label, fn] pairs) it carries buttons, e.g. Undo; sticky
  // notes stay until one is used or something else is said.
  var noteTimer = null;
  function say(text, actions, sticky) {
    var note = $("note");
    note.textContent = text;
    (actions || []).forEach(function (action) {
      note.appendChild(document.createTextNode(" · "));
      var b = document.createElement("button");
      b.type = "button";
      b.className = "link-button";
      b.textContent = action[0];
      b.addEventListener("click", function () {
        note.hidden = true;
        action[1]();
      });
      note.appendChild(b);
    });
    note.hidden = false;
    clearTimeout(noteTimer);
    if (!sticky) noteTimer = setTimeout(function () { note.hidden = true; }, 6000);
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
    slots[doc.profile] = text;
    state.sourceValid = true;
    // The comparison is workspace state: it lasts while the document names it.
    if (!hasScenario(doc, state.scenario)) state.scenario = "";
    // The graph of the text before: what a vanished step's selection falls
    // back from. The graph itself is stale the moment the text changes.
    state.lastGraph = graphOf() || state.lastGraph || null;
    state.generated = null;
    state.focus = null;
    if (!P.isArchitecture(doc)) state.mode = "architecture";
    $("app").setAttribute("data-profile", doc.profile);
    $("model-name").textContent = doc.name;
    MODES.forEach(function (mode) {
      $("mode-" + mode).setAttribute("aria-checked", String(mode === doc.profile));
    });
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

  // Kept in this browser, and told to its other tabs; a browser that keeps
  // nothing (a private window, full storage) is said so, once.
  var unkeptSaid = false;
  function keep(text, profile) {
    Promise.resolve(store.save(text, profile)).then(function (ok) {
      if (ok !== false) return tabs && tabs.postMessage({ profile: profile, text: text });
      if (!unkeptSaid) say("not kept in this browser · Ctrl+S saves a file", null, true);
      unkeptSaid = true;
    });
    store.setMode(profile);
  }

  // Another tab of the page keeps its texts in the same browser. A text it
  // kept in the mode shown here is taken over — the one it replaces a Ctrl+Z
  // away — so that neither tab writes over the other's work unseen. Source
  // text being typed here is not swept away: the author is asked.
  var tabs = typeof BroadcastChannel === "function" ? new BroadcastChannel("effractor") : null;
  var fromTab = false;
  if (tabs) {
    tabs.onmessage = function (e) {
      var m = e.data;
      if (!m || typeof m.text !== "string" || !Object.prototype.hasOwnProperty.call(TEMPLATES, m.profile) || !state.doc) return;
      // Another mode's: read from the store when switched to.
      if (m.profile !== state.doc.profile) return delete slots[m.profile];
      if (m.text === state.text) return;
      if (!state.sourceValid) return say("changed in another tab", [["Show it", function () { takeOver(m.text); }]], true);
      takeOver(m.text);
    };
  }
  function takeOver(text) {
    adopt(text, state.selected, state.parent, false, function () {
      fromTab = true;
      historyOf(state.doc.profile).push(state.text);
      return true;
    }).then(function (applied) {
      if (applied) say("changed in another tab · Ctrl+Z goes back");
    }).catch(function (e) {
      console.error(e);
    });
  }

  // A text becomes the document: the one way in, for an edit, an undo, a redo.
  function adopt(text, selectId, parent, fit, beforeCommit) {
    var token = gate.issue("document");
    return solver.parse(text).then(function (parsed) {
      if (!parsed.ok) throw new Error(describe(parsed.diagnostics[0]));
      // A newer text was sent for adoption meanwhile, or the source changed.
      if (!gate.accept(token)) return false;
      if (beforeCommit && !beforeCommit()) return false;
      // Each mode has its own undo history.
      undoStack = historyOf(parsed.ok.profile);
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
      var origin = replacing;
      replacing = null;
      // A text another tab kept is kept already, and was its edit, not this one's.
      var quiet = fromTab;
      fromTab = false;
      if (!quiet) {
        keep(text, parsed.ok.profile);
        // The name goes with it: the page's state is only updated after.
        textListeners.forEach(function (f) { f(text, parsed.ok.profile, origin, parsed.ok.name); });
      }
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
      return Promise.resolve(state.diagnostics.slice());
    }
    return solver.parse(text).then(function (parsed) {
      if (!gate.accept(token)) return null;
      if (!parsed.ok) return parsed.diagnostics;
      return keptElsewhere(parsed.ok.profile).then(function (kept) {
        return adopt(text, state.selected, state.parent, false, function () {
          // Text of another mode goes into that mode: what it replaces there
          // is one Ctrl+Z away, as for a file opened (replaceDocument).
          keepReplaced(parsed.ok.profile, kept);
          return true;
        });
      }).then(function (applied) {
        return applied ? parsed.diagnostics || [] : null;
      });
    });
  }

  // One undo history per mode, and the text last seen in each: switching
  // modes goes back to that text, and Ctrl+Z works on it as before.
  var histories = Object.create(null);
  var slots = Object.create(null);
  function historyOf(profile) {
    return histories[profile] || (histories[profile] = window.effractorEdit.createHistory());
  }
  var undoStack = historyOf("fault-tree");
  // A text of mode `into` is about to replace that mode's document: the one
  // it replaces goes into that mode's history. That is the text on the page,
  // or the one last seen in that mode, or else what this browser keeps for
  // it (`kept`, read beforehand with keptElsewhere).
  function keepReplaced(into, kept) {
    var before = state.doc && state.doc.profile === into ? state.text : slots[into] !== undefined ? slots[into] : kept;
    if (before !== undefined && before !== null) historyOf(into).push(before);
  }
  function keptElsewhere(profile) {
    return (state.doc && state.doc.profile === profile) || slots[profile] !== undefined ? Promise.resolve(null) : keptText(profile);
  }
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

  // What was being worked on in this browser, in the mode last used, or else
  // an empty document. ?new= opens an empty one of its kind, the kept one a
  // Ctrl+Z behind it, and leaves the address: a reload is not another new
  // one. Kept text that does not read opens in the source, to be put right.
  function load() {
    var wanted = newProfile(location.search);
    if (wanted && typeof history !== "undefined") history.replaceState(history.state, "", location.pathname + withoutNew(location.search) + location.hash);
    var unread = null;
    return lastMode()
      .then(function (mode) {
        var active = wanted || mode || "fault-tree";
        return readKept(active).then(function (kept) {
          if (kept && kept.diagnostics) unread = kept;
          else if (kept && wanted) historyOf(active).push(kept.text);
          else if (kept) return kept.text;
          return template(templateOf(active));
        });
      })
      .then(function (text) {
        return solver.parse(text).then(function (parsed) {
          if (!parsed.ok) throw new Error(describe(parsed.diagnostics[0]));
          state.diagnostics = parsed.diagnostics || [];
          undoStack = historyOf(parsed.ok.profile);
          var samples = samplesOverride(location.search);
          // The page's first text is announced too: "new" when ?new= asked
          // for an empty one, else "load" — the text this browser kept.
          var first = wanted ? "new" : "load";
          function told(outcome, t) {
            firstText = [t, parsed.ok.profile, first, parsed.ok.name];
            textListeners.forEach(function (f) { f.apply(null, firstText); });
            if (unread) notOpened(unread.text, unread.diagnostics, "the text kept in this browser does not open");
            return outcome;
          }
          if (samples === null) return Promise.resolve(loaded(text, parsed.ok, true)).then(function (v) { return told(v, text); });
          // The edit goes the way every edit will: through the document and
          // back into canonical text.
          parsed.ok.analysis.samples = samples;
          return solver.serialize(parsed.ok).then(function (written) {
            if (!written.ok) throw new Error(describe(written.diagnostics[0]));
            return Promise.resolve(loaded(written.ok, parsed.ok, true)).then(function (v) { return told(v, written.ok); });
          });
        });
      });
  }

  // The mode last used. Before there were modes the browser kept one text:
  // it is filed once under its own mode, which becomes the last used.
  function lastMode() {
    return store.mode().then(function (mode) {
      if (mode !== null) return mode;
      return store.legacy().then(function (old) {
        if (old === null) return null;
        return solver.parse(old).then(function (parsed) {
          if (!parsed.ok) return null;
          var profile = parsed.ok.profile;
          return Promise.all([store.save(old, profile), store.setMode(profile)]).then(function (done) {
            // Let go of only once it is kept under its mode.
            if (done[0] === true) store.dropLegacy();
            return profile;
          });
        });
      });
    });
  }

  // A mode's kept text: {text} when it reads as a document of that mode,
  // {text, diagnostics} when it does not parse (an older version's, say), or
  // null. Neither must lock the page out of itself.
  function readKept(profile) {
    return store.load(profile).then(function (kept) {
      if (kept === null) return null;
      return solver.parse(kept).then(function (parsed) {
        if (!parsed.ok) return { text: kept, diagnostics: parsed.diagnostics };
        return parsed.ok.profile === profile ? { text: kept } : null;
      });
    });
  }
  function keptText(profile) {
    return readKept(profile).then(function (kept) {
      return kept && !kept.diagnostics ? kept.text : null;
    });
  }

  // To another mode: the text last worked on there, or its empty document.
  // What is on the page stays kept in its own mode. The latest choice wins.
  function switchMode(profile) {
    if (!state.doc || !Object.prototype.hasOwnProperty.call(TEMPLATES, profile)) return Promise.resolve(false);
    var intent = gate.issue("mode");
    if (state.doc.profile === profile) return Promise.resolve(true);
    var unread = null;
    var text = slots[profile] !== undefined ? Promise.resolve({ text: slots[profile] }) : readKept(profile);
    return text
      .then(function (kept) {
        // Kept text that does not read opens in the source, over an empty one.
        if (kept && kept.diagnostics) unread = kept;
        return kept && !unread ? kept.text : template(templateOf(profile));
      })
      .then(function (text) {
        if (!gate.accept(intent)) return false;
        return adopt(text, null, null, true, function () {
          return gate.accept(intent);
        });
      })
      .then(function (applied) {
        if (applied && unread) notOpened(unread.text, unread.diagnostics, "the text kept in this browser does not open");
        return applied;
      })
      .catch(function (e) {
        console.error(e);
        say("could not switch · " + e.message);
        return false;
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
    reselect();
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
    reselect();
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
    var scenario = arch ? state.scenario : "";
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
      }, arch ? { scenario: scenario, revision: revision } : undefined)
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
        // …and the comparison it was asked for, which may have changed since.
        if (arch && scenario !== state.scenario) return;
        if (arch) state.blockers = null;
        state.lastSampledMs = performance.now() - started;
        if (arch) {
          state.solvedRevision = revision;
          showGraph(answer.result);
        }
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

  function hasScenario(doc, id) {
    return !!id && !!doc && !!doc.scenarios && Object.prototype.hasOwnProperty.call(doc.scenarios, id);
  }

  // Compare the baseline with one of the document's scenarios, or with
  // nothing (""): a choice of the workspace, never an edit of the document.
  function setScenario(id) {
    id = id || "";
    if (id && !hasScenario(state.doc, id)) return false;
    if (id === state.scenario) return true;
    state.scenario = id;
    notify();
    if (P.isArchitecture(state.doc)) autosolve.changed();
    return true;
  }

  window.effractor.state = state;
  window.effractor.setScenario = setScenario;
  window.effractor.renderer = renderer;
  window.effractor.select = select;
  window.effractor.labelOf = labelOf;
  window.effractor.rebuild = function (box, key, build) {
    rebuild(document, box, key, build);
  };
  window.effractor.textField = textField;
  window.effractor.keyElsewhere = function (e) {
    return keyElsewhere(document, e);
  };
  window.effractor.putPositions = putPositions;
  // Places set by hand for the edit about to be drawn (or null again once
  // it is): opening a cluster in place leaves them where they are.
  window.effractor.placedByHand = function (places) {
    handPlaced = places || null;
  };
  window.effractor.storedPositions = function () {
    return positions.load(state.doc.name);
  };
  window.effractor.arrange = arrange;
  window.effractor.permits = function () {
    return permits.on();
  };
  window.effractor.setPermits = permits.set;
  window.effractor.outlines = function () {
    return outlines.on();
  };
  window.effractor.setOutlines = outlines.set;
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

  // opts.origin: "new" | "file" | "link" | "server"; opts.fresh starts that
  // mode's undo history anew (accounts: what the server keeps).
  function replaceDocument(text, said, isCurrent, opts) {
    gate.issue("mode"); // a mode switch on its way gives way to this document
    return solver.parse(text).then(function (parsed) {
      if (isCurrent && !isCurrent()) return false;
      if (!parsed.ok) return notOpened(text, parsed.diagnostics);
      // In canonical form, as every other text the page holds.
      return solver.serialize(parsed.ok).then(function (written) {
        if (isCurrent && !isCurrent()) return false;
        if (!written.ok) return say("not opened: " + describe(written.diagnostics[0]));
        return keptElsewhere(parsed.ok.profile).then(function (kept) {
          return adopt(written.ok, null, null, true, function () {
            // Link navigation may have changed during the worker round trips.
            // Check before touching either the document or its undo history.
            if (isCurrent && !isCurrent()) return false;
            replacing = (opts && opts.origin) || "other";
            // A document the server keeps starts its own history: the one it
            // replaces is safe on the server, and an undo must never write one
            // document's text into another.
            if (opts && opts.fresh) histories[parsed.ok.profile] = window.effractorEdit.createHistory();
            // Opened into its own mode: what it replaces there is one Ctrl+Z away.
            else keepReplaced(parsed.ok.profile, kept);
            return true;
          });
        }).then(function (applied) {
          if (!applied || (isCurrent && !isCurrent())) return false;
          say(opts && opts.fresh ? said : said + " · Ctrl+Z goes back");
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
  // canvas keeps the document it had. `what` says which text it is.
  function notOpened(text, diagnostics, what) {
    what = what || "not opened";
    var errors = diagnostics.filter(function (d) {
      return d.severity === "error";
    }).length;
    if (!window.effractor.showSourceText) return say(what + ": " + describe(diagnostics[0]));
    window.effractor.showSourceText(text, diagnostics);
    say(what + " · " + errors + (errors === 1 ? " problem" : " problems") + " · listed under the source");
    return false;
  }

  // The document as a file; with source text that does not read yet, that
  // text, as it is being put right.
  function saveFile() {
    if (state.text === null) return;
    var source = $("source");
    var text = !state.sourceValid && source ? source.value : state.text;
    var url = URL.createObjectURL(new Blob([text], { type: "text/yaml" }));
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

  // Logged in, what the server keeps starts afresh (accounts). Without the
  // account modules this is always false.
  function freshFor(origin) {
    var A = window.effractorAccounts;
    return !!(A && A.documents && A.session && A.documents.startsFresh(origin, !!A.session.user));
  }

  var fileActions = {
    // An empty document in the mode on the page.
    new: function () {
      var profile = state.doc ? state.doc.profile : "fault-tree";
      template(templateOf(profile)).then(function (text) {
        replaceDocument(text, "new " + MODE_NAMES[profile].toLowerCase(), null, { origin: "new", fresh: freshFor("new") });
      }).catch(function (e) {
        console.error(e);
        say("could not start a new one · " + e.message);
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
      replaceDocument(text, "opened " + file.name, null, { origin: "file", fresh: freshFor("file") });
    }).catch(function (e) {
      console.error(e);
      say("could not read " + file.name + " · " + e.message);
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

  window.effractor.canUndo = function () {
    return undoStack.canUndo();
  };
  window.effractor.canRedo = function () {
    return undoStack.canRedo();
  };
  window.effractor.switchMode = switchMode;
  window.effractor.solve = solve;
  window.effractor.onText = function (f) {
    textListeners.push(f);
    // A listener that comes after the first text still hears of it.
    if (firstText) f.apply(null, firstText);
  };
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
  // A plain key meant for the canvas, not already taken by something that
  // owns it.
  function canvasKey(e) {
    return !e.ctrlKey && !e.metaKey && !e.altKey && !e.defaultPrevented && !keyElsewhere(document, e);
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      solve();
    } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "s" || e.key === "o")) {
      e.preventDefault();
      fileActions[e.key === "s" ? "save" : "open"]();
    } else if (e.key === "Escape") {
      closeFileMenu();
      // Esc on the canvas lets go of what is selected.
      if (P.isArchitecture(state.doc) && canvasKey(e) && (state.selected || state.picked.length)) select(null);
    } else if (e.key.toLowerCase() === "f" && canvasKey(e)) {
      renderer.fit();
    } else if ((e.key === "+" || e.key === "-") && canvasKey(e)) {
      renderer.zoomBy(e.key === "+" ? 1.25 : 0.8);
    } else if (/^[123]$/.test(e.key) && canvasKey(e)) {
      // Before the editor's keys, which would start a rename with the digit.
      e.preventDefault();
      switchMode(MODES[Number(e.key) - 1]);
    }
  });
  MODES.forEach(function (mode) {
    $("mode-" + mode).addEventListener("click", function () {
      switchMode(mode);
    });
  });

  window.effractor.replaceDocument = replaceDocument;
  window.effractor.markSourceDirty = markSourceDirty;
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
