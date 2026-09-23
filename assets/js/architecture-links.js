// Architecture relationships, flows and attacker states, as pure edits with
// the same contract as architecture-edit.js: {doc, select, notice?} or null.
// Whether an association's kinds, ends and fields are valid is for the wasm
// module to say; what this file does is keep references whole — a rename
// rewrites every place an id is named, a delete takes along everything that
// named what it deletes — so a document never points at nothing.
(function () {
  var slug = (typeof module !== "undefined" ? require("./edit.js") : window.effractorEdit).slug;
  var KINDS = ["attached", "hosts", "filters", "stores", "authenticates", "authorizes", "grants", "administration", "permits"];
  var PRIVILEGED = ["hosts", "stores", "grants"];
  var COLLECTIONS = ["entities", "associations", "flows"];

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }

  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }

  function extensions(record) {
    var out = {};
    Object.keys(record || {}).forEach(function (k) {
      if (k.indexOf("x-") === 0) out[k] = record[k];
    });
    return out;
  }

  // A map with one key renamed, in its place.
  function renamed(map, from, to) {
    var out = {};
    Object.keys(map).forEach(function (k) {
      out[k === from ? to : k] = map[k];
    });
    return out;
  }

  function freeId(map, base) {
    base = slug(base);
    if (!base || /^[0-9]+$/.test(base)) base = "item-" + base;
    var id = base;
    for (var n = 2; has(map, id); n++) id = base + "-" + n;
    return id;
  }

  // What is wrong with `id` as the new name of `old` in a collection, or null.
  function idProblem(doc, collection, old, id) {
    if (COLLECTIONS.indexOf(collection) < 0) return "nothing to rename there";
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) return "an id is a-z, 0-9 and '-', not starting with '-'";
    if (/^[0-9]+$/.test(id)) return "an id needs a letter or '-', not only digits";
    if (id !== old && has(doc[collection], id)) return "“" + id + "” is taken";
    return null;
  }

  // `value`: {kind, from, to, privilege?, allowed?, description?}. Written in
  // canonical key order with only the fields its kind carries; `id` null
  // makes a new one named after its ends.
  function putAssociation(doc, id, value) {
    if (!value || KINDS.indexOf(value.kind) < 0) return null;
    var next = clone(doc);
    next.associations = next.associations || {};
    if (id == null) id = freeId(next.associations, value.from + "-" + value.kind + "-" + value.to);
    else if (!has(next.associations, id) && idProblem(next, "associations", null, id)) return null;
    var a = { kind: value.kind, from: String(value.from || ""), to: String(value.to || "") };
    if (PRIVILEGED.indexOf(value.kind) >= 0) a.privilege = value.privilege;
    if (value.kind === "permits") a.allowed = value.allowed;
    var description = String(value.description == null ? "" : value.description).trim();
    if (description) a.description = description;
    Object.assign(a, extensions(has(next.associations, id) ? next.associations[id] : null));
    if (has(next.associations, id) && JSON.stringify(next.associations[id]) === JSON.stringify(a)) return null;
    next.associations[id] = a;
    return { doc: next, select: "association/" + id };
  }

  // `value`: {label, source, target, route, protocol?}. The connect
  // parameter is edited as a parameter; a new flow's is unknown.
  function putFlow(doc, id, value) {
    var label = String((value && value.label) == null ? "" : value.label).trim();
    if (!label) return null;
    var next = clone(doc);
    next.flows = next.flows || {};
    if (id == null) id = freeId(next.flows, label);
    else if (!has(next.flows, id) && idProblem(next, "flows", null, id)) return null;
    var old = has(next.flows, id) ? next.flows[id] : null;
    var f = {
      label: label,
      source: String(value.source || ""),
      target: String(value.target || ""),
      route: (value.route || []).map(String),
    };
    var protocol = String(value.protocol == null ? "" : value.protocol).trim();
    if (protocol) f.protocol = protocol;
    f.parameters = old && old.parameters ? old.parameters : { connect: { status: "unknown" } };
    Object.assign(f, extensions(old));
    if (old && JSON.stringify(old) === JSON.stringify(f)) return null;
    next.flows[id] = f;
    return { doc: next, select: "flow/" + id };
  }

  function sameState(a, entity, state) {
    return a.entity === entity && a.state === state;
  }

  function setFoothold(doc, entity, state, enabled) {
    if (!has(doc.entities, entity) || !state) return null;
    var footholds = (doc.attacker && doc.attacker.footholds) || [];
    var there = footholds.some(function (s) {
      return sameState(s, entity, state);
    });
    if (there === !!enabled) return null;
    var next = clone(doc);
    next.attacker = next.attacker || {};
    next.attacker.footholds = enabled
      ? footholds.concat([{ entity: entity, state: state }])
      : footholds.filter(function (s) {
          return !sameState(s, entity, state);
        });
    return { doc: next, select: "entity/" + entity };
  }

  // `state` null clears the target.
  function setTarget(doc, entity, state) {
    var attacker = doc.attacker || {};
    if (state == null) {
      if (!attacker.target) return null;
      var cleared = clone(doc);
      delete cleared.attacker.target;
      return { doc: cleared, select: has(doc.entities, entity) ? "entity/" + entity : null };
    }
    if (!has(doc.entities, entity)) return null;
    if (attacker.target && sameState(attacker.target, entity, state)) return null;
    var next = clone(doc);
    next.attacker = next.attacker || { footholds: [] };
    next.attacker.target = { entity: entity, state: state };
    return { doc: next, select: "entity/" + entity };
  }

  function labelOf(doc, entity) {
    var e = doc.entities[entity];
    return e && e.label != null ? e.label : entity;
  }

  // A pin dropped on `entity` in `state`: from the tray (`from` null) or
  // picked up from where it was (`from` {entity, state}). A component holds
  // one foothold, and the document one target, so either replaces what was.
  function placePin(doc, role, entity, state, from) {
    if (!has(doc.entities, entity) || !state) return null;
    var edit;
    if (role === "target") {
      edit = setTarget(doc, entity, state);
    } else if (role === "foothold") {
      var d = doc;
      var footholds = (d.attacker && d.attacker.footholds) || [];
      if (footholds.some(function (s) { return sameState(s, entity, state); })) return null;
      footholds.forEach(function (s) {
        var gone = (from && sameState(s, from.entity, from.state)) || s.entity === entity ? setFoothold(d, s.entity, s.state, false) : null;
        if (gone) d = gone.doc;
      });
      edit = setFoothold(d, entity, state, true);
    } else {
      return null;
    }
    if (!edit) return null;
    edit.notice = role + ": " + labelOf(doc, entity) + " · " + state;
    return edit;
  }

  // A pin dragged off the components.
  function removePin(doc, role, entity, state) {
    var edit = role === "target"
      ? (doc.attacker && doc.attacker.target && sameState(doc.attacker.target, entity, state) ? setTarget(doc, entity, null) : null)
      : role === "foothold" ? setFoothold(doc, entity, state, false) : null;
    if (!edit) return null;
    edit.notice = role + " removed from " + labelOf(doc, entity);
    return edit;
  }

  var SELECT = { entities: "entity/", associations: "association/", flows: "flow/" };

  function renameId(doc, collection, old, id) {
    if (COLLECTIONS.indexOf(collection) < 0 || !has(doc[collection], old) || old === id) return null;
    if (idProblem(doc, collection, old, id)) return null;
    var next = clone(doc);
    next[collection] = renamed(next[collection], old, id);
    var swap = function (v) {
      return v === old ? id : v;
    };
    if (collection === "entities") {
      Object.keys(next.associations || {}).forEach(function (k) {
        var a = next.associations[k];
        a.from = swap(a.from);
        if (a.kind !== "permits") a.to = swap(a.to);
      });
      Object.keys(next.flows || {}).forEach(function (k) {
        var f = next.flows[k];
        f.source = swap(f.source);
        f.target = swap(f.target);
        f.route = (f.route || []).map(swap);
      });
      var attacker = next.attacker || {};
      (attacker.footholds || []).forEach(function (s) {
        s.entity = swap(s.entity);
      });
      if (attacker.target) attacker.target.entity = swap(attacker.target.entity);
    }
    if (collection === "flows") {
      Object.keys(next.associations || {}).forEach(function (k) {
        var a = next.associations[k];
        if (a.kind === "permits") a.to = swap(a.to);
      });
    }
    Object.keys(next.scenarios || {}).forEach(function (k) {
      (next.scenarios[k].changes || []).forEach(function (c) {
        if (collection === "entities" && has(c, "entity")) c.entity = swap(c.entity);
        if (collection === "associations" && has(c, "association")) c.association = swap(c.association);
      });
    });
    return { doc: next, select: SELECT[collection] + id };
  }

  function hostOf(doc, executable) {
    var hosting = Object.keys(doc.associations || {}).filter(function (k) {
      var a = doc.associations[k];
      return a.kind === "hosts" && a.to === executable;
    })[0];
    return hosting ? doc.associations[hosting].from : null;
  }

  // Does the flow's route rest on `machine` being attached to `network`: a
  // router beside it on the route, or the host of an end it starts or ends in?
  function needsAttachment(doc, flow, machine, network) {
    var route = flow.route || [];
    for (var i = 0; i < route.length; i++) {
      if (route[i] !== network) continue;
      if (route[i - 1] === machine || route[i + 1] === machine) return true;
      if (i === 0 && hostOf(doc, flow.source) === machine) return true;
      if (i === route.length - 1 && hostOf(doc, flow.target) === machine) return true;
    }
    return false;
  }

  function title(doc, collection, id) {
    var r = doc[collection][id];
    var label = function (entity) {
      return has(doc.entities, entity) && doc.entities[entity].label ? doc.entities[entity].label : entity;
    };
    if (collection === "associations") {
      var to = r.kind === "permits" ? (has(doc.flows, r.to) ? doc.flows[r.to].label : r.to) : label(r.to);
      return r.kind + " " + label(r.from) + " → " + to;
    }
    return r.label || id;
  }

  // Delete `id` and everything that named it: associations at either end,
  // flows from, to or over it, the permissions of those flows, attacker
  // states on it and scenario changes on any of these. Software left without
  // a host stays, unhosted — an `incomplete`, never a guessed new host.
  function remove(doc, collection, id) {
    if (COLLECTIONS.indexOf(collection) < 0 || !has(doc[collection], id)) return null;
    var next = clone(doc);
    var gone = { entities: {}, associations: {}, flows: {} };
    gone[collection][id] = true;
    var links = 0;
    if (collection === "entities") {
      Object.keys(next.flows || {}).forEach(function (k) {
        var f = next.flows[k];
        if (f.source === id || f.target === id || (f.route || []).indexOf(id) >= 0) gone.flows[k] = true;
      });
    }
    var link = collection === "associations" ? next.associations[id] : null;
    if (link && link.kind === "attached") {
      Object.keys(next.flows || {}).forEach(function (k) {
        if (needsAttachment(next, next.flows[k], link.from, link.to)) gone.flows[k] = true;
      });
    }
    Object.keys(next.associations || {}).forEach(function (k) {
      var a = next.associations[k];
      var end = a.kind === "permits" ? has(gone.flows, a.to) : has(gone.entities, a.to);
      if (has(gone.entities, a.from) || end) gone.associations[k] = true;
    });
    COLLECTIONS.forEach(function (c) {
      Object.keys(gone[c]).forEach(function (k) {
        if (!has(next[c], k)) return;
        delete next[c][k];
        if (c !== "entities") links++;
      });
    });
    if (collection !== "entities") links--;
    var was = [];
    var attacker = next.attacker || {};
    if (collection === "entities") {
      var before = (attacker.footholds || []).length;
      attacker.footholds = (attacker.footholds || []).filter(function (s) {
        return s.entity !== id;
      });
      if (attacker.footholds.length < before) was.push("a foothold");
      if (attacker.target && attacker.target.entity === id) {
        delete attacker.target;
        was.push("the target");
      }
    }
    Object.keys(next.scenarios || {}).forEach(function (k) {
      var s = next.scenarios[k];
      s.changes = (s.changes || []).filter(function (c) {
        return !(has(c, "entity") && has(gone.entities, c.entity)) && !(has(c, "association") && has(gone.associations, c.association));
      });
    });
    var notice = "deleted “" + title(doc, collection, id) + "”";
    if (links) notice += " and " + links + (links === 1 ? " link" : " links");
    if (was.length) notice += ", " + was.join(" and ");
    return { doc: next, select: null, notice: notice + " · Ctrl+Z undoes" };
  }

  // ---- what the relationship controls offer: pure, from the catalog ----

  function kindOf(doc, id) {
    return has(doc.entities, id) ? doc.entities[id].kind : null;
  }

  function linked(doc, kind, from, to) {
    return Object.keys(doc.associations || {}).some(function (k) {
      var a = doc.associations[k];
      return a.kind === kind && a.from === from && a.to === to;
    });
  }

  // What the catalog's kind lists cannot say: a router runs on a host, not
  // on another router. The file's validator says the same.
  function endsAllowed(relation, fromKind, toKind) {
    return !(relation === "hosts" && toKind === "router" && fromKind !== "host");
  }

  // The association kinds `id` can stand in, each with its direction and the
  // components that could be at the other end: of the right kind, not
  // already linked that way, and — for hosting — not already hosted. A
  // permission belongs to a flow and is set there.
  function linkChoices(doc, catalog, id) {
    var kind = kindOf(doc, id);
    if (!kind) return [];
    var ids = Object.keys(doc.entities);
    var out = [];
    (catalog.associations || []).forEach(function (spec) {
      if (spec.kind === "permits") return;
      if (spec.from.indexOf(kind) >= 0) {
        out.push({
          kind: spec.kind,
          direction: "out",
          candidates: ids.filter(function (other) {
            if (other === id || spec.to.indexOf(kindOf(doc, other)) < 0) return false;
            if (!endsAllowed(spec.kind, kind, kindOf(doc, other))) return false;
            if (spec.kind === "hosts" && hostOf(doc, other)) return false;
            // One firewall per router, one router per firewall.
            if (spec.kind === "filters" && (hasFilters(doc, "from", id) || hasFilters(doc, "to", other))) return false;
            return !linked(doc, spec.kind, id, other);
          }),
        });
      }
      if (spec.to.indexOf(kind) >= 0) {
        out.push({
          kind: spec.kind,
          direction: "in",
          candidates: (spec.kind === "hosts" && hostOf(doc, id)) || (spec.kind === "filters" && hasFilters(doc, "to", id)) ? [] : ids.filter(function (other) {
            return (
              other !== id &&
              spec.from.indexOf(kindOf(doc, other)) >= 0 &&
              endsAllowed(spec.kind, kindOf(doc, other), kind) &&
              !(spec.kind === "filters" && hasFilters(doc, "from", other)) &&
              !linked(doc, spec.kind, other, id)
            );
          }),
        });
      }
    });
    return out;
  }

  // What privilege a link of this kind can carry here, or null for none.
  function privileges(doc, kind, from, to) {
    return privilegesOf(kind, kindOf(doc, from), kindOf(doc, to));
  }
  function privilegesOf(kind, fromKind, toKind) {
    if (PRIVILEGED.indexOf(kind) < 0) return null;
    if (kind === "hosts" && fromKind === "router") return ["admin"];
    if (kind === "grants" && toKind === "router") return ["admin"];
    if (kind === "stores" && fromKind === "application") return ["user"];
    return ["user", "admin"];
  }

  // A way to link, in a few words about the *other* component, seen from the
  // selected one; the file's relation name is for the tooltip.
  var WORDS = {
    attached: { out: "connected to", in: "connected here" },
    hosts: { out: "runs here", in: "runs this" },
    filters: { out: "its firewall", in: "its router" },
    stores: { out: "kept here", in: "keeps this" },
    authenticates: { out: "unlocks", in: "unlocks this" },
    authorizes: { out: "accepts this account", in: "may log in" },
    grants: { out: "grants it", in: "has rights here" },
    administration: { out: "managed from here", in: "managed from there" },
    flow: { out: "flow to it", in: "flow from it" },
  };
  function phrase(relation, direction, privilege) {
    var words = WORDS[relation] ? WORDS[relation][direction] : relation;
    if (!privilege) return words;
    if (relation === "hosts") return words + " as " + privilege;
    if (relation === "stores") return words + ", " + (privilege === "admin" ? "admin-only" : "user-readable");
    if (relation === "grants") return direction === "in" ? "is " + privilege + " here" : words + " " + privilege;
    return words;
  }

  var ENTITY_KINDS = ["network", "router", "firewall", "host", "application", "service", "account", "credential"];

  function hasFilters(doc, end, id) {
    return Object.keys(doc.associations || {}).some(function (k) {
      var a = doc.associations[k];
      return a.kind === "filters" && a[end] === id;
    });
  }

  // What Tab can add next to `id`: each kind that can be linked to it, with
  // every way to link it — relation, direction, privilege — in the catalog's
  // order. A hosted executable gets no second host, a router with a firewall
  // no second one; permissions belong to a flow.
  function addChoices(doc, catalog, id) {
    var kind = kindOf(doc, id);
    if (!kind) return [];
    var byKind = Object.create(null);
    function offer(newKind, relation, direction) {
      var from = direction === "out" ? kind : newKind;
      var to = direction === "out" ? newKind : kind;
      if (!endsAllowed(relation, from, to)) return;
      var list = (byKind[newKind] = byKind[newKind] || []);
      (privilegesOf(relation, from, to) || [null]).forEach(function (p) {
        list.push({ relation: relation, direction: direction, privilege: p });
      });
    }
    // A flow runs from software to a service: offered from either end.
    if (kind === "application" || kind === "service") offer("service", "flow", "out");
    if (kind === "service") {
      offer("application", "flow", "in");
      offer("service", "flow", "in");
    }
    (catalog.associations || []).forEach(function (spec) {
      if (spec.kind === "permits") return;
      if (spec.from.indexOf(kind) >= 0 && !(spec.kind === "filters" && hasFilters(doc, "from", id))) {
        spec.to.forEach(function (k) { offer(k, spec.kind, "out"); });
      }
      if (spec.to.indexOf(kind) >= 0) {
        if (spec.kind === "hosts" && hostOf(doc, id)) return;
        if (spec.kind === "filters" && hasFilters(doc, "to", id)) return;
        spec.from.forEach(function (k) { offer(k, spec.kind, "in"); });
      }
    });
    return ENTITY_KINDS.filter(function (k) { return byKind[k]; }).map(function (k) {
      return { kind: k, options: byKind[k] };
    });
  }

  // A new component of `kind`, linked to `id` as `option` says: one edit,
  // one undo, the selection on the new component. `E` is architecture-edit.js,
  // `spec` the kind's catalog entry.
  function addLinked(doc, E, id, kind, label, spec, option) {
    if (!has(doc.entities, id)) return null;
    var added = E.addEntity(doc, kind, label, spec);
    if (!added) return null;
    var from = option.direction === "out" ? id : added.entity;
    var to = option.direction === "out" ? added.entity : id;
    if (option.relation === "flow") {
      var label = function (e) {
        return added.doc.entities[e].label;
      };
      var flowed = putFlow(added.doc, null, { label: label(from) + " to " + label(to), source: from, target: to, route: [] });
      return flowed ? { doc: flowed.doc, select: "entity/" + added.entity, entity: added.entity } : null;
    }
    var linked = putAssociation(added.doc, null, { kind: option.relation, from: from, to: to, privilege: option.privilege });
    if (!linked) return null;
    return { doc: linked.doc, select: "entity/" + added.entity, entity: added.entity };
  }

  function attachedTo(doc, machine, network) {
    return linked(doc, "attached", machine, network);
  }

  // The components that could come next on a flow's route: a network first
  // and after every router, a router after every network; those attached to
  // where the route stands come first. Nothing is added by itself.
  function nextHops(doc, flow) {
    var hops = hopChoices(doc, flow);
    return hops.near.concat(hops.far);
  }

  // Only the hops attached to where the route stands: what fits next.
  function nearHops(doc, flow) {
    return hopChoices(doc, flow).near;
  }

  function hopChoices(doc, flow) {
    var route = flow.route || [];
    var want = route.length % 2 === 0 ? "network" : "router";
    var last = route[route.length - 1];
    var start = hostOf(doc, flow.source);
    var near = function (id) {
      if (!route.length) return !!start && attachedTo(doc, start, id);
      return want === "router" ? attachedTo(doc, id, last) : attachedTo(doc, last, id);
    };
    var open = Object.keys(doc.entities).filter(function (id) {
      return kindOf(doc, id) === want && route.indexOf(id) < 0;
    });
    return {
      near: open.filter(near),
      far: open.filter(function (id) {
        return !near(id);
      }),
    };
  }

  // For each router on the flow's route: its firewall and that firewall's
  // permission for the flow — or null where there is none yet.
  function flowPermissions(doc, flowId) {
    if (!has(doc.flows, flowId)) return [];
    var route = doc.flows[flowId].route || [];
    var out = [];
    for (var i = 1; i < route.length; i += 2) {
      var router = route[i];
      var filters = Object.keys(doc.associations || {}).filter(function (k) {
        var a = doc.associations[k];
        return a.kind === "filters" && a.from === router;
      })[0];
      var firewall = filters ? doc.associations[filters].to : null;
      var permit = firewall ? Object.keys(doc.associations).filter(function (k) {
        var a = doc.associations[k];
        return a.kind === "permits" && a.from === firewall && a.to === flowId;
      })[0] : null;
      out.push({ router: router, firewall: firewall, association: permit || null, allowed: permit ? doc.associations[permit].allowed : null });
    }
    return out;
  }

  // The associations at `id`, in document order, from its side.
  function linksOf(doc, id) {
    var out = [];
    Object.keys(doc.associations || {}).forEach(function (k) {
      var a = doc.associations[k];
      if (a.kind === "permits") return;
      if (a.from === id) out.push({ id: k, kind: a.kind, direction: "out", other: a.to });
      else if (a.to === id) out.push({ id: k, kind: a.kind, direction: "in", other: a.from });
    });
    return out;
  }

  function flowsOf(doc, id) {
    var out = [];
    Object.keys(doc.flows || {}).forEach(function (k) {
      var f = doc.flows[k];
      if (f.source === id) out.push({ id: k, direction: "out", other: f.target });
      else if (f.target === id) out.push({ id: k, direction: "in", other: f.source });
    });
    return out;
  }

  // ---- what cannot be linked, and why: said where it would be looked for ----

  // Greyed entries for the Tab and Link menus: a kind that is not linked
  // directly, and the way to get there instead.
  function notes(doc, id) {
    switch (kindOf(doc, id)) {
      case "host":
        return [{ kind: "router", hint: "through a network" }];
      case "router":
        return [{ kind: "host", hint: "through a network" }];
      case "firewall":
        return [{ kind: "flow", hint: "permitted in the flow" }];
      default:
        return [];
    }
  }

  function list(words) {
    return words.length < 2 ? words.join("") : words.slice(0, -1).join(", ") + " or " + words[words.length - 1];
  }

  // Why the Link menu of `id` would be empty, or null when it is not.
  function emptyLink(doc, catalog, id) {
    var kind = kindOf(doc, id);
    if (!kind) return null;
    var choices = linkChoices(doc, catalog, id);
    if (choices.some(function (c) { return c.candidates.length; })) return null;
    if (kind === "firewall" && hasFilters(doc, "to", id)) return "a firewall permits flows · set it in each flow that crosses its router";
    var kinds = addChoices(doc, catalog, id).map(function (c) {
      return c.kind;
    });
    return "no " + list(kinds) + " yet · Tab adds one linked";
  }

  // Why software has no service to send a flow to, or null.
  function emptyFlow(doc, id) {
    var any = Object.keys(doc.entities).some(function (o) {
      return o !== id && kindOf(doc, o) === "service";
    });
    return any ? null : "no service yet · Tab on “" + doc.entities[id].label + "” adds one with a flow";
  }

  // Why a flow's route has no next hop to offer, or null.
  function emptyHop(doc, flow) {
    if (nextHops(doc, flow).length) return null;
    var want = (flow.route || []).length % 2 === 0 ? "network" : "router";
    var exists = Object.keys(doc.entities).some(function (id) {
      return kindOf(doc, id) === want;
    });
    if (exists) return "every " + want + " is on this route already";
    return want === "router" ? "no router yet · add one with A, then connect it to both networks" : "no network yet · add one with A";
  }

  var api = { KINDS: KINDS, notes: notes, emptyLink: emptyLink, emptyFlow: emptyFlow, emptyHop: emptyHop, phrase: phrase, addChoices: addChoices, addLinked: addLinked, linkChoices: linkChoices, privileges: privileges, nextHops: nextHops, nearHops: nearHops, flowPermissions: flowPermissions, linksOf: linksOf, flowsOf: flowsOf, idProblem: function (doc, collection, old, id) { return idProblem(doc, collection, old, id); }, putAssociation: putAssociation, putFlow: putFlow, setFoothold: setFoothold, setTarget: setTarget, placePin: placePin, removePin: removePin, renameId: renameId, remove: remove };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorArchitectureLinks = api;
})();
