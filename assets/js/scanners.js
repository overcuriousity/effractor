// The scanners, one application per tool (roadmap scanner-readers, owner
// 2026-09-27): each reads its own format into the scan nmap.js plans from;
// planning, the preview and adding stay one. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var N = node ? require("./nmap.js") : window.effractorNmap;
  var M = node ? require("./masscan.js") : window.effractorMasscan;
  var G = node ? require("./greenbone.js") : window.effractorGreenbone;

  // `looks`: whether a text that one tool refused is plainly this one's.
  var TOOLS = [
    { id: "nmap", name: "nmap", read: function (text) { return N.read(text); }, stampFor: N.stampFor, looks: /<nmaprun(?![^>]*scanner="(?!nmap")[^"]*")[\s>]/ },
    { id: "masscan", name: "masscan", read: M.read, stampFor: M.stampFor, looks: /<nmaprun[^>]*scanner="masscan"/ },
    { id: "greenbone", name: "Greenbone", read: G.read, stampFor: G.stampFor, looks: /<report[^>]*format_id=|<get_reports_response[\s>]/ },
  ];
  function byId(id) {
    return TOOLS.filter(function (t) { return t.id === id; })[0] || null;
  }
  // The scanner an entity is, or null.
  function tool(e) {
    return e && e.kind === "application" && e.tool ? byId(e.tool) : null;
  }
  function addScanner(doc, id, hostId, label, specOf) {
    return byId(id) ? N.addScanner(doc, id, hostId, label, specOf) : null;
  }
  // A result pasted into another tool's dialog says where it goes.
  function read(id, text) {
    var r = byId(id).read(text);
    if (!r.problem || r.problem.code === "empty") return r;
    var other = TOOLS.filter(function (t) { return t.id !== id && t.looks.test(String(text || "")); })[0];
    if (other) r.problem = { code: "other-scanner", message: "This result is from " + other.name + ", not " + byId(id).name + "; add " + other.name + " and paste it there." };
    return r;
  }
  function stampFor(id, scan, range, date) {
    return byId(id).stampFor(scan, range, date);
  }

  var api = { TOOLS: TOOLS, tool: tool, addScanner: addScanner, read: read, stampFor: stampFor };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorScanners = api;
})();
