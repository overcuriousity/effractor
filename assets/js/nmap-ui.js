// The nmap dialog (the nmap import design §3, in history: see
// docs/HANDOFF.md): choose a level, copy the command, paste the XML, tick the preview,
// add. What it decides is nmap.js's; this file only shows it. Everything
// from a scan is set as text.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var N = window.effractorNmap;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $("nmap-dialog");
  var at = { app: null, level: "standard", checks: "none", scan: null, merges: {}, ticks: null, plan: null };

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
  // Spec §3.2: nmap's vulnerability checks; none for Discover (no ports).
  var CHECK_HINTS = { none: "no scripts", safe: "vulnerability checks that break nothing · slower" };
  function checks() {
    var box = $("nmap-checks");
    while (box.children.length > 1) box.removeChild(box.lastChild);
    N.CHECKS.forEach(function (c) {
      var label = el("label", null, "nmap-level");
      var radio = el("input");
      radio.type = "radio";
      radio.name = "nmap-checks";
      radio.value = c.id;
      radio.checked = c.id === at.checks;
      radio.addEventListener("change", function () {
        at.checks = c.id;
        showCommand();
      });
      label.appendChild(radio);
      label.appendChild(el("span", c.name));
      label.appendChild(el("span", c.warning || CHECK_HINTS[c.id], c.warning ? "hint warning" : "hint"));
      box.appendChild(label);
    });
  }
  function showCommand() {
    $("nmap-checks").hidden = !N.checksOffered(at.level);
    var c = N.command(at.level, $("nmap-range").value, at.checks);
    $("nmap-command").textContent = c && c.text ? c.text : "";
    $("nmap-copy").disabled = !(c && c.text);
    $("nmap-problem").textContent = c ? c.problem || c.note || "" : "";
  }

  // ---- open ----

  function open(appId) {
    at = { app: appId, level: at.level, checks: at.checks, scan: null, merges: {}, ticks: null, plan: null };
    var host = hostOf(appId);
    $("nmap-title").textContent = host ? "nmap on " + doc().entities[host].label : "nmap (not on a host)";
    $("nmap-unplaced").hidden = !!host;
    $("nmap-range").value = prefillRange(host);
    $("nmap-paste").value = "";
    $("nmap-problem").textContent = "";
    $("nmap-ask").hidden = false;
    $("nmap-preview").hidden = true;
    levels();
    checks();
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
    showCommand(); // an earlier read's problem is gone; the command's note stays
    preview();
  }

  function preview() {
    var old = at.ticks;
    at.plan = N.plan(doc(), at.app, at.scan, $("nmap-range").value, at.merges);
    var fresh = N.defaults(at.plan);
    at.ticks = old ? { hosts: keep(old.hosts, fresh.hosts), ports: keep(old.ports, fresh.ports), roles: keep(old.roles, fresh.roles), findings: keep(old.findings, fresh.findings), network: old.network } : fresh;
    var rows = $("nmap-rows");
    rows.textContent = "";
    if (at.plan.network) {
      var net = el("li", null, "nmap-host");
      var netHead = check(at.ticks.network, "Network " + at.plan.network.label, function (on) {
        at.ticks.network = on;
        count();
      });
      netHead.appendChild(networkState(at.plan));
      net.appendChild(netHead);
      rows.appendChild(net);
    }
    // One box for every host, where there are several (a /16 is past the limits).
    if (at.plan.hosts.length > 1) {
      var all = el("li", null, "nmap-host");
      all.appendChild(check(at.plan.hosts.every(function (h) { return at.ticks.hosts[h.key]; }), "all hosts", function (on) {
        N.tickHosts(at.plan, at.ticks, on);
        preview();
      }));
      rows.appendChild(all);
    }
    at.plan.hosts.forEach(function (h) {
      var li = el("li", null, "nmap-host");
      var head = check(at.ticks.hosts[h.key], h.label + " · " + h.addresses.join(", "), function (on) {
        N.tickHost(h, at.ticks, on);
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
          // A new port unticked takes its findings along.
          if (!r.known && r.findings.length) {
            r.findings.forEach(function (f) { at.ticks.findings[f.key] = on && !f.known && !f.patchedByAuthor; });
            return preview();
          }
          count();
        });
        row.querySelector("input").disabled = nothing || !at.ticks.hosts[h.key];
        var item = el("li");
        item.appendChild(row);
        item.appendChild(findings(h, r));
        ports.appendChild(item);
      });
      li.appendChild(ports);
      // Host checks with no port to go to, and scripts not read.
      var loose = el("ul", null, "nmap-findings");
      h.unplaced.forEach(function (f) { loose.appendChild(plain(f.script + " · " + f.id + " · not applied: no SMB service")); });
      h.unread.forEach(function (u) { loose.appendChild(plain(u.script + " · " + u.text)); });
      if (loose.children.length) li.appendChild(loose);
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
  // Spec §3.4, §4.6: each finding under its port, and what is not read.
  function findings(h, r) {
    var list = el("ul", null, "nmap-findings");
    var present = at.ticks.hosts[h.key] && (r.known || at.ticks.ports[r.key]);
    r.findings.forEach(function (f) {
      var what = f.patchedByAuthor ? "marked patched by you; not changed" : f.known ? "already marked" : "marks " + f.productLabel + " unpatched";
      var row = check(!!at.ticks.findings[f.key], f.script + " · " + f.id + " · " + what, function (on) {
        at.ticks.findings[f.key] = on;
        count();
      });
      row.title = f.line;
      row.querySelector("input").disabled = f.known || f.patchedByAuthor || !present;
      var item = el("li");
      item.appendChild(row);
      list.appendChild(item);
    });
    r.unread.forEach(function (u) { list.appendChild(plain(u.script + " · " + u.text)); });
    return list;
  }
  function plain(text) {
    var item = el("li");
    item.appendChild(el("span", text, "nmap-row"));
    return item;
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
  // The proposed network: new, or a drawn one without addresses it fills
  // (spec §4.2), guessed when nmap's host is on it, as a host is.
  function networkState(p) {
    var options = [["", "new"]].concat(p.networkCandidates.map(function (id) {
      return [id, "same as “" + doc().entities[id].label + "”"];
    }));
    var menu = window.effractorMenu.dropdown(options, p.network.merged || "");
    menu.classList.add("nmap-merge");
    menu.addEventListener("change", function () {
      at.merges.network = menu.value; // "" is a chosen "new": no guess returns
      preview();
    });
    if (!p.network.guessed) return menu;
    var both = el("span", null, "nmap-merge-state");
    both.appendChild(el("span", "nmap is on it?", "hint"));
    both.appendChild(menu);
    return both;
  }
  function count() {
    var c = U.catalog();
    var s = N.summary(doc(), at.plan, at.ticks, c ? c.limits : null);
    $("nmap-summary").textContent = s.tooMany || N.said(s);
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
    // What came in is clustered by host, open; a drawing nobody arranged by
    // hand yet is arranged afresh (owner, 2026-09-25).
    edit.doc = window.effractorClusters.gather(doc(), edit.doc);
    var untouched = !Object.keys(app.storedPositions()).length;
    U.apply(function () { return edit; }).then(function (applied) {
      if (applied && untouched) app.arrange();
    });
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

  // ---- the light bulb (owner, 2026-09-24) ----

  // Dismissed once, gone on this browser; a convenience, so storage that
  // fails only means it shows again.
  var HINT = "effractor.hint.nmap";
  function dismissed() {
    try {
      return localStorage.getItem(HINT) === "dismissed";
    } catch (e) {
      return false;
    }
  }
  function showHint() {
    $("nmap-hint").hidden = !N.hintWanted(doc(), dismissed());
  }
  $("nmap-hint-go").addEventListener("click", function () {
    // On the selected host when one is selected, as Tab would.
    var q = window.effractorProfiles.qualified(app.state.selected);
    var e = q && q.kind === "entity" ? doc().entities[q.id] : null;
    createNmap(e && e.kind === "host" ? q.id : null);
  });
  $("nmap-hint-close").addEventListener("click", function () {
    try {
      localStorage.setItem(HINT, "dismissed");
    } catch (e) {}
    showHint();
  });
  app.onChange(showHint);
  showHint();

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
    }, function () {
      app.say("the file could not be read");
    });
  });
})();
