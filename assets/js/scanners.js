// The scanners, one application per tool (roadmap scanner-readers, owner
// 2026-09-27): each reads its own format into the scan nmap.js plans from;
// planning, the preview and adding stay one. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var N = node ? require("./nmap.js") : window.effractorNmap;
  var M = node ? require("./masscan.js") : window.effractorMasscan;

  var TOOLS = [
    { id: "nmap", name: "nmap", read: function (text) { return N.read(text); }, stampFor: N.stampFor },
    { id: "masscan", name: "masscan", read: M.read, stampFor: M.stampFor },
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
  function read(id, text) {
    return byId(id).read(text);
  }
  function stampFor(id, scan, range, date) {
    return byId(id).stampFor(scan, range, date);
  }

  var api = { TOOLS: TOOLS, tool: tool, addScanner: addScanner, read: read, stampFor: stampFor };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorScanners = api;
})();
