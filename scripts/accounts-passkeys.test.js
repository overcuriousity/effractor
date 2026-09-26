const { test } = require("node:test");
const assert = require("node:assert/strict");
const W = require("../assets/js/accounts/passkeys.js");

test("base64url round-trips bytes without padding", () => {
  for (const bytes of [[], [0], [251, 255], [1, 2, 3, 4, 5, 6, 7], Array.from({ length: 300 }, (_, i) => i % 256)]) {
    const s = W.bytesToB64url(new Uint8Array(bytes));
    assert.ok(!/[+/=]/.test(s), s);
    assert.deepEqual(Array.from(new Uint8Array(W.b64urlToBytes(s))), bytes);
  }
  assert.equal(W.bytesToB64url(new Uint8Array([251, 255])), "-_8");
});

test("the server's creation options become what the browser takes", () => {
  const opts = W.creationOptions({ publicKey: {
    challenge: "AQID", rp: { name: "effractor", id: "e.x" },
    user: { id: "BAUG", name: "alice", displayName: "Alice" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ type: "public-key", id: "BwgJ" }],
  } });
  assert.deepEqual(Array.from(new Uint8Array(opts.publicKey.challenge)), [1, 2, 3]);
  assert.deepEqual(Array.from(new Uint8Array(opts.publicKey.user.id)), [4, 5, 6]);
  assert.deepEqual(Array.from(new Uint8Array(opts.publicKey.excludeCredentials[0].id)), [7, 8, 9]);
  assert.equal(opts.publicKey.rp.name, "effractor");
});

test("request options without allowCredentials stay without them", () => {
  const opts = W.requestOptions({ publicKey: { challenge: "AQID", rpId: "e.x" } });
  assert.deepEqual(Array.from(new Uint8Array(opts.publicKey.challenge)), [1, 2, 3]);
  assert.equal(opts.publicKey.allowCredentials, undefined);
});

test("a credential becomes JSON the server reads", () => {
  const buf = (a) => new Uint8Array(a).buffer;
  const cred = {
    id: "AQ", rawId: buf([1]), type: "public-key",
    response: { clientDataJSON: buf([2]), authenticatorData: buf([3]), signature: buf([4]), userHandle: buf([5]) },
    getClientExtensionResults: () => ({}),
  };
  assert.deepEqual(W.credentialJSON(cred), {
    id: "AQ", rawId: "AQ", type: "public-key", extensions: {},
    response: { clientDataJSON: "Ag", authenticatorData: "Aw", signature: "BA", userHandle: "BQ" },
  });
  const reg = { id: "AQ", rawId: buf([1]), type: "public-key",
    response: { clientDataJSON: buf([2]), attestationObject: buf([6]) }, getClientExtensionResults: () => ({}) };
  assert.deepEqual(W.credentialJSON(reg).response, { clientDataJSON: "Ag", attestationObject: "Bg" });
});
