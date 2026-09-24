// Clusters and several selected components (clustering spec §3, §5): the
// inspector's sections, the rail's cluster button, keys and menus. The
// edits are clusters.js's; this is the DOM.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var C = window.effractorClusters;
  var icons = window.effractorArchitectureIcons;

  function doc() {
    return app.state.doc;
  }
  function $(id) {
    return document.getElementById(id);
  }

  // A row per component: its icon and name; a click selects it. `extra`
  // adds to the row (a button, a drag).
  function row(list, id, extra) {
    var e = doc().entities[id];
    var item = document.createElement("li");
    var sample = icons.svg(document, e.kind, 18);
    sample.setAttribute("class", sample.getAttribute("class") + " is-plate");
    item.appendChild(sample);
    var name = document.createElement("span");
    name.className = "name";
    name.textContent = e.label;
    item.appendChild(name);
    item.title = e.label + " · " + e.kind;
    item.addEventListener("click", function (ev) {
      if (ev.target.closest("button")) return;
      app.select("entity/" + id);
    });
    if (extra) extra(item);
    list.appendChild(item);
    return item;
  }

  // Several selected: how many, and which.
  U.sections.picked = function (form) {
    var members = C.entitiesOf(doc(), app.state.picked);
    $("inspector-name").textContent = members.length + " components";
    var list = document.createElement("ul");
    list.className = "cluster-members";
    members.forEach(function (id) {
      row(list, id);
    });
    form.appendChild(list);
  };

  window.effractorClusterUi = { row: row };
})();
