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
    // Several results pasted one after the other are read as one scan.
    var runs = kids(doc, "nmaprun");
    if (!runs.length) return problem("not-nmap");
    var hosts = [];
    for (var r = 0; r < runs.length; r++) {
      var finished = kid(kid(runs[r], "runstats"), "finished");
      if (!finished) return problem("truncated");
      if (finished.attrs.exit === "error") return problem("nmap-error", finished.attrs.errormsg || "no reason given");
      hosts = hosts.concat(kids(runs[r], "host").filter(function (h) {
        var s = kid(h, "status");
        return s && s.attrs.state === "up";
      }).map(hostOf).filter(function (h) { return h.addresses.length; }));
    }
    hosts = fold(hosts);
    if (!hosts.length) return problem("no-host-up");
    var silentUdp = 0;
    hosts.forEach(function (h) {
      h.ports.forEach(function (p) { if (p.protocol === "udp" && p.state === "open|filtered") silentUdp++; });
    });
    return { scan: { args: argsOf(runs), hosts: hosts, silentUdp: silentUdp } };
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

  var api = { read: read, decodeFile: decodeFile, oneHost: oneHost, has: has };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapRead = api;
})();
