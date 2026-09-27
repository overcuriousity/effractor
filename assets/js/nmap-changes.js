// What a rescan says changed since the drawing, and the firewalls'
// permissions checked against what got through (nmap recipes spec §5). Each
// change is a line in plain words with an action that is done only when
// ticked. Pure.
(function () {
  var node = typeof module !== "undefined";
  var L = node ? require("./architecture-links.js") : window.effractorArchitectureLinks;
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var C = node ? require("./nmap-command.js") : window.effractorNmapCommand;

  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) {
      return { id: k, from: doc.associations[k].from, to: doc.associations[k].to, kind: doc.associations[k].kind, allowed: doc.associations[k].allowed };
    }).filter(function (a) { return a.kind === kind; });
  }
  function flows(doc) {
    return Object.keys(doc.flows || {}).map(function (k) { return Object.assign({ id: k }, doc.flows[k]); });
  }
  function name(doc, id) {
    var e = doc.entities[id];
    return "“" + (e && e.label != null ? e.label : id) + "”";
  }
  function hostOf(doc, software) {
    var a = links(doc, "hosts").filter(function (x) { return x.to === software; })[0];
    return a ? a.from : null;
  }
  function attachedTo(doc, machine) {
    return links(doc, "attached").filter(function (a) { return a.from === machine; }).map(function (a) { return a.to; });
  }
  function firewallOf(doc, router) {
    var a = links(doc, "filters").filter(function (x) { return x.from === router; })[0];
    return a && doc.entities[a.to] ? a.to : null;
  }
  // The firewalls a route crosses, each with its router, in order.
  function firewallsOn(doc, route) {
    return (route || []).map(function (id) {
      var fw = doc.entities[id] && doc.entities[id].kind === "router" ? firewallOf(doc, id) : null;
      return fw ? { router: id, firewall: fw } : null;
    }).filter(Boolean);
  }
  function portOf(protocol) {
    var m = /^(tcp|udp|sctp)\/(\d{1,5})$/.exec(String(protocol || ""));
    return m ? { proto: m[1], port: Number(m[2]) } : null;
  }
  function covered(doc, host, targets) {
    return ((doc.entities[host] || {}).addresses || []).some(function (a) { return Ad.covers(targets, a); });
  }

  // Spec §2.3: the ports of the flows drawn through a firewall to a host
  // in the range, for the firewall recipe to test.
  function drawnPorts(doc, appId, range) {
    var out = [];
    flows(doc).forEach(function (f) {
      var host = hostOf(doc, f.target);
      if (!portOf(f.protocol) || !host || !firewallsOn(doc, f.route).length || !covered(doc, host, range)) return;
      if (out.indexOf(f.protocol) < 0) out.push(f.protocol);
    });
    return out;
  }

  // Whether a flow starts where nmap stands: from software on nmap's host,
  // or on a host that is on the flow's first network with nmap's host.
  function fromHere(doc, flow, appHost) {
    var src = hostOf(doc, flow.source);
    if (!appHost || !src) return false;
    if (src === appHost) return true;
    var first = (flow.route || [])[0];
    return !!first && attachedTo(doc, src).indexOf(first) >= 0 && attachedTo(doc, appHost).indexOf(first) >= 0;
  }
  // Author's work on a product: a note of its own, a time, a switch set.
  function untouched(e) {
    if (e.description) return false;
    if (e.defenses && Object.keys(e.defenses).some(function (k) { return e.defenses[k] === true; })) return false;
    return Object.keys(e.parameters || {}).every(function (k) {
      var p = e.parameters[k];
      var own = String(p.note || "").split("\n").filter(function (l) { return l && !/^(nmap |Greenbone: )/.test(l); });
      return (p.status == null || p.status === "unknown") && p.ttc == null && !own.length;
    });
  }
  function listed(ports, most) {
    return ports.slice(0, most).join(", ") + (ports.length > most ? " (+" + (ports.length - most) + " more)" : "");
  }

  // `rows`: the planned hosts, each with `scan` (its scanned host) beside
  // it in `scanOf`; `way`: {routers, links, paths}. Returns {since, list,
  // notes}; every item {key, kind, host, line, action, warn?, …}.
  function changes(doc, appId, scan, rows, scanOf, way, appHost) {
    var out = { since: null, list: [], notes: [] };
    var args = String(scan.args || "");
    // A list scan sends nothing; an ACK scan says nothing of open or closed.
    if (/ -sL /.test(" " + args + " ")) return out;
    var types = scan.types || [];
    var ackOnly = types.length > 0 && types.every(function (t) { return t === "ack"; });
    var targets = C.targetsOf(scan);
    var date = scan.date || null;
    var firewallRan = C.recipesOf(args).indexOf("firewall") >= 0 || ackOnly;
    var routerAt = Object.create(null);
    (way.routers || []).forEach(function (r) { routerAt[r.key] = r; });
    var all = flows(doc);
    function item(x) {
      out.list.push(x);
      return x;
    }

    var matched = Object.create(null);
    rows.forEach(function (h) {
      [h.known, h.merged, h.conflict && h.conflict.host].forEach(function (id) { if (id) matched[id] = true; });
    });
    (way.routers || []).forEach(function (r) { if (r.known) matched[r.known] = true; });

    var firewallLines = Object.create(null);
    rows.forEach(function (h) {
      var target = h.known || h.merged;
      var s = scanOf[h.key];
      if (!target || !s) return;
      var mine = links(doc, "hosts").filter(function (a) { return a.from === target && doc.entities[a.to] && doc.entities[a.to].kind === "service"; }).map(function (a) { return a.to; });
      var path = (way.paths || {})[h.key] || null;

      // ---- the firewalls' permissions (spec §5.3) ----
      if (firewallRan) {
        all.forEach(function (f) {
          var at = portOf(f.protocol);
          var walls = firewallsOn(doc, f.route);
          if (mine.indexOf(f.target) < 0 || !at || !walls.length || !R.probed(scan, at.proto, at.port)) return;
          if (!fromHere(doc, f, appHost)) {
            out.elsewhere = (out.elsewhere || 0) + 1;
            return;
          }
          var state = R.portState(s, scan, at.proto, at.port);
          var what = f.protocol + " to " + name(doc, f.target) + " on " + name(doc, target);
          if (ackOnly) {
            if (state === "unfiltered") item({ key: "ack:" + f.id, kind: "said", host: target, line: what + ": an ACK gets through, so no firewall on the way keeps state for it" });
            if (state === "filtered") item({ key: "ack:" + f.id, kind: "said", host: target, line: what + ": an ACK is dropped, so a firewall on the way keeps state or blocks it" });
            return;
          }
          var through = state === "open" || state === "closed";
          if (!through && state !== "filtered") return;
          firewallLines[f.id] = true;
          if (!through && walls.length > 1) {
            item({ key: "blocked:" + f.id, kind: "said", host: target, line: what + " is blocked on the way; the scan cannot tell by which of " + walls.length + " firewalls" });
            return;
          }
          walls.forEach(function (w) {
            var permit = links(doc, "permits").filter(function (a) { return a.from === w.firewall && a.to === f.id; })[0] || null;
            var allowed = permit ? permit.allowed : null;
            var on = "the firewall on " + name(doc, w.router);
            var base = { key: "permit:" + w.firewall + ":" + f.id, kind: "permit", host: target, firewall: w.firewall, flow: f.id, association: permit ? permit.id : null, allowed: through };
            if (allowed === true && !through) item(Object.assign(base, { line: on + " blocks " + what, action: "set the permission to denied" }));
            else if (allowed === false && through) item(Object.assign(base, { warn: true, line: on + " lets " + what + " through", action: "set the permission to allowed" }));
            else if (allowed !== true && allowed !== false) item(Object.assign(base, { line: on + " has no permission for " + what + "; the scan says it is " + (through ? "let through" : "blocked"), action: "give it that permission" }));
          });
        });
      }
      if (ackOnly) return;

      // ---- a drawn service whose port is closed now (spec §5.2) ----
      mine.forEach(function (service) {
        var seen = [];
        all.forEach(function (f) {
          var at = portOf(f.protocol);
          if (f.target !== service || !at || seen.indexOf(f.protocol) >= 0) return;
          seen.push(f.protocol);
          if (!R.probed(scan, at.proto, at.port)) return;
          var state = R.portState(s, scan, at.proto, at.port);
          if (state !== "closed" && state !== "filtered") return;
          // A port a firewall on the way blocks is said by the firewall.
          if (state === "filtered" && all.some(function (x) { return x.target === service && firewallLines[x.id]; })) return;
          item({ key: "closed:" + service + ":" + f.protocol, kind: "closed", host: target, service: service, line: f.protocol + " on " + name(doc, target) + " is " + state + " now (" + name(doc, service) + ")", action: "remove the service" });
        });
      });

      // ---- a product in another version ----
      // Only nmap names products the way the drawing's came to be named.
      if ((scan.tool || "nmap") === "nmap") h.ports.forEach(function (r) {
        if (!r.known || !r.product.identified) return;
        var of = links(doc, "instance-of").filter(function (a) { return a.from === r.known; })[0];
        if (!of || !doc.entities[of.to] || doc.entities[of.to].label === r.product.label) return;
        item({ key: "version:" + r.known, kind: "version", host: target, service: r.known, association: of.id, from: of.to, to: r.product.label, existing: r.product.existing, line: r.label + " on " + name(doc, target) + ": " + doc.entities[of.to].label + " → " + r.product.label, action: "make it the product of the service" });
      });

      // ---- another way to it ----
      if (path && path.hops.length && !path.cut) {
        var drawn = path.hops.map(function (k) { return routerAt[k].router; });
        var toIt = all.filter(function (f) { return f.source === appId && mine.indexOf(f.target) >= 0; });
        var off = toIt.filter(function (f) {
          var routers = (f.route || []).filter(function (id) { return doc.entities[id] && doc.entities[id].kind === "router"; });
          return routers.length !== drawn.length || drawn.some(function (id, i) { return !id || routers[i] !== id; });
        });
        if (off.length) {
          var old = off[0].route || [];
          var fresh = path.hops.filter(function (k) { return !routerAt[k].router || old.indexOf(routerAt[k].router) < 0; }).map(function (k) { return routerAt[k].label; });
          item({ key: "route:" + h.key, kind: "route", host: target, row: h.key, flows: off.map(function (f) { return f.id; }), line: "the way to " + name(doc, target) + (old.length ? " now crosses " : " crosses ") + fresh.join(", "), action: "route nmap's flows to it that way" });
        }
      }

      // ---- what is blocked with nothing drawn to say it on (spec §5.3) ----
      if (firewallRan) {
        var drawnProtos = all.filter(function (f) { return mine.indexOf(f.target) >= 0; }).map(function (f) { return f.protocol; });
        var shut = s.ports.filter(function (p) { return p.state === "filtered" && drawnProtos.indexOf(p.protocol + "/" + p.port) < 0; }).map(function (p) { return p.protocol + "/" + p.port; });
        var crossed = path ? path.hops.filter(function (k) { return routerAt[k].router && firewallOf(doc, routerAt[k].router); }) : [];
        if (shut.length && crossed.length) item({ key: "shut:" + h.key, kind: "said", host: target, line: "blocked on the way to " + name(doc, target) + ": " + listed(shut, 6) + " · nothing drawn to say it on" });
        else if (shut.length && path && !path.hops.length && !path.cut) item({ key: "shut:" + h.key, kind: "said", host: target, line: "filtered by " + name(doc, target) + " itself: " + listed(shut, 6) });
      }
    });

    // ---- an opening nobody drew (spec §5.3) ----
    if (firewallRan && !ackOnly) {
      rows.forEach(function (h) {
        var path = (way.paths || {})[h.key];
        if (!path || path.cut) return;
        var walls = path.hops.map(function (k) { return routerAt[k].router; }).filter(function (id) { return id && firewallOf(doc, id); });
        if (!walls.length) return;
        h.ports.forEach(function (r) {
          if (!r.addsFlow) return;
          var label = h.known || h.merged ? name(doc, h.known || h.merged) : "“" + h.label + "”";
          item({ key: "opening:" + r.key, kind: "opening", host: h.known || h.merged || null, row: h.key, port: r.key, proto: r.proto, firewalls: walls.map(function (id) { return firewallOf(doc, id); }), line: "unplanned opening: " + r.proto + " on " + label + " through " + walls.map(function (id) { return name(doc, id); }).join(", "), action: "allow the flow it adds on " + (walls.length === 1 ? "that firewall" : "those firewalls") });
        });
      });
    }
    if (ackOnly) return out;

    // ---- a drawn host the scan looked at that did not answer ----
    var latest = null;
    Object.keys(doc.entities || {}).forEach(function (id) {
      var e = doc.entities[id];
      if (e.kind !== "host" || !covered(doc, id, targets)) return;
      if (e.seen && (!latest || e.seen > latest)) latest = e.seen;
      if (matched[id] || id === appHost || e.missed || !date) return;
      item({ key: "missed:" + id, kind: "missed", host: id, line: name(doc, id) + " did not answer" + (e.seen ? " (seen " + e.seen + ")" : ""), action: "mark it as not seen since " + date });
    });
    out.since = latest;
    if (out.elsewhere) out.notes.push(out.elsewhere + (out.elsewhere === 1 ? " flow" : " flows") + " through a firewall " + (out.elsewhere === 1 ? "starts" : "start") + " elsewhere; from where nmap stands the scan cannot tell about " + (out.elsewhere === 1 ? "it" : "them") + ".");
    delete out.elsewhere;
    return out;
  }

  function ticked(p, ticks, kinds) {
    return ((p.changes && p.changes.list) || []).filter(function (c) {
      return c.action && kinds.indexOf(c.kind) >= 0 && ticks.changes && ticks.changes[c.key] === true;
    });
  }
  function counted(p, ticks) {
    return ticked(p, ticks, ["closed", "version", "missed", "route", "permit", "opening"]).length;
  }

  // Before the hosts are gone through: what is removed, marked, or made
  // another product. `env`: {doc(), step(edit), soft(edit), add(kind,
  // label) → id, products: {label: id} made by this import}.
  function applyBefore(p, ticks, env) {
    ticked(p, ticks, ["closed"]).forEach(function (c) {
      if (env.doc().entities[c.service]) env.step(L.remove(env.doc(), "entities", c.service));
    });
    ticked(p, ticks, ["missed"]).forEach(function (c) {
      if (env.doc().entities[c.host] && p.date) env.doc().entities[c.host].missed = p.date;
    });
    ticked(p, ticks, ["version"]).forEach(function (c) {
      var doc = env.doc();
      if (!doc.entities[c.service] || !doc.associations[c.association]) return;
      var product = (c.existing && doc.entities[c.existing] ? c.existing : null) || env.products[c.to];
      if (!product) product = env.products[c.to] = env.add("product", c.to);
      env.step(L.putAssociation(env.doc(), c.association, { kind: "instance-of", from: c.service, to: product }));
      // The old one goes when nothing is an instance of it and its author
      // set nothing on it.
      var old = env.doc().entities[c.from];
      var used = links(env.doc(), "instance-of").some(function (a) { return a.to === c.from; });
      if (old && !used && untouched(old)) env.step(L.remove(env.doc(), "entities", c.from));
    });
  }

  // After the routes are drawn and the flows added. `routes`: {rowKey:
  // route}; `flowOf`: {portKey: the flow this import added for it}.
  function applyAfter(p, ticks, env, routes, flowOf, ends) {
    ticked(p, ticks, ["route"]).forEach(function (c) {
      var route = routes[c.row];
      if (!route || !ends(c.row, route)) return;
      c.flows.forEach(function (id) {
        var f = env.doc().flows[id];
        if (f) env.soft(L.putFlow(env.doc(), id, { label: f.label, source: f.source, target: f.target, route: route, protocol: f.protocol }));
      });
    });
    ticked(p, ticks, ["permit"]).forEach(function (c) {
      var doc = env.doc();
      if (!doc.flows[c.flow] || !doc.entities[c.firewall]) return;
      var id = c.association && doc.associations[c.association] ? c.association : null;
      env.soft(L.putAssociation(doc, id, { kind: "permits", from: c.firewall, to: c.flow, allowed: c.allowed }));
    });
    ticked(p, ticks, ["opening"]).forEach(function (c) {
      var flow = flowOf[c.port];
      var f = flow ? env.doc().flows[flow] : null;
      if (!f) return;
      c.firewalls.forEach(function (fw) {
        // Only where the flow was given the way through that firewall.
        if (!firewallsOn(env.doc(), f.route).some(function (w) { return w.firewall === fw; })) return;
        env.soft(L.putAssociation(env.doc(), null, { kind: "permits", from: fw, to: flow, allowed: true }));
      });
    });
  }

  var api = { drawnPorts: drawnPorts, changes: changes, changesTicked: counted, applyChangesBefore: applyBefore, applyChangesAfter: applyAfter };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapChanges = api;
})();
