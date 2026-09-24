// Clusters (clustering spec): components drawn as one node, kept in the file
// as groups, open or closed. A way of looking — nothing generated reads them.
// Every edit is a pure function from a document to a new one, the contract of
// architecture-edit.js: {doc, select, notice?} or null. `select: undefined`
// keeps the selection. Geometry for drawing them is at the end. Pure.
(function () {
  // edit.js loads after the drawing scripts that need this one: its slug is
  // looked up when an edit makes an id.
  function slug(text) {
    return (typeof module !== "undefined" ? require("./edit.js") : window.effractorEdit).slug(text);
  }
  // Which kind's icon a cluster shows: the most specific among its members.
  var SPECIFIC = ["router", "firewall", "host", "service", "application", "product", "network", "account", "credential", "person", "data"];
  var SOFTWARE = { application: true, service: true };

  function has(o, k) {
    return !!o && Object.prototype.hasOwnProperty.call(o, k);
  }
  function clone(doc) {
    return JSON.parse(JSON.stringify(doc));
  }
  function nameOf(doc, id) {
    var e = has(doc.entities, id) ? doc.entities[id] : null;
    return e && e.label != null ? String(e.label) : id;
  }
  function ids(doc) {
    return Object.keys(doc.clusters || {});
  }

  function clusterOf(doc, entity) {
    var all = ids(doc);
    for (var i = 0; i < all.length; i++) if ((doc.clusters[all[i]].members || []).indexOf(entity) >= 0) return all[i];
    return null;
  }

  // What a cluster is called: its label, else its first member's name and
  // how many more there are.
  function label(doc, cid) {
    var c = doc.clusters[cid];
    if (c.label) return String(c.label);
    var members = c.members || [];
    return members.length ? nameOf(doc, members[0]) + (members.length > 1 ? " +" + (members.length - 1) : "") : cid;
  }

  function lead(doc, members) {
    var best = null;
    members.forEach(function (m) {
      var kind = has(doc.entities, m) ? doc.entities[m].kind : null;
      if (kind && SPECIFIC.indexOf(kind) >= 0 && (best === null || SPECIFIC.indexOf(kind) < SPECIFIC.indexOf(best))) best = kind;
    });
    return best;
  }

  // `cluster/c` stands for its members; `entity/x` for itself; once each.
  function entitiesOf(doc, qualified) {
    var out = [];
    function add(id) {
      if (has(doc.entities, id) && out.indexOf(id) < 0) out.push(id);
    }
    qualified.forEach(function (q) {
      if (q.indexOf("cluster/") === 0 && has(doc.clusters, q.slice(8))) (doc.clusters[q.slice(8)].members || []).forEach(add);
      else if (q.indexOf("entity/") === 0) add(q.slice(7));
    });
    return out;
  }

  // An id for a new cluster from `base`, never only digits, not taken.
  function freeId(doc, base) {
    var first = slug(base) || "cluster";
    if (/^[0-9]+$/.test(first)) first = "cluster-" + first;
    var id = first;
    for (var n = 2; has(doc.clusters, id); n++) id = first + "-" + n;
    return id;
  }

  function tidy(next) {
    if (next.clusters && !Object.keys(next.clusters).length) delete next.clusters;
  }

  // On a copy: the entities in `gone` ({id: true}) leave their clusters; a
  // cluster left with fewer than two is dissolved. Returns the dissolved labels.
  function forget(next, gone) {
    var dissolved = [];
    ids(next).forEach(function (cid) {
      var c = next.clusters[cid];
      var kept = (c.members || []).filter(function (m) {
        return !has(gone, m);
      });
      if (kept.length === (c.members || []).length) return;
      if (kept.length < 2) {
        dissolved.push(label(next, cid));
        delete next.clusters[cid];
      } else c.members = kept;
    });
    tidy(next);
    return dissolved;
  }

  // On a copy: entity `old` is now called `id`.
  function rekey(next, old, id) {
    ids(next).forEach(function (cid) {
      next.clusters[cid].members = (next.clusters[cid].members || []).map(function (m) {
        return m === old ? id : m;
      });
    });
  }

  function make(doc, members, name) {
    var list = [];
    members.forEach(function (m) {
      if (has(doc.entities, m) && list.indexOf(m) < 0) list.push(m);
    });
    if (list.length < 2) return null;
    var next = clone(doc);
    var gone = Object.create(null);
    list.forEach(function (m) {
      gone[m] = true;
    });
    forget(next, gone);
    next.clusters = next.clusters || {};
    var text = String(name == null ? "" : name).trim();
    var id = freeId(next, text || list[0]);
    next.clusters[id] = { label: text || nameOf(doc, list[0]) + " +" + (list.length - 1), members: list, closed: true };
    return { doc: next, select: "cluster/" + id, notice: "clustered " + list.length + " components · Ctrl+Z undoes" };
  }

  // The automatic groups (spec §5.1), for components not in a cluster yet:
  // a host with the router it runs and that router's firewall, the software
  // it hosts and the products only that software uses; a router on no box
  // with its firewall.
  function together(doc) {
    var ents = doc.entities || {};
    var order = Object.keys(ents);
    var taken = Object.create(null);
    ids(doc).forEach(function (cid) {
      (doc.clusters[cid].members || []).forEach(function (m) {
        taken[m] = true;
      });
    });
    var hostOf = Object.create(null), runs = Object.create(null), boxOf = Object.create(null);
    var routersOn = Object.create(null), firewallsOf = Object.create(null), users = Object.create(null);
    function push(map, k, v) {
      (map[k] = map[k] || []).push(v);
    }
    Object.keys(doc.associations || {}).forEach(function (k) {
      var a = doc.associations[k];
      if (!has(ents, a.from) || !has(ents, a.to)) return;
      var from = ents[a.from].kind, to = ents[a.to].kind;
      if (a.kind === "hosts" && from === "host" && SOFTWARE[to] && !has(hostOf, a.to)) {
        hostOf[a.to] = a.from;
        push(runs, a.from, a.to);
      }
      if (a.kind === "hosts" && from === "host" && to === "router" && !has(boxOf, a.to)) {
        boxOf[a.to] = a.from;
        push(routersOn, a.from, a.to);
      }
      if (a.kind === "filters" && from === "router" && to === "firewall") push(firewallsOf, a.from, a.to);
      if (a.kind === "instance-of") push(users, a.to, a.from);
    });
    function byOrder(list) {
      return (list || []).slice().sort(function (a, b) {
        return order.indexOf(a) - order.indexOf(b);
      });
    }
    // A product goes with a host when everything using it runs there.
    var productsOf = Object.create(null);
    order.forEach(function (p) {
      var u = users[p];
      if (!u || !has(hostOf, u[0])) return;
      var host = hostOf[u[0]];
      if (u.every(function (x) { return hostOf[x] === host; })) push(productsOf, host, p);
    });
    var out = [];
    var used = Object.create(null);
    order.forEach(function (id) {
      var kind = ents[id].kind;
      var members;
      if (kind === "host") {
        members = [id];
        byOrder(routersOn[id]).forEach(function (r) {
          members.push(r);
          byOrder(firewallsOf[r]).forEach(function (f) {
            members.push(f);
          });
        });
        members = members.concat(byOrder(runs[id]), productsOf[id] || []);
      } else if (kind === "router" && !has(boxOf, id)) {
        members = [id].concat(byOrder(firewallsOf[id]));
      } else return;
      if (taken[id]) return;
      members = members.filter(function (m, i) {
        return !taken[m] && !used[m] && members.indexOf(m) === i;
      });
      if (members.length < 2) return;
      members.forEach(function (m) {
        used[m] = true;
      });
      out.push({ id: id, label: nameOf(doc, id), members: members });
    });
    return out;
  }

  function build(doc) {
    var groups = together(doc);
    if (!groups.length) return null;
    var next = clone(doc);
    next.clusters = next.clusters || {};
    groups.forEach(function (g) {
      next.clusters[freeId(next, g.id)] = { label: g.label, members: g.members, closed: true };
    });
    return { doc: next, select: undefined, notice: "clustered " + groups.length + (groups.length === 1 ? " group" : " groups") + " · Ctrl+Z undoes" };
  }

  // The rail's one button (spec §5.2): make, else open all, else close all.
  function toggleAll(doc) {
    var all = ids(doc);
    if (!all.length) {
      var made = build(doc);
      if (made) made.notice = made.notice.replace(/ groups?/, function (w) { return w === " group" ? " cluster" : " clusters"; });
      return made;
    }
    var anyClosed = all.some(function (cid) {
      return doc.clusters[cid].closed === true;
    });
    var next = clone(doc);
    all.forEach(function (cid) {
      next.clusters[cid].closed = !anyClosed;
    });
    return { doc: next, select: undefined, notice: (anyClosed ? "opened " : "closed ") + all.length + (all.length === 1 ? " cluster" : " clusters") };
  }

  function takeOut(doc, cid, entity) {
    if (!has(doc.clusters, cid) || (doc.clusters[cid].members || []).indexOf(entity) < 0) return null;
    var next = clone(doc);
    var gone = Object.create(null);
    gone[entity] = true;
    var name = label(doc, cid);
    var dissolved = forget(next, gone);
    return { doc: next, select: "entity/" + entity, notice: dissolved.length ? "dissolved “" + name + "” · Ctrl+Z undoes" : "took “" + nameOf(doc, entity) + "” out of “" + name + "”" };
  }

  function moveTo(doc, entity, cid) {
    if (!has(doc.clusters, cid) || !has(doc.entities, entity) || (doc.clusters[cid].members || []).indexOf(entity) >= 0) return null;
    var next = clone(doc);
    var gone = Object.create(null);
    gone[entity] = true;
    forget(next, gone);
    // `cid` keeps its members: it does not hold `entity`, so forget left it.
    next.clusters[cid].members.push(entity);
    return { doc: next, select: "cluster/" + cid, notice: "moved “" + nameOf(doc, entity) + "” into “" + label(doc, cid) + "”" };
  }

  function dissolve(doc, cid) {
    if (!has(doc.clusters, cid)) return null;
    var next = clone(doc);
    delete next.clusters[cid];
    tidy(next);
    return { doc: next, select: null, notice: "dissolved “" + label(doc, cid) + "” · Ctrl+Z undoes" };
  }

  function rename(doc, cid, text) {
    if (!has(doc.clusters, cid)) return null;
    var name = String(text == null ? "" : text).trim();
    if ((doc.clusters[cid].label || "") === name) return null;
    var next = clone(doc);
    if (name) next.clusters[cid].label = name;
    else delete next.clusters[cid].label;
    return { doc: next, select: "cluster/" + cid };
  }

  function setClosed(doc, cid, closed) {
    if (!has(doc.clusters, cid) || doc.clusters[cid].closed === !!closed) return null;
    var next = clone(doc);
    next.clusters[cid].closed = !!closed;
    return { doc: next, select: "cluster/" + cid };
  }

  var api = {
    SPECIFIC: SPECIFIC,
    clusterOf: clusterOf,
    label: label,
    lead: lead,
    entitiesOf: entitiesOf,
    together: together,
    forget: forget,
    rekey: rekey,
    make: make,
    build: build,
    toggleAll: toggleAll,
    takeOut: takeOut,
    moveTo: moveTo,
    dissolve: dissolve,
    rename: rename,
    setClosed: setClosed,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorClusters = api;
})();
