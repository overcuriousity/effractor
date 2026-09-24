// The nmap dialog (docs/superpowers/specs/2026-09-24-nmap-import-design.md
// §3): choose a level, copy the command, paste the XML, tick the preview,
// add. What it decides is nmap.js's; this file only shows it. Everything
// from a scan is set as text.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var N = window.effractorNmap;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $("nmap-dialog");
  var at = { app: null, level: "standard", scan: null, merges: {}, ticks: null, plan: null };

  function doc() {
    return app.state.doc;
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function specOf(kind) {
    var c = U.catalog();
    return c ? c.entities.filter(function (e) { return e.kind === kind; })[0] : null;
  }
  function hostOf(id) {
    var d = doc();
    var k = Object.keys(d.associations || {}).filter(function (k) {
      var a = d.associations[k];
      return a.kind === "hosts" && a.to === id;
    })[0];
    return k ? d.associations[k].from : null;
  }
  // The ranges of the networks nmap's host is attached to.
  function prefillRange(host) {
    var d = doc();
    if (!host) return "";
    return Object.keys(d.associations || {}).map(function (k) { return d.associations[k]; }).filter(function (a) {
      return a.kind === "attached" && a.from === host && d.entities[a.to];
    }).map(function (a) { return (d.entities[a.to].addresses || []).join(" "); }).filter(Boolean).join(" ");
  }

  // ---- the command ----

  function levels() {
    var box = $("nmap-levels");
    while (box.children.length > 1) box.removeChild(box.lastChild);
    N.LEVELS.forEach(function (l) {
      var label = el("label", null, "nmap-level");
      var radio = el("input");
      radio.type = "radio";
      radio.name = "nmap-level";
      radio.value = l.id;
      radio.checked = l.id === at.level;
      radio.addEventListener("change", function () {
        at.level = l.id;
        showCommand();
      });
      label.appendChild(radio);
      label.appendChild(el("span", l.name));
      label.appendChild(el("span", l.finds + " · " + (l.root ? "needs root" : "no root") + " · " + l.time + " for a /24", "hint"));
      box.appendChild(label);
    });
  }
  function showCommand() {
    var c = N.command(at.level, $("nmap-range").value);
    $("nmap-command").textContent = c && c.text ? c.text : "";
    $("nmap-copy").disabled = !(c && c.text);
    $("nmap-problem").textContent = c ? c.problem || c.note || "" : "";
  }

  // ---- open ----

  function open(appId) {
    at = { app: appId, level: at.level, scan: null, merges: {}, ticks: null, plan: null };
    var host = hostOf(appId);
    $("nmap-title").textContent = host ? "nmap on " + doc().entities[host].label : "nmap (not on a host)";
    $("nmap-unplaced").hidden = !!host;
    $("nmap-range").value = prefillRange(host);
    $("nmap-paste").value = "";
    $("nmap-problem").textContent = "";
    $("nmap-ask").hidden = false;
    $("nmap-preview").hidden = true;
    levels();
    showCommand();
    U.loadCatalog().catch(function () {}).then(function () {
      if (!dialog.open) dialog.showModal();
    });
  }

  // ---- read and preview ----

  function read() {
    var r = N.read($("nmap-paste").value);
    if (r.problem) {
      $("nmap-problem").textContent = r.problem.message;
      return;
    }
    at.scan = r.scan;
    at.merges = {};
    at.ticks = null;
    preview();
  }

  function preview() {
    var old = at.ticks;
    at.plan = N.plan(doc(), at.app, at.scan, $("nmap-range").value, at.merges);
    var fresh = N.defaults(at.plan);
    at.ticks = old ? { hosts: keep(old.hosts, fresh.hosts), ports: keep(old.ports, fresh.ports), roles: keep(old.roles, fresh.roles), network: old.network } : fresh;
    var rows = $("nmap-rows");
    rows.textContent = "";
    if (at.plan.network) {
      var net = el("li", null, "nmap-host");
      net.appendChild(check(at.ticks.network, "New network " + at.plan.network.label, function (on) {
        at.ticks.network = on;
        count();
      }));
      rows.appendChild(net);
    }
    at.plan.hosts.forEach(function (h) {
      var li = el("li", null, "nmap-host");
      var head = check(at.ticks.hosts[h.key], h.label + " · " + h.addresses.join(", "), function (on) {
        at.ticks.hosts[h.key] = on;
        h.ports.forEach(function (r) { at.ticks.ports[r.key] = on && (!r.known || r.addsFlow); });
        preview();
      });
      head.appendChild(role(h));
      head.appendChild(state(h));
      li.appendChild(head);
      var ports = el("ul", null, "nmap-ports");
      h.ports.forEach(function (r) {
        var nothing = r.known && !r.addsFlow;
        var what = nothing ? "known" : r.known ? "adds the flow" : "adds service, " + (r.product.existing ? "uses " : "") + r.product.label + ", flow";
        var row = check(!!at.ticks.ports[r.key], r.label + " · " + r.proto + " · " + what, function (on) {
          at.ticks.ports[r.key] = on;
          count();
        });
        row.querySelector("input").disabled = nothing || !at.ticks.hosts[h.key];
        var item = el("li");
        item.appendChild(row);
        ports.appendChild(item);
      });
      li.appendChild(ports);
      rows.appendChild(li);
    });
    var notes = [];
    if (at.plan.hosts.some(function (h) { return h.ports.some(function (r) { return !r.known; }); })) notes.push("Services run at an unknown privilege until you set it on their link.");
    if (at.plan.silentUdp) notes.push(at.plan.silentUdp + " UDP ports gave no answer (open|filtered); not added.");
    if (at.plan.tcpwrapped) notes.push(at.plan.tcpwrapped + (at.plan.tcpwrapped === 1 ? " port" : " ports") + " closed at once (tcpwrapped); not added.");
    $("nmap-notes").textContent = notes.join(" ");
    $("nmap-ask").hidden = true;
    $("nmap-preview").hidden = false;
    count();
  }
  function keep(old, fresh) {
    var out = {};
    Object.keys(fresh).forEach(function (k) { out[k] = k in old ? old[k] : fresh[k]; });
    return out;
  }
  function check(on, text, change) {
    var label = el("label", null, "nmap-row");
    var box = el("input");
    box.type = "checkbox";
    box.checked = !!on;
    box.addEventListener("change", function () { change(box.checked); });
    label.appendChild(box);
    label.appendChild(el("span", text));
    return label;
  }
  // Spec §4.5: host, router on its box, or router with its firewall;
  // preselected only from what nmap called the device, which is said.
  var ROLES = [["host", "host"], ["router", "router"], ["firewall", "router with firewall"]];
  function role(h) {
    var box = el("span", null, "nmap-role");
    if (h.device) box.appendChild(el("span", "nmap: " + h.device, "hint"));
    if (!h.roleOffered) return box;
    var menu = window.effractorMenu.dropdown(ROLES, at.ticks.roles[h.key] || "host");
    menu.classList.add("nmap-merge");
    menu.addEventListener("change", function () {
      at.ticks.roles[h.key] = menu.value;
      count();
    });
    box.appendChild(menu);
    return box;
  }

  // Known, or new with a choice to merge it into a hand-drawn host.
  function state(h) {
    if (h.known) return el("span", "known as “" + doc().entities[h.known].label + "”", "hint");
    // A drawn host another row has taken is not offered again.
    var taken = at.plan.hosts.filter(function (o) { return o.key !== h.key && o.merged; }).map(function (o) { return o.merged; });
    var free = at.plan.candidates.filter(function (id) { return taken.indexOf(id) < 0; });
    var options = [["", "new"]].concat(free.map(function (id) {
      return [id, "same as “" + doc().entities[id].label + "”"];
    }));
    var menu = window.effractorMenu.dropdown(options, h.merged || "");
    menu.classList.add("nmap-merge");
    menu.addEventListener("change", function () {
      at.merges[h.key] = menu.value; // "" is a chosen "new": no guess returns
      preview();
    });
    if (!h.guessed) return menu;
    // nmap's own host, by its name in the scan: said, and one click to undo.
    var both = el("span", null, "nmap-merge-state");
    both.appendChild(el("span", "nmap runs here?", "hint"));
    both.appendChild(menu);
    return both;
  }
  function count() {
    var c = U.catalog();
    var s = N.summary(doc(), at.plan, at.ticks, c ? c.limits : null);
    var parts = [[s.hosts, "host"], [s.networks, "network"], [s.attached, "attachment"], [s.routers, "router"], [s.firewalls, "firewall"], [s.services, "service"], [s.products, "product"], [s.flows, "flow"]].filter(function (x) { return x[0]; }).map(function (x) {
      return x[0] + " " + x[1] + (x[0] === 1 ? "" : "s");
    });
    $("nmap-summary").textContent = s.tooMany || (parts.length ? "Adds " + parts.join(", ") + "." : "Nothing new to add.");
    $("nmap-add").disabled = !!s.tooMany;
  }

  function add() {
    var stamp = N.stampFor(at.scan, $("nmap-range").value, new Date().toISOString().slice(0, 10));
    var edit;
    try {
      edit = N.apply(doc(), at.plan, at.ticks, specOf, stamp);
    } catch (e) {
      console.error(e);
      app.say("the nmap import could not be applied");
      return;
    }
    dialog.close();
    if (!edit) return app.say("nothing new to add");
    U.apply(function () { return edit; });
  }

  // ---- menus ----

  function createNmap(hostId) {
    U.loadCatalog().then(function () {
      var made = null;
      U.apply(function () {
        var e = N.addNmap(doc(), hostId, "nmap", specOf);
        made = e && e.entity;
        return e;
      }).then(function (applied) {
        if (applied && made) open(made);
      });
    }, function () {
      app.say("the component library could not be read");
    });
  }
  U.kindExtras.application = function () {
    return [["nmap", "", function () { createNmap(null); }, { title: "Scan from a host and add what it sees" }]];
  };
  U.linkedExtras.push(function (id) {
    var e = doc().entities[id];
    return e && e.kind === "host" ? [["nmap", "", function () { createNmap(id); }, { hint: "runs here as user" }]] : [];
  });
  U.menuItems.push(function (id) {
    var e = doc().entities[id];
    return e && e.tool === "nmap" ? [["Paste nmap result…", "", function () { open(id); }]] : [];
  });

  // ---- wiring ----

  $("nmap-range").addEventListener("input", showCommand);
  $("nmap-copy").addEventListener("click", function () {
    function failed() {
      app.say("copy failed; select the command instead");
    }
    try {
      navigator.clipboard.writeText($("nmap-command").textContent).then(function () {
        app.say("command copied");
      }, failed);
    } catch (e) {
      failed(); // no clipboard on a plain-http page
    }
  });
  $("nmap-read").addEventListener("click", read);
  $("nmap-back").addEventListener("click", function () {
    $("nmap-ask").hidden = false;
    $("nmap-preview").hidden = true;
  });
  $("nmap-add").addEventListener("click", add);
  $("nmap-cancel").addEventListener("click", function () { dialog.close(); });
  $("nmap-close").addEventListener("click", function () { dialog.close(); });
  var paste = $("nmap-paste");
  paste.addEventListener("dragover", function (e) { e.preventDefault(); });
  paste.addEventListener("drop", function (e) {
    var file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    file.text().then(function (t) {
      paste.value = t;
      read();
    });
  });
})();
