// A scan planned against the document, ticked and applied as one edit with
// the contract of architecture-edit.js (the nmap import design §3.4, §4, in
// history; nmap recipes spec §3, §4, §5). Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var A = node ? require("./architecture-edit.js") : window.effractorArchitectureEdit;
  var L = node ? require("./architecture-links.js") : window.effractorArchitectureLinks;
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;
  var R = node ? require("./nmap-read.js") : window.effractorNmapRead;
  var C = node ? require("./nmap-command.js") : window.effractorNmapCommand;
  var has = R.has, oneHost = R.oneHost, addressKey = Ad.addressKey, bytes = Ad.bytes, inCidr = Ad.inCidr, networkOf = Ad.networkOf;
  var targetsOf = C.targetsOf, STAMP = C.STAMP, stampLine = C.stampLine;

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
    return words.length === 1 ? networkOf(words[0]) : null;
  }
  // Spec §4.5: the role nmap's device class suggests, and the class that said so.
  var ROUTERS = ["router", "broadband router", "WAP"];
  function roleOf(device) {
    var classes = device || [];
    if (classes.indexOf("firewall") >= 0) return { role: "firewall", device: "firewall" };
    var r = classes.filter(function (c) { return ROUTERS.indexOf(c) >= 0; })[0];
    if (r) return { role: "router", device: r };
    return { role: "host", device: classes[0] || null };
  }
  function runsRouter(doc, host) {
    return links(doc, "hosts").some(function (a) { return a.from === host && doc.entities[a.to] && doc.entities[a.to].kind === "router"; });
  }

  // The drawn host nmap runs on, named by the scan: "altiera.fritz.box" or
  // "altiera" for a host labelled "altiera".
  function sameName(hostname, label) {
    var n = String(hostname || "").toLowerCase(), l = String(label || "").trim().toLowerCase();
    return !!n && !!l && (n === l || n.split(".")[0] === l);
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
    // Any drawn host no scanned address already names may be one the scan
    // lists: hand-drawn, or known by the other kind of address (an IPv6
    // scan of hosts drawn from an IPv4 one, review 2026-09-26).
    var seenHosts = Object.create(null);
    scan.hosts.forEach(function (h) {
      h.addresses.forEach(function (a) {
        if (byAddress[addressKey(a)]) seenHosts[byAddress[addressKey(a)]] = true;
      });
    });
    var candidates = hosts.filter(function (h) { return !seenHosts[h]; });
    var networks = ids(doc, "network");
    var appHost = hostingOf(doc, appId);
    // The network the scan covered, as nmap says it ran; the range field only
    // when the scan does not name one (an old scan pasted needs no range).
    var cidr = onlyCidr(targetsOf(scan)) || onlyCidr(range);
    var proposed = cidr && !networks.some(function (n) {
      return (doc.entities[n].addresses || []).some(function (c) { return networkOf(c) === cidr; });
    }) ? { label: cidr, addresses: [cidr] } : null;
    // A drawn network without addresses may be the proposed one: it is
    // filled instead of drawn twice. Chosen (merges.network; "" is a chosen
    // "new"), or guessed when nmap's host is on exactly one such network
    // (owner, 2026-09-25), as "nmap runs here?" guesses a host.
    var netCandidates = networks.filter(function (n) { return !(doc.entities[n].addresses || []).length; });
    if (proposed && has(merges, "network")) {
      if (netCandidates.indexOf(merges.network) >= 0) proposed.merged = merges.network;
    } else if (proposed && appHost) {
      var onIt = attachedNetworks(doc, appHost).filter(function (n) { return netCandidates.indexOf(n) >= 0; });
      if (onIt.length === 1) {
        proposed.merged = onIt[0];
        proposed.guessed = true;
      }
    }
    var products = Object.create(null);
    ids(doc, "product").forEach(function (p) { products[doc.entities[p].label] = products[doc.entities[p].label] || p; });

    // Who each scanned host is: known by address, merged as chosen (the
    // first choice of a drawn host wins; "" is a chosen "new"), or else
    // nmap's own host when the scan names it so.
    // Scanned hosts that are one drawn host by address (a machine with an
    // address in each of two scanned networks) are one row, keyed by the
    // first, with every port once.
    var takenBy = Object.create(null), rowOf = Object.create(null);
    var rows = [];
    scan.hosts.forEach(function (h, i) {
      var key = "h" + i;
      var known = null;
      h.addresses.forEach(function (a) { if (!known && byAddress[addressKey(a)]) known = byAddress[addressKey(a)]; });
      if (known && rowOf[known]) return rowOf[known].listings.push(h);
      var merged = !known && candidates.indexOf(merges[key]) >= 0 && !takenBy[merges[key]] ? merges[key] : null;
      if (merged) takenBy[merged] = key;
      var row = { key: key, scan: h, listings: [h], known: known, merged: merged, guessed: false };
      if (known) rowOf[known] = row;
      rows.push(row);
    });
    rows.forEach(function (r) {
      if (r.listings.length > 1) r.scan = oneHost(r.listings);
    });
    // Guessed only while it has no addresses: one it has says where it is.
    if (appHost && candidates.indexOf(appHost) >= 0 && !takenBy[appHost] && !(doc.entities[appHost].addresses || []).length) {
      var own = rows.filter(function (r) {
        return !r.known && !r.merged && !has(merges, r.key) && (r.scan.self || sameName(r.scan.hostname, doc.entities[appHost].label));
      })[0];
      if (own) {
        own.merged = appHost;
        own.guessed = true;
      }
    }

    // Where each one is attached that it is not yet: every network whose
    // range holds one of its addresses, else the proposed one.
    var usedNew = false;
    var into = proposed ? proposed.merged || "new" : null;
    rows.forEach(function (r) {
      var target = r.known || r.merged;
      var have = target ? attachedNetworks(doc, target) : [];
      var nets = networks.filter(function (n) {
        return (doc.entities[n].addresses || []).some(function (c) {
          return r.scan.addresses.some(function (a) { return inCidr(a, c); });
        });
      });
      if (!nets.length && proposed && r.scan.addresses.some(function (a) { return inCidr(a, cidr); })) {
        nets = [into];
        // A drawn one is filled even when everyone in it is attached already.
        if (proposed.merged) usedNew = true;
      }
      r.networks = nets.filter(function (n) { return have.indexOf(n) < 0; });
      r.on = have.concat(r.networks);
      if (r.networks.indexOf("new") >= 0) usedNew = true;
    });
    var appNets = appHost ? attachedNetworks(doc, appHost) : [];
    rows.forEach(function (r) {
      if (appHost && (r.known || r.merged) === appHost) appNets = appNets.concat(r.networks);
    });

    var planned = rows.map(function (r) {
      var h = r.scan, target = r.known || r.merged;
      var label = target ? doc.entities[target].label : h.hostname || h.addresses[0];
      var shared = appNets.filter(function (n) { return r.on.indexOf(n) >= 0; });
      var offered = !(target && runsRouter(doc, target));
      var suggested = roleOf(h.device);
      var hostChecks = readScripts(h.scripts);
      var seen = reached(doc, appId, target);
      var ports = h.ports.filter(function (p) { return p.state === "open" && !wrapped(p); }).map(function (p) {
        var row = portRow(seen, r.key, label, p, products);
        var own = readScripts(p.scripts);
        row.found = own.found;
        row.unread = own.unread;
        return row;
      });
      var smb = SMB_PORTS.map(function (proto) { return ports.filter(function (x) { return x.proto === proto; })[0]; }).filter(Boolean)[0];
      var unplaced = [];
      if (smb && !(smb.known && !productOfService(doc, smb.known))) smb.found = smb.found.concat(hostChecks.found);
      else unplaced = hostChecks.found;
      ports.forEach(function (row) {
        row.findings = findingsFor(doc, row, row.found);
        delete row.found;
      });
      return {
        key: r.key,
        label: label,
        addresses: h.addresses.slice(),
        os: h.os ? "nmap OS guess: " + h.os.name + " (" + h.os.accuracy + "%)." : null,
        known: r.known,
        merged: r.merged,
        guessed: r.guessed,
        networks: r.networks,
        on: r.on,
        role: offered ? suggested.role : "host",
        roleOffered: offered,
        device: suggested.device,
        route: shared.length ? [shared[0]] : [],
        ports: ports,
        unplaced: unplaced.map(function (f) { return { script: f.script, id: findingId(f.vuln), state: f.vuln.state }; }),
        unread: hostChecks.unread,
      };
    });

    var tcpwrapped = 0;
    rows.forEach(function (r) {
      r.scan.ports.forEach(function (p) { if (p.state === "open" && wrapped(p)) tcpwrapped++; });
    });
    return {
      app: appId,
      tcpwrapped: tcpwrapped,
      appHost: appHost,
      network: usedNew ? proposed : null,
      networkCandidates: usedNew ? netCandidates : [],
      candidates: candidates,
      silentUdp: scan.silentUdp || 0,
      hosts: planned,
    };
  }

  // ---- findings of the checks (spec §4.6) ----

  // Scripts -sV runs by itself (nmap's "version" category): they refine the
  // version already shown, so they are left out.
  var VERSION_SCRIPTS = ["allseeingeye-info", "amqp-info", "bacnet-info", "cccam-version", "db2-das-info", "docker-version", "drda-info", "enip-info", "fingerprint-strings", "fox-info", "freelancer-info", "http-server-header", "http-trane-info", "https-redirect", "iax2-version", "ike-version", "jdwp-version", "maxdb-info", "mcafee-epo-agent", "mqtt-subscribe", "murmur-version", "ndmp-version", "netbus-version", "omron-info", "openlookup-info", "oracle-tns-version", "ovs-agent-version", "pptp-version", "quake1-info", "quake3-info", "rfc868-time", "rpc-grind", "rpcinfo", "s7-info", "skypev2-version", "snmp-info", "stun-version", "teamspeak2-version", "ubiquiti-discovery", "ventrilo-info", "vmware-version", "wdb-version", "weblogic-t3-info", "xmpp-info"];
  // VULNERABLE, LIKELY VULNERABLE, VULNERABLE (DoS), VULNERABLE (Exploitable)
  var FOUND = /^(LIKELY )?VULNERABLE/;
  // nmap's host checks all talk SMB: the port they used.
  var SMB_PORTS = ["tcp/445", "tcp/139"];

  // What a list of scripts says: findings, and what is shown unread.
  function readScripts(scripts) {
    var out = { found: [], unread: [] };
    (scripts || []).forEach(function (s) {
      if (VERSION_SCRIPTS.indexOf(s.id) >= 0) return;
      if (!s.vulns.length) {
        var first = s.output.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "";
        out.unread.push({ script: s.id, text: "not read" + (first ? " · " + first.slice(0, 80) : "") });
        return;
      }
      var untested = false;
      s.vulns.forEach(function (v) {
        if (FOUND.test(v.state)) out.found.push({ script: s.id, vuln: v });
        else if (/^UNKNOWN/.test(v.state)) untested = true;
      });
      if (untested) out.unread.push({ script: s.id, text: "could not test" });
    });
    return out;
  }
  // The finding's first CVE, else its first id, else nmap's key.
  function findingId(v) {
    var id = v.ids.filter(function (x) { return /^CVE:/.test(x); })[0] || v.ids[0];
    return id ? id.slice(id.indexOf(":") + 1) : v.key;
  }
  function findingLine(script, v) {
    var title = String(v.title).trim();
    var stop = title.search(/\.(\s|$)/);
    if (stop >= 0) title = title.slice(0, stop);
    return "nmap " + script + ": " + v.state + ", " + findingId(v) + (title ? " (" + title + ")" : "") + ".";
  }
  function noteLines(e) {
    var p = e && e.parameters && e.parameters["find-exploit"];
    return p && p.note ? p.note.split("\n") : [];
  }
  function productOfService(doc, service) {
    var a = links(doc, "instance-of").filter(function (x) { return x.from === service; })[0];
    return a && doc.entities[a.to] ? a.to : null;
  }
  // A port's findings, against the product they would mark.
  function findingsFor(doc, row, found) {
    var product = row.known ? productOfService(doc, row.known) : row.product.existing;
    var e = product ? doc.entities[product] : null;
    return found.map(function (f) {
      var line = findingLine(f.script, f.vuln);
      return {
        key: row.key + "/" + f.script + "/" + f.vuln.key,
        script: f.script,
        id: findingId(f.vuln),
        state: f.vuln.state,
        line: line,
        product: product,
        productLabel: e ? e.label : row.product.label,
        patchedByAuthor: !!e && !!e.defenses && e.defenses.patched === true,
        known: !!e && !!e.defenses && e.defenses.patched === false && noteLines(e).indexOf(line) >= 0,
      };
    });
  }

  // nmap's "tcpwrapped": the connection opened and was closed at once, so
  // nothing was identified — not a service to add (spec §4.3).
  function wrapped(p) {
    return !!p.service && p.service.name === "tcpwrapped";
  }

  // What the drawing already has on a host, by protocol: the service a flow
  // reaches there (the first such flow in file order), and which of those
  // this nmap already reaches. Built once per host, not once per port.
  function reached(doc, appId, target) {
    var out = { service: Object.create(null), fromApp: Object.create(null) };
    if (!target) return out;
    var hosted = Object.create(null);
    links(doc, "hosts").forEach(function (a) {
      if (a.from === target && doc.entities[a.to] && doc.entities[a.to].kind === "service") hosted[a.to] = true;
    });
    var flows = Object.keys(doc.flows || {}).map(function (k) { return doc.flows[k]; });
    flows.forEach(function (f) {
      if (hosted[f.target] === true && !has(out.service, f.protocol)) out.service[f.protocol] = f.target;
    });
    flows.forEach(function (f) {
      if (f.source === appId && has(out.service, f.protocol) && out.service[f.protocol] === f.target) out.fromApp[f.protocol] = true;
    });
    return out;
  }

  function portRow(seen, hostKey, hostLabel, p, products) {
    var proto = p.protocol + "/" + p.port;
    var s = p.service || {};
    var label = s.name || proto;
    var known = has(seen.service, proto) ? seen.service[proto] : null;
    var addsFlow = !(known && seen.fromApp[proto]);
    var product = s.product
      ? { label: s.product + (s.version ? " " + s.version : ""), existing: null, identified: true }
      : { label: "unidentified " + label + " on " + hostLabel, existing: null, identified: false };
    if (product.identified && products[product.label]) product.existing = products[product.label];
    return { key: hostKey + "/" + proto, proto: proto, label: label, product: product, known: known, addsFlow: addsFlow };
  }

  function defaults(p) {
    var t = { hosts: {}, ports: {}, roles: {}, findings: {}, network: true };
    p.hosts.forEach(function (h) {
      t.hosts[h.key] = true;
      t.roles[h.key] = h.role;
      h.ports.forEach(function (r) {
        if (!r.known || r.addsFlow) t.ports[r.key] = true;
        r.findings.forEach(function (f) { t.findings[f.key] = !f.known && !f.patchedByAuthor; });
      });
    });
    return t;
  }

  function roleChosen(h, ticks) {
    var role = ticks.roles && has(ticks.roles, h.key) ? ticks.roles[h.key] : "host";
    return h.roleOffered && (role === "router" || role === "firewall") ? role : "host";
  }

  // What the ticked rows add, and whether the result stays in the limits.
  // A new host whose only network is an unticked proposed one is added
  // unattached, as apply does.
  // The findings that mark a product: ticked, new, on a port that is there.
  function marking(r, ticks) {
    if (!r.known && !ticks.ports[r.key]) return [];
    return r.findings.filter(function (f) { return ticks.findings && ticks.findings[f.key] && !f.known && !f.patchedByAuthor; });
  }
  function markKey(r, f) {
    return f.product ? "id:" + f.product : r.product.identified ? "new:" + r.product.label : "port:" + r.key;
  }

  function summary(doc, p, ticks, limits) {
    var s = { hosts: 0, filled: 0, filledNetworks: 0, networks: 0, attached: 0, routers: 0, firewalls: 0, services: 0, products: 0, flows: 0, unpatched: 0 };
    var rel = 0, newProducts = Object.create(null), marked = Object.create(null);
    var network = !!(p.network && ticks.network);
    // The proposed network as the rows name it: "new", or the drawn one chosen.
    var proposed = p.network ? p.network.merged || "new" : null;
    if (network && p.network.merged) s.filledNetworks = 1;
    var ticked = 0;
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      ticked++;
      var added = !h.known && !h.merged;
      if (added) s.hosts++;
      // A merge writes the scanned addresses into the drawn host.
      if (h.merged) s.filled++;
      h.networks.forEach(function (n) {
        if (n === proposed && !network) return;
        rel++;
        if (n === "new") s.networks = 1;
        if (!added) s.attached++;
      });
      var role = roleChosen(h, ticks);
      if (role !== "host") {
        s.routers++;
        // hosts, and one attachment per network the box is on afterwards
        rel += 1 + h.on.filter(function (n) { return n !== proposed || network; }).length;
        if (role === "firewall") {
          s.firewalls++;
          rel++; // filters
        }
      }
      h.ports.forEach(function (r) {
        marking(r, ticks).forEach(function (f) { marked[markKey(r, f)] = true; });
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
    s.unpatched = Object.keys(marked).length;
    s.entities = Object.keys(doc.entities || {}).length + s.hosts + s.networks + s.routers + s.firewalls + s.services + s.products;
    s.relationships = Object.keys(doc.associations || {}).length + Object.keys(doc.flows || {}).length + rel;
    s.tooMany = null;
    // Many hosts: fewer, or a smaller range; one host: its ports.
    var fix = ticked > 1 ? " Untick some hosts, or scan a smaller range." : " Untick some ports.";
    if (limits && s.entities > limits.entities) s.tooMany = "That makes " + s.entities + " components; the limit is " + limits.entities + "." + fix;
    else if (limits && s.relationships > limits.relationships) s.tooMany = "That makes " + s.relationships + " links and flows; the limit is " + limits.relationships + "." + fix;
    return s;
  }

  // The summary in words: "Adds 4 hosts, 11 services, marks 2 products
  // unpatched."; a merge counts, as it writes the drawn host's addresses.
  function said(s) {
    function n(k, one) {
      return k + " " + one + (k === 1 ? "" : "s");
    }
    var parts = [[s.hosts, "host"], [s.networks, "network"], [s.attached, "attachment"], [s.routers, "router"], [s.firewalls, "firewall"], [s.services, "service"], [s.products, "product"], [s.flows, "flow"]].filter(function (x) { return x[0]; }).map(function (x) {
      return n(x[0], x[1]);
    });
    if (s.filled) parts.push("addresses for " + n(s.filled, "drawn host"));
    if (s.filledNetworks) parts.push("addresses for " + n(s.filledNetworks, "drawn network"));
    var marks = s.unpatched ? "marks " + n(s.unpatched, "product") + " unpatched" : "";
    if (parts.length) return "Adds " + parts.join(", ") + (marks ? ", " + marks : "") + ".";
    return marks ? marks[0].toUpperCase() + marks.slice(1) + "." : "Nothing new to add.";
  }

  // Ticking a host ticks what it offers: its new ports, the flows its known
  // ports lack, their findings; unticking takes them all along.
  function tickHost(h, ticks, on) {
    ticks.hosts[h.key] = on;
    h.ports.forEach(function (r) {
      ticks.ports[r.key] = on && (!r.known || r.addsFlow);
      r.findings.forEach(function (f) { ticks.findings[f.key] = on && !f.known && !f.patchedByAuthor; });
    });
    return ticks;
  }
  function tickHosts(p, ticks, on) {
    p.hosts.forEach(function (h) { tickHost(h, ticks, on); });
    return ticks;
  }

  // `specOf(kind)`: the catalog entry of a kind, for its parameter slots.
  function apply(doc, p, ticks, specOf, stamp) {
    var s = summary(doc, p, ticks, null);
    var merging = p.hosts.some(function (h) { return ticks.hosts[h.key] && h.merged; });
    if (!s.hosts && !s.services && !s.flows && !s.networks && !s.filledNetworks && !s.attached && !s.routers && !s.unpatched && !merging) return null;
    var next = JSON.parse(JSON.stringify(doc));
    function step(edit) {
      if (!edit) throw new Error("the nmap import could not be applied");
      next = edit.doc;
      return edit;
    }
    function link(kind, from, to, extra) {
      step(L.putAssociation(next, null, Object.assign({ kind: kind, from: from, to: to }, extra || {})));
    }
    var network = null;
    if (s.networks) {
      network = step(A.addEntity(next, "network", p.network.label, specOf("network"))).entity;
      next.entities[network].addresses = p.network.addresses.slice();
    } else if (s.filledNetworks) {
      network = p.network.merged;
      next.entities[network].addresses = p.network.addresses.slice();
    }
    var skipped = p.network && p.network.merged && !s.filledNetworks ? p.network.merged : null;
    var madeProducts = Object.create(null);
    var flows = [], marks = [];
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      var host = h.known || h.merged;
      if (!host) {
        host = step(A.addEntity(next, "host", h.label, specOf("host"))).entity;
        next.entities[host].addresses = h.addresses.slice();
        if (h.os) next.entities[host].description = h.os;
      } else if (h.merged) {
        // Added to what it had, each address once.
        var had = next.entities[host].addresses || [];
        var keys = had.map(addressKey);
        next.entities[host].addresses = had.concat(h.addresses.filter(function (a) { return keys.indexOf(addressKey(a)) < 0; }));
      }
      h.networks.forEach(function (n) {
        var to = n === "new" ? network : n === skipped ? null : n;
        if (to) link("attached", host, to);
      });
      var role = roleChosen(h, ticks);
      if (role !== "host") {
        // The router on its box (an appliance), on every network the box is on.
        var router = step(A.addEntity(next, "router", h.label + " router", specOf("router"))).entity;
        link("hosts", host, router, { privilege: "admin" });
        links(next, "attached").filter(function (a) { return a.from === host; }).forEach(function (a) {
          link("attached", router, a.to);
        });
        if (role === "firewall") {
          var firewall = step(A.addEntity(next, "firewall", h.label + " firewall", specOf("firewall"))).entity;
          link("filters", router, firewall);
        }
      }
      h.ports.forEach(function (r) {
        // A known port with nothing to add is unticked, and its product still
        // takes the finding.
        if (!ticks.ports[r.key]) {
          if (r.known) marking(r, ticks).forEach(function (f) { marks.push({ product: productOfService(next, r.known), line: f.line }); });
          return;
        }
        var service = r.known;
        if (!service) {
          service = step(A.addEntity(next, "service", r.label, specOf("service"))).entity;
          // nmap cannot see the account it runs as: unknown, not a guess.
          link("hosts", host, service, { privilege: "unknown" });
          var product = r.product.existing || madeProducts[r.product.label];
          if (!product) {
            product = step(A.addEntity(next, "product", r.product.label, specOf("product"))).entity;
            if (r.product.identified) madeProducts[r.product.label] = product;
          }
          link("instance-of", service, product);
        }
        marking(r, ticks).forEach(function (f) { marks.push({ product: productOfService(next, service), line: f.line }); });
        if (r.addsFlow) flows.push({ label: r.label + " on " + h.label, target: service, host: host, route: h.route, protocol: r.proto });
      });
    });
    // After every attachment: a route is kept only where both ends are now
    // on its network (nmap's host may have been left unticked).
    flows.forEach(function (f) {
      var net = f.route[0] === "new" ? network : f.route[0];
      var ok = net && p.appHost && isAttached(next, p.appHost, net) && isAttached(next, f.host, net);
      step(L.putFlow(next, null, { label: f.label, source: p.app, target: f.target, route: ok ? [net] : [], protocol: f.protocol }));
    });
    // A finding marks its product unpatched and says why; its time stays as
    // it is. The author's "patched" stands.
    marks.forEach(function (m) {
      var e = m.product && next.entities[m.product];
      if (!e || (e.defenses && e.defenses.patched === true)) return;
      e.defenses = e.defenses || {};
      e.defenses.patched = false;
      e.parameters = e.parameters || {};
      var fe = e.parameters["find-exploit"] = e.parameters["find-exploit"] || { status: "unknown" };
      var lines = noteLines(e);
      if (lines.indexOf(m.line) < 0) fe.note = lines.concat([m.line]).join("\n");
    });
    var old = next.entities[p.app].description || "";
    var line = stampLine(stamp);
    var described = A.setDescription(next, p.app, STAMP.test(old) ? old.replace(STAMP, line) : (old ? old + "\n" : "") + line);
    if (described) next = described.doc;
    return { doc: next, select: "entity/" + p.app };
  }

  function isAttached(doc, machine, net) {
    return links(doc, "attached").some(function (a) { return a.from === machine && a.to === net; });
  }
  var api = { plan: plan, defaults: defaults, summary: summary, said: said, tickHost: tickHost, tickHosts: tickHosts, apply: apply };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapPlan = api;
})();
