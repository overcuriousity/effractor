// The Documents tab (accounts spec §9.2): Recent, My documents, Shared with
// me; search; right-click menus; drag onto folders; New document / folder;
// delete with Undo. Opening goes through sync.js, which owns what is bound.
(function () {
  if (typeof document === "undefined") return;
  var A = window.effractorAccounts, D = A.documents, client = A.client, app = window.effractor;
  var $ = function (id) { return document.getElementById(id); };
  var listing = null, query = "", expanded = Object.create(null), selectedFolder = null, renderLater = false;
  var ICONS = { "fault-tree": "mode-fault-tree", "attack-tree": "mode-attack-tree", architecture: "mode-architecture" };

  // ---- the left panel's tabs ----
  function showTab(name) {
    document.querySelectorAll("[data-left-tab]").forEach(function (tab) {
      var on = tab.getAttribute("data-left-tab") === name;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
    });
    $("left-model").hidden = name !== "model";
    $("view-documents").hidden = name !== "documents";
    if (name === "documents") refresh();
  }
  document.querySelectorAll("[data-left-tab]").forEach(function (tab) {
    tab.addEventListener("click", function () { showTab(tab.getAttribute("data-left-tab")); });
    tab.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var next = tab.getAttribute("data-left-tab") === "model" ? "documents" : "model";
      showTab(next);
      document.querySelector('[data-left-tab="' + next + '"]').focus();
    });
  });
  window.effractorLeftTabs = { show: showTab };

  function openTab() {
    window.effractorWorkspace.open("left");
    showTab("documents");
  }

  // ---- loading ----
  var searchTimer = null;
  $("documents-search").addEventListener("input", function () {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () { query = $("documents-search").value.trim(); refresh(); }, 200);
  });

  function refresh() {
    var user = A.session.user;
    $("documents-logged-out").hidden = !!user;
    ["documents-search", "documents-recent-section", "documents-mine-section", "documents-shared-section"].forEach(function (id) {
      $(id).hidden = !user;
    });
    if (!user) return Promise.resolve(null);
    var path = "/api/documents" + (query ? "?q=" + encodeURIComponent(query) : "");
    return client.request("GET", path).then(function (res) {
      if (!res.ok) {
        $("documents-mine").innerHTML = "";
        $("documents-mine").appendChild(empty(res.status === 0 ? "Server unreachable" : "Could not load"));
        return null;
      }
      listing = res.data;
      render();
      if (A.sync && A.sync.showPath) A.sync.showPath();
      return listing;
    });
  }

  // ---- drawing ----
  function empty(text, action) {
    var li = document.createElement("li");
    li.className = "empty";
    li.textContent = text;
    if (action) {
      li.appendChild(document.createTextNode(" · "));
      var b = document.createElement("button");
      b.type = "button"; b.className = "link-button"; b.textContent = action[0];
      b.addEventListener("click", action[1]);
      li.appendChild(b);
    }
    return li;
  }

  function icon(profile) {
    var svg = document.querySelector("#" + ICONS[profile] + " svg");
    return svg ? svg.cloneNode(true) : document.createElement("span");
  }

  // A key on a row is the tree's: the canvas must not also act on it
  // (Enter adds a node, Del deletes one, a letter renames). Esc and Tab
  // keep their page-wide meaning.
  function ownKey(e) {
    if (e.key === "Escape" || e.key === "Tab" || e.ctrlKey || e.metaKey || e.altKey) return false;
    e.stopPropagation();
    e.preventDefault();
    return true;
  }

  function docRow(d, depth) {
    var li = document.createElement("li");
    li.className = "doc-row doc-document";
    li.setAttribute("role", "treeitem");
    li.style.setProperty("--depth", depth);
    li.tabIndex = 0;
    li.dataset.kind = "document";
    li.dataset.id = d.id;
    li.draggable = d.role === "owner";
    li.appendChild(icon(d.profile));
    var name = document.createElement("span");
    name.className = "doc-name-text";
    name.textContent = d.name;
    li.appendChild(name);
    if (A.sync && A.sync.isOpen(d.id)) li.classList.add("is-open");
    li.addEventListener("click", function () { A.sync.open(d.id); });
    li.addEventListener("keydown", function (e) {
      if (!ownKey(e)) return;
      if (e.key === "Enter") A.sync.open(d.id);
      if ((e.key === "Delete" || e.key === "Backspace") && d.role === "owner") remove("document", d.id, d.name);
    });
    // Dropped on a document: into the folder it is in.
    if (d.owner === (listing && listing.me)) dropTarget(li, d.folder == null ? null : d.folder);
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); docMenu(d, e); });
    li.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/x-effractor", "document:" + d.id); });
    return li;
  }

  function folderRows(node, depth, out) {
    var f = node.folder, open = query || expanded[f.id];
    var li = document.createElement("li");
    li.className = "doc-row doc-folder" + (selectedFolder === f.id ? " is-selected" : "");
    li.setAttribute("role", "treeitem");
    li.setAttribute("aria-expanded", String(!!open));
    li.style.setProperty("--depth", depth);
    li.tabIndex = 0;
    li.dataset.kind = "folder";
    li.dataset.id = f.id;
    li.draggable = f.role === "owner";
    li.textContent = (open ? "▾ " : "▸ ") + f.name;
    li.addEventListener("click", function () {
      // Closing the chosen folder lets go of it: New then goes to the top.
      if (expanded[f.id] && selectedFolder === f.id) {
        expanded[f.id] = false;
        selectedFolder = null;
      } else {
        expanded[f.id] = true;
        if (f.role === "owner") selectedFolder = f.id;
      }
      render();
    });
    li.addEventListener("keydown", function (e) {
      if (!ownKey(e)) return;
      if (e.key === "Enter") li.click();
      if ((e.key === "Delete" || e.key === "Backspace") && f.role === "owner") remove("folder", f.id, f.name);
    });
    li.addEventListener("contextmenu", function (e) { e.preventDefault(); folderMenu(f, e); });
    li.addEventListener("dragstart", function (e) { e.dataTransfer.setData("text/x-effractor", "folder:" + f.id); });
    if (f.role === "owner") dropTarget(li, f.id);
    out.push(li);
    if (open) {
      node.folders.forEach(function (n) { folderRows(n, depth + 1, out); });
      node.documents.forEach(function (d) { out.push(docRow(d, depth + 1)); });
    }
    return out;
  }

  function fill(list, node, depth, emptyItem) {
    list.innerHTML = "";
    var rows = [];
    node.folders.forEach(function (n) { folderRows(n, depth, rows); });
    node.documents.forEach(function (d) { rows.push(docRow(d, depth)); });
    rows.forEach(function (r) { list.appendChild(r); });
    if (!rows.length && emptyItem) list.appendChild(emptyItem);
  }

  function render() {
    if (!listing) return;
    // Not under an open name field: drawing would take it away mid-word.
    if (document.querySelector(".doc-rename")) { renderLater = true; return; }
    renderLater = false;
    var t = D.build(listing);
    var mine = query ? D.prune(t.mine) : t.mine;
    $("documents-recent-section").hidden = !!query || !t.recent.length;
    fill($("documents-recent"), { folders: [], documents: t.recent }, 0);
    fill($("documents-mine"), mine, 0, query
      ? empty("Nothing matches")
      : empty("No documents yet", ["New document", function () { A.sync.createNew(null); }]));
    var shared = $("documents-shared");
    shared.innerHTML = "";
    t.shared.forEach(function (group) {
      var head = document.createElement("li");
      head.className = "doc-owner label";
      head.textContent = group.owner;
      shared.appendChild(head);
      var rows = [];
      group.nodes.forEach(function (n) {
        var shown = query && n.folder ? D.prune(n) : n;
        if (n.folder && query && !shown.folders.length && !shown.documents.length) return;
        if (n.folder) folderRows(shown, 1, rows);
        else n.documents.forEach(function (d) { rows.push(docRow(d, 1)); });
      });
      rows.forEach(function (r) { shared.appendChild(r); });
    });
    if (!t.shared.length) shared.appendChild(empty(query ? "Nothing matches" : "Nothing shared with you"));
  }

  // ---- dragging onto folders ----
  function dropTarget(el, folderId) {
    el.addEventListener("dragover", function (e) {
      if (e.dataTransfer.types.indexOf("text/x-effractor") >= 0) { e.preventDefault(); e.stopPropagation(); el.classList.add("is-drop"); }
    });
    el.addEventListener("dragleave", function () { el.classList.remove("is-drop"); });
    el.addEventListener("drop", function (e) {
      e.preventDefault(); e.stopPropagation();
      el.classList.remove("is-drop");
      var what = e.dataTransfer.getData("text/x-effractor").split(":");
      moveTo(what[0], Number(what[1]), folderId);
    });
  }

  function moveTo(kind, id, folderId) {
    var path = kind === "document" ? "/api/documents/" + id : "/api/folders/" + id;
    var body = kind === "document" ? { folder: folderId } : { parent: folderId };
    client.request("PATCH", path, body).then(function (res) {
      if (!res.ok) app.say(res.status === 409 ? String(res.data) : "not moved");
      refresh();
    });
  }

  // ---- menus ----
  function moveMenu(kind, id) {
    function items(targets) {
      return targets.map(function (t) {
        var here = [t.name, "", function () { moveTo(kind, id, t.id); }];
        if (!t.children) return here;
        return [t.name, "", [["Here", "", function () { moveTo(kind, id, t.id); }]].concat(items(t.children))];
      });
    }
    return items(D.moveTargets(listing, kind, id));
  }

  // A greyed item says why it is not offered (the app's menu: {hint}).
  function why(role) { return role === "owner" ? undefined : { hint: "only its owner" }; }

  function docMenu(d, e) {
    var o = D.offers(d.role);
    app.showMenu([
      ["Open", "", function () { A.sync.open(d.id); }],
      ["Rename", "", o.rename ? function () { renameDocument(d); } : null, d.role === "viewer" ? { hint: "view only" } : undefined],
      ["Move to", "", o.move ? moveMenu("document", d.id) : null, why(d.role)],
      ["Share…", "", o.share ? function () { A.openPeople && A.openPeople("document", d.id, d.name); } : null, why(d.role)],
      ["Download YAML", "", function () { A.sync.download(d.id); }],
      ["Delete", "Del", o.remove ? function () { remove("document", d.id, d.name); } : null, why(d.role)],
    ], e.clientX, e.clientY);
  }

  function folderMenu(f, e) {
    var o = D.offers(f.role);
    app.showMenu([
      ["New document here", "", o.rename ? function () { A.sync.createNew(f.id); } : null, why(f.role)],
      ["New folder here", "", o.rename ? function () { newFolder(f.id); } : null, why(f.role)],
      ["Rename", "", o.rename ? function () { renameFolder(f); } : null, why(f.role)],
      ["Move to", "", o.move ? moveMenu("folder", f.id) : null, why(f.role)],
      ["Share…", "", o.share ? function () { A.openPeople && A.openPeople("folder", f.id, f.name); } : null, why(f.role)],
      ["Delete", "Del", o.remove ? function () { remove("folder", f.id, f.name); } : null, why(f.role)],
    ], e.clientX, e.clientY);
  }

  $("documents-new").addEventListener("click", function (e) {
    app.showMenu([
      ["New document", "", function () { A.sync.createNew(selectedFolder); }],
      ["New folder", "", function () { newFolder(selectedFolder); }],
    ], e.clientX, e.clientY);
  });
  $("documents-mine-section").addEventListener("contextmenu", function (e) {
    if (e.target.closest(".doc-row, input, button")) return;
    e.preventDefault();
    app.showMenu([
      ["New document", "", function () { A.sync.createNew(null); }],
      ["New folder", "", function () { newFolder(null); }],
    ], e.clientX, e.clientY);
  });

  // ---- inline naming: an input row in the tree, Enter keeps, Esc drops ----
  function ask(initial, done) {
    var input = document.createElement("input");
    input.className = "doc-rename";
    input.value = initial;
    var li = document.createElement("li");
    li.appendChild(input);
    $("documents-mine").insertBefore(li, $("documents-mine").firstChild);
    input.focus();
    input.select();
    var finished = false;
    function finish(keep) {
      if (finished) return;
      finished = true;
      li.remove();
      if (renderLater) render();
      if (keep && input.value.trim()) done(input.value.trim());
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") finish(true);
      if (e.key === "Escape") { e.stopPropagation(); finish(false); }
    });
    input.addEventListener("blur", function () { finish(true); });
  }

  function newFolder(parent) {
    ask("New folder", function (name) {
      client.request("POST", "/api/folders", { name: name, parent: parent }).then(function (res) {
        if (!res.ok) app.say(res.status === 409 ? "a folder of that name is there" : String(res.data || "not made"));
        if (parent != null) expanded[parent] = true;
        refresh();
      });
    });
  }

  function renameFolder(f) {
    ask(f.name, function (name) {
      client.request("PATCH", "/api/folders/" + f.id, { name: name }).then(function (res) {
        if (!res.ok) app.say(res.status === 409 ? "a folder of that name is there" : "not renamed");
        refresh();
      });
    });
  }

  function renameDocument(d) {
    ask(d.name, function (name) { A.sync.rename(d.id, name).then(refresh); });
  }

  function remove(kind, id, name) {
    var path = (kind === "document" ? "/api/documents/" : "/api/folders/") + id;
    var wasOpen = kind === "document" && A.sync.isOpen(id);
    client.request("DELETE", path).then(function (res) {
      if (!res.ok) return app.say("not deleted");
      if (kind === "document") A.sync.forget(id);
      if (kind === "folder" && selectedFolder === id) selectedFolder = null;
      refresh();
      app.say('Deleted "' + name + '"', [["Undo", function () {
        client.request("POST", path + "/restore").then(function (r) {
          if (!r.ok) app.say(r.status === 409 ? "not restored · the name is taken" : "not restored");
          // It was on the page: bound again, so it saves again.
          if (r.ok && wasOpen) A.sync.open(id);
          refresh();
        });
      }]]);
    });
  }

  // ---- ways in: the crumb's path, the file menu item, O ----
  function reveal(docId) {
    openTab();
    return refresh().then(function (l) {
      if (!l) return;
      D.ancestors(l, docId).forEach(function (id) { expanded[id] = true; });
      render();
      var sel = '.doc-row[data-kind="document"][data-id="' + docId + '"]';
      var row = document.querySelector("#documents-mine " + sel) || document.querySelector("#documents-shared " + sel) || document.querySelector(sel);
      if (row) { row.scrollIntoView({ block: "nearest" }); row.focus(); }
    });
  }
  $("model-path").addEventListener("click", function (e) {
    e.stopPropagation();
    if (A.sync && A.sync.openId()) reveal(A.sync.openId());
  });
  document.querySelector("[data-documents]").addEventListener("click", function () {
    $("file-menu").hidden = true;
    $("file").setAttribute("aria-expanded", "false");
    if (A.sync && A.sync.openId()) reveal(A.sync.openId()); else openTab();
  });
  // The top of My documents takes drops once, not once per drawing.
  dropTarget($("documents-mine-section"), null);
  $("documents-login").addEventListener("click", function () { $("login-open").click(); });
  A.session.onChange(function () { listing = null; refresh(); });

  A.documentsUi = { show: openTab, reveal: reveal, refresh: refresh, selectedFolder: function () { return selectedFolder; },
    selectFolder: function (id) { selectedFolder = id; }, listing: function () { return listing; },
    redraw: function () { render(); },
    // A save changed this document: its row shows it at once.
    saved: function (id, fields) {
      var next = D.patch(listing, id, fields);
      if (next === listing) return;
      listing = next;
      render();
    } };
})();
