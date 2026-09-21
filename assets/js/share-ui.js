(function () {
  var app = window.effractor, crypto = window.effractorShare;
  var store = window.effractorStore.createStore(window.indexedDB);
  var $ = function (id) { return document.getElementById(id); };
  var dialog = $('share-dialog'), pending = new Map(), volatile = new Map();
  var ttl = window.effractorMenu.dropdown([['default', '90 days · server cap'], ['1d', '1 day'], ['30d', '30 days'], ['90d', '90 days'], ['1y', '1 year'], ['never', 'Never']], 'default');
  ttl.id = 'share-ttl'; ttl.setAttribute('aria-label', 'Expiry');
  $('share-expiry').appendChild(ttl);
  function say(text) { $('share-status').textContent = text; app.say(text); }
  function failure(res) {
    return new Error(({ 400: 'expiry not allowed by this server', 403: 'deletion refused', 404: 'share expired or deleted', 413: 'snapshot too large', 429: 'too many shares — try later' })[res.status] || 'share request failed (' + res.status + ')');
  }
  function button(label, action) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'btn btn-ghost btn-small';
    b.textContent = label; b.addEventListener('click', action); return b;
  }
  async function list() {
    var records = new Map((await store.shares()).map(function (s) { return [s.id, s]; }));
    volatile.forEach(function (s, id) { records.set(id, s); });
    $('my-shares').replaceChildren();
    records.forEach(function (s) {
      var item = document.createElement('li'), a = document.createElement('a');
      a.href = s.url; a.textContent = s.name || 'Untitled'; item.appendChild(a);
      var expires = document.createElement('span'); expires.className = 'hint';
      expires.textContent = s.expires_at === null ? 'No expiry' : new Date(s.expires_at * 1000).toLocaleDateString();
      item.appendChild(expires);
      if (pending.has(s.id) && pending.get(s.id).state() === 'deleting') {
        var busy = document.createElement('span'); busy.textContent = 'Deleting…'; item.appendChild(busy);
      } else if (pending.has(s.id)) {
        item.appendChild(button('Undo', function () { if (pending.get(s.id).undo()) { pending.delete(s.id); list(); say('deletion cancelled'); } }));
      } else {
        item.appendChild(button('Delete', function () {
          pending.set(s.id, crypto.deferredDelete(async function () {
            list();
            try {
              var res = await fetch('/api/share/' + s.id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + s.delete_token } });
              if (!res.ok && res.status !== 404) throw failure(res);
              volatile.delete(s.id);
              if (!await store.removeShare(s.id)) say('share deleted · local list unavailable');
              else say('share deleted');
            } catch (e) { say(e.message); }
            pending.delete(s.id); list();
          }, setTimeout, clearTimeout));
          say('deleting in 8 seconds · Undo in My shares'); list();
        }));
      }
      $('my-shares').appendChild(item);
    });
    $('shares-empty').hidden = records.size > 0;
  }
  $('share').addEventListener('click', function () { dialog.showModal(); list().catch(function (e) { say(e.message); }); });
  $('share-close').addEventListener('click', function () { dialog.close(); });
  $('share-copy').addEventListener('click', async function () {
    try { await navigator.clipboard.writeText($('share-link').value); say('link copied'); }
    catch (e) { $('share-link').focus(); $('share-link').select(); say('select and copy the link'); }
  });
  $('share-create').addEventListener('click', async function () {
    if (!app.state.text) return say('no document');
    $('share-create').disabled = true;
    var text = app.state.text, name = app.state.doc.name;
    try {
      if (!window.crypto || !window.crypto.subtle) throw new Error('sharing needs HTTPS or localhost');
      var encrypted = await crypto.encrypt(text, window.crypto);
      var res = await fetch(crypto.createPath(ttl.value), { method: 'POST', body: encrypted.blob, headers: { 'Content-Type': 'application/octet-stream' } });
      if (!res.ok) throw failure(res);
      var record = await res.json();
      record.url = crypto.link(location.origin, record.id, encrypted.key); record.name = name;
      volatile.set(record.id, record);
      var kept = await store.saveShare(record);
      $('share-link').value = record.url; $('share-created').hidden = false;
      say(kept ? 'snapshot shared' : 'deletion token kept only in this tab');
      await list();
    } catch (e) { say(e.message); }
    finally { $('share-create').disabled = false; }
  });
  app.onChange(function () { $('share').disabled = !app.state.doc; });
  app.ready.then(async function () {
    try {
      var id = crypto.shareId(location.pathname);
      if (!id) return;
      var res = await fetch('/api/share/' + id, { cache: 'no-store' });
      if (!res.ok) throw failure(res);
      var text = await crypto.decrypt(await res.arrayBuffer(), location.hash.slice(1), window.crypto);
      await crypto.adoptLocal(text, app.replaceDocument, function () { history.replaceState(null, '', '/'); });
    } catch (e) { app.say(e.message); }
  });
})();
