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
  var STATUS = { unknown: "Unknown", illustrative: "Illustrative", assumed: "Assumed", calibrated: "Calibrated", policy: "Firewall rule" };
  var api = {
    state: function (catalog, id) { return pick(catalog, "states", "id", id, "word"); },
    slot: function (catalog, slot) { return pick(catalog, "parameters", "slot", slot, "name"); },
    rule: function (catalog, id) { return pick(catalog, "rules", "id", id, "title"); },
    meaning: function (catalog, kind) {
      var hit = catalog ? find(catalog.entities, "kind", kind) : null;
      return hit && hit.meaning ? hit.meaning : "";
    },
    status: function (id) { return STATUS[id] || id; },
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorWords = api;
})();
