// One comparison of products for every scanner (nuclei templates spec §7.3):
// by name and by the first word of the version, whatever their case, so
// nmap's "OpenSSH 9.6p1 Ubuntu 3ubuntu13.5" and a banner's "OpenSSH 9.6p1"
// are one product. Pure.
(function () {
  var node = typeof module !== "undefined";

  // A product nobody has named: "unidentified ssh on Server".
  function unidentified(label) {
    return /^unidentified /i.test(String(label == null ? "" : label).trim());
  }
  // "OpenSSH 9.6p1 Ubuntu 3ubuntu13.5" → {name: "openssh", version: "9.6p1"};
  // the version is the first word that begins with a digit and is not the
  // first word ("3Com switch" has none). Where the word after it is a
  // version with a dot, the first is a year or an edition and belongs to
  // the name ("Microsoft SQL Server 2019 15.00.2000.00", "Log4j 2 2.17.0").
  function parts(label) {
    var text = String(label == null ? "" : label).trim().replace(/\s+/g, " ");
    if (unidentified(text)) return { name: text.toLowerCase(), version: null };
    var words = text.split(" ");
    for (var i = 1; i < words.length; i++) {
      if (!/^v?[0-9]/i.test(words[i])) continue;
      if (/^v?[0-9]+[.][0-9]/i.test(words[i + 1] || "")) i++;
      return { name: words.slice(0, i).join(" ").toLowerCase(), version: words[i].toLowerCase().replace(/^v/, "").replace(/[^0-9a-z]+$/, "") };
    }
    return { name: text.toLowerCase(), version: null };
  }
  function key(label) {
    var p = parts(label);
    return p.name + (p.version ? " " + p.version : "");
  }
  function same(a, b) {
    return key(a) === key(b);
  }
  // Whether `drawn` is the product `found` says more of: nobody named it,
  // or it has the name and no version.
  function lacks(drawn, found) {
    if (unidentified(drawn)) return !unidentified(found);
    var d = parts(drawn), f = parts(found);
    return d.name === f.name && !d.version && !!f.version;
  }

  var api = { unidentified: unidentified, parts: parts, key: key, same: same, lacks: lacks };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapProducts = api;
})();
