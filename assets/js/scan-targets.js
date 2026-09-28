// What a scan is aimed at, from the drawing (scan workflow spec §3, §4).
// Pure: no DOM, no wasm.
(function () {
  var node = typeof module !== "undefined";
  var Ad = node ? require("./nmap-address.js") : window.effractorNmapAddress;

  function split(words) {
    return String(words == null ? "" : words).trim().split(/[\s,]+/).filter(Boolean);
  }
  // The host a word names: the word itself, without the port or the URL
  // around it ("https://app.lab:8443/x", "[fd00::5]:443", "10.0.1.5:22").
  function hostOf(word) {
    var w = String(word);
    var url = /^[a-z][a-z0-9+.\-]*:\/\/([^\/?#]*)/i.exec(w);
    if (url) w = url[1];
    var six = /^\[([^\]]+)\](?::\d+)?$/.exec(w);
    if (six) return six[1];
    return /^[^:]+:\d+$/.test(w) ? w.replace(/:\d+$/, "") : w;
  }

  // The drawn hosts the words hold, by an address or by a name, in file
  // order: the hosts a scan of these words asked.
  function asked(doc, words) {
    var hosts = split(words).map(hostOf);
    var names = hosts.map(function (w) { return w.toLowerCase(); });
    var cover = hosts.join(" ");
    return Object.keys((doc && doc.entities) || {}).filter(function (id) {
      var e = doc.entities[id];
      if (e.kind !== "host") return false;
      if ((e.addresses || []).some(function (a) { return Ad.covers(cover, a); })) return true;
      return [String(e.label || "").trim().toLowerCase()].concat(e.names || []).some(function (n) { return !!n && names.indexOf(n) >= 0; });
    });
  }

  // ---- the targets row (spec §4) ----

  function entities(doc, kind) {
    return Object.keys((doc && doc.entities) || {}).filter(function (id) { return doc.entities[id].kind === kind; });
  }
  function links(doc, kind) {
    return Object.keys((doc && doc.associations) || {}).map(function (k) { return doc.associations[k]; }).filter(function (a) { return a.kind === kind; });
  }
  function count(n, one) {
    return n + " " + one + (n === 1 ? "" : "s");
  }
  function rangeOf(doc, network) {
    var e = doc.entities[network];
    return e && e.kind === "network" ? (e.addresses || []).join(" ") : "";
  }
  // The hosts on a network: attached to it, or at an address its range holds.
  function hostsOn(doc, network) {
    var range = rangeOf(doc, network);
    var attached = links(doc, "attached").filter(function (a) { return a.to === network; }).map(function (a) { return a.from; });
    return entities(doc, "host").filter(function (id) {
      return attached.indexOf(id) >= 0 || (doc.entities[id].addresses || []).some(function (a) { return Ad.covers(range, a); });
    });
  }
  function ported(doc, host) {
    return links(doc, "hosts").some(function (a) { return a.from === host && doc.entities[a.to] && doc.entities[a.to].kind === "service"; });
  }
  var KINDS = {
    hosts: function () { return true; },
    unported: function (doc, id) { return !ported(doc, id); },
    missed: function (doc, id) { return !!doc.entities[id].missed; },
  };
  function members(doc, choice) {
    if (!choice || !has(KINDS, choice.kind) || !doc.entities[choice.network]) return [];
    return hostsOn(doc, choice.network).filter(function (id) { return KINDS[choice.kind](doc, id); });
  }
  function has(o, k) {
    return Object.prototype.hasOwnProperty.call(o, k);
  }
  // What is selected, as networks and hosts: "entity/pc7", "cluster/c1".
  function selected(doc, selection) {
    var out = { networks: [], hosts: [] };
    function take(id) {
      var e = doc.entities[id];
      if (!e) return;
      var list = e.kind === "network" ? out.networks : e.kind === "host" ? out.hosts : null;
      if (list && list.indexOf(id) < 0) list.push(id);
    }
    (selection || []).forEach(function (q) {
      var m = /^(entity|cluster)\/(.+)$/.exec(String(q));
      if (!m) return;
      if (m[1] === "entity") return take(m[2]);
      var c = (doc.clusters || {})[m[2]];
      ((c && c.members) || []).forEach(take);
    });
    return out;
  }

  // The menu: every drawn network that has addresses, in file order, with
  // what can be chosen of it; the selection; `first`, what is chosen when
  // the dialog opens. `appHost`: the host the scanner runs on, or null.
  function choices(doc, appHost, selection) {
    doc = doc && doc.entities ? doc : { entities: {} };
    var networks = entities(doc, "network").filter(function (n) { return !!rangeOf(doc, n); }).map(function (n) {
      var missed = members(doc, { kind: "missed", network: n });
      var since = missed.map(function (id) { return doc.entities[id].missed; }).sort()[0];
      return { id: n, label: doc.entities[n].label, range: rangeOf(doc, n), items: [
        { choice: { kind: "range", network: n }, name: "the whole range" },
        { choice: { kind: "hosts", network: n }, name: "drawn hosts only", count: members(doc, { kind: "hosts", network: n }).length },
        { choice: { kind: "unported", network: n }, name: "hosts without ports", count: members(doc, { kind: "unported", network: n }).length },
        { choice: { kind: "missed", network: n }, name: "not seen" + (since ? " since " + since : ""), count: missed.length },
      ] };
    });
    var sel = selected(doc, selection);
    var picked = { kind: "selection", networks: sel.networks, hosts: sel.hosts };
    var own = appHost ? links(doc, "attached").filter(function (a) { return a.from === appHost && !!rangeOf(doc, a.to); }).map(function (a) { return a.to; }) : [];
    var first = sel.networks.length + sel.hosts.length ? picked
      : own.length === 1 ? { kind: "range", network: own[0] }
      // On several networks: their ranges, as the range was filled before.
      : { kind: "typed", text: own.map(function (n) { return rangeOf(doc, n); }).join(" ") };
    return { networks: networks, selection: { choice: picked, count: sel.networks.length + sel.hosts.length }, first: first };
  }

  // A choice in words for the command: {text, hosts, left, said}. `left`
  // counts the hosts without an address, which are left out; `names`: a
  // host without an address is taken by its label where that is a name
  // (nuclei asks names).
  function words(doc, choice, names) {
    doc = doc && doc.entities ? doc : { entities: {} };
    choice = choice || { kind: "typed", text: "" };
    if (choice.kind === "typed") return { text: String(choice.text == null ? "" : choice.text).trim().replace(/\s+/g, " "), hosts: 0, left: 0, said: "typed by hand" };
    if (choice.kind === "range") {
      var net = doc.entities[choice.network];
      return { text: rangeOf(doc, choice.network), hosts: 0, left: 0, said: net ? net.label + " · " + rangeOf(doc, choice.network) : "" };
    }
    var ranges = [], hosts = [], range = "";
    if (choice.kind === "selection") {
      ranges = (choice.networks || []).map(function (n) { return rangeOf(doc, n); }).filter(Boolean);
      hosts = (choice.hosts || []).filter(function (id) { return doc.entities[id] && doc.entities[id].kind === "host"; });
    } else {
      hosts = members(doc, choice);
      range = rangeOf(doc, choice.network);
    }
    var out = [], left = 0, taken = 0;
    hosts.forEach(function (id) {
      var e = doc.entities[id], all = e.addresses || [];
      // Held by a selected range already: scanned once.
      if (all.some(function (a) { return Ad.covers(ranges.join(" "), a); })) return;
      var a = all.filter(function (x) { return Ad.covers(range, x); })[0] || all[0];
      var label = String(e.label || "").trim().toLowerCase();
      if (!a && names && isName(label)) a = label;
      if (!a) return void left++;
      taken++;
      if (out.indexOf(a) < 0) out.push(a);
    });
    var on = choice.network && doc.entities[choice.network] ? " on " + doc.entities[choice.network].label : "";
    var what = choice.kind === "unported" ? " without ports" : choice.kind === "missed" ? " not seen" : "";
    var said = choice.kind === "selection"
      ? ["the selection"].concat([[ranges.length, "network"], [taken, "host"]].filter(function (x) { return x[0]; }).map(function (x) { return count(x[0], x[1]); }).join(", ") || []).join(" · ")
      : count(taken, "host") + what + on;
    return { text: ranges.concat(out).join(" "), hosts: taken, left: left, said: said };
  }
  // A DNS name, as architecture-edit.js has it.
  function isName(text) {
    if (!text || text.length > 253 || /^[0-9.]+$/.test(text)) return false;
    return text.split(".").every(function (l) {
      return /^[a-z0-9_-]{1,63}$/.test(l) && l[0] !== "-" && l[l.length - 1] !== "-";
    });
  }
  // The ports drawn on the hosts the words hold, as "tcp/443": the flows'
  // protocols to services those hosts run.
  function drawnPorts(doc, text) {
    var hosts = asked(doc, text), out = [];
    var hostOfService = Object.create(null);
    links(doc, "hosts").forEach(function (a) { hostOfService[a.to] = a.from; });
    Object.keys((doc && doc.flows) || {}).forEach(function (k) {
      var f = doc.flows[k];
      if (!/^(tcp|udp)\/\d{1,5}$/.test(f.protocol || "") || hosts.indexOf(hostOfService[f.target]) < 0) return;
      if (out.indexOf(f.protocol) < 0) out.push(f.protocol);
    });
    return out;
  }

  var api = { asked: asked, hostOf: hostOf, choices: choices, words: words, drawnPorts: drawnPorts };
  if (node) module.exports = api;
  if (typeof window !== "undefined") window.effractorScanTargets = api;
})();
