// Architecture → what is drawn: the shared renderer's {profile, nodes, edges},
// with components as their kinds' icons and their relationships and flows as the
// edges. Pure: no DOM, no ELK. The canvas never stores a position.
(function () {
  var graph = typeof module !== "undefined" ? require("./graph.js") : window.effractorGraph;

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  function linkedTo(doc, kind, id) {
    return Object.keys(doc.associations || {}).some(function (k) {
      var a = doc.associations[k];
      return a.kind === kind && a.to === id;
    });
  }

  // Software processes content only where content is said to reach it: a
  // network delivers to it, or it reads data.
  function reader(doc, id) {
    return linkedTo(doc, "delivers", id) || Object.keys(doc.associations || {}).some(function (k) {
      var a = doc.associations[k];
      return a.kind === "reads" && a.from === id;
    });
  }

  var TAKE_OVER = ["take-over", "take-over-guarded"];

  // The slots worth showing: an escape only where there is a host to escape
  // to, a take-over only where content reaches the software.
  function shownSlots(doc, id) {
    var e = doc.entities[id];
    var hosted = linkedTo(doc, "hosts", id);
    var reads = reader(doc, id);
    return Object.keys((e && e.parameters) || {}).filter(function (slot) {
      if (slot === "escape") return hosted;
      if (TAKE_OVER.indexOf(slot) >= 0) return reads;
      return true;
    });
  }

  // The defence switch worth showing, or null: guarding software matters
  // only where content reaches it.
  function shownDefense(doc, id) {
    var e = doc.entities[id];
    var defense = Object.keys((e && e.defenses) || {})[0] || null;
    if (defense === "guarded" && !reader(doc, id)) return null;
    return defense;
  }

  function unknowns(doc, id) {
    var parameters = doc.entities[id].parameters || {};
    return shownSlots(doc, id).filter(function (slot) {
      return parameters[slot] && parameters[slot].status === "unknown";
    }).length;
  }

  // Where the attacker starts and what it is after, as pins on components:
  // each its own, so one can be picked up and dragged elsewhere.
  // `word(state)`, when given, is what the pin says for the state.
  function pins(doc, word) {
    var out = Object.create(null);
    var attacker = doc.attacker || {};
    function put(entity, role, state) {
      (out[entity] = out[entity] || []).push({ role: role, state: state, word: word ? word(state) : state });
    }
    (attacker.footholds || []).forEach(function (s) {
      put(s.entity, "foothold", s.state);
    });
    if (attacker.target) put(attacker.target.entity, "target", attacker.target.state);
    return out;
  }

  // Relations whose file term reads backwards or as an id along the arrow
  // ("account authorizes service", "instance-of"), said the way the arrow
  // runs in plain words instead.
  var ALONG = {
    authorizes: function () {
      return "may log in to";
    },
    grants: function (a) {
      return (a.privilege || "") + " on";
    },
    filters: function () {
      return "filtered by";
    },
    authenticates: function (a) {
      return a.factor === "second" ? "second factor for" : "authenticates";
    },
    "instance-of": function () {
      return "is an instance of";
    },
    "runs-as": function (a) {
      return "runs as" + (a.privilege ? " · " + a.privilege : "");
    },
    assumes: function () {
      return "may become";
    },
    operates: function () {
      return "uses";
    },
    delivers: function () {
      return "reaches";
    },
    holds: function (a) {
      return "holds" + (a.privilege === "admin" ? " · admin" : "") + (a.decrypts === false ? " · ciphertext only" : "");
    },
    accesses: function (a) {
      return a.mode === "write" ? "may read and write" : "may read";
    },
    "encrypted-with": function () {
      return "encrypted with";
    },
    reads: function () {
      return "reads";
    },
  };

  // The networks and routers a flow passes through, as drawn ids.
  function route(doc, flowId) {
    var f = has(doc.flows, flowId) ? doc.flows[flowId] : null;
    return f
      ? (f.route || []).filter(function (hop) {
          return has(doc.entities, hop);
        }).map(function (hop) {
          return "entity/" + hop;
        })
      : [];
  }

  // `word(state)`: optional, the pins' words for a state (the catalog's).
  function describe(doc, word) {
    var entities = doc.entities || {};
    var edges = [];
    var permits = [];
    var incoming = Object.create(null);
    // `label`: a few words on the line, read along its arrow — the relation,
    // and its privilege; a flow's name. `title` is the file's own term.
    function edge(id, from, to, kind, label, title) {
      // A dangling end is a diagnostic elsewhere; here it is just no edge.
      if (!has(entities, from) || !has(entities, to)) return;
      incoming[to] = (incoming[to] || 0) + 1;
      edges.push({ id: id, from: "entity/" + from, to: "entity/" + to, kind: kind, label: label, title: title || label });
    }
    Object.keys(doc.associations || {}).forEach(function (id) {
      var a = doc.associations[id];
      // A firewall rules on a flow, which is a line, not a component: its
      // permission is drawn from the firewall to that line.
      if (a.kind === "permits") {
        if (has(entities, a.from) && has(doc.flows, a.to) && has(entities, doc.flows[a.to].source) && has(entities, doc.flows[a.to].target)) {
          permits.push({ id: "association/" + id, firewall: "entity/" + a.from, flow: "flow/" + a.to, allowed: a.allowed === true ? true : a.allowed === false ? false : null });
        }
        return;
      }
      // The file names the network first; the line runs from the machine to
      // the network it is managed from, so it cannot read "network manages".
      if (a.kind === "administration") return edge("association/" + id, a.to, a.from, a.kind, "managed from", "administration");
      var term = a.privilege ? a.kind + " · " + a.privilege : a.kind;
      if (a.kind === "hosts" && a.contained === true) term += " · contained";
      edge("association/" + id, a.from, a.to, a.kind, ALONG[a.kind] ? ALONG[a.kind](a) : term, term);
    });
    Object.keys(doc.flows || {}).forEach(function (id) {
      var f = doc.flows[id];
      edge("flow/" + id, f.source, f.target, "flow", String(f.label == null ? id : f.label), "flow");
    });

    var pinned = pins(doc, word);
    var exposed = vulnerable(doc);
    var nodes = Object.keys(entities).map(function (id) {
      var e = entities[id];
      var label = String(e.label == null ? id : e.label);
      var open = unknowns(doc, id);
      return {
        id: "entity/" + id,
        label: label,
        lines: graph.wrap(label, 22, 2),
        symbol: "component",
        component: e.kind,
        inscription: null,
        // The kind is the icon; what is still unknown is a count on it.
        attributes: null,
        unknown: open,
        badge: null,
        pins: pinned[id] || [],
        rings: exposed[id] ? [{ state: "vulnerable", why: exposed[id].join("\n") }] : [],
        parents: incoming[id] || 0,
        unquantified: open > 0,
        top: false,
        unreachable: false,
      };
    });
    return { profile: "architecture", nodes: nodes, edges: edges, permits: permits };
  }

  // Why each component is vulnerable (owner, 2026-09-24, after Reactor's
  // exposure ring): a product whose patch is off, with the reason given for
  // finding an exploit (an nmap finding); the software running it; and the
  // host running that software.
  function vulnerable(doc) {
    var entities = doc.entities || {};
    var out = Object.create(null);
    function add(id, lines) {
      out[id] = out[id] || [];
      lines.forEach(function (l) { if (out[id].indexOf(l) < 0) out[id].push(l); });
    }
    var own = Object.create(null);
    Object.keys(entities).forEach(function (id) {
      var e = entities[id];
      if (e.kind !== "product" || !e.defenses || e.defenses.patched !== false) return;
      var p = e.parameters && e.parameters["find-exploit"];
      own[id] = ["vulnerable: " + String(e.label == null ? id : e.label) + " unpatched"].concat(p && p.note ? [p.note] : []);
      add(id, own[id]);
    });
    var associations = Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; });
    var software = Object.create(null);
    associations.forEach(function (a) {
      if (a.kind === "instance-of" && own[a.to] && has(entities, a.from)) {
        add(a.from, own[a.to]);
        software[a.from] = true;
      }
    });
    associations.forEach(function (a) {
      if (a.kind === "hosts" && software[a.to] && has(entities, a.from) && entities[a.from].kind === "host") add(a.from, out[a.to]);
    });
    return out;
  }

  var api = { describe: describe, route: route, shownSlots: shownSlots, shownDefense: shownDefense };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorArchitectureView = api;
})();
