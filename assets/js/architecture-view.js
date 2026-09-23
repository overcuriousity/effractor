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
    // `label`: a few words on the line — the relation, and its privilege;
    // a flow's name and its direction.
    function edge(id, from, to, kind, label) {
      // A dangling end is a diagnostic elsewhere; here it is just no edge.
      if (!has(entities, from) || !has(entities, to)) return;
      incoming[to] = (incoming[to] || 0) + 1;
      edges.push({ id: id, from: "entity/" + from, to: "entity/" + to, kind: kind, label: label });
    }
    Object.keys(doc.associations || {}).forEach(function (id) {
      var a = doc.associations[id];
      if (a.kind === "permits") return;
      // The file names the network first; the line runs from the machine to
      // the network it is managed from, so it cannot read "network manages".
      if (a.kind === "administration") return edge("association/" + id, a.to, a.from, a.kind, "managed from");
      edge("association/" + id, a.from, a.to, a.kind, a.privilege ? a.kind + " · " + a.privilege : a.kind);
    });
    Object.keys(doc.flows || {}).forEach(function (id) {
      var f = doc.flows[id];
      edge("flow/" + id, f.source, f.target, "flow", String(f.label == null ? id : f.label) + " →");
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
        // The kind is the icon; what is still unknown is a count on it.
        attributes: null,
        unknown: open,
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
