// The commands the nuclei dialog offers (roadmap nuclei-import; owner,
// 2026-09-28: a library of them, as nmap's is). Checked against nuclei
// 3.11.0. Nothing offered asks a third party: no public interactsh server,
// no update check, no public resolver, no upload; and nothing offered
// hides a scan. Pure.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;

  // ---- recipes and blocks ----

  // What to look for: each recipe is a set of nuclei's tags, and ticked
  // recipes are one list of them. `time` is for a handful of hosts.
  // `informational`: nuclei rates what it finds "info", which the import
  // reads as an open port and nothing more.
  var RECIPES = [
    { id: "all", name: "Everything standard", finds: "Every check nuclei has, but DoS, fuzzing and brute force.", time: "an hour or more", tags: [], alone: true, problem: "Everything standard holds the others; untick them." },
    { id: "cves", name: "Known vulnerabilities", finds: "Published CVEs, each by a check written for it.", time: "tens of minutes", tags: ["cve"] },
    { id: "exploited", name: "Exploited in the wild", finds: "Weaknesses attackers are known to use.", time: "minutes", tags: ["kev", "vkev"] },
    { id: "exposures", name: "Files and secrets left open", finds: "Configuration, backups, keys and logs anyone can read.", time: "minutes", tags: ["exposure"] },
    { id: "misconfig", name: "Misconfigurations", finds: "Settings that let in more than they should.", time: "minutes", tags: ["misconfig"] },
    { id: "logins", name: "Default passwords", finds: "Logins that still take the vendor's password.", time: "minutes", tags: ["default-login"], note: "Default passwords tries the vendors' passwords on every login it knows." },
    { id: "network", name: "Beyond the web", finds: "SSH, databases, mail and other services.", time: "minutes", tags: ["network"] },
    { id: "tls", name: "Certificates and TLS", finds: "Expired, self-signed or mismatched certificates, old TLS.", time: "seconds", tags: ["ssl"] },
    { id: "takeover", name: "Names that can be taken over", finds: "Names that point at a service nobody holds any more.", time: "seconds", tags: ["takeover"] },
    { id: "panels", name: "Logins and admin pages", finds: "Where someone can log in or administer. Seen, not drawn.", time: "minutes", tags: ["panel"], informational: true },
    { id: "tech", name: "What runs there", finds: "Software by its traces, without versions. Seen, not drawn.", time: "minutes", tags: ["tech"], informational: true },
    { id: "auto", name: "Fit the checks to the site", finds: "Looks what a site runs, then runs the checks for that.", time: "minutes", tags: [], alone: true, args: "-automatic-scan", problem: "Fit the checks to the site chooses its own checks; untick the others." },
    // With -dast nuclei runs its fuzzing checks and no others.
    { id: "fuzz", name: "Fuzz the parameters", finds: "Injection weaknesses, by payloads sent into every parameter.", time: "tens of minutes", tags: [], alone: true, args: "-dast", warning: "Sends attack payloads into the pages' parameters.", problem: "Fuzz the parameters runs its own checks; untick the others." },
  ];

  // Each block is one choice; the first is nuclei's own and adds nothing.
  // `field`: a text the choice needs, by its key in `extra`. `only`: the
  // recipe a block belongs to; without it the block is not offered.
  var BLOCKS = [
    { id: "severity", name: "Severity", choices: [
      { id: "any", name: "any" },
      { id: "low", name: "low and above", args: "-severity low,medium,high,critical", hint: "leaves out what is informational" },
      { id: "medium", name: "medium and above", args: "-severity medium,high,critical" },
      { id: "high", name: "high and critical", args: "-severity high,critical" },
      { id: "critical", name: "critical only", args: "-severity critical" },
    ] },
    { id: "checks", name: "Intrusive checks", choices: [
      { id: "standard", name: "nuclei's choice", hint: "no DoS, fuzzing or brute force" },
      { id: "careful", name: "none", args: "-exclude-tags intrusive", hint: "also leaves out checks that change the target" },
      { id: "all", name: "all", args: "-include-tags dos,fuzz,bruteforce", warning: "Runs denial-of-service, fuzzing and brute-force checks." },
    ] },
    { id: "templates", name: "Templates", choices: [
      { id: "installed", name: "all installed" },
      { id: "new", name: "new in the latest release", args: "-new-templates", hint: "after an update: only what it brought" },
    ] },
    { id: "protocols", name: "Protocols", choices: [
      { id: "all", name: "all" },
      { id: "web", name: "web", args: "-type http" },
      { id: "tls", name: "TLS", args: "-type ssl" },
      { id: "dns", name: "DNS", args: "-type dns", hint: "asks this machine's resolvers" },
      { id: "network", name: "other services", args: "-type tcp,javascript" },
    ] },
    { id: "browser", name: "Browser", choices: [
      { id: "off", name: "off" },
      { id: "on", name: "a real browser", args: "-headless", hint: "checks that need pages rendered · needs Chrome" },
    ] },
    { id: "code", name: "Code templates", choices: [
      { id: "off", name: "off" },
      { id: "on", name: "on", args: "-code", warning: "Runs the templates' code on this machine." },
    ] },
    { id: "payloads", name: "Payloads", only: "fuzz", choices: [
      { id: "low", name: "few" },
      { id: "medium", name: "more", args: "-fuzz-aggression medium" },
      { id: "high", name: "every one", args: "-fuzz-aggression high", hint: "slow" },
    ] },
    { id: "oast", name: "Out-of-band checks", choices: [
      { id: "off", name: "off", hint: "nuclei's public servers are never used" },
      { id: "own", name: "through my server", hint: "an interactsh server of your own", field: { key: "server", name: "Server", placeholder: "oast.lab.example", hint: "add -interactsh-token if it asks for one" } },
    ] },
    { id: "redirects", name: "Redirects", choices: [
      { id: "off", name: "not followed" },
      { id: "host", name: "on the same host", args: "-follow-host-redirects" },
      { id: "any", name: "anywhere", args: "-follow-redirects", hint: "may leave the range" },
    ] },
    { id: "addresses", name: "Addresses of a name", choices: [
      { id: "four", name: "its first IPv4" },
      { id: "six", name: "its first IPv6", args: "-ip-version 6" },
      { id: "both", name: "one of each", args: "-ip-version 4,6" },
      { id: "every", name: "every address", args: "-scan-all-ips -ip-version 4,6", hint: "each machine behind the name" },
    ] },
    { id: "login", name: "Logged in", choices: [
      { id: "off", name: "no" },
      { id: "header", name: "with a header", hint: "sent with every request", field: { key: "header", name: "Header", placeholder: "Cookie: session=…", hint: "stays in the command, never in the file" } },
    ] },
    { id: "portscan", name: "Ports first", choices: [
      { id: "off", name: "off" },
      { id: "on", name: "look which are open", args: "-preflight-portscan", hint: "skips hosts with nothing open" },
    ] },
    { id: "order", name: "Order", choices: [
      { id: "auto", name: "nuclei's choice" },
      { id: "host", name: "host by host", args: "-scan-strategy host-spray", hint: "every check on one host, then the next" },
      { id: "template", name: "check by check", args: "-scan-strategy template-spray", hint: "one check on every host, then the next" },
    ] },
    { id: "speed", name: "Speed", choices: [
      { id: "normal", name: "normal", hint: "150 requests a second" },
      { id: "gentle", name: "gentle", args: "-rate-limit 20 -concurrency 5", hint: "20 requests a second" },
      { id: "fast", name: "fast", args: "-rate-limit 500 -concurrency 50", warning: "Fast can overload small servers and set off alarms." },
    ] },
    { id: "patience", name: "Patience", choices: [
      { id: "normal", name: "normal", hint: "10 seconds, one retry" },
      { id: "slow", name: "for slow hosts", args: "-timeout 20 -retries 2" },
    ] },
    { id: "errors", name: "Giving up", choices: [
      { id: "thirty", name: "after 30 errors" },
      { id: "never", name: "never", args: "-no-mhe", hint: "for hosts that answer now and then · slower" },
    ] },
    { id: "honeypots", name: "Honeypots", choices: [
      { id: "off", name: "not looked for" },
      { id: "flag", name: "said", args: "-honeypot-detect", hint: "a host that matches too much" },
      { id: "hide", name: "said and left out", args: "-honeypot-detect -suppress-honeypot" },
    ] },
    { id: "evidence", name: "Evidence", choices: [
      { id: "none", name: "findings only" },
      { id: "raw", name: "with requests and answers", hint: "large · read past, never stored" },
    ] },
  ];
  var DEFAULTS = {};
  BLOCKS.forEach(function (b) { DEFAULTS[b.id] = b.choices[0].id; });

  function block(id) {
    return BLOCKS.filter(function (b) { return b.id === id; })[0] || null;
  }
  function choice(blockId, id) {
    var b = block(blockId);
    return b ? b.choices.filter(function (c) { return c.id === id; })[0] || null : null;
  }

  // The ticked recipes as one list of tags, `adjust` as one choice per
  // block. Returns {choices, recipes, notes} or {problem}.
  function combine(recipeIds, adjust) {
    var chosen = RECIPES.filter(function (r) { return (recipeIds || []).indexOf(r.id) >= 0; });
    if (!chosen.length) return { problem: "Choose what nuclei should look for." };
    var alone = chosen.filter(function (r) { return r.alone; })[0];
    if (alone && chosen.length > 1) return { problem: alone.problem };
    var ch = {}, notes = [];
    Object.keys(DEFAULTS).forEach(function (b) { ch[b] = DEFAULTS[b]; });
    Object.keys(adjust || {}).forEach(function (b) {
      if (choice(b, adjust[b])) ch[b] = adjust[b];
    });
    // A block of one recipe says nothing without it.
    BLOCKS.forEach(function (b) {
      if (b.only && !chosen.some(function (r) { return r.id === b.only; })) ch[b.id] = DEFAULTS[b.id];
    });
    chosen.forEach(function (r) { if (r.note) notes.push(r.note); });
    if (chosen.every(function (r) { return r.informational; })) notes.push("What these find is informational: in the drawing they only say a port is open.");
    return { choices: ch, recipes: chosen, notes: notes };
  }

  // ---- what to scan ----

  // "https://app.lab:8443/login", "app.lab:22", "[fd00::5]:22", "app.lab."
  // → {scheme, host, port}, each null where the text does not say.
  function target(text) {
    var s = typeof text === "string" ? text.trim() : "", out = { scheme: null, host: null, port: null };
    var m = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i.exec(s);
    if (m) {
      out.scheme = m[1].toLowerCase();
      s = m[2];
    }
    s = s.split(/[\/?#]/)[0];
    s = s.slice(s.lastIndexOf("@") + 1);
    function port(x) {
      var n = /^\d{1,5}$/.test(x || "") ? Number(x) : 0;
      return n > 0 && n < 65536 ? n : null;
    }
    var v6 = /^\[([^\]]*)\](?::(\d{1,5}))?$/.exec(s);
    if (v6) {
      out.host = v6[1];
      out.port = port(v6[2]);
    } else if (s.split(":").length === 2) {
      out.host = s.split(":")[0];
      out.port = port(s.split(":")[1]);
    } else out.host = s;
    out.host = out.host.replace(/\.$/, "") || null;
    return out;
  }
  // Whether a word of the range is a name, which nuclei would look up.
  function named(word) {
    var cidr = /^([^\/]+)\/\d{1,3}$/.exec(word);
    if (cidr && Ad.bytes(cidr[1])) return false;
    var host = target(word).host;
    return !!host && !Ad.bytes(host);
  }

  // Addresses, names, CIDR and URLs; nothing a shell reads as its own, and
  // no word may start with "-", which nuclei would take as an option.
  var RANGE_CHARS = /^[0-9A-Za-z.:\/\-_~%?=&@\[\]+]+$/;
  // What a shell leaves as it is without quotes.
  var BARE = /^[0-9A-Za-z.:\/,\-_]+$/;
  var SERVER_CHARS = /^[0-9A-Za-z.:\/\-_]+$/;
  // nuclei's own interactsh servers, and the public one's names.
  var PUBLIC_OAST = /(^|\.)(oast\.(pro|live|site|online|fun|me)|interact\.sh|interactsh\.com)$/i;
  var HEADER = /^[0-9A-Za-z-]+:[\x20-\x7e]*$/;
  // nuclei asks public resolvers unless given a list: this machine's own.
  var RESOLVERS = "awk '/^nameserver/ {print $2}' /etc/resolv.conf > resolvers.txt; ";

  // `extra`: {server: the interactsh server of one's own, header: what a
  // login sends}. Returns {text, note?, warning?} or {problem}.
  function command(recipeIds, adjust, range, extra) {
    extra = extra || {};
    var c = combine(recipeIds, adjust);
    if (c.problem) return { problem: c.problem };
    var words = String(range == null ? "" : range).trim().split(/[\s,]+/).filter(Boolean);
    if (!words.length) return { problem: "Give what to scan, such as 10.0.1.0/24 or https://app.lab:8443." };
    if (!words.every(function (w) { return RANGE_CHARS.test(w) && w[0] !== "-"; })) {
      return { problem: "The range may hold only addresses, names, CIDR and URLs, such as 10.0.1.0/24 or https://app.lab:8443." };
    }
    var ch = c.choices, notes = c.notes.slice(), warnings = [];
    var targets = words.join(",");
    var args = ["-target " + (BARE.test(targets) ? targets : "'" + targets + "'")];
    var tags = [];
    c.recipes.forEach(function (r) {
      r.tags.forEach(function (t) { if (tags.indexOf(t) < 0) tags.push(t); });
      if (r.args) args.push(r.args);
      if (r.warning) warnings.push(r.warning);
    });
    if (tags.length) args.push("-tags " + tags.join(","));

    var own = null, problem = null;
    BLOCKS.forEach(function (b) {
      var x = choice(b.id, ch[b.id]);
      if (x.args) args.push(x.args);
      if (x.warning && warnings.indexOf(x.warning) < 0) warnings.push(x.warning);
      if (problem || !x.field) return;
      var given = String(extra[x.field.key] == null ? "" : extra[x.field.key]).trim();
      if (b.id === "oast") {
        if (!given) problem = "Give your interactsh server, such as oast.lab.example.";
        else if (!SERVER_CHARS.test(given) || given[0] === "-") problem = "The server may hold only a name or a URL, such as oast.lab.example.";
        else if (PUBLIC_OAST.test(target(given).host || "")) problem = "That is a public server; give an interactsh server of your own.";
        else {
          own = given;
          args.push("-interactsh-server " + given);
        }
      } else if (b.id === "login") {
        if (!HEADER.test(given) || /['\\]/.test(given)) problem = "Give the header as Name: value, such as Cookie: session=…, without quotes or backslashes.";
        else args.push("-header '" + given + "'");
      }
    });
    if (problem) return { problem: problem };

    // DNS checks and names ask resolvers: this machine's, or nothing is asked.
    var names = words.some(named);
    var resolves = names || ch.protocols === "dns";
    if (resolves) args.push("-resolvers resolvers.txt");
    else if (ch.protocols === "all") args.push("-exclude-type dns");
    if (names) notes.push("Names are asked of this machine's resolvers; nuclei's own are public ones.");

    args.push("-jsonl -silent");
    if (ch.evidence !== "raw") args.push("-omit-raw");
    args.push("-omit-template");
    if (!own) args.push("-no-interactsh");
    args.push("-disable-update-check");
    var out = { text: (resolves ? RESOLVERS : "") + "nuclei " + args.join(" ") };
    if (notes.length) out.note = notes.join(" ");
    if (warnings.length) out.warning = warnings.join(" ");
    return out;
  }

  var api = { RECIPES: RECIPES, BLOCKS: BLOCKS, DEFAULTS: DEFAULTS, combine: combine, command: command, target: target };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNucleiCommand = api;
})();
