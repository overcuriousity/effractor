// Immutable snapshots: inline YAML stays in the fragment; server shares upload
// only authenticated ciphertext. Both open through the app's YAML validator.
(function () {
  var BROKEN = 'link incomplete or corrupted';
  // Transport policy, not a promise about every browser or messaging service.
  var MAX_LINK = 8192, MAX_YAML = 1024 * 1024;
  var TOO_LONG = 'link too long · save YAML or use server sharing';
  var TOO_LARGE = 'snapshot too large · maximum 1 MiB';
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
  // A share link's id, from a path below root, the page's base path.
  function shareId(path, root) {
    var prefix = (root || '/') + 's/';
    if (path.indexOf(prefix) !== 0) return null;
    var match = /^([A-Za-z0-9_-]{22})$/.exec(path.slice(prefix.length));
    if (!match) throw new Error(BROKEN);
    return match[1];
  }
  // base: the page's address, ending in '/'.
  function link(base, id, key) {
    shareId('/s/' + id); decode(key);
    return base + 's/' + id + '#' + key;
  }
  var TTLS = [['1d', '1 day'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['never', 'Never']];
  // The expiries a server with this cap accepts; 90 days first, or the cap.
  function ttlChoices(max) {
    var end = Math.max(TTLS.map(function (t) { return t[0]; }).indexOf(max), 0);
    var options = TTLS.slice(0, end + 1);
    return { options: options, value: options[Math.min(end, 2)][0] };
  }
  // What My shares says about a share's end: none, the date, or that it is past.
  function expiry(expiresAt, now) {
    if (expiresAt === null || expiresAt === undefined) return 'No expiry';
    var date = new Date(expiresAt * 1000).toLocaleDateString();
    return expiresAt * 1000 < now ? 'Expired · ' + date : date;
  }
  // Relative to the page's base.
  function createPath(ttl) { return 'api/share?ttl=' + encodeURIComponent(ttl); }
  async function boundedBytes(stream, limit, message) {
    var reader = stream.getReader(), chunks = [], size = 0;
    try {
      while (true) {
        var part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > limit) throw new Error(message);
        chunks.push(part.value);
      }
    } catch (e) {
      await reader.cancel().catch(function () {});
      throw e;
    } finally { reader.releaseLock(); }
    var bytes = new Uint8Array(size), offset = 0;
    chunks.forEach(function (chunk) { bytes.set(chunk, offset); offset += chunk.length; });
    return bytes;
  }
  async function inlineLink(text, base) {
    if (text.length > MAX_YAML) throw new Error(TOO_LARGE);
    var bytes = new TextEncoder().encode(text);
    if (bytes.length > MAX_YAML) throw new Error(TOO_LARGE);
    if (typeof CompressionStream === 'undefined') throw new Error('self-contained links need a newer browser');
    var compressed = await boundedBytes(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), MAX_LINK, TOO_LONG);
    var url = new URL(base); url.search = ''; url.hash = 'tree=v1.' + encode(compressed);
    if (url.href.length > MAX_LINK) throw new Error(TOO_LONG);
    return url.href;
  }
  async function inlineText(hash) {
    if (hash.indexOf('#tree=') !== 0) return null;
    if (hash.length > MAX_LINK) throw new Error(TOO_LONG);
    if (/^#tree=v(?!1\.)[^.]+\./.test(hash)) throw new Error('unsupported share link version');
    var match = /^#tree=v1\.([A-Za-z0-9_-]+)$/.exec(hash);
    if (!match) throw new Error(BROKEN);
    if (typeof DecompressionStream === 'undefined') throw new Error('self-contained links need a newer browser');
    try {
      var bytes = Uint8Array.from(atob(match[1].replace(/-/g, '+').replace(/_/g, '/')), function (c) { return c.charCodeAt(0); });
      if (encode(bytes) !== match[1]) throw new Error(BROKEN);
      var yaml = await boundedBytes(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_YAML, TOO_LARGE);
      return new TextDecoder('utf-8', { fatal: true }).decode(yaml);
    } catch (e) { throw new Error(e.message === TOO_LARGE ? TOO_LARGE : BROKEN); }
  }
  async function adoptLocal(text, adopt, detach, isCurrent) { if (await adopt(text, 'opened local copy', isCurrent)) detach(); }
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
  var api = { inlineLink: inlineLink, inlineText: inlineText, createPath: createPath, expiry: expiry, adoptLocal: adoptLocal, deferredDelete: deferredDelete, encrypt: encrypt, decrypt: decrypt, shareId: shareId, link: link, ttlChoices: ttlChoices };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorShare = api;
})();
