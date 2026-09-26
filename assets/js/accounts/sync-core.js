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
    var gone = new Map();       // document id -> {p, rec, seq} of a delete that may be undone
    var unloading = false;      // the page is closing: saves must outlive it

    function persist(p) { return o.store.bind(p, recs[p] || null); }
    function bump(p) { seq[p] = (seq[p] || 0) + 1; return seq[p]; }

    function showState() {
      var r = current && recs[current];
      if (!r) return o.onState(null);
      // Logged out nothing is saved: an edit waits for the next login.
      if (!user) return o.onState(r.text === r.saved ? null : "loggedout");
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
          var fields = { name: name, body: body, base: base };
          return o.request("PUT", "/api/documents/" + id, fields, unloading ? { keepalive: true } : undefined).then(function (res) {
            if (res.ok) {
              adopt(id, res.data.version, body);
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
      // A new queue starts on the record; one already there starts again.
      var had = queues.has(rec.id);
      var q = queueFor(rec, p);
      if (had) q.autosave.bind({ version: rec.base, saved: rec.saved });
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
    // folder or, if that is gone, at the top. (Only its owner chooses a
    // folder, so a 404 there is a folder deleted meanwhile.)
    function create(text, p) {
      var token = bump(p);
      var name = names[p] || "Untitled";
      function post(folder) {
        return o.request("POST", "/api/documents", { name: name, profile: p, body: text, folder: folder });
      }
      var folder = o.page.folder();
      return post(folder).then(function (res) {
        if (res.ok || res.status !== 404 || folder == null) return res;
        o.page.say("that folder is gone · kept at the top");
        return post(null);
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

    // A 409 may be this browser's own save whose answer never came (the page
    // closed while it was on its way): the server then has exactly the text
    // sent, which is saved, not a conflict.
    function conflict(id, q, c) {
      return o.request("GET", "/api/documents/" + id).then(function (res) {
        if (queues.get(id) !== q) return;
        if (!res.ok || res.data.body !== c.mine) {
          conflicts.set(id, { q: q, c: c });
          return sayConflict(id);
        }
        adopt(id, res.data.version, c.mine);
        q.autosave.bind({ version: res.data.version, saved: c.mine });
        var p = recordsOf(id)[0];
        if (p && recs[p].text !== c.mine) q.autosave.change(recs[p].text, names[p]);
        showState();
      });
    }

    // The server has `body` at `version`: every record of the document knows.
    function adopt(id, version, body) {
      recordsOf(id).forEach(function (k) {
        recs[k].base = version;
        recs[k].saved = body;
        persist(k);
      });
    }

    function sayConflict(id) {
      var k = conflicts.get(id);
      if (!k) return false;
      var when = o.time ? " · " + o.time(k.c.theirs.updated_at) : "";
      o.page.say("Changed by " + (k.c.theirs.updated_by || "someone") + when, [
        ["Load theirs", function () { conflicts.delete(id); return load(id); }],
        // What is on the page now, edits since the conflict included.
        ["Keep mine as copy", function () {
          conflicts.delete(id);
          var p = recordsOf(id)[0];
          return copy(k.q, p ? recs[p].text : k.c.mine);
        }],
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

    // The document on the page is already open: loading it again would
    // replace what is typed with what the server has.
    function open(id) {
      return isOpen(id) ? Promise.resolve(true) : load(id);
    }

    function load(id) {
      // Its waiting edit first: reopening must not drop what was typed.
      var q = queues.get(id);
      var first = q ? q.autosave.flush() : Promise.resolve();
      return first.then(function () {
        return o.request("GET", "/api/documents/" + id);
      }).then(function (res) {
        if (!res.ok) {
          o.page.say(res.status === 0 ? "server unreachable" : "not opened");
          return false;
        }
        var d = res.data;
        // Recent (spec §9.2): opening is said with a POST; reading writes nothing.
        o.request("POST", "/api/documents/" + d.id + "/opened");
        var mine = { id: d.id, version: d.version, body: d.body, role: d.role, profile: d.profile };
        pendingOpen = mine;
        return o.page.replace(d.body, "opened " + d.name, { origin: "server", fresh: true }).then(function (ok) {
          // Overtaken by a later open: that one is still on its way.
          if (!ok && pendingOpen === mine) pendingOpen = null;
          if (ok && d.role === "viewer") o.page.say("view only · changes stay in this browser");
          return ok;
        });
      });
    }

    function isOpen(id) { return !!(current && recs[current] && recs[current].id === id); }

    // The document was deleted: its records end, kept for an Undo.
    function forget(id) {
      recordsOf(id).forEach(function (p) {
        gone.set(id, { p: p, rec: recs[p], seq: bump(p) });
        delete recs[p];
        persist(p);
      });
      var q = queues.get(id);
      if (q) q.autosave.stop();
      queues.delete(id);
      conflicts.delete(id);
      showState();
    }

    // A delete undone: the mode it was in holds it again, with what was
    // typed meanwhile, unless another text came into that mode since.
    function restore(id) {
      var g = gone.get(id);
      gone.delete(id);
      if (!g || !user || g.rec.user !== user.id || seq[g.p] !== g.seq || recs[g.p]) return false;
      bind(g.p, { user: user.id, id: id, base: g.rec.base, saved: g.rec.saved, text: lastText[g.p] });
      return true;
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
        return showState();
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
      // A server text nobody waits for (an open overtaken by another) is
      // never an edit of the document the mode holds, nor is any other.
      if (origin) {
        detach(p);
        return offer(p);
      }
      var r = recs[p];
      if (!r) {
        // Another text in a mode whose document was deleted: an Undo no
        // longer puts that document back there.
        if (switched) gone.forEach(function (g, id) { if (g.p === p) gone.delete(id); });
        return showState();
      }
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
          // The server has what is here (a save whose answer the last page
          // never saw): saved, on the server's version.
          if (d.body === r.text) {
            r.base = d.version;
            r.saved = d.body;
            persist(p);
          }
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
      // That document's waiting edit, or else the one on the page.
      flush: function (id) {
        var r = current && recs[current];
        var q = queues.get(id != null ? id : r && r.id);
        return q ? q.autosave.flush() : Promise.resolve();
      },
      // The page is closing: every waiting edit goes, in requests that
      // outlive it.
      unload: function () {
        unloading = true;
        queues.forEach(function (q) { q.autosave.flush(); });
        unloading = false;
      },
      restore: restore,
      // The conflict of the document on the page, shown again.
      showConflict: function () {
        var r = current && recs[current];
        return r ? sayConflict(r.id) : false;
      },
      modeOf: function (id) {
        return PROFILES.filter(function (p) { return recs[p] && recs[p].id === id; })[0] || null;
      },
      openId: function () { return current && recs[current] ? recs[current].id : null; },
      isOpen: isOpen,
    };
  }

  var api = { createSyncCore: createSyncCore };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") {
    window.effractorAccounts = window.effractorAccounts || {};
    window.effractorAccounts.createSyncCore = createSyncCore;
  }
})();
