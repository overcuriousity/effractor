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
        return;
      }
      c.members = kept;
      if (c.shown) {
        c.shown = c.shown.filter(function (m) {
          return !has(gone, m);
        });
        if (!c.shown.length) delete c.shown;
        // Everyone left beside an empty stack: it is simply open.
        else if (c.shown.length >= kept.length) {
          c.closed = false;
          delete c.shown;
        }
      }
    });
    tidy(next);
    return dissolved;
  }

  // On a copy: entity `old` is now called `id`.
  function rekey(next, old, id) {
    ids(next).forEach(function (cid) {
      var c = next.clusters[cid];
      var swap = function (m) {
        return m === old ? id : m;
      };
      c.members = (c.members || []).map(swap);
      if (c.shown) c.shown = c.shown.map(swap);
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

  // After an import (owner, 2026-09-25): in `after`, what runs together and
  // holds something `before` did not have becomes a cluster, open. What the
  // author clustered stays. Returns the document, `after` itself if nothing.
  function gather(before, after) {
    var groups = together(after).filter(function (g) {
      return g.members.some(function (m) {
        return !has(before.entities, m);
      });
    });
    if (!groups.length) return after;
    var next = clone(after);
    next.clusters = next.clusters || {};
    groups.forEach(function (g) {
      next.clusters[freeId(next, g.id)] = { label: g.label, members: g.members, closed: false };
    });
    return next;
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
      delete next.clusters[cid].shown;
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
    var dissolved = forget(next, gone);
    // `cid` keeps its members: it does not hold `entity`, so forget left it.
    next.clusters[cid].members.push(entity);
    var said = "moved “" + nameOf(doc, entity) + "” into “" + label(doc, cid) + "”";
    if (dissolved.length) said += ", dissolved “" + dissolved.join("”, “") + "” · Ctrl+Z undoes";
    return { doc: next, select: "cluster/" + cid, notice: said };
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
    // Opened or closed, everyone is together again.
    delete next.clusters[cid].shown;
    return { doc: next, select: "cluster/" + cid };
  }

  // A member dragged out of a closed cluster (owner, 2026-09-25): still a
  // member, drawn beside the stack inside the cluster's outline. The last
  // one in the stack dragged out just opens the cluster.
  function peel(doc, cid, entity) {
    var c = has(doc.clusters, cid) ? doc.clusters[cid] : null;
    if (!c || !c.closed || (c.members || []).indexOf(entity) < 0 || (c.shown || []).indexOf(entity) >= 0) return null;
    var next = clone(doc);
    var n = next.clusters[cid];
    n.shown = (n.shown || []).concat([entity]);
    if (n.shown.length >= n.members.length) {
      n.closed = false;
      delete n.shown;
    }
    return { doc: next, select: "entity/" + entity };
  }

  // Back onto its cluster: in the stack again.
  function unpeel(doc, cid, entity) {
    var c = has(doc.clusters, cid) ? doc.clusters[cid] : null;
    if (!c || (c.shown || []).indexOf(entity) < 0) return null;
    var next = clone(doc);
    var n = next.clusters[cid];
    n.shown = n.shown.filter(function (m) {
      return m !== entity;
    });
    if (!n.shown.length) delete n.shown;
    return { doc: next, select: "cluster/" + cid };
  }

  // One dragged onto another (owner, 2026-09-25), each `entity/…` or
  // `cluster/…`: a component joins a cluster it is dropped on, or the
  // cluster of an open member it is dropped on; a cluster onto a cluster
  // gives the target its members; a cluster takes in a component it is
  // dropped on; two loose components become a cluster, the target first.
  // A member beside its own stack dropped onto it goes back in.
  function merge(doc, dragged, target) {
    function split(q) {
      var at = q.indexOf("/");
      return { kind: q.slice(0, at), id: q.slice(at + 1) };
    }
    var d = split(dragged), t = split(target);
    if (dragged === target) return null;
    if (d.kind === "entity" && !has(doc.entities, d.id)) return null;
    if (t.kind === "entity" && !has(doc.entities, t.id)) return null;
    if (d.kind === "cluster" && !has(doc.clusters, d.id)) return null;
    if (t.kind === "cluster" && !has(doc.clusters, t.id)) return null;
    if (t.kind === "cluster" && d.kind === "entity") {
      var c = doc.clusters[t.id];
      if ((c.shown || []).indexOf(d.id) >= 0) return unpeel(doc, t.id, d.id);
      return moveTo(doc, d.id, t.id);
    }
    // A cluster dropped on a cluster, or on a member of an open one: the
    // target cluster takes its members and keeps its name.
    function absorb(from, into) {
      if (from === into) return null;
      var members = doc.clusters[from].members.filter(function (m) {
        return has(doc.entities, m);
      });
      var next = clone(doc);
      delete next.clusters[from];
      next.clusters[into].members = next.clusters[into].members.concat(members);
      return { doc: next, select: "cluster/" + into, notice: "merged “" + label(doc, from) + "” into “" + label(doc, into) + "” · Ctrl+Z undoes" };
    }
    if (t.kind === "cluster") return absorb(d.id, t.id);
    if (d.kind === "cluster") {
      var home = clusterOf(doc, t.id);
      return home ? absorb(d.id, home) : moveTo(doc, t.id, d.id);
    }
    var into = clusterOf(doc, t.id);
    if (into && into === clusterOf(doc, d.id)) return stack(doc, into, [t.id, d.id]);
    if (into) return moveTo(doc, d.id, into);
    return make(doc, [t.id, d.id]);
  }

  // Two members of one cluster dragged together (owner, 2026-09-25): they
  // go into its one stack, the rest drawn beside it — an open cluster
  // closes round them; a closed one takes them from beside its stack.
  function stack(doc, cid, entities) {
    var c = doc.clusters[cid];
    var beside = c.closed ? (c.shown || []).slice() : c.members.filter(function (m) { return has(doc.entities, m); });
    var left = beside.filter(function (m) {
      return entities.indexOf(m) < 0;
    });
    if (left.length === beside.length) return null;
    var next = clone(doc);
    var n = next.clusters[cid];
    n.closed = true;
    if (left.length) n.shown = left;
    else delete n.shown;
    return { doc: next, select: "cluster/" + cid };
  }

  // K (owner, 2026-09-25): nothing selected, the rail's toggle; one
  // cluster, or a member of one, opens or closes it; several, clusters among
  // them, become one cluster. `picked`: qualified ids. An edit, or {refusal}.
  function pressK(doc, picked) {
    if (!picked.length) return toggleAll(doc) || { refusal: "nothing runs together here · select two or more and press K" };
    if (picked.length === 1) {
      var q = picked[0];
      if (!pickable([q]).length) return { refusal: "K takes a component or a cluster · or nothing, for all" };
      var cid = q.indexOf("cluster/") === 0 ? q.slice(8) : q.indexOf("entity/") === 0 ? clusterOf(doc, q.slice(7)) : null;
      if (cid && has(doc.clusters, cid)) {
        var turned = setClosed(doc, cid, !doc.clusters[cid].closed);
        turned.select = q;
        return turned;
      }
      return { refusal: "“" + nameOf(doc, q.slice(q.indexOf("/") + 1)) + "” is in no cluster" };
    }
    return make(doc, entitiesOf(doc, picked)) || { refusal: "select two or more to cluster" };
  }

  // What lights up for a selection: an open cluster with all its members, a
  // closed one with those drawn beside it.
  function lit(doc, picked) {
    var out = [];
    picked.forEach(function (q) {
      if (out.indexOf(q) < 0) out.push(q);
      var c = q.indexOf("cluster/") === 0 && has(doc.clusters, q.slice(8)) ? doc.clusters[q.slice(8)] : null;
      if (!c) return;
      (c.closed ? c.shown || [] : c.members || []).forEach(function (m) {
        if (has(doc.entities, m) && out.indexOf("entity/" + m) < 0) out.push("entity/" + m);
      });
    });
    return out;
  }

  // ---- geometry ----

  var GAP = 0.14; // radians between two sectors
  var ONE_EACH = 12; // above this many members, one arc per state
  var STATES = ["vulnerable", "exposed", "unknown", null];

  // A closed cluster's ring (spec §4.1), clockwise from the top: a sector
  // per member, or per state when there are many; `full` when one state
  // takes the whole ring.
  function segments(states) {
    var n = states.length;
    if (!n) return [];
    var parts;
    if (n <= ONE_EACH) {
      parts = states.map(function (s) {
        return { state: s, share: 1 };
      });
    } else {
      parts = STATES.map(function (s) {
        return { state: s, share: states.filter(function (x) { return x === s; }).length };
      }).filter(function (p) {
        return p.share > 0;
      });
      if (parts.length === 1) return [{ state: parts[0].state, full: true }];
    }
    var total = parts.reduce(function (sum, p) { return sum + p.share; }, 0);
    var at = -Math.PI / 2;
    return parts.map(function (p) {
      var sweep = (2 * Math.PI * p.share) / total;
      var out = { state: p.state, from: at + GAP / 2, to: at + sweep - GAP / 2 };
      at += sweep;
      return out;
    });
  }

  function round(v) {
    return Math.round(v * 100) / 100 || 0;
  }

  // An SVG path along the circle from angle `from` to `to`, clockwise.
  function arc(cx, cy, r, from, to) {
    var x0 = round(cx + r * Math.cos(from)), y0 = round(cy + r * Math.sin(from));
    var x1 = round(cx + r * Math.cos(to)), y1 = round(cy + r * Math.sin(to));
    return "M" + x0 + " " + y0 + "A" + r + " " + r + " 0 " + (to - from > Math.PI ? 1 : 0) + " 1 " + x1 + " " + y1;
  }

  // The drawn nodes whose centre (their plate's, where they have one) lies
  // in the rectangle, given by any two opposite corners.
  function within(nodes, rect) {
    var x0 = Math.min(rect.x0, rect.x1), x1 = Math.max(rect.x0, rect.x1);
    var y0 = Math.min(rect.y0, rect.y1), y1 = Math.max(rect.y0, rect.y1);
    return nodes.filter(function (n) {
      var cx = n.hub ? n.x + n.hub.x : n.x + n.width / 2;
      var cy = n.hub ? n.y + n.hub.y : n.y + n.height / 2;
      return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
    }).map(function (n) {
      return n.id;
    });
  }

  // Where a closing cluster stands: amid its members (all one size, so
  // their corners average to it).
  function closeAt(boxes) {
    if (!boxes.length) return null;
    var x = 0, y = 0;
    boxes.forEach(function (b) {
      x += b.x;
      y += b.y;
    });
    return { x: Math.round(x / boxes.length), y: Math.round(y / boxes.length) };
  }

  // Members opened round where the cluster now stands (`at`), keeping the
  // spacing they had: their stored positions, shifted. Members never placed
  // are the layout's to place.
  function reopen(at, members, stored) {
    var known = members.filter(function (m) {
      return has(stored, m);
    });
    var centre = closeAt(known.map(function (m) { return stored[m]; }));
    var out = {};
    if (!centre) return out;
    known.forEach(function (m) {
      out[m] = { x: stored[m].x + at.x - centre.x, y: stored[m].y + at.y - centre.y };
    });
    return out;
  }

  // What glides from where when clusters open and close (spec §4.3), from
  // where each member of a closed cluster was drawn before and is now
  // ({entity: "cluster/…"}): `origins` — a node new on the canvas starts
  // amid these drawn ids; `exits` — a node gone from it glides into this one.
  function transitions(before, after) {
    before = before || {};
    after = after || {};
    var origins = {}, exits = {};
    var was = Object.create(null), now = Object.create(null);
    Object.keys(before).forEach(function (e) { was[before[e]] = true; });
    Object.keys(after).forEach(function (e) { now[after[e]] = true; });
    // Opened: no longer drawn, and a member of it drawn on its own now (one
    // merged into another cluster did not open).
    var gone = Object.keys(was).filter(function (c) {
      return !now[c] && Object.keys(before).some(function (e) {
        return before[e] === c && !has(after, e);
      });
    });
    function from(id, source) {
      var list = (origins[id] = origins[id] || []);
      if (list.indexOf(source) < 0) list.push(source);
    }
    Object.keys(before).forEach(function (e) {
      if (!has(after, e)) from("entity/" + e, before[e]);
    });
    Object.keys(after).forEach(function (e) {
      var into = after[e];
      if (was[into]) {
        // A whole cluster taken into one that was there: it glides into it;
        // so does a component drawn on its own before (moved in, put back).
        if (has(before, e) && before[e] !== into && !now[before[e]]) exits[before[e]] = into;
        if (!has(before, e)) exits["entity/" + e] = into;
        return;
      }
      if (!has(before, e)) {
        exits["entity/" + e] = into;
        from(into, "entity/" + e);
      } else {
        from(into, before[e]);
        if (!now[before[e]]) exits[before[e]] = into;
      }
    });
    return { origins: origins, exits: exits, opened: gone };
  }

  // Places kept in place when clusters close or open (spec §4.3), for any
  // change — an edit, undo, the source: a closing cluster's members keep
  // their last places (`prev`, drawn ids) for opening, and it stands amid
  // them; an opening one's members come round where it stood, spaced as
  // their stored places (`stored`) say. `fixed`: places set by hand for
  // this change (a member dropped out of its stack), not placed again.
  // Returns places to write.
  function inPlace(motion, prev, stored, fixed) {
    var out = {};
    if (!motion) return out;
    Object.keys(motion.origins || {}).forEach(function (id) {
      if (id.indexOf("cluster/") !== 0) return;
      var sources = motion.origins[id];
      var members = sources.filter(function (s) {
        return s.indexOf("entity/") === 0;
      });
      // Made of other clusters only (merged, renamed, a merge undone): one
      // put somewhere before in this browser stays there.
      if (!members.length && has(stored, id)) return;
      var at = [];
      sources.forEach(function (s) {
        if (has(prev, s)) {
          at.push(prev[s]);
          if (s.indexOf("entity/") === 0) out[s] = { x: prev[s].x, y: prev[s].y };
        } else if (s.indexOf("entity/") === 0 && has(stored, s)) {
          // Not drawn before (deleted, then undone): where it was kept.
          at.push(stored[s]);
        }
      });
      if (at.length) out[id] = closeAt(at);
    });
    (motion.opened || []).forEach(function (c) {
      if (!prev[c]) return;
      var members = Object.keys(motion.origins || {}).filter(function (id) {
        return id.indexOf("entity/") === 0 && motion.origins[id].indexOf(c) >= 0 && !has(fixed, id);
      });
      var mine = {};
      members.forEach(function (m) {
        if (has(stored, m)) mine[m] = stored[m];
      });
      var moved = reopen(prev[c], members, mine);
      Object.keys(moved).forEach(function (m) {
        out[m] = moved[m];
      });
    });
    return out;
  }

  // The clusters a glide opens: drawn as a stack before, not after (a
  // member dragged out beside its stack does not open it).
  function opened(motion) {
    return ((motion && motion.opened) || []).slice();
  }

  // After clusters open in place (owner, 2026-09-25: readable, not piled):
  // each outline with what is in it is one box, every other node its own.
  // What an opened one (`fixed`, outline ids) covers gives way, and what
  // that pushes gives way in turn, until all stand `gap` clear; two opened
  // ones, or two already pushed, share the push half each. What nothing
  // pushes stays where it is. Returns new places {node id: {x, y}}.
  function spread(placed, fixed, gap) {
    var inside = Object.create(null);
    var units = (placed.outlines || []).map(function (o) {
      o.members.forEach(function (m) { inside[m] = true; });
      var isOpened = fixed.indexOf(o.id) >= 0;
      return { id: o.id, x: o.x, y: o.y, width: o.width, height: o.height, nodes: o.members, opened: isOpened, pushing: isOpened, dx: 0, dy: 0 };
    });
    (placed.nodes || []).forEach(function (n) {
      if (!inside[n.id]) units.push({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height, nodes: [n.id], opened: false, pushing: false, dx: 0, dy: 0 });
    });
    function shift(u, dx, dy) {
      u.x += dx;
      u.y += dy;
      u.dx += dx;
      u.dy += dy;
    }
    for (var pass = 0; pass < 60; pass++) {
      var any = false;
      for (var i = 0; i < units.length; i++) {
        for (var j = i + 1; j < units.length; j++) {
          var a = units[i], b = units[j];
          if (!a.pushing && !b.pushing) continue; // nothing pushed them: they stay
          var ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) + gap;
          var oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) + gap;
          if (ox <= 0 || oy <= 0) continue;
          any = true;
          var alongX = ox <= oy;
          var sign = alongX ? (b.x + b.width / 2 >= a.x + a.width / 2 ? 1 : -1) : (b.y + b.height / 2 >= a.y + a.height / 2 ? 1 : -1);
          var d = alongX ? ox : oy;
          // Who gives way: the one not pushing; between two pushing, the
          // opened stand and the pushed give way, else half each.
          var ka = !a.pushing ? 1 : !b.pushing ? 0 : a.opened === b.opened ? 0.5 : a.opened ? 0 : 1;
          var kb = 1 - ka;
          if (ka) {
            shift(a, alongX ? -sign * d * ka : 0, alongX ? 0 : -sign * d * ka);
            a.pushing = true;
          }
          if (kb) {
            shift(b, alongX ? sign * d * kb : 0, alongX ? 0 : sign * d * kb);
            b.pushing = true;
          }
        }
      }
      if (!any) break;
    }
    var at = Object.create(null);
    (placed.nodes || []).forEach(function (n) { at[n.id] = n; });
    var out = {};
    units.forEach(function (u) {
      if (!u.dx && !u.dy) return;
      u.nodes.forEach(function (id) {
        if (at[id]) out[id] = { x: Math.round(at[id].x + u.dx), y: Math.round(at[id].y + u.dy) };
      });
    });
    return out;
  }

  // The line `id` is drawn in: its merged line if it is in one.
  function drawnLine(bundles, id) {
    var keys = Object.keys(bundles || {});
    for (var i = 0; i < keys.length; i++) if (bundles[keys[i]].indexOf(id) >= 0) return keys[i];
    return id;
  }

  // Only components and clusters are picked together.
  function pickable(ids) {
    return ids.filter(function (id) {
      return /^(entity|cluster)\//.test(id);
    });
  }

  var api = {
    SPECIFIC: SPECIFIC,
    opened: opened,
    inPlace: inPlace,
    spread: spread,
    pickable: pickable,
    drawnLine: drawnLine,
    transitions: transitions,
    clusterOf: clusterOf,
    label: label,
    lead: lead,
    entitiesOf: entitiesOf,
    together: together,
    forget: forget,
    rekey: rekey,
    make: make,
    build: build,
    gather: gather,
    toggleAll: toggleAll,
    takeOut: takeOut,
    moveTo: moveTo,
    dissolve: dissolve,
    rename: rename,
    setClosed: setClosed,
    peel: peel,
    merge: merge,
    unpeel: unpeel,
    pressK: pressK,
    lit: lit,
    segments: segments,
    arc: arc,
    within: within,
    closeAt: closeAt,
    reopen: reopen,
  };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorClusters = api;
})();
