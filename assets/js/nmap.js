// nmap results into the architecture (the nmap import design, in history:
// see docs/HANDOFF.md; nmap recipes spec §6): one name over nmap-address,
// -read, -command, -route, -changes and -plan, as the rest of the app uses it.
(function () {
  var node = typeof module !== "undefined";
  function pick(file, name) {
    return node ? require(file) : window[name];
  }
  var A = pick("./architecture-edit.js", "effractorArchitectureEdit");
  var L = pick("./architecture-links.js", "effractorArchitectureLinks");
  var parts = [
    pick("./nmap-address.js", "effractorNmapAddress"),
    pick("./nmap-read.js", "effractorNmapRead"),
    pick("./nmap-command.js", "effractorNmapCommand"),
    pick("./nmap-route.js", "effractorNmapRoute"),
    pick("./nmap-changes.js", "effractorNmapChanges"),
    pick("./nmap-plan.js", "effractorNmapPlan"),
  ];

  // An application that is a scanner (`tool`), run by `hostId` as user
  // when given.
  function addScanner(doc, tool, hostId, label, specOf) {
    var added = A.addEntity(doc, "application", label, specOf("application"));
    if (!added) return null;
    added.doc.entities[added.entity].tool = tool;
    if (!hostId) return added;
    var hosted = L.putAssociation(added.doc, null, { kind: "hosts", from: hostId, to: added.entity, privilege: "user" });
    return hosted ? { doc: hosted.doc, select: added.select, entity: added.entity } : null;
  }
  function addNmap(doc, hostId, label, specOf) {
    return addScanner(doc, "nmap", hostId, label, specOf);
  }

  var api = {};
  parts.forEach(function (p) {
    Object.keys(p).forEach(function (k) { api[k] = p[k]; });
  });
  api.addNmap = addNmap;
  api.addScanner = addScanner;
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmap = api;
})();
