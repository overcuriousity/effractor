// Architecture → what is drawn: the shared renderer's {profile, nodes, edges},
// with components as neutral boxes and their relationships and flows as the
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

  function badges(doc) {
    var out = Object.create(null);
    var attacker = doc.attacker || {};
    (attacker.footholds || []).forEach(function (s) {
      out[s.entity] = "foothold · " + s.state;
    });
    if (attacker.target) out[attacker.target.entity] = "target · " + attacker.target.state;
    return out;
  }

  function describe(doc) {
    var entities = doc.entities || {};
    var edges = [];
    var incoming = Object.create(null);
    function edge(id, from, to, kind) {
      // A dangling end is a diagnostic elsewhere; here it is just no edge.
      if (!has(entities, from) || !has(entities, to)) return;
      incoming[to] = (incoming[to] || 0) + 1;
      edges.push({ id: id, from: "entity/" + from, to: "entity/" + to, kind: kind });
    }
    Object.keys(doc.associations || {}).forEach(function (id) {
      var a = doc.associations[id];
      if (a.kind !== "permits") edge("association/" + id, a.from, a.to, a.kind);
    });
    Object.keys(doc.flows || {}).forEach(function (id) {
      var f = doc.flows[id];
      edge("flow/" + id, f.source, f.target, "flow");
    });

    var badge = badges(doc);
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
        attributes: e.kind + (open ? " · " + open + " unknown" : ""),
        badge: badge[id] || null,
        parents: incoming[id] || 0,
        unquantified: open > 0,
        top: false,
        unreachable: false,
      };
    });
    return { profile: "architecture", nodes: nodes, edges: edges };
  }

  var api = { describe: describe };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorArchitectureView = api;
})();
