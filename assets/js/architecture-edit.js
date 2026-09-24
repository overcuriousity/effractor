// Architecture edits, as pure functions from a document to a new document —
// the same contract as edit.js: they change the JSON image only, and whether
// the result is valid is for the wasm module to say when it is serialised.
//
// Every function returns {doc, select, notice?} — `select` is the qualified
// selection to land on — or null when the edit does not apply or changes
// nothing. Source ids are fixed when a component is made; labels never move them.
// Links, renames of ids and deletion are in architecture-links.js.
(function () {
  var slug = (typeof module !== "undefined" ? require("./edit.js") : window.effractorEdit).slug;
  var KINDS = ["network", "router", "firewall", "host", "application", "service", "product", "agent", "account", "credential", "person"];
  // The Add menu's groups: the families the canvas colours.
  var GROUPS = [
    ["Network", ["network", "router", "firewall"]],
    ["Compute", ["host", "application", "service", "product", "agent"]],
    ["Identity", ["account", "credential", "person"]],
  ];
  var STATUSES = ["unknown", "illustrative", "assumed", "calibrated"];

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  function empty() {
    return {
      effractor: 2,
      profile: "architecture",
      name: "Untitled",
      time_unit: "d",
      horizon: 100,
      library: { id: "core-components", version: 1 },
      entities: {},
      associations: {},
      flows: {},
      attacker: { footholds: [] },
      scenarios: {},
      analysis: { seed: 42, samples: 10000, confidence: 0.95 },
    };
  }

  // A readable id that is never only digits (JavaScript would move such a key
  // to the front of every map) and not taken.
  function entityId(doc, label) {
    var base = slug(label);
    if (/^[0-9]+$/.test(base)) base = "entity-" + base;
    var id = base;
    for (var n = 2; has(doc.entities, id); n++) id = base + "-" + n;
    return id;
  }

  // `spec`: the kind's catalog entry — its parameter slots and its switch.
  function addEntity(doc, kind, label, spec) {
    var name = String(label == null ? "" : label).trim();
    if (!name || KINDS.indexOf(kind) < 0) return null;
    var next = clone(doc);
    var id = entityId(next, name);
    var entity = { kind: kind, label: name };
    var slots = (spec && spec.parameters) || [];
    if (slots.length) {
      entity.parameters = {};
      slots.forEach(function (slot) {
        entity.parameters[slot] = { status: "unknown" };
      });
    }
    if (spec && spec.defense) {
      entity.defenses = {};
      entity.defenses[spec.defense] = "unknown";
    }
    next.entities[id] = entity;
    return { doc: next, select: "entity/" + id, entity: id };
  }

  function renameEntity(doc, id, label) {
    var name = String(label == null ? "" : label).trim();
    if (!has(doc.entities, id) || !name || doc.entities[id].label === name) return null;
    var next = clone(doc);
    next.entities[id].label = name;
    return { doc: next, select: "entity/" + id };
  }

  function setDescription(doc, id, text) {
    if (!has(doc.entities, id)) return null;
    var value = String(text == null ? "" : text).trim();
    if ((doc.entities[id].description || "") === value) return null;
    var next = clone(doc);
    if (value) next.entities[id].description = value;
    else delete next.entities[id].description;
    return { doc: next, select: "entity/" + id };
  }

  function ownerOf(doc, owner) {
    if (owner && has(owner, "entity")) return has(doc.entities, owner.entity) ? { record: doc.entities[owner.entity], select: "entity/" + owner.entity } : null;
    if (owner && has(owner, "flow")) return has(doc.flows, owner.flow) ? { record: doc.flows[owner.flow], select: "flow/" + owner.flow } : null;
    return null;
  }

  function extensions(record) {
    var out = {};
    Object.keys(record || {}).forEach(function (k) {
      if (k.indexOf("x-") === 0) out[k] = record[k];
    });
    return out;
  }

  // `value`: {status, ttc, note}, submitted together. Unknown carries neither
  // a TTC nor a note; anything else is written as given — an empty TTC or
  // note is left out, for the format to refuse, never filled in.
  function setParameter(doc, owner, slot, value) {
    if (!value || STATUSES.indexOf(value.status) < 0) return null;
    var next = clone(doc);
    var at = ownerOf(next, owner);
    if (!at || !has(at.record.parameters, slot)) return null;
    var parameter = { status: value.status };
    if (value.status !== "unknown") {
      var ttc = String(value.ttc == null ? "" : value.ttc).trim();
      var note = String(value.note == null ? "" : value.note).trim();
      if (ttc) parameter.ttc = ttc;
      if (note) parameter.note = note;
    }
    at.record.parameters[slot] = Object.assign(parameter, extensions(at.record.parameters[slot]));
    return { doc: next, select: at.select };
  }

  function setDefense(doc, id, defense, value) {
    if (value !== true && value !== false && value !== "unknown") return null;
    if (!has(doc.entities, id) || !has(doc.entities[id].defenses, defense)) return null;
    if (doc.entities[id].defenses[defense] === value) return null;
    var next = clone(doc);
    next.entities[id].defenses[defense] = value;
    return { doc: next, select: "entity/" + id };
  }

  var api = { KINDS: KINDS, GROUPS: GROUPS, STATUSES: STATUSES, empty: empty, addEntity: addEntity, renameEntity: renameEntity, setDescription: setDescription, setParameter: setParameter, setDefense: setDefense };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorArchitectureEdit = api;
})();
