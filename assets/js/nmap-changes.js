// What a rescan says changed since the drawing, and the firewall's
// permissions checked (nmap recipes spec §5). Pure.
(function () {
  var node = typeof module !== "undefined";


  var api = {};
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapChanges = api;
})();
