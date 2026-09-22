// What a document's profile allows. A tree's selection is a node id; an
// architecture's is qualified — `entity/…`, `flow/…`, `association/…`,
// `step/…` — so no page code mistakes one for the other. Pure.
(function () {
  function has(object, key) {
    return !!object && Object.prototype.hasOwnProperty.call(object, key);
  }

  function isArchitecture(doc) {
    return !!doc && doc.profile === "architecture";
  }

  // "entity/web" → {kind: "entity", id: "web"}; anything unqualified → null.
  function qualified(id) {
    var at = typeof id === "string" ? id.indexOf("/") : -1;
    return at > 0 ? { kind: id.slice(0, at), id: id.slice(at + 1) } : null;
  }

  var MAPS = { entity: "entities", flow: "flows", association: "associations" };

  // `graph`: the generated attack graph, once there is one.
  function selectionExists(doc, id, graph) {
    if (!doc || !id) return false;
    if (!isArchitecture(doc)) return has(doc.nodes, id);
    var q = qualified(id);
    if (!q) return false;
    if (q.kind === "step") return !!graph && has(graph.nodes, q.id);
    return has(MAPS, q.kind) && has(doc[MAPS[q.kind]], q.id);
  }

  // Unfinished architecture analyses stay off here until their UI exists,
  // whatever the wasm module could already do.
  function capabilities(doc) {
    var arch = isArchitecture(doc);
    return {
      architecture: arch,
      generate: false,
      solve: !arch,
      exact: !arch,
      cutSets: !arch,
      loss: !arch,
      pareto: !!doc && doc.profile === "attack-tree",
      controls: !arch,
    };
  }

  var NEUTRAL = ["undo", "redo"];
  function treeActionAllowed(doc, action) {
    return !isArchitecture(doc) || NEUTRAL.indexOf(action) >= 0;
  }

  var api = { isArchitecture: isArchitecture, qualified: qualified, selectionExists: selectionExists, capabilities: capabilities, treeActionAllowed: treeActionAllowed };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorProfiles = api;
})();
