// Greenbone (OpenVAS) reports beside nmap (roadmap greenbone-import): a GVM
// report in its XML format read into the scan nmap.js plans from — hosts,
// open ports, the products Greenbone detected on them, and its findings
// with CVE and severity, on their port or on the host. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var kids = R.kids, kid = R.kid;

  var PROBLEMS = {
    "empty": "Paste the report, or drop its .xml file here.",
    "not-report": "This is not a Greenbone report; download the report in the XML format.",
    "truncated": "The report is cut off; copy all of it, from <report to </report>.",
    "no-host": "The report has no hosts. Check its filter: all results, Log included.",
  };
  function problem(code) {
    return { problem: { code: code, message: PROBLEMS[code] } };
  }
  function text(el) {
    return el ? el.text.trim() : "";
  }

  // "cpe:/a:openbsd:openssh:9.6p1" or "cpe:2.3:a:openbsd:openssh:9.6:p1:…"
  // → "openssh 9.6p1". A product named only "server" or the like keeps its
  // vendor: "apache http server 2.4.58". Applications only; null otherwise.
  function cpeLabel(cpe) {
    var s = String(cpe || "").trim(), vendor, product, version = "";
    var two = /^cpe:2\.3:a:([^:]*):([^:]*):([^:]*)(?::([^:]*))?/.exec(s);
    var one = /^cpe:\/a:([^:]*):([^:]*)(?::([^:]*))?(?::([^:]*))?/.exec(s);
    var m = two || one;
    if (!m) return null;
    vendor = m[1];
    product = m[2];
    var v = m[3] && m[3] !== "*" && m[3] !== "-" ? m[3] : "";
    var update = two && m[4] && m[4] !== "*" && m[4] !== "-" ? m[4] : "";
    version = v + update;
    if (!product) return null;
    var words = function (x) {
      var d = x;
      try {
        d = decodeURIComponent(x.replace(/%(?![0-9a-fA-F]{2})/g, "%25"));
      } catch (e) {}
      return d.replace(/\\(.)/g, "$1").replace(/_/g, " ");
    };
    var name = /(^|_)server$/.test(product) && vendor && vendor !== product ? words(vendor) + " " + words(product) : words(product);
    return R.cleanName(name + (version ? " " + words(version) : ""));
  }

  // "22/tcp", "http (80/tcp)" → {protocol, port}; "general/tcp" → null.
  function portOf(s) {
    var m = /(\d{1,5})\/(tcp|udp)\b/.exec(String(s || ""));
    return m && Number(m[1]) > 0 && Number(m[1]) < 65536 ? { protocol: m[2], port: Number(m[1]) } : null;
  }

  // The report itself: a download is <report> around <report>; a GMP
  // answer wraps it once more.
  function reportOf(root) {
    var outer = kid(kid(root, "get_reports_response"), "report") || kid(root, "report");
    if (!outer) return null;
    return kid(outer, "report") || outer;
  }

  function read(input) {
    var t = String(input == null ? "" : input).replace(/^﻿/, "").replace(/\r\n?/g, "\n").trim();
    if (!t) return problem("empty");
    var start = t.search(/<\?xml|<report[\s>]|<get_reports_response[\s>]/);
    if (start > 0) t = t.slice(start);
    if (start < 0) {
      if (/<nmaprun[\s>]/.test(t)) return R.otherScanner(/scanner="masscan"/.test(t) ? "masscan" : "nmap", "Greenbone");
      return problem("not-report");
    }
    var doc = R.parseXml(t);
    if (doc.error) return problem(doc.error === "truncated" ? "truncated" : "not-report");
    if (kid(doc, "nmaprun")) return R.otherScanner(kid(doc, "nmaprun").attrs.scanner || "nmap", "Greenbone");
    var report = reportOf(doc);
    if (!report || (!kid(report, "results") && !kids(report, "host").length)) return problem("not-report");

    var hosts = [], byAddress = Object.create(null);
    function host(address) {
      var a = String(address || "").trim();
      if (!Ad.bytes(a)) return null;
      var k = Ad.addressKey(a);
      if (!byAddress[k]) {
        byAddress[k] = { addresses: [a], hostname: null, names: [], identities: [], os: null, device: [], self: false, ports: [], scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [] };
        hosts.push(byAddress[k]);
      }
      return byAddress[k];
    }
    function name(h, n) {
      var c = R.cleanName(n);
      if (!c || h.names.some(function (x) { return x.name.toLowerCase() === c.toLowerCase(); })) return;
      h.names.push({ name: c, from: "Greenbone" });
      h.hostnames.push({ name: c, type: null });
      h.hostname = h.hostname || c;
    }
    function port(h, at) {
      var p = h.ports.filter(function (x) { return x.protocol === at.protocol && x.port === at.port; })[0];
      if (!p) {
        var named = R.portName(at.protocol, at.port);
        p = { protocol: at.protocol, port: at.port, state: "open", reason: null, service: named ? { name: named, product: null, version: null } : null, scripts: [], findings: [] };
        h.ports.push(p);
      }
      return p;
    }
    // What Greenbone detected on a port: its first application CPE.
    function product(h, at, cpe) {
      var label = cpeLabel(cpe);
      if (!label) return;
      var p = port(h, at);
      if (p.service && p.service.product) return;
      p.service = { name: p.service ? p.service.name : null, product: label, version: null };
    }

    // The hosts' details: names, the OS, the MAC, open ports, products.
    kids(report, "host").forEach(function (el) {
      var h = host(text(kid(el, "ip")));
      if (!h) return;
      kids(el, "detail").forEach(function (d) {
        var key = text(kid(d, "name")), value = text(kid(d, "value"));
        if (key === "hostname") name(h, value);
        else if (key === "best_os_txt" && value) h.os = { name: value, accuracy: null };
        else if (key === "MAC") {
          var mac = R.macOf(value);
          if (mac && h.identities.indexOf("mac:" + mac) < 0) h.identities.push("mac:" + mac);
        } else if (key === "tcp_ports" || key === "udp_ports" || key === "ports") {
          value.split(",").forEach(function (n) {
            var at = portOf(n.trim() + "/" + (key === "udp_ports" ? "udp" : "tcp"));
            if (at) port(h, at);
          });
        } else if (/^cpe:(\/|2\.3:)a:/.test(key)) {
          var at = portOf(value);
          if (at) product(h, at, key);
        }
      });
    });
    // The ports with results.
    kids(kid(report, "ports"), "port").forEach(function (el) {
      var h = host(text(kid(el, "host"))), at = portOf(el.text);
      if (h && at) port(h, at);
    });
    // The results: a port with any result is open; one with a severity
    // above nothing is a finding (Log is 0, a false positive below 0).
    kids(kid(report, "results"), "result").forEach(function (el) {
      var hostEl = kid(el, "host");
      var h = host(hostEl ? hostEl.text : "");
      if (!h) return;
      name(h, text(kid(hostEl, "hostname")));
      var at = portOf(text(kid(el, "port")));
      var p = at ? port(h, at) : null;
      kids(kid(kid(el, "detection"), "result"), "details").forEach(function (ds) {
        var got = {};
        kids(ds, "detail").forEach(function (d) { got[text(kid(d, "name"))] = text(kid(d, "value")); });
        var where = portOf(got.location) || at;
        if (got.product && where) product(h, where, got.product);
      });
      var severity = Number(text(kid(el, "severity")));
      if (!(severity > 0)) return;
      var nvt = kid(el, "nvt");
      var oid = nvt ? nvt.attrs.oid || "" : "";
      var cves = kids(kid(nvt, "refs"), "ref").filter(function (r) { return r.attrs.type === "cve"; }).map(function (r) { return r.attrs.id; });
      // Older reports list them in one element.
      if (!cves.length) cves = text(kid(nvt, "cve")).split(/[\s,]+/).filter(function (c) { return /^CVE-\d{4}-\d+$/.test(c); });
      var finding = {
        source: "Greenbone",
        key: oid || text(kid(el, "name")),
        title: text(kid(nvt, "name")) || text(kid(el, "name")),
        state: (text(kid(el, "threat")) || "Severity") + " " + text(kid(el, "severity")),
        ids: cves.map(function (c) { return "CVE:" + c; }),
      };
      var list = p ? p.findings : h.findings;
      if (!list.some(function (f) { return f.key === finding.key; })) list.push(finding);
    });
    if (!hosts.length) return problem("no-host");
    hosts.forEach(function (h) {
      h.ports.sort(function (a, b) {
        return a.protocol === b.protocol ? a.port - b.port : a.protocol < b.protocol ? -1 : 1;
      });
    });
    var started = /^\d{4}-\d{2}-\d{2}/.exec(text(kid(report, "scan_start")) || text(kid(report, "timestamp")));
    var task = kid(report, "task");
    return { scan: {
      tool: "greenbone",
      args: "",
      hosts: hosts,
      silentUdp: 0,
      date: started ? started[0] : null,
      probed: {},
      types: [],
      sharedMacs: 0,
      task: task ? text(kid(task, "name")) || null : null,
      unfinished: text(kid(report, "scan_run_status")) !== "" && text(kid(report, "scan_run_status")) !== "Done",
    } };
  }

  var STAMP = /^Last Greenbone import: .*$/m;
  function stampFor(scan, range, date) {
    var of = scan && scan.task ? " of " + scan.task : "";
    var on = scan && scan.date ? " (scanned " + scan.date + ")" : "";
    return { line: "Last Greenbone import: " + date + ", report" + of + on + ".", pattern: STAMP };
  }

  var api = { read: read, cpeLabel: cpeLabel, stampFor: stampFor };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorGreenbone = api;
})();
