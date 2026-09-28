// What a scan is aimed at, from the drawing (scan workflow spec §3, §4).
// Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;

  function split(words) {
    return String(words == null ? "" : words).trim().split(/[\s,]+/).filter(Boolean);
  }
  // The host a word names: the word itself, without the port or the URL
  // around it ("https://app.lab:8443/x", "[fd00::5]:443", "10.0.1.5:22").
  function hostOf(word) {
    var w = String(word);
    var url = /^[a-z][a-z0-9+.\-]*:\/\/([^\/?#]*)/i.exec(w);
    if (url) w = url[1];
    var six = /^\[([^\]]+)\](?::\d+)?$/.exec(w);
    if (six) return six[1];
    return /^[^:]+:\d+$/.test(w) ? w.replace(/:\d+$/, "") : w;
  }

  // The drawn hosts the words hold, by an address or by a name, in file
  // order: the hosts a scan of these words asked.
  function asked(doc, words) {
    var hosts = split(words).map(hostOf);
    var names = hosts.map(function (w) { return w.toLowerCase(); });
    var cover = hosts.join(" ");
    return Object.keys((doc && doc.entities) || {}).filter(function (id) {
      var e = doc.entities[id];
      if (e.kind !== "host") return false;
      if ((e.addresses || []).some(function (a) { return Ad.covers(cover, a); })) return true;
      return [String(e.label || "").trim().toLowerCase()].concat(e.names || []).some(function (n) { return !!n && names.indexOf(n) >= 0; });
    });
  }

  var api = { asked: asked, hostOf: hostOf };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorScanTargets = api;
})();
