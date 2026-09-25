// nmap results into the architecture (docs/superpowers/specs/
// 2026-09-24-nmap-import-design.md): the commands the dialog offers, the XML
// they print read into a scan, the preview planned against the document, and
// the ticked rows applied as one edit with the contract of
// architecture-edit.js. Pure: no DOM, no wasm; wasm says whether the result
// is valid.
(function () {
  var node = typeof module !== "undefined";
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;
  var L = node ? require("./architecture-links.js") : window.effractorArchitectureLinks;

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
    // nmap scans IPv6 only with -6, and then nothing else.
    var six = words.filter(function (w) { return w.indexOf(":") >= 0; });
    if (six.length && six.length < words.length) {
      return { problem: "IPv4 and IPv6 need separate scans; keep one kind in the range." };
    }
    var c = checksOffered(levelId) ? CHECKS.filter(function (x) { return x.id === checksId && x.script; })[0] : null;
    var script = c ? " --script '" + c.script + "'" : "";
    var out = { text: (l.root ? "sudo " : "") + "nmap " + (six.length ? "-6 " : "") + l.args + script + " -oX - " + text };
    var wide = six.map(unzoned).filter(function (w) { return /\/(\d{1,3})$/.test(w) && Number(w.split("/")[1]) < 112; });
    if (wide.length) out.note = wide[0] + " is too wide to scan in useful time; give addresses or a /112 or narrower.";
    return out;
  }

  // ---- reading (spec §3.3) ----

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  var ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };
  function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, function (m, e) {
      if (e[0] === "#") {
        var n = e[1] === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : m;
      }
      return has(ENTITIES, e) ? ENTITIES[e] : m;
    });
  }

  // Where the tag opened at `lt` ends: the first ">" outside quotes, or -1.
  function tagEnd(text, lt) {
    var quote = null;
    for (var i = lt + 1; i < text.length; i++) {
      var c = text[i];
      if (quote) {
        if (c === quote) quote = null;
      } else if (c === '"' || c === "'") quote = c;
      else if (c === ">") return i;
    }
    return -1;
  }

  // Elements, their attributes and their text (a script's <elem> values).
  // Returns the document's root holder, or {error: "not-xml" | "truncated"}.
  var NAME = /^[A-Za-z_][-A-Za-z0-9_:.]*/;
  function parseXml(text) {
    var root = { name: "", attrs: {}, children: [], text: "" };
    var stack = [root];
    var i = 0;
    for (;;) {
      var lt = text.indexOf("<", i);
      if (lt < 0) break;
      if (lt > i) stack[stack.length - 1].text += decode(text.slice(i, lt));
      var skip = text.startsWith("<!--", lt) ? "-->" : text.startsWith("<?", lt) ? "?>" : text.startsWith("<!", lt) ? ">" : null;
      if (skip) {
        var end = text.indexOf(skip, lt + 2);
        if (end < 0) return { error: "truncated" };
        i = end + skip.length;
        continue;
      }
      var gt = tagEnd(text, lt);
      if (gt < 0) return { error: "truncated" };
      var tag = text.slice(lt + 1, gt).trim();
      if (tag[0] === "/") {
        var name = tag.slice(1).trim();
        if (stack.length < 2 || stack[stack.length - 1].name !== name) return { error: "not-xml" };
        stack.pop();
      } else {
        var selfClosing = tag[tag.length - 1] === "/";
        if (selfClosing) tag = tag.slice(0, -1);
        var m = NAME.exec(tag);
        if (!m) return { error: "not-xml" };
        var el = { name: m[0], attrs: {}, children: [], text: "" };
        var ATTR = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        ATTR.lastIndex = m[0].length;
        var a;
        while ((a = ATTR.exec(tag))) el.attrs[a[1]] = decode(a[2] != null ? a[2] : a[3]);
        stack[stack.length - 1].children.push(el);
        if (!selfClosing) stack.push(el);
      }
      i = gt + 1;
    }
    return stack.length === 1 ? root : { error: "truncated" };
  }

  function kids(el, name) {
    return el ? el.children.filter(function (c) { return c.name === name; }) : [];
  }
  function kid(el, name) {
    return kids(el, name)[0] || null;
  }

  var PROBLEMS = {
    "empty": "Paste the output of the command above.",
    "not-xml": "This is not XML. The command writes XML with -oX -.",
    "normal-output": "This is nmap's normal output; run the command with -oX -.",
    "not-nmap": "This is not an nmap result.",
    "truncated": "The result is cut off; copy the whole output, from <?xml to </nmaprun>.",
    "no-host-up": "No host answered. Check the range, or try from another host.",
  };
  function problem(code, detail) {
    return { problem: { code: code, message: code === "nmap-error" ? "nmap stopped: " + detail : PROBLEMS[code] } };
  }

  function serviceOf(port) {
    var s = kid(port, "service");
    if (!s) return null;
    return { name: s.attrs.name || null, product: s.attrs.product || null, version: s.attrs.version || null };
  }

  // A script's output and, when it wrote nmap's vulnerability report, each
  // entry of it: a <table> holding <elem key="state">.
  function elemOf(table, key) {
    var e = kids(table, "elem").filter(function (x) { return x.attrs.key === key; })[0];
    return e ? e.text.trim() : null;
  }
  function scriptOf(el) {
    return {
      id: el.attrs.id || "",
      output: el.attrs.output || "",
      vulns: kids(el, "table").filter(function (t) { return elemOf(t, "state") != null; }).map(function (t) {
        var ids = kids(t, "table").filter(function (x) { return x.attrs.key === "ids"; })[0];
        return {
          key: t.attrs.key || "",
          title: elemOf(t, "title") || "",
          state: elemOf(t, "state"),
          ids: kids(ids, "elem").map(function (x) { return x.text.trim(); }).filter(Boolean),
        };
      }),
    };
  }

  function hostOf(h) {
    var names = kids(kid(h, "hostnames"), "hostname");
    var match = kids(kid(h, "os"), "osmatch")[0];
    return {
      addresses: kids(h, "address").filter(function (a) {
        return a.attrs.addrtype === "ipv4" || a.attrs.addrtype === "ipv6";
      }).map(function (a) { return a.attrs.addr; }),
      hostname: names.length ? names[0].attrs.name || null : null,
      // A root scan marks nmap's own addresses.
      self: !!kid(h, "status") && kid(h, "status").attrs.reason === "localhost-response",
      os: match ? { name: match.attrs.name, accuracy: Number(match.attrs.accuracy) } : null,
      // nmap's device classes for its best match: "WAP", "broadband router"…
      device: kids(match, "osclass").map(function (c) { return c.attrs.type; }).filter(Boolean),
      ports: kids(kid(h, "ports"), "port").map(function (p) {
        var state = kid(p, "state");
        return { protocol: p.attrs.protocol, port: Number(p.attrs.portid), state: state ? state.attrs.state : "", service: serviceOf(p), scripts: kids(p, "script").map(scriptOf) };
      }),
      scripts: kids(kid(h, "hostscript"), "script").map(scriptOf),
    };
  }

  // Several listings of one machine as one host: every address and port
  // once (an open listing of a port wins), the first name, OS guess and
  // device class. Ports are keyed, so a Complete scan folds in linear time.
  function oneHost(listings) {
    var same = { addresses: [], hostname: null, os: null, device: [], self: false, ports: [], scripts: [] };
    var address = Object.create(null), port = Object.create(null), script = Object.create(null);
    listings.forEach(function (h) {
      h.addresses.forEach(function (a) {
        if (address[addressKey(a)]) return;
        address[addressKey(a)] = true;
        same.addresses.push(a);
      });
      same.hostname = same.hostname || h.hostname;
      same.os = same.os || h.os;
      if (!same.device.length) same.device = h.device || [];
      same.self = same.self || !!h.self;
      (h.scripts || []).forEach(function (s) {
        if (script[s.id]) return;
        script[s.id] = true;
        same.scripts.push(s);
      });
      h.ports.forEach(function (p) {
        var k = p.protocol + "/" + p.port;
        if (!has(port, k)) {
          port[k] = same.ports.length;
          same.ports.push(p);
        } else if (same.ports[port[k]].state !== "open" && p.state === "open") same.ports[port[k]] = p;
      });
    });
    return same;
  }

  // nmap lists a host once per time the range names it (an address and its
  // name): one host, with every port once.
  function fold(hosts) {
    var groups = [], byKey = Object.create(null);
    hosts.forEach(function (h) {
      var group = null;
      h.addresses.forEach(function (a) { if (!group && byKey[addressKey(a)]) group = byKey[addressKey(a)]; });
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(h);
      h.addresses.forEach(function (a) { if (!byKey[addressKey(a)]) byKey[addressKey(a)] = group; });
    });
    return groups.map(oneHost);
  }

  function read(text) {
    var t = String(text == null ? "" : text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!t) return problem("empty");
    // A terminal copy often starts at the prompt, or a sudo password line.
    var start = t.search(/<\?xml|<nmaprun[\s>]/);
    if (start > 0) t = t.slice(start);
    else if (start < 0) {
      if (/Nmap scan report for|^# Nmap|^Host: /m.test(t)) return problem("normal-output");
      if (/<host[\s>]|<port[\s>]|<\/host>|<\/nmaprun>/.test(t)) return problem("truncated");
      if (t[0] !== "<") return problem("not-xml");
    }
    var doc = parseXml(t);
    if (doc.error) return problem(doc.error);
    var run = kid(doc, "nmaprun");
    if (!run) return problem("not-nmap");
    var finished = kid(kid(run, "runstats"), "finished");
    if (!finished) return problem("truncated");
    if (finished.attrs.exit === "error") return problem("nmap-error", finished.attrs.errormsg || "no reason given");
    var hosts = kids(run, "host").filter(function (h) {
      var s = kid(h, "status");
      return s && s.attrs.state === "up";
    }).map(hostOf).filter(function (h) { return h.addresses.length; });
    hosts = fold(hosts);
    if (!hosts.length) return problem("no-host-up");
    var silentUdp = 0;
    hosts.forEach(function (h) {
      h.ports.forEach(function (p) { if (p.protocol === "udp" && p.state === "open|filtered") silentUdp++; });
    });
    return { scan: { args: run.attrs.args || "", hosts: hosts, silentUdp: silentUdp } };
  }

  // ---- addresses ----

  function bytes(ip) {
    var s = String(ip);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
      var four = s.split(".").map(Number);
      return four.every(function (n) { return n <= 255; }) ? four : null;
    }
    if (!/^[0-9A-Fa-f:]+$/.test(s) || s.indexOf(":") < 0) return null;
    var halves = s.split("::");
    if (halves.length > 2) return null;
    function groups(part) {
      return part ? part.split(":") : [];
    }
    var head = groups(halves[0]), tail = halves.length === 2 ? groups(halves[1]) : [];
    var fill = 8 - head.length - tail.length;
    if (halves.length === 1 ? fill !== 0 : fill < 1) return null;
    var all = head.concat(Array(halves.length === 2 ? fill : 0).fill("0"), tail);
    var out = [];
    for (var i = 0; i < all.length; i++) {
      if (!/^[0-9A-Fa-f]{1,4}$/.test(all[i])) return null;
      var n = parseInt(all[i], 16);
      out.push(n >> 8, n & 255);
    }
    return out;
  }

  // One spelling per address, so fd00::5 and fd00:0::5 are the same host.
  function addressKey(ip) {
    var b = bytes(ip);
    return b ? b.join(".") : String(ip);
  }

  function inCidr(ip, cidr) {
    var parts = String(cidr).split("/");
    if (parts.length !== 2 || !/^\d{1,3}$/.test(parts[1])) return false;
    var a = bytes(ip), net = bytes(parts[0]), bits = Number(parts[1]);
    if (!a || !net || a.length !== net.length || bits > a.length * 8) return false;
    for (var i = 0; i < a.length; i++) {
      var take = Math.max(0, Math.min(8, bits - i * 8));
      var mask = take ? (0xff << (8 - take)) & 0xff : 0;
      if ((a[i] & mask) !== (net[i] & mask)) return false;
    }
    return true;
  }

  // ---- planning (spec §3.4, §4) ----

  function ids(doc, kind) {
    return Object.keys(doc.entities || {}).filter(function (id) { return doc.entities[id].kind === kind; });
  }
  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  function hostingOf(doc, executable) {
    var a = links(doc, "hosts").filter(function (x) { return x.to === executable; })[0];
    return a ? a.from : null;
  }
  function attachedNetworks(doc, machine) {
    var mine = links(doc, "attached").filter(function (a) { return a.from === machine; }).map(function (a) { return a.to; });
    return ids(doc, "network").filter(function (n) { return mine.indexOf(n) >= 0; });
  }
  // The network a CIDR range names, written from its own address:
  // 192.168.2.138/24 is 192.168.2.0/24.
  function networkOf(cidr) {
    var parts = String(cidr).split("/");
    var b = bytes(parts[0]), bits = Number(parts[1]);
    if (!b || parts.length !== 2 || !/^\d{1,3}$/.test(parts[1]) || bits > b.length * 8) return null;
    var masked = b.map(function (x, i) {
      var take = Math.max(0, Math.min(8, bits - i * 8));
      return take ? x & ((0xff << (8 - take)) & 0xff) : 0;
    });
    if (masked.length === 4) return masked.join(".") + "/" + bits;
    var groups = [];
    for (var i = 0; i < 16; i += 2) groups.push(((masked[i] << 8) | masked[i + 1]).toString(16));
    // The longest run of zero groups, if two or more, becomes "::".
    var best = -1, len = 0;
    for (var j = 0; j < 8; j++) {
      var k = j;
      while (k < 8 && groups[k] === "0") k++;
      if (k - j > len && k - j > 1) { best = j; len = k - j; }
      if (k > j) j = k;
    }
    var text = best < 0 ? groups.join(":") : groups.slice(0, best).join(":") + "::" + groups.slice(best + len).join(":");
    return text + "/" + bits;
  }
  function onlyCidr(range) {
    var words = String(range == null ? "" : range).trim().split(/\s+/).filter(Boolean);
    return words.length === 1 ? networkOf(words[0]) : null;
  }
  // Spec §4.5: the role nmap's device class suggests, and the class that said so.
  var ROUTERS = ["router", "broadband router", "WAP"];
  function roleOf(device) {
    var classes = device || [];
    if (classes.indexOf("firewall") >= 0) return { role: "firewall", device: "firewall" };
    var r = classes.filter(function (c) { return ROUTERS.indexOf(c) >= 0; })[0];
    if (r) return { role: "router", device: r };
    return { role: "host", device: classes[0] || null };
  }
  function runsRouter(doc, host) {
    return links(doc, "hosts").some(function (a) { return a.from === host && doc.entities[a.to] && doc.entities[a.to].kind === "router"; });
  }

  // What nmap says it scanned: the words after "-oX -" in its own args, or
  // "" when it does not say (a command of the user's own, trimmed XML).
  function targetsOf(scan) {
    var args = String((scan && scan.args) || "");
    var at = args.indexOf(" -oX - ");
    return at >= 0 ? args.slice(at + 7).trim() : "";
  }

  // The drawn host nmap runs on, named by the scan: "altiera.fritz.box" or
  // "altiera" for a host labelled "altiera".
  function sameName(hostname, label) {
    var n = String(hostname || "").toLowerCase(), l = String(label || "").trim().toLowerCase();
    return !!n && !!l && (n === l || n.split(".")[0] === l);
  }

  function plan(doc, appId, scan, range, merges) {
    merges = merges || {};
    var hosts = ids(doc, "host");
    var byAddress = Object.create(null);
    hosts.forEach(function (h) {
      (doc.entities[h].addresses || []).forEach(function (a) {
        var k = addressKey(a);
        byAddress[k] = byAddress[k] || h;
      });
    });
    var candidates = hosts.filter(function (h) { return !(doc.entities[h].addresses || []).length; });
    var networks = ids(doc, "network");
    var appHost = hostingOf(doc, appId);
    // The network the scan covered, as nmap says it ran; the range field only
    // when the scan does not name one (an old scan pasted needs no range).
    var cidr = onlyCidr(targetsOf(scan)) || onlyCidr(range);
    var proposed = cidr && !networks.some(function (n) {
      return (doc.entities[n].addresses || []).some(function (c) { return networkOf(c) === cidr; });
    }) ? { label: cidr, addresses: [cidr] } : null;
    var products = Object.create(null);
    ids(doc, "product").forEach(function (p) { products[doc.entities[p].label] = products[doc.entities[p].label] || p; });

    // Who each scanned host is: known by address, merged as chosen (the
    // first choice of a drawn host wins; "" is a chosen "new"), or else
    // nmap's own host when the scan names it so.
    // Scanned hosts that are one drawn host by address (a machine with an
    // address in each of two scanned networks) are one row, keyed by the
    // first, with every port once.
    var takenBy = Object.create(null), rowOf = Object.create(null);
    var rows = [];
    scan.hosts.forEach(function (h, i) {
      var key = "h" + i;
      var known = null;
      h.addresses.forEach(function (a) { if (!known && byAddress[addressKey(a)]) known = byAddress[addressKey(a)]; });
      if (known && rowOf[known]) return rowOf[known].listings.push(h);
      var merged = !known && candidates.indexOf(merges[key]) >= 0 && !takenBy[merges[key]] ? merges[key] : null;
      if (merged) takenBy[merged] = key;
      var row = { key: key, scan: h, listings: [h], known: known, merged: merged, guessed: false };
      if (known) rowOf[known] = row;
      rows.push(row);
    });
    rows.forEach(function (r) {
      if (r.listings.length > 1) r.scan = oneHost(r.listings);
    });
    if (appHost && candidates.indexOf(appHost) >= 0 && !takenBy[appHost]) {
      var own = rows.filter(function (r) {
        return !r.known && !r.merged && !has(merges, r.key) && (r.scan.self || sameName(r.scan.hostname, doc.entities[appHost].label));
      })[0];
      if (own) {
        own.merged = appHost;
        own.guessed = true;
      }
    }

    // Where each one is attached that it is not yet: every network whose
    // range holds one of its addresses, else the proposed one.
    var usedNew = false;
    rows.forEach(function (r) {
      var target = r.known || r.merged;
      var have = target ? attachedNetworks(doc, target) : [];
      var nets = networks.filter(function (n) {
        return (doc.entities[n].addresses || []).some(function (c) {
          return r.scan.addresses.some(function (a) { return inCidr(a, c); });
        });
      });
      if (!nets.length && proposed && r.scan.addresses.some(function (a) { return inCidr(a, cidr); })) nets = ["new"];
      r.networks = nets.filter(function (n) { return have.indexOf(n) < 0; });
      r.on = have.concat(r.networks);
      if (r.networks.indexOf("new") >= 0) usedNew = true;
    });
    var appNets = appHost ? attachedNetworks(doc, appHost) : [];
    rows.forEach(function (r) {
      if (appHost && (r.known || r.merged) === appHost) appNets = appNets.concat(r.networks);
    });

    var planned = rows.map(function (r) {
      var h = r.scan, target = r.known || r.merged;
      var label = target ? doc.entities[target].label : h.hostname || h.addresses[0];
      var shared = appNets.filter(function (n) { return r.on.indexOf(n) >= 0; });
      var offered = !(target && runsRouter(doc, target));
      var suggested = roleOf(h.device);
      var hostChecks = readScripts(h.scripts);
      var seen = reached(doc, appId, target);
      var ports = h.ports.filter(function (p) { return p.state === "open" && !wrapped(p); }).map(function (p) {
        var row = portRow(seen, r.key, label, p, products);
        var own = readScripts(p.scripts);
        row.found = own.found;
        row.unread = own.unread;
        return row;
      });
      var smb = SMB_PORTS.map(function (proto) { return ports.filter(function (x) { return x.proto === proto; })[0]; }).filter(Boolean)[0];
      var unplaced = [];
      if (smb && !(smb.known && !productOfService(doc, smb.known))) smb.found = smb.found.concat(hostChecks.found);
      else unplaced = hostChecks.found;
      ports.forEach(function (row) {
        row.findings = findingsFor(doc, row, row.found);
        delete row.found;
      });
      return {
        key: r.key,
        label: label,
        addresses: h.addresses.slice(),
        os: h.os ? "nmap OS guess: " + h.os.name + " (" + h.os.accuracy + "%)." : null,
        known: r.known,
        merged: r.merged,
        guessed: r.guessed,
        networks: r.networks,
        on: r.on,
        role: offered ? suggested.role : "host",
        roleOffered: offered,
        device: suggested.device,
        route: shared.length ? [shared[0]] : [],
        ports: ports,
        unplaced: unplaced.map(function (f) { return { script: f.script, id: findingId(f.vuln), state: f.vuln.state }; }),
        unread: hostChecks.unread,
      };
    });

    var tcpwrapped = 0;
    rows.forEach(function (r) {
      r.scan.ports.forEach(function (p) { if (p.state === "open" && wrapped(p)) tcpwrapped++; });
    });
    return {
      app: appId,
      tcpwrapped: tcpwrapped,
      appHost: appHost,
      network: usedNew ? proposed : null,
      candidates: candidates,
      silentUdp: scan.silentUdp || 0,
      hosts: planned,
    };
  }

  // ---- findings of the checks (spec §4.6) ----

  // Scripts -sV runs by itself (nmap's "version" category): they refine the
  // version already shown, so they are left out.
  var VERSION_SCRIPTS = ["allseeingeye-info", "amqp-info", "bacnet-info", "cccam-version", "db2-das-info", "docker-version", "drda-info", "enip-info", "fingerprint-strings", "fox-info", "freelancer-info", "http-server-header", "http-trane-info", "https-redirect", "iax2-version", "ike-version", "jdwp-version", "maxdb-info", "mcafee-epo-agent", "mqtt-subscribe", "murmur-version", "ndmp-version", "netbus-version", "omron-info", "openlookup-info", "oracle-tns-version", "ovs-agent-version", "pptp-version", "quake1-info", "quake3-info", "rfc868-time", "rpc-grind", "rpcinfo", "s7-info", "skypev2-version", "snmp-info", "stun-version", "teamspeak2-version", "ubiquiti-discovery", "ventrilo-info", "vmware-version", "wdb-version", "weblogic-t3-info", "xmpp-info"];
  // VULNERABLE, LIKELY VULNERABLE, VULNERABLE (DoS), VULNERABLE (Exploitable)
  var FOUND = /^(LIKELY )?VULNERABLE/;
  // nmap's host checks all talk SMB: the port they used.
  var SMB_PORTS = ["tcp/445", "tcp/139"];

  // What a list of scripts says: findings, and what is shown unread.
  function readScripts(scripts) {
    var out = { found: [], unread: [] };
    (scripts || []).forEach(function (s) {
      if (VERSION_SCRIPTS.indexOf(s.id) >= 0) return;
      if (!s.vulns.length) {
        var first = s.output.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "";
        out.unread.push({ script: s.id, text: "not read" + (first ? " · " + first.slice(0, 80) : "") });
        return;
      }
      var untested = false;
      s.vulns.forEach(function (v) {
        if (FOUND.test(v.state)) out.found.push({ script: s.id, vuln: v });
        else if (/^UNKNOWN/.test(v.state)) untested = true;
      });
      if (untested) out.unread.push({ script: s.id, text: "could not test" });
    });
    return out;
  }
  // The finding's first CVE, else its first id, else nmap's key.
  function findingId(v) {
    var id = v.ids.filter(function (x) { return /^CVE:/.test(x); })[0] || v.ids[0];
    return id ? id.slice(id.indexOf(":") + 1) : v.key;
  }
  function findingLine(script, v) {
    var title = String(v.title).trim();
    var stop = title.search(/\.(\s|$)/);
    if (stop >= 0) title = title.slice(0, stop);
    return "nmap " + script + ": " + v.state + ", " + findingId(v) + (title ? " (" + title + ")" : "") + ".";
  }
  function noteLines(e) {
    var p = e && e.parameters && e.parameters["find-exploit"];
    return p && p.note ? p.note.split("\n") : [];
  }
  function productOfService(doc, service) {
    var a = links(doc, "instance-of").filter(function (x) { return x.from === service; })[0];
    return a && doc.entities[a.to] ? a.to : null;
  }
  // A port's findings, against the product they would mark.
  function findingsFor(doc, row, found) {
    var product = row.known ? productOfService(doc, row.known) : row.product.existing;
    var e = product ? doc.entities[product] : null;
    return found.map(function (f) {
      var line = findingLine(f.script, f.vuln);
      return {
        key: row.key + "/" + f.script + "/" + f.vuln.key,
        script: f.script,
        id: findingId(f.vuln),
        state: f.vuln.state,
        line: line,
        product: product,
        productLabel: e ? e.label : row.product.label,
        patchedByAuthor: !!e && !!e.defenses && e.defenses.patched === true,
        known: !!e && !!e.defenses && e.defenses.patched === false && noteLines(e).indexOf(line) >= 0,
      };
    });
  }

  // nmap's "tcpwrapped": the connection opened and was closed at once, so
  // nothing was identified — not a service to add (spec §4.3).
  function wrapped(p) {
    return !!p.service && p.service.name === "tcpwrapped";
  }

  // What the drawing already has on a host, by protocol: the service a flow
  // reaches there (the first such flow in file order), and which of those
  // this nmap already reaches. Built once per host, not once per port.
  function reached(doc, appId, target) {
    var out = { service: Object.create(null), fromApp: Object.create(null) };
    if (!target) return out;
    var hosted = Object.create(null);
    links(doc, "hosts").forEach(function (a) {
      if (a.from === target && doc.entities[a.to] && doc.entities[a.to].kind === "service") hosted[a.to] = true;
    });
    var flows = Object.keys(doc.flows || {}).map(function (k) { return doc.flows[k]; });
    flows.forEach(function (f) {
      if (hosted[f.target] === true && !has(out.service, f.protocol)) out.service[f.protocol] = f.target;
    });
    flows.forEach(function (f) {
      if (f.source === appId && has(out.service, f.protocol) && out.service[f.protocol] === f.target) out.fromApp[f.protocol] = true;
    });
    return out;
  }

  function portRow(seen, hostKey, hostLabel, p, products) {
    var proto = p.protocol + "/" + p.port;
    var s = p.service || {};
    var label = s.name || proto;
    var known = has(seen.service, proto) ? seen.service[proto] : null;
    var addsFlow = !(known && seen.fromApp[proto]);
    var product = s.product
      ? { label: s.product + (s.version ? " " + s.version : ""), existing: null, identified: true }
      : { label: "unidentified " + label + " on " + hostLabel, existing: null, identified: false };
    if (product.identified && products[product.label]) product.existing = products[product.label];
    return { key: hostKey + "/" + proto, proto: proto, label: label, product: product, known: known, addsFlow: addsFlow };
  }

  function defaults(p) {
    var t = { hosts: {}, ports: {}, roles: {}, findings: {}, network: true };
    p.hosts.forEach(function (h) {
      t.hosts[h.key] = true;
      t.roles[h.key] = h.role;
      h.ports.forEach(function (r) {
        if (!r.known || r.addsFlow) t.ports[r.key] = true;
        r.findings.forEach(function (f) { t.findings[f.key] = !f.known && !f.patchedByAuthor; });
      });
    });
    return t;
  }

  function roleChosen(h, ticks) {
    var role = ticks.roles && has(ticks.roles, h.key) ? ticks.roles[h.key] : "host";
    return h.roleOffered && (role === "router" || role === "firewall") ? role : "host";
  }

  // What the ticked rows add, and whether the result stays in the limits.
  // A new host whose only network is an unticked proposed one is added
  // unattached, as apply does.
  // The findings that mark a product: ticked, new, on a port that is there.
  function marking(r, ticks) {
    if (!r.known && !ticks.ports[r.key]) return [];
    return r.findings.filter(function (f) { return ticks.findings && ticks.findings[f.key] && !f.known && !f.patchedByAuthor; });
  }
  function markKey(r, f) {
    return f.product ? "id:" + f.product : r.product.identified ? "new:" + r.product.label : "port:" + r.key;
  }

  function summary(doc, p, ticks, limits) {
    var s = { hosts: 0, filled: 0, networks: 0, attached: 0, routers: 0, firewalls: 0, services: 0, products: 0, flows: 0, unpatched: 0 };
    var rel = 0, newProducts = Object.create(null), marked = Object.create(null);
    var network = !!(p.network && ticks.network);
    var ticked = 0;
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      ticked++;
      var added = !h.known && !h.merged;
      if (added) s.hosts++;
      // A merge writes the scanned addresses into the drawn host.
      if (h.merged) s.filled++;
      h.networks.forEach(function (n) {
        if (n === "new" && !network) return;
        rel++;
        if (n === "new") s.networks = 1;
        if (!added) s.attached++;
      });
      var role = roleChosen(h, ticks);
      if (role !== "host") {
        s.routers++;
        // hosts, and one attachment per network the box is on afterwards
        rel += 1 + h.on.filter(function (n) { return n !== "new" || network; }).length;
        if (role === "firewall") {
          s.firewalls++;
          rel++; // filters
        }
      }
      h.ports.forEach(function (r) {
        marking(r, ticks).forEach(function (f) { marked[markKey(r, f)] = true; });
        if (!ticks.ports[r.key]) return;
        if (!r.known) {
          s.services++;
          rel += 2; // hosts, instance-of
          if (!r.product.existing && !(r.product.identified && newProducts[r.product.label])) {
            newProducts[r.product.label] = true;
            s.products++;
          }
        }
        if (r.addsFlow) s.flows++;
      });
    });
    rel += s.flows;
    s.unpatched = Object.keys(marked).length;
    s.entities = Object.keys(doc.entities || {}).length + s.hosts + s.networks + s.routers + s.firewalls + s.services + s.products;
    s.relationships = Object.keys(doc.associations || {}).length + Object.keys(doc.flows || {}).length + rel;
    s.tooMany = null;
    // Many hosts: fewer, or a smaller range; one host: its ports.
    var fix = ticked > 1 ? " Untick some hosts, or scan a smaller range." : " Untick some ports.";
    if (limits && s.entities > limits.entities) s.tooMany = "That makes " + s.entities + " components; the limit is " + limits.entities + "." + fix;
    else if (limits && s.relationships > limits.relationships) s.tooMany = "That makes " + s.relationships + " links and flows; the limit is " + limits.relationships + "." + fix;
    return s;
  }

  // The summary in words: "Adds 4 hosts, 11 services, marks 2 products
  // unpatched."; a merge counts, as it writes the drawn host's addresses.
  function said(s) {
    function n(k, one) {
      return k + " " + one + (k === 1 ? "" : "s");
    }
    var parts = [[s.hosts, "host"], [s.networks, "network"], [s.attached, "attachment"], [s.routers, "router"], [s.firewalls, "firewall"], [s.services, "service"], [s.products, "product"], [s.flows, "flow"]].filter(function (x) { return x[0]; }).map(function (x) {
      return n(x[0], x[1]);
    });
    if (s.filled) parts.push("addresses for " + n(s.filled, "drawn host"));
    var marks = s.unpatched ? "marks " + n(s.unpatched, "product") + " unpatched" : "";
    if (parts.length) return "Adds " + parts.join(", ") + (marks ? ", " + marks : "") + ".";
    return marks ? marks[0].toUpperCase() + marks.slice(1) + "." : "Nothing new to add.";
  }

  // Ticking a host ticks what it offers: its new ports, the flows its known
  // ports lack, their findings; unticking takes them all along.
  function tickHost(h, ticks, on) {
    ticks.hosts[h.key] = on;
    h.ports.forEach(function (r) {
      ticks.ports[r.key] = on && (!r.known || r.addsFlow);
      r.findings.forEach(function (f) { ticks.findings[f.key] = on && !f.known && !f.patchedByAuthor; });
    });
    return ticks;
  }
  function tickHosts(p, ticks, on) {
    p.hosts.forEach(function (h) { tickHost(h, ticks, on); });
    return ticks;
  }

  // ---- applying (spec §4) ----

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

  // `specOf(kind)`: the catalog entry of a kind, for its parameter slots.
  function apply(doc, p, ticks, specOf, stamp) {
    var s = summary(doc, p, ticks, null);
    var merging = p.hosts.some(function (h) { return ticks.hosts[h.key] && h.merged; });
    if (!s.hosts && !s.services && !s.flows && !s.networks && !s.attached && !s.routers && !s.unpatched && !merging) return null;
    var next = JSON.parse(JSON.stringify(doc));
    function step(edit) {
      if (!edit) throw new Error("the nmap import could not be applied");
      next = edit.doc;
      return edit;
    }
    function link(kind, from, to, extra) {
      step(L.putAssociation(next, null, Object.assign({ kind: kind, from: from, to: to }, extra || {})));
    }
    var network = null;
    if (s.networks) {
      network = step(A.addEntity(next, "network", p.network.label, specOf("network"))).entity;
      next.entities[network].addresses = p.network.addresses.slice();
    }
    var madeProducts = Object.create(null);
    var flows = [], marks = [];
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      var host = h.known || h.merged;
      if (!host) {
        host = step(A.addEntity(next, "host", h.label, specOf("host"))).entity;
        next.entities[host].addresses = h.addresses.slice();
        if (h.os) next.entities[host].description = h.os;
      } else if (h.merged) {
        next.entities[host].addresses = h.addresses.slice();
      }
      h.networks.forEach(function (n) {
        var to = n === "new" ? network : n;
        if (to) link("attached", host, to);
      });
      var role = roleChosen(h, ticks);
      if (role !== "host") {
        // The router on its box (an appliance), on every network the box is on.
        var router = step(A.addEntity(next, "router", h.label + " router", specOf("router"))).entity;
        link("hosts", host, router, { privilege: "admin" });
        links(next, "attached").filter(function (a) { return a.from === host; }).forEach(function (a) {
          link("attached", router, a.to);
        });
        if (role === "firewall") {
          var firewall = step(A.addEntity(next, "firewall", h.label + " firewall", specOf("firewall"))).entity;
          link("filters", router, firewall);
        }
      }
      h.ports.forEach(function (r) {
        // A known port with nothing to add is unticked, and its product still
        // takes the finding.
        if (!ticks.ports[r.key]) {
          if (r.known) marking(r, ticks).forEach(function (f) { marks.push({ product: productOfService(next, r.known), line: f.line }); });
          return;
        }
        var service = r.known;
        if (!service) {
          service = step(A.addEntity(next, "service", r.label, specOf("service"))).entity;
          // nmap cannot see the account it runs as: unknown, not a guess.
          link("hosts", host, service, { privilege: "unknown" });
          var product = r.product.existing || madeProducts[r.product.label];
          if (!product) {
            product = step(A.addEntity(next, "product", r.product.label, specOf("product"))).entity;
            if (r.product.identified) madeProducts[r.product.label] = product;
          }
          link("instance-of", service, product);
        }
        marking(r, ticks).forEach(function (f) { marks.push({ product: productOfService(next, service), line: f.line }); });
        if (r.addsFlow) flows.push({ label: r.label + " on " + h.label, target: service, host: host, route: h.route, protocol: r.proto });
      });
    });
    // After every attachment: a route is kept only where both ends are now
    // on its network (nmap's host may have been left unticked).
    flows.forEach(function (f) {
      var net = f.route[0] === "new" ? network : f.route[0];
      var ok = net && p.appHost && isAttached(next, p.appHost, net) && isAttached(next, f.host, net);
      step(L.putFlow(next, null, { label: f.label, source: p.app, target: f.target, route: ok ? [net] : [], protocol: f.protocol }));
    });
    // A finding marks its product unpatched and says why; its time stays as
    // it is. The author's "patched" stands.
    marks.forEach(function (m) {
      var e = m.product && next.entities[m.product];
      if (!e || (e.defenses && e.defenses.patched === true)) return;
      e.defenses = e.defenses || {};
      e.defenses.patched = false;
      e.parameters = e.parameters || {};
      var fe = e.parameters["find-exploit"] = e.parameters["find-exploit"] || { status: "unknown" };
      var lines = noteLines(e);
      if (lines.indexOf(m.line) < 0) fe.note = lines.concat([m.line]).join("\n");
    });
    var old = next.entities[p.app].description || "";
    var line = stampLine(stamp);
    var described = A.setDescription(next, p.app, STAMP.test(old) ? old.replace(STAMP, line) : (old ? old + "\n" : "") + line);
    if (described) next = described.doc;
    return { doc: next, select: "entity/" + p.app };
  }

  function isAttached(doc, machine, net) {
    return links(doc, "attached").some(function (a) { return a.from === machine && a.to === net; });
  }

  // An application that is nmap, run by `hostId` as user when given.
  function addNmap(doc, hostId, label, specOf) {
    var added = A.addEntity(doc, "application", label, specOf("application"));
    if (!added) return null;
    added.doc.entities[added.entity].tool = "nmap";
    if (!hostId) return added;
    var hosted = L.putAssociation(added.doc, null, { kind: "hosts", from: hostId, to: added.entity, privilege: "user" });
    return hosted ? { doc: hosted.doc, select: added.select, entity: added.entity } : null;
  }

  // The canvas's light bulb (owner, 2026-09-24): on an architecture without
  // an nmap yet, until the visitor dismisses it.
  function hintWanted(doc, dismissed) {
    if (dismissed || !doc || doc.profile !== "architecture") return false;
    var entities = doc.entities || {};
    return !Object.keys(entities).some(function (id) { return entities[id].tool === "nmap"; });
  }

  var api = { LEVELS: LEVELS, CHECKS: CHECKS, checksOffered: checksOffered, level: level, command: command, read: read, bytes: bytes, inCidr: inCidr, plan: plan, defaults: defaults, summary: summary, said: said, tickHost: tickHost, tickHosts: tickHosts, apply: apply, addNmap: addNmap, stampLine: stampLine, stampFor: stampFor, hintWanted: hintWanted };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmap = api;
})();
