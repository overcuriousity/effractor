// Library ids → the words the page shows: a state, a parameter, a rule, what a
// kind of component is. The words live in the component catalog (Rust); an id
// the catalog does not know is shown as itself. Pure.
(function () {
  function find(list, key, id) {
    return (list || []).filter(function (x) { return x[key] === id; })[0] || null;
  }
  function pick(catalog, list, key, id, field) {
    var hit = catalog ? find(catalog[list], key, id) : null;
    return hit && hit[field] ? hit[field] : id;
  }
  var STATUS = { unknown: "Unknown", illustrative: "Illustrative", assumed: "Assumed", calibrated: "Calibrated", policy: "Firewall rule", defense: "Defence switch", attacker: "Attacker speed" };
  var api = {
    state: function (catalog, id) { return pick(catalog, "states", "id", id, "word"); },
    slot: function (catalog, slot) { return pick(catalog, "parameters", "slot", slot, "name"); },
    rule: function (catalog, id) { return pick(catalog, "rules", "id", id, "title"); },
    defense: function (catalog, id) { return pick(catalog, "defenses", "id", id, "word"); },
    meaning: function (catalog, kind) {
      var hit = catalog ? find(catalog.entities, "kind", kind) : null;
      return hit && hit.meaning ? hit.meaning : "";
    },
    status: function (id) { return STATUS[id] || id; },
    // A source path as the page names it: the component or flow by its
    // label, then what of it. A path it cannot name is shown as it is.
    path: function (doc, catalog, path) {
      if (!doc) return path;
      function label(collection, id) {
        var map = doc[collection];
        var e = map && Object.prototype.hasOwnProperty.call(map, id) ? map[id] : null;
        return e ? (e.label != null ? e.label : id) : null;
      }
      var m, name;
      if ((m = /^entities\.([^.[\]]+)\.parameters\.([^.[\]]+)$/.exec(path)) && (name = label("entities", m[1]))) return name + " · " + api.slot(catalog, m[2]);
      if ((m = /^entities\.([^.[\]]+)\.defenses\.([^.[\]]+)$/.exec(path)) && (name = label("entities", m[1]))) return name + " · " + api.defense(catalog, m[2]);
      if ((m = /^flows\.([^.[\]]+)\.parameters\.([^.[\]]+)$/.exec(path)) && (name = label("flows", m[1]))) return name + " · " + api.slot(catalog, m[2]);
      if ((m = /^associations\.([^.[\]]+)\.allowed$/.exec(path))) {
        var a = doc.associations && Object.prototype.hasOwnProperty.call(doc.associations, m[1]) ? doc.associations[m[1]] : null;
        if (a && a.kind === "permits" && label("entities", a.from) && label("flows", a.to)) return label("entities", a.from) + " · " + label("flows", a.to);
      }
      if ((m = /^scenarios\.([^.[\]]+)\.changes\[(\d+)\]$/.exec(path)) && (name = label("scenarios", m[1]))) return name + " · change " + (Number(m[2]) + 1);
      if ((m = /^scenarios\.([^.[\]]+)\.attacker\.speed$/.exec(path)) && (name = label("scenarios", m[1]))) return name + " · attacker speed";
      return path;
    },
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorWords = api;
})();
