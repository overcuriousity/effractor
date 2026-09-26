// The page's side of keeping documents saved (accounts spec §6): sync-core.js
// decides, this wires it to the app, the store and the bar. Logged in: New
// and an opened file become documents in the selected folder; a public link
// does not (it is somebody's snapshot) and is offered once, as is local work
// found at login. Logging out saves what is waiting first.
(function () {
  if (typeof document === "undefined") return;
  var A = window.effractorAccounts, client = A.client, app = window.effractor, D = A.documents;
  var store = window.effractorStore.createStore(window.indexedDB);
  var $ = function (id) { return document.getElementById(id); };
  var WORDS = {
    saved: "saved", saving: "saving…", retrying: "not saved · retrying", conflict: "not saved",
    lost: "not saved", loggedout: "not saved · logged out", refused: "not saved",
  };

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

  function showPath() {
    var id = core.openId(), el = $("model-path");
    var listing = A.documentsUi && A.documentsUi.listing();
    var path = id && listing ? D.pathOf(listing, id) : [];
    el.hidden = !id;
    el.textContent = path.length ? path.join(" / ") + " /" : "";
  }

  var core = A.createSyncCore({
    request: client.request,
    store: store,
    page: {
      text: function () { return app.state.text; },
      profile: function () { return app.state.doc ? app.state.doc.profile : null; },
      name: function () { return app.state.doc ? app.state.doc.name : ""; },
      folder: function () { return A.documentsUi ? A.documentsUi.selectedFolder() : null; },
      say: function (text, actions, sticky) { app.say(text, actions, sticky); },
      replace: function (text, said, opts) { return app.replaceDocument(text, said, null, opts); },
    },
    renameText: renameText,
    delay: 800,
    onState: function (s) {
      $("save-state").hidden = !s;
      if (s) $("save-state").textContent = WORDS[s] || s;
      showPath();
    },
    onSaved: function (id, fields) {
      if (A.documentsUi) A.documentsUi.saved(id, fields);
    },
    // A new document: the list shows it, and the crumb its folder.
    onCreated: function () {
      if (A.documentsUi) A.documentsUi.refresh().then(showPath);
    },
    // A save found the session gone: say so, and let the bar show it.
    onLoggedOut: function () {
      A.session.refresh();
      app.say("logged out · changes stay in this browser", [["Log in", function () { $("login-open").click(); }]], true);
    },
  });

  app.onText(core.text);
  A.session.onChange(function (user) {
    if (user) return app.ready.then(function () { return core.login(user); }).then(function () {
      if (A.documentsUi) A.documentsUi.refresh().then(showPath);
    });
    return core.logout();
  });
  // account-ui.js asks before it logs out, while the session still saves.
  A.beforeLogout = function () { return core.logout(); };
  window.addEventListener("pagehide", function () { core.flush(); });

  // New goes through the file menu's New, so it is the same empty document;
  // the core then keeps it in the chosen folder.
  function createNew(folderId) {
    if (A.documentsUi) A.documentsUi.selectFolder(folderId);
    document.querySelector('[data-file="new"]').click();
  }

  function rename(id, name) {
    if (core.isOpen(id)) {
      // Saved at once, not after the pause edits wait for: a rename is one act.
      return renameText(app.state.text, name)
        .then(function (text) { return app.adoptSource(text); })
        .then(function () { return core.flush(); });
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

  // Opening fills Recent and marks the open row: the list is drawn again.
  function open(id) {
    return core.open(id).then(function (ok) {
      if (A.documentsUi) A.documentsUi.refresh().then(showPath);
      return ok;
    });
  }

  A.sync = {
    open: open, createNew: createNew, rename: rename, download: download,
    isOpen: core.isOpen, openId: core.openId, forget: core.forget,
  };
})();
