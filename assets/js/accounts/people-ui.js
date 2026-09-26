// Sharing with people and groups (accounts spec §9.3), in the share dialog
// above the public link. Owners only; a folder's grants cover what is inside.
(function () {
  if (typeof document === "undefined") return;
  var A = window.effractorAccounts, client = A.client, M = window.effractorMenu;
  var $ = function (id) { return document.getElementById(id); };
  var target = null; // {kind, id, name}
  var role = M.dropdown([["viewer", "can view"], ["editor", "can edit"]], "viewer");
  role.setAttribute("aria-label", "Role");
  $("share-people-role").appendChild(role);

  function base() { return (target.kind === "document" ? "/api/documents/" : "/api/folders/") + target.id + "/shares"; }

  function load() {
    return client.request("GET", base()).then(function (res) {
      var list = $("share-people-list");
      list.innerHTML = "";
      if (!res.ok) { $("share-people-problem").textContent = "could not load"; return; }
      if (!res.data.length) {
        var li = document.createElement("li");
        li.className = "empty";
        li.textContent = "Only you";
        list.appendChild(li);
      }
      res.data.forEach(function (s) {
        var li = document.createElement("li");
        var who = document.createElement("span");
        who.textContent = s.grantee_name + (s.grantee_kind === "group" ? " · group" : "");
        var r = M.dropdown([["viewer", "can view"], ["editor", "can edit"]], s.role);
        r.setAttribute("aria-label", "Role of " + s.grantee_name);
        r.addEventListener("change", function () {
          client.request("POST", base(), { kind: s.grantee_kind, name: s.grantee_name, role: r.value }).then(load);
        });
        var x = document.createElement("button");
        x.type = "button"; x.className = "icon-button"; x.textContent = "×";
        x.title = "Stop sharing with " + s.grantee_name; x.setAttribute("aria-label", x.title);
        x.addEventListener("click", function () { client.request("DELETE", "/api/shares/" + s.id).then(load); });
        li.appendChild(who); li.appendChild(r); li.appendChild(x);
        list.appendChild(li);
      });
    });
  }

  // Suggestions under the name field: the app's own list, not a datalist.
  var picked = null, suggestTimer = null;
  $("share-people-name").addEventListener("input", function () {
    picked = null;
    clearTimeout(suggestTimer);
    var q = $("share-people-name").value.trim();
    if (!q) { $("share-people-suggest").hidden = true; return; }
    suggestTimer = setTimeout(function () {
      client.request("GET", "/api/directory?q=" + encodeURIComponent(q)).then(function (res) {
        var ul = $("share-people-suggest");
        ul.innerHTML = "";
        (res.ok ? res.data : []).forEach(function (e) {
          var li = document.createElement("li");
          var b = document.createElement("button");
          b.type = "button"; b.setAttribute("role", "option");
          b.textContent = e.name + (e.kind === "group" ? " · group" : e.display_name ? " · " + e.display_name : "");
          b.addEventListener("click", function () {
            picked = e; $("share-people-name").value = e.name; ul.hidden = true;
          });
          li.appendChild(b); ul.appendChild(li);
        });
        if (res.ok && !res.data.length) {
          var none = document.createElement("li");
          none.className = "empty"; none.textContent = "No user or group of that name";
          ul.appendChild(none);
        }
        ul.hidden = false;
      });
    }, 150);
  });

  $("share-people-add").addEventListener("click", function () {
    var name = $("share-people-name").value.trim();
    if (!name) return;
    var kind = picked ? picked.kind : "user";
    client.request("POST", base(), { kind: kind, name: name, role: role.value }).then(function (res) {
      $("share-people-problem").textContent = res.ok ? "" : String(res.data || "not shared");
      if (res.ok) { $("share-people-name").value = ""; picked = null; load(); }
    });
  });

  A.openPeople = function (kind, id, name) {
    target = { kind: kind, id: id, name: name };
    $("share-people").hidden = false;
    $("share-people-scope").hidden = kind !== "folder";
    $("share-public").hidden = kind === "folder";
    $("share-title").textContent = kind === "folder" ? 'Share "' + name + '"' : "Share snapshot";
    $("share-people-problem").textContent = "";
    load();
    if (!$("share-dialog").open) $("share-dialog").showModal();
  };

  // The bar's Share on a document one owns shows the people part too.
  $("share").addEventListener("click", function () {
    var id = A.sync && A.sync.openId();
    var listing = A.documentsUi && A.documentsUi.listing();
    var doc = id && listing && listing.documents.filter(function (d) { return d.id === id; })[0];
    $("share-public").hidden = false;
    $("share-title").textContent = "Share snapshot";
    if (doc && doc.role === "owner") {
      target = { kind: "document", id: id, name: doc.name };
      $("share-people").hidden = false;
      $("share-people-scope").hidden = true;
      load();
    } else {
      $("share-people").hidden = true;
    }
  }, true);
})();
