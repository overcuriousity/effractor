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
      client.logout().then(refresh);
    }]);
    var box = $("account").getBoundingClientRect();
    app.showMenu(items, box.left, box.bottom + 4);
  });

  // ---- account dialog ----
  function openAccount() {
    var user = session.user;
    $("account-display-name").value = user.display_name || "";
    $("account-problem").textContent = "";
    $("account-password").value = $("account-password-again").value = "";
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
    client.updateAccount({ password: pw }).then(function (res) {
      $("account-problem").textContent = res.ok ? "password changed · other sessions ended" : String(res.data || "not changed");
      if (res.ok) $("account-password").value = $("account-password-again").value = "";
    });
  });
  $("account-logout-others").addEventListener("click", function () {
    client.logoutOthers().then(function (res) {
      $("account-problem").textContent = res.ok ? "logged out everywhere else" : "not done";
    });
  });

  // An OIDC login that failed comes back as ?login=failed (Task 20).
  if (/[?&]login=failed/.test(location.search)) {
    history.replaceState(null, "", location.pathname + location.hash);
    app.ready.then(function () { app.say("login failed"); });
  }
  refresh();
})();
