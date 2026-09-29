// What to run next, from what the drawing lacks (scan workflow spec §2):
// the steps the canvas's bulb names, in their order. Everything is read
// from the drawing; nothing is stored. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var St = node ? require("./scan-targets.js") : window.effractorScanTargets;
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;

  // A range wider than this is proposed to masscan first (spec §2).
  var WIDE = 1024;

  function ids(doc, kind) {
    return Object.keys(doc.entities).filter(function (id) { return doc.entities[id].kind === kind; });
  }
  // What steps() reads of the associations, gathered once: it is asked on
  // every change of the page, and a drawing may hold thousands.
  function index(doc) {
    var ix = { services: {}, product: {}, hostOf: {}, attached: {}, ported: {} };
    function add(map, k, v) {
      (map[k] = map[k] || []).push(v);
    }
    Object.keys(doc.associations || {}).forEach(function (k) {
      var a = doc.associations[k], to = doc.entities[a.to];
      if (a.kind === "hosts" && doc.entities[a.from]) {
        if (to && to.kind === "service") add(ix.services, a.from, a.to);
        if (!has(ix.hostOf, a.to)) ix.hostOf[a.to] = a.from;
      }
      if (a.kind === "instance-of" && !has(ix.product, a.from)) ix.product[a.from] = a.to;
      if (a.kind === "attached") add(ix.attached, a.from, a.to);
    });
    // A port is drawn as a flow to a service, as the command reads it.
    Object.keys(doc.flows || {}).forEach(function (k) {
      var f = doc.flows[k];
      if (/^(tcp|udp)\/\d{1,5}$/.test(f.protocol || "") && has(ix.hostOf, f.target)) ix.ported[ix.hostOf[f.target]] = true;
    });
    return ix;
  }
  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  function count(n, one) {
    return n + " " + one + (n === 1 ? "" : "s");
  }
  function asked(e, key) {
    return !!(e.asked && Object.prototype.hasOwnProperty.call(e.asked, key) && e.asked[key]);
  }
  // A host a scan can be aimed at and may answer; nuclei takes one by
  // its name, too.
  function there(e) {
    return (e.addresses || []).length > 0 && !e.missed;
  }
  function reachable(e) {
    return there(e) || (!e.missed && St.isName(String(e.label || "").trim().toLowerCase()));
  }
  function hosts(list) {
    return { kind: "selection", networks: [], hosts: list };
  }
  // How many addresses a network's ranges hold; an IPv6 range is never
  // scanned whole, so it counts as none.
  function width(e) {
    return (e.addresses || []).reduce(function (n, c) {
      var m = /^([^\/]+)\/(\d{1,3})$/.exec(c), b = m ? Ad.bytes(m[1]) : null;
      return n + (b && b.length === 4 && Number(m[2]) <= 32 ? Math.pow(2, 32 - Number(m[2])) : 0);
    }, 0);
  }
  // The scanners of the drawing, and the host the first of `tool` runs
  // on, else the host any of them runs on.
  function scanners(doc) {
    return ids(doc, "application").filter(function (id) { return !!doc.entities[id].tool; });
  }
  function standsOn(doc, ix, tool) {
    var all = scanners(doc).filter(function (id) { return has(ix.hostOf, id); });
    var first = all.filter(function (id) { return doc.entities[id].tool === tool; })[0] || all[0];
    return first ? ix.hostOf[first] : null;
  }
  // The services a host runs, and whether each has a product of a name.
  function services(ix, host) {
    return ix.services[host] || [];
  }
  function named(doc, ix, service) {
    var p = ix.product[service];
    return !!p && !!doc.entities[p] && !P.unidentified(doc.entities[p].label);
  }
  // The networks joined to `from` by drawn routers: a router is on the
  // networks it is attached to, and on those of the box it runs on.
  function reached(doc, ix, from) {
    var on = Object.create(null);
    Object.keys(doc.entities).forEach(function (r) {
      if (doc.entities[r].kind !== "router") return;
      on[r] = (ix.attached[r] || []).concat(has(ix.hostOf, r) ? ix.attached[ix.hostOf[r]] || [] : []);
    });
    var seen = Object.create(null), next = from.slice();
    while (next.length) {
      var n = next.pop();
      if (seen[n]) continue;
      seen[n] = true;
      Object.keys(on).forEach(function (r) {
        if (on[r].indexOf(n) >= 0) on[r].forEach(function (m) { if (!seen[m]) next.push(m); });
      });
    }
    return seen;
  }

  // The steps that apply, in order: [{id, tool, count, says, purposes,
  // adjust, targets}]. `silenced`: the ids the visitor wants to hear
  // nothing of. `purposes`: the recipes the dialog ticks (null: as they
  // stand); `adjust`: the blocks it sets; `targets`: a choice of the
  // targets row.
  function steps(doc, silenced) {
    if (!doc || doc.profile !== "architecture" || !doc.entities) return [];
    var out = [], ix = index(doc);
    var all = ids(doc, "host");
    var drawnNets = ids(doc, "network");
    var networks = drawnNets.filter(function (n) { return (doc.entities[n].addresses || []).length > 0; });
    var on = Object.create(null);
    drawnNets.forEach(function (n) { on[n] = St.hostsOn(doc, n); });

    // 1. No scanner.
    if (!scanners(doc).length) out.push({ id: "scanner", tool: "nmap", count: 0, says: "Scan a network with nmap", purposes: null, adjust: null, targets: null });

    // 2. A drawn network no scan has seen a host on.
    var unscanned = networks.filter(function (n) {
      return !on[n].some(function (h) { return !!doc.entities[h].seen; });
    });
    if (unscanned.length) {
      var first = unscanned[0], wide = width(doc.entities[first]) > WIDE;
      var tool = wide ? "masscan" : "nmap";
      // masscan is given a network's IPv4 ranges only.
      var ranges = doc.entities[first].addresses || [], four = ranges.filter(function (c) { return c.indexOf(":") < 0; });
      var target = wide && four.length < ranges.length ? { kind: "typed", text: four.join(" ") } : { kind: "range", network: first };
      var here = standsOn(doc, ix, "nmap");
      var local = !!here && on[first].indexOf(here) >= 0;
      out.push({
        id: "network", tool: tool, count: unscanned.length,
        says: (unscanned.length === 1 ? doc.entities[first].label : count(unscanned.length, "network")) + " not scanned · " + tool,
        purposes: wide ? null : local ? ["lan", "services"] : ["services"], adjust: null,
        targets: target,
      });
    }

    // 3. What runs on drawn hosts.
    var quiet = all.filter(function (h) {
      var e = doc.entities[h];
      if (!there(e)) return false;
      var runs = services(ix, h);
      if (!runs.length) return !asked(e, "ports");
      return !asked(e, "products") && runs.some(function (s) { return !named(doc, ix, s); });
    });
    if (quiet.length) {
      // Where every one of them has ports drawn, those are asked.
      var drawn = quiet.every(function (h) { return !!ix.ported[h]; });
      out.push({ id: "runs", tool: "nmap", count: quiet.length, says: count(quiet.length, "host") + " not asked what runs there · nmap", purposes: ["services"], adjust: drawn ? { ports: "drawn" } : null, targets: hosts(quiet) });
    }

    // 4. A way between two drawn networks.
    var base = standsOn(doc, ix, "nmap");
    var mine = base ? (ix.attached[base] || []).filter(function (n) { return doc.entities[n] && doc.entities[n].kind === "network"; }) : [];
    if (mine.length) {
      var near = reached(doc, ix, mine);
      var far = drawnNets.filter(function (n) {
        return !near[n] && on[n].some(function (h) { return there(doc.entities[h]) && !asked(doc.entities[h], "route"); });
      });
      if (far.length) {
        var to = on[far[0]].filter(function (h) { return there(doc.entities[h]); });
        out.push({ id: "way", tool: "nmap", count: far.length, says: "No way drawn to " + (far.length === 1 ? doc.entities[far[0]].label : count(far.length, "network")) + " · nmap", purposes: ["route", "snmp", "managed"], adjust: null, targets: hosts(to) });
      }
    }

    // 5. How services connect.
    var unasked = all.filter(function (h) {
      var e = doc.entities[h];
      return reachable(e) && !asked(e, "connections") && services(ix, h).length > 0;
    });
    if (unasked.length) out.push({ id: "connect", tool: "nuclei", count: unasked.length, says: count(unasked.length, "host") + " not asked how they connect · nuclei", purposes: ["identify", "connect"], adjust: null, targets: hosts(unasked) });

    return out.filter(function (s) { return (silenced || []).indexOf(s.id) < 0; });
  }

  // What the visitor silenced, as the browser keeps it: a list of step
  // ids; the key written before ("dismissed") silenced the first step.
  var IDS = ["scanner", "network", "runs", "way", "connect"];
  function silenced(stored, old) {
    var list = [];
    try {
      var read = JSON.parse(stored || "[]");
      if (Array.isArray(read)) list = read.filter(function (id) { return IDS.indexOf(id) >= 0; });
    } catch (e) {}
    if (old === "dismissed" && list.indexOf("scanner") < 0) list.push("scanner");
    return list.filter(function (id, i) { return list.indexOf(id) === i; });
  }

  var api = { steps: steps, silenced: silenced, IDS: IDS, WIDE: WIDE };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorScanGaps = api;
})();
