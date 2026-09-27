// The nmap dialog (the nmap import design §3, in history: see
// docs/HANDOFF.md; nmap recipes spec §2): say what the scan is for, copy the
// command, paste the XML, tick the preview, add. What it decides is nmap.js's; this file only shows it. Everything
// from a scan is set as text.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var N = window.effractorNmap;
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $("nmap-dialog");
  // What the scan is for is kept for the session, as the range is not.
  var asked = { recipes: ["services"], adjust: {}, portList: "", ack: false };
  var at = { app: null, scan: null, merges: {}, ticks: null, plan: null };

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

  function recipes() {
    var box = $("nmap-recipes");
    box.textContent = "";
    N.RECIPES.forEach(function (r) {
      var label = el("label", null, "nmap-recipe");
      var tick = el("input");
      tick.type = "checkbox";
      tick.checked = asked.recipes.indexOf(r.id) >= 0;
      tick.addEventListener("change", function () {
        var others = asked.recipes.filter(function (id) { return id !== r.id; });
        // One that goes alone unticks the rest, and is unticked by them.
        if (tick.checked) {
          asked.recipes = r.alone ? [r.id] : others.filter(function (id) {
            return !N.RECIPES.some(function (o) { return o.id === id && o.alone; });
          }).concat([r.id]);
        } else asked.recipes = others;
        // The blocks are the recipes' again: an adjustment was of the old set.
        asked.adjust = {};
        recipes();
        blocks();
        showCommand();
      });
      label.appendChild(tick);
      label.appendChild(el("span", r.name, "nmap-recipe-name"));
      var tags = el("span", null, "nmap-tags");
      if (N.combine([r.id], {}).root) tags.appendChild(el("span", "root", "nmap-tag is-root"));
      tags.appendChild(el("span", r.time, "nmap-tag"));
      label.appendChild(tags);
      label.appendChild(el("span", r.finds, "hint"));
      box.appendChild(label);
    });
  }
  // Spec §2.1: the blocks the ticked recipes set, each one changeable.
  function blockRow(name, control, hint, warning, set) {
    var row = el("label", null, "nmap-block" + (set ? " is-set" : ""));
    row.appendChild(el("span", name));
    row.appendChild(control);
    if (hint) row.appendChild(el("span", hint, warning ? "hint warning" : "hint"));
    return row;
  }
  function blocks() {
    var box = $("nmap-blocks");
    box.textContent = "";
    var c = N.combine(asked.recipes, asked.adjust);
    $("nmap-adjust").hidden = !c.choices;
    if (!c.choices) return;
    var set = [];
    N.BLOCKS.forEach(function (b) {
      var menu = window.effractorMenu.dropdown(b.choices.map(function (x) { return [x.id, x.name]; }), c.choices[b.id]);
      menu.addEventListener("change", function () {
        asked.adjust[b.id] = menu.value;
        blocks();
        showCommand();
      });
      var chosen = b.choices.filter(function (x) { return x.id === c.choices[b.id]; })[0];
      var differs = c.choices[b.id] !== N.DEFAULTS[b.id];
      if (differs) set.push(b.name + ": " + chosen.name);
      box.appendChild(blockRow(b.name, menu, chosen.warning || chosen.hint, !!chosen.warning, differs));
      if (b.id === "ports" && c.choices.ports === "list") {
        var list = el("input");
        list.type = "text";
        list.value = asked.portList;
        list.placeholder = "22,80,8000-8100";
        list.spellcheck = false;
        list.autocomplete = "off";
        list.addEventListener("input", function () {
          asked.portList = list.value;
          showCommand();
        });
        var firewall = asked.recipes.indexOf("firewall") >= 0;
        box.appendChild(blockRow("Port list", list, firewall ? "besides the ports of the flows drawn through a firewall and the 100 most common" : "numbers and ranges · U: before UDP ports", false, !!asked.portList));
      }
    });
    if (asked.recipes.indexOf("firewall") >= 0) {
      var ack = el("input");
      ack.type = "checkbox";
      ack.checked = asked.ack;
      ack.addEventListener("change", function () {
        asked.ack = ack.checked;
        blocks();
        showCommand();
      });
      if (asked.ack) set.push("ACK scan");
      box.appendChild(blockRow("ACK scan", ack, "a second command · tells a firewall that keeps state from one that does not", false, asked.ack));
    }
    // Closed, the fold says what is set.
    $("nmap-set").textContent = set.join(" · ");
  }
  // The ports the firewall recipe takes from the drawing (spec §2.3).
  function drawnPorts() {
    return N.drawnPorts ? N.drawnPorts(doc(), at.app, $("nmap-range").value) : [];
  }
  function showCommand() {
    var c = N.command(asked.recipes, asked.adjust, $("nmap-range").value, { portList: asked.portList, ack: asked.ack, drawnPorts: drawnPorts() });
    $("nmap-command").textContent = c.text || "";
    $("nmap-root").hidden = !c.root;
    $("nmap-copy").disabled = !c.text;
    $("nmap-second").textContent = c.second || "";
    $("nmap-second-row").hidden = !c.second;
    $("nmap-problem").textContent = c.problem || c.note || "";
  }

  // ---- open ----

  function open(appId) {
    at = { app: appId, scan: null, merges: {}, ticks: null, plan: null };
    var host = hostOf(appId);
    $("nmap-title").textContent = host ? "nmap on " + doc().entities[host].label : "nmap (not on a host)";
    $("nmap-unplaced").hidden = !!host;
    $("nmap-range").value = prefillRange(host);
    $("nmap-paste").value = "";
    $("nmap-problem").textContent = "";
    $("nmap-read-problem").textContent = "";
    $("nmap-ask").hidden = false;
    $("nmap-preview").hidden = true;
    recipes();
    blocks();
    showCommand();
    U.loadCatalog().catch(function () {}).then(function () {
      if (!dialog.open) dialog.showModal();
    });
  }

  // ---- read and preview ----

  function read() {
    var r = N.read($("nmap-paste").value);
    $("nmap-read-problem").textContent = r.problem ? r.problem.message : "";
    if (r.problem) return;
    at.scan = r.scan;
    at.merges = {};
    at.ticks = null;
    preview();
  }

  function preview() {
    var old = at.ticks;
    at.plan = N.plan(doc(), at.app, at.scan, $("nmap-range").value, at.merges);
    var fresh = N.defaults(at.plan);
    // What was ticked stays ticked over a new plan; what is new takes its default.
    if (old) {
      at.ticks = {};
      Object.keys(fresh).forEach(function (group) {
        var was = old[group];
        at.ticks[group] = fresh[group] && typeof fresh[group] === "object" ? keep(was || {}, fresh[group]) : was == null ? fresh[group] : was;
      });
    } else at.ticks = fresh;
    var rows = $("nmap-rows");
    rows.textContent = "";
    changes(rows);
    if (at.plan.network) {
      var net = el("li", null, "nmap-host");
      var netHead = check(at.ticks.network, "Network", function (on) {
        at.ticks.network = on;
        count();
      }, { mono: at.plan.network.label });
      netHead.appendChild(networkState(at.plan));
      net.appendChild(netHead);
      rows.appendChild(net);
    }
    onTheWay(rows);
    // One box for every host, where there are several (a /16 is past the limits).
    if (at.plan.hosts.length > 1) {
      var all = el("li", null, "nmap-host");
      all.appendChild(check(at.plan.hosts.every(function (h) { return h.conflict || at.ticks.hosts[h.key]; }), "all hosts", function (on) {
        N.tickHosts(at.plan, at.ticks, on);
        preview();
      }));
      rows.appendChild(all);
    }
    at.plan.hosts.forEach(function (h) {
      var li = el("li", null, "nmap-host");
      var head = check(at.ticks.hosts[h.key], h.label, function (on) {
        N.tickHost(h, at.ticks, on);
        preview();
      }, { mono: h.addresses.filter(function (a) { return a !== h.label; }).join(", ") });
      head.appendChild(role(h));
      head.appendChild(state(h));
      li.appendChild(head);
      var ports = el("ul", null, "nmap-ports");
      h.ports.forEach(function (r) {
        var nothing = r.known && !r.addsFlow;
        var what = nothing ? "known" : r.known ? "adds the flow" : "adds service, " + (r.product.existing ? "uses " : "") + r.product.label + ", flow";
        var row = check(!!at.ticks.ports[r.key], r.label, function (on) {
          at.ticks.ports[r.key] = on;
          // A new port unticked takes its findings along.
          if (!r.known && r.findings.length) {
            r.findings.forEach(function (f) { at.ticks.findings[f.key] = on && !f.known && !f.patchedByAuthor; });
            return preview();
          }
          count();
        }, { mono: r.proto, what: what });
        row.querySelector("input").disabled = nothing || !at.ticks.hosts[h.key];
        var item = el("li");
        item.appendChild(row);
        item.appendChild(findings(h, r));
        ports.appendChild(item);
      });
      li.appendChild(ports);
      li.appendChild(about(h));
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
    if (at.scan.sharedMacs) notes.push(at.scan.sharedMacs + (at.scan.sharedMacs === 1 ? " MAC answers" : " MACs answer") + " for several addresses (a router or proxy); not used to tell machines apart.");
    at.plan.changes.notes.forEach(function (n) { notes.push(n); });
    if (at.plan.tcpwrapped) notes.push(at.plan.tcpwrapped + (at.plan.tcpwrapped === 1 ? " port" : " ports") + " closed at once (tcpwrapped); not added.");
    $("nmap-notes").textContent = notes.join(" ");
    $("nmap-ask").hidden = true;
    $("nmap-preview").hidden = false;
    count();
  }
  // Nmap recipes spec §5.2: what differs from the drawing, in plain words,
  // each with what ticking it does; nothing is ticked at first.
  function changes(rows) {
    var ch = at.plan.changes;
    var apart = at.plan.hosts.filter(function (h) { return h.conflict; });
    if (!ch.list.length && !apart.length) return;
    var li = el("li", null, "nmap-host nmap-changes");
    li.appendChild(el("span", "Changes" + (ch.since ? " since " + ch.since : ""), "label"));
    var list = el("ul", null, "nmap-ports");
    apart.forEach(function (h) {
      var was = doc().entities[h.conflict.host];
      var kind = h.conflict.type === "mac" ? "MAC" : "SSH key";
      var row = el("span", null, "nmap-row warning");
      row.appendChild(el("span", h.addresses.join(", ") + " answers with another " + kind + " than “" + was.label + "” · reinstalled, new hardware, or another machine?"));
      var chosen = !at.ticks.hosts[h.key] ? "" : h.conflict.choice;
      var menu = window.effractorMenu.dropdown([["", "leave it out"], ["new", "another machine · a new host"], ["same", "the same machine · update its identity"]], chosen);
      menu.classList.add("nmap-merge");
      menu.addEventListener("change", function () {
        at.merges.conflicts = at.merges.conflicts || {};
        if (menu.value === "same") at.merges.conflicts[h.key] = "same";
        else delete at.merges.conflicts[h.key];
        N.tickHost(h, at.ticks, menu.value !== "");
        preview();
      });
      row.appendChild(menu);
      var item = el("li");
      item.appendChild(row);
      list.appendChild(item);
    });
    ch.list.forEach(function (c) {
      var item = el("li");
      if (c.action) {
        var row = check(!!at.ticks.changes[c.key], c.line, function (on) {
          at.ticks.changes[c.key] = on;
          count();
        }, { what: c.action });
        if (c.warn) row.classList.add("warning");
        item.appendChild(row);
      } else item.appendChild(el("span", c.line, "nmap-row"));
      list.appendChild(item);
    });
    li.appendChild(list);
    rows.appendChild(li);
  }
  // Spec §4.3, §4.4: the routers the traces went by that are not scanned
  // hosts themselves, and the networks between hops.
  function onTheWay(rows) {
    var p = at.plan;
    if (!p.routers.length) return;
    var li = el("li", null, "nmap-host");
    li.appendChild(el("span", "On the way", "label"));
    var list = el("ul", null, "nmap-ports");
    p.routers.forEach(function (r) {
      var to = "on the way to " + r.targets + (r.targets === 1 ? " host" : " hosts");
      var item = el("li");
      if (r.row) item.appendChild(el("span", r.label + " · " + to + " · a scanned host, below", "nmap-row"));
      else {
        var what = r.router ? "known router" : r.known ? "adds a router on “" + r.label + "”" : "adds the box and its router";
        var row = check(!!at.ticks.routers[r.key], "router at " + r.address + (r.label !== r.address ? " · " + r.label : "") + " · " + to + " · " + what, function (on) {
          at.ticks.routers[r.key] = on;
          count();
        });
        row.querySelector("input").disabled = !!r.router;
        item.appendChild(row);
      }
      list.appendChild(item);
    });
    p.links.forEach(function (l) {
      var net = l.network === "new" ? p.network && p.network.label : l.network ? doc().entities[l.network].label : null;
      list.appendChild(plain(net ? "“" + net + "” joins " + l.label.replace(/^between /, "") : "adds network " + l.label));
    });
    li.appendChild(list);
    rows.appendChild(li);
  }
  // Spec §3.3, §3.4: what the scan says of the host itself: what
  // identifies it, where it moved, its better name, the way to it.
  function about(h) {
    var list = el("ul", null, "nmap-findings");
    var on = !!at.ticks.hosts[h.key];
    function offer(group, text) {
      var row = check(!!at.ticks[group][h.key], text, function (ticked) {
        at.ticks[group][h.key] = ticked;
        count();
      });
      row.querySelector("input").disabled = !on;
      var item = el("li");
      item.appendChild(row);
      list.appendChild(item);
    }
    var target = h.known || h.merged;
    if (h.moved) {
      offer("moves", "moved" + (h.moved.from.length ? " from " + h.moved.from.join(", ") : "") + " to " + h.moved.to.join(", ") + " · updates its addresses");
      h.moved.others.forEach(function (o) {
        offer("strips", "takes " + h.moved.to.join(", ") + " from “" + doc().entities[o].label + "”");
      });
    }
    if (h.rename) offer("renames", "rename to “" + h.rename.to + "” · its " + h.rename.from + " name");
    if (h.newIdentities.length) {
      var words = N.identityWords(h.newIdentities, h.vendor);
      if (target && !(h.conflict && h.conflict.choice === "same")) offer("identities", "adds " + words);
      else list.appendChild(plain(words));
    }
    if (h.sharedIdentity) list.appendChild(plain("two drawn hosts share " + N.identityWords([h.sharedIdentity]) + " · matched by address"));
    var way = N.routeSaid(at.plan, h.key);
    if (way) list.appendChild(plain(way));
    return list;
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
  // A row to tick: what it is; `more.mono`, its address or port; `more.what`,
  // what ticking it does.
  function check(on, text, change, more) {
    var label = el("label", null, "nmap-row");
    var box = el("input");
    box.type = "checkbox";
    box.checked = !!on;
    box.addEventListener("change", function () { change(box.checked); });
    label.appendChild(box);
    label.appendChild(el("span", text));
    if (more && more.mono != null) label.appendChild(el("span", more.mono, "nmap-mono"));
    if (more && more.what != null) label.appendChild(el("span", more.what, "nmap-what"));
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
    if (h.known) return el("span", "known as “" + doc().entities[h.known].label + "”" + (h.matchedBy === "identity" ? " · by its " + (h.identities.some(function (i) { return i.indexOf("mac:") === 0 && (doc().entities[h.known].identities || []).indexOf(i) >= 0; }) ? "MAC" : "SSH key") : ""), "hint");
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
    both.appendChild(el("span", h.guessedBy === "name" ? "same name?" : "nmap runs here?", "hint"));
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
    var said = N.said(N.summary(doc(), at.plan, at.ticks, null));
    dialog.close();
    if (!edit) return app.say("nothing new to add");
    // What came in is clustered by host, open; a drawing nobody arranged by
    // hand yet is arranged afresh (owner, 2026-09-25).
    edit.doc = window.effractorClusters.gather(doc(), edit.doc);
    var untouched = !Object.keys(app.storedPositions()).length;
    U.apply(function () { return edit; }).then(function (applied) {
      if (!applied) return;
      if (untouched) app.arrange();
      // What came in, said; the unpatched products one click from selected.
      var unpatched = Object.keys(doc().entities || {}).filter(function (id) {
        var e = doc().entities[id];
        return e.kind === "product" && e.defenses && e.defenses.patched === false;
      });
      var text = said.replace(/^Adds /, "added ").replace(/\.$/, "") + " · Ctrl+Z undoes";
      app.say(text, unpatched.length ? [["Show vulnerable", function () {
        app.pick(unpatched.map(function (id) { return "entity/" + id; }));
      }]] : null);
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
  // The same from the inspector (owner, 2026-09-27): another scan adds to
  // what the earlier ones drew.
  U.rowExtras.push(function (form, id, e) {
    if (e.tool !== "nmap") return;
    var paste = el("button", "Paste result…", "btn btn-ghost btn-small");
    paste.type = "button";
    paste.title = "Add another scan to the map";
    paste.addEventListener("click", function () { open(id); });
    U.field(form, "prop-nmap-paste", "Scan", paste);
  });

  // Nmap recipes spec §3.5: what identified a host and when it was seen,
  // in one quiet row; absent when there is nothing.
  U.rowExtras.push(function (form, id, e) {
    if (e.kind !== "host") return;
    var parts = [];
    if ((e.identities || []).length) parts.push(N.identityWords(e.identities, e.vendor));
    else if (e.vendor) parts.push(e.vendor);
    if (e.missed) parts.push("not seen since " + e.missed);
    if (e.seen) parts.push((e.missed ? "last seen " : "seen ") + e.seen);
    if (!parts.length) return;
    var said = el("span", parts.join(" · "), "identity");
    said.title = "From nmap: what a later scan knows this machine by";
    U.field(form, "prop-identity", "Identity", said);
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
  function copies(button, code) {
    $(button).addEventListener("click", function () {
      function failed() {
        app.say("copy failed; select the command instead");
      }
      try {
        navigator.clipboard.writeText($(code).textContent).then(function () {
          app.say("command copied");
        }, failed);
      } catch (e) {
        failed(); // no clipboard on a plain-http page
      }
    });
  }
  copies("nmap-copy", "nmap-command");
  copies("nmap-copy-second", "nmap-second");
  $("nmap-read").addEventListener("click", read);
  $("nmap-back").addEventListener("click", function () {
    $("nmap-ask").hidden = false;
    $("nmap-preview").hidden = true;
  });
  $("nmap-add").addEventListener("click", add);
  $("nmap-cancel").addEventListener("click", function () { dialog.close(); });
  $("nmap-close").addEventListener("click", function () { dialog.close(); });
  var paste = $("nmap-paste");
  paste.addEventListener("dragover", function (e) {
    e.preventDefault();
    paste.classList.add("is-drop");
  });
  paste.addEventListener("dragleave", function () { paste.classList.remove("is-drop"); });
  paste.addEventListener("drop", function (e) {
    paste.classList.remove("is-drop");
    var file = e.dataTransfer && e.dataTransfer.files[0];
    if (!file) return;
    e.preventDefault();
    file.arrayBuffer().then(function (b) {
      paste.value = N.decodeFile(b);
      read();
    }, function () {
      app.say("the file could not be read");
    });
  });
})();
