// How what is drawn connects (nuclei templates spec §6): logins, single
// sign-on, management pages and what a name points to, planned against
// the document as rows to tick and applied with the import. Every row is
// unticked at first but a name kept on the host it points to, which was
// seen. Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;
  var T = node ? require("./nuclei-templates.js") : window.effractorNucleiTemplates;
  var has = R.has;

  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  function linked(doc, kind, from, to) {
    return links(doc, kind).some(function (a) { return a.from === from && a.to === to; });
  }
  function labelOf(doc, id) {
    return doc.entities[id] ? doc.entities[id].label : id;
  }
  function productOf(doc, service) {
    var a = links(doc, "instance-of").filter(function (x) { return x.from === service; })[0];
    return a && doc.entities[a.to] ? a.to : null;
  }
  // The router a host runs, which is what is administered then.
  function routerOn(doc, host) {
    var a = links(doc, "hosts").filter(function (x) { return x.from === host && doc.entities[x.to] && doc.entities[x.to].kind === "router"; })[0];
    return a ? a.to : null;
  }
  function attached(doc, machine) {
    return links(doc, "attached").filter(function (a) { return a.from === machine; }).map(function (a) { return a.to; });
  }
  // The service a flow reaches on a host at a port, as the plan knows it.
  function serviceAt(doc, host, proto) {
    var hosted = Object.create(null), found = null;
    links(doc, "hosts").forEach(function (a) {
      if (a.from === host && doc.entities[a.to] && doc.entities[a.to].kind === "service") hosted[a.to] = true;
    });
    Object.keys(doc.flows || {}).forEach(function (k) {
      var f = doc.flows[k];
      if (!found && f.protocol === proto && hosted[f.target] === true) found = f.target;
    });
    return found;
  }
  function accountNamed(doc, label) {
    var want = label.toLowerCase();
    return Object.keys(doc.entities || {}).filter(function (id) {
      return doc.entities[id].kind === "account" && String(doc.entities[id].label).toLowerCase() === want;
    })[0] || null;
  }
  // The drawn host a name is: by its label, or by a name it keeps.
  function hostNamed(doc, name) {
    var found = Object.keys(doc.entities || {}).filter(function (id) {
      var e = doc.entities[id];
      return e.kind === "host" && (String(e.label).trim().toLowerCase() === name || (e.names || []).indexOf(name) >= 0);
    });
    return found.length === 1 ? found[0] : null;
  }
  // The service of a sign-on on its host: the one on tcp/443, else one
  // that is an instance of the sign-on's product.
  function signOnService(doc, host, product) {
    return serviceAt(doc, host, "tcp/443") || links(doc, "hosts").filter(function (x) {
      return x.from === host && doc.entities[x.to] && doc.entities[x.to].kind === "service" && product && productOf(doc, x.to) && P.parts(doc.entities[productOf(doc, x.to)].label).name === product.toLowerCase();
    }).map(function (x) { return x.to; })[0] || null;
  }
  // Whether what a row hangs on is drawn or will be. `there`: {hosts,
  // ports, apps}, each by row key; without it every row is taken to hang.
  function hangs(c, there) {
    if (!there) return true;
    function at(x) {
      return !!x && (!!x.id || !!there.hosts[x.row]);
    }
    if (c.kind === "host") return true;
    if (c.kind === "name") return at(c.to);
    if (c.kind === "pass-on") return at(c.from) && at(c.to) && !(c.to.row && there.ports[c.to.row + "/" + c.proto] === false);
    if (c.host && !there.hosts[c.host]) return false;
    if (c.port && !there.ports[c.port]) return false;
    return !(c.on === "application" && !there.apps[c.port]);
  }
  // Whether a product is a management page (spec §6.3), by its name.
  function manages(label) {
    var a = label == null ? null : T.application(P.parts(label).name);
    return !!a && !!a.manages;
  }

  // `hosts`: the plan's host rows; `scanOf`: each row's scanned host;
  // `appHost`: the host the scanner runs on. Returns {list, notes}; every
  // item {key, kind, line, what, ticked, can, why?, …}.
  function plan(doc, scan, hosts, scanOf, appHost) {
    var out = { list: [], notes: [] };
    if (scan.tool !== "nuclei") return out;
    function item(x) {
      if (!out.list.some(function (o) { return o.key === x.key; })) out.list.push(Object.assign({ ticked: false, can: true }, x));
    }
    var nets = appHost ? attached(doc, appHost) : [];
    // A login's account is its service's own: nothing was seen that says
    // two machines share their accounts. A label that is taken, drawn or
    // by a row before, is said with the host.
    var taken = Object.create(null);
    Object.keys(doc.entities || {}).forEach(function (id) {
      if (doc.entities[id].kind === "account") taken[String(doc.entities[id].label).toLowerCase()] = true;
    });
    function own(label, host) {
      var l = taken[label.toLowerCase()] ? label + " on " + host : label;
      taken[l.toLowerCase()] = true;
      return l;
    }
    var byAddress = Object.create(null);
    Object.keys(doc.entities || {}).forEach(function (id) {
      if (doc.entities[id].kind !== "host") return;
      (doc.entities[id].addresses || []).forEach(function (a) { byAddress[Ad.addressKey(a)] = byAddress[Ad.addressKey(a)] || id; });
    });

    hosts.forEach(function (h) {
      var target = h.known || h.merged;
      var administered = false;
      h.ports.forEach(function (r) {
        // What logs in is the application where there is one.
        var on = r.application ? "application" : "service";
        var service = on === "application" ? r.application.known : r.known;
        var product = on === "application" ? r.application.product.label : r.product.identified ? r.product.label : null;
        var drawn = service ? productOf(doc, service) : null;
        // What logs in, by its name: the application, else the port.
        var known = on === "application" ? r.application.label : product ? (T.application(P.parts(product).name) || {}).product || null : null;
        if (!known && drawn) known = (T.application(P.parts(doc.entities[drawn].label).name) || {}).product || null;
        var named = known || r.label;
        var accounts = function () { return own(known ? known + " accounts" : "accounts of " + r.label + " on " + h.label, h.label); };
        var account;
        var accepted = service ? links(doc, "authorizes").filter(function (a) { return a.to === service; }).length > 0 : false;
        var page = r.manages || manages(product) || (drawn ? manages(doc.entities[drawn].label) : false);
        var where = { host: h.key, port: r.key, on: on };

        if (page) {
          if (!administered) {
            administered = true;
            var machine = target ? routerOn(doc, target) || target : null;
            var from = nets.filter(function (n) {
              return (doc.entities[n].addresses || []).some(function (c) { return h.addresses.some(function (a) { return Ad.inCidr(a, c); }); });
            })[0] || nets[0] || null;
            if (!(machine && from && linked(doc, "administration", from, machine))) {
              item({ key: "administration:" + h.key, kind: "administration", host: h.key, from: from, can: !!from, why: from ? null : appHost ? "Attach “" + labelOf(doc, appHost) + "” to a network to say where from" : "Put nuclei on a host to say where from", line: named + " on " + h.label + " is a management page", what: from ? "“" + h.label + "” is administered from “" + labelOf(doc, from) + "”" : "administered from the scanner's network" });
            }
          }
          if (!accepted && r.login) {
            account = accounts();
            item(Object.assign({ key: "admin-login:" + r.key, kind: "admin-login", account: account, line: named + " on " + h.label + " has a login", what: "draws “" + account + "”, admin on “" + h.label + "”" }, where));
          }
          return;
        }
        if (!r.login) return;
        if (r.login.sso) {
          var sso = r.login.sso;
          var label = (sso.product || "Sign-on") + " accounts at " + sso.host;
          var shared = accountNamed(doc, label);
          if (!(shared && service && linked(doc, "authorizes", shared, service))) {
            var there = hostNamed(doc, sso.host);
            item(Object.assign({ key: "sso:" + r.key, kind: "sso", account: label, existing: shared, signon: { host: sso.host, product: sso.product, drawn: there, service: there ? signOnService(doc, there, sso.product) : null }, line: named + " on " + h.label + " sends its logins to " + (sso.product ? sso.product + " at " : "") + sso.host, what: (shared ? "joins “" : "draws “") + label + "”" + (there || shared ? "" : " and the host " + sso.host) }, where));
          }
          if (!r.login.password) return;
        }
        if (!accepted) {
          account = accounts();
          item(Object.assign({ key: "login:" + r.key, kind: "login", account: account, line: named + " on " + h.label + " has a login", what: "draws “" + account + "”, which it accepts" }, where));
        }
      });
    });

    // ---- what a name points to (spec §6.4) ----
    var inside = Object.keys(doc.entities || {}).filter(function (id) { return doc.entities[id].kind === "network"; });
    function ours(address) {
      return Ad.isPrivate(address) || inside.some(function (n) {
        return (doc.entities[n].addresses || []).some(function (c) { return Ad.inCidr(address, c); });
      });
    }
    (scan.points || []).forEach(function (x) {
      if (!x.address) return out.notes.push(x.name + " points " + (x.alias ? "to " + x.alias + ", which has no address here." : "nowhere."));
      // Who bears it: a row of this result, or a drawn host that keeps it.
      var bearers = [];
      hosts.forEach(function (h) {
        var keeps = h.names.indexOf(x.name) >= 0 || ((h.known || h.merged) && (doc.entities[h.known || h.merged].names || []).indexOf(x.name) >= 0);
        if (keeps) bearers.push({ row: h.key, id: h.known || h.merged || null, label: h.label, port: (scanOf[h.key].names.filter(function (n) { return String(n.name).toLowerCase() === x.name && n.port; })[0] || {}).port || null });
      });
      Object.keys(doc.entities || {}).forEach(function (id) {
        var e = doc.entities[id];
        if (e.kind === "host" && (e.names || []).indexOf(x.name) >= 0 && !bearers.some(function (b) { return b.id === id; })) bearers.push({ row: null, id: id, label: e.label, port: null });
      });
      var row = hosts.filter(function (h) { return h.addresses.some(function (a) { return Ad.addressKey(a) === Ad.addressKey(x.address); }); })[0] || null;
      var id = row ? row.known || row.merged || null : byAddress[Ad.addressKey(x.address)] || null;
      var to = row || id ? { row: row ? row.key : null, id: id, label: row ? row.label : labelOf(doc, id) } : null;
      if (to && bearers.some(function (b) { return (b.id && b.id === to.id) || (b.row && b.row === to.row); })) return;
      if (!to) {
        if (!ours(x.address)) return out.notes.push(x.name + " points outside, to " + (x.alias || x.address) + ".");
        // Several names on one address are one host.
        var same = out.list.filter(function (o) { return o.kind === "host" && Ad.addressKey(o.address) === Ad.addressKey(x.address); })[0];
        if (!same) return item({ key: "host:" + x.name, kind: "host", name: x.name, names: [x.name], address: x.address, line: x.name + " points to " + x.address + ", which is not drawn", what: "draws the host" });
        if (same.names.indexOf(x.name) < 0) same.names.push(x.name);
        same.line = same.names.slice(0, -1).join(", ") + " and " + same.names[same.names.length - 1] + " point to " + same.address + ", which is not drawn";
        return;
      }
      var kept = to.id ? (doc.entities[to.id].names || []).indexOf(x.name) >= 0 : false;
      if (!kept) item({ key: "name:" + x.name, kind: "name", ticked: true, name: x.name, to: to, line: x.name + " points to “" + to.label + "” (" + x.address + ")", what: "keeps the name on it" });
      bearers.forEach(function (b) {
        var port = b.port || (b.id && serviceAt(doc, b.id, "tcp/443") ? 443 : null);
        if (!port) return;
        var proto = "tcp/" + port;
        var front = to.id ? serviceAt(doc, to.id, proto) : null, behind = b.id ? serviceAt(doc, b.id, proto) : null;
        var drawn = front && behind && Object.keys(doc.flows || {}).some(function (k) { return doc.flows[k].source === front && doc.flows[k].target === behind; });
        if (drawn) return;
        item({ key: "pass-on:" + x.name + ">" + (b.id || b.row), kind: "pass-on", name: x.name, from: to, to: b, proto: proto, line: "“" + to.label + "” stands in front of “" + b.label + "” for " + x.name + "?", what: "draws the flow from it to " + b.label + " on " + proto });
      });
    });
    return out;
  }

  function defaults(p) {
    var t = {};
    ((p && p.list) || []).forEach(function (c) { t[c.key] = c.ticked && c.can; });
    return t;
  }
  // The rows that are done: ticked, and hanging on what is drawn.
  function ticked(p, ticks, there) {
    return ((p && p.list) || []).filter(function (c) { return c.can && ticks && ticks[c.key] === true && hangs(c, there); });
  }
  // What the ticked rows add at most: {entities, relationships, accounts,
  // hosts, links}.
  function count(p, ticks, there) {
    var s = { entities: 0, relationships: 0, accounts: 0, hosts: 0, links: 0 };
    ticked(p, ticks, there).forEach(function (c) {
      if (c.kind === "login" || c.kind === "admin-login") {
        s.accounts++;
        s.entities++;
        s.relationships += c.kind === "login" ? 1 : 2;
      } else if (c.kind === "sso") {
        // Joining an account that is there is one link.
        if (c.existing) {
          s.links++;
          s.relationships++;
          return;
        }
        s.accounts++;
        s.entities++;
        s.relationships += 2;
        if (!c.signon.drawn) {
          s.hosts++;
          s.entities++;
        }
        if (!c.signon.service) {
          s.entities += 2; // its service, its product
          s.relationships += 2;
        }
      } else if (c.kind === "administration") {
        s.links++;
        s.relationships++;
      } else if (c.kind === "pass-on") {
        s.links++;
        s.entities += 2; // at most: a service in front, its product
        s.relationships += 3;
      } else if (c.kind === "host") {
        s.hosts++;
        s.entities++;
      } else if (c.kind === "name") s.links++;
    });
    return s;
  }

  // `env`: {doc(), add(kind, label), link(kind, from, to, extra), flow(value),
  // product(label), hostOf: {row key: host id}, serviceOf: {port key:
  // service id}, appOf: {port key: application's service id}}. A row whose
  // host or port this import did not draw is left out.
  function apply(p, ticks, env, there) {
    function service(c) {
      return (c.on === "application" ? env.appOf[c.port] : env.serviceOf[c.port]) || null;
    }
    function account(label, existing) {
      var id = existing && env.doc().entities[existing] ? existing : accountNamed(env.doc(), label);
      return id || env.add("account", label);
    }
    function accept(id, by) {
      if (!linked(env.doc(), "authorizes", id, by)) env.link("authorizes", id, by);
    }
    function where(x) {
      return x.id && env.doc().entities[x.id] ? x.id : x.row ? env.hostOf[x.row] || null : null;
    }
    // A service on a host at a port, drawn without a name where there is none.
    function serviceOn(host, proto) {
      var found = serviceAt(env.doc(), host, proto);
      if (found) return found;
      var number = Number(proto.split("/")[1]);
      var label = R.portName("tcp", number) || proto;
      var made = env.add("service", label);
      env.link("hosts", host, made, { privilege: "unknown" });
      env.link("instance-of", made, env.add("product", "unidentified " + label + " on " + labelOf(env.doc(), host)));
      return made;
    }
    ticked(p, ticks, there).forEach(function (c) {
      var doc = env.doc();
      if (c.kind === "login" || c.kind === "admin-login") {
        var s = service(c), host = env.hostOf[c.host];
        if (!s || !host) return;
        var a = env.add("account", c.account);
        accept(a, s);
        var machine = routerOn(env.doc(), host) || host;
        if (c.kind === "admin-login" && !linked(env.doc(), "grants", a, machine)) env.link("grants", a, machine, { privilege: "admin" });
      } else if (c.kind === "sso") {
        var sent = service(c);
        if (!sent) return;
        var had = c.existing || accountNamed(doc, c.account);
        var id = account(c.account, c.existing);
        accept(id, sent);
        if (had) return;
        // The sign-on itself: its host by name, its service, its product.
        var at = hostNamed(env.doc(), c.signon.host);
        if (!at) {
          at = env.add("host", c.signon.host);
          env.doc().entities[at].names = [c.signon.host];
        }
        var on = signOnService(env.doc(), at, c.signon.product);
        if (!on) {
          on = env.add("service", "https");
          env.link("hosts", at, on, { privilege: "unknown" });
          env.link("instance-of", on, c.signon.product ? env.product(c.signon.product) : env.add("product", "unidentified https on " + c.signon.host));
        }
        accept(id, on);
      } else if (c.kind === "administration") {
        var managed = env.hostOf[c.host];
        if (!managed || !c.from || !env.doc().entities[c.from]) return;
        var m = routerOn(env.doc(), managed) || managed;
        if (!linked(env.doc(), "administration", c.from, m)) env.link("administration", c.from, m);
      } else if (c.kind === "name") {
        var keeper = where(c.to);
        if (!keeper) return;
        var e = env.doc().entities[keeper];
        if ((e.names || []).indexOf(c.name) < 0) e.names = (e.names || []).concat([c.name]);
      } else if (c.kind === "host") {
        // Labelled by its address: the name may be another host's label.
        var made = env.add("host", c.address);
        env.doc().entities[made].addresses = [c.address];
        env.doc().entities[made].names = (c.names || [c.name]).slice();
      } else if (c.kind === "pass-on") {
        var front = where(c.from), behind = where(c.to);
        var target = behind ? serviceAt(env.doc(), behind, c.proto) : null;
        if (!front || !target) return;
        var source = serviceOn(front, c.proto);
        var shared = attached(env.doc(), front).filter(function (n) { return attached(env.doc(), behind).indexOf(n) >= 0; });
        env.flow({ label: labelOf(env.doc(), target) + " on " + labelOf(env.doc(), behind) + " behind " + labelOf(env.doc(), front), source: source, target: target, route: shared.length ? [shared[0]] : [], protocol: c.proto });
      }
    });
  }

  var api = { plan: plan, defaults: defaults, ticked: ticked, count: count, apply: apply, hangs: hangs };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapConnect = api;
})();
