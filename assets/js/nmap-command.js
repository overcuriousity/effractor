// The commands the nmap dialog offers and the stamp of what ran (the nmap
// import design §3.2, in history; nmap recipes spec §2). Pure.
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

  // nmap's vulnerability checks (spec §3.2, §4.6). `not external` always:
  // nothing offered here asks a third party (the vuln category holds vulners).
  var CHECKS = [
    { id: "none", name: "none" },
    { id: "safe", name: "safe", script: "vuln and safe and not external" },
    { id: "all", name: "all", script: "vuln and not external", warning: "Runs exploits and denial-of-service checks." },
  ];
  function checksOffered(levelId) {
    return levelId !== "discover" && !!level(levelId);
  }

  // Addresses, names, ranges and CIDR only; no word may start with "-",
  // which nmap would take as an option.
  var RANGE_CHARS = /^[0-9A-Za-z.:\/,\- ]+$/;
  // An IPv6 word may end in the interface it is on (fe80::1%eth0): letters,
  // digits, "_", "." and "-", starting with a letter or digit.
  var ZONE = /%[0-9A-Za-z][0-9A-Za-z_.\-]*$/;
  function unzoned(w) {
    return w.indexOf(":") >= 0 ? w.replace(ZONE, "") : w;
  }
  function command(levelId, range, checksId) {
    var l = level(levelId);
    if (!l) return null;
    var words = String(range == null ? "" : range).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return { problem: "Give the range to scan, such as 10.0.1.0/24." };
    var text = words.join(" ");
    if (!RANGE_CHARS.test(words.map(unzoned).join(" ")) || words.some(function (w) { return w[0] === "-"; })) {
      return { problem: "The range may hold only addresses, names, ranges and CIDR, such as 10.0.1.0/24." };
    }
    // nmap scans IPv6 only with -6, and then no IPv4 address; a name may be either.
    var six = words.filter(function (w) { return w.indexOf(":") >= 0; });
    var four = words.filter(function (w) {
      return w.split(",").some(function (part) { return /^\d[\d.\/\-]*$/.test(part) && part.indexOf(".") >= 0; });
    });
    if (six.length && four.length) {
      return { problem: "IPv4 and IPv6 need separate scans; keep one kind in the range." };
    }
    var c = checksOffered(levelId) ? CHECKS.filter(function (x) { return x.id === checksId && x.script; })[0] : null;
    var script = c ? " --script '" + c.script + "'" : "";
    var out = { text: (l.root ? "sudo " : "") + "nmap " + (six.length ? "-6 " : "") + l.args + script + " -oX - " + text };
    var wide = six.map(unzoned).filter(function (w) { return /\/(\d{1,3})$/.test(w) && Number(w.split("/")[1]) < 112; });
    if (wide.length) out.note = wide[0] + " is too wide to scan in useful time; give addresses or a /112 or narrower.";
    return out;
  }

  // What nmap says it scanned: the words after "-oX -" in its own args, or
  // "" when it does not say (a command of the user's own, trimmed XML).
  function targetsOf(scan) {
    var args = String((scan && scan.args) || "");
    var at = args.indexOf(" -oX - ");
    return at >= 0 ? args.slice(at + 7).trim() : "";
  }

  var STAMP = /^Last nmap import: .*$/m;

  function stampLine(stamp) {
    var level = stamp.level ? stamp.level + " scan" + (stamp.checks ? " with " + stamp.checks + " checks" : "") : "scan";
    return "Last nmap import: " + stamp.date + ", " + level + (stamp.range ? " of " + stamp.range : "") + ".";
  }

  // What nmap says it ran (its args), not what the dialog shows now: the
  // level whose options it used, and its targets; the range field only when
  // nmap does not say.
  function stampFor(scan, range, date) {
    var args = String((scan && scan.args) || "").replace(/ -6 /, " ");
    // nmap writes a script expression with spaces in double quotes.
    var script = / --script ("[^"]*"|'[^']*'|\S+)/.exec(args);
    var c = script ? CHECKS.filter(function (x) { return x.script && x.script === script[1].replace(/^["']|["']$/g, ""); })[0] : null;
    if (c) args = args.replace(script[0], "");
    var l = LEVELS.filter(function (x) { return args.indexOf("nmap " + x.args + " -oX - ") >= 0; })[0];
    var targets = targetsOf(scan);
    var out = { date: date, level: l ? l.name : null, range: targets || String(range == null ? "" : range).trim().replace(/\s+/g, " ") };
    if (c && l) out.checks = c.id;
    return out;
  }
  var api = { LEVELS: LEVELS, CHECKS: CHECKS, checksOffered: checksOffered, level: level, command: command, targetsOf: targetsOf, STAMP: STAMP, stampLine: stampLine, stampFor: stampFor };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapCommand = api;
})();
