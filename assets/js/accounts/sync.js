// Which server document each mode's working text is, and keeping it saved
// (accounts spec §6). Logged in: New and an opened file become documents in
// the selected folder; a public link does not (it is somebody's snapshot) and
// is offered once, as is local work found at login. Logged out: bindings go,
// the text stays in this browser.
(function () {
  if (typeof document === "undefined") return;
  var A = window.effractorAccounts, client = A.client, app = window.effractor, D = A.documents;
  var store = window.effractorStore.createStore(window.indexedDB);
  var $ = function (id) { return document.getElementById(id); };
  var bound = { "fault-tree": null, "attack-tree": null, architecture: null };
  var pendingOpen = null; // {profile, binding} while a server document is on its way in
  var profile = null;     // the mode on the page

  var autosave = A.createAutosave({
    put: function (name, body, base) {
      var b = bound[profile];
      return client.request("PUT", "/api/documents/" + b.id, { name: name, body: body, base: base }).then(function (res) {
        if (res.ok) {
          b.version = res.data.version;
          b.saved = body;
          store.bind(profile, b);
          if (A.documentsUi) A.documentsUi.saved(b.id, { name: name, version: res.data.version, updated_at: res.data.updated_at });
        }
        return res;
      });
    },
    onState: function (s) {
      var words = { saved: "saved", saving: "saving…", retrying: "not saved · retrying", conflict: "not saved", lost: "not saved" };
      $("save-state").textContent = words[s];
      $("save-state").hidden = !bound[profile];
    },
    onConflict: function (c) {
      var when = new Date(c.theirs.updated_at * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      app.say("Changed by " + (c.theirs.updated_by || "someone") + " · " + when, [
        ["Load theirs", function () { open(bound[profile].id); }],
        ["Keep mine as copy", function () { keepAsCopy(c.mine); }],
      ], true);
    },
    onLost: function () {
      app.say("no longer yours to save · kept in this browser");
      unbind(profile);
    },
  });

  function showPath() {
    var b = bound[profile], el = $("model-path");
    var listing = A.documentsUi && A.documentsUi.listing();
    var path = b && listing ? D.pathOf(listing, b.id) : [];
    el.hidden = !b;
    el.textContent = path.length ? path.join(" / ") + " /" : "";
    $("save-state").hidden = !b;
  }

  function bindTo(p, b) {
    bound[p] = b;
    store.bind(p, b);
    if (p === profile) { autosave.bind({ version: b.version, saved: b.saved }); showPath(); }
  }
  function unbind(p) {
    bound[p] = null;
    store.bind(p, null);
    if (p === profile) { autosave.stop(); showPath(); }
  }

  // Every accepted text of the page.
  app.onText(function (text, p, origin) {
    var switched = p !== profile;
    profile = p;
    if (pendingOpen && pendingOpen.profile === p && (origin === "server")) {
      var b = pendingOpen.binding;
      pendingOpen = null;
      // A viewer's copy is theirs to change in this browser, never saved.
      if (b.role === "viewer") { unbind(p); return; }
      bindTo(p, b);
      if (text !== b.saved) autosave.change(text, app.state.doc.name); // made canonical on the way in
      return;
    }
    if (!A.session.user) return;
    if (origin === "new" || origin === "file") return create(text, p);
    if (origin && origin !== "server") {
      unbind(p);
      return offer(text, p);
    }
    if (switched) {
      var b2 = bound[p];
      if (b2) autosave.bind({ version: b2.version, saved: b2.saved }); else autosave.stop();
      showPath();
    }
    if (bound[p]) autosave.change(text, app.state.doc.name);
  });

  function create(text, p) {
    var folder = A.documentsUi ? A.documentsUi.selectedFolder() : null;
    return client.request("POST", "/api/documents", { name: app.state.doc.name, profile: p, body: text, folder: folder })
      .then(function (res) {
        if (!res.ok) return app.say("not kept on the server · " + (res.status === 0 ? "unreachable" : String(res.data || res.status)));
        bindTo(p, { id: res.data.id, version: res.data.version, saved: text });
        if (A.documentsUi) A.documentsUi.refresh().then(showPath);
      });
  }

  function offer(text, p) {
    app.say('Save "' + app.state.doc.name + '" to your documents', [["Save", function () { create(app.state.text, p); }]], true);
  }

  function open(id) {
    return autosave.flush().then(function () {
      return client.request("GET", "/api/documents/" + id);
    }).then(function (res) {
      if (!res.ok) return app.say(res.status === 0 ? "server unreachable" : "not opened");
      var d = res.data;
      pendingOpen = { profile: d.profile, binding: { id: d.id, version: d.version, saved: d.body, role: d.role } };
      return app.replaceDocument(d.body, "opened " + d.name, null, { origin: "server", fresh: D.startsFresh("server", true) })
        .then(function (ok) {
          if (!ok) pendingOpen = null;
          if (A.documentsUi) A.documentsUi.refresh().then(showPath);
          if (d.role === "viewer") app.say("view only · changes stay in this browser");
        });
    });
  }

  // New goes through the file menu's New, so it is the same empty document;
  // onText then keeps it in the chosen folder.
  function createNew(folderId) {
    if (A.documentsUi) A.documentsUi.selectFolder(folderId);
    document.querySelector('[data-file="new"]').click();
  }

  // Renaming is changing the document's own `name:`, done by the page's
  // parser so the text stays canonical; the server stores what it is sent.
  function renameText(text, name) {
    return app.solver.parse(text).then(function (parsed) {
      if (!parsed.ok) throw new Error("unreadable");
      parsed.ok.name = name;
      return app.solver.serialize(parsed.ok);
    }).then(function (written) {
      if (!written.ok) throw new Error("unwritable");
      return written.ok;
    });
  }

  function rename(id, name) {
    var p = Object.keys(bound).filter(function (k) { return bound[k] && bound[k].id === id; })[0];
    if (p && p === profile) {
      // Saved at once, not after the pause edits wait for: a rename is one act.
      return renameText(app.state.text, name)
        .then(function (text) { return app.adoptSource(text); })
        .then(function () { return autosave.flush(); });
    }
    return client.request("GET", "/api/documents/" + id).then(function (res) {
      if (!res.ok) return app.say("not renamed");
      return renameText(res.data.body, name).then(function (text) {
        return client.request("PUT", "/api/documents/" + id, { name: name, body: text, base: res.data.version });
      }).then(function (put) {
        if (!put.ok) app.say(put.status === 409 ? "changed meanwhile · try again" : "not renamed");
      });
    });
  }

  function keepAsCopy(text) {
    var p = profile;
    unbind(p);
    return renameText(text, app.state.doc.name + " (copy)").then(function (copy) {
      return client.request("POST", "/api/documents", { name: app.state.doc.name + " (copy)", profile: p, body: copy, folder: null });
    }).then(function (res) {
      if (!res.ok) return app.say("copy not kept");
      pendingOpen = null;
      return open(res.data.id);
    });
  }

  function download(id) {
    client.request("GET", "/api/documents/" + id).then(function (res) {
      if (!res.ok) return app.say("not downloaded");
      var url = URL.createObjectURL(new Blob([res.data.body], { type: "text/yaml" }));
      var a = document.createElement("a");
      a.href = url;
      a.download = window.effractorStore.fileName(res.data.name);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
  }

  // At start and at every login: bindings from before; the server's newer
  // text if this browser has nothing unsaved, else a save that may conflict.
  function reconcile() {
    return Promise.all(Object.keys(bound).map(function (p) {
      return store.binding(p).then(function (b) { bound[p] = b; });
    })).then(function () {
      profile = app.state.doc ? app.state.doc.profile : profile;
      var b = profile && bound[profile];
      if (!b) {
        if (A.session.user && app.state.text) offer(app.state.text, profile);
        return;
      }
      return client.request("GET", "/api/documents/" + b.id).then(function (res) {
        if (!res.ok) return res.status === 404 ? unbind(profile) : null;
        if (res.data.version === b.version || app.state.text !== b.saved) {
          autosave.bind({ version: b.version, saved: b.saved });
          showPath();
          autosave.change(app.state.text, app.state.doc.name);
          return;
        }
        pendingOpen = { profile: profile, binding: { id: b.id, version: res.data.version, saved: res.data.body } };
        return app.replaceDocument(res.data.body, "updated from the server", null, { origin: "server", fresh: true });
      });
    });
  }

  A.session.onChange(function (user) {
    if (user) return app.ready.then(reconcile);
    Object.keys(bound).forEach(unbind);
  });
  window.addEventListener("pagehide", function () { autosave.flush(); });

  A.sync = {
    open: open, createNew: createNew, rename: rename, download: download,
    isOpen: function (id) { return !!(profile && bound[profile] && bound[profile].id === id); },
    openId: function () { return profile && bound[profile] ? bound[profile].id : null; },
    forget: function (id) { Object.keys(bound).forEach(function (p) { if (bound[p] && bound[p].id === id) unbind(p); }); },
  };
})();
