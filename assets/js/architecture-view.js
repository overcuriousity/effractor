// Architecture → what is drawn: the shared renderer's {profile, nodes, edges},
// with components as their kinds' icons and their relationships and flows as the
// edges. Pure: no DOM, no ELK. The canvas never stores a position.
(function () {
  var graph = typeof module !== "undefined" ? require("./graph.js") : window.effractorGraph;

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  function unknowns(entity) {
    var parameters = entity.parameters || {};
    return Object.keys(parameters).filter(function (slot) {
      return parameters[slot] && parameters[slot].status === "unknown";
    }).length;
  }

  // Where the attacker starts and what it is after, as pins on components:
  // each its own, so one can be picked up and dragged elsewhere.
  function pins(doc) {
    var out = Object.create(null);
    var attacker = doc.attacker || {};
    function put(entity, role, state) {
      (out[entity] = out[entity] || []).push({ role: role, state: state });
    }
    (attacker.footholds || []).forEach(function (s) {
      put(s.entity, "foothold", s.state);
    });
    if (attacker.target) put(attacker.target.entity, "target", attacker.target.state);
    return out;
  }

  // Relations whose file term reads backwards along the arrow ("account
  // authorizes service"), said the way the arrow runs instead.
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

  function describe(doc) {
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
      edge("association/" + id, a.from, a.to, a.kind, ALONG[a.kind] ? ALONG[a.kind](a) : term, term);
    });
    Object.keys(doc.flows || {}).forEach(function (id) {
      var f = doc.flows[id];
      edge("flow/" + id, f.source, f.target, "flow", String(f.label == null ? id : f.label), "flow");
    });

    var pinned = pins(doc);
    var nodes = Object.keys(entities).map(function (id) {
      var e = entities[id];
      var label = String(e.label == null ? id : e.label);
      var open = unknowns(e);
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
        parents: incoming[id] || 0,
        unquantified: open > 0,
        top: false,
        unreachable: false,
      };
    });
    return { profile: "architecture", nodes: nodes, edges: edges, permits: permits };
  }

  var api = { describe: describe, route: route };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorArchitectureView = api;
})();
