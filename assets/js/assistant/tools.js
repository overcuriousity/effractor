// The agent's edits (chat spec §6): each tool as a pure operation on the
// document's JSON image, built from the same edit functions a person's keys
// and menus use. Returns {doc, select, said} or {refused}: whether the result
// is valid is for wasm to say when the page commits it (page.js).
(function () {
  var node = typeof module !== "undefined";
  var E = node ? require("../edit.js") : window.effractorEdit;
  var AE = node ? require("../architecture-edit.js") : window.effractorArchitectureEdit;
  var L = node ? require("../architecture-links.js") : window.effractorArchitectureLinks;
  var C = node ? require("../clusters.js") : window.effractorClusters;
  var CMP = node ? require("../comparison.js") : window.effractorComparison;

  var NOTHING = "that changes nothing";
  function has(o, k) { return !!o && Object.prototype.hasOwnProperty.call(o, k); }
  function clone(d) { return JSON.parse(JSON.stringify(d)); }
  function str(v) { return typeof v === "string" ? v : v == null ? "" : String(v); }
  function no(what, id) { return { refused: "no " + what + " “" + str(id) + "”" }; }

  // Chains edits that return {doc} or null (null: nothing to change there).
  function chain(doc) {
    var changed = false, select = null;
    return {
      doc: function () { return doc; },
      apply: function (r) {
        if (r && r.doc) { doc = r.doc; changed = true; if (r.select !== undefined) select = r.select; }
        return this;
      },
      put: function (fn) { var d = clone(doc); fn(d); if (JSON.stringify(d) !== JSON.stringify(doc)) { doc = d; changed = true; } return this; },
      done: function (said, sel) { return changed ? { doc: doc, select: sel !== undefined ? sel : select, said: said } : { refused: NOTHING }; },
    };
  }

  // ---- every profile ----
  function renameDocument(ctx, i) {
    var name = str(i.name).trim();
    if (!name) return { refused: "a name is needed" };
    return chain(ctx.doc).put(function (d) { d.name = name; }).done("Named the document “" + name + "”", null);
  }

  function setAnalysis(ctx, i) {
    var c = chain(ctx.doc);
    if (i.horizon !== undefined) {
      var h = E.setHorizon(c.doc(), i.horizon);
      if (!h) return { refused: "the horizon is a number above 0" };
      c.apply(h);
    }
    c.put(function (d) {
      if (i.time_unit !== undefined) d.time_unit = str(i.time_unit);
      ["samples", "seed", "confidence"].forEach(function (k) {
        if (i[k] !== undefined) { d.analysis = d.analysis || {}; d.analysis[k] = i[k]; }
      });
    });
    return c.done("Changed the analysis settings", null);
  }

  // ---- trees ----
  function needNode(doc, id) { return has(doc.nodes, id) ? null : no("node", id); }

  function addNode(ctx, i) {
    var label = str(i.label).trim();
    if (!label) return { refused: "a label is needed" };
    var miss = needNode(ctx.doc, i.parent);
    if (miss) return miss;
    var r = E.addChild(ctx.doc, i.parent);
    if (!r) return { refused: E.gateRefusal(ctx.doc, i.parent) || "cannot add under “" + i.parent + "”" };
    r = E.rename(r.doc, r.fresh, label, true);
    var id = r.select;
    if (i.leaf === "undeveloped") r = E.setLeafKind(r.doc, id, "undeveloped") || r;
    return { doc: r.doc, select: id, said: "Added “" + label + "” under “" + ctx.doc.nodes[i.parent].label + "”" };
  }

  function setGate(doc, id, gate, k) {
    var n = doc.nodes[id];
    if (!n.gate && !n.children) return { refused: "“" + id + "” is a leaf; add a child to make it a gate" };
    var d = clone(doc), out = {};
    Object.keys(d.nodes[id]).forEach(function (key) {
      if (key === "k") return;
      out[key] = key === "gate" ? gate : d.nodes[id][key];
      if (key === "gate" && gate === "vote") out.k = k || Math.max(1, Math.min(2, (n.children || []).length));
    });
    d.nodes[id] = out;
    return { doc: d, select: id };
  }

  function setNode(ctx, i) {
    var miss = needNode(ctx.doc, i.id);
    if (miss) return miss;
    var id = i.id, c = chain(ctx.doc);
    if (i.label !== undefined) c.apply(E.rename(c.doc(), id, i.label, false));
    if (i.gate !== undefined || (i.k !== undefined && ctx.doc.nodes[id].gate === "vote")) {
      var g = setGate(c.doc(), id, i.gate || "vote", i.k);
      if (g.refused) return g;
      c.apply(g);
    }
    if (i.leaf !== undefined) {
      if (!ctx.doc.nodes[id].leaf) return { refused: "“" + id + "” is a gate, not a leaf" };
      c.apply(E.setLeafKind(c.doc(), id, i.leaf));
    }
    ["description", "p", "rate", "ttc", "cost", "detection", "consequences"].forEach(function (k) {
      if (i[k] !== undefined) c.apply(E.setAttribute(c.doc(), id, k, i[k] === null ? undefined : i[k]));
    });
    if (i.new_id !== undefined) {
      var moved = E.setId(c.doc(), id, i.new_id);
      if (!moved) return { refused: "the id “" + i.new_id + "” is taken or not an id" };
      c.apply(moved);
      id = moved.select;
    }
    return c.done("Changed “" + ctx.doc.nodes[i.id].label + "”", id);
  }

  function treeLink(ctx, i) {
    var miss = needNode(ctx.doc, i.parent) || needNode(ctx.doc, i.child);
    if (miss) return miss;
    var r = E.link(ctx.doc, i.parent, i.child);
    return r ? { doc: r.doc, select: r.select, said: "Linked “" + i.child + "” under “" + i.parent + "”" }
      : { refused: E.gateRefusal(ctx.doc, i.parent) || "that would make a cycle, or it is linked already" };
  }

  function unlink(ctx, i) {
    var miss = needNode(ctx.doc, i.parent) || needNode(ctx.doc, i.child);
    if (miss) return miss;
    var r = E.removeEdge(ctx.doc, i.parent, i.child);
    return r ? { doc: r.doc, select: r.select, said: "Unlinked “" + i.child + "” from “" + i.parent + "”" } : { refused: "“" + i.child + "” is not under “" + i.parent + "”" };
  }

  function move(ctx, i) {
    var miss = needNode(ctx.doc, i.id) || needNode(ctx.doc, i.from) || needNode(ctx.doc, i.to);
    if (miss) return miss;
    var r = E.reparent(ctx.doc, i.id, i.from, i.to);
    return r ? { doc: r.doc, select: r.select, said: "Moved “" + i.id + "” under “" + i.to + "”" } : { refused: "cannot move there: " + (E.gateRefusal(ctx.doc, i.to) || "a cycle, or not its parent") };
  }

  function deleteNode(ctx, i) {
    var miss = needNode(ctx.doc, i.id);
    if (miss) return miss;
    if (ctx.doc.top === i.id) return { refused: "the top event stays; replace_document to start over" };
    var r = E.deleteNode(ctx.doc, i.id);
    return r ? { doc: r.doc, select: r.select, said: "Deleted “" + ctx.doc.nodes[i.id].label + "”" } : { refused: "cannot delete “" + i.id + "”" };
  }

  function putAsset(ctx, i) {
    var c = chain(ctx.doc), id = i.id;
    if (id === undefined) {
      var made = E.addAsset(c.doc(), i.label);
      if (!made) return { refused: "a new asset needs a label" };
      c.apply(made); id = made.asset;
    } else if (!has(ctx.doc.assets, id)) return no("asset", id);
    else if (i.label !== undefined) c.apply(E.setAssetLabel(c.doc(), id, i.label));
    Object.keys(i.loss || {}).forEach(function (dim) {
      var r = E.setAssetLoss(c.doc(), id, dim, i.loss[dim] === null ? "" : i.loss[dim]);
      if (r) c.apply(r);
    });
    return c.done((i.id === undefined ? "Added" : "Changed") + " asset “" + id + "”", null);
  }

  function removeAsset(ctx, i) {
    var r = E.removeAsset(ctx.doc, i.id);
    return r ? { doc: r.doc, select: null, said: "Removed asset “" + i.id + "”" } : no("asset", i.id);
  }

  function putControl(ctx, i) {
    var c = chain(ctx.doc), id = i.id;
    if (id === undefined) {
      var made = E.addControl(c.doc(), i.label);
      if (!made) return { refused: "a new control needs a label" };
      c.apply(made); id = made.control;
    } else if (!has(ctx.doc.controls, id)) return no("control", id);
    else if (i.label !== undefined) c.apply(E.setControl(c.doc(), id, "label", i.label));
    if (i.cost !== undefined) {
      var cost = E.setControl(c.doc(), id, "cost", i.cost);
      if (!cost && c.doc().controls[id].cost !== i.cost) return { refused: "a cost is a number of 0 or more" };
      c.apply(cost);
    }
    if (i.enabled !== undefined && !!c.doc().controls[id].enabled !== !!i.enabled) c.apply(E.toggleControl(c.doc(), id));
    if (i.effects !== undefined) {
      while ((c.doc().controls[id].effects || []).length) c.apply(E.removeEffect(c.doc(), id, 0));
      for (var k = 0; k < i.effects.length; k++) {
        var e = i.effects[k] || {};
        var added = E.addEffect(c.doc(), id, e.node, e.ttc);
        if (!added) return { refused: "effect on “" + str(e.node) + "”: not a leaf, twice, or no ttc" };
        c.apply(added);
      }
    }
    return c.done((i.id === undefined ? "Added" : "Changed") + " control “" + id + "”", null);
  }

  function removeControl(ctx, i) {
    var r = E.removeControl(ctx.doc, i.id);
    return r ? { doc: r.doc, select: null, said: "Removed control “" + i.id + "”" } : no("control", i.id);
  }

  // ---- architecture ----
  function needEntity(doc, id) { return has(doc.entities, id) ? null : no("component", id); }

  function addEntity(ctx, i) {
    if (AE.KINDS.indexOf(i.kind) < 0) return { refused: "a kind is one of " + AE.KINDS.join(", ") };
    var spec = ((ctx.catalog && ctx.catalog.entities) || []).filter(function (e) { return e.kind === i.kind; })[0];
    var r = AE.addEntity(ctx.doc, i.kind, i.label, spec);
    if (!r) return { refused: "a component needs a label" };
    var c = chain(r.doc);
    if (i.description) c.apply(AE.setDescription(c.doc(), r.entity, i.description));
    if (i.addresses && i.addresses.length) {
      var a = AE.setAddresses(c.doc(), r.entity, i.addresses.join(" "));
      if (!a) return { refused: "only hosts and networks have addresses" };
      c.apply(a);
    }
    return { doc: c.doc(), select: r.select, said: "Added " + i.kind + " “" + str(i.label).trim() + "”" };
  }

  function setEntity(ctx, i) {
    var miss = needEntity(ctx.doc, i.id);
    if (miss) return miss;
    var id = i.id, c = chain(ctx.doc), e = ctx.doc.entities[id];
    if (i.label !== undefined) c.apply(AE.renameEntity(c.doc(), id, i.label));
    if (i.description !== undefined) c.apply(AE.setDescription(c.doc(), id, i.description || ""));
    if (i.addresses !== undefined) {
      if (e.kind !== "host" && e.kind !== "network") return { refused: "only hosts and networks have addresses" };
      c.apply(AE.setAddresses(c.doc(), id, (i.addresses || []).join(" ")));
    }
    if (i.names !== undefined) {
      if (e.kind !== "host") return { refused: "only hosts have names" };
      c.apply(AE.setNames(c.doc(), id, (i.names || []).join(" ")));
    }
    ["identities", "vendor"].forEach(function (k) {
      if (i[k] === undefined) return;
      c.put(function (d) { if (i[k] === null || (Array.isArray(i[k]) && !i[k].length)) delete d.entities[id][k]; else d.entities[id][k] = i[k]; });
    });
    // What the kind carries, optional ones included (catalog spec).
    var spec = ((ctx.catalog && ctx.catalog.entities) || []).filter(function (k) { return k.kind === e.kind; })[0] || null;
    var slotsOf = Object.keys(e.parameters || {}).concat(((spec && spec.optional) || []).filter(function (s) { return !has(e.parameters, s); }));
    var switchesOf = Object.keys(e.defenses || {}).concat(((spec && spec.optional_defenses) || []).filter(function (s) { return !has(e.defenses, s); }));
    var slots = Object.keys(i.parameters || {});
    for (var s = 0; s < slots.length; s++) {
      if (slotsOf.indexOf(slots[s]) < 0) return { refused: "“" + id + "” has no parameter “" + slots[s] + "”; it has " + slotsOf.join(", ") };
      c.apply(AE.setParameter(c.doc(), { entity: id }, slots[s], i.parameters[slots[s]], spec));
    }
    var defs = Object.keys(i.defenses || {});
    for (var d = 0; d < defs.length; d++) {
      if (switchesOf.indexOf(defs[d]) < 0) return { refused: "“" + id + "” has no defense “" + defs[d] + "”" + (switchesOf.length ? "; it has " + switchesOf.join(", ") : "") };
      c.apply(AE.setDefense(c.doc(), id, defs[d], i.defenses[defs[d]], spec));
    }
    return c.done("Changed “" + e.label + "”", "entity/" + id);
  }

  function archLink(ctx, i) {
    if (i.id !== undefined && !has(ctx.doc.associations, i.id) && typeof i.id !== "string") return no("relationship", i.id);
    var miss = needEntity(ctx.doc, i.from) || (i.kind === "permits" ? (has(ctx.doc.flows, i.to) ? null : no("flow", i.to)) : needEntity(ctx.doc, i.to));
    if (miss) return miss;
    var r = L.putAssociation(ctx.doc, i.id === undefined ? null : i.id, i);
    return r ? { doc: r.doc, select: r.select, said: "Linked “" + i.from + "” " + i.kind + " “" + i.to + "”" } : { refused: NOTHING + ", or not a relationship kind" };
  }

  function putFlow(ctx, i) {
    var miss = needEntity(ctx.doc, i.source) || needEntity(ctx.doc, i.target);
    if (miss) return miss;
    var hops = i.route || [];
    for (var h = 0; h < hops.length; h++) if (!has(ctx.doc.entities, hops[h])) return no("network or router", hops[h]);
    var r = L.putFlow(ctx.doc, i.id === undefined ? null : i.id, i);
    return r ? { doc: r.doc, select: r.select, said: "Flow “" + str(i.label) + "”" + (r.notice ? " (" + r.notice.replace(" · Ctrl+Z undoes", "") + ")" : "") } : { refused: "a flow needs a label, or " + NOTHING };
  }

  function remove(ctx, i) {
    var r = L.remove(ctx.doc, i.collection, i.id);
    return r ? { doc: r.doc, select: null, said: r.notice.replace(" · Ctrl+Z undoes", "") } : no(str(i.collection).replace(/s$/, "") || "item", i.id);
  }

  function setAttacker(ctx, i) {
    var c = chain(ctx.doc);
    if (i.footholds !== undefined) {
      ((c.doc().attacker || {}).footholds || []).slice().forEach(function (f) { c.apply(L.setFoothold(c.doc(), f.entity, f.state, false)); });
      for (var k = 0; k < i.footholds.length; k++) {
        var f = i.footholds[k] || {};
        var miss = needEntity(ctx.doc, f.entity);
        if (miss) return miss;
        c.apply(L.setFoothold(c.doc(), f.entity, f.state, true));
      }
    }
    if (i.target !== undefined) {
      if (i.target === null) {
        var was = (c.doc().attacker || {}).target;
        if (was) c.apply(L.setTarget(c.doc(), was.entity, null));
      } else {
        var m = needEntity(ctx.doc, i.target.entity);
        if (m) return m;
        c.apply(L.setTarget(c.doc(), i.target.entity, i.target.state));
      }
    }
    return c.done("Set the attacker", null);
  }

  function cluster(ctx, i) {
    var d = ctx.doc, r;
    var need = function (id) { return has(d.clusters, id) ? null : no("cluster", id); };
    switch (i.action) {
      case "make": r = C.make(d, i.members || [], i.name); if (!r) return { refused: "a cluster needs two or more existing components" }; break;
      case "rename": if (need(i.id)) return need(i.id); r = C.rename(d, i.id, i.name); break;
      case "take_out": if (need(i.id)) return need(i.id); r = C.takeOut(d, i.id, i.entity); break;
      case "move_to": if (need(i.id)) return need(i.id); r = C.moveTo(d, i.entity, i.id); break;
      case "merge": if (need(i.id) || need(i.into)) return need(i.id) || need(i.into); r = C.merge(d, i.id, i.into); break;
      case "dissolve": if (need(i.id)) return need(i.id); r = C.dissolve(d, i.id); break;
      case "fold": if (need(i.id)) return need(i.id); r = C.setClosed(d, i.id, i.closed !== false); break;
      case "auto": r = C.build(d); break;
      case "toggle_all": r = C.toggleAll(d); break;
      default: return { refused: "an action is make, rename, take_out, move_to, merge, dissolve, fold, auto or toggle_all" };
    }
    if (!r || !r.doc) return { refused: (r && r.refusal) || NOTHING };
    return { doc: r.doc, select: r.select === undefined ? null : r.select, said: r.notice ? r.notice.replace(" · Ctrl+Z undoes", "") : "Cluster " + i.action.replace("_", " ") };
  }

  function putScenario(ctx, i) {
    var label = str(i.label).trim();
    if (!label) return { refused: "a scenario needs a label" };
    if (i.id !== undefined) {
      if (!has(ctx.doc.scenarios, i.id)) return no("scenario", i.id);
      var r = CMP.rename(ctx.doc, i.id, label);
      return r ? { doc: r.doc, select: null, said: "Renamed scenario to “" + label + "”" } : { refused: NOTHING };
    }
    var id = CMP.freshId(ctx.doc, label);
    var made = CMP.putScenario(ctx.doc, id, label, []);
    return { doc: made.doc, select: null, said: "Added scenario “" + label + "” (" + id + ")" };
  }

  function removeScenario(ctx, i) {
    var r = CMP.removeScenario(ctx.doc, i.id);
    return r ? { doc: r.doc, select: null, said: "Removed scenario “" + i.id + "”" } : no("scenario", i.id);
  }

  function setChange(ctx, i) {
    if (!has(ctx.doc.scenarios, i.scenario)) return no("scenario", i.scenario);
    var t = i.target || {};
    if (t.entity !== undefined && (needEntity(ctx.doc, t.entity) || !t.defense)) return needEntity(ctx.doc, t.entity) || { refused: "a component's change names its defense" };
    if (t.entity === undefined && !has(ctx.doc.associations, t.association)) return no("relationship", t.association);
    var r = CMP.setChange(ctx.doc, i.scenario, t, i.value === undefined ? null : i.value);
    return r ? { doc: r.doc, select: null, said: "Scenario “" + i.scenario + "”: changed" } : { refused: NOTHING };
  }

  function setSpeed(ctx, i) {
    if (!has(ctx.doc.scenarios, i.scenario)) return no("scenario", i.scenario);
    if (i.speed !== null && !(typeof i.speed === "number" && i.speed > 0)) return { refused: "a speed is a number above 0, or null" };
    var r = CMP.setSpeed(ctx.doc, i.scenario, i.speed === undefined ? null : i.speed);
    return r ? { doc: r.doc, select: null, said: "Scenario “" + i.scenario + "”: attacker speed " + (i.speed === null ? "as written" : "×" + i.speed) } : { refused: NOTHING };
  }

  var TREE = { add_node: addNode, set_node: setNode, link: treeLink, unlink: unlink, move: move, delete_node: deleteNode,
    put_asset: putAsset, remove_asset: removeAsset, put_control: putControl, remove_control: removeControl, set_analysis: setAnalysis, rename_document: renameDocument };
  var ARCH = { add_entity: addEntity, set_entity: setEntity, link: archLink, put_flow: putFlow, remove: remove, set_attacker: setAttacker,
    cluster: cluster, put_scenario: putScenario, remove_scenario: removeScenario, set_change: setChange, set_speed: setSpeed, set_analysis: setAnalysis, rename_document: renameDocument };

  // The lists each tool takes (tools.json). Anything else in their place is
  // refused before the tool reads it: an object there once cleared the list.
  var LISTS = { put_control: ["effects"], set_node: ["consequences"], add_entity: ["addresses"], set_entity: ["addresses", "identities", "names"],
    put_flow: ["route"], set_attacker: ["footholds"], cluster: ["members"] };
  // Where the tool reads null as none.
  var NULLABLE = { consequences: true, addresses: true, identities: true, names: true, route: true, members: true };

  function wrongList(name, input) {
    var fields = LISTS[name] || [];
    for (var f = 0; f < fields.length; f++) {
      var v = input[fields[f]];
      if (v === undefined || Array.isArray(v) || (v === null && NULLABLE[fields[f]])) continue;
      return { refused: fields[f] + " is a list" };
    }
    return null;
  }

  // `replace_document` needs wasm to read YAML: page.js does it.
  function edit(name, input, ctx) {
    var table = ctx.profile === "architecture" ? ARCH : TREE;
    if (name === "replace_document") return { refused: "replace_document is read by the page" };
    if (!has(table, name)) return { refused: "no tool “" + name + "” here" };
    if (!input || typeof input !== "object" || Array.isArray(input)) return { refused: "the input is an object" };
    if (has(input, "_unparsed")) return { refused: "the input was not JSON: " + str(input._unparsed).slice(0, 80) };
    var list = wrongList(name, input);
    if (list) return list;
    try {
      return table[name](ctx, input) || { refused: NOTHING };
    } catch (e) {
      return { refused: "could not do that: " + (e && e.message ? e.message : e) };
    }
  }

  var USES = {
    "edit.js": ["setHorizon", "addChild", "rename", "setId", "setLeafKind", "link", "removeEdge", "deleteNode", "reparent", "setAttribute",
      "addAsset", "setAssetLabel", "setAssetLoss", "removeAsset", "toggleControl", "addControl", "setControl", "addEffect", "removeEffect", "removeControl"],
    "architecture-edit.js": ["addEntity", "renameEntity", "setDescription", "setAddresses", "setNames", "setParameter", "setDefense"],
    "architecture-links.js": ["putAssociation", "putFlow", "setFoothold", "setTarget", "remove"],
    "clusters.js": ["make", "rename", "takeOut", "moveTo", "merge", "dissolve", "setClosed", "build", "toggleAll"],
    "comparison.js": ["putScenario", "rename", "removeScenario", "setChange", "setSpeed", "freshId"],
  };
  var EXCLUDED = {
    "edit.js": {
      addSibling: "the Enter key's add beside; add_node under the same parent does the same",
      cycleGate: "the G key's cycle; set_node sets the gate directly",
      setEffect: "one effect's time; put_control writes the effects list whole",
    },
    "architecture-links.js": {
      placePin: "dragging an attacker pin; set_attacker sets footholds and target directly",
      removePin: "dragging a pin off; set_attacker with the shorter list does the same",
      removeAll: "deleting a selection at once; remove per component does the same",
      addLinked: "the Add-linked menu; add_entity then link does the same",
    },
    "clusters.js": {
      peel: "where a member is drawn beside a closed stack: drawing only, by dragging",
      unpeel: "putting a dragged member back on its stack: drawing only",
      pressK: "the K key's dispatcher between make and take_out; both are cluster actions",
    },
  };
  var NOT_EDIT = {
    "edit.js": ["readNumber", "fromPercent", "slug", "parentsOf", "removal", "gateRefusal", "linkCandidates", "moveCandidates", "outline",
      "rateFrom", "meanTime", "usesOfAsset", "effectTargets", "walk", "createHistory"],
    "architecture-edit.js": ["KINDS", "GROUPS", "STATUSES", "has", "clone", "extensions", "empty", "isName"],
    "architecture-links.js": ["notes", "emptyLink", "emptyFlow", "emptyHop", "phrase", "fieldsOf", "variants", "fieldWord", "fieldValue",
      "addChoices", "linkChoices", "nextHops", "nearHops", "flowPermissions", "linksOf", "flowsOf"],
    "clusters.js": ["SPECIFIC", "opened", "inPlace", "held", "spread", "pickable", "drawnLine", "transitions", "clusterOf", "label", "lead",
      "entitiesOf", "together", "forget", "gather", "lit", "segments", "arc", "within", "closeAt", "reopen"],
    "comparison.js": ["probability", "speedText", "signed", "interval", "state", "ids", "newLabel", "switches", "settings", "rows",
      "summary", "changedSteps", "routes", "keyOf"],
  };

  var api = { edit: edit, USES: USES, EXCLUDED: EXCLUDED, NOT_EDIT: NOT_EDIT, NOTHING: NOTHING };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorAssistantTools = api;
})();
