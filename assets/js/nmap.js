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

  // Elements and their attributes; text between tags is not needed. Returns
  // the document's root holder, or {error: "not-xml" | "truncated"}.
  var NAME = /^[A-Za-z_][-A-Za-z0-9_:.]*/;
  function parseXml(text) {
    var root = { name: "", attrs: {}, children: [] };
    var stack = [root];
    var i = 0;
    for (;;) {
      var lt = text.indexOf("<", i);
      if (lt < 0) break;
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
        var el = { name: m[0], attrs: {}, children: [] };
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
    "truncated": "The result ends early; copy the whole output, from <?xml to </nmaprun>.",
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

  function hostOf(h) {
    var names = kids(kid(h, "hostnames"), "hostname");
    var match = kids(kid(h, "os"), "osmatch")[0];
    return {
      addresses: kids(h, "address").filter(function (a) {
        return a.attrs.addrtype === "ipv4" || a.attrs.addrtype === "ipv6";
      }).map(function (a) { return a.attrs.addr; }),
      hostname: names.length ? names[0].attrs.name || null : null,
      os: match ? { name: match.attrs.name, accuracy: Number(match.attrs.accuracy) } : null,
      ports: kids(kid(h, "ports"), "port").map(function (p) {
        var state = kid(p, "state");
        return { protocol: p.attrs.protocol, port: Number(p.attrs.portid), state: state ? state.attrs.state : "", service: serviceOf(p) };
      }),
    };
  }

  function read(text) {
    var t = String(text == null ? "" : text).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!t) return problem("empty");
    if (t[0] !== "<") return problem(/Nmap scan report for|^# Nmap|^Host: /m.test(t) ? "normal-output" : "not-xml");
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
  function onlyCidr(range) {
    var words = String(range == null ? "" : range).trim().split(/\s+/).filter(Boolean);
    return words.length === 1 && /\/\d{1,3}$/.test(words[0]) && inCidr(words[0].split("/")[0], words[0]) ? words[0] : null;
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
    var appNets = appHost ? attachedNetworks(doc, appHost) : [];
    var cidr = onlyCidr(range);
    var proposed = cidr && !networks.some(function (n) { return (doc.entities[n].addresses || []).indexOf(cidr) >= 0; })
      ? { label: cidr, addresses: [cidr] } : null;
    var products = Object.create(null);
    ids(doc, "product").forEach(function (p) { products[doc.entities[p].label] = products[doc.entities[p].label] || p; });
    var usedNew = false;

    var planned = scan.hosts.map(function (h, i) {
      var key = "h" + i;
      var known = null;
      h.addresses.forEach(function (a) { if (!known && byAddress[addressKey(a)]) known = byAddress[addressKey(a)]; });
      var merged = !known && candidates.indexOf(merges[key]) >= 0 ? merges[key] : null;
      var target = known || merged;
      var label = target ? doc.entities[target].label : h.hostname || h.addresses[0];
      var nets = [];
      if (!target) {
        nets = networks.filter(function (n) {
          return (doc.entities[n].addresses || []).some(function (c) {
            return h.addresses.some(function (a) { return inCidr(a, c); });
          });
        });
        if (!nets.length && proposed && h.addresses.some(function (a) { return inCidr(a, cidr); })) {
          nets = ["new"];
          usedNew = true;
        }
      }
      var theirs = target ? attachedNetworks(doc, target) : nets;
      var shared = appNets.filter(function (n) { return theirs.indexOf(n) >= 0; });
      return {
        key: key,
        label: label,
        addresses: h.addresses.slice(),
        os: h.os ? "nmap OS guess: " + h.os.name + " (" + h.os.accuracy + "%)." : null,
        known: known,
        merged: merged,
        networks: nets,
        route: shared.length ? [shared[0]] : [],
        ports: h.ports.filter(function (p) { return p.state === "open"; }).map(function (p) {
          return portRow(doc, appId, target, key, label, p, products);
        }),
      };
    });

    return {
      app: appId,
      appHost: appHost,
      network: usedNew ? proposed : null,
      candidates: candidates,
      silentUdp: scan.silentUdp || 0,
      hosts: planned,
    };
  }

  function portRow(doc, appId, target, hostKey, hostLabel, p, products) {
    var proto = p.protocol + "/" + p.port;
    var s = p.service || {};
    var label = s.name || proto;
    var known = null;
    if (target) {
      var hosted = links(doc, "hosts").filter(function (a) {
        return a.from === target && doc.entities[a.to] && doc.entities[a.to].kind === "service";
      }).map(function (a) { return a.to; });
      Object.keys(doc.flows || {}).forEach(function (k) {
        var f = doc.flows[k];
        if (!known && f.protocol === proto && hosted.indexOf(f.target) >= 0) known = f.target;
      });
    }
    var addsFlow = !(known && Object.keys(doc.flows || {}).some(function (k) {
      var f = doc.flows[k];
      return f.source === appId && f.target === known && f.protocol === proto;
    }));
    var product = s.product
      ? { label: s.product + (s.version ? " " + s.version : ""), existing: null, identified: true }
      : { label: "unidentified " + label + " on " + hostLabel, existing: null, identified: false };
    if (product.identified && products[product.label]) product.existing = products[product.label];
    return { key: hostKey + "/" + proto, proto: proto, label: label, product: product, known: known, addsFlow: addsFlow };
  }

  function defaults(p) {
    var t = { hosts: {}, ports: {}, network: true };
    p.hosts.forEach(function (h) {
      t.hosts[h.key] = true;
      h.ports.forEach(function (r) { if (!r.known || r.addsFlow) t.ports[r.key] = true; });
    });
    return t;
  }

  // What the ticked rows add, and whether the result stays in the limits.
  // A new host whose only network is an unticked proposed one is added
  // unattached, as apply does.
  function summary(doc, p, ticks, limits) {
    var s = { hosts: 0, networks: 0, services: 0, products: 0, flows: 0 };
    var rel = 0, newProducts = Object.create(null);
    var network = !!(p.network && ticks.network);
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      if (!h.known && !h.merged) {
        s.hosts++;
        h.networks.forEach(function (n) {
          if (n !== "new") rel++;
          else if (network) {
            rel++;
            s.networks = 1;
          }
        });
      }
      h.ports.forEach(function (r) {
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
    s.entities = Object.keys(doc.entities || {}).length + s.hosts + s.networks + s.services + s.products;
    s.relationships = Object.keys(doc.associations || {}).length + Object.keys(doc.flows || {}).length + rel;
    s.tooMany = null;
    if (limits && s.entities > limits.entities) s.tooMany = "That makes " + s.entities + " components; the limit is " + limits.entities + ". Untick some hosts.";
    else if (limits && s.relationships > limits.relationships) s.tooMany = "That makes " + s.relationships + " links and flows; the limit is " + limits.relationships + ". Untick some hosts.";
    return s;
  }

  var api = { LEVELS: LEVELS, level: level, command: command, read: read, bytes: bytes, inCidr: inCidr, plan: plan, defaults: defaults, summary: summary };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmap = api;
})();
