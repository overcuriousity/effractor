// Traceroute hops into routers and the networks between them (nmap recipes
// spec §4). Pure.
(function () {
  var node = typeof module !== "undefined";


  var api = {};
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapRoute = api;
})();
