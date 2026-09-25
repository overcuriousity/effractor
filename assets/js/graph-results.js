// A generated graph's results → what the page says about them: the target's
// probability by the horizon, its CDF rows as the solver gave them, each
// step's facts, the assumptions a number rests on and the sample route.
// Nothing is computed that the solver did not say: no renormalised curve, no
// quantile of the attacks that succeeded, no ranking of routes. Pure.
(function () {
  var views = typeof module !== "undefined" ? require("./results-view.js") : window.effractorResults;
  var number = views.number;

  var TITLE = "Target compromise probability";
  var COLUMNS = ["time", "probability", "lower", "upper"];

  function isGraphResults(results) {
    return !!results && results["effractor-graph-results"] === 1;
  }

  function band(ci) {
    return ci ? number(ci.lo) + "–" + number(ci.hi) : "—";
  }

  // An outcome's CDF: the 65 rows [t, P(target by t), lower, upper] as they
  // are, or none and why.
  function cdf(outcome) {
    var a = outcome && outcome.available;
    if (a) return { rows: a.ttc_cdf, reason: null, missing: [], confidence: a.confidence, method: a.method };
    var u = (outcome && outcome.unavailable) || { reason: "Calculate to plot", missing: [] };
    return { rows: [], reason: u.reason, missing: u.missing || [], confidence: null, method: null };
  }

  // What the chart's key says of its one curve: sampled, with its band, or
  // known by structure, with none.
  function cdfKey(model) {
    if (model.method === "structural") return "— " + TITLE + " · by structure, not sampled";
    return "┄ " + TITLE + (model.confidence === null ? "" : " · " + Math.round(model.confidence * 100) + "% pointwise band");
  }

  function report(results, side) {
    return results ? (side === "scenario" ? results.scenario : results.baseline) : null;
  }

  // Inputs whose evidence is only an exercise value or an assumption.
  function illustrative(side) {
    return !!side && (side.assumptions || []).some(function (a) {
      return a.status === "illustrative" || a.status === "assumed";
    });
  }

  // {label, p, ci, by, qualifier, missing}: p is null when there is no number.
  function headline(results, side) {
    var r = report(results, side);
    var out = { label: "P(target)", p: null, ci: null, by: results ? String(results.horizon) + " " + results.time_unit : "", qualifier: "", missing: [] };
    if (!r) return out;
    var a = r.outcome.available;
    if (!a) {
      out.missing = r.outcome.unavailable.missing.slice();
      out.qualifier = "unknown · " + r.outcome.unavailable.reason;
      return out;
    }
    out.p = a.p_target;
    if (a.method === "structural") {
      out.qualifier = a.p_target === 0 ? "structurally unreachable" : "certain at once";
      return out;
    }
    out.ci = { lo: a.ci.lo, hi: a.ci.hi };
    // An interval that prints as one number says nothing the number does not.
    var ci = number(a.ci.lo) === number(a.ci.hi) ? [] : [Math.round(a.confidence * 100) + "% CI " + band(a.ci)];
    out.qualifier = ci.concat(illustrative(r) ? ["illustrative inputs"] : []).join(" · ");
    return out;
  }

  // The first time on the grid by which P(target) reaches q; null if it does
  // not within the horizon. Unconditional: failed attempts count.
  function reachedBy(rows, q) {
    for (var i = 0; i < rows.length; i++) if (rows[i][1] >= q) return rows[i][0];
    return null;
  }

  // Said: "3.13 d", "not reached by 100 d", or null without a number.
  function timeTo(results, q, side) {
    var r = report(results, side);
    if (!r || !r.outcome.available) return null;
    var t = reachedBy(r.outcome.available.ttc_cdf, q);
    var h = headline(results, side);
    return t === null ? "not reached by " + h.by : number(t) + " " + results.time_unit;
  }

  // A side's step results by id, built once for a table of many steps.
  function nodesById(results, side) {
    var r = report(results, side);
    if (!r) return null;
    var out = Object.create(null);
    r.nodes.forEach(function (x) {
      if (!(x.id in out)) out[x.id] = x;
    });
    return out;
  }

  // What the inspector lists for a step. `byId`: nodesById(results, side),
  // when the caller asks for many steps.
  function nodeFacts(results, id, side, byId) {
    byId = byId || nodesById(results, side);
    var n = byId && id in byId ? byId[id] : null;
    if (!n) return [];
    var facts = [["State", n.status]];
    var a = n.outcome.available;
    if (!a) {
      facts.push(["P(step)", "unknown"]);
      if (n.outcome.unavailable.missing.length) facts.push(["Unknown inputs", n.outcome.unavailable.missing.join(", ")]);
      return facts;
    }
    facts.push(["P(step)", number(a.p)]);
    // An interval that prints as one number says nothing the number does not.
    if (number(a.ci.lo) !== number(a.ci.hi)) facts.push([Math.round(results.confidence * 100) + "% CI", band(a.ci)]);
    return facts;
  }

  function assumptions(side) {
    return ((side && side.assumptions) || []).map(function (a) {
      return { path: a.path, paths: a.paths.slice(), status: a.status, expression: a.expression, note: a.note };
    });
  }

  // What the scenario's number rests on that the baseline's does not: its
  // changes, an attacker speed, the inputs a change brings in.
  function scenarioAssumptions(results) {
    var scenario = results && results.scenario;
    if (!scenario) return [];
    function key(a) {
      return JSON.stringify([a.path, a.status, a.expression, a.note]);
    }
    var base = Object.create(null);
    assumptions(results.baseline).forEach(function (a) {
      base[key(a)] = true;
    });
    return assumptions(scenario).filter(function (a) {
      return !base[key(a)];
    });
  }

  // One real sample that reached the target, whole: every step it needed,
  // each with the prerequisites it waited for, in the order they completed.
  function witness(side, graph) {
    var w = side && side.witness;
    if (!w) return null;
    var labels = Object.create(null);
    ((graph && graph.nodes) || []).forEach(function (n) {
      labels[n.id] = n;
    });
    var inputs = Object.create(null);
    w.edges.forEach(function (e) {
      (inputs[e.dependent] = inputs[e.dependent] || []).push(e.prerequisite);
    });
    return {
      title: "Simulated path",
      sample: w.sample,
      time: w.target_time,
      steps: w.nodes.map(function (n) {
        var g = labels[n.id];
        return { id: n.id, label: g ? g.label : n.id, kind: g ? g.kind : null, time: n.time, inputs: inputs[n.id] || [] };
      }),
    };
  }

  // Which analyses a result set carries: a generated graph has the target's
  // probability, its CDF and a route; none of the tree's.
  function analyses(results) {
    var graph = isGraphResults(results);
    return { probability: graph, ttc: graph, route: graph, exact: false, cutSets: false, pareto: false, loss: false, controls: false };
  }

  var api = {
    TITLE: TITLE,
    COLUMNS: COLUMNS,
    number: number,
    band: band,
    isGraphResults: isGraphResults,
    cdf: cdf,
    cdfKey: cdfKey,
    headline: headline,
    illustrative: illustrative,
    reachedBy: reachedBy,
    timeTo: timeTo,
    nodesById: nodesById,
    nodeFacts: nodeFacts,
    assumptions: assumptions,
    scenarioAssumptions: scenarioAssumptions,
    witness: witness,
    analyses: analyses,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorGraphResults = api;
})();
