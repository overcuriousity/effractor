// nuclei beside nmap (roadmap nuclei-import): its JSON lines (-jsonl, or
// the list -json-export writes) read into the scan nmap.js plans from —
// hosts by address or by name, the ports nuclei reached, and its findings
// with CVE and severity, on their port or on the host. nuclei names no
// product and no OS. The commands are nuclei-command.js's. Pure: no DOM,
// no wasm.
(function () {
  var node = typeof module !== "undefined";
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var C = node ? require("./nuclei-command.js") : window.effractorNucleiCommand;

  var PROBLEMS = {
    "empty": "Paste the result, or drop its file here. No lines at all: nuclei found nothing.",
    "not-nuclei": "This is not a nuclei result; run the command with -jsonl.",
    "normal-output": "This is nuclei's plain output; run the command with -jsonl.",
    "truncated": "The result is cut off; copy every line, to the end of the last one.",
    "no-host": "The result names no host with an open port or a finding.",
  };
  function problem(code) {
    return { problem: { code: code, message: PROBLEMS[code] } };
  }

  // Weakest first; info and unknown say a port is open, not what is wrong.
  var SEVERITIES = ["unknown", "info", "low", "medium", "high", "critical"];
  var PLAIN = /^\[[^\]\s]+\] \[[a-z]+\] \[(info|low|medium|high|critical|unknown)\] /m;
  var SCHEME_PORTS = { http: 80, https: 443 };

  function word(x) {
    return typeof x === "string" ? x.trim() : "";
  }
  function portOf(x) {
    var n = typeof x === "number" ? x : /^\d{1,5}$/.test(word(x)) ? Number(x) : 0;
    return n > 0 && n < 65536 && n === Math.floor(n) ? n : null;
  }

  var target = C.target;

  // The results of a paste: one JSON object per line, or nuclei's export
  // file, a JSON list; what nuclei says beside them is skipped.
  function results(t) {
    var list = null, cut = false, plain = PLAIN.test(t);
    if (/^\[\s*(\{|\])/.test(t)) {
      try {
        list = JSON.parse(t);
      } catch (e) {
        cut = true;
      }
      if (!Array.isArray(list)) list = null;
    }
    if (!list && !cut) {
      list = [];
      t.split("\n").forEach(function (line) {
        var l = line.replace(/\u001b\[[0-9;]*m/g, "").trim();
        if (l[0] !== "{") return;
        try {
          list.push(JSON.parse(l));
        } catch (e) {
          cut = true;
        }
      });
    }
    var found = (list || []).filter(function (r) {
      return !!r && typeof r === "object" && !!word(r["template-id"]) && !!r.info && typeof r.info === "object" && SEVERITIES.indexOf(word(r.info.severity).toLowerCase()) >= 0;
    });
    if (cut) return /"template-id"/.test(t) ? problem("truncated") : problem("not-nuclei");
    if (!found.length) return problem(plain ? "normal-output" : "not-nuclei");
    return { list: found };
  }

  function read(input) {
    var t = String(input == null ? "" : input).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!t) return problem("empty");
    if (/<nmaprun[\s>]/.test(t)) return R.otherScanner(/<nmaprun[^>]*scanner="masscan"/.test(t) ? "masscan" : "nmap", "nuclei");
    if (/<report[^>]*format_id=|<get_reports_response[\s>]/.test(t)) return R.otherScanner("Greenbone", "nuclei");
    var got = results(t);
    if (got.problem) return got;

    var hosts = [], byAddress = Object.create(null), byName = Object.create(null);
    function fresh(addresses) {
      var h = { addresses: addresses, hostname: null, names: [], identities: [], os: null, device: [], self: false, ports: [], scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [] };
      hosts.push(h);
      return h;
    }
    function name(h, n) {
      if (!n || h.names.some(function (x) { return x.name.toLowerCase() === n.toLowerCase(); })) return;
      h.names.push({ name: n, from: "nuclei" });
      h.hostnames.push({ name: n, type: null });
      h.hostname = h.hostname || n;
      byName[n.toLowerCase()] = byName[n.toLowerCase()] || h;
    }
    // Named by its number alone, as nmap's table would: two ports named
    // "http" would share one unidentified product, and a finding on one
    // would mark the other's.
    function port(h, number) {
      var p = h.ports.filter(function (x) { return x.protocol === "tcp" && x.port === number; })[0];
      if (!p) {
        var named = R.portName("tcp", number);
        p = { protocol: "tcp", port: number, state: "open", reason: null, service: named ? { name: named, product: null, version: null } : null, scripts: [], findings: [] };
        h.ports.push(p);
      }
      return p;
    }

    // Where each result was found, and what it says.
    var info = 0, first = null;
    var read = got.list.map(function (r) {
      var at = target(r["matched-at"]), url = target(r.url), host = target(r.host);
      var scheme = at.scheme || url.scheme || word(r.scheme).toLowerCase() || null;
      var said = host.host || at.host || url.host;
      var address = Ad.bytes(word(r.ip)) ? word(r.ip) : said && Ad.bytes(said) ? said : null;
      var severity = word(r.info.severity).toLowerCase();
      var day = /^\d{4}-\d{2}-\d{2}/.exec(word(r.timestamp));
      if (day && (!first || day[0] < first)) first = day[0];
      var finding = null;
      if (SEVERITIES.indexOf(severity) >= SEVERITIES.indexOf("low")) {
        var c = r.info.classification && typeof r.info.classification === "object" ? r.info.classification : {};
        var score = typeof c["cvss-score"] === "number" && c["cvss-score"] > 0 && c["cvss-score"] <= 10 ? " " + c["cvss-score"] : "";
        var cves = [].concat(c["cve-id"] || []).map(function (x) { return word(x).toUpperCase(); }).filter(function (x) { return /^CVE-\d{4}-\d+$/.test(x); });
        var key = R.cleanName(r["template-id"]);
        finding = {
          source: "nuclei",
          key: key,
          title: R.cleanName(r.info.name) || key,
          state: severity[0].toUpperCase() + severity.slice(1) + score,
          ids: cves.map(function (x) { return "CVE:" + x; }),
        };
      } else info++;
      return {
        address: address,
        name: said && !Ad.bytes(said) ? R.cleanName(said) : null,
        // A DNS result is about the name, whatever port answered it.
        port: word(r.type) === "dns" ? null : portOf(r.port) || at.port || url.port || host.port || (R.has(SCHEME_PORTS, scheme) ? SCHEME_PORTS[scheme] : null),
        finding: finding,
      };
    });
    // A host is one with an open port or a finding. Those with an address
    // first: a result that has only a name is theirs when they bear it.
    function place(h, x) {
      name(h, x.name);
      var list = x.port ? port(h, x.port).findings : h.findings;
      if (x.finding && !list.some(function (f) { return f.key === x.finding.key; })) list.push(x.finding);
    }
    read.forEach(function (x) {
      if (!x.address || !(x.port || x.finding)) return;
      var k = Ad.addressKey(x.address);
      byAddress[k] = byAddress[k] || fresh([x.address]);
      place(byAddress[k], x);
    });
    read.forEach(function (x) {
      if (x.address || !x.name || !(x.port || x.finding)) return;
      place(byName[x.name.toLowerCase()] || fresh([]), x);
    });
    if (!hosts.length) return problem("no-host");
    hosts.forEach(function (h) {
      h.ports.sort(function (a, b) { return a.port - b.port; });
    });
    return { scan: {
      tool: "nuclei",
      args: "",
      hosts: hosts,
      silentUdp: 0,
      date: first,
      probed: {},
      types: [],
      sharedMacs: 0,
      results: got.list.length,
      informational: info,
    } };
  }

  // What the preview says of the result itself.
  function notes(scan) {
    var n = scan.informational || 0;
    if (!n) return [];
    return [n + " of " + scan.results + (scan.results === 1 ? " result is" : " results are") + " informational: they say a port is open, not what is wrong."];
  }

  var STAMP = /^Last nuclei import: .*$/m;
  function stampFor(scan, range, date) {
    var r = String(range == null ? "" : range).trim().replace(/\s+/g, " ");
    var on = scan && scan.date ? " (scanned " + scan.date + ")" : "";
    return { line: "Last nuclei import: " + date + ", scan" + (r ? " of " + r : "") + on + ".", pattern: STAMP };
  }

  var api = {};
  Object.keys(C).forEach(function (k) { api[k] = C[k]; });
  api.read = read;
  api.notes = notes;
  api.stampFor = stampFor;
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNuclei = api;
})();
