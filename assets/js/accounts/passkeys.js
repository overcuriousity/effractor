// WebAuthn's options and answers travel as JSON with base64url strings
// (webauthn-rs); the browser wants ArrayBuffers. Pure, so testable in Node.
(function () {
  var ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  var INDEX = {};
  for (var i = 0; i < ALPHABET.length; i++) INDEX[ALPHABET[i]] = i;

  function bytesToB64url(bytes) {
    bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    var out = "";
    for (var i = 0; i < bytes.length; i += 3) {
      var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      var chars = Math.min(4, Math.ceil(((bytes.length - i) * 8) / 6));
      for (var j = 0; j < chars; j++) out += ALPHABET[(n >> (18 - 6 * j)) & 63];
    }
    return out;
  }

  function b64urlToBytes(s) {
    s = String(s).replace(/=+$/, "");
    var out = new Uint8Array(Math.floor((s.length * 6) / 8));
    var bits = 0, value = 0, at = 0;
    for (var i = 0; i < s.length; i++) {
      value = (value << 6) | INDEX[s[i]];
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[at++] = (value >> bits) & 255;
      }
    }
    return out.buffer;
  }

  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function ids(list) {
    return list && list.map(function (c) { var d = copy(c); d.id = b64urlToBytes(c.id); return d; });
  }

  function creationOptions(json) {
    var pk = copy(json.publicKey);
    pk.challenge = b64urlToBytes(json.publicKey.challenge);
    pk.user.id = b64urlToBytes(json.publicKey.user.id);
    if (pk.excludeCredentials) pk.excludeCredentials = ids(json.publicKey.excludeCredentials);
    return { publicKey: pk };
  }

  function requestOptions(json) {
    var pk = copy(json.publicKey);
    pk.challenge = b64urlToBytes(json.publicKey.challenge);
    if (pk.allowCredentials) pk.allowCredentials = ids(json.publicKey.allowCredentials);
    return { publicKey: pk, mediation: json.mediation };
  }

  function credentialJSON(cred) {
    var r = cred.response, response = { clientDataJSON: bytesToB64url(r.clientDataJSON) };
    ["attestationObject", "authenticatorData", "signature", "userHandle"].forEach(function (k) {
      if (r[k]) response[k] = bytesToB64url(r[k]);
    });
    return {
      id: cred.id,
      rawId: bytesToB64url(cred.rawId),
      type: cred.type,
      response: response,
      extensions: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    };
  }

  var api = { b64urlToBytes: b64urlToBytes, bytesToB64url: bytesToB64url,
    creationOptions: creationOptions, requestOptions: requestOptions, credentialJSON: credentialJSON };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") {
    window.effractorAccounts = window.effractorAccounts || {};
    window.effractorAccounts.webauthn = api;
  }
})();
