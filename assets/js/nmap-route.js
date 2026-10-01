// Traceroute hops into routers and the networks between them (nmap recipes
// spec §4): what a scan's traces say of the way, planned against the
// document and applied with the import. Pure.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;

  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  function attachedTo(doc, machine) {
    return links(doc, "attached").filter(function (a) { return a.from === machine; }).map(function (a) { return a.to; });
  }
  function routerOn(doc, host) {
    var a = links(doc, "hosts").filter(function (x) { return x.from === host && doc.entities[x.to] && doc.entities[x.to].kind === "router"; })[0];
    return a ? a.to : null;
  }
  function holds(doc, network, address) {
    return ((doc.entities[network] || {}).addresses || []).some(function (c) { return Ad.inCidr(address, c); });
  }

  // `rows`: the planner's rows ({key, scan, known, merged, on}); `ctx`:
  // {byAddress, networks, appNets, proposed: {cidr, into} | null}.
  // Returns {routers, links, paths} (spec §4.2–§4.4).
  function routes(doc, rows, ctx) {
    var routers = [], byKey = Object.create(null), out = [], linkBy = Object.create(null), paths = {};
    var rowAt = Object.create(null);
    rows.forEach(function (r) {
      r.scan.addresses.forEach(function (a) { rowAt[Ad.addressKey(a)] = rowAt[Ad.addressKey(a)] || r; });
    });
    function router(hop) {
      var k = "r:" + Ad.addressKey(hop.address);
      if (byKey[k]) return byKey[k];
      var row = rowAt[Ad.addressKey(hop.address)] || null;
      var known = row ? row.known || row.merged || null : ctx.byAddress[Ad.addressKey(hop.address)] || null;
      var label = known ? doc.entities[known].label : hop.name || hop.address;
      byKey[k] = { key: k, address: hop.address, name: hop.name || null, label: label, known: known, row: row ? row.key : null, router: known ? routerOn(doc, known) : null, targets: 0 };
      routers.push(byKey[k]);
      return byKey[k];
    }
    // Spec §4.4: the network that holds the far hop's address, else one
    // both are on, else a new one without addresses.
    function between(a, b, gap) {
      var k = "l:" + a.key + "|" + b.key;
      if (linkBy[k]) return linkBy[k];
      var network = ctx.networks.filter(function (n) { return holds(doc, n, b.address); })[0] || null;
      if (!network && ctx.proposed && Ad.inCidr(b.address, ctx.proposed.cidr)) network = ctx.proposed.into;
      if (!network && a.known && b.known) {
        var mine = attachedTo(doc, a.known);
        network = attachedTo(doc, b.known).filter(function (n) { return mine.indexOf(n) >= 0; })[0] || null;
      }
      var label = "between " + a.label + " and " + b.label + (gap ? " (" + gap + (gap === 1 ? " hop" : " hops") + " unseen)" : "");
      linkBy[k] = { key: k, from: a.key, to: b.key, network: network, label: label, gap: gap };
      out.push(linkBy[k]);
      return linkBy[k];
    }
    rows.forEach(function (r) {
      var own = r.scan.addresses.map(Ad.addressKey);
      var hops = (r.scan.trace || []).filter(function (h) { return h.address && own.indexOf(Ad.addressKey(h.address)) < 0; });
      if (!hops.length) return;
      // Cut before the first hop outside private space (spec §4.2).
      var kept = [];
      for (var i = 0; i < hops.length && Ad.isPrivate(hops[i].address); i++) kept.push(hops[i]);
      var path = { hops: [], cut: hops.length - kept.length, first: null, last: r.on[0] || null };
      var before = null;
      for (var j = 0; j < kept.length; j++) {
        var hop = kept[j];
        // A route that comes by the same router twice is not one to draw:
        // what it saw up to there is, nothing after, and no flow takes it.
        // `loop`: the router it came back to.
        var key = "r:" + Ad.addressKey(hop.address);
        if (path.hops.indexOf(key) >= 0) {
          path.loop = byKey[key].label;
          break;
        }
        var it = router(hop);
        it.targets++;
        if (before) between(before.router, it, hop.ttl - before.ttl - 1);
        path.hops.push(it.key);
        before = { router: it, ttl: hop.ttl };
      }
      if (path.hops.length) {
        var one = byKey[path.hops[0]];
        path.first = ctx.appNets.filter(function (n) { return n === "new" ? ctx.proposed && Ad.inCidr(one.address, ctx.proposed.cidr) : holds(doc, n, one.address); })[0]
          || (ctx.appNets.length === 1 ? ctx.appNets[0] : null);
      }
      paths[r.key] = path;
    });
    return { routers: routers, links: out, paths: paths };
  }

  // The way as the preview says it: "via gw.lab, 172.16.0.1 · then 7 hops
  // on the internet", or "… · then back to gw.lab" where it looped.
  function said(p, rowKey) {
    var path = p.paths && p.paths[rowKey];
    if (!path || (!path.hops.length && !path.cut)) return "";
    var via = path.hops.map(function (k) {
      return p.routers.filter(function (r) { return r.key === k; })[0].label;
    });
    var parts = [];
    if (via.length) parts.push("via " + via.join(", "));
    if (path.loop) parts.push("then back to " + path.loop);
    else if (path.cut) parts.push((via.length ? "then " : "") + path.cut + (path.cut === 1 ? " hop" : " hops") + " on the internet");
    return parts.join(" · ");
  }

  // The ticked routers and links made, and each row's route for its flows.
  // `env`: {doc(), add(kind, label) → id, link(kind, from, to, extra),
  // net(n) → the network an id or "new" stands for, hostOf: {rowKey: id},
  // ticked(router) → boolean, seen: the day or null}.
  function apply(p, env) {
    var boxOf = Object.create(null), routerOf = Object.create(null), netOf = Object.create(null), made = { routers: [], networks: [] };
    function isAttached(machine, net) {
      return attachedTo(env.doc(), machine).indexOf(net) >= 0;
    }
    function attach(key, net) {
      [boxOf[key], routerOf[key]].forEach(function (m) {
        if (!isAttached(m, net)) env.link("attached", m, net);
      });
    }
    (p.routers || []).forEach(function (r) {
      if (!env.ticked(r)) return;
      var box = r.row ? env.hostOf[r.row] : r.known;
      if (r.row && !box) return;
      if (!box) {
        box = env.add("host", r.label);
        env.doc().entities[box].addresses = [r.address];
        if (env.seen) env.doc().entities[box].seen = env.seen;
      }
      var router = routerOn(env.doc(), box);
      if (!router) {
        router = env.add("router", env.doc().entities[box].label + " router");
        env.link("hosts", box, router, { privilege: "admin" });
        attachedTo(env.doc(), box).forEach(function (n) { env.link("attached", router, n); });
        made.routers.push(router);
      }
      boxOf[r.key] = box;
      routerOf[r.key] = router;
    });
    (p.links || []).forEach(function (l) {
      if (!routerOf[l.from] || !routerOf[l.to]) return;
      var net = l.network ? env.net(l.network) : null;
      if (!net && !l.network) {
        var mine = attachedTo(env.doc(), routerOf[l.from]);
        net = attachedTo(env.doc(), routerOf[l.to]).filter(function (n) { return mine.indexOf(n) >= 0; })[0];
        if (!net) {
          net = env.add("network", l.label);
          made.networks.push(net);
        }
      }
      if (!net) return;
      attach(l.from, net);
      attach(l.to, net);
      netOf[l.key] = net;
    });
    var routesOf = {};
    Object.keys(p.paths || {}).forEach(function (rowKey) {
      var path = p.paths[rowKey], n = path.hops.length;
      if (!n || path.cut || path.loop) return;
      var first = path.first ? env.net(path.first) : null, last = path.last ? env.net(path.last) : null;
      if (!first || !last || path.hops.some(function (k) { return !routerOf[k]; })) return;
      var route = [first];
      for (var i = 0; i < n; i++) {
        route.push(routerOf[path.hops[i]]);
        if (i + 1 < n) {
          var net = netOf["l:" + path.hops[i] + "|" + path.hops[i + 1]];
          if (!net) return;
          route.push(net);
        }
      }
      route.push(last);
      attach(path.hops[0], first);
      attach(path.hops[n - 1], last);
      routesOf[rowKey] = route;
    });
    return { routes: routesOf, made: made };
  }

  var api = { routes: routes, routeSaid: said, applyRoutes: apply };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapRoute = api;
})();
