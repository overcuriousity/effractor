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
  var Rt = node ? require("./nmap-route.js") : window.effractorNmapRoute;
  var Ch = node ? require("./nmap-changes.js") : window.effractorNmapChanges;
  var P = node ? require("./nmap-products.js") : window.effractorNmapProducts;
  var Cn = node ? require("./nmap-connect.js") : window.effractorNmapConnect;
  var St = node ? require("./scan-targets.js") : window.effractorScanTargets;
  var Dv = node ? require("./nmap-devices.js") : window.effractorNmapDevices;
  var has = R.has, oneHost = R.oneHost, addressKey = Ad.addressKey, bytes = Ad.bytes, inCidr = Ad.inCidr, networkOf = Ad.networkOf;
  var targetsOf = C.targetsOf, STAMP = C.STAMP, stampLine = C.stampLine;

  // ---- planning (spec §3.4, §4) ----

  // Identities in words: "MAC 52:54:00:12:34:56 (QEMU virtual NIC), SSH
  // key ed25519".
  function identityWords(identities, vendor) {
    return (identities || []).map(function (i) {
      var type = typeOf(i), value = String(i).slice(type.length + 1);
      if (type === "mac") return "MAC " + value + (vendor ? " (" + vendor + ")" : "");
      if (/^(ssh|ecdsa|sk)-/.test(type)) return "SSH key " + type.replace(/^ssh-/, "");
      return type + " " + value;
    }).join(", ");
  }
  // "mac" of "mac:00:1a:…".
  function typeOf(identity) {
    return String(identity).slice(0, String(identity).indexOf(":"));
  }
  function ids(doc, kind) {
    return Object.keys(doc.entities || {}).filter(function (id) { return doc.entities[id].kind === kind; });
  }
  function links(doc, kind) {
    return Object.keys(doc.associations || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  // `ix`: the document's associations by end (Ch.associations), built once
  // for all that is asked of a document that does not change meanwhile.
  function hostingOf(ix, executable) {
    var a = ix.to("hosts", executable)[0];
    return a ? a.from : null;
  }
  function attachedNetworks(ix, machine) {
    var mine = ix.from("attached", machine).map(function (a) { return a.to; });
    return ids(ix.doc, "network").filter(function (n) { return mine.indexOf(n) >= 0; });
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
  function runsRouter(ix, host) {
    return ix.from("hosts", host).some(function (a) { return ix.doc.entities[a.to] && ix.doc.entities[a.to].kind === "router"; });
  }

  // The drawn host nmap runs on, named by the scan: "altiera.fritz.box" or
  // "altiera" for a host labelled "altiera".
  function sameName(hostname, label) {
    var n = String(hostname || "").toLowerCase(), l = String(label || "").trim().toLowerCase();
    return !!n && !!l && (n === l || n.split(".")[0] === l);
  }

  // What a host can be noted as asked, in the file's order, and each in
  // words (scan workflow spec §3).
  var ASKED = ["ports", "products", "route", "connections"];
  var ASKED_WORDS = { ports: "which ports are open", products: "what runs there", route: "the way to them", connections: "how they connect" };
  // The keys of `keys` a host is not noted with for that day.
  function unasked(entity, keys, day) {
    var had = (entity && entity.asked) || {};
    return day ? keys.filter(function (k) { return had[k] !== day; }) : [];
  }
  // `add` over what the host was asked before, in the file's order.
  function noted(entity, keys, day) {
    var had = entity.asked || {}, out = {};
    ASKED.forEach(function (k) {
      if (keys.indexOf(k) >= 0) out[k] = day;
      else if (has(had, k)) out[k] = had[k];
    });
    return out;
  }

  // `today`: the day of the import, for a scan that does not say when it ran.
  function plan(doc, appId, scan, range, merges, today) {
    merges = merges || {};
    var ix = Ch.associations(doc);
    var hosts = ids(doc, "host");
    var byAddress = Object.create(null);
    hosts.forEach(function (h) {
      (doc.entities[h].addresses || []).forEach(function (a) {
        var k = addressKey(a);
        byAddress[k] = byAddress[k] || h;
      });
    });
    // Nmap recipes spec §3.3: MAC, then SSH key, then address, then name.
    // An identity names a drawn host when exactly one has it; two with it
    // is said, not guessed.
    var byIdentity = Object.create(null);
    hosts.forEach(function (h) {
      (doc.entities[h].identities || []).forEach(function (i) { (byIdentity[i] = byIdentity[i] || []).push(h); });
    });
    // Nuclei templates spec §8: the names drawn hosts keep.
    var byName = Object.create(null);
    hosts.forEach(function (h) {
      (doc.entities[h].names || []).forEach(function (n) { (byName[n] = byName[n] || []).push(h); });
    });
    function namesOf(h) {
      var good = [], said = [];
      (h.names || []).forEach(function (x) {
        var n = String(x.name || "").toLowerCase().replace(/\.$/, "");
        if (A.isName(n)) {
          if (good.indexOf(n) < 0) good.push(n);
        } else if (said.indexOf(x.name) < 0) said.push(x.name);
      });
      return { good: good, said: said };
    }
    // The first of its names that is one: a wildcard labels nothing.
    function bestName(h) {
      return (h.names || []).filter(function (x) { return A.isName(String(x.name || "").toLowerCase().replace(/\.$/, "")); })[0] || null;
    }
    function whoIs(h) {
      var one = null, shared = null;
      (h.identities || []).forEach(function (i) {
        var at = byIdentity[i] || [];
        if (!one && at.length === 1) one = at[0];
        if (!shared && at.length > 1) shared = i;
      });
      return { host: one, shared: one ? null : shared };
    }
    // The same address and another machine: an identity of a type the drawn
    // host has, with none of its values (spec §5.2).
    function conflictOf(target, h) {
      var have = doc.entities[target].identities || [];
      var found = null;
      (h.identities || []).forEach(function (i) {
        if (found) return;
        var was = have.filter(function (x) { return typeOf(x) === typeOf(i); });
        var now = h.identities.filter(function (x) { return typeOf(x) === typeOf(i); });
        if (was.length && !was.some(function (x) { return now.indexOf(x) >= 0; })) found = { host: target, type: typeOf(i), was: was[0], now: i };
      });
      return found;
    }
    // A known machine at addresses it was not drawn with: those it leaves
    // are the ones the scan looked at and did not find it at.
    var targets = targetsOf(scan) || String(range == null ? "" : range), excluded = C.excludedOf(scan);
    function movedOf(target, h) {
      var had = doc.entities[target].addresses || [];
      var hadKeys = had.map(addressKey), nowKeys = h.addresses.map(addressKey);
      var to = h.addresses.filter(function (a) { return hadKeys.indexOf(addressKey(a)) < 0; });
      if (!to.length) return null;
      var from = had.filter(function (a) { return nowKeys.indexOf(addressKey(a)) < 0 && Ad.covers(targets, a) && !Ad.covers(excluded, a); });
      var others = [];
      to.forEach(function (a) {
        var o = byAddress[addressKey(a)];
        if (o && o !== target && others.indexOf(o) < 0) others.push(o);
      });
      return { from: from, to: to, others: others };
    }
    // A better name for a host still labelled by an address; a name its
    // author gave is never offered for replacement (spec §3.4).
    function renameOf(target, h) {
      var e = doc.entities[target];
      var best = bestName(h);
      if (!best || !bytes(String(e.label).trim()) || best.name === e.label) return null;
      return { to: best.name, from: best.from };
    }

    // Any drawn host no scanned address already names may be one the scan
    // lists: hand-drawn, or known by the other kind of address (an IPv6
    // scan of hosts drawn from an IPv4 one, review 2026-09-26).
    var seenHosts = Object.create(null);
    scan.hosts.forEach(function (h) {
      h.addresses.forEach(function (a) {
        if (byAddress[addressKey(a)]) seenHosts[byAddress[addressKey(a)]] = true;
      });
      if (whoIs(h).host) seenHosts[whoIs(h).host] = true;
    });
    var candidates = hosts.filter(function (h) { return !seenHosts[h]; });
    var networks = ids(doc, "network");
    var appHost = hostingOf(ix, appId);
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
      var onIt = attachedNetworks(ix, appHost).filter(function (n) { return netCandidates.indexOf(n) >= 0; });
      if (onIt.length === 1) {
        proposed.merged = onIt[0];
        proposed.guessed = true;
      }
    }
    // By label, whatever its case: Greenbone's "openssh 9.6p1" is nmap's
    // "OpenSSH 9.6p1".
    // And by name and version, whatever follows them (nuclei templates
    // spec §7.3).
    var products = Object.create(null);
    ids(doc, "product").forEach(function (p) {
      var k = P.key(doc.entities[p].label);
      products[k] = products[k] || p;
    });

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
      var who = whoIs(h);
      var byAddr = null;
      h.addresses.forEach(function (a) { if (!byAddr && byAddress[addressKey(a)]) byAddr = byAddress[addressKey(a)]; });
      // Another machine on a drawn host's address is that host only when
      // the author says so (merges.conflicts).
      var conflict = !who.host && byAddr ? conflictOf(byAddr, h) : null;
      if (conflict) conflict.choice = (merges.conflicts || {})[key] === "same" ? "same" : "new";
      var known = who.host || (conflict && conflict.choice !== "same" ? null : byAddr);
      if (known && rowOf[known]) return rowOf[known].listings.push(h);
      var merged = !known && !conflict && candidates.indexOf(merges[key]) >= 0 && !takenBy[merges[key]] ? merges[key] : null;
      if (merged) takenBy[merged] = key;
      var row = { key: key, scan: h, listings: [h], known: known, merged: merged, guessed: false, matchedBy: who.host ? "identity" : known ? "address" : null, conflict: conflict, sharedIdentity: who.shared };
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
        own.guessedBy = "self";
        takenBy[appHost] = own.key;
      }
    }
    // A scanned host without an address is the one drawn host that keeps
    // its name; one with an address is not, since hosts share names. Where
    // a row is that host already (by its address, or by another of its
    // names), this one is another listing of it: no host, no port twice.
    var folded = Object.create(null);
    rows.forEach(function (r) {
      if (r.known || r.merged || r.conflict || has(merges, r.key) || r.scan.addresses.length) return;
      var keepers = [];
      namesOf(r.scan).good.forEach(function (n) {
        (byName[n] || []).forEach(function (h) { if (keepers.indexOf(h) < 0) keepers.push(h); });
      });
      if (keepers.length !== 1) return;
      var is = rowOf[keepers[0]] || rows.filter(function (x) { return x.merged === keepers[0] && !folded[x.key]; })[0];
      if (is) {
        is.listings = is.listings.concat(r.listings);
        is.scan = oneHost(is.listings);
        folded[r.key] = true;
        return;
      }
      r.merged = keepers[0];
      r.guessed = true;
      r.guessedBy = "name";
      r.matchedBy = "name";
      takenBy[keepers[0]] = r.key;
    });
    rows = rows.filter(function (r) { return !folded[r.key]; });
    // A drawn host without addresses that has the scanned host's name is
    // guessed to be it, as nmap's own host is (spec §3.3).
    rows.forEach(function (r) {
      if (r.known || r.merged || r.conflict || has(merges, r.key)) return;
      var names = (r.scan.names || []).map(function (n) { return n.name; });
      var same = candidates.filter(function (c) {
        return !takenBy[c] && !(doc.entities[c].addresses || []).length && names.some(function (n) { return sameName(n, doc.entities[c].label); });
      });
      if (same.length !== 1) return;
      r.merged = same[0];
      r.guessed = true;
      r.guessedBy = "name";
      r.matchedBy = "name";
      takenBy[same[0]] = r.key;
    });

    // The interfaces a device lists by SNMP (scan workflow spec §6.2): its
    // further addresses, but one another drawn or scanned host has.
    var scanned = Object.create(null);
    rows.forEach(function (r) {
      r.scan.addresses.forEach(function (a) { scanned[addressKey(a)] = r.key; });
    });
    rows.forEach(function (r) {
      var target = r.known || r.merged, listed = [];
      r.scan.ports.forEach(function (p) {
        (p.scripts || []).forEach(function (s) { if (s.id === "snmp-interfaces") listed = listed.concat(Dv.interfaces(s.output)); });
      });
      r.interfaces = listed.filter(function (i, n) {
        var k = addressKey(i.address);
        var drawn = byAddress[k], row = scanned[k];
        if ((drawn && drawn !== target) || (row && row !== r.key)) return false;
        return listed.map(function (x) { return addressKey(x.address); }).indexOf(k) === n;
      });
    });

    // Where each one is attached that it is not yet: every network whose
    // range holds one of its addresses, else the proposed one.
    var usedNew = false;
    var into = proposed ? proposed.merged || "new" : null;
    rows.forEach(function (r) {
      var target = r.known || r.merged;
      var have = target ? attachedNetworks(ix, target) : [];
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
      // An interface's network: the drawn one that holds its address, the
      // proposed one, else one of its own, "new:10.0.9.0/24".
      r.interfaces.forEach(function (i) {
        var drawn = networks.filter(function (n) {
          return (doc.entities[n].addresses || []).some(function (c) { return inCidr(i.address, c); });
        });
        var on = drawn.length ? drawn : proposed && inCidr(i.address, cidr) ? [into] : ["new:" + i.cidr];
        on.forEach(function (n) { if (nets.indexOf(n) < 0) nets.push(n); });
        if (on[0] === into && proposed && proposed.merged) usedNew = true;
      });
      r.networks = nets.filter(function (n) { return have.indexOf(n) < 0; });
      r.on = have.concat(r.networks);
      if (r.networks.indexOf("new") >= 0) usedNew = true;
    });
    var appNets = appHost ? attachedNetworks(ix, appHost) : [];
    rows.forEach(function (r) {
      if (appHost && (r.known || r.merged) === appHost) appNets = appNets.concat(r.networks);
    });

    // The way to each host, by its trace (nmap recipes spec §4).
    var way = Rt.routes(doc, rows, { byAddress: byAddress, networks: networks, appNets: appNets, proposed: proposed ? { cidr: cidr, into: into } : null });
    var onTheWay = Object.create(null);
    way.routers.forEach(function (r) { if (r.row) onTheWay[r.row] = true; });
    way.links.forEach(function (l) { if (l.network === "new") usedNew = true; });

    // What the scan asked of the hosts it covered, and the day it did
    // (scan workflow spec §3).
    var gateways = Dv.gateways(scan.pre).map(addressKey);
    var asks = ASKED.filter(function (k) { return (scan.asks || []).indexOf(k) >= 0; });
    var day = scan.date || today || null;
    if (!day) asks = [];
    var planned = rows.map(function (r) {
      var h = r.scan, target = r.known || r.merged;
      var label = target ? doc.entities[target].label : (bestName(h) || {}).name || h.hostname || h.addresses[0];
      var have = target ? doc.entities[target].identities || [] : [];
      var called = namesOf(h);
      var kept = target ? doc.entities[target].names || [] : [];
      var shared = appNets.filter(function (n) { return r.on.indexOf(n) >= 0; });
      var offered = !(target && runsRouter(ix, target));
      var suggested = roleOf(h.device);
      // A host others were reached through routes, whatever nmap called it.
      if (onTheWay[r.key] && suggested.role === "host") suggested = { role: "router", device: "on the way to others" };
      // The router a DHCP answer names; a device with interfaces on two
      // networks or more (scan workflow spec §6.1, §6.2).
      if (suggested.role === "host" && h.addresses.some(function (a) { return gateways.indexOf(addressKey(a)) >= 0; })) suggested = { role: "router", device: "gateway by DHCP" };
      var ownNets = r.interfaces.map(function (i) { return i.cidr; }).filter(function (c, n, all) { return all.indexOf(c) === n; });
      if (suggested.role === "host" && ownNets.length > 1) suggested = { role: "router", device: r.interfaces.length + " interfaces by SNMP" };
      var drawnAt = target ? (doc.entities[target].addresses || []).map(addressKey) : [];
      var hostChecks = readScripts(h.scripts);
      // A reader's own findings on the host (Greenbone's general/tcp) have
      // no port to go to.
      var hostOwn = neutral(h.findings);
      var seen = reached(ix, appId, target);
      // A scan of filters calls no port open that is (scan workflow spec §5.1).
      var ports = (R.passing(scan) ? [] : h.ports).filter(function (p) { return p.state === "open" && !wrapped(p); }).map(function (p) {
        var row = portRow(seen, r.key, label, p, products);
        told(ix, scan, target, row, p, products);
        var own = readScripts(p.scripts);
        row.found = own.found.concat(neutral(p.findings));
        row.unread = own.unread;
        return row;
      });
      var smb = SMB_PORTS.map(function (proto) { return ports.filter(function (x) { return x.proto === proto; })[0]; }).filter(Boolean)[0];
      var unplaced = [];
      if (smb && !(smb.known && !productOfService(ix, smb.known))) smb.found = smb.found.concat(hostChecks.found);
      else unplaced = hostChecks.found;
      ports.forEach(function (row) {
        row.findings = findingsFor(ix, row, row.found);
        delete row.found;
      });
      return {
        key: r.key,
        label: label,
        addresses: h.addresses.slice(),
        interfaces: r.interfaces,
        // The addresses of its interfaces the host is not drawn with.
        gains: r.interfaces.map(function (i) { return i.address; }).filter(function (a) { return drawnAt.indexOf(addressKey(a)) < 0 && h.addresses.map(addressKey).indexOf(addressKey(a)) < 0; }),
        os: h.os ? osLine(scan.tool, h.os) : null,
        known: r.known,
        merged: r.merged,
        guessed: r.guessed,
        guessedBy: r.guessedBy || null,
        matchedBy: r.matchedBy,
        identities: (h.identities || []).slice(),
        newIdentities: (h.identities || []).filter(function (i) { return have.indexOf(i) < 0; }),
        vendor: h.vendor || null,
        names: called.good,
        newNames: called.good.filter(function (n) { return kept.indexOf(n) < 0; }),
        saidNames: called.said,
        seen: target ? doc.entities[target].seen || null : null,
        missed: target ? doc.entities[target].missed || null : null,
        unasked: target ? unasked(doc.entities[target], asks, day) : asks.slice(),
        moved: r.known && r.matchedBy === "identity" ? movedOf(r.known, h) : null,
        sharedIdentity: r.sharedIdentity,
        conflict: r.conflict,
        rename: target ? renameOf(target, h) : null,
        networks: r.networks,
        on: r.on,
        role: offered ? suggested.role : "host",
        roleOffered: offered,
        device: suggested.device,
        route: shared.length ? [shared[0]] : [],
        ports: ports,
        unplaced: unplaced.map(function (f) { return { script: f.script, tag: f.tag, id: findingId(f.vuln), state: f.vuln.state, why: "no SMB service" }; }).concat(hostOwn.map(function (f) {
          return { script: f.script, tag: f.tag, id: findingId(f.vuln), state: f.vuln.state, title: f.vuln.title, why: "on the host, not a port" };
        })),
        unread: hostChecks.unread,
      };
    });

    var tcpwrapped = 0;
    rows.forEach(function (r) {
      r.scan.ports.forEach(function (p) { if (p.state === "open" && wrapped(p)) tcpwrapped++; });
    });
    var scanOf = {};
    rows.forEach(function (r) { scanOf[r.key] = r.scan; });
    // The drawn hosts the scan covered and has no word of: a scanner that
    // only writes what it found (nuclei) asked them too.
    var rowed = planned.map(function (h) { return h.known || h.merged; }).filter(Boolean);
    var also = asks.length && scan.covers ? St.asked(doc, scan.covers).filter(function (id) {
      return rowed.indexOf(id) < 0 && !doc.entities[id].missed && unasked(doc.entities[id], asks, day).length > 0;
    }) : [];
    return {
      app: appId,
      asked: { keys: asks, day: day, also: also },
      // What differs from the drawing (nmap recipes spec §5).
      changes: Ch.changes(doc, appId, scan, planned, scanOf, way, appHost),
      // How it connects (nuclei templates spec §6).
      connections: Cn.plan(doc, scan, planned, scanOf, appHost),
      routers: way.routers,
      links: way.links,
      paths: way.paths,
      date: scan.date || null,
      tcpwrapped: tcpwrapped,
      appHost: appHost,
      network: usedNew ? proposed : null,
      networkCandidates: usedNew ? netCandidates : [],
      candidates: candidates,
      silentUdp: scan.silentUdp || 0,
      hosts: planned,
    };
  }

  // "nmap OS guess: Linux 5.0 - 5.4 (96%)."; a reader without a certainty
  // says none; one without a name is none.
  function osLine(tool, os) {
    if (!os.name) return null;
    var who = tool === "greenbone" ? "Greenbone" : tool || "nmap";
    return who + " OS guess: " + os.name + (os.accuracy != null ? " (" + os.accuracy + "%)" : "") + ".";
  }

  // ---- findings of the checks (spec §4.6) ----

  // A reader's findings in the shape of nmap's ({source, key, title, state,
  // ids}); `tag` is how the preview names each: nmap's script, Greenbone's
  // severity.
  function neutral(list) {
    return (list || []).map(function (f) {
      return { script: f.source, source: f.source, tag: f.state, vuln: { key: f.key, title: f.title, state: f.state, ids: f.ids || [] } };
    });
  }

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
      if (VERSION_SCRIPTS.indexOf(s.id) >= 0 || s.id === "snmp-interfaces") return;
      if (!s.vulns.length) {
        var first = s.output.split("\n").map(function (l) { return l.trim(); }).filter(Boolean)[0] || "";
        out.unread.push({ script: s.id, text: "not read" + (first ? " · " + first.slice(0, 80) : "") });
        return;
      }
      var untested = false;
      s.vulns.forEach(function (v) {
        if (FOUND.test(v.state)) out.found.push({ script: s.id, source: "nmap " + s.id, tag: s.id, vuln: v });
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
  function findingLine(source, v) {
    var title = String(v.title).trim();
    var stop = title.search(/\.(\s|$)/);
    if (stop >= 0) title = title.slice(0, stop);
    return source + ": " + v.state + ", " + findingId(v) + (title ? " (" + title + ")" : "") + ".";
  }
  function noteLines(e) {
    var p = e && e.parameters && e.parameters["find-exploit"];
    return p && p.note ? p.note.split("\n") : [];
  }
  function productOfService(ix, service) {
    var a = ix.from("instance-of", service)[0];
    return a && ix.doc.entities[a.to] ? a.to : null;
  }
  // A port's findings, against the product they would mark.
  function findingsFor(ix, row, found) {
    var product = row.known ? productOfService(ix, row.known) : row.product.existing;
    var e = product ? ix.doc.entities[product] : null;
    return found.map(function (f) {
      var line = findingLine(f.source, f.vuln);
      return {
        key: row.key + "/" + f.script + "/" + f.vuln.key,
        script: f.script,
        tag: f.tag,
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
  // this scanner already reaches, or another scanner on its host does
  // (roadmap scanner-readers: never drawn twice). Built once per host, not
  // once per port.
  function reached(ix, appId, target) {
    var out = { service: Object.create(null), fromApp: Object.create(null) };
    if (!target) return out;
    var doc = ix.doc, hosted = Object.create(null);
    ix.from("hosts", target).forEach(function (a) {
      if (doc.entities[a.to] && doc.entities[a.to].kind === "service") hosted[a.to] = true;
    });
    var flows = Object.keys(doc.flows || {}).map(function (k) { return doc.flows[k]; });
    flows.forEach(function (f) {
      if (hosted[f.target] === true && !has(out.service, f.protocol)) out.service[f.protocol] = f.target;
    });
    var here = hostingOf(ix, appId);
    function sameReach(source) {
      if (source === appId) return true;
      var e = doc.entities[source];
      return !!here && !!e && e.kind === "application" && !!e.tool && hostingOf(ix, source) === here;
    }
    flows.forEach(function (f) {
      if (sameReach(f.source) && has(out.service, f.protocol) && out.service[f.protocol] === f.target) out.fromApp[f.protocol] = true;
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
    if (product.identified && products[P.key(product.label)]) product.existing = products[P.key(product.label)];
    return { key: hostKey + "/" + proto, proto: proto, label: label, product: product, known: known, addsFlow: addsFlow, identifies: null, differs: null, application: null };
  }

  // The application a port's service passes on to (nuclei templates spec
  // §5.4): of the services on the same host that a flow from it reaches,
  // the one whose product is the application's, else the one reached by
  // http, as the import draws it. A database the server talks to is none.
  function passesTo(ix, host, service, label) {
    var doc = ix.doc, reached = [];
    Object.keys(doc.flows || {}).forEach(function (k) {
      var f = doc.flows[k];
      if (f.source === service && doc.entities[f.target] && doc.entities[f.target].kind === "service" && hostingOf(ix, f.target) === host) reached.push({ service: f.target, http: f.protocol === "http" });
    });
    function isIt(x) {
      var has = productOfService(ix, x.service);
      return !!has && (P.same(doc.entities[has].label, label) || P.lacks(doc.entities[has].label, label));
    }
    return (reached.filter(isIt)[0] || reached.filter(function (x) { return x.http; })[0] || {}).service || null;
  }
  // What nuclei's own templates say of a port beyond its being open
  // (spec §5, §7): the product a drawn service lacks, a product that
  // differs, and the application behind the server.
  function told(ix, scan, target, row, p, products) {
    row.login = null;
    row.manages = false;
    if (scan.tool !== "nuclei") return;
    var doc = ix.doc;
    var drawn = row.known ? productOfService(ix, row.known) : null;
    if (drawn && row.product.identified) {
      var was = doc.entities[drawn].label;
      if (P.lacks(was, row.product.label)) row.identifies = { product: drawn, from: was, to: row.product.label, existing: row.product.existing };
      else if (!P.same(was, row.product.label)) row.differs = "drawn: " + was + " · nuclei: " + row.product.label;
    }
    row.login = p.login || null;
    row.manages = !!p.manages;
    if (!p.application) return;
    var label = p.application.product + (p.application.version ? " " + p.application.version : "");
    var app = { label: p.application.label, product: { label: label, existing: products[P.key(label)] || null }, known: row.known ? passesTo(ix, target, row.known, label) : null, differs: null };
    var has = app.known ? productOfService(ix, app.known) : null;
    if (has && !P.same(doc.entities[has].label, label) && !P.lacks(doc.entities[has].label, label)) app.differs = "drawn: " + doc.entities[has].label + " · nuclei: " + label;
    row.application = app;
  }

  function defaults(p) {
    var t = { hosts: {}, ports: {}, roles: {}, findings: {}, network: true, identities: {}, names: {}, identifies: {}, applications: {}, moves: {}, strips: {}, renames: {}, seen: true, asked: true, routers: {} };
    (p.routers || []).forEach(function (r) { t.routers[r.key] = true; });
    // A change is done only when ticked (spec §5.2).
    t.connections = Cn.defaults(p.connections);
    t.changes = {};
    ((p.changes && p.changes.list) || []).forEach(function (c) { if (c.action) t.changes[c.key] = false; });
    p.hosts.forEach(function (h) {
      // Another machine on a drawn host's address is left out until chosen.
      t.hosts[h.key] = !h.conflict || h.conflict.choice === "same";
      // What only adds knowledge is ticked; taking from another host is not.
      t.identities[h.key] = true;
      t.names[h.key] = true;
      t.moves[h.key] = true;
      t.strips[h.key] = false;
      t.renames[h.key] = true;
      t.roles[h.key] = h.role;
      h.ports.forEach(function (r) {
        if (r.identifies) t.identifies[r.key] = true;
        if (r.application && !r.application.known) t.applications[r.key] = true;
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
  // Whether a row's product is named, and its application drawn: a known
  // port's as ticked, a new port's with the port.
  function telling(r, ticks) {
    var there = !!r.known || !!ticks.ports[r.key];
    return {
      identifies: !!r.identifies && !!(ticks.identifies && ticks.identifies[r.key]),
      application: !!r.application && !r.application.known && there && !!(ticks.applications && ticks.applications[r.key]),
    };
  }
  // The drawn products that services this import draws are instances of:
  // such a product is shared, and keeps its name when one of its services
  // is told a version.
  function wanted(p, ticks) {
    var out = Object.create(null);
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      h.ports.forEach(function (r) {
        if (!r.known && ticks.ports[r.key] && r.product.identified && r.product.existing) out[r.product.existing] = true;
        if (telling(r, ticks).application && r.application.product.existing) out[r.application.product.existing] = true;
      });
    });
    return out;
  }
  // What naming the products comes to (nuclei templates spec §7.3), decided
  // once, for the summary and for apply, whatever the order of the hosts.
  // A drawn product takes the name in place where no service beyond those
  // that are told is an instance of it and none of that name is drawn: what
  // was written on it stays. Else its services take the product of that
  // name, drawn or made. Returns {list: [{row, product, to, key, existing,
  // how: "rename" | "kept" | "use"}], made: [key], gone: [{product, row}]}:
  // `gone` are the products nothing is an instance of afterwards.
  function naming(doc, p, ticks) {
    var wants = wanted(p, ticks), by = Object.create(null), order = [];
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      h.ports.forEach(function (r) {
        if (!telling(r, ticks).identifies || !doc.entities[r.known] || !doc.entities[r.identifies.product]) return;
        if (!by[r.identifies.product]) order.push(r.identifies.product);
        (by[r.identifies.product] = by[r.identifies.product] || []).push(r);
      });
    });
    var out = { list: [], made: [], gone: [] }, taken = Object.create(null);
    // Those that are named in place first: their names are taken then.
    function shared(x) {
      var told = by[x].map(function (r) { return r.known; });
      return !!wants[x] || links(doc, "instance-of").some(function (a) { return a.to === x && told.indexOf(a.from) < 0; });
    }
    var renamed = Object.create(null);
    order.forEach(function (x) {
      if (shared(x)) return;
      var first = by[x].filter(function (r) { return !r.identifies.existing && !taken[P.key(r.identifies.to)]; })[0];
      if (!first) return;
      renamed[x] = P.key(first.identifies.to);
      taken[renamed[x]] = true;
    });
    order.forEach(function (x) {
      by[x].forEach(function (r) {
        var key = P.key(r.identifies.to);
        var how = { row: r, product: x, to: r.identifies.to, key: key, existing: r.identifies.existing || null, how: "use" };
        if (renamed[x] === key && !how.existing) how.how = out.list.some(function (o) { return o.product === x && o.how === "rename"; }) ? "kept" : "rename";
        else if (!how.existing && !taken[key]) {
          taken[key] = true;
          out.made.push(key);
        }
        out.list.push(how);
      });
      if (!renamed[x] && !shared(x)) out.gone.push({ product: x, row: by[x][0] });
    });
    out.taken = taken;
    return out;
  }
  // What was written on a product that goes is kept on the one its
  // service takes: a finding, the author's words, an estimate.
  function carry(from, to) {
    if (from.description && String(to.description || "").indexOf(from.description) < 0) to.description = (to.description ? to.description + "\n" : "") + from.description;
    Object.keys(from.defenses || {}).forEach(function (k) {
      var has = (to.defenses || {})[k];
      if (typeof from.defenses[k] === "boolean" && has !== true && has !== false) (to.defenses = to.defenses || {})[k] = from.defenses[k];
      // An unpatched product stays one, unless its author said otherwise of the other.
    });
    Object.keys(from.parameters || {}).forEach(function (k) {
      var mine = from.parameters[k], its = (to.parameters || {})[k];
      if (!mine || (mine.status === "unknown" && !mine.note)) return;
      if (!its || (its.status === "unknown" && !its.note)) return void ((to.parameters = to.parameters || {})[k] = JSON.parse(JSON.stringify(mine)));
      String(mine.note || "").split("\n").filter(Boolean).forEach(function (line) {
        if (String(its.note || "").split("\n").indexOf(line) < 0) its.note = (its.note ? its.note + "\n" : "") + line;
      });
    });
  }
  // What is drawn or will be, by row: what a connection hangs on.
  function thereOf(p, ticks) {
    var out = { hosts: {}, ports: {}, apps: {} };
    p.hosts.forEach(function (h) {
      out.hosts[h.key] = !!ticks.hosts[h.key];
      h.ports.forEach(function (r) {
        out.ports[r.key] = out.hosts[h.key] && (!!r.known || !!ticks.ports[r.key]);
        out.apps[r.key] = out.ports[r.key] && !!r.application && (!!r.application.known || telling(r, ticks).application);
      });
    });
    return out;
  }
  // Whether a connection's row hangs on what is drawn or will be: the
  // page leaves it out otherwise, as the summary and apply do.
  function connectionThere(p, ticks, row) {
    return Cn.hangs(row, thereOf(p, ticks));
  }
  function markKey(r, f) {
    return f.product ? "id:" + f.product : r.product.identified ? "new:" + r.product.label : "port:" + r.key;
  }

  // A hop is drawn as a router when ticked; one that is a scanned host,
  // when that host is ticked and a router (spec §4.3).
  function routerTicked(p, ticks, r) {
    if (!ticks.routers || ticks.routers[r.key] !== true) return false;
    if (!r.row) return true;
    var row = p.hosts.filter(function (h) { return h.key === r.row; })[0];
    return !!row && !!ticks.hosts[row.key] && (!!r.router || roleChosen(row, ticks) !== "host");
  }

  // What a ticked row does to its host beyond adding: the identities it
  // gains, its move, its new name, the day it was seen (spec §3).
  function doing(h, ticks, p) {
    var on = function (group) { return !!(ticks[group] && ticks[group][h.key]); };
    var same = !!h.conflict && h.conflict.choice === "same";
    return {
      identities: on("identities") || same ? h.newIdentities : [],
      names: on("names") ? h.newNames : [],
      replaces: same,
      move: !!h.moved && on("moves"),
      strip: !!h.moved && h.moved.others.length > 0 && on("strips"),
      rename: !!h.rename && on("renames"),
      seen: !!p.date && ticks.seen === true && (h.seen !== p.date || !!h.missed),
      asked: ticks.asked === true ? h.unasked || [] : [],
    };
  }
  // The drawn hosts without a row that are noted as asked.
  function alsoAsked(p, ticks) {
    return ticks.asked === true && p.asked ? p.asked.also : [];
  }

  function summary(doc, p, ticks, limits) {
    var s = { hosts: 0, filled: 0, filledNetworks: 0, networks: 0, attached: 0, routers: 0, firewalls: 0, services: 0, products: 0, flows: 0, unpatched: 0, identified: 0, named: 0, told: 0, moved: 0, renamed: 0, seen: 0, asked: alsoAsked(p, ticks).length, changes: Ch.changesTicked(p, ticks), connected: Cn.count(p.connections, ticks.connections, thereOf(p, ticks)) };
    var rel = 0, newProducts = Object.create(null), marked = Object.create(null);
    // The products that are named: those made for it are counted, and a
    // name that is taken is no new product of a port's.
    var names = naming(doc, p, ticks);
    s.told = names.list.length;
    s.products = names.made.length;
    Object.keys(names.taken).forEach(function (k) { newProducts[k] = true; });
    var network = !!(p.network && ticks.network);
    // The proposed network as the rows name it: "new", or the drawn one chosen.
    var proposed = p.network ? p.network.merged || "new" : null;
    if (network && p.network.merged) s.filledNetworks = 1;
    var ticked = 0, proposedMade = false;
    // The networks of interfaces that no drawn one holds, each once.
    var own = Object.create(null);
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      ticked++;
      var added = !h.known && !h.merged;
      if (added) s.hosts++;
      var does = doing(h, ticks, p);
      if (!added && does.identities.length) s.identified++;
      if (!added && does.names.length) s.named++;
      if (does.move) s.moved++;
      if (does.rename) s.renamed++;
      if (!added && does.seen) s.seen++;
      if (!added && does.asked.length) s.asked++;
      // A merge writes the scanned addresses into the drawn host; so do
      // the interfaces a drawn host lists.
      if ((h.merged && h.addresses.length) || (!added && !h.merged && h.gains.length)) s.filled++;
      h.networks.forEach(function (n) {
        if (n === proposed && !network) return;
        rel++;
        if (n === "new") proposedMade = true;
        if (n.indexOf("new:") === 0) own[n] = true;
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
        var tells = telling(r, ticks);
        if (tells.application) {
          s.services++;
          s.flows++;
          rel += 2; // hosts, instance-of
          if (!r.application.product.existing && !newProducts[P.key(r.application.product.label)]) {
            newProducts[P.key(r.application.product.label)] = true;
            s.products++;
          }
        }
        if (!ticks.ports[r.key]) return;
        if (!r.known) {
          s.services++;
          rel += 2; // hosts, instance-of
          var k = r.product.identified ? P.key(r.product.label) : r.product.label;
          if (!r.product.existing && !(r.product.identified && newProducts[k])) {
            newProducts[k] = true;
            s.products++;
          }
        }
        if (r.addsFlow) s.flows++;
      });
    });
    // Routers on the way that are not scanned hosts, and the networks
    // between hops: a box, its router, their attachments.
    var drawn = Object.create(null);
    (p.routers || []).forEach(function (r) {
      if (!routerTicked(p, ticks, r)) return;
      drawn[r.key] = true;
      if (r.row) return;
      if (!r.known) s.hosts++;
      if (!r.router) {
        s.routers++;
        rel += 3;
      }
    });
    (p.links || []).forEach(function (l) {
      if (!drawn[l.from] || !drawn[l.to]) return;
      if (!l.network) s.networks++;
      if (l.network === "new" && network) proposedMade = true;
      rel += 4;
    });
    // The proposed network is made when something ticked is on it.
    s.proposed = proposedMade && proposed === "new";
    if (s.proposed) s.networks++;
    s.networks += Object.keys(own).length;
    rel += s.flows;
    s.unpatched = Object.keys(marked).length;
    s.entities = Object.keys(doc.entities || {}).length + s.hosts + s.networks + s.routers + s.firewalls + s.services + s.products + s.connected.entities;
    s.relationships = Object.keys(doc.associations || {}).length + Object.keys(doc.flows || {}).length + rel + s.connected.relationships;
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
    if (s.identified) parts.push("identities for " + n(s.identified, "drawn host"));
    if (s.named) parts.push("names for " + n(s.named, "drawn host"));
    var more = [];
    if (s.told) more.push("names " + n(s.told, "product"));
    if (s.unpatched) more.push("marks " + n(s.unpatched, "product") + " unpatched");
    if (s.moved) more.push("moves " + n(s.moved, "host"));
    if (s.renamed) more.push("renames " + n(s.renamed, "host"));
    if (s.changes) more.push("makes " + n(s.changes, "change"));
    var c = s.connected;
    if (c && c.accounts + c.hosts + c.links) more.push("draws " + [[c.accounts, "account"], [c.hosts, "host"], [c.links, "connection"]].filter(function (x) { return x[0]; }).map(function (x) { return n(x[0], x[1]); }).join(", "));
    // The day seen is said only when it is all there is.
    if (s.seen && !parts.length && !more.length) more.push("notes " + n(s.seen, "host") + " as seen");
    else if (s.asked && !parts.length && !more.length) more.push("notes " + n(s.asked, "host") + " as asked");
    var said = (parts.length ? ["adds " + parts.join(", ")] : []).concat(more).join(", ");
    return said ? said[0].toUpperCase() + said.slice(1) + "." : "Nothing new to add.";
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
  // All hosts at once; another machine on a drawn host's address is
  // chosen by itself, never with the rest.
  function tickHosts(p, ticks, on) {
    p.hosts.forEach(function (h) {
      if (!h.conflict) tickHost(h, ticks, on);
    });
    return ticks;
  }

  // `specOf(kind)`: the catalog entry of a kind, for its parameter slots.
  function apply(doc, p, ticks, specOf, stamp) {
    var s = summary(doc, p, ticks, null);
    var merging = p.hosts.some(function (h) { return ticks.hosts[h.key] && ((h.merged && h.addresses.length) || h.gains.length); });
    var stripping = p.hosts.some(function (h) { return ticks.hosts[h.key] && doing(h, ticks, p).strip; });
    if (!s.hosts && !s.services && !s.flows && !s.networks && !s.filledNetworks && !s.attached && !s.routers && !s.unpatched && !merging && !s.identified && !s.named && !s.told && !(s.connected.accounts + s.connected.hosts + s.connected.links) && !s.moved && !s.renamed && !s.seen && !s.asked && !stripping && !s.changes) return null;
    // One copy, edited in place: a copy per edit made an import of a few
    // hundred hosts take seconds (review 2026-10-01).
    var next = A.clone(doc);
    // The drawn products by name and version, and the attachments, kept
    // while the import adds to them; forgotten by any other edit.
    var productsByKey = null, attachments = null;
    function step(edit) {
      if (!edit) throw new Error("the nmap import could not be applied");
      next = edit.doc;
      return edit;
    }
    function forget(edit) {
      productsByKey = attachments = null;
      return edit;
    }
    function add(kind, label) {
      var id = step(A.addEntity(next, kind, label, specOf(kind), true)).entity;
      if (kind === "product" && productsByKey) (productsByKey[P.key(label)] = productsByKey[P.key(label)] || []).push(id);
      return id;
    }
    function link(kind, from, to, extra) {
      step(L.putAssociation(next, null, Object.assign({ kind: kind, from: from, to: to }, extra || {}), true));
      if (kind === "attached" && attachments) attachments[from + " " + to] = true;
    }
    function flow(value) {
      return step(L.putFlow(next, null, value, true));
    }
    function attachedHere(machine, net) {
      if (!attachments) {
        attachments = Object.create(null);
        links(next, "attached").forEach(function (a) { attachments[a.from + " " + a.to] = true; });
      }
      return attachments[machine + " " + net] === true;
    }
    var network = null;
    if (s.proposed) {
      network = add("network", p.network.label);
      next.entities[network].addresses = p.network.addresses.slice();
    } else if (s.filledNetworks) {
      network = p.network.merged;
      next.entities[network].addresses = p.network.addresses.slice();
    }
    var skipped = p.network && p.network.merged && !s.filledNetworks ? p.network.merged : null;
    // The network of an interface that no drawn one holds, made once.
    var ownNetworks = Object.create(null);
    function ownNetwork(cidr) {
      if (!ownNetworks[cidr]) {
        ownNetworks[cidr] = add("network", cidr);
        next.entities[ownNetworks[cidr]].addresses = [cidr];
      }
      return ownNetworks[cidr];
    }
    var madeProducts = Object.create(null);
    var flows = [], marks = [], hostOf = {}, passes = [], serviceOf = {}, appOf = {};
    // A product by its name and version, drawn or made by this import.
    function productFor(label, existing) {
      if (!productsByKey) {
        productsByKey = Object.create(null);
        ids(next, "product").forEach(function (x) {
          var k = P.key(next.entities[x].label);
          (productsByKey[k] = productsByKey[k] || []).push(x);
        });
      }
      var id = existing || madeProducts[P.key(label)] || (productsByKey[P.key(label)] || [])[0];
      if (!id) id = madeProducts[P.key(label)] = add("product", label);
      return id;
    }
    // What the changes do may remove or rename anything.
    var env = {
      doc: function () { return next; },
      step: function (edit) { return forget(step(edit)); },
      soft: function (edit) { if (edit) next = forget(edit).doc; },
      add: add,
      products: madeProducts,
    };
    Ch.applyChangesBefore(p, ticks, env);
    // The products that are named (nuclei templates spec §7.3), before
    // anything is drawn that is an instance of them.
    var names = naming(doc, p, ticks);
    names.list.forEach(function (n) {
      if (!next.entities[n.row.known] || !next.entities[n.product]) return;
      if (n.how === "rename") {
        forget(step(A.renameEntity(next, n.product, n.to, true)));
        madeProducts[n.key] = n.product;
      } else if (n.how === "use") {
        var to = productFor(n.to, n.existing);
        Object.keys(next.associations).forEach(function (k) {
          var a = next.associations[k];
          if (a.kind === "instance-of" && a.from === n.row.known) a.to = to;
        });
      }
    });
    names.gone.forEach(function (g) {
      var left = next.entities[g.product], taken = next.entities[g.row.known] ? productOfService(Ch.associations(next), g.row.known) : null;
      if (!left || !taken || taken === g.product || links(next, "instance-of").some(function (a) { return a.to === g.product; })) return;
      carry(left, next.entities[taken]);
      env.soft(L.remove(next, "entities", g.product, true));
    });
    p.hosts.forEach(function (h) {
      if (!ticks.hosts[h.key]) return;
      var host = h.known || h.merged;
      var does = doing(h, ticks, p);
      function without(id, addresses) {
        var gone = addresses.map(addressKey);
        var left = (next.entities[id].addresses || []).filter(function (a) { return gone.indexOf(addressKey(a)) < 0; });
        if (left.length) next.entities[id].addresses = left;
        else delete next.entities[id].addresses;
      }
      // Another machine on a drawn host's address: the address is its own now.
      if (!host && h.conflict) without(h.conflict.host, h.addresses);
      if (!host) {
        host = add("host", h.label);
        next.entities[host].addresses = h.addresses.slice();
        if (h.os) next.entities[host].description = h.os;
        if (h.identities.length) next.entities[host].identities = h.identities.slice();
        if (h.names.length && ticks.names && ticks.names[h.key]) next.entities[host].names = h.names.slice();
        if (p.date && ticks.seen === true) next.entities[host].seen = p.date;
        if (does.asked.length) next.entities[host].asked = noted(next.entities[host], does.asked, p.asked.day);
      } else {
        var e = next.entities[host];
        if (does.identities.length) {
          var types = does.replaces ? h.identities.map(typeOf) : [];
          e.identities = (e.identities || []).filter(function (i) { return types.indexOf(typeOf(i)) < 0; }).concat(does.identities);
        }
        if (does.names.length) e.names = (e.names || []).concat(does.names);
        if (does.move) {
          without(host, h.moved.from);
          e.addresses = (e.addresses || []).concat(h.moved.to);
        }
        if (does.strip) h.moved.others.forEach(function (o) { without(o, h.moved.to); });
        if (does.rename) e.label = h.rename.to;
        if (does.seen) {
          e.seen = p.date;
          delete e.missed;
        }
        if (does.asked.length) e.asked = noted(e, does.asked, p.asked.day);
      }
      if (h.vendor && !next.entities[host].vendor) next.entities[host].vendor = h.vendor;
      hostOf[h.key] = host;
      if (h.merged && h.addresses.length) {
        // Added to what it had, each address once.
        var had = next.entities[host].addresses || [];
        var keys = had.map(addressKey);
        next.entities[host].addresses = had.concat(h.addresses.filter(function (a) { return keys.indexOf(addressKey(a)) < 0; }));
      }
      if (h.gains.length) {
        var drawnAt = (next.entities[host].addresses || []).map(addressKey);
        next.entities[host].addresses = (next.entities[host].addresses || []).concat(h.gains.filter(function (a) { return drawnAt.indexOf(addressKey(a)) < 0; }));
      }
      h.networks.forEach(function (n) {
        var to = n === "new" ? network : n === skipped ? null : n.indexOf("new:") === 0 ? ownNetwork(n.slice(4)) : n;
        if (to) link("attached", host, to);
      });
      var role = roleChosen(h, ticks);
      if (role !== "host") {
        // The router on its box (an appliance), on every network the box is on.
        var router = add("router", h.label + " router");
        link("hosts", host, router, { privilege: "admin" });
        links(next, "attached").filter(function (a) { return a.from === host; }).forEach(function (a) {
          link("attached", router, a.to);
        });
        if (role === "firewall") {
          var firewall = add("firewall", h.label + " firewall");
          link("filters", router, firewall);
        }
      }
      h.ports.forEach(function (r) {
        var tells = telling(r, ticks);
        if (r.known && next.entities[r.known]) serviceOf[r.key] = r.known;
        if (r.application && r.application.known && next.entities[r.application.known]) appOf[r.key] = r.application.known;
        if (tells.application && r.known && next.entities[r.known]) passes.push({ row: r, host: host, label: h.label, server: r.known });
        // A known port with nothing to add is unticked, and its product still
        // takes the finding.
        if (!ticks.ports[r.key]) {
          if (r.known) marking(r, ticks).forEach(function (f) { marks.push({ product: productOfService(Ch.associations(next), r.known), line: f.line }); });
          return;
        }
        // A service this import removed (its port is closed now) is gone.
        var service = r.known && next.entities[r.known] ? r.known : null;
        if (r.known && !service) return;
        if (!service) {
          service = add("service", r.label);
          // nmap cannot see the account it runs as: unknown, not a guess.
          link("hosts", host, service, { privilege: "unknown" });
          var product = r.product.identified ? productFor(r.product.label, r.product.existing) : add("product", r.product.label);
          link("instance-of", service, product);
          if (tells.application) passes.push({ row: r, host: host, label: h.label, server: service });
          serviceOf[r.key] = service;
        }
        marking(r, ticks).forEach(function (f) { marks.push({ product: productOfService(Ch.associations(next), service), line: f.line }); });
        if (r.addsFlow) flows.push({ label: r.label + " on " + h.label, target: service, host: host, row: h.key, port: r.key, route: h.route, protocol: r.proto });
      });
    });
    // After every attachment: a route is kept only where both ends are now
    // on its network (nmap's host may have been left unticked).
    // The routers on the way and the networks between them (nmap recipes
    // spec §4), then each flow by its whole way where there is one.
    // A network the import makes from a device's interface: "new:<cidr>".
    function netOf(n) {
      return n === "new" ? network : n === skipped ? null : n.indexOf("new:") === 0 ? ownNetwork(n.slice(4)) : n;
    }
    var way = Rt.applyRoutes(p, {
      doc: function () { return next; },
      add: add,
      link: link,
      net: netOf,
      hostOf: hostOf,
      ticked: function (r) { return routerTicked(p, ticks, r); },
      seen: p.date && ticks.seen === true ? p.date : null,
    });
    // A way is one for a host when nmap's host and that host are at its ends.
    function ends(rowKey, route) {
      return !!p.appHost && !!hostOf[rowKey] && attachedHere(p.appHost, route[0]) && attachedHere(hostOf[rowKey], route[route.length - 1]);
    }
    var flowOf = {};
    flows.forEach(function (f) {
      var route = way.routes[f.row];
      if (!(route && ends(f.row, route))) {
        var net = f.route[0] === "new" ? network : f.route[0];
        var ok = net && p.appHost && attachedHere(p.appHost, net) && attachedHere(f.host, net);
        route = ok ? [net] : [];
      }
      flowOf[f.port] = flow({ label: f.label, source: p.app, target: f.target, route: route, protocol: f.protocol }).select.slice(5);
    });
    // The application behind a server (nuclei templates spec §5.4): a
    // service of its own on the same host, which the server passes on to
    // over the first network the host is on.
    passes.forEach(function (x) {
      var made = appOf[x.row.key] = add("service", x.row.application.label);
      link("hosts", x.host, made, { privilege: "unknown" });
      link("instance-of", made, productFor(x.row.application.product.label, x.row.application.product.existing));
      var on = attachedNetworks(Ch.associations(next), x.host);
      flow({ label: x.row.application.label + " behind " + x.row.label + " on " + x.label, source: x.server, target: made, route: on.length ? [on[0]] : [], protocol: "http" });
    });
    Cn.apply(p.connections, ticks.connections, {
      doc: function () { return next; },
      add: env.add,
      link: link,
      flow: flow,
      product: function (label) { return productFor(label, null); },
      hostOf: hostOf,
      serviceOf: serviceOf,
      appOf: appOf,
    }, thereOf(p, ticks));
    Ch.applyChangesAfter(p, ticks, env, way.routes, flowOf, ends);
    alsoAsked(p, ticks).forEach(function (id) {
      if (next.entities[id]) next.entities[id].asked = noted(next.entities[id], p.asked.keys, p.asked.day);
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
    // A scanner's own stamp ({line, pattern}), else nmap's.
    var old = next.entities[p.app].description || "";
    var line = stamp.line || stampLine(stamp);
    var pattern = stamp.pattern || STAMP;
    var described = A.setDescription(next, p.app, pattern.test(old) ? old.replace(pattern, line) : (old ? old + "\n" : "") + line, true);
    if (described) next = described.doc;
    return { doc: next, select: "entity/" + p.app };
  }

  // The hosts an import notes as asked, new ones too: the preview's row.
  function askedCount(p, ticks) {
    return alsoAsked(p, ticks).length + p.hosts.filter(function (h) {
      return !!ticks.hosts[h.key] && doing(h, ticks, p).asked.length > 0;
    }).length;
  }
  // "how they connect", "what runs there and the way to them".
  function askedWords(keys) {
    return (keys || []).map(function (k) { return ASKED_WORDS[k]; }).filter(Boolean).join(" and ");
  }
  var api = { askedCount: askedCount, askedWords: askedWords, identityWords: identityWords, plan: plan, defaults: defaults, summary: summary, said: said, tickHost: tickHost, tickHosts: tickHosts, apply: apply, connectionThere: connectionThere };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorNmapPlan = api;
})();
