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
    // Nothing chosen yet: the page offers the components to choose from.
    if (path === "attacker.target" && !attacker.target) return { pick: "target", path: path };
    if (path === "attacker.footholds" && !(attacker.footholds || []).length) return { pick: "foothold", path: path };
    return source;
  }

  // How step `id` was reached, to light it: back along the simulated path
  // (`witness`, the solver's) to the foothold when the step is on it, else
  // the step and what it needs directly. {nodes, edges}, drawn ids
  // ("step/…", "step/a>step/b"). A walk over a queue: paths may be long.
  function lineage(graph, witness, id) {
    var n = node(graph, id);
    if (!n) return { nodes: [], edges: [] };
    var inputs = Object.create(null);
    var onPath = false;
    ((witness && witness.edges) || []).forEach(function (e) {
      (inputs[e.dependent] = inputs[e.dependent] || []).push(e.prerequisite);
    });
    ((witness && witness.nodes) || []).forEach(function (w) {
      if (w.id === id) onPath = true;
    });
    var nodes = [], edges = [];
    if (!onPath) {
      nodes.push("step/" + id);
      n.inputs.forEach(function (input) {
        if (!node(graph, input)) return;
        nodes.push("step/" + input);
        edges.push("step/" + input + ">step/" + id);
      });
      return { nodes: nodes, edges: edges };
    }
    var seen = Object.create(null);
    var queue = [id];
    seen[id] = true;
    while (queue.length) {
      var at = queue.shift();
      nodes.push("step/" + at);
      (inputs[at] || []).forEach(function (input) {
        edges.push("step/" + input + ">step/" + at);
        if (!seen[input]) {
          seen[input] = true;
          queue.push(input);
        }
      });
    }
    return { nodes: nodes, edges: edges };
  }

  // Where a step can be walked to: what it needs (down the drawing) and
  // what needs it (up, towards the target), each in graph order.
  function neighbours(graph, id) {
    var n = node(graph, id);
    if (!n) return { prerequisites: [], dependents: [] };
    var at = indexOf(graph);
    return {
      prerequisites: n.inputs.filter(function (i) { return i in at; }),
      dependents: graph.nodes.filter(function (m) { return m.inputs.indexOf(id) >= 0; }).map(function (m) { return m.id; }),
    };
  }

  // A witness's steps in the order they were done: by time, and among
  // those done at once, what is needed before what needs it (the solver
  // breaks such ties by id). [{id, time}].
  function inOrder(witness) {
    var nodes = (witness && witness.nodes) || [];
    var waiting = Object.create(null), after = Object.create(null), pos = Object.create(null);
    nodes.forEach(function (n, i) {
      waiting[n.id] = 0;
      after[n.id] = [];
      pos[n.id] = i;
    });
    ((witness && witness.edges) || []).forEach(function (e) {
      if (!(e.prerequisite in pos) || !(e.dependent in pos)) return;
      waiting[e.dependent]++;
      after[e.prerequisite].push(e.dependent);
    });
    var ready = nodes.filter(function (n) { return !waiting[n.id]; });
    var out = [];
    while (ready.length) {
      // The earliest, then the solver's own order.
      ready.sort(function (a, b) { return a.time - b.time || pos[a.id] - pos[b.id]; });
      var n = ready.shift();
      out.push(n);
      after[n.id].forEach(function (d) {
        if (!--waiting[d]) ready.push(nodes[pos[d]]);
      });
    }
    // A cycle the solver would not send: what is left, as it came.
    nodes.forEach(function (n) {
      if (out.indexOf(n) < 0) out.push(n);
    });
    return out;
  }

  // The simulated path's steps in the order they were done; inputs are
  // where it starts, not steps taken.
  function pathSteps(witness) {
    return inOrder(witness).map(function (w) { return w.id; }).filter(function (id) {
      return id.indexOf("input/") !== 0;
    });
  }

  // A route as a way through the architecture (`doc`): where it starts (its
  // footholds), then each component its steps are about in the order they
  // were done — a flow as what it runs from, the networks and routers it
  // crosses, itself and what it reaches — and the target last. Each once.
  function routeStops(graph, witness, doc) {
    var out = [];
    function add(id) {
      if (id && out.indexOf(id) < 0) out.push(id);
    }
    var steps = inOrder(witness);
    steps.forEach(function (w) {
      if (w.id.indexOf("input/foothold/") === 0) add(originOf(graph, w.id));
    });
    // Conditions, not places: an input other than a foothold (a policy, a
    // permission), and what follows from conditions alone (MFA satisfied
    // by policy). The firewall still lies on its flow's way.
    var needs = Object.create(null);
    ((witness && witness.edges) || []).forEach(function (e) {
      (needs[e.dependent] = needs[e.dependent] || []).push(e.prerequisite);
    });
    var condition = Object.create(null);
    steps.forEach(function (w) {
      var from = needs[w.id] || [];
      condition[w.id] = w.id.indexOf("input/") === 0
        ? w.id.indexOf("input/foothold/") !== 0
        : from.length > 0 && from.every(function (p) { return condition[p]; });
    });
    steps.forEach(function (w) {
      if (condition[w.id] || w.id.indexOf("input/") === 0) return;
      var at = originOf(graph, w.id);
      var f = at && at.indexOf("flow/") === 0 && doc && has(doc.flows, at.slice(5)) ? doc.flows[at.slice(5)] : null;
      if (!f) return add(at);
      add("entity/" + f.source);
      (f.route || []).forEach(function (hop) {
        add("entity/" + hop);
      });
      add(at);
      add("entity/" + f.target);
    });
    var target = doc && doc.attacker && doc.attacker.target ? "entity/" + doc.attacker.target.entity : null;
    if (target && out.indexOf(target) >= 0) {
      out.splice(out.indexOf(target), 1);
      out.push(target);
    }
    return out;
  }

  // The components (or flows) a list of steps is about, each once, in order.
  function componentsOf(graph, ids) {
    var out = [];
    ids.forEach(function (id) {
      var at = originOf(graph, id);
      if (at && out.indexOf(at) < 0) out.push(at);
    });
    return out;
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
  // either direction, in graph order, until `limit`. All of them when they
  // fit. `allowed` (a mask, optional): the only steps it may hold.
  function windowOf(graph, seeds, limit, allowed) {
    var n = graph.nodes.length;
    var ok = function (i) {
      return !allowed || allowed[i];
    };
    var room = allowed ? allowed.filter(Boolean).length : n;
    var keep = graph.nodes.map(function (_, i) {
      return room <= limit && ok(i);
    });
    if (room <= limit) return keep;
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
      if (id in at && ok(at[id]) && !keep[at[id]] && queue.length < limit) {
        keep[at[id]] = true;
        queue.push(at[id]);
      }
    });
    var count = queue.length;
    for (var head = 0; head < queue.length && count < limit; head++) {
      near[queue[head]].forEach(function (j) {
        if (count < limit && !keep[j] && ok(j)) {
          keep[j] = true;
          count++;
          queue.push(j);
        }
      });
    }
    return keep;
  }

  var TAGS = { blocked: "blocked", unreachable: "unreachable" };

  // A folded fact under its producer's name: the parts of its label ("SSH
  // server · reachable") the producer's does not already say; its last
  // part when it says them all.
  function factLine(producer, fact) {
    var said = producer.split(" · ");
    var parts = fact.split(" · ");
    var left = parts.filter(function (p) {
      return said.indexOf(p) < 0;
    });
    return (left.length ? left : parts.slice(-1)).join(" · ");
  }

  // `focus`: {id, limit, onlySupport} — a step id or a qualified component
  // to keep in view, without one the target; `onlySupport`: only the steps
  // that lead to the target (support.target_support), unless the focus is
  // elsewhere or nothing leads there. Returns {graph, shown, total,
  // elsewhere}; the graph given is not changed.
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
    var leads = focus && focus.onlySupport && support && (support.target_support || []).length ? Object.create(null) : null;
    if (leads) {
      support.target_support.forEach(function (s) {
        leads[s] = true;
      });
      if (!seeds.every(function (s) { return leads[s]; })) leads = null;
    }
    var allowed = leads ? nodes.map(function (n) { return !!leads[n.id]; }) : null;
    var keep = windowOf({ nodes: nodes }, seeds, limit, allowed);
    var hidden = nodes.map(function () {
      return 0;
    });
    // Which box each step is drawn in (spec §11): a fact with one producer,
    // both in the window, in its producer's — along a chain of such facts,
    // the first step that is not one. The target stays itself, nothing is
    // drawn in it, and a cycle of such facts is drawn as it is.
    var targetAt = graph.target in at ? at[graph.target] : -1;
    var foldsInto = nodes.map(function (n, i) {
      var p = n.inputs.length === 1 && n.inputs[0] in at ? at[n.inputs[0]] : -1;
      return n.kind === "any" && p >= 0 && keep[i] && keep[p] && i !== targetAt && p !== targetAt ? p : -1;
    });
    var box = nodes.map(function (_, i) {
      var seen = Object.create(null);
      var j = i;
      while (foldsInto[j] >= 0) {
        seen[j] = true;
        j = foldsInto[j];
        if (seen[j]) return i;
      }
      return j;
    });
    var drawnAs = Object.create(null);
    var members = nodes.map(function () {
      return [];
    });
    nodes.forEach(function (n, i) {
      if (!keep[i] || box[i] === i) return;
      members[box[i]].push(i);
      drawnAs["step/" + n.id] = "step/" + nodes[box[i]].id;
    });
    var edges = [];
    var edgeAt = Object.create(null);
    var out = nodes.map(function () {
      return 0;
    });
    nodes.forEach(function (n, i) {
      n.inputs.forEach(function (input) {
        if (!(input in at)) return;
        var j = at[input];
        var id = "step/" + input + ">step/" + n.id;
        if (keep[i] && keep[j]) {
          var from = box[j], to = box[i];
          // A line inside a box is drawn as the box.
          if (from === to) return void (drawnAs[id] = "step/" + nodes[from].id);
          // Prerequisite → dependent: the way the attack runs; lines between
          // the same two boxes are one.
          var drawn = "step/" + nodes[from].id + ">step/" + nodes[to].id;
          if (!edgeAt[drawn]) {
            edgeAt[drawn] = { id: drawn, from: "step/" + nodes[from].id, to: "step/" + nodes[to].id };
            edges.push(edgeAt[drawn]);
            out[from]++;
          }
          if (id !== drawn) {
            (edgeAt[drawn].aliases = edgeAt[drawn].aliases || []).push(id);
            drawnAs[id] = drawn;
          }
        } else if (keep[i] !== keep[j]) {
          hidden[box[keep[i] ? i : j]]++;
        }
      });
    });
    // The steps every way to the target needs (the module's, when checked).
    var choke = Object.create(null);
    ((support && support.chokepoints) || []).forEach(function (c) {
      choke[c] = true;
    });
    var drawnNodes = [];
    var shown = 0;
    nodes.forEach(function (n, i) {
      if (!keep[i]) return;
      shown++;
      if (box[i] !== i) return;
      var s = support && support.nodes && support.nodes[i] && support.nodes[i].id === n.id ? support.nodes[i] : { status: null, missing: [] };
      var unknown = n.timing.status === "unknown";
      var inside = members[i];
      var everyRoute = choke[n.id] || inside.some(function (k) { return choke[nodes[k].id]; });
      var classes = ["kind-" + (KIND[n.kind] || n.kind)];
      if (s.status) classes.push("is-" + s.status);
      if (unknown) classes.push("is-unknown");
      if (everyRoute) classes.push("is-choke");
      var lines = layout.wrap(n.label, 22, 2);
      if (inside.length) {
        classes.push("is-folded");
        // Its own name on one line, then the fact it makes, the one right
        // on it first, and how many more.
        var first = inside.filter(function (k) { return foldsInto[k] === i; })[0];
        var more = inside.length > 1 ? " +" + (inside.length - 1) : "";
        lines = [layout.wrap(n.label, 22, 1)[0], layout.wrap(factLine(n.label, nodes[first].label), 22 - more.length, 1)[0] + more];
      }
      var item = {
        id: "step/" + n.id,
        label: [n.label].concat(inside.map(function (k) { return nodes[k].label; })).join("\n"),
        lines: lines,
        symbol: n.kind === "input" ? "basic" : "gate",
        inscription: n.kind === "all" ? "ALL" : n.kind === "any" ? "ANY" : null,
        attributes: hidden[i] ? "+" + hidden[i] + " not shown" : null,
        badge: n.id === graph.target ? "target" : n.timing.status === "foothold" ? "foothold" : null,
        tag: unknown ? "unknown" : TAGS[s.status] || (everyRoute ? "every route" : null),
        classes: classes,
        parents: out[i],
        unquantified: unknown,
        top: n.id === graph.target,
        unreachable: s.status === "unreachable",
      };
      if (inside.length) {
        item.aliases = inside.map(function (k) {
          return "step/" + nodes[k].id;
        });
      }
      drawnNodes.push(item);
    });
    var elsewhere = allowed ? allowed.filter(function (a) { return !a; }).length : 0;
    return { graph: { profile: "attack-graph", nodes: drawnNodes, edges: edges }, shown: shown, total: nodes.length, elsewhere: elsewhere, drawnAs: drawnAs };
  }

  // Which states a drawing holds, for a legend that says only those.
  function statesIn(drawn) {
    var out = { seeded: false, unreachable: false };
    ((drawn && drawn.nodes) || []).forEach(function (n) {
      if (n.classes.indexOf("is-seeded") >= 0) out.seeded = true;
      if (n.classes.indexOf("is-unreachable") >= 0) out.unreachable = true;
    });
    return out;
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
    originOf: originOf,
    sourceTarget: sourceTarget,
    lineage: lineage,
    neighbours: neighbours,
    pathSteps: pathSteps,
    inOrder: inOrder,
    routeStops: routeStops,
    componentsOf: componentsOf,
    index: indexOf,
    inspect: inspect,
    search: search,
    describe: describe,
    statesIn: statesIn,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorAttackView = api;
})();
