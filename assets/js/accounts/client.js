// The routes the page uses (accounts spec §10) over an injected fetch, so the
// logic is testable without a browser. Every answer resolves; a refusal is
// data for the caller to show, and no network is status 0.
(function () {
  // Relative to the script, so a server under a path prefix still works.
  var base = typeof document !== "undefined" && document.currentScript
    ? new URL("../../../", document.currentScript.src).pathname.replace(/\/$/, "")
    : "";

  function createClient(fetchImpl) {
    // opts.keepalive: the request outlives the page (a save as it closes).
    function request(method, path, body, opts) {
      var init = { method: method, credentials: "same-origin", headers: {} };
      if (opts && opts.keepalive) init.keepalive = true;
      if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return Promise.resolve()
        .then(function () { return fetchImpl(base + path, init); })
        .then(function (res) {
          if (res.status === 204) return { ok: res.ok, status: res.status, data: null };
          var type = (res.headers.get("content-type") || "");
          var read = type.indexOf("application/json") === 0 ? res.json() : res.text();
          return read.then(function (data) {
            return { ok: res.ok, status: res.status, data: data === "" ? null : data };
          });
        }, function () {
          return { ok: false, status: 0, data: "offline" };
        });
    }
    return {
      request: request,
      me: function () { return request("GET", "/api/me"); },
      login: function (name, password) {
        return request("POST", "/api/auth/password", { name: name, password: password });
      },
      logout: function () { return request("POST", "/api/auth/logout"); },
      logoutOthers: function () { return request("POST", "/api/auth/logout-others"); },
      updateAccount: function (fields) { return request("PATCH", "/api/account", fields); },
    };
  }

  var api = { createClient: createClient };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") {
    window.effractorAccounts = window.effractorAccounts || {};
    window.effractorAccounts.createClient = createClient;
    window.effractorAccounts.client = createClient(window.fetch.bind(window));
  }
})();
