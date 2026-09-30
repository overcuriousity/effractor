// The agent's tool calls, carried out in the page (chat spec §6.2): one at a
// time, edits through the page's own path (wasm-checked, one undo step,
// autosaved), reads from what the page already knows. A refusal comes back
// as words for the agent to correct itself.
(function () {
  var node = typeof module !== "undefined";
  var ACCESS = { read: ["read", "view"], edit: ["read", "view", "edit"] };
  var SETTLE_MS = 120000;

  function toolOf(name, profile, catalog) {
    return (catalog || []).filter(function (t) {
      return t.name === name && t.profiles.indexOf(profile) >= 0;
    })[0];
  }

  // Whether the turn's access lets this page run the call: the server chose
  // the tools, and the page checks again.
  function allowed(name, profile, access, catalog) {
    var tool = toolOf(name, profile, catalog);
    return !!tool && (ACCESS[access] || ACCESS.read).indexOf(tool.access) >= 0;
  }

  // An output as JSON, whole: the server fits the session to the model's
  // context and marks what it has to leave out (chat spec §4.6).
  function shape(value) {
    return JSON.stringify(value === undefined ? null : value);
  }

  // What the user sees, for the prompt: data, a few fields.
  function stateLine(app) {
    var s = app.state || {};
    return shape({ view: s.mode || null, selection: s.selected || null, scenario: s.scenario || "", name: s.doc ? s.doc.name : null });
  }

  // The catalog as the agent needs it: what each kind, relationship, state,
  // defense, parameter and rule is, without the words written for people
  // and the rules' fine print; and what a flow needs, which the format
  // checks but the catalog does not list.
  function forAgent(c) {
    function pick(o, keys) {
      var out = {};
      keys.forEach(function (k) { out[k] = o[k]; });
      return out;
    }
    return {
      library: c.library,
      entities: (c.entities || []).map(function (e) { return pick(e, ["kind", "description", "states", "parameters", "optional", "defenses", "optional_defenses"]); }),
      associations: c.associations,
      flows: {
        source: "an application or service; its host is attached to the route's first network",
        target: "a service, which needs a host and an instance-of product",
        route: "network, router, network, … in order, from the source's network to the target's; each router attached to the networks beside it",
        permits: "a router with a firewall lets the flow through only with a permits association (allowed: true) from that firewall to the flow",
      },
      states: (c.states || []).map(function (s) { return pick(s, ["id", "description"]); }),
      defenses: (c.defenses || []).map(function (d) { return pick(d, ["id", "description"]); }),
      parameters: (c.parameters || []).map(function (p) { return pick(p, ["slot", "owner", "description"]); }),
      rules: (c.rules || []).map(function (r) {
        var out = pick(r, ["id", "title", "prerequisites", "output"]);
        if (r.duration && r.duration.slot) out.slot = r.duration.slot;
        return out;
      }),
    };
  }

  function wait(ms) {
    return new Promise(function (res) { setTimeout(res, ms); });
  }

  // Until `ready()` holds: true, or false after SETTLE_MS.
  function until(ready) {
    var start = Date.now();
    function check() {
      if (ready()) return Promise.resolve(true);
      if (Date.now() - start > SETTLE_MS) return Promise.resolve(false);
      return wait(200).then(check);
    }
    return check();
  }

  // Whether state.results describe the text on the page now, and, in an
  // architecture, the comparison asked for: an edit that left the document
  // unsolvable leaves the last text's numbers there.
  function current(s) {
    if (!s.results || s.solvedRevision !== s.revision) return false;
    if (!s.doc || s.doc.profile !== "architecture") return true;
    return (s.results.scenario ? s.results.scenario.id : "") === (s.scenario || "");
  }

  function unsolved(s) {
    if (s.blockers && s.blockers.length) return no(shape({ no_results: "the document cannot be simulated as it is", blockers: s.blockers }));
    if (s.sourceValid === false) return no("no results: the source is not valid");
    return no("no results for the document as it is now: call problems for why");
  }

  // The results of the text on the page now, solved when they are not. A run
  // already going is waited for: app.solve() would cancel the user's
  // Calculate. Once asked, done when a run was seen to end, or when nothing
  // started for 1.5 s. → {results} or a refusal.
  function fresh(app) {
    var s = app.state;
    return until(function () { return !s.running; }).then(function (idle) {
      if (!idle) return no("the simulation did not finish");
      if (current(s)) return { results: s.results };
      var start = Date.now(), seen = false;
      app.solve();
      return until(function () {
        if (s.running) seen = true;
        return !s.running && (seen || current(s) || Date.now() - start > 1500);
      }).then(function (ended) {
        if (!ended) return no("the simulation did not finish");
        return current(s) ? { results: s.results } : unsolved(s);
      });
    });
  }

  function graphSummary(app, results) {
    var GR = window.effractorGraphResults;
    var graph = app.state.generated && app.state.generated.graph;
    try {
      var routes = GR.routes(results.baseline, graph) || [];
      return {
        headline: GR.headline(results, "baseline"),
        routes: routes.slice(0, 3),
        routes_total: routes.length,
        assumptions: GR.assumptions(results.baseline),
      };
    } catch (e) {
      return results;
    }
  }

  function solved(app, profile) {
    return fresh(app).then(function (f) {
      if (!f.results) return f;
      return done(shape(profile === "architecture" ? graphSummary(app, f.results) : f.results));
    });
  }

  function done(output, select) {
    return { ok: true, output: output, select: select };
  }
  function no(output) {
    return { ok: false, output: output };
  }

  // The tools that need the page: reads, what is shown, and YAML (wasm).
  var PAGE = {
    read_document: function (app) { return done(app.state.text || ""); },
    problems: function (app) {
      return done(shape({ diagnostics: app.state.diagnostics || [], blockers: app.state.blockers || null }));
    },
    show: function (app, i) {
      app.select(String(i.id || ""));
      return app.state.selected === i.id ? done("shown", i.id) : no("no item “" + i.id + "”");
    },
    analyse: function (app, i, profile) { return solved(app, profile); },
    solve: function (app, i, profile) {
      if (i.scenario !== undefined && !app.setScenario(i.scenario || "")) return no("no scenario “" + i.scenario + "”");
      return solved(app, profile);
    },
    compare: function (app, i) {
      if (!app.setScenario(i.scenario || "")) return no("no scenario “" + i.scenario + "”");
      return fresh(app).then(function (f) {
        if (!f.results) return f;
        var C = window.effractorComparison, r = f.results;
        var graph = app.state.generated && app.state.generated.graph;
        try {
          return done(shape({ summary: C.summary(r), routes: C.routes(graph, r, app.state.doc, i.scenario) }));
        } catch (e) {
          return done(shape(r));
        }
      });
    },
    catalog: function (app) {
      return app.solver.catalog().then(function (a) { return a.ok ? done(shape(forAgent(a.ok))) : no("no component catalog"); });
    },
    attack_graph: function (app) {
      return app.generate().then(function (r) {
        if (r && r.ok) return done(shape(app.state.generated.support));
        return no(shape(app.state.blockers || "no attack graph: call problems for why"));
      });
    },
    set_view: function (app, i) {
      return app.setMode(i.view).then(function () { return done("showing the " + (i.view === "attack" ? "attack graph" : "architecture")); });
    },
    set_scenario: function (app, i) {
      return app.setScenario(i.scenario || "") ? done(i.scenario ? "comparing “" + i.scenario + "”" : "no scenario") : no("no scenario “" + i.scenario + "”");
    },
    show_route: function (app, i) {
      app.showRoute(i.index === undefined ? null : i.index, i.side);
      return done(i.index == null ? "no route shown" : "route " + (i.index + 1) + " shown");
    },
    show_all_steps: function (app, i) {
      app.setAllSteps(!!i.on);
      return done(i.on ? "all steps shown" : "only steps to the target");
    },
    replace_document: function (app, i, profile) {
      return app.solver.parse(String(i.yaml || "")).then(function (parsed) {
        if (!parsed.ok) return no((window.effractorProblems.refusal(parsed.diagnostics) || {}).message || "the YAML does not read");
        if (parsed.ok.profile !== profile) return no("the profile stays " + profile);
        return app.tryEdit({ doc: parsed.ok, select: null }).then(function (r) {
          return r.ok ? done("Replaced the document") : no(r.reason);
        });
      });
    },
  };

  // {app, tools, catalog, profile, docId, openId}: run(call, access) → {id,
  // ok, output, select}. `openId()` is the account document open now; a call
  // made after the turn's (`docId`, else the one open at creation) was closed
  // is refused, so an edit never lands on the other one.
  function createExecutor(o) {
    var queue = Promise.resolve();
    var mine = o.docId !== undefined ? o.docId : o.openId ? o.openId() : null;
    function one(call, access) {
      var name = call.name, input = call.input || {};
      if (o.openId && o.openId() !== mine) return Promise.resolve(no("the document was closed"));
      if (!allowed(name, o.profile, access, o.catalog)) return Promise.resolve(no("not allowed for you here"));
      if (input && Object.prototype.hasOwnProperty.call(input, "_unparsed")) return Promise.resolve(no("the input was not JSON"));
      if (Object.prototype.hasOwnProperty.call(PAGE, name)) {
        return Promise.resolve().then(function () { return PAGE[name](o.app, input, o.profile); });
      }
      var edit = o.tools.edit(name, input, { doc: o.app.state.doc, profile: o.profile, catalog: o.componentCatalog || null });
      if (edit.refused) return Promise.resolve(no(edit.refused));
      return o.app.tryEdit(edit).then(function (r) {
        // The plain id: every tool but show takes it unqualified.
        return r.ok ? done(edit.said + (edit.select ? ", id " + edit.select.replace(/^[a-z]+\//, "") : ""), edit.select) : no(r.reason);
      });
    }
    return {
      run: function (call, access) {
        var next = queue.then(function () { return one(call, access); }).then(function (r) {
          return { id: call.id, ok: !!r.ok, output: String(r.output), select: r.select || null };
        }, function (e) {
          return { id: call.id, ok: false, output: "could not do that: " + (e && e.message ? e.message : e), select: null };
        });
        queue = next;
        return next;
      },
    };
  }

  var api = { forAgent: forAgent, allowed: allowed, shape: shape, graphSummary: graphSummary, stateLine: stateLine, createExecutor: createExecutor };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorAssistantPage = api;
})();
