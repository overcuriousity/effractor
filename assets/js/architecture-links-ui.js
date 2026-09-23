// Relationships, flows and the attacker, in the architecture editor (spec 10):
// one Link action on the selected component, its links and flows listed in
// its form, the foothold and target pickers, and the forms of a selected
// relationship or flow. It decides which edit; architecture-links.js makes
// it; wasm says whether it is valid. Nothing is filled in by itself: a flow
// starts with an empty route and no permission until the author gives one.
(function () {
  if (typeof document === "undefined") return;
  var app = window.effractor;
  var U = window.effractorArchitectureUi;
  var L = window.effractorArchitectureLinks;
  var P = window.effractorProfiles;
  var M = window.effractorMenu;

  function doc() {
    return app.state.doc;
  }
  function own(map, key) {
    return map && Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null;
  }
  function name(id) {
    var e = own(doc().entities, id);
    return e ? e.label : id;
  }
  function kindOf(id) {
    var e = own(doc().entities, id);
    return e ? e.kind : null;
  }
  function executable(id) {
    return kindOf(id) === "application" || kindOf(id) === "service";
  }
  function selectedEntity() {
    var q = P.qualified(app.state.selected);
    return q && q.kind === "entity" && own(doc().entities, q.id) ? q.id : null;
  }
  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function button(text, title, act, cls) {
    var b = el("button", text, cls || "btn btn-ghost btn-small");
    b.type = "button";
    if (title) {
      b.title = title;
      b.setAttribute("aria-label", title);
    }
    b.addEventListener("click", act);
    return b;
  }

  var catalog = null;
  function withCatalog(then) {
    U.loadCatalog().then(function (c) {
      catalog = c;
      then(c);
    }, function () {
      app.say("the component library could not be read");
    });
  }

  // Where a menu opens: beside a control, or in the canvas.
  function at(anchor) {
    var box = (anchor || document.getElementById("canvas")).getBoundingClientRect();
    return anchor ? { x: box.right + 4, y: box.top } : { x: box.left + box.width / 2, y: box.top + box.height / 3 };
  }

  // ---- Link: kind, then the other end, then the privilege ----

  function linkWord(choice) {
    return choice.direction === "out" ? choice.kind + " →" : "← " + choice.kind;
  }

  function startLink(id, anchor) {
    withCatalog(function (c) {
      var where = at(anchor);
      var items = L.linkChoices(doc(), c, id)
        .filter(function (choice) {
          return choice.candidates.length > 0;
        })
        .map(function (choice) {
          return [linkWord(choice), "", function () { pickEnd(id, choice, where); }];
        });
      if (executable(id) && Object.keys(doc().entities).some(function (o) { return o !== id && kindOf(o) === "service"; })) {
        items.push(["flow →", "", function () { pickFlowTarget(id, where); }]);
      }
      if (!items.length) return app.say("nothing here to link “" + name(id) + "” to");
      app.showMenu(items, where.x, where.y);
    });
  }

  function pickEnd(id, choice, where) {
    var ends = choice.candidates.map(function (other) {
      return [name(other), kindOf(other), function () {
        var from = choice.direction === "out" ? id : other;
        var to = choice.direction === "out" ? other : id;
        var privileges = L.privileges(doc(), choice.kind, from, to);
        if (!privileges || privileges.length === 1) return link(id, choice.kind, from, to, privileges && privileges[0]);
        app.showMenu(privileges.map(function (p) {
          return [p, "", function () { link(id, choice.kind, from, to, p); }];
        }), where.x, where.y);
      }];
    });
    app.showMenu(ends, where.x, where.y);
  }

  // The selection stays on the component: the next link starts from it too.
  function link(id, kind, from, to, privilege) {
    U.apply(function () {
      var edit = L.putAssociation(doc(), null, { kind: kind, from: from, to: to, privilege: privilege });
      if (edit) edit.select = "entity/" + id;
      return edit;
    });
  }

  function pickFlowTarget(source, where) {
    var services = Object.keys(doc().entities).filter(function (o) {
      return o !== source && kindOf(o) === "service";
    });
    app.showMenu(services.map(function (target) {
      return [name(target), "service", function () {
        // An empty route: which networks and routers it crosses is said, not guessed.
        U.apply(function () {
          return L.putFlow(doc(), null, { label: name(source) + " to " + name(target), source: source, target: target, route: [] });
        });
      }];
    }), where.x, where.y);
  }

  // ---- in a component's form: links, flows, foothold, target ----

  function block(form, title, add) {
    var box = el("div", null, "link-block");
    var head = el("div", null, "link-head");
    head.appendChild(el("span", title));
    if (add) head.appendChild(add);
    box.appendChild(head);
    var list = el("ul", null, "link-list");
    box.appendChild(list);
    form.appendChild(box);
    return list;
  }

  function row(list, parts, select, title) {
    var item = el("li");
    var b = el("button", null, "link-row");
    b.type = "button";
    parts.forEach(function (p) {
      b.appendChild(el("span", p[0], p[1]));
    });
    if (title) b.title = title;
    b.addEventListener("click", function () {
      app.select(select);
    });
    item.appendChild(b);
    list.appendChild(item);
  }

  function entitySection(form, id) {
    var linkButton = button("+", "Link (L)", function () {
      startLink(id, linkButton);
    }, "btn btn-ghost btn-small link-add");
    var links = block(form, "Links", linkButton);
    L.linksOf(doc(), id).forEach(function (l) {
      var a = doc().associations[l.id];
      var arrow = l.direction === "out" ? "→" : "←";
      row(links, [[l.kind, "kind-word"], [arrow, "arrow"], [name(l.other), "name"], [a.privilege || "", "privilege"]], "association/" + l.id, l.id);
    });
    if (!links.children.length) links.appendChild(el("li", "none", "empty"));

    if (executable(id)) {
      var flowButton = button("+", "Flow to a service", function () {
        pickFlowTarget(id, at(flowButton));
      }, "btn btn-ghost btn-small link-add");
      var flows = block(form, "Flows", flowButton);
      L.flowsOf(doc(), id).forEach(function (f) {
        row(flows, [[doc().flows[f.id].label, "name"], [f.direction === "out" ? "→ " + name(f.other) : "← " + name(f.other), "privilege"]], "flow/" + f.id, f.id);
      });
      if (!flows.children.length) flows.appendChild(el("li", "none", "empty"));
    }
    attacker(form, id);
  }

  function statesOf(id) {
    var spec = catalog ? (catalog.entities || []).filter(function (e) { return e.kind === kindOf(id); })[0] : null;
    return spec ? spec.states : [];
  }

  function attacker(form, id) {
    if (!catalog) return withCatalog(function () { U.render(); });
    var states = statesOf(id);
    if (!states.length) return;
    var a = doc().attacker || {};
    var options = [["", "—"]].concat(states.map(function (s) { return [s, s]; }));
    var held = (a.footholds || []).filter(function (s) { return s.entity === id; }).map(function (s) { return s.state; });
    var foothold = U.field(form, "prop-foothold", "Foothold", M.dropdown(options, held[0] || ""));
    foothold.addEventListener("change", function () {
      var v = foothold.value;
      U.apply(function () {
        // One foothold per component: the chosen state replaces the others.
        var d = doc();
        var edit = null;
        held.forEach(function (s) {
          if (s === v) return;
          var e = L.setFoothold(d, id, s, false);
          if (e) d = (edit = e).doc;
        });
        if (v) {
          var add = L.setFoothold(d, id, v, true);
          if (add) edit = add;
        }
        return edit;
      }, null, true);
    });
    var targeted = a.target && a.target.entity === id ? a.target.state : "";
    var target = U.field(form, "prop-target", "Target", M.dropdown(options, targeted));
    target.addEventListener("change", function () {
      var v = target.value;
      U.apply(function () {
        return L.setTarget(doc(), id, v || null);
      }, null, true);
    });
  }

  // ---- a relationship's form ----

  function endButton(qualified, text) {
    var b = el("button", text, "link-row end");
    b.type = "button";
    b.addEventListener("click", function () {
      app.select(qualified);
    });
    return b;
  }

  function associationSection(form, id) {
    var a = doc().associations[id];
    U.field(form, "prop-kind", "Kind", el("span", a.kind, "mono"));
    U.field(form, "prop-from", "From", endButton("entity/" + a.from, name(a.from)));
    if (a.kind === "permits") {
      var f = own(doc().flows, a.to);
      U.field(form, "prop-to", "Flow", endButton("flow/" + a.to, f ? f.label : a.to));
    } else {
      U.field(form, "prop-to", "To", endButton("entity/" + a.to, name(a.to)));
    }
    var privileges = L.privileges(doc(), a.kind, a.from, a.to);
    if (privileges) {
      var options = privileges.concat(privileges.indexOf(a.privilege) < 0 && a.privilege ? [a.privilege] : []).map(function (p) { return [p, p]; });
      var privilege = U.field(form, "prop-privilege", "Privilege", M.dropdown(options, a.privilege));
      privilege.addEventListener("change", function () {
        U.apply(function () {
          return L.putAssociation(doc(), id, Object.assign({}, doc().associations[id], { privilege: privilege.value }));
        }, null, true);
      });
    }
    if (a.kind === "permits") {
      var allowed = U.field(form, "prop-allowed", "Allowed", M.dropdown(U.SWITCH, String(a.allowed)));
      allowed.addEventListener("change", function () {
        U.apply(function () {
          return L.putAssociation(doc(), id, Object.assign({}, doc().associations[id], { allowed: switchValue(allowed.value) }));
        }, null, true);
      });
    }
    var note = U.field(form, "prop-description", "Note", U.input("textarea", a.description));
    note.addEventListener("change", function () {
      U.apply(function () {
        return L.putAssociation(doc(), id, Object.assign({}, doc().associations[id], { description: note.value }));
      }, null, true);
    });
    U.problems(form, "associations." + id);
  }

  function switchValue(v) {
    return v === "true" ? true : v === "false" ? false : "unknown";
  }

  // ---- a flow's form: ends, route, permissions, connect ----

  function flowValue(id, change) {
    var f = doc().flows[id];
    return Object.assign({ label: f.label, source: f.source, target: f.target, route: f.route, protocol: f.protocol }, change);
  }

  function putFlow(id, change) {
    U.apply(function () {
      return L.putFlow(doc(), id, flowValue(id, change));
    }, null, true);
  }

  function flowSection(form, id) {
    var f = doc().flows[id];
    var label = U.field(form, "prop-label", "Label", U.input("text", f.label));
    label.addEventListener("change", function () {
      putFlow(id, { label: label.value });
    });
    label.addEventListener("keydown", function (ev) {
      if (ev.key !== "Enter" && ev.key !== "Escape") return;
      ev.preventDefault();
      if (ev.key === "Escape") label.value = f.label;
      label.blur();
    });
    var ids = Object.keys(doc().entities);
    var pick = function (kinds, current) {
      var options = ids.filter(function (o) { return kinds.indexOf(kindOf(o)) >= 0; }).map(function (o) { return [o, name(o)]; });
      if (current && !options.some(function (o) { return o[0] === current; })) options.push([current, current]);
      return M.dropdown(options, current);
    };
    var source = U.field(form, "prop-source", "From", pick(["application", "service"], f.source));
    source.addEventListener("change", function () {
      putFlow(id, { source: source.value });
    });
    var target = U.field(form, "prop-target-service", "To", pick(["service"], f.target));
    target.addEventListener("change", function () {
      putFlow(id, { target: target.value });
    });

    // The route, hop by hop; + offers what can come next, − takes the last.
    var route = el("div", null, "route");
    (f.route || []).forEach(function (hop, i) {
      if (i) route.appendChild(el("span", "›", "arrow"));
      route.appendChild(endButton("entity/" + hop, name(hop)));
    });
    if (!(f.route || []).length) route.appendChild(el("span", "?", "empty"));
    var add = button("+", (f.route || []).length % 2 ? "Add a router" : "Add a network", function () {
      var where = at(add);
      var hops = L.nextHops(doc(), doc().flows[id]);
      if (!hops.length) return app.say("no " + ((f.route || []).length % 2 ? "router" : "network") + " left to add");
      app.showMenu(hops.map(function (hop) {
        return [name(hop), kindOf(hop), function () {
          putFlow(id, { route: (doc().flows[id].route || []).concat([hop]) });
        }];
      }), where.x, where.y);
    }, "btn btn-ghost btn-small link-add");
    route.appendChild(add);
    if ((f.route || []).length) {
      route.appendChild(button("−", "Remove the last hop", function () {
        putFlow(id, { route: doc().flows[id].route.slice(0, -1) });
      }, "btn btn-ghost btn-small link-add"));
    }
    U.field(form, "prop-route", "Route", route);

    var protocol = U.field(form, "prop-protocol", "Protocol", U.input("text", f.protocol));
    protocol.placeholder = "tcp/22";
    protocol.classList.add("mono");
    protocol.addEventListener("change", function () {
      putFlow(id, { protocol: protocol.value });
    });

    // One permission per router crossed: given, or visibly missing.
    L.flowPermissions(doc(), id).forEach(function (p, i) {
      var fieldId = "prop-permit-" + i;
      if (!p.firewall) {
        U.field(form, fieldId, name(p.router), el("span", "? no firewall", "empty"));
        return;
      }
      var options = [["none", "? none"], ["true", "Allowed"], ["false", "Denied"], ["unknown", "Unknown"]];
      var permit = U.field(form, fieldId, name(p.firewall), M.dropdown(options, p.association ? String(p.allowed) : "none"));
      permit.title = "Permission of “" + name(p.firewall) + "” on “" + name(p.router) + "”";
      permit.addEventListener("change", function () {
        U.apply(function () {
          var edit = permit.value === "none"
            ? p.association ? L.remove(doc(), "associations", p.association) : null
            : L.putAssociation(doc(), p.association, { kind: "permits", from: p.firewall, to: id, allowed: switchValue(permit.value) });
          if (edit) edit.select = "flow/" + id;
          return edit;
        }, null, true);
      });
    });

    U.parameters(form, { flow: id }, f);
    U.problems(form, "flows." + id);
  }

  // ---- the rail's Link ----

  var railLink = document.querySelector('[data-action="linkComponent"]');
  railLink.addEventListener("click", function () {
    railLink.blur();
    if (selectedEntity()) startLink(selectedEntity(), railLink);
  });
  app.onChange(function () {
    if (!doc() || !P.isArchitecture(doc())) return;
    railLink.disabled = !selectedEntity();
    railLink.title = selectedEntity() ? "Link “" + name(selectedEntity()) + "” (L)" : "Link (L)";
  });

  U.sections.entity = entitySection;
  U.sections.association = associationSection;
  U.sections.flow = flowSection;
  U.menuItems.push(function (id) {
    return [["Link…", "L", function () { startLink(id, null); }]];
  });
  U.keyList.splice(1, 0, ["L", "Link the selected component"]);

  document.addEventListener("keydown", function (e) {
    if (e.defaultPrevented || !P.isArchitecture(doc()) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) || e.target.closest(".menu") || document.querySelector("dialog[open]")) return;
    if (e.key.toLowerCase() !== "l" || !selectedEntity()) return;
    e.preventDefault();
    startLink(selectedEntity(), null);
  });
})();
