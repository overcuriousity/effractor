// The scanners, one application per tool (roadmap scanner-readers, owner
// 2026-09-27): each reads its own format into the scan nmap.js plans from;
// planning, the preview and adding stay one. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var N = node ? require("./nmap.js") : window.effractorNmap;
  var M = node ? require("./masscan.js") : window.effractorMasscan;
  var G = node ? require("./greenbone.js") : window.effractorGreenbone;
  var Nu = node ? require("./nuclei.js") : window.effractorNuclei;

  // `looks`: whether a text that one tool refused is plainly this one's.
  var TOOLS = [
    { id: "nmap", name: "nmap", read: function (text) { return N.read(text); }, stampFor: N.stampFor, looks: /<nmaprun(?![^>]*scanner="(?!nmap")[^"]*")[\s>]/ },
    { id: "masscan", name: "masscan", read: M.read, stampFor: M.stampFor, looks: /<nmaprun[^>]*scanner="masscan"/ },
    { id: "greenbone", name: "Greenbone", read: G.read, stampFor: G.stampFor, notes: G.notes, looks: /<report[^>]*format_id=|<get_reports_response[\s>]/ },
    { id: "nuclei", name: "nuclei", read: Nu.read, stampFor: Nu.stampFor, notes: Nu.notes, looks: /"template-id"\s*:/ },
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
  // A result pasted into another tool's dialog says where it goes. One a
  // reader fails on says why, never nothing.
  function read(id, text) {
    var r;
    try {
      r = byId(id).read(text);
    } catch (e) {
      if (typeof console !== "undefined") console.error(e);
      return { problem: { code: "unreadable", message: "This result could not be read: " + String((e && e.message) || e).replace(/\.$/, "") + "." } };
    }
    if (!r.problem || r.problem.code === "empty") return r;
    var other = TOOLS.filter(function (t) { return t.id !== id && t.looks.test(String(text || "")); })[0];
    if (other) r.problem = { code: "other-scanner", message: "This result is from " + other.name + ", not " + byId(id).name + "; add " + other.name + " and paste it there." };
    return r;
  }
  // What a reader says of the result itself (Greenbone: its filter, the
  // way it scanned from).
  function notes(id, scan) {
    var t = byId(id);
    return t && t.notes ? t.notes(scan) : [];
  }
  function stampFor(id, scan, range, date) {
    return byId(id).stampFor(scan, range, date);
  }

  var api = { TOOLS: TOOLS, tool: tool, addScanner: addScanner, read: read, stampFor: stampFor, notes: notes };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorScanners = api;
})();
