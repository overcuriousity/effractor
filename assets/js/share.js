// Immutable snapshots: only the authenticated ciphertext goes to the server.
(function () {
  var BROKEN = 'link incomplete or corrupted';
  function encode(bytes) {
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decode(key) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(key)) throw new Error(BROKEN);
    var bytes = Uint8Array.from(atob(key.replace(/-/g, '+').replace(/_/g, '/') + '='), function (c) { return c.charCodeAt(0); });
    if (encode(bytes) !== key) throw new Error(BROKEN);
    return bytes;
  }
  async function encrypt(text, crypto) {
    var key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv }, key, new TextEncoder().encode(text)));
    var blob = new Uint8Array(iv.length + cipher.length);
    blob.set(iv); blob.set(cipher, iv.length);
    return { blob: blob, key: encode(new Uint8Array(await crypto.subtle.exportKey('raw', key))) };
  }
  async function decrypt(blob, fragment, crypto) {
    try {
      var bytes = new Uint8Array(blob);
      if (bytes.length < 28) throw new Error(BROKEN);
      var key = await crypto.subtle.importKey('raw', decode(fragment), 'AES-GCM', false, ['decrypt']);
      return new TextDecoder('utf-8', { fatal: true }).decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12)));
    } catch (e) { throw new Error(BROKEN); }
  }
  function shareId(path) {
    if (path.indexOf('/s/') !== 0) return null;
    var match = /^\/s\/([A-Za-z0-9_-]{22})$/.exec(path);
    if (!match) throw new Error(BROKEN);
    return match[1];
  }
  function link(origin, id, key) {
    shareId('/s/' + id); decode(key);
    return origin + '/s/' + id + '#' + key;
  }
  function createPath(ttl) { return '/api/share' + (ttl === 'default' ? '' : '?ttl=' + encodeURIComponent(ttl)); }
  async function adoptLocal(text, adopt, detach) { if (await adopt(text, 'opened local copy')) detach(); }
  function deferredDelete(remove, schedule, cancel) {
    var state = 'pending';
    var timer = schedule(async function () {
      if (state !== 'pending') return;
      state = 'deleting';
      try { await remove(); } finally { state = 'done'; }
    }, 8000);
    return { undo: function () {
      if (state !== 'pending') return false;
      state = 'cancelled'; cancel(timer); return true;
    }, state: function () { return state; } };
  }
  var api = { createPath: createPath, adoptLocal: adoptLocal, deferredDelete: deferredDelete, encrypt: encrypt, decrypt: decrypt, shareId: shareId, link: link };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorShare = api;
})();
