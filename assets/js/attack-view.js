// A generated attack graph → what is drawn and what is inspected: the shared
// renderer's {profile, nodes, edges} for a window of at most `limit` steps,
// the steps a component produced, the sources a step came from, and where
// in the architecture each source field is set. The graph and its support
// come from the wasm module; nothing here decides what can happen or when.
// Pure: no DOM, no ELK. Every walk is a loop over a queue, never recursion:
// a graph is user input, and it may have cycles.
(function () {
  var layout = typeof module !== "undefined" ? require("./graph.js") : window.effractorGraph;

  var LIMIT = 500;

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  // id → index into graph.nodes, prototype-less: ids are user words.
  function indexOf(graph) {
    var at = Object.create(null);
    ((graph && graph.nodes) || []).forEach(function (n, i) {
      at[n.id] = i;
    });
    return at;
  }

  // `at`: the graph's index when the caller built it once for many steps
  // (a table of every step); else it is built here.
  function node(graph, id, at) {
    at = at || indexOf(graph);
    return id in at ? graph.nodes[at[id]] : null;
  }

  // "entity/web", "flow/ssh", "association/allow-ssh" → the steps whose
  // origins bind it, in graph order.
  var BOUND = { entity: "entities", flow: "flows", association: "associations" };
  function stepsFor(graph, qualified) {
    var cut = String(qualified).indexOf("/");
    var field = BOUND[String(qualified).slice(0, cut)];
    var id = String(qualified).slice(cut + 1);
    if (!field) return [];
    return ((graph && graph.nodes) || [])
      .filter(function (n) {
        return n.origins.some(function (o) {
          return (o[field] || []).indexOf(id) >= 0;
        });
      })
      .map(function (n) {
        return n.id;
      });
  }

  function stepsForEntity(graph, entityId) {
    return stepsFor(graph, "entity/" + entityId);
  }

  // The provenance objects as the module supplied them.
  function sourcesForStep(graph, stepId) {
    var n = node(graph, stepId);
    return n ? n.origins.slice() : [];
  }

  // The component a step is about, for a selection that has to fall back
  // from the step: a state's owner, an action's object, an input's subject.
  function originOf(graph, stepId) {
    var n = node(graph, stepId);
    if (!n) return null;
    var parts = stepId.split("/");
    var first = n.origins[0] || { entities: [], flows: [] };
    if ((parts[0] === "state" && parts[1] === "flow") || (parts[0] === "action" && parts[1] === "flow-connect")) {
      return first.flows.length ? "flow/" + first.flows[0] : null;
    }
    if (parts[0] === "state") return "entity/" + parts[2];
    var entities = first.entities || [];
    if (!entities.length) return null;
    return "entity/" + (parts[0] === "action" ? entities[entities.length - 1] : entities[0]);
  }

  // Where a source path is set: a selection, and the slot or field of its
  // form; or, when no control sets it or it names nothing here, its line in
  // the source.
  function sourceTarget(doc, path) {
    var m;
    var source = { source: path, path: path };
    doc = doc || {};
    if ((m = /^entities\.([^.[\]]+)\.parameters\.([^.[\]]+)$/.exec(path))) {
      return has(doc.entities, m[1]) ? { select: "entity/" + m[1], slot: m[2], path: path } : source;
    }
    if ((m = /^entities\.([^.[\]]+)\.defenses\.[^.[\]]+$/.exec(path))) {
      return has(doc.entities, m[1]) ? { select: "entity/" + m[1], field: "defense", path: path } : source;
    }
    if ((m = /^flows\.([^.[\]]+)\.parameters\.([^.[\]]+)$/.exec(path))) {
      return has(doc.flows, m[1]) ? { select: "flow/" + m[1], slot: m[2], path: path } : source;
    }
    // A route still being drawn: the flow, at its next hop.
    if ((m = /^flows\.([^.[\]]+)\.route(?:\[\d+\])?$/.exec(path))) {
      return has(doc.flows, m[1]) ? { select: "flow/" + m[1], field: "route", path: path } : source;
    }
    // A component or flow as a whole, or one of its ends.
    if ((m = /^(entities|flows)\.([^.[\]]+)(?:\.(?:source|target))?$/.exec(path))) {
      var kind = m[1] === "entities" ? "entity" : "flow";
      return has(doc[m[1]], m[2]) ? { select: kind + "/" + m[2], path: path } : source;
    }
    if ((m = /^associations\.([^.[\]]+)(?:\.([^.[\]]+))?$/.exec(path))) {
      if (!has(doc.associations, m[1])) return source;
      return m[2] ? { select: "association/" + m[1], field: m[2], path: path } : { select: "association/" + m[1], path: path };
    }
    var attacker = doc.attacker || {};
    if ((m = /^attacker\.footholds\[(\d+)\]$/.exec(path))) {
      var f = (attacker.footholds || [])[Number(m[1])];
      return f && has(doc.entities, f.entity) ? { select: "entity/" + f.entity, field: "foothold", path: path } : source;
    }
    if (path === "attacker.target" && attacker.target && has(doc.entities, attacker.target.entity)) {
      return { select: "entity/" + attacker.target.entity, field: "target", path: path };
    }
    return source;
  }

  var KIND = { input: "input", any: "fact", all: "action" };

  function unique(lists) {
    var out = [];
    lists.forEach(function (list) {
      (list || []).forEach(function (x) {
        if (out.indexOf(x) < 0) out.push(x);
      });
    });
    return out;
  }

  function supportOf(support, graph, id, at) {
    at = at || indexOf(graph);
    var entry = support && support.nodes && id in at ? support.nodes[at[id]] : null;
    return entry && entry.id === id ? entry : { status: null, missing: [] };
  }

  // Why a step is where it is, in a few words; null when nothing needs saying.
  function reasonOf(n, s) {
    if (s.status === "blocked") return "blocked · " + (n.timing.expression || "never") + (n.timing.paths.length ? " at " + n.timing.paths.join(", ") : "");
    if (s.status === "unreachable") return "nothing that can happen leads here";
    if (s.status === "seeded") return n.timing.status === "foothold" ? "at once · the attacker starts here" : "at once";
    if (s.missing && s.missing.length) return "time rests on unknown " + s.missing.join(", ");
    return null;
  }

  // What the inspector says about a step, or null for one not in the graph.
  // `at` (index(graph)) saves rebuilding the index for each of many steps.
  function inspect(graph, support, stepId, at) {
    at = at || indexOf(graph);
    var n = node(graph, stepId, at);
    if (!n) return null;
    var s = supportOf(support, graph, stepId, at);
    return {
      id: n.id,
      label: n.label,
      kind: KIND[n.kind] || n.kind,
      status: s.status,
      reason: reasonOf(n, s),
      timing: { status: n.timing.status, expression: n.timing.expression, note: n.timing.note },
      rules: unique([
        n.origins.map(function (o) {
          return o.rule;
        }),
      ]),
      components: unique(n.origins.map(function (o) {
        return o.entities;
      })),
      associations: unique(n.origins.map(function (o) {
        return o.associations;
      })),
      flows: unique(n.origins.map(function (o) {
        return o.flows;
      })),
      paths: unique(n.origins.map(function (o) {
        return o.paths;
      }).concat([n.timing.paths])),
      assumptions: unique(n.origins.map(function (o) {
        return o.assumptions;
      })),
      missing: (s.missing || []).slice(),
      inputs: n.inputs.slice(),
    };
  }

  // Every step whose label or id holds `query`, in graph order: the table
  // searches the whole graph, whatever the canvas shows.
  function search(graph, query) {
    var q = String(query || "").trim().toLowerCase();
    return ((graph && graph.nodes) || [])
      .filter(function (n) {
        return !q || n.label.toLowerCase().indexOf(q) >= 0 || n.id.toLowerCase().indexOf(q) >= 0;
      })
      .map(function (n) {
        return n.id;
      });
  }

  // Which steps a window around `seeds` holds: breadth first along edges in
  // either direction, in graph order, until `limit`. The whole graph when it
  // fits.
  function windowOf(graph, seeds, limit) {
    var n = graph.nodes.length;
    var keep = new Array(n).fill(n <= limit);
    if (n <= limit) return keep;
    var at = indexOf(graph);
    var near = graph.nodes.map(function () {
      return [];
    });
    graph.nodes.forEach(function (node, i) {
      node.inputs.forEach(function (input) {
        if (!(input in at)) return;
        near[i].push(at[input]);
        near[at[input]].push(i);
      });
    });
    var queue = [];
    seeds.forEach(function (id) {
      // More seeds than the canvas holds: the first `limit` of them.
      if (id in at && !keep[at[id]] && queue.length < limit) {
        keep[at[id]] = true;
        queue.push(at[id]);
      }
    });
    var count = queue.length;
    for (var head = 0; head < queue.length && count < limit; head++) {
      near[queue[head]].forEach(function (j) {
        if (count < limit && !keep[j]) {
          keep[j] = true;
          count++;
          queue.push(j);
        }
      });
    }
    return keep;
  }

  var TAGS = { blocked: "blocked", unreachable: "unreachable" };

  // `focus`: {id, limit} — a step id or a qualified component to keep in
  // view; without one the target. Returns {graph, shown, total}; the graph
  // given is not changed.
  function describe(graph, support, focus) {
    var nodes = (graph && graph.nodes) || [];
    var limit = focus && focus.limit ? focus.limit : LIMIT;
    var id = focus && focus.id;
    var at = indexOf(graph);
    var seeds = (!id ? [] : id.indexOf("step/") === 0 ? [id.slice(5)] : stepsFor(graph, id)).filter(function (s) {
      return s in at;
    });
    // A focus that names nothing here: round the target.
    if (!seeds.length) seeds = [graph.target];
    var keep = windowOf({ nodes: nodes }, seeds, limit);
    var hidden = nodes.map(function () {
      return 0;
    });
    var dependents = nodes.map(function () {
      return 0;
    });
    var edges = [];
    nodes.forEach(function (n, i) {
      n.inputs.forEach(function (input) {
        if (!(input in at)) return;
        var j = at[input];
        dependents[j]++;
        if (keep[i] && keep[j]) {
          // Prerequisite → dependent: the way the attack runs.
          edges.push({ id: "step/" + input + ">step/" + n.id, from: "step/" + input, to: "step/" + n.id });
        } else if (keep[i] !== keep[j]) {
          hidden[keep[i] ? i : j]++;
        }
      });
    });
    var drawn = [];
    nodes.forEach(function (n, i) {
      if (!keep[i]) return;
      var s = support && support.nodes && support.nodes[i] && support.nodes[i].id === n.id ? support.nodes[i] : { status: null, missing: [] };
      var unknown = n.timing.status === "unknown";
      var classes = ["kind-" + (KIND[n.kind] || n.kind)];
      if (s.status) classes.push("is-" + s.status);
      if (unknown) classes.push("is-unknown");
      drawn.push({
        id: "step/" + n.id,
        label: n.label,
        lines: layout.wrap(n.label, 22, 2),
        symbol: n.kind === "input" ? "basic" : "gate",
        inscription: n.kind === "all" ? "ALL" : n.kind === "any" ? "ANY" : null,
        attributes: hidden[i] ? "+" + hidden[i] + " not shown" : null,
        badge: n.id === graph.target ? "target" : n.timing.status === "foothold" ? "foothold" : null,
        tag: unknown ? "unknown" : TAGS[s.status] || null,
        classes: classes,
        parents: dependents[i],
        unquantified: unknown,
        top: n.id === graph.target,
        unreachable: s.status === "unreachable",
      });
    });
    return { graph: { profile: "attack-graph", nodes: drawn, edges: edges }, shown: drawn.length, total: nodes.length };
  }

  // A generated step is derived from the architecture and never edited:
  // what would edit one is refused with this, and what only looks is not.
  var LOOKS = ["select", "source", "focus"];
  function refuse(action) {
    return LOOKS.indexOf(action) >= 0 ? null : "generated steps are read-only · edit the architecture";
  }

  // Does a control with this tag take `key` for itself? A field takes
  // every key; a button those that press it, and Tab, which moves on.
  function ownsKey(tag, key) {
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) return true;
    return tag === "BUTTON" && (key === "Enter" || key === " " || key === "Tab");
  }

  var api = {
    LIMIT: LIMIT,
    ownsKey: ownsKey,
    refuse: refuse,
    stepsFor: stepsFor,
    stepsForEntity: stepsForEntity,
    sourcesForStep: sourcesForStep,
    originOf: originOf,
    sourceTarget: sourceTarget,
    index: indexOf,
    inspect: inspect,
    search: search,
    describe: describe,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorAttackView = api;
})();
