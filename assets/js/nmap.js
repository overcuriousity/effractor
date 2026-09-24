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

  var api = { LEVELS: LEVELS, level: level, command: command, read: read };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmap = api;
})();
