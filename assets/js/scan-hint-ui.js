// The canvas's light bulb (owner, 2026-09-24; scan workflow spec §2): it
// names what to run next from what the drawing lacks, and opens that
// scanner's dialog with the purposes ticked and the targets set. What it
// says is scan-gaps.js's; this file only shows it.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var G = window.effractorScanGaps;
  var S = window.effractorScanners;
  var Ui = window.effractorNmapUi;
  var $ = function (id) { return document.getElementById(id); };

  function doc() {
    return app.state.doc;
  }
  // Silenced on this browser; a convenience, so storage that fails only
  // means the bulb speaks again.
  var KEY = "effractor.hint.silenced", BEFORE = "effractor.hint.nmap";
  function silenced() {
    try {
      return G.silenced(localStorage.getItem(KEY), localStorage.getItem(BEFORE));
    } catch (e) {
      return [];
    }
  }
  function keep(list) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
      localStorage.removeItem(BEFORE);
    } catch (e) {}
    show();
  }
  function steps() {
    return G.steps(doc(), silenced());
  }
  function show() {
    var first = steps()[0];
    $("nmap-hint").hidden = !first;
    if (first) $("nmap-hint-says").textContent = first.says;
  }

  // The scanner of the step's tool; one not drawn yet is added on the
  // host another scanner runs on, else on the selected host, else on none.
  function go(step) {
    var d = doc(), entities = d.entities || {};
    var preset = { recipes: step.purposes, adjust: step.adjust, targets: step.targets };
    var drawn = Object.keys(entities).filter(function (id) { return entities[id].tool === step.tool; })[0];
    if (drawn) return Ui.open(drawn, preset);
    var scanners = Object.keys(entities).filter(function (id) { return !!entities[id].tool; });
    var on = Object.keys(d.associations || {}).map(function (k) { return d.associations[k]; }).filter(function (a) {
      return a.kind === "hosts" && scanners.indexOf(a.to) >= 0 && entities[a.from] && entities[a.from].kind === "host";
    })[0];
    var q = window.effractorProfiles.qualified(app.state.selected);
    var e = q && q.kind === "entity" ? entities[q.id] : null;
    var tool = S.TOOLS.filter(function (t) { return t.id === step.tool; })[0];
    Ui.create(tool, on ? on.from : e && e.kind === "host" ? q.id : null, preset);
  }
  function quiet(step) {
    keep(silenced().concat([step.id]));
  }
  // The other steps that apply, then what silences and what speaks again.
  function menu() {
    var all = steps(), none = silenced();
    if (!all.length) return;
    var items = all.slice(1).map(function (s) {
      return [s.says, "", function () { go(s); }];
    });
    items.push(["Say nothing about this", "", function () { quiet(all[0]); }]);
    if (none.length) items.push(["Say it again", "", function () { keep([]); }, { hint: none.length + " silenced" }]);
    var box = $("nmap-hint").getBoundingClientRect();
    app.showMenu(items, 0, 0, { left: box.left, right: box.left - 2, top: box.top - 8 - items.length * 26 });
  }

  $("nmap-hint-go").addEventListener("click", function () {
    var first = steps()[0];
    if (first) go(first);
  });
  $("nmap-hint").addEventListener("contextmenu", function (e) {
    e.preventDefault();
    menu();
  });
  $("nmap-hint-close").addEventListener("click", function () {
    var first = steps()[0];
    if (first) quiet(first);
  });
  // A bulb that is silenced whole is gone: the canvas's own menu brings
  // it back.
  U.backgroundItems.push(function () {
    return silenced().length ? [["Say what to scan next", "", function () { keep([]); }]] : [];
  });
  app.onChange(show);
  show();
})();
