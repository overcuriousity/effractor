// Administration (accounts spec §8, §9.4): users and groups, as a list and
// the selected row's detail. Admins see everything; a group's admins see
// their groups and members, and New user only where the group allows it.
(function () {
  if (typeof document === "undefined") return;
  var A = window.effractorAccounts, client = A.client, M = window.effractorMenu;
  var $ = function (id) { return document.getElementById(id); };
  var tab = "users", rows = [], groupsCache = [], selected = null, armedDelete = null;

  function say(text) { $("admin-problem").textContent = text || ""; }
  function refused(res) { return res.status === 409 || res.status === 400 ? String(res.data) : res.status === 403 ? "not yours to change" : "not done"; }

  function el(tag, text, cls) {
    var e = document.createElement(tag);
    if (text != null) e.textContent = text;
    if (cls) e.className = cls;
    return e;
  }
  function button(text, fn, cls) {
    var b = el("button", text, cls || "btn btn-ghost");
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }

  function load() {
    say("");
    var path = tab === "users" ? "/api/admin/users" : "/api/admin/groups";
    return Promise.all([client.request("GET", path), client.request("GET", "/api/admin/groups")]).then(function (r) {
      if (!r[0].ok) return say(refused(r[0]));
      rows = r[0].data;
      groupsCache = r[1].ok ? r[1].data : [];
      var user = A.session.user;
      var mayCreate = user.admin || groupsCache.some(function (g) { return g.admins_may_create_users; });
      $("admin-new").hidden = tab === "users" ? !mayCreate : !user.admin;
      $("admin-new").textContent = tab === "users" ? "New user" : "New group";
      draw();
    });
  }

  function draw() {
    var ul = $("admin-rows");
    ul.innerHTML = "";
    rows.forEach(function (row) {
      var li = el("li", null, "admin-row" + (selected === row.id ? " is-selected" : ""));
      li.setAttribute("role", "option");
      li.tabIndex = 0;
      li.appendChild(el("span", row.name, "admin-name"));
      if (tab === "users") {
        var bits = [];
        if (row.admin) bits.push("admin");
        if (row.disabled) bits.push("disabled");
        var m = row.methods, ways = [];
        if (m.password) ways.push("password");
        if (m.passkeys) ways.push(m.passkeys + " passkey" + (m.passkeys > 1 ? "s" : ""));
        if (m.oidc) ways.push("oidc");
        li.appendChild(el("span", bits.concat(ways).join(" · "), "admin-meta"));
      } else {
        li.appendChild(el("span", row.members.length + " members", "admin-meta"));
      }
      li.addEventListener("click", function () { selected = row.id; armedDelete = null; draw(); detail(row); });
      ul.appendChild(li);
    });
    if (!rows.length) ul.appendChild(el("li", tab === "users" ? "No users you manage" : "No groups yet", "empty"));
    var current = rows.filter(function (r) { return r.id === selected; })[0];
    if (!current) $("admin-detail").innerHTML = '<p class="empty">Select a row</p>';
  }

  function patchUser(id, body) {
    return client.request("PATCH", "/api/admin/users/" + id, body).then(function (res) {
      say(res.ok ? "saved" : refused(res));
      return load();
    });
  }

  function detail(row) {
    var d = $("admin-detail"), admin = A.session.user.admin;
    d.innerHTML = "";
    if (tab === "users") {
      d.appendChild(el("h3", row.display_name ? row.name + " · " + row.display_name : row.name, "label"));
      d.appendChild(el("p", row.groups.map(function (g) { return g.name + (g.role === "admin" ? " (admin)" : ""); }).join(", ") || "In no group", "hint"));
      if (!admin) return;
      var pw = el("input");
      pw.type = "password"; pw.placeholder = "new password · 12 or more"; pw.setAttribute("aria-label", "New password");
      d.appendChild(pw);
      d.appendChild(button("Reset password", function () {
        if (pw.value) patchUser(row.id, { password: pw.value });
      }));
      d.appendChild(button(row.admin ? "Remove admin" : "Make admin", function () { patchUser(row.id, { admin: !row.admin }); }));
      d.appendChild(button(row.disabled ? "Enable" : "Disable", function () { patchUser(row.id, { disabled: !row.disabled }); }));
      // Not undoable, so a second click that names what goes (spec §8).
      var del = button(armedDelete === row.id ? "Delete · " + row.documents + " documents" : "Delete", function () {
        if (armedDelete !== row.id) { armedDelete = row.id; return detail(row); }
        client.request("DELETE", "/api/admin/users/" + row.id).then(function (res) {
          say(res.ok ? "deleted " + row.name : refused(res));
          armedDelete = null; selected = null; load();
        });
      }, "btn btn-ghost" + (armedDelete === row.id ? " btn-danger" : ""));
      d.appendChild(del);
      return;
    }
    // a group
    d.appendChild(el("h3", row.name, "label"));
    if (admin) {
      var flag = M.dropdown([["no", "Group admins add members only"], ["yes", "Group admins may create users"]], row.admins_may_create_users ? "yes" : "no");
      flag.addEventListener("change", function () {
        client.request("PATCH", "/api/admin/groups/" + row.id, { admins_may_create_users: flag.value === "yes" }).then(load);
      });
      d.appendChild(flag);
    }
    var list = el("ul", null, "admin-members");
    row.members.forEach(function (m) {
      var li = el("li");
      li.appendChild(el("span", m.name));
      if (admin) {
        var r = M.dropdown([["member", "member"], ["admin", "group admin"]], m.role);
        r.addEventListener("change", function () {
          client.request("PUT", "/api/admin/groups/" + row.id + "/members/" + m.id, { role: r.value }).then(function (res) {
            say(res.ok ? "" : refused(res)); load();
          });
        });
        li.appendChild(r);
      } else {
        li.appendChild(el("span", m.role === "admin" ? "group admin" : "member", "admin-meta"));
      }
      if (admin || m.role !== "admin") {
        li.appendChild(button("×", function () {
          client.request("DELETE", "/api/admin/groups/" + row.id + "/members/" + m.id).then(function (res) {
            say(res.ok ? "" : refused(res)); load();
          });
        }, "icon-button"));
      }
      list.appendChild(li);
    });
    if (!row.members.length) list.appendChild(el("li", "No members", "empty"));
    d.appendChild(list);
    var add = el("input");
    add.placeholder = "Add a user by name"; add.setAttribute("aria-label", "Add a user by name");
    add.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" || !add.value.trim()) return;
      client.request("GET", "/api/directory?q=" + encodeURIComponent(add.value.trim())).then(function (res) {
        var hit = res.ok && res.data.filter(function (x) { return x.kind === "user" && x.name.toLowerCase() === add.value.trim().toLowerCase(); })[0];
        if (!hit) return say("no user of that name");
        client.request("PUT", "/api/admin/groups/" + row.id + "/members/" + hit.id, { role: "member" }).then(function (r) {
          say(r.ok ? "" : refused(r)); load();
        });
      });
    });
    d.appendChild(add);
    if (admin) {
      d.appendChild(button("Delete group", function () {
        client.request("DELETE", "/api/admin/groups/" + row.id).then(function (res) {
          say(res.ok ? "deleted " + row.name : refused(res)); selected = null; load();
        });
      }));
    }
  }

  // New user / New group: a small form in the detail pane.
  $("admin-new").addEventListener("click", function () {
    var d = $("admin-detail");
    d.innerHTML = "";
    selected = null;
    var name = el("input");
    name.placeholder = "Name"; name.setAttribute("aria-label", "Name");
    d.appendChild(name);
    if (tab === "groups") {
      d.appendChild(button("Create", function () {
        client.request("POST", "/api/admin/groups", { name: name.value }).then(function (res) { say(res.ok ? "" : refused(res)); load(); });
      }, "btn"));
      return name.focus();
    }
    var pw = el("input");
    pw.type = "password"; pw.placeholder = "Password · 12 or more"; pw.setAttribute("aria-label", "Password");
    d.appendChild(pw);
    var allowed = A.session.user.admin ? groupsCache : groupsCache.filter(function (g) { return g.admins_may_create_users; });
    var choices = (A.session.user.admin ? [["", "In no group"]] : []).concat(allowed.map(function (g) { return [String(g.id), g.name]; }));
    var group = M.dropdown(choices, choices.length ? choices[0][0] : "");
    group.setAttribute("aria-label", "Group");
    d.appendChild(group);
    d.appendChild(button("Create", function () {
      var body = { name: name.value, password: pw.value };
      if (group.value) body.group = Number(group.value);
      client.request("POST", "/api/admin/users", body).then(function (res) { say(res.ok ? "created " + name.value : refused(res)); load(); });
    }, "btn"));
    name.focus();
  });

  document.querySelectorAll("[data-admin-tab]").forEach(function (t) {
    t.addEventListener("click", function () {
      tab = t.getAttribute("data-admin-tab");
      document.querySelectorAll("[data-admin-tab]").forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); });
      selected = null;
      load();
    });
  });
  $("admin-close").addEventListener("click", function () { $("admin-dialog").close(); });

  A.openAdministration = function () {
    $("admin-dialog").showModal();
    load();
  };
})();
