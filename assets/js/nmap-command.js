// The commands the nmap dialog offers and the stamp of what ran (the nmap
// import design §3.2, in history; nmap recipes spec §2). Pure.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;

  // ---- blocks and recipes (nmap recipes spec §2) ----

  // The scripts that say who a machine is, and the ports they talk to.
  // None of them asks a third party.
  var IDENTITY = ["ssh-hostkey", "ssl-cert", "nbstat", "smb-os-discovery"];
  var IDENTITY_PORTS = { tcp: "22,443,445", udp: "137" };
  // nmap's 100 most common TCP ports (nmap 7.95), for a list that is to
  // hold them: nmap takes a list or a top count, never both.
  var COMMON_TCP = "7,9,13,21-23,25-26,37,53,79-81,88,106,110-111,113,119,135,139,143-144,179,199,389,427,443-445,465,513-515,543-544,548,554,587,631,646,873,990,993,995,1025-1029,1110,1433,1720,1723,1755,1900,2000-2001,2049,2121,2717,3000,3128,3306,3389,3986,4899,5000,5009,5051,5060,5101,5190,5357,5432,5631,5666,5800,5900,6000-6001,6646,7070,8000,8008-8009,8080-8081,8443,8888,9100,9999-10000,32768,49152-49157";

  // Each block is one choice. Where recipes set a block, its choices stand
  // weakest first: combined recipes take the strongest. `group`: where
  // Adjust shows it (scan workflow spec §5). `field`: a text the choice
  // needs, by its key in `extra`; it goes into the command, so `shape`
  // says what it may be.
  var GROUPS = [
    { id: "hosts", name: "Finding hosts" },
    { id: "ports", name: "Ports" },
    { id: "depth", name: "Depth" },
    { id: "pace", name: "Pace" },
  ];
  var USUAL_TCP = "-PS22,80,443,445 -PA80,443", USUAL_UDP = "-PU53,161", ICMP = "-PE -PP -PM";
  var BLOCKS = [
    { id: "discovery", group: "hosts", name: "Discovery", choices: [
      { id: "ping", name: "ping" },
      { id: "arp", name: "ARP on this LAN", args: "-PR", root: true, hint: "finds MAC addresses · this network only" },
      { id: "tcp", name: "TCP to usual ports", args: USUAL_TCP, hint: "for hosts that ignore ping" },
      { id: "udp", name: "UDP to usual ports", args: USUAL_UDP, root: true },
      { id: "icmp", name: "every ICMP kind", args: ICMP, root: true, hint: "echo, timestamp and netmask" },
      { id: "every", name: "every probe", args: ICMP + " " + USUAL_TCP + " " + USUAL_UDP, root: true, hint: "finds the most · slower" },
      { id: "noping", name: "don't ping", args: "-Pn", hint: "for hosts that ignore ping · slower" },
      { id: "list", name: "names only", args: "-sL", hint: "asks DNS · sends nothing to the targets" },
    ] },
    { id: "names", group: "hosts", name: "Names", choices: [
      { id: "found", name: "of hosts that answer" },
      { id: "never", name: "never asked", args: "-n", hint: "faster · hosts go by their address" },
      { id: "every", name: "of every address", args: "-R", hint: "of those that do not answer too" },
      { id: "system", name: "by this machine's resolver", args: "--system-dns", hint: "one by one · slower" },
      { id: "own", name: "by a resolver of yours", field: { key: "resolver", name: "Resolver", placeholder: "10.0.1.1", hint: "addresses, separated by commas", flag: "--dns-servers" } },
    ] },
    { id: "exclude", group: "hosts", name: "Leave out", choices: [
      { id: "none", name: "nothing" },
      { id: "self", name: "the scanner's own host" },
      { id: "typed", name: "what is typed", field: { key: "exclude", name: "Left out", placeholder: "10.0.1.1 10.0.1.20", hint: "addresses, names, ranges and CIDR", flag: "--exclude" } },
    ] },
    { id: "interface", group: "hosts", name: "Interface", choices: [
      { id: "auto", name: "nmap's choice" },
      { id: "named", name: "named", field: { key: "iface", name: "Interface", placeholder: "eth0", hint: "as ip link names it", flag: "-e" } },
    ] },
    { id: "ports", group: "ports", name: "Ports", choices: [
      { id: "none", name: "none" },
      { id: "top20", name: "20 most common" },
      { id: "top100", name: "100 most common" },
      { id: "top1000", name: "1000 most common" },
      { id: "drawn", name: "as drawn", hint: "the ports drawn on the targets" },
      { id: "list", name: "a list" },
      { id: "all", name: "every TCP port", hint: "hours for a /24" },
    ] },
    { id: "tcp", group: "ports", name: "TCP scan", choices: [
      { id: "connect", name: "connect", args: "-sT" },
      { id: "syn", name: "SYN", args: "-sS", root: true },
      { id: "ack", name: "ACK", args: "-sA", root: true, passes: true },
      { id: "window", name: "window", args: "-sW", root: true, passes: true },
      { id: "fin", name: "FIN", args: "-sF", root: true, passes: true },
      { id: "null", name: "NULL", args: "-sN", root: true, passes: true },
      { id: "xmas", name: "Xmas", args: "-sX", root: true, passes: true },
    ] },
    { id: "udp", group: "ports", name: "UDP", choices: [
      { id: "off", name: "off" },
      { id: "top20", name: "20 most common", root: true },
      { id: "top100", name: "100 most common", root: true },
      { id: "top1000", name: "1000 most common", root: true, hint: "slow" },
    ] },
    { id: "depth", group: "depth", name: "Depth", choices: [
      { id: "ports", name: "open ports only" },
      { id: "versions", name: "products and versions", args: "-sV" },
      { id: "os", name: "versions and OS guess", args: "-sV -O", root: true },
    ] },
    { id: "effort", group: "depth", name: "Version effort", choices: [
      { id: "normal", name: "nmap's" },
      { id: "light", name: "light", args: "--version-light", hint: "faster · names fewer products" },
      { id: "all", name: "every probe", args: "--version-all", hint: "slow" },
    ] },
    { id: "osguess", group: "depth", name: "OS guess", choices: [
      { id: "normal", name: "nmap's" },
      { id: "limit", name: "only where it can tell", args: "--osscan-limit", hint: "hosts with an open and a closed port" },
      { id: "guess", name: "guess harder", args: "--osscan-guess" },
    ] },
    { id: "identity", group: "depth", name: "Identity", choices: [
      { id: "off", name: "off" },
      { id: "on", name: "SSH keys, NetBIOS and certificate names", root: true },
    ] },
    { id: "route", group: "depth", name: "Route", choices: [
      { id: "off", name: "off" },
      { id: "on", name: "traceroute", args: "--traceroute", root: true },
    ] },
    { id: "reasons", group: "depth", name: "Reasons", choices: [
      { id: "off", name: "off" },
      { id: "on", name: "why each port is in its state", args: "--reason" },
    ] },
    { id: "checks", group: "depth", name: "Checks", choices: [
      { id: "none", name: "none", hint: "no scripts" },
      { id: "safe", name: "safe", script: "vuln and safe and not external", hint: "vulnerability checks that break nothing · slower" },
      { id: "all", name: "all", script: "vuln and not external", warning: "Runs exploits and denial-of-service checks." },
    ] },
    { id: "pace", group: "pace", name: "Pace", choices: [
      { id: "polite", name: "polite", args: "-T2", hint: "slower · gentler on the network" },
      { id: "normal", name: "normal" },
      { id: "fast", name: "fast", args: "-T4", hint: "for a fast, reliable network" },
      { id: "insane", name: "insane", args: "-T5", warning: "Misses ports on all but the fastest networks." },
    ] },
    { id: "rate", group: "pace", name: "Rate", choices: [
      { id: "auto", name: "nmap's" },
      { id: "most", name: "at most", field: { key: "rate", name: "Packets a second", placeholder: "100", hint: "1 to 100,000", flag: "--max-rate" } },
      { id: "least", name: "at least", warning: "Can overload small routers and set off alarms.", field: { key: "rate", name: "Packets a second", placeholder: "1000", hint: "1 to 100,000", flag: "--min-rate" } },
    ] },
    { id: "retries", group: "pace", name: "Retries", choices: [
      { id: "auto", name: "nmap's" },
      { id: "one", name: "one", args: "--max-retries 1" },
      { id: "none", name: "none", args: "--max-retries 0", warning: "Misses ports." },
    ] },
    { id: "patience", group: "pace", name: "Giving up on a host", choices: [
      { id: "never", name: "never" },
      { id: "quarter", name: "after 15 minutes", args: "--host-timeout 15m" },
      { id: "hour", name: "after an hour", args: "--host-timeout 1h" },
    ] },
    { id: "delay", group: "pace", name: "Wait between probes", choices: [
      { id: "none", name: "none" },
      { id: "second", name: "1 second", args: "--scan-delay 1s", hint: "for devices that limit their answers" },
    ] },
  ];
  // The scans that say what a filter passes, not what is open.
  var PASSES_HINT = "says what a filter passes, not what is open";
  BLOCKS.forEach(function (b) {
    b.choices.forEach(function (c) { if (c.passes) c.hint = PASSES_HINT; });
  });
  var DEFAULTS = { discovery: "ping", names: "found", exclude: "none", "interface": "auto", ports: "none", tcp: "connect", udp: "off", depth: "ports", effort: "normal", osguess: "normal", identity: "off", route: "off", reasons: "off", checks: "none", pace: "normal", rate: "auto", retries: "auto", patience: "never", delay: "none" };
  var TOP = { top20: 20, top100: 100, top1000: 1000 };

  // `finds` and `time` (for a /24): the dialog's words per recipe.
  var RECIPES = [
    { id: "lan", name: "Who is on this LAN", finds: "Hosts with their MAC addresses and vendors.", time: "seconds", sets: { discovery: "arp" } },
    { id: "names", name: "Names only", finds: "Names from DNS. Sends nothing to the targets.", time: "seconds", sets: { discovery: "list" }, alone: true },
    { id: "services", name: "What runs there", finds: "Open TCP ports, services and products.", time: "minutes", sets: { ports: "top1000", depth: "versions" } },
    { id: "identity", name: "Who it really is", finds: "SSH keys, NetBIOS and certificate names, the MAC across routers.", time: "minutes", sets: { identity: "on" } },
    { id: "route", name: "Map the route", finds: "Routers and networks on the way.", time: "minutes", sets: { route: "on" } },
    { id: "firewall", name: "What a firewall passes", finds: "What gets through each firewall on the way.", time: "minutes", sets: { ports: "list", tcp: "syn", reasons: "on", route: "on" } },
    { id: "checks", name: "Check for known weaknesses", finds: "Known vulnerabilities, by checks that break nothing.", time: "tens of minutes", sets: { ports: "top1000", depth: "versions", checks: "safe" } },
  ];

  function block(id) {
    return BLOCKS.filter(function (b) { return b.id === id; })[0] || null;
  }
  function choice(blockId, id) {
    var b = block(blockId);
    return b ? b.choices.filter(function (c) { return c.id === id; })[0] || null : null;
  }
  function rank(blockId, id) {
    var b = block(blockId);
    return b ? b.choices.map(function (c) { return c.id; }).indexOf(id) : -1;
  }
  function recipe(id) {
    return RECIPES.filter(function (r) { return r.id === id; })[0] || null;
  }

  // The ticked recipes as one choice per block, `adjust` over them.
  // Returns {choices, root, notes} or {problem}.
  function combine(recipeIds, adjust) {
    var chosen = RECIPES.filter(function (r) { return (recipeIds || []).indexOf(r.id) >= 0; });
    if (!chosen.length) return { problem: "Choose what the scan is for." };
    if (chosen.length > 1 && chosen.some(function (r) { return r.alone; })) {
      return { problem: "Names only sends nothing to the targets, so it goes alone; untick the others." };
    }
    var ch = {}, set = {}, notes = [];
    Object.keys(DEFAULTS).forEach(function (b) { ch[b] = DEFAULTS[b]; });
    chosen.forEach(function (r) {
      Object.keys(r.sets).forEach(function (b) {
        if (rank(b, r.sets[b]) > rank(b, ch[b])) ch[b] = r.sets[b];
        set[b] = true;
      });
    });
    Object.keys(adjust || {}).forEach(function (b) {
      if (!choice(b, adjust[b])) return;
      ch[b] = adjust[b];
      set[b] = true;
    });
    if (ch.discovery === "list") return { choices: ch, root: false, notes: notes };
    // Identity talks to tcp/22, 443, 445 and udp/137: the 100 most common
    // ports of each hold them.
    if (ch.identity === "on") {
      if (ch.ports === "none") ch.ports = "top100";
      if (ch.ports !== "list" && ch.udp === "off") ch.udp = "top100";
    }
    if (ch.ports === "none" && ch.udp === "off") {
      if (ch.depth !== "ports" || ch.checks !== "none") notes.push("Versions and checks need ports; choose Ports in Adjust.");
      ch.depth = "ports";
      ch.checks = "none";
    }
    // What adds nothing without its block is as nmap has it.
    if (ch.depth === "ports") ch.effort = "normal";
    if (ch.depth !== "os") ch.osguess = "normal";
    var root = Object.keys(ch).some(function (b) { return b !== "tcp" && choice(b, ch[b]).root; });
    // A scan that runs as root anyway takes the SYN scan, unless told not to.
    if (root && !set.tcp) ch.tcp = "syn";
    if (ch.ports !== "none" && choice("tcp", ch.tcp).root) root = true;
    return { choices: ch, root: root, notes: notes };
  }

  // ---- port lists ----

  // "22,80,8000-8100", with T: and U: before what follows them; numbers
  // and ranges only. Returns {tcp: {port: true}, udp: {…}} or null.
  function portsOf(text) {
    var out = { tcp: Object.create(null), udp: Object.create(null) };
    var proto = "tcp";
    var items = String(text == null ? "" : text).trim().split(",");
    for (var i = 0; i < items.length; i++) {
      var m = /^(?:([TU]):)?(\d{1,5})(?:-(\d{1,5}))?$/.exec(items[i].trim());
      if (!m) return null;
      if (m[1]) proto = m[1] === "U" ? "udp" : "tcp";
      var lo = Number(m[2]), hi = m[3] == null ? lo : Number(m[3]);
      if (lo < 1 || hi > 65535 || hi < lo) return null;
      for (var p = lo; p <= hi; p++) out[proto][p] = true;
    }
    return out;
  }
  function join(into, from) {
    ["tcp", "udp"].forEach(function (proto) {
      Object.keys(from[proto]).forEach(function (p) { into[proto][p] = true; });
    });
    return into;
  }
  // A set of ports as nmap takes it: sorted, runs as ranges.
  function written(set) {
    var ports = Object.keys(set).map(Number).sort(function (a, b) { return a - b; });
    var out = [];
    for (var i = 0; i < ports.length; i++) {
      var j = i;
      while (j + 1 < ports.length && ports[j + 1] === ports[j] + 1) j++;
      out.push(j > i ? ports[i] + "-" + ports[j] : String(ports[i]));
      i = j;
    }
    return out.join(",");
  }
  function listArg(list) {
    var t = written(list.tcp), u = written(list.udp);
    if (!u) return "-p " + t;
    return "-p " + (t ? "T:" + t + "," : "") + "U:" + u;
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
  // ---- what is typed into the command (scan workflow spec §5.1) ----

  // Each is held to its shape, since it goes into the command: what it
  // comes to there, or null.
  var SHAPES = {
    resolver: function (text) {
      var list = text.split(/[\s,]+/).filter(Boolean);
      return list.length && list.every(function (a) { return !!Ad.bytes(a); }) ? list.join(",") : null;
    },
    exclude: function (text) {
      var list = text.split(/[\s,]+/).filter(Boolean);
      var fine = list.length && list.every(function (w) { return RANGE_CHARS.test(unzoned(w)) && w[0] !== "-"; });
      return fine ? list.join(",") : null;
    },
    iface: function (text) {
      return /^[0-9A-Za-z][0-9A-Za-z_.\-]{0,14}$/.test(text) ? text : null;
    },
    rate: function (text) {
      return /^[1-9]\d{0,5}$/.test(text) && Number(text) <= 100000 ? text : null;
    },
  };
  var ASKS = {
    resolver: "Give the resolver's address, such as 10.0.1.1.",
    exclude: "Give what to leave out: addresses, names, ranges and CIDR, such as 10.0.1.1.",
    iface: "Give the interface, such as eth0.",
    rate: "Give the packets a second, from 1 to 100000.",
  };
  // The argument of a choice that needs a text: {arg} or {problem}.
  function typed(field, extra) {
    var text = String(extra[field.key] == null ? "" : extra[field.key]).trim();
    var value = text ? SHAPES[field.key](text) : null;
    return value ? { arg: field.flag + " " + value } : { problem: ASKS[field.key] };
  }

  // `extra`: {portList: the typed list, drawnPorts: ["tcp/443", …] the
  // firewall recipe takes from the drawing, ack: the ACK scan as a second
  // command, asDrawn: ["tcp/443", …] the ports drawn on the targets, self:
  // the addresses of the scanner's own host, and the typed texts by their
  // keys}. Returns {text, root, second?, note?, warning?} or {problem}.
  function command(recipeIds, adjust, range, extra) {
    extra = extra || {};
    var c = combine(recipeIds, adjust);
    if (c.problem) return { problem: c.problem };
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
    var ch = c.choices, notes = c.notes.slice();
    var firewall = (recipeIds || []).indexOf("firewall") >= 0;
    var args = [], list = null, problem = null, warnings = [];
    function arg(blockId) {
      var c = choice(blockId, ch[blockId]);
      if (c.warning && blockId !== "checks") warnings.push(c.warning);
      if (c.args) args.push(c.args);
      if (!c.field || problem) return;
      var t = typed(c.field, extra);
      if (t.problem) problem = t.problem;
      else args.push(t.arg);
    }
    arg("discovery");
    arg("names");
    if (ch.exclude === "self") {
      var own = (extra.self || []).filter(function (a) { return !!Ad.bytes(a); });
      if (own.length) args.push("--exclude " + own.join(","));
      else notes.push("The scanner is on no host with an address; nothing is left out.");
    } else arg("exclude");
    arg("interface");
    if (ch.discovery !== "list") {
      var ports = ch.ports;
      if (ports === "drawn") {
        list = { tcp: Object.create(null), udp: Object.create(null) };
        (extra.asDrawn || []).forEach(function (p) {
          var m = /^(tcp|udp)\/(\d{1,5})$/.exec(p);
          if (m && Number(m[2]) >= 1 && Number(m[2]) <= 65535) list[m[1]][Number(m[2])] = true;
        });
        if (!Object.keys(list.tcp).length && !Object.keys(list.udp).length) return { problem: "Nothing is drawn there yet; choose 1000 most common." };
        if (ch.identity === "on") join(list, portsOf("T:" + IDENTITY_PORTS.tcp + ",U:" + IDENTITY_PORTS.udp));
      }
      if (ports === "list") {
        list = portsOf(String(extra.portList || "").trim() || null);
        if (String(extra.portList || "").trim() && !list) {
          return { problem: "The port list may hold only port numbers and ranges, such as 22,80,8000-8100." };
        }
        list = list || { tcp: Object.create(null), udp: Object.create(null) };
        (extra.drawnPorts || []).forEach(function (p) {
          var m = /^(tcp|udp)\/(\d{1,5})$/.exec(p);
          if (m && firewall) list[m[1]][Number(m[2])] = true;
        });
        var given = Object.keys(list.tcp).length + Object.keys(list.udp).length;
        if (!given && !firewall) return { problem: "Give the ports to scan, such as 22,80,8000-8100." };
        // The firewall recipe with nothing drawn to test: the 1000 most common.
        if (!given) {
          ports = "top1000";
          // Without a list, Identity takes its ports as it does elsewhere.
          if (ch.identity === "on" && ch.udp === "off") ch.udp = "top100";
        } else {
          if (firewall) join(list, portsOf(COMMON_TCP));
          if (ch.identity === "on") join(list, portsOf("T:" + IDENTITY_PORTS.tcp + ",U:" + IDENTITY_PORTS.udp));
          if (!(adjust && adjust.ports) && (recipeIds || []).some(function (id) { return recipe(id) && recipe(id).sets.ports === "top1000"; })) {
            notes.push("A port list and the 1000 most common ports do not go into one scan; this one takes the list.");
          }
        }
      }
      var listed = ports === "list" || ports === "drawn";
      var tcp = listed ? Object.keys(list.tcp).length > 0 : ports !== "none";
      var udp = listed ? Object.keys(list.udp).length > 0 : ch.udp !== "off";
      if (!tcp && !udp) args.push("-sn");
      if (tcp) arg("tcp");
      if (udp) args.push("-sU");
      if (listed) args.push(listArg(list));
      else if (ports === "all") args.push(udp ? "-p T:1-65535,U:1-1024" : "-p-");
      else if (tcp || udp) {
        var most = Math.max(tcp ? TOP[ports] || 0 : 0, udp ? TOP[ch.udp] || 0 : 0);
        // nmap's own default is the 1000 most common TCP ports.
        if (most !== 1000 || udp) args.push("--top-ports " + most);
        if (tcp && udp && (TOP[ch.udp] || 0) < most) notes.push("nmap takes one count for TCP and UDP: UDP is scanned as widely as TCP here, which is slow.");
      }
      if (tcp || udp) {
        arg("depth");
        arg("effort");
        arg("osguess");
      }
      arg("reasons");
      arg("route");
      var scripts = [];
      if (ch.identity === "on") scripts.push(IDENTITY.join(" or "));
      if ((tcp || udp) && choice("checks", ch.checks).script) scripts.push(choice("checks", ch.checks).script);
      if (scripts.length) {
        args.push("--script '" + (scripts.length > 1 ? scripts.map(function (x) { return "(" + x + ")"; }).join(" or ") : scripts[0]) + "'");
      }
      ["pace", "rate", "retries", "patience", "delay"].forEach(arg);
    }
    if (problem) return { problem: problem };
    // A UDP scan needs root, however its ports were named (a list, as drawn).
    var root = (c.root || !!udp) && ch.discovery !== "list";
    var v6 = six.length ? "-6 " : "";
    var out = { text: (root ? "sudo " : "") + "nmap " + v6 + args.join(" ") + " -oX - " + text, root: root };
    // nmap runs one TCP scan type per run: the ACK scan is a second command.
    if (extra.ack && firewall && ch.discovery !== "list") {
      var only = list && Object.keys(list.tcp).length ? " -p " + written(list.tcp) : "";
      out.second = "sudo nmap " + v6 + "-sA --reason" + only + " -oX - " + text;
    }
    var wide = six.map(unzoned).filter(function (w) { return /\/(\d{1,3})$/.test(w) && Number(w.split("/")[1]) < 112; });
    if (wide.length) notes.unshift(wide[0] + " is too wide to scan in useful time; give addresses or a /112 or narrower.");
    if (notes.length) out.note = notes.join(" ");
    if (warnings.length) out.warning = warnings.join(" ");
    return out;
  }

  // What nmap says it scanned: the words after "-oX -" in its own args, or
  // "" when it does not say (a command of the user's own, trimmed XML).
  function targetsOf(scan) {
    var args = String((scan && scan.args) || "");
    var at = args.indexOf(" -oX - ");
    return at >= 0 ? args.slice(at + 7).trim() : "";
  }

  // ---- the stamp ----

  var STAMP = /^Last nmap import: .*$/m;

  // The recipes a command holds, as nmap says it ran (its args).
  function recipesOf(args) {
    var a = " " + String(args || "").replace(/\s+/g, " ") + " ";
    function has(word) {
      return a.indexOf(" " + word + " ") >= 0;
    }
    // nmap writes a script expression with spaces in double quotes.
    var script = / --script ("[^"]*"|'[^']*'|\S+)/.exec(a);
    var expr = script ? script[1] : "";
    if (has("-sL")) return ["names"];
    var out = [];
    if (has("-PR")) out.push("lan");
    if (has("-sV") || has("-A")) out.push("services");
    if (expr.indexOf("ssh-hostkey") >= 0) out.push("identity");
    if (has("--traceroute")) out.push(has("--reason") ? "firewall" : "route");
    if (/\bvuln\b/.test(expr)) out.push("checks");
    return out;
  }

  // What nmap says it ran, not what the dialog shows now; the range field
  // only when nmap does not say.
  function stampFor(scan, range, date) {
    var args = String((scan && scan.args) || "");
    var out = { date: date, recipes: recipesOf(args), range: targetsOf(scan) || String(range == null ? "" : range).trim().replace(/\s+/g, " ") };
    if (out.recipes.indexOf("checks") >= 0 && !/\bsafe\b/.test(args)) out.checks = "all";
    return out;
  }

  function stampLine(stamp) {
    var names = (stamp.recipes || []).map(function (id) {
      var r = recipe(id);
      return r ? r.name.toLowerCase() + (id === "checks" && stamp.checks === "all" ? " (all checks)" : "") : null;
    }).filter(Boolean);
    return "Last nmap import: " + stamp.date + ", scan" + (stamp.range ? " of " + stamp.range : "") + (names.length ? " · " + names.join(", ") : "") + ".";
  }

  var api = { GROUPS: GROUPS, BLOCKS: BLOCKS, RECIPES: RECIPES, DEFAULTS: DEFAULTS, combine: combine, command: command, portsOf: portsOf, recipesOf: recipesOf, targetsOf: targetsOf, STAMP: STAMP, stampLine: stampLine, stampFor: stampFor };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapCommand = api;
})();
