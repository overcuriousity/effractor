// Defence scenarios: editing the named overlays a document stores, and
// presenting a solved comparison — the baseline and one scenario on the same
// draws. Every number is the solver's: the benefit is its paired difference
// with its interval, curves are its rows, and which steps are blocked or still
// open is its per-side state, never a threshold on sampled probabilities.
// Pure; edits return {doc, …} like the other architecture edits.
(function () {
  var slug = (typeof module !== "undefined" ? require("./edit.js") : window.effractorEdit).slug;

  function has(map, key) {
    return !!map && Object.prototype.hasOwnProperty.call(map, key);
  }

  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  // The source path of the switch a change sets: what the solver's paths name.
  function keyOf(change) {
    return change.association != null
      ? "associations." + change.association + ".allowed"
      : "entities." + change.entity + ".defenses." + change.defense;
  }

  // {entity, defense, value} or {association, value} → the file's shape.
  function written(change, value) {
    return change.association != null
      ? { association: change.association, field: "allowed", value: value }
      : { entity: change.entity, defense: change.defense, value: value };
  }

  function ids(doc) {
    return Object.keys((doc && doc.scenarios) || {});
  }

  // A new scenario id from its label, never one the document has.
  function freshId(doc, label) {
    var base = String(label || "").trim() ? slug(label) : "scenario";
    if (/^[0-9]+$/.test(base)) base = "scenario-" + base;
    var id = base;
    for (var n = 2; has(doc.scenarios, id); n++) id = base + "-" + n;
    return id;
  }

  // "Scenario n" for a new one: the first n no scenario is called by, so a
  // removal does not lead to two of one name.
  function newLabel(doc) {
    var taken = Object.create(null);
    ids(doc).forEach(function (id) {
      taken[doc.scenarios[id].label] = true;
    });
    for (var n = 1; ; n++) if (!taken["Scenario " + n]) return "Scenario " + n;
  }

  // The scenario the comparison names, while the document still has it; ""
  // is the baseline alone. Choosing one never rewrites the baseline.
  function selectable(doc, id) {
    return id && has(doc && doc.scenarios, id) ? id : "";
  }

  function putScenario(doc, id, label, changes) {
    var next = clone(doc);
    next.scenarios = next.scenarios || {};
    var old = next.scenarios[id] || {};
    var s = { label: label };
    if (old.attacker) s.attacker = old.attacker;
    s.changes = (changes || []).map(function (c) {
      return written(c, c.value);
    });
    Object.keys(old).forEach(function (k) {
      if (k.indexOf("x-") === 0) s[k] = old[k];
    });
    next.scenarios[id] = s;
    return { doc: next, scenario: id };
  }

  function rename(doc, id, label) {
    if (!has(doc.scenarios, id) || doc.scenarios[id].label === label) return null;
    var next = clone(doc);
    next.scenarios[id].label = label;
    return { doc: next, scenario: id };
  }

  function removeScenario(doc, id) {
    if (!has(doc.scenarios, id)) return null;
    var next = clone(doc);
    var label = next.scenarios[id].label;
    delete next.scenarios[id];
    return { doc: next, scenario: "", notice: "Removed “" + label + "” · Ctrl+Z undoes" };
  }

  // Sets one switch in a scenario (true, false or "unknown"), or clears it
  // with null. The change keeps its place and its x- fields.
  function setChange(doc, id, target, value) {
    if (!has(doc.scenarios, id)) return null;
    var key = keyOf(target);
    var changes = doc.scenarios[id].changes || [];
    var at = -1;
    changes.forEach(function (c, i) {
      if (at < 0 && keyOf(c) === key) at = i;
    });
    if (value === null && at < 0) return null;
    if (at >= 0 && changes[at].value === value) return null;
    var next = clone(doc);
    var list = (next.scenarios[id].changes = next.scenarios[id].changes || []);
    if (value === null) list.splice(at, 1);
    else if (at >= 0) list[at].value = value;
    else list.push(written(target, value));
    return { doc: next, scenario: id };
  }

  // The attacker's speed in a scenario; null: the attacker as written.
  function setSpeed(doc, id, speed) {
    if (!has(doc.scenarios, id)) return null;
    var old = doc.scenarios[id];
    if (speed === null ? !old.attacker : old.attacker && old.attacker.speed === speed) return null;
    var next = clone(doc);
    var s = next.scenarios[id];
    var out = {};
    Object.keys(s).forEach(function (k) {
      if (k === "attacker") return;
      if (k === "changes" && speed !== null) out.attacker = Object.assign({}, s.attacker, { speed: speed });
      out[k] = s[k];
    });
    if (speed !== null && !out.attacker) out.attacker = { speed: speed };
    next.scenarios[id] = out;
    return { doc: next, scenario: id };
  }

  function labelOf(doc, collection, id) {
    var e = doc[collection] && doc[collection][id];
    return e && e.label != null ? e.label : id;
  }

  // Everything a scenario can switch, in document order: each component's
  // defence (the kind's, from the catalog) and each firewall permission.
  function switches(doc, catalog) {
    var defenseOf = Object.create(null);
    ((catalog && catalog.entities) || []).forEach(function (k) {
      defenseOf[k.kind] = k.defense;
    });
    var words = Object.create(null);
    ((catalog && catalog.defenses) || []).forEach(function (d) {
      words[d.id] = d.word;
    });
    var out = [];
    Object.keys(doc.entities || {}).forEach(function (id) {
      var e = doc.entities[id];
      var d = defenseOf[e.kind];
      if (!d) return;
      var v = e.defenses && has(e.defenses, d) ? e.defenses[d] : "unknown";
      out.push({ key: keyOf({ entity: id, defense: d }), entity: id, defense: d, label: labelOf(doc, "entities", id), word: words[d] || d, baseline: v });
    });
    Object.keys(doc.associations || {}).forEach(function (id) {
      var a = doc.associations[id];
      if (a.kind !== "permits") return;
      var label = labelOf(doc, "entities", a.from) + " · " + labelOf(doc, "flows", a.to);
      out.push({ key: keyOf({ association: id }), association: id, label: label, word: "Allowed", baseline: a.allowed === undefined ? "unknown" : a.allowed });
    });
    return out;
  }

  // A switch as the file writes it, before any scenario: true, false or
  // "unknown" (also for one the file leaves out).
  function written_(doc, change) {
    if (change.association != null) {
      var a = doc.associations && doc.associations[change.association];
      return a && a.allowed !== undefined ? a.allowed : "unknown";
    }
    var e = doc.entities && doc.entities[change.entity];
    return e && e.defenses && has(e.defenses, change.defense) ? e.defenses[change.defense] : "unknown";
  }

  // What one scenario sets, by switch path; which of those only repeat what
  // the file says (no change at all); and its attacker's speed.
  function settings(doc, id) {
    if (!has(doc && doc.scenarios, id)) return null;
    var s = doc.scenarios[id];
    var values = {};
    var asWritten = [];
    (s.changes || []).forEach(function (c) {
      values[keyOf(c)] = c.value;
      if (written_(doc, c) === c.value) asWritten.push(keyOf(c));
    });
    return { label: s.label, values: values, asWritten: asWritten, speed: s.attacker && typeof s.attacker.speed === "number" ? s.attacker.speed : null };
  }

  function speedText(speed) {
    return String(speed) + " \u00d7 speed";
  }

  function outcome(side) {
    return side && side.outcome && side.outcome.available;
  }

  // Both CDFs on their one grid: [t, P base, lower, upper, P scenario, lower,
  // upper]. A side without numbers has empty columns. [] without a scenario.
  function rows(result) {
    if (!result || !result.scenario) return [];
    var b = outcome(result.baseline);
    var s = outcome(result.scenario);
    var grid = (b || s || { ttc_cdf: [] }).ttc_cdf;
    return grid.map(function (g, i) {
      var br = b ? b.ttc_cdf[i] : null;
      var sr = s ? s.ttc_cdf[i] : null;
      return [g[0], br ? br[1] : null, br ? br[2] : null, br ? br[3] : null, sr ? sr[1] : null, sr ? sr[2] : null, sr ? sr[3] : null];
    });
  }

  function illustrative(side) {
    return !!side && (side.assumptions || []).some(function (a) {
      return a.status === "illustrative" || a.status === "assumed";
    });
  }

  function sideHeadline(side) {
    var a = outcome(side);
    return { p: a ? a.p_target : null, ci: a ? a.ci : null, method: a ? a.method : null, missing: a ? [] : ((side && side.outcome.unavailable) || { missing: [] }).missing };
  }

  // The comparison in the solver's words: the benefit (baseline minus
  // scenario, positive when the scenario helps) with its paired interval.
  function summary(result) {
    if (!result || !result.scenario) return null;
    var d = result.delta && result.delta.available;
    var u = result.delta && result.delta.unavailable;
    var benefit = d ? d.mean : null;
    return {
      benefit: benefit,
      ci: d ? d.ci : null,
      ciReason: d ? d.ci_reason : null,
      reason: u ? u.reason : null,
      missing: u ? u.missing.slice() : [],
      baseline: sideHeadline(result.baseline),
      scenario: sideHeadline(result.scenario),
      illustrative: { baseline: illustrative(result.baseline), scenario: illustrative(result.scenario) },
    };
  }

  function nodePaths(node) {
    var paths = ((node.timing && node.timing.paths) || []).slice();
    (node.origins || []).forEach(function (o) {
      paths = paths.concat(o.paths || []);
    });
    return paths;
  }

  // The generated steps that read a switch the scenario sets, and the speed
  // it gives the attacker (which touches every timed step alike).
  function changedSteps(graph, doc, id) {
    var s = settings(doc, id);
    if (!s) return { steps: [], speed: null };
    var keys = Object.keys(s.values).filter(function (k) {
      return s.asWritten.indexOf(k) < 0;
    });
    var steps = graph.nodes
      .filter(function (n) {
        var paths = nodePaths(n);
        return keys.some(function (k) {
          return paths.indexOf(k) >= 0;
        });
      })
      .map(function (n) {
        return n.id;
      });
    return { steps: steps, speed: s.speed };
  }

  // A step worth naming: an attack action or an input, not a state or a
  // foothold the attacker simply has.
  function isStep(id) {
    return id.indexOf("action/") === 0 || (id.indexOf("input/") === 0 && id.indexOf("input/foothold/") !== 0);
  }

  function statuses(side) {
    var out = Object.create(null);
    ((side && side.nodes) || []).forEach(function (n) {
      out[n.id] = n.status;
    });
    return out;
  }

  function open(status) {
    return status === "possible" || status === "seeded";
  }

  // {blocked, changed, remaining}: steps open in the baseline and closed by
  // the scenario; steps the scenario changes that stay open; and the other
  // steps through which the target can still be reached under the scenario.
  // Open and closed are the solver's per-side states: a step that no sample
  // reached can still be open.
  function routes(graph, result, doc, id) {
    if (!result || !result.scenario) return null;
    var base = statuses(result.baseline);
    var scen = statuses(result.scenario);
    var target = result.target;
    var changed = changedSteps(graph, doc, id).steps;
    var byId = Object.create(null);
    graph.nodes.forEach(function (n) {
      byId[n.id] = n;
    });
    var blocked = graph.nodes
      .filter(function (n) {
        return isStep(n.id) && open(base[n.id]) && !open(scen[n.id]);
      })
      .map(function (n) {
        return n.id;
      });
    // Everything the target could still come from, through open steps only.
    var seen = Object.create(null);
    var stack = open(scen[target]) ? [target] : [];
    seen[target] = true;
    while (stack.length) {
      var n = byId[stack.pop()];
      (n && n.inputs ? n.inputs : []).forEach(function (i) {
        if (!seen[i] && open(scen[i])) {
          seen[i] = true;
          stack.push(i);
        }
      });
    }
    var remaining = graph.nodes
      .filter(function (n) {
        return isStep(n.id) && seen[n.id] && changed.indexOf(n.id) < 0;
      })
      .map(function (n) {
        return n.id;
      });
    return {
      targetBlocked: open(base[target]) && !open(scen[target]),
      blocked: blocked,
      changed: changed.filter(function (c) {
        return open(scen[c]);
      }),
      remaining: remaining,
    };
  }

  // "current": this result compares the chosen scenario for the text on the
  // page; "stale": it did, for an older text; "none": it does not compare it.
  function state(result, id, solvedRevision, revision) {
    if (!result || !result.scenario || !id || result.scenario.id !== id) return "none";
    return solvedRevision === revision ? "current" : "stale";
  }

  // ---- how the comparison table says its numbers ----

  var MINUS = "\u2212";

  function digits(v) {
    if (v === 0) return "0.00";
    return Math.abs(v) < 1e-4 ? v.toExponential(2) : v.toPrecision(3);
  }

  function probability(p) {
    return typeof p === "number" ? digits(p) : "unknown";
  }

  function signed(v) {
    if (v === 0) return digits(0);
    return (v < 0 ? MINUS : "+") + digits(Math.abs(v));
  }

  // "lo–hi", or "—" when the interval is one number as printed. `withSign`
  // for a difference: each end keeps its sign, joined by "to".
  function interval(ci, withSign) {
    if (!ci) return "\u2014";
    var lo = withSign ? signed(ci.lo) : digits(ci.lo);
    var hi = withSign ? signed(ci.hi) : digits(ci.hi);
    if (lo === hi) return "\u2014";
    return withSign ? lo + " to " + hi : lo + "\u2013" + hi;
  }

  var api = {
    probability: probability,
    speedText: speedText,
    signed: signed,
    interval: interval,
    state: state,
    ids: ids,
    freshId: freshId,
    newLabel: newLabel,
    selectable: selectable,
    putScenario: putScenario,
    rename: rename,
    removeScenario: removeScenario,
    setChange: setChange,
    setSpeed: setSpeed,
    switches: switches,
    settings: settings,
    rows: rows,
    summary: summary,
    changedSteps: changedSteps,
    routes: routes,
    keyOf: keyOf,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorComparison = api;
})();
