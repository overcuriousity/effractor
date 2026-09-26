// Who is logged in, and the ways in and out (accounts spec §7, §9.1): the
// bar's "local only · Log in" or the user's name and menu, the login dialog,
// the account dialog. Everything else asks `session` who is here.
(function () {
  if (typeof document === "undefined") return;
  var A = window.effractorAccounts, client = A.client, app = window.effractor;
  var $ = function (id) { return document.getElementById(id); };
  var listeners = [];
  var session = { user: null, login: { password: true }, onChange: function (f) { listeners.push(f); }, refresh: refresh };
  A.session = session;

  function show() {
    var user = session.user;
    $("local-only").hidden = !!user;
    $("account").hidden = !user;
    if (user) $("account").textContent = user.display_name || user.name;
  }

  function refresh() {
    return client.me().then(function (res) {
      if (!res.ok) return session.user;
      var before = session.user;
      session.user = res.data.user;
      session.login = res.data.login;
      show();
      $("login-passkey").hidden = !session.login.passkey;
      $("login-oidc").hidden = !session.login.oidc;
      if (session.login.oidc) $("login-oidc").textContent = session.login.oidc;
      var changed = (before && before.id) !== (session.user && session.user.id);
      if (changed) listeners.forEach(function (f) { f(session.user, before); });
      return session.user;
    });
  }

  // ---- login dialog ----
  function openLogin() {
    $("login-problem").textContent = "";
    $("login-dialog").showModal();
    $("login-name").focus();
  }
  $("login-open").addEventListener("click", openLogin);
  $("login-close").addEventListener("click", function () { $("login-dialog").close(); });
  $("login-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = $("login-name").value, pw = $("login-password").value;
    client.login(name, pw).then(function (res) {
      if (res.ok) {
        $("login-password").value = "";
        $("login-dialog").close();
        return refresh();
      }
      $("login-problem").textContent = res.status === 429 ? "too many tries · wait a while"
        : res.status === 0 ? "server unreachable" : "wrong name or password";
    });
  });

  // ---- the name's menu ----
  $("account").addEventListener("click", function () {
    var user = session.user;
    if (!user) return;
    var items = [["Account", "", openAccount]];
    if (user.admin || user.group_admin) {
      items.push(["Administration", "", function () {
        if (A.openAdministration) A.openAdministration();
      }]);
    }
    items.push(["Log out", "", function () {
      // What is waiting is saved first, while the session still counts.
      var before = A.beforeLogout ? A.beforeLogout() : Promise.resolve();
      before.then(function () { return client.logout(); }).then(refresh);
    }]);
    var box = $("account").getBoundingClientRect();
    app.showMenu(items, box.left, box.bottom + 4);
  });

  // ---- account dialog ----
  function openAccount() {
    var user = session.user;
    $("account-display-name").value = user.display_name || "";
    $("account-problem").textContent = "";
    $("account-password").value = $("account-password-again").value = $("account-password-current").value = "";
    // Somebody without a password (OIDC, passkeys only) sets one without it.
    $("account-password-current").hidden = !user.methods.password;
    // Passkeys (Task 19) and OIDC (Task 21) add their sections here.
    (A.accountSections || []).forEach(function (fill) { fill(); });
    $("account-dialog").showModal();
  }
  $("account-close").addEventListener("click", function () { $("account-dialog").close(); });
  $("account-display-name").addEventListener("change", function () {
    client.updateAccount({ display_name: $("account-display-name").value }).then(function (res) {
      $("account-problem").textContent = res.ok ? "saved" : String(res.data || "not saved");
      if (res.ok) refresh();
    });
  });
  $("account-password-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var pw = $("account-password").value;
    if (pw !== $("account-password-again").value) {
      $("account-problem").textContent = "the two differ";
      return;
    }
    client.updateAccount({ password: pw, current_password: $("account-password-current").value }).then(function (res) {
      $("account-problem").textContent = res.ok ? "password changed · other sessions ended" : String(res.data || "not changed");
      if (res.ok) $("account-password").value = $("account-password-again").value = $("account-password-current").value = "";
      if (res.ok) refresh();
    });
  });
  $("account-logout-others").addEventListener("click", function () {
    client.logoutOthers().then(function (res) {
      $("account-problem").textContent = res.ok ? "logged out everywhere else" : "not done";
    });
  });

  // ---- passkeys (spec §7.1, §7.4) ----
  $("login-passkey").addEventListener("click", function () {
    var W = A.webauthn;
    client.request("POST", "/api/auth/passkey/start", {}).then(function (start) {
      if (!start.ok) throw new Error("start");
      return navigator.credentials.get(W.requestOptions(start.data.options)).then(function (cred) {
        return client.request("POST", "/api/auth/passkey/finish", { ceremony: start.data.ceremony, credential: W.credentialJSON(cred) });
      });
    }).then(function (res) {
      if (res.ok) { $("login-dialog").close(); return refresh(); }
      $("login-problem").textContent = res.status === 429 ? "too many tries · wait a while" : "passkey not accepted";
    }).catch(function () {
      $("login-problem").textContent = "no passkey used";
    });
  });

  A.accountSections = A.accountSections || [];
  A.accountSections.push(function passkeysSection() {
    var box = $("account-passkeys");
    box.hidden = !session.login.passkey;
    if (box.hidden) return;
    box.innerHTML = '<h3 class="label">Passkeys</h3>';
    var ul = document.createElement("ul");
    ul.className = "account-passkeys";
    box.appendChild(ul);
    client.request("GET", "/api/account/passkeys").then(function (res) {
      (res.ok ? res.data : []).forEach(function (p) {
        var li = document.createElement("li");
        var label = document.createElement("input");
        label.value = p.label;
        label.setAttribute("aria-label", "Passkey name");
        label.addEventListener("change", function () {
          client.request("PATCH", "/api/account/passkeys/" + p.id, { label: label.value });
        });
        var x = document.createElement("button");
        x.type = "button"; x.className = "icon-button"; x.textContent = "×";
        x.title = "Remove this passkey"; x.setAttribute("aria-label", x.title);
        x.addEventListener("click", function () {
          client.request("DELETE", "/api/account/passkeys/" + p.id).then(function (r) {
            $("account-problem").textContent = r.ok ? "" : String(r.data || "not removed");
            passkeysSection();
            refresh();
          });
        });
        li.appendChild(label); li.appendChild(x); ul.appendChild(li);
      });
      if (res.ok && !res.data.length) {
        var none = document.createElement("li");
        none.className = "empty"; none.textContent = "None yet";
        ul.appendChild(none);
      }
    });
    var add = document.createElement("button");
    add.type = "button"; add.className = "btn btn-ghost"; add.textContent = "Add a passkey";
    add.addEventListener("click", function () {
      var W = A.webauthn;
      client.request("POST", "/api/account/passkeys/start", {}).then(function (start) {
        if (!start.ok) throw new Error(start.status === 403 ? String(start.data) : "start");
        return navigator.credentials.create(W.creationOptions(start.data.options)).then(function (cred) {
          return client.request("POST", "/api/account/passkeys/finish",
            { ceremony: start.data.ceremony, credential: W.credentialJSON(cred), label: "Passkey" });
        });
      }).then(function (res) {
        $("account-problem").textContent = res.ok ? "passkey added" : "passkey not added";
        passkeysSection();
        refresh();
      }).catch(function (e) {
        $("account-problem").textContent = /log in again/.test(e.message) ? e.message : "no passkey made";
      });
    });
    box.appendChild(add);
  });

  // ---- OIDC (spec §7.1–7.2) ----
  $("login-oidc").addEventListener("click", function () {
    client.request("POST", "/api/auth/oidc/start", { link: false }).then(function (res) {
      if (res.ok) location.assign(res.data.url);
      else $("login-problem").textContent = res.status === 0 ? "server unreachable" : "not available";
    });
  });

  A.accountSections.push(function oidcSection() {
    var box = $("account-oidc"), label = session.login.oidc, user = session.user;
    box.hidden = !label;
    if (!label) return;
    box.innerHTML = "";
    var h = document.createElement("h3");
    h.className = "label";
    h.textContent = label;
    box.appendChild(h);
    var b = document.createElement("button");
    b.type = "button";
    b.className = "btn btn-ghost";
    if (user.methods.oidc) {
      b.textContent = "Unlink";
      b.addEventListener("click", function () {
        client.request("DELETE", "/api/account/oidc").then(function (res) {
          $("account-problem").textContent = res.ok ? "unlinked" : String(res.data || "not unlinked");
          refresh().then(oidcSection);
        });
      });
    } else {
      b.textContent = "Link";
      b.addEventListener("click", function () {
        client.request("POST", "/api/auth/oidc/start", { link: true }).then(function (res) {
          if (res.ok) location.assign(res.data.url);
          else $("account-problem").textContent = res.status === 403 ? String(res.data) : "not available";
        });
      });
    }
    box.appendChild(b);
  });

  // An OIDC login that failed comes back as ?login=failed.
  if (/[?&]login=failed/.test(location.search)) {
    history.replaceState(null, "", location.pathname + location.hash);
    app.ready.then(function () { app.say("login failed"); });
  }
  refresh();
})();
