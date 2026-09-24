// nmap results into the architecture (docs/superpowers/specs/
// 2026-09-24-nmap-import-design.md): the commands the dialog offers, the XML
// they print read into a scan, the preview planned against the document, and
// the ticked rows applied as one edit with the contract of
// architecture-edit.js. Pure: no DOM, no wasm; wasm says whether the result
// is valid.
(function () {
  var node = typeof module !== "undefined";

  // ---- commands (spec §3.2) ----

  // `finds` and `time` are the dialog's one line per level.
  var LEVELS = [
    { id: "discover", name: "Discover", root: false, time: "seconds", finds: "hosts", args: "-sn" },
    { id: "standard", name: "Standard", root: false, time: "minutes", finds: "hosts, top 1000 TCP ports, services, products", args: "-sT -sV" },
    { id: "deep", name: "Deep", root: true, time: "tens of minutes", finds: "hosts, top 1000 TCP and UDP ports, services, products, OS guess", args: "-sS -sU -sV -O --top-ports 1000" },
    { id: "complete", name: "Complete", root: true, time: "hours", finds: "hosts, every TCP port, UDP 1–1024, services, products, OS guess", args: "-sS -sU -sV -O -p T:1-65535,U:1-1024" },
  ];

  function level(id) {
    return LEVELS.filter(function (l) { return l.id === id; })[0] || null;
  }

  // Addresses, names, ranges and CIDR only; no word may start with "-",
  // which nmap would take as an option.
  var RANGE_CHARS = /^[0-9A-Za-z.:\/,\- ]+$/;
  function command(levelId, range) {
    var l = level(levelId);
    if (!l) return null;
    var words = String(range == null ? "" : range).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { problem: "Give the range to scan, such as 10.0.1.0/24." };
    var text = words.join(" ");
    if (!RANGE_CHARS.test(text) || words.some(function (w) { return w[0] === "-"; })) {
      return { problem: "The range may hold only addresses, names, ranges and CIDR, such as 10.0.1.0/24." };
    }
    return { text: (l.root ? "sudo " : "") + "nmap " + l.args + " -oX - " + text };
  }

  var api = { LEVELS: LEVELS, level: level, command: command };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmap = api;
})();
