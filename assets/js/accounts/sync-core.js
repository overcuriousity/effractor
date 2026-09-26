// Which server document each mode's text is, and keeping it saved (accounts
// spec §6). Pure: the requests, storage, page and timers are given, so every
// way of writing one document's text into another is a node test
// (scripts/accounts-sync.test.js).
//
// A mode's record is {user, id, base, saved, text}: the document, the server
// version `saved` is, and the text built on it. Text and base are written
// together on every edit, so whatever record a tab finds after a reload is
// consistent with itself — another tab's newer save makes it a conflict, never
// a silent overwrite. Each document has its own save queue: switching mode,
// opening another document or starting a new one never moves an edit from
// one document to another.
(function () {
  var createAutosave = typeof module !== "undefined"
    ? require("./autosave.js").createAutosave
    : function (o) { return window.effractorAccounts.createAutosave(o); };
  var PROFILES = ["fault-tree", "attack-tree", "architecture"];

  function createSyncCore(o) {
    var user = null;
    var current = null;         // the mode on the page
    var recs = {};              // profile -> record, or absent
    var queues = new Map();     // document id -> {autosave, profile}
    var lastText = {};          // profile -> the last text the page had there
    var names = {};             // profile -> that text's document name
    var loaded = null;          // the records read from storage, once
    var early = [];             // texts told before they were read
    var seq = {};               // profile -> bumped whenever its binding changes
    var pendingOpen = null;     // a server document on its way onto the page
    var conflicts = new Map();  // document id -> the notice's arguments, until resolved

    function persist(p) { return o.store.bind(p, recs[p] || null); }
    function bump(p) { seq[p] = (seq[p] || 0) + 1; return seq[p]; }

    function showState() {
      var r = current && recs[current];
      if (!r) return o.onState(null);
      var q = queues.get(r.id);
      o.onState(q ? q.autosave.state() : "saved");
    }

    function recordsOf(id) {
      return PROFILES.filter(function (p) { return recs[p] && recs[p].id === id; });
    }

    function queueFor(rec, p) {
      var id = rec.id;
      var q = queues.get(id);
      if (q) return q;
      q = { profile: p };
      q.autosave = createAutosave({
        put: function (name, body, base) {
          return o.request("PUT", "/api/documents/" + id, { name: name, body: body, base: base }).then(function (res) {
            if (res.ok) {
              recordsOf(id).forEach(function (k) {
                recs[k].base = res.data.version;
                recs[k].saved = body;
                persist(k);
              });
              o.onSaved(id, { name: name, version: res.data.version, updated_at: res.data.updated_at });
            }
            return res;
          });
        },
        delay: o.delay,
        timers: o.timers,
        onState: function () { showState(); },
        onConflict: function (c) { conflict(id, q, c); },
        onLost: function () {
          o.page.say("no longer yours to save · kept in this browser");
          forget(id);
        },
        onLoggedOut: function () {
          stopAll();
          o.onLoggedOut();
        },
        onRefused: function (why) {
          o.page.say("not saved · " + (typeof why === "string" && why ? why : "refused"));
        },
      });
      q.autosave.bind({ version: rec.base, saved: rec.saved });
      queues.set(id, q);
      return q;
    }

    function stopAll() {
      queues.forEach(function (q) { q.autosave.stop(); });
      queues.clear();
    }

    // The mode no longer holds a server document. Its own pending edit still
    // goes to it: the queue belongs to the document, not to the mode.
    function detach(p) {
      var r = recs[p];
      bump(p);
      if (r) {
        var q = queues.get(r.id);
        if (q) q.autosave.flush();
      }
      delete recs[p];
      persist(p);
      showState();
    }

    function bind(p, rec) {
      bump(p);
      recs[p] = rec;
      persist(p);
      var q = queueFor(rec, p);
      q.autosave.bind({ version: rec.base, saved: rec.saved });
      if (rec.text !== rec.saved && p === current) q.autosave.change(rec.text, names[p]);
      showState();
      return q;
    }

    function why(res) {
      if (res.status === 0) return "unreachable";
      if (typeof res.data === "string" && res.data) return res.data;
      return "refused";
    }

    // A new server document from the page's text in mode p, in the chosen
    // folder or, if that is gone, at the top.
    function create(text, p) {
      var token = bump(p);
      var name = names[p] || "Untitled";
      function post(folder) {
        return o.request("POST", "/api/documents", { name: name, profile: p, body: text, folder: folder });
      }
      var folder = o.page.folder();
      return post(folder).then(function (res) {
        if (!res.ok && res.status === 404 && folder != null) return post(null);
        return res;
      }).then(function (res) {
        if (!res.ok) {
          offer(p, "not kept on the server · " + why(res));
          return null;
        }
        if (o.onCreated) o.onCreated(res.data.id);
        if (seq[p] !== token || !user) return res.data.id; // the mode moved on; the document is in the tree
        bind(p, { user: user.id, id: res.data.id, base: res.data.version, saved: text, text: lastText[p] });
        return res.data.id;
      });
    }

    function offer(p, text) {
      var name = names[p] || "";
      o.page.say(text || 'Save "' + name + '" to your documents', [["Save", function () {
        return create(lastText[p], p);
      }]], true);
    }

    function conflict(id, q, c) {
      conflicts.set(id, { q: q, c: c });
      sayConflict(id);
    }

    function sayConflict(id) {
      var k = conflicts.get(id);
      if (!k) return false;
      var when = o.time ? " · " + o.time(k.c.theirs.updated_at) : "";
      o.page.say("Changed by " + (k.c.theirs.updated_by || "someone") + when, [
        ["Load theirs", function () { conflicts.delete(id); return open(id); }],
        ["Keep mine as copy", function () { conflicts.delete(id); return copy(k.q, k.c.mine); }],
      ], true);
      return true;
    }

    function copy(q, text) {
      var name = (q.autosave.name() || "Untitled") + " (copy)";
      var body = o.renameText ? o.renameText(text, name) : Promise.resolve(text);
      return body.then(function (b) {
        return o.request("POST", "/api/documents", { name: name, profile: q.profile, body: b, folder: null });
      }).then(function (res) {
        if (!res.ok) return o.page.say("copy not kept · " + why(res));
        return open(res.data.id);
      });
    }

    function open(id) {
      // Its waiting edit first: reopening must not drop what was typed.
      var q = queues.get(id);
      var first = q ? q.autosave.flush() : Promise.resolve();
      return first.then(function () {
        return o.request("GET", "/api/documents/" + id);
      }).then(function (res) {
        if (!res.ok) return o.page.say(res.status === 0 ? "server unreachable" : "not opened");
        var d = res.data;
        // Recent (spec §9.2): opening is said with a POST; reading writes nothing.
        o.request("POST", "/api/documents/" + d.id + "/opened");
        pendingOpen = { id: d.id, version: d.version, body: d.body, role: d.role, profile: d.profile };
        return o.page.replace(d.body, "opened " + d.name, { origin: "server", fresh: true }).then(function (ok) {
          if (!ok) pendingOpen = null;
          if (d.role === "viewer") o.page.say("view only · changes stay in this browser");
          return ok;
        });
      });
    }

    function forget(id) {
      recordsOf(id).forEach(function (p) {
        bump(p);
        delete recs[p];
        persist(p);
      });
      var q = queues.get(id);
      if (q) q.autosave.stop();
      queues.delete(id);
      conflicts.delete(id);
      showState();
    }

    // Every accepted text of the page: an edit (origin null), a mode switch
    // (null too), or a replacement with where it came from.
    function text(t, p, origin, name) {
      if (!loaded || loaded.pending) {
        early.push([t, p, origin, name]);
        return;
      }
      var switched = p !== current;
      current = p;
      lastText[p] = t;
      names[p] = name;
      // Logged out, the records follow the page, to be saved at the next
      // login: an edit updates its mode's record, anything that replaces
      // the text ends it. (The first text of a page is kept as it is.)
      if (!user) {
        var own = recs[p];
        if (!own || origin === "load") return;
        if (origin || (switched && t !== own.text)) {
          delete recs[p];
          persist(p);
        } else {
          own.text = t;
          persist(p);
        }
        return;
      }
      if (origin === "load") return showState();
      if (origin === "server" && pendingOpen && pendingOpen.profile === p) {
        var b = pendingOpen;
        pendingOpen = null;
        conflicts.delete(b.id);
        // A viewer's copy is theirs to change in this browser, never saved.
        if (b.role === "viewer") return detach(p);
        bind(p, { user: user.id, id: b.id, base: b.version, saved: b.body, text: t });
        return;
      }
      if (origin === "new" || origin === "file") {
        detach(p);
        return create(t, p);
      }
      if (origin && origin !== "server") {
        detach(p);
        return offer(p);
      }
      var r = recs[p];
      if (!r) return showState();
      // Another text arrived in this mode than the one it holds: the profile
      // line was edited, and the text moved here from another mode. What the
      // mode held stays as it is on the server.
      if (switched && t !== r.text) {
        detach(p);
        return offer(p);
      }
      r.text = t;
      persist(p);
      queueFor(r, p).autosave.change(t, name);
      showState();
    }

    // The records of every mode, read once; texts told meanwhile follow.
    function init() {
      if (loaded) return loaded.promise;
      loaded = { pending: true };
      loaded.promise = Promise.all(PROFILES.map(function (p) {
        return o.store.binding(p).then(function (r) { if (r) recs[p] = r; });
      })).then(function () {
        loaded.pending = false;
        var told = early;
        early = [];
        told.forEach(function (args) { text.apply(null, args); });
      });
      return loaded.promise;
    }

    // Logging in: this user's records stay, another user's go. The mode on
    // the page is checked against the server; what the page shows is what
    // was last worked on, so it is saved on the record's version — a newer
    // save by somebody else makes that a conflict, never a loss.
    // opts.fresh: somebody just logged in (not a page load with a session),
    // the one moment local work is offered (spec §6.6).
    function login(u, opts) {
      var fresh = !opts || opts.fresh !== false;
      return init().then(function () {
        user = u;
        current = o.page.profile();
        PROFILES.forEach(function (p) {
          if (recs[p] && recs[p].user !== u.id) {
            delete recs[p];
            persist(p);
          }
        });
        var p = current, r = p && recs[p], pageText = o.page.text();
        if (!p) return;
        if (!r) {
          if (pageText && fresh) offer(p);
          return showState();
        }
        return o.request("GET", "/api/documents/" + r.id).then(function (res) {
          if (!res.ok) {
            if (res.status === 404 || res.status === 403) {
              delete recs[p];
              persist(p);
            }
            return showState();
          }
          var d = res.data;
          if (d.role === "viewer") {
            delete recs[p];
            persist(p);
            return showState();
          }
          if (pageText !== null && pageText !== r.text) r.text = pageText;
          // Nothing unsaved and somebody saved since: theirs, quietly.
          if (r.text === r.saved && d.version !== r.base) {
            pendingOpen = { id: r.id, version: d.version, body: d.body, role: d.role, profile: p };
            return o.page.replace(d.body, "updated from the server", { origin: "server", fresh: true });
          }
          bind(p, r);
        });
      });
    }

    // Logging out: what is waiting is saved first; the records stay, marked
    // with the user, so logging in again picks them up.
    function logout() {
      var waiting = [];
      queues.forEach(function (q) { waiting.push(q.autosave.flush()); });
      return Promise.all(waiting).then(function () {
        stopAll();
        user = null;
        showState();
      });
    }

    return {
      init: init,
      text: text,
      login: login,
      logout: logout,
      open: open,
      create: function (p) { return create(lastText[p], p); },
      forget: forget,
      flush: function () {
        var r = current && recs[current];
        var q = r && queues.get(r.id);
        return q ? q.autosave.flush() : Promise.resolve();
      },
      // The conflict of the document on the page, shown again.
      showConflict: function () {
        var r = current && recs[current];
        return r ? sayConflict(r.id) : false;
      },
      modeOf: function (id) {
        return PROFILES.filter(function (p) { return recs[p] && recs[p].id === id; })[0] || null;
      },
      openId: function () { return current && recs[current] ? recs[current].id : null; },
      isOpen: function (id) { return !!(current && recs[current] && recs[current].id === id); },
    };
  }

  var api = { createSyncCore: createSyncCore };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") {
    window.effractorAccounts = window.effractorAccounts || {};
    window.effractorAccounts.createSyncCore = createSyncCore;
  }
})();
