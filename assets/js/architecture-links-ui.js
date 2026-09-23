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
  // Where a menu opens: beside the button that opened it, else beside the
  // component on the canvas, else in the canvas.
  function at(anchor, id) {
    var node = !anchor && id ? document.querySelector('#canvas g[data-id="' + CSS.escape("entity/" + id) + '"]') : null;
    var target = anchor || node;
    if (target) {
      var b = target.getBoundingClientRect();
      return { x: b.right + 2, y: b.top, box: { left: b.left, right: b.right, top: b.top } };
    }
    var box = document.getElementById("canvas").getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 3 };
  }

  // ---- Link: the way, in words, then the component it goes to ----

  function endItem(id, relation, from, to, privilege, other) {
    return [name(other), "", function () { link(id, relation, from, to, privilege); }, { hint: kindOf(other) }];
  }

  // Each way to link, with its privilege where it has one, opens the list of
  // existing components that fit; the new link keeps the selection here.
  // When nothing can be linked, one greyed note that says why.
  function linkItems(id) {
    return U.loadCatalog().then(function (c) {
      catalog = c;
      var items = [];
      L.linkChoices(doc(), c, id).forEach(function (choice) {
        var ends = function (other) {
          return choice.direction === "out" ? [id, other] : [other, id];
        };
        var variants = [];
        choice.candidates.forEach(function (other) {
          var fromTo = ends(other);
          (L.privileges(doc(), choice.kind, fromTo[0], fromTo[1]) || [null]).forEach(function (p) {
            if (variants.indexOf(p) < 0) variants.push(p);
          });
        });
        variants.forEach(function (p) {
          var fitting = choice.candidates.filter(function (other) {
            var fromTo = ends(other);
            var allowed = L.privileges(doc(), choice.kind, fromTo[0], fromTo[1]);
            return p === null ? !allowed : !!allowed && allowed.indexOf(p) >= 0;
          });
          items.push([L.phrase(choice.kind, choice.direction, p), "", fitting.map(function (other) {
            var fromTo = ends(other);
            return endItem(id, choice.kind, fromTo[0], fromTo[1], p, other);
          }), { title: choice.kind + (p ? " · " + p : "") }]);
        });
      });
      flowItems(id).forEach(function (item) {
        items.push(item);
      });
      if (!items.length) return [[L.emptyLink(doc(), c, id) || "nothing here to link “" + name(id) + "” to", "", null]];
      L.notes(doc(), id).forEach(function (n) {
        items.push([n.kind.charAt(0).toUpperCase() + n.kind.slice(1), "", null, { hint: n.hint }]);
      });
      return items;
    }, function () {
      return [["the component library could not be read", "", null]];
    });
  }
  function startLink(id, anchor) {
    linkItems(id).then(function (items) {
      if (!items.some(function (item) { return item[2] != null; })) return app.say(items[0][0]);
      var where = at(anchor, id);
      app.showMenu(items, where.x, where.y, where.box);
    });
  }

  // Software to a service, and a service from software: a flow with an empty
  // route, whose networks and routers are said, never guessed.
  function flowItems(id) {
    var others = Object.keys(doc().entities).filter(function (o) { return o !== id; });
    var out = [];
    if (executable(id)) {
      var to = others.filter(function (o) { return kindOf(o) === "service"; });
      if (to.length) out.push([L.phrase("flow", "out"), "", to.map(function (o) {
        return [name(o), "", function () { flow(id, o); }, { hint: "service" }];
      }), { title: "flow" }]);
    }
    if (kindOf(id) === "service") {
      var from = others.filter(executable);
      if (from.length) out.push([L.phrase("flow", "in"), "", from.map(function (o) {
        return [name(o), "", function () { flow(o, id); }, { hint: kindOf(o) }];
      }), { title: "flow" }]);
    }
    return out;
  }

  function flow(source, target) {
    U.apply(function () {
      return L.putFlow(doc(), null, { label: name(source) + " to " + name(target), source: source, target: target, route: [] });
    });
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
    if (!services.length) return app.say(L.emptyFlow(doc(), source));
    app.showMenu(services.map(function (target) {
      return [name(target), "", function () { flow(source, target); }, { hint: "service" }];
    }), where.x, where.y, where.box);
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

  // `drop`: {collection, id, what} — the × that removes this link or flow.
  function row(list, parts, select, title, drop) {
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
    if (drop) item.appendChild(button("×", drop.what, function () { unlink(drop.collection, drop.id); }, "unlink"));
    list.appendChild(item);
  }

  // Remove a link or a flow and stay on the selected component.
  function unlink(collection, id) {
    var here = app.state.selected;
    U.apply(function () {
      var edit = L.remove(doc(), collection, id);
      if (edit && P.selectionExists(edit.doc, here, null)) edit.select = here;
      return edit;
    });
  }

  // The component's menu: Unlink › with each of its links and flows.
  function unlinkItems(id) {
    var items = L.linksOf(doc(), id).map(function (l) {
      var a = doc().associations[l.id];
      return [name(l.other), "", function () { unlink("associations", l.id); }, { hint: L.phrase(l.kind, l.direction, a.privilege), title: l.kind }];
    }).concat(L.flowsOf(doc(), id).map(function (f) {
      return [doc().flows[f.id].label, "", function () { unlink("flows", f.id); }, { hint: "flow " + (f.direction === "out" ? "to " : "from ") + name(f.other) }];
    }));
    return items.length ? [["Unlink", "", items]] : [];
  }

  function entitySection(form, id) {
    var linkButton = button("+", "Link (L)", function () {
      startLink(id, linkButton);
    }, "btn btn-ghost btn-small link-add");
    var links = block(form, "Links", linkButton);
    L.linksOf(doc(), id).forEach(function (l) {
      var a = doc().associations[l.id];
      row(links, [[name(l.other), "name"], [L.phrase(l.kind, l.direction, a.privilege), "privilege"]], "association/" + l.id, l.kind + (a.privilege ? " · " + a.privilege : "") + " · " + l.id, { collection: "associations", id: l.id, what: "Unlink" });
    });
    if (!links.children.length) links.appendChild(el("li", "none", "empty"));

    if (executable(id)) {
      var flowButton = button("+", "Flow to a service", function () {
        pickFlowTarget(id, at(flowButton));
      }, "btn btn-ghost btn-small link-add");
      var flows = block(form, "Flows", flowButton);
      L.flowsOf(doc(), id).forEach(function (f) {
        row(flows, [[doc().flows[f.id].label, "name"], [(f.direction === "out" ? "to " : "from ") + name(f.other), "privilege"]], "flow/" + f.id, f.id, { collection: "flows", id: f.id, what: "Delete the flow" });
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
      if (!hops.length) return app.say(L.emptyHop(doc(), doc().flows[id]));
      app.showMenu(hops.map(function (hop) {
        return [name(hop), kindOf(hop), function () {
          putFlow(id, { route: (doc().flows[id].route || []).concat([hop]) });
        }];
      }), where.x, where.y, where.box);
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
        var missing = U.field(form, fieldId, name(p.router), el("span", "? no firewall", "empty"));
        missing.title = "“" + name(p.router) + "” has no firewall yet · Tab on it → Firewall";
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
    return [["Link", "L", { items: function () { return linkItems(id); } }]].concat(unlinkItems(id));
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
