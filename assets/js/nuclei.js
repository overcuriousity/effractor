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
  var T = node ? require("./nuclei-templates.js") : window.effractorNucleiTemplates;

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
      var h = { addresses: addresses, hostname: null, names: [], identities: [], os: null, device: [], self: false, ports: [], scripts: [], findings: [], hostnames: [], vendor: null, trace: [], extraports: [], said: [] };
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

    // effractor's own templates (nuclei templates spec §4): their answers
    // are facts about a port, a host or a name, not findings.
    var ours = got.list.filter(function (r) { return /^effractor-/.test(word(r["template-id"])); });
    var answers = T.read(ours);
    var points = [];

    // Where each result was found, and what it says.
    var info = 0, first = null;
    got.list.forEach(function (r) {
      var day = /^\d{4}-\d{2}-\d{2}/.exec(word(r.timestamp));
      if (day && (!first || day[0] < first)) first = day[0];
    });
    var read = got.list.filter(function (r) { return ours.indexOf(r) < 0; }).map(function (r) {
      var at = target(r["matched-at"]), url = target(r.url), host = target(r.host);
      var scheme = at.scheme || url.scheme || word(r.scheme).toLowerCase() || null;
      var said = host.host || at.host || url.host;
      var address = Ad.bytes(word(r.ip)) ? word(r.ip) : said && Ad.bytes(said) ? said : null;
      var severity = word(r.info.severity).toLowerCase();
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
    answers.facts.forEach(function (f) {
      if (f.kind === "points") points.push(f);
      else if (f.at.port) read.push({ address: f.at.address, name: f.at.name, port: f.at.port, finding: null, fact: f });
    });
    // A host is one with an open port or a finding. Those with an address
    // first: a result that has only a name is theirs when they bear it.
    function place(h, x) {
      name(h, x.name);
      var list = x.port ? port(h, x.port).findings : h.findings;
      if (x.fact) {
        var p = port(h, x.port);
        (p.facts = p.facts || []).push(x.fact);
      }
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
    // What the facts of one port come to (spec §5.2, §5.4): the server is
    // the service on the port; the application a piece of its own, unless
    // it answers by itself.
    function settle(h, p) {
      // In one order whatever order nuclei wrote them in: by the table,
      // then by what they say.
      var facts = p.facts.map(function (f) {
        return { fact: f, key: [f.kind, 1000 + T.ANSWERS.indexOf(T.answer(f.id || f.name || f.of || "")), f.product || "", f.version || "", f.host || "", (f.names || []).length, (f.names || []).join(" "), f.what || "", f.text || ""].join("\n") };
      }).sort(function (a, b) { return a.key < b.key ? -1 : a.key > b.key ? 1 : 0; }).map(function (x) { return x.fact; });
      delete p.facts;
      var of = function (kind) { return facts.filter(function (f) { return f.kind === kind; }); };
      // The one that says more: `more(f)` first, else the first.
      function best(list, more) {
        return list.filter(more)[0] || list[0] || null;
      }
      var products = of("product").filter(function (f) {
        return !(f.unless && facts.some(function (o) { return o.kind === "product" && o.name === f.unless; }));
      });
      var app = of("application")[0] || null;
      // The application's own server where it answers, else one that names its version.
      var own = app ? [].concat(app.server || []) : [];
      var server = of("server").filter(function (f) { return own.indexOf(f.word) >= 0; })[0] || best(of("server"), function (f) { return !!f.version; });
      var version = app ? of("version").filter(function (f) { return f.of === app.id; })[0] : null;
      var named = p.service ? p.service.name : null;
      function service(x, v) {
        p.service = { name: named, product: x, version: v || null };
      }
      if (app && server && own.indexOf(server.word) < 0) {
        service(server.product, server.version);
        p.application = { id: app.id, label: app.product, product: app.product, version: version ? version.version : null };
      } else if (app) service(app.product, version ? version.version : null);
      else if (server) service(server.product, server.version);
      else if (products.length) service(best(products, function (f) { return !!f.version; }).product, best(products, function (f) { return !!f.version; }).version);
      if (app) {
        p.manages = app.manages;
        p.signs = app.signs;
      }
      var sso = best(of("sso"), function (f) { return !!f.product; });
      if (sso || of("login").length) p.login = { password: of("login").length > 0, sso: sso ? { product: sso.product, host: sso.host } : null };
      of("names").forEach(function (f) {
        f.names.forEach(function (n) {
          if (!h.names.some(function (x) { return x.name.toLowerCase() === n.toLowerCase(); })) h.names.push({ name: n, from: "certificate", port: p.port });
        });
      });
      // What a port said is said where it named nothing.
      if (!p.service || !p.service.product) {
        of("said").forEach(function (f) {
          var text = f.what + " on " + p.protocol + "/" + p.port + ": " + f.text;
          if (h.said.indexOf(text) < 0) h.said.push(text);
        });
        h.said.sort();
      }
    }
    if (!hosts.length && !points.length) return problem("no-host");
    hosts.forEach(function (h) {
      h.ports.sort(function (a, b) { return a.port - b.port; });
      h.ports.forEach(function (p) { if (p.facts) settle(h, p); });
    });
    // What each name points to, once (spec §6.4).
    var pointed = [];
    points.forEach(function (f) {
      var x = pointed.filter(function (y) { return y.name === f.name; })[0];
      if (!x) pointed.push(x = { name: f.name, address: null, alias: null });
      if (f.address) x.address = x.address || f.address;
      if (f.alias) x.alias = x.alias || f.alias;
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
      results: got.list.length - ours.length,
      informational: info,
      answers: ours.length,
      unknown: answers.unknown,
      refused: answers.refused,
      points: pointed,
    } };
  }

  // What the preview says of the result itself.
  function notes(scan) {
    var n = scan.informational || 0, out = [];
    if (n) out.push(n + " of " + scan.results + (scan.results === 1 ? " result is" : " results are") + " informational: they say a port is open, not what is wrong.");
    // Nuclei templates spec §4: what was read past, and what was only said.
    if (scan.unknown) out.push(scan.unknown + (scan.unknown === 1 ? " answer" : " answers") + " this version does not know; not drawn.");
    if (scan.refused) out.push(scan.refused + (scan.refused === 1 ? " answer has" : " answers have") + " not the shape of what was asked; not drawn.");
    (scan.hosts || []).forEach(function (h) {
      (h.said || []).forEach(function (s) { out.push((h.addresses[0] || h.hostname) + " · " + s + "."); });
    });
    return out;
  }

  var STAMP = /^Last nuclei import: .*$/m;
  function stampFor(scan, range, date) {
    var r = String(range == null ? "" : range).trim().replace(/\s+/g, " ");
    var on = scan && scan.date ? " (scanned " + scan.date + ")" : "";
    return { line: "Last nuclei import: " + date + ", scan" + (r ? " of " + r : "") + on + ".", pattern: STAMP };
  }

  // ---- effractor's templates beside nuclei's checks (spec §10) ----

  var OURS = [
    { id: "identify", ours: true, name: "What is there", finds: "What answers on each port, which web application, which names a certificate bears.", time: "seconds per host", tags: [] },
    { id: "connect", ours: true, name: "How it connects", finds: "Logins, single sign-on, management pages, where names point.", time: "seconds per host", tags: [] },
  ];
  var APART = "effractor's templates and nuclei's checks are run one after the other; untick one of the two.";
  function own(ids) {
    return (ids || []).filter(function (id) { return OURS.some(function (r) { return r.id === id; }); });
  }
  // The blocks of Adjust that are offered with what is ticked.
  function offered(recipeIds) {
    return own(recipeIds).length ? T.ADJUST.slice() : C.BLOCKS.map(function (b) { return b.id; });
  }
  function combine(recipeIds, adjust) {
    var ours = own(recipeIds);
    if (!ours.length) return C.combine(recipeIds, adjust);
    if (ours.length < (recipeIds || []).length) return { problem: APART };
    var ch = {};
    C.BLOCKS.forEach(function (b) {
      var asked = adjust && R.has(adjust, b.id) ? adjust[b.id] : null;
      ch[b.id] = T.ADJUST.indexOf(b.id) >= 0 && b.choices.some(function (c) { return c.id === asked; }) ? asked : C.DEFAULTS[b.id];
    });
    return { choices: ch, recipes: OURS.filter(function (r) { return ours.indexOf(r.id) >= 0; }), notes: [] };
  }
  // `extra.doc`: the drawing, which effractor's templates take their
  // targets from.
  function command(recipeIds, adjust, range, extra) {
    var ours = own(recipeIds);
    if (!ours.length) return C.command(recipeIds, adjust, range, extra);
    var c = combine(recipeIds, adjust);
    if (c.problem) return { problem: c.problem };
    return T.command(ours, c.choices, range, (extra || {}).doc || { entities: {} });
  }

  var api = {};
  Object.keys(C).forEach(function (k) { api[k] = C[k]; });
  api.RECIPES = OURS.concat(C.RECIPES);
  api.combine = combine;
  api.command = command;
  api.offered = offered;
  api.read = read;
  api.notes = notes;
  api.stampFor = stampFor;
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNuclei = api;
})();
