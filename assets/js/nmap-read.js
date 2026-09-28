// nmap's XML read into a scan (the nmap import design §3.3, in history;
// nmap recipes spec §3.2, §4.1). Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var addressKey = Ad.addressKey;

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
    var message = code === "nmap-error" ? "nmap stopped: " + detail : code === "other-scanner" ? detail : PROBLEMS[code];
    return { problem: { code: code, message: message } };
  }
  // One application per tool (roadmap scanner-readers): a result of another
  // scanner is said, with where it goes.
  function otherScanner(by, want) {
    return problem("other-scanner", "This result is from " + by + ", not " + want + "; add " + by + " and paste it there.");
  }

  // The names nmap's own table gives the ports most often open, for a
  // reader that only knows the number (masscan, Greenbone): what nmap
  // without -sV would say too.
  var WELL_KNOWN = {
    "tcp/21": "ftp", "tcp/22": "ssh", "tcp/23": "telnet", "tcp/25": "smtp", "tcp/53": "domain", "tcp/80": "http",
    "tcp/110": "pop3", "tcp/111": "rpcbind", "tcp/135": "msrpc", "tcp/139": "netbios-ssn", "tcp/143": "imap",
    "tcp/389": "ldap", "tcp/443": "https", "tcp/445": "microsoft-ds", "tcp/465": "smtps", "tcp/587": "submission",
    "tcp/631": "ipp", "tcp/636": "ldapssl", "tcp/993": "imaps", "tcp/995": "pop3s", "tcp/1433": "ms-sql-s",
    "tcp/1723": "pptp", "tcp/2049": "nfs", "tcp/3306": "mysql", "tcp/3389": "ms-wbt-server", "tcp/5432": "postgresql",
    "tcp/5900": "vnc", "tcp/6379": "redis", "tcp/8080": "http-proxy", "tcp/8443": "https-alt", "tcp/9100": "jetdirect",
    "udp/53": "domain", "udp/67": "dhcps", "udp/69": "tftp", "udp/123": "ntp", "udp/137": "netbios-ns",
    "udp/161": "snmp", "udp/500": "isakmp", "udp/1900": "upnp", "udp/5353": "zeroconf",
  };
  function portName(protocol, port) {
    return WELL_KNOWN[protocol + "/" + port] || null;
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
  // A script's structure as nmap writes it: keyed and unkeyed <elem>s and
  // nested <table>s (nmap recipes spec §3.2).
  function tableOf(el) {
    var elems = {}, items = [];
    kids(el, "elem").forEach(function (e) {
      if (e.attrs.key) elems[e.attrs.key] = e.text.trim();
      else items.push(e.text.trim());
    });
    return { key: el.attrs.key || null, elems: elems, items: items, tables: kids(el, "table").map(tableOf) };
  }
  function scriptOf(el) {
    return {
      id: el.attrs.id || "",
      data: tableOf(el),
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

  // ---- what identifies a machine (nmap recipes spec §3.2) ----

  var NAME_MAX = 120;
  // A name from the network as plain text: no control characters, no
  // nmap placeholder, no trailing \x00, never longer than NAME_MAX.
  function cleanName(s) {
    var t = String(s == null ? "" : s).replace(/(\\x00)+$/, "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
    if (!t || /^<unknown>$/i.test(t)) return null;
    return t.slice(0, NAME_MAX);
  }
  var MAC = /^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/;
  function macOf(s) {
    var m = String(s || "").toLowerCase();
    return MAC.test(m) && m !== "00:00:00:00:00:00" ? m : null;
  }
  // The MAC first, then SSH host keys; names DNS → NetBIOS → certificate,
  // each once. A certificate is never an identity: it may sit on many
  // machines (spec §3.1).
  function identify(h, macEl) {
    var ids = [], names = [];
    function id(x) {
      if (x && ids.indexOf(x) < 0) ids.push(x);
    }
    function name(n, from) {
      var c = cleanName(n);
      if (c && !names.some(function (x) { return x.name.toLowerCase() === c.toLowerCase(); })) names.push({ name: c, from: from });
    }
    var mac = macEl ? macOf(macEl.attrs.addr) : null;
    if (mac) id("mac:" + mac);
    var scripts = h.scripts.concat.apply(h.scripts, h.ports.map(function (p) { return p.scripts; }));
    function by(sid) {
      return scripts.filter(function (s) { return s.id === sid; });
    }
    by("nbstat").forEach(function (s) {
      var m = /NetBIOS MAC: ([0-9A-Fa-f:]{17})/.exec(s.output);
      var nb = m && macOf(m[1]);
      if (nb) id("mac:" + nb);
    });
    by("ssh-hostkey").forEach(function (s) {
      s.data.tables.forEach(function (t) {
        if (t.elems.type && t.elems.fingerprint) id(t.elems.type + ":" + t.elems.fingerprint);
      });
    });
    ["user", "PTR"].forEach(function (type) {
      h.hostnames.forEach(function (n) { if (n.type === type) name(n.name, "DNS"); });
    });
    h.hostnames.forEach(function (n) { name(n.name, "DNS"); });
    by("smb-os-discovery").forEach(function (s) {
      name(s.data.elems.fqdn, "NetBIOS");
      name(s.data.elems.server, "NetBIOS");
    });
    by("nbstat").forEach(function (s) {
      var m = /NetBIOS name: ([^,]+)/.exec(s.output);
      if (m) name(m[1], "NetBIOS");
    });
    by("ssl-cert").forEach(function (s) {
      var subject = s.data.tables.filter(function (t) { return t.key === "subject"; })[0];
      if (subject) name(subject.elems.commonName, "certificate");
      var ext = s.data.tables.filter(function (t) { return t.key === "extensions"; })[0];
      var san = ext && ext.tables.filter(function (t) { return t.elems.name === "X509v3 Subject Alternative Name"; })[0];
      var text = san ? san.elems.value : (/Subject Alternative Name: (.*)/.exec(s.output) || [])[1];
      String(text || "").split(",").forEach(function (part) {
        var d = /^\s*DNS:(.+)$/.exec(part);
        if (d) name(d[1], "certificate");
      });
    });
    return { identities: ids, names: names };
  }

  function hostOf(h) {
    var names = kids(kid(h, "hostnames"), "hostname");
    var match = kids(kid(h, "os"), "osmatch")[0];
    var macEl = kids(h, "address").filter(function (a) { return a.attrs.addrtype === "mac"; })[0] || null;
    var out = {
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
        return { protocol: p.attrs.protocol, port: Number(p.attrs.portid), state: state ? state.attrs.state : "", reason: state ? state.attrs.reason || null : null, service: serviceOf(p), scripts: kids(p, "script").map(scriptOf) };
      }),
      scripts: kids(kid(h, "hostscript"), "script").map(scriptOf),
      hostnames: names.map(function (n) { return { name: n.attrs.name || "", type: n.attrs.type || null }; }),
      vendor: macEl ? macEl.attrs.vendor || null : null,
      // Hops in ttl order; one that did not answer is a missing ttl.
      trace: kids(kid(h, "trace"), "hop").map(function (x) {
        return { ttl: Number(x.attrs.ttl), address: x.attrs.ipaddr || null, name: cleanName(x.attrs.host) };
      }).sort(function (a, b) { return a.ttl - b.ttl; }),
      // The states nmap grouped instead of listing each port.
      extraports: kids(kid(h, "ports"), "extraports").map(function (e) {
        return { state: e.attrs.state, count: Number(e.attrs.count) };
      }),
    };
    var who = identify(out, macEl);
    out.identities = who.identities;
    out.names = who.names;
    return out;
  }

  // Several listings of one machine as one host: every address and port
  // once (an open listing of a port wins), the first name, OS guess and
  // device class. Ports are keyed, so a Complete scan folds in linear time.
  function oneHost(listings) {
    var same = { addresses: [], hostname: null, os: null, device: [], self: false, ports: [], scripts: [], identities: [], names: [], hostnames: [], vendor: null, trace: [], extraports: [] };
    var address = Object.create(null), port = Object.create(null), script = Object.create(null);
    function once(list, items, key) {
      (items || []).forEach(function (x) {
        if (!list.some(function (y) { return key(y) === key(x); })) list.push(x);
      });
    }
    listings.forEach(function (h) {
      once(same.identities, h.identities, String);
      once(same.names, h.names, function (n) { return n.name.toLowerCase(); });
      once(same.hostnames, h.hostnames, function (n) { return n.name + " " + n.type; });
      same.vendor = same.vendor || h.vendor || null;
      if (!same.trace.length) same.trace = h.trace || [];
      if (!same.extraports.length) same.extraports = h.extraports || [];
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
        } else {
          var kept = same.ports[port[k]];
          // An open listing wins; of two, one that names the service.
          if ((kept.state !== "open" && p.state === "open") || (kept.state === p.state && !kept.service && p.service)) same.ports[port[k]] = p;
        }
      });
    });
    return same;
  }

  // nmap lists a host once per time the range names it (an address and its
  // name): one host, with every port once. A MAC joins listings too (an
  // IPv4 and an IPv6 scan of one machine, pasted together).
  function fold(hosts) {
    var groups = [], byKey = Object.create(null);
    function keys(h) {
      return h.addresses.map(addressKey).concat((h.identities || []).filter(function (i) { return i.indexOf("mac:") === 0; }));
    }
    hosts.forEach(function (h) {
      var group = null;
      keys(h).forEach(function (k) { if (!group && byKey[k]) group = byKey[k]; });
      if (!group) {
        group = [];
        groups.push(group);
      }
      group.push(h);
      keys(h).forEach(function (k) { if (!byKey[k]) byKey[k] = group; });
    });
    return groups.map(oneHost);
  }

  // `opts.scanner`: whose result this must be ("nmap", or "masscan", whose
  // XML is nmap's shape); `opts.serviceName(name)`: the service name a
  // listing's is said as, null for none.
  function read(text, opts) {
    opts = opts || {};
    var want = opts.scanner || "nmap";
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
    // Several results pasted one after the other are read as one scan.
    var runs = kids(doc, "nmaprun");
    if (!runs.length) return problem("not-nmap");
    var by = runs[0].attrs.scanner || "nmap";
    if (by !== want) return otherScanner(by, want);
    var hosts = [];
    for (var r = 0; r < runs.length; r++) {
      var finished = kid(kid(runs[r], "runstats"), "finished");
      if (!finished) return problem("truncated");
      if (finished.attrs.exit === "error") return problem("nmap-error", finished.attrs.errormsg || "no reason given");
      // masscan writes no status: a host it lists answered.
      hosts = hosts.concat(kids(runs[r], "host").filter(function (h) {
        var s = kid(h, "status");
        return !s || s.attrs.state === "up";
      }).map(hostOf).filter(function (h) { return h.addresses.length; }));
    }
    // One MAC behind several IPv4 addresses (proxy ARP, a router answering
    // for a subnet) identifies none of them: they stay apart. An IPv4 and
    // IPv6 address of one machine, or several IPv6 ones, are one machine.
    var macUse = Object.create(null);
    hosts.forEach(function (h) {
      h.identities.forEach(function (i) {
        if (i.indexOf("mac:") !== 0) return;
        macUse[i] = macUse[i] || Object.create(null);
        h.addresses.forEach(function (a) { if (a.indexOf(":") < 0) macUse[i][addressKey(a)] = true; });
      });
    });
    var shared = Object.keys(macUse).filter(function (i) { return Object.keys(macUse[i]).length > 1; });
    hosts.forEach(function (h) {
      h.identities = h.identities.filter(function (i) { return shared.indexOf(i) < 0; });
    });
    if (opts.serviceName) {
      hosts.forEach(function (h) {
        h.ports.forEach(function (p) {
          var name = p.service ? opts.serviceName(p.service.name) : null;
          p.service = name ? { name: name, product: null, version: null } : null;
        });
      });
    }
    hosts = fold(hosts);
    if (!hosts.length) return problem("no-host-up");
    var silentUdp = 0;
    hosts.forEach(function (h) {
      h.ports.forEach(function (p) { if (p.protocol === "udp" && p.state === "open|filtered") silentUdp++; });
    });
    // When it ran, what it probed and how (nmap recipes spec §5.1).
    var date = null, probedPorts = {}, types = [];
    runs.forEach(function (run) {
      var start = Number(run.attrs.start);
      if (start > 0) {
        var d = new Date(start * 1000).toISOString().slice(0, 10);
        if (!date || d > date) date = d;
      }
      kids(run, "scaninfo").forEach(function (si) {
        if (si.attrs.type && types.indexOf(si.attrs.type) < 0) types.push(si.attrs.type);
        var proto = si.attrs.protocol;
        if (!proto) return;
        probedPorts[proto] = (probedPorts[proto] || []).concat(String(si.attrs.services || "").split(",").map(function (range) {
          var b = range.split("-").map(Number);
          return [b[0], b.length > 1 ? b[1] : b[0]];
        }).filter(function (b) { return b[0] >= 0 && b[1] >= b[0]; }));
      });
    });
    var args = argsOf(runs);
    // Different scans pasted together: none asked the others' hosts.
    var asks = runs.length > 1 && !args ? [] : asksOf(args, types, probedPorts);
    return { scan: { tool: want, args: args, hosts: hosts, silentUdp: silentUdp, date: date, probed: probedPorts, types: types, sharedMacs: shared.length, asks: asks } };
  }

  // What a scan asked of every host it lists (scan workflow spec §3), from
  // what nmap says it ran. Only a scan that can find a port open asked for
  // the ports: an ACK, window, FIN, NULL or Xmas scan says what a filter
  // passes.
  var FINDS_OPEN = ["syn", "connect", "udp"];
  // A host was asked which ports are open by a scan of twenty TCP ports
  // or more: a few ports looked at for another purpose leave the question
  // open.
  var ASKED_PORTS = 20;
  function asksOf(args, types, probed) {
    var a = " " + String(args || "").replace(/\s+/g, " ") + " ";
    function has(word) {
      return a.indexOf(" " + word + " ") >= 0;
    }
    var out = [];
    var finds = (types || []).filter(function (t) { return FINDS_OPEN.indexOf(t) >= 0; });
    // Without the list of what was probed, the scan is taken at its word.
    var tcp = probed && probed.tcp ? probed.tcp.reduce(function (n, r) { return n + r[1] - r[0] + 1; }, 0) : null;
    if (finds.some(function (t) { return t !== "udp"; }) && (tcp == null || tcp >= ASKED_PORTS)) out.push("ports");
    // nmap takes the scan letters together: -sCV, -sSV.
    var versions = /\s-s[A-Z]*V[A-Z]*\s/.test(a) || has("-A");
    if (finds.length && versions) out.push("products");
    if (has("--traceroute") || has("-A")) out.push("route");
    return out;
  }

  function probed(scan, proto, port) {
    return (((scan && scan.probed) || {})[proto] || []).some(function (r) { return port >= r[0] && port <= r[1]; });
  }
  // A port's state: as listed; else, where probed, the one state nmap
  // grouped the rest under, or "unknown" when it grouped under several.
  function portState(host, scan, proto, port) {
    var p = host.ports.filter(function (x) { return x.protocol === proto && x.port === port; })[0];
    if (p) return p.state;
    if (!probed(scan, proto, port)) return "not-probed";
    var states = (host.extraports || []).map(function (e) { return e.state; });
    return states.length === 1 ? states[0] : "unknown";
  }

  // What the runs ran, as one command: their targets together when their
  // options are the same, else nothing (they were different scans).
  function argsOf(runs) {
    var first = runs[0].attrs.args || "";
    if (runs.length === 1) return first;
    var at = first.indexOf(" -oX - ");
    if (at < 0) return "";
    var head = first.slice(0, at + 7), targets = [];
    for (var i = 0; i < runs.length; i++) {
      var args = runs[i].attrs.args || "";
      if (args.slice(0, head.length) !== head) return "";
      targets.push(args.slice(head.length).trim());
    }
    return head + targets.join(" ");
  }

  // A dropped file's bytes as text: UTF-16 with its byte-order mark (what
  // PowerShell's ">" writes), else UTF-8.
  function decodeFile(buffer) {
    var b = new Uint8Array(buffer);
    var enc = b[0] === 0xff && b[1] === 0xfe ? "utf-16le" : b[0] === 0xfe && b[1] === 0xff ? "utf-16be" : "utf-8";
    return new TextDecoder(enc).decode(b);
  }

  var api = { asksOf: asksOf, probed: probed, portState: portState, cleanName: cleanName, read: read, decodeFile: decodeFile, oneHost: oneHost, has: has, parseXml: parseXml, kids: kids, kid: kid, portName: portName, otherScanner: otherScanner, macOf: macOf };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapRead = api;
})();
