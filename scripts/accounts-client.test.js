const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../assets/js/accounts/client.js");

function fakeFetch(answers) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (a === "offline") throw new TypeError("Failed to fetch");
    return {
      ok: a.status >= 200 && a.status < 300,
      status: a.status,
      headers: { get: (h) => (h.toLowerCase() === "content-type" ? a.type || "application/json" : null) },
      json: async () => a.body,
      text: async () => (typeof a.body === "string" ? a.body : JSON.stringify(a.body)),
    };
  };
  f.calls = calls;
  return f;
}

test("a request sends JSON with the cookie and reads JSON back", async () => {
  const f = fakeFetch([{ status: 200, body: { user: null, login: { password: true } } }]);
  const res = await createClient(f).me();
  assert.deepEqual(res, { ok: true, status: 200, data: { user: null, login: { password: true } } });
  assert.equal(f.calls[0].url, "/api/me");
  assert.equal(f.calls[0].init.credentials, "same-origin");
});

test("login posts name and password; a refusal is data, not an exception", async () => {
  const f = fakeFetch([{ status: 401, type: "text/plain", body: "wrong name or password" }]);
  const res = await createClient(f).login("alice", "pw");
  assert.equal(f.calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(f.calls[0].init.body), { name: "alice", password: "pw" });
  assert.equal(f.calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(res, { ok: false, status: 401, data: "wrong name or password" });
});

test("no network is status 0, not a throw", async () => {
  const res = await createClient(fakeFetch(["offline"])).logout();
  assert.deepEqual(res, { ok: false, status: 0, data: "offline" });
});

test("a 204 has no data", async () => {
  const res = await createClient(fakeFetch([{ status: 204, body: "" }])).logoutOthers();
  assert.deepEqual(res, { ok: true, status: 204, data: null });
});
