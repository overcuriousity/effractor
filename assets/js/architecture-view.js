// Architecture → what is drawn: the shared renderer's {profile, nodes, edges},
// with components as their kinds' icons and their relationships and flows as the
// edges. Pure: no DOM, no ELK. The canvas never stores a position.
(function () {
  var graph = typeof module !== "undefined" ? require("./graph.js") : window.effractorGraph;
  var C = typeof module !== "undefined" ? require("./clusters.js") : window.effractorClusters;

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
      (out[entity] = out[entity] || []).push({ role: role, state: state, entity: entity, word: word ? word(state) : state });
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
    var found = vulnerable(doc);
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
        rings: found.why[id] ? [{ state: found.own[id] ? "vulnerable" : "exposed", why: found.why[id].join("\n") }] : [],
        parents: incoming[id] || 0,
        unquantified: open > 0,
        top: false,
        unreachable: false,
      };
    });
    return fold(doc, { profile: "architecture", nodes: nodes, edges: edges, permits: permits });
  }

  // Closed clusters as one node each (clustering spec §4): their members'
  // lines drawn to them, merged per pair of drawn ends, inner ones hidden;
  // open ones listed for their outlines. `hidden` says where a member is
  // drawn, `bundles` what each merged line or permission holds.
  function fold(doc, d) {
    var hidden = Object.create(null), groups = [], closed = [];
    Object.keys(doc.clusters || {}).forEach(function (cid) {
      var members = (doc.clusters[cid].members || []).filter(function (m) {
        return has(doc.entities, m);
      });
      if (members.length < 2) return; // the validator says so; drawn as components meanwhile
      // A closed cluster stacks its members but those drawn beside it, all
      // inside one outline with the stack.
      var beside = (doc.clusters[cid].shown || []).filter(function (m) {
        return members.indexOf(m) >= 0;
      });
      var stacked = members.filter(function (m) {
        return beside.indexOf(m) < 0;
      });
      if (doc.clusters[cid].closed === true && stacked.length) {
        stacked.forEach(function (m) {
          hidden[m] = "cluster/" + cid;
        });
        closed.push({ cid: cid, members: stacked });
        if (beside.length) groups.push({ id: "cluster/" + cid, label: C.label(doc, cid), members: ["cluster/" + cid].concat(beside.map(function (m) { return "entity/" + m; })) });
      } else {
        groups.push({ id: "cluster/" + cid, label: C.label(doc, cid), members: members.map(function (m) { return "entity/" + m; }) });
      }
    });
    var byId = Object.create(null);
    d.nodes.forEach(function (n) {
      byId[n.id] = n;
    });
    function drawn(id) {
      var entity = id.indexOf("entity/") === 0 ? id.slice(7) : null;
      return entity !== null && hidden[entity] ? hidden[entity] : id;
    }
    var nodes = d.nodes.filter(function (n) {
      return !hidden[n.id.slice(7)];
    });
    closed.forEach(function (c) {
      nodes.push(clusterNode(doc, c.cid, c.members.map(function (m) { return byId["entity/" + m]; })));
    });

    var bundles = Object.create(null), edges = [], merged = Object.create(null), lineOf = Object.create(null);
    d.edges.forEach(function (e) {
      var from = drawn(e.from), to = drawn(e.to);
      if (from === to) return;
      if (from === e.from && to === e.to) {
        lineOf[e.id] = e.id;
        return edges.push(e);
      }
      var key = (e.kind === "flow" ? "flows/" : "links/") + from + ">" + to;
      lineOf[e.id] = key;
      if (!merged[key]) {
        merged[key] = { at: edges.length, members: [] };
        edges.push(null);
      }
      merged[key].members.push(Object.assign({}, e, { from: from, to: to }));
    });
    Object.keys(merged).forEach(function (key) {
      var m = merged[key].members;
      if (m.length === 1) {
        lineOf[m[0].id] = m[0].id;
        edges[merged[key].at] = m[0];
        return;
      }
      var flows = key.indexOf("flows/") === 0;
      bundles[key] = m.map(function (e) { return e.id; });
      edges[merged[key].at] = {
        id: key,
        from: m[0].from,
        to: m[0].to,
        kind: flows ? "flow" : "bundle",
        label: m.length + (flows ? " flows" : " links"),
        title: m.map(function (e) { return e.label; }).join("\n"),
      };
    });

    // A permission from the firewall, or its cluster, to a closed cluster
    // holding an end of its flow (the target's first), else to the flow's line.
    var permits = [], toNode = Object.create(null);
    d.permits.forEach(function (p) {
      var f = doc.flows[p.flow.slice(5)];
      var firewall = drawn(p.firewall);
      var s = drawn("entity/" + f.source), t = drawn("entity/" + f.target);
      var node = t.indexOf("cluster/") === 0 ? t : s.indexOf("cluster/") === 0 ? s : null;
      if (!node) {
        var line = lineOf[p.flow];
        if (line) permits.push(Object.assign({}, p, { firewall: firewall, flow: line }));
        return;
      }
      if (node === firewall) {
        // Firewall and one end in one cluster: the flow still leaves it, on
        // its line; firewall and the whole flow inside: nothing to draw.
        if (s !== t && lineOf[p.flow]) permits.push(Object.assign({}, p, { firewall: firewall, flow: lineOf[p.flow] }));
        return;
      }
      var key = "permits/" + firewall + ">" + node;
      if (!toNode[key]) {
        toNode[key] = { id: p.id, firewall: firewall, node: node, allowed: p.allowed, members: [] };
        permits.push(toNode[key]);
      }
      var m = toNode[key];
      if (m.members.length && m.allowed !== p.allowed) m.allowed = null;
      m.members.push(p.id);
    });
    permits.forEach(function (p) {
      if (!p.members) return;
      if (p.members.length > 1) {
        p.id = "permits/" + p.firewall + ">" + p.node;
        p.label = p.members.length + " permissions";
        bundles[p.id] = p.members;
      }
      delete p.members;
    });
    return { profile: d.profile, nodes: nodes, edges: edges, permits: permits, hidden: hidden, bundles: bundles, groups: groups };
  }

  // A closed cluster's node: the most specific member's icon, its members'
  // states as the ring's sectors, their unknowns summed, their pins.
  function clusterNode(doc, cid, members) {
    var label = C.label(doc, cid);
    var states = members.map(function (m) {
      return m.rings.length ? m.rings[0].state : m.unknown > 0 ? "unknown" : null;
    });
    var unknown = members.reduce(function (sum, m) { return sum + m.unknown; }, 0);
    var why = members.filter(function (m) { return m.rings.length; }).map(function (m) {
      return m.rings.map(function (r) { return r.why; }).join("\n");
    });
    var rings = why.length ? [{ state: states.indexOf("vulnerable") >= 0 ? "vulnerable" : "exposed", why: why.join("\n") }] : [];
    var open = states.filter(function (s) { return s === "unknown"; }).length;
    if (open) rings.push({ state: "unknown", why: open + (open === 1 ? " member" : " members") + " with unknown inputs" });
    return {
      id: "cluster/" + cid,
      label: label,
      lines: graph.wrap(label + " · " + members.length, 22, 2),
      symbol: "component",
      component: C.lead(doc, members.map(function (m) { return m.id.slice(7); })),
      inscription: null,
      attributes: null,
      unknown: unknown,
      badge: null,
      pins: members.reduce(function (all, m) { return all.concat(m.pins); }, []),
      rings: rings,
      cluster: { count: members.length, states: states },
      parents: 0,
      unquantified: unknown > 0,
      top: false,
      unreachable: false,
    };
  }

  // Why each component is ringed (owner, 2026-09-24, after Reactor's
  // exposure ring): vulnerable, a product whose patch is off, with the reason
  // given for finding an exploit (an nmap finding); exposed (owner,
  // 2026-09-25: a colour of its own, so one finding reads as one), the
  // software running it and the host running that software. `own`: the
  // vulnerable ones.
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
    return { why: out, own: own };
  }

  var api = { describe: describe, route: route, shownSlots: shownSlots, shownDefense: shownDefense };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorArchitectureView = api;
})();
