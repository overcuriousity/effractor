const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const { element } = require('./fixtures/fake-dom.js');
const share = require('../assets/js/share.js');
const store = require('../assets/js/store.js');

function mount({ server = false, page = 'https://example.test/effractor/', accept = true, fetcher, maxTtl = '1y',
  script = (server ? 'https://example.test/' : 'https://example.test/effractor/') + 'assets/js/share-ui.js' } = {}) {
  const ids = ['share', 'share-dialog', 'share-mode', 'share-hint', 'share-created', 'share-link',
    'share-copy', 'share-create', 'share-close', 'share-status'];
  if (server) ids.push('share-expiry', 'share-server-list', 'shares-empty', 'my-shares');
  const nodes = Object.fromEntries(ids.map(id => [id, element('div')]));
  nodes['share-dialog'].dataset = { serverSharing: String(server), maxTtl };
  nodes['share-dialog'].showModal = () => {};
  nodes['share-dialog'].close = () => {};
  nodes['share-created'].hidden = true;
  const ready = [], changed = [], events = {}, adopted = [], guards = [], detached = [], requests = [], notices = [];
  const location = new URL(page);
  const app = {
    state: { text: 'name: current\n', doc: { name: 'Current' } },
    ready: { then(fn) { const promise = Promise.resolve().then(fn); ready.push(promise); return promise; } },
    onChange: fn => changed.push(fn), say: text => notices.push(text),
    replaceDocument: async (text, said, isCurrent) => { adopted.push({ text, said }); guards.push(isCurrent); return accept; },
  };
  const window = {
    effractor: app, effractorShare: share, effractorStore: store, crypto: webcrypto,
    addEventListener: (type, fn) => { events[type] = fn; },
    effractorMenu: { dropdown(options, value) { const el = element('button'); el.value = value; el.options = options; return el; } },
  };
  vm.runInNewContext(readFileSync('assets/js/share-ui.js', 'utf8'), {
    window, URL, location, setTimeout, clearTimeout,
    document: { getElementById: id => nodes[id] || null, createElement: element,
      currentScript: { src: script } },
    history: { replaceState: (_state, _title, url) => detached.push(url) },
    fetch: async (...args) => { requests.push(args); if (fetcher) return fetcher(...args); throw new Error('unexpected network request'); },
    navigator: { clipboard: { writeText: async () => {} } },
  });
  return { nodes, app, events, adopted, guards, detached, requests, notices, location,
    ready: async () => { await Promise.all(ready); changed.forEach(fn => fn()); },
    fire: async (node, type = 'click') => { await Promise.all((node.listeners[type] || []).map(fn => fn())); },
  };
}

test('static sharing creates a portable link without contacting an API or requiring IndexedDB', async () => {
  const ui = mount(); await ui.ready();
  assert.equal(ui.nodes.share.disabled, false);
  await ui.fire(ui.nodes.share);
  await ui.fire(ui.nodes['share-create']);
  const link = new URL(ui.nodes['share-link'].value);
  assert.equal(link.pathname, '/effractor/');
  assert.equal(await share.inlineText(link.hash), ui.app.state.text);
  assert.equal(ui.nodes['share-created'].hidden, false);
  assert.equal(ui.requests.length, 0);
  assert.match(ui.nodes['share-hint'].textContent, /No expiry or deletion/);
});

test('opening an inline fragment uses document validation and detaches only when accepted', async () => {
  const yaml = 'name: linked\n';
  const hash = '#tree=v1.' + gzipSync(yaml).toString('base64url');
  for (const accept of [true, false]) {
    const ui = mount({ page: 'https://example.test/effractor/' + hash, accept }); await ui.ready();
    assert.deepEqual(ui.adopted, [{ text: yaml, said: 'opened local copy' }]);
    assert.deepEqual(ui.detached, accept ? ['https://example.test/effractor/'] : []);
    assert.equal(ui.requests.length, 0);
    assert.equal(ui.guards[0](), true);
    ui.location.hash = '';
    assert.equal(ui.guards[0](), false);
  }
});

test('corrupt links keep the current document and report the problem', async () => {
  const ui = mount({ page: 'https://example.test/effractor/#tree=v1.broken' }); await ui.ready();
  assert.equal(ui.adopted.length, 0);
  assert.equal(ui.detached.length, 0);
  assert.match(ui.notices.at(-1), /incomplete or corrupted/);
});

test('a new fragment in an already-open page loads a local copy', async () => {
  const ui = mount(); await ui.ready();
  ui.location.hash = new URL(await share.inlineLink('name: next\n', ui.location.href)).hash;
  await ui.events.hashchange();
  assert.equal(ui.adopted.at(-1).text, 'name: next\n');
});

test('server sharing still encrypts uploads, and switching modes clears the old link', async () => {
  const ui = mount({ server: true, page: 'https://example.test/', fetcher: async () => ({
    ok: true, json: async () => ({ id: 'a'.repeat(22), delete_token: 'token', expires_at: null }),
  }) }); await ui.ready();
  await ui.fire(ui.nodes['share-create']);
  const old = new URL(ui.nodes['share-link'].value);
  assert.equal(ui.requests[0][0], 'https://example.test/api/share?ttl=90d');
  assert.equal(await share.decrypt(ui.requests[0][1].body, old.hash.slice(1), webcrypto), ui.app.state.text);
  const mode = ui.nodes['share-mode'].children[0]; mode.value = 'inline';
  await ui.fire(mode, 'change');
  assert.equal(ui.nodes['share-expiry'].hidden, true);
  assert.equal(ui.nodes['share-server-list'].hidden, true);
  assert.equal(ui.nodes['share-created'].hidden, true);
  await ui.fire(ui.nodes['share-create']);
  assert.equal(ui.requests.length, 1);
  assert.equal(await share.inlineText(new URL(ui.nodes['share-link'].value).hash), ui.app.state.text);
});

test('existing encrypted server links still load and detach to the app root', async () => {
  const encrypted = await share.encrypt('name: encrypted\n', webcrypto);
  const ui = mount({ server: true, page: share.link('https://example.test/', 'a'.repeat(22), encrypted.key),
    fetcher: async () => ({ ok: true, arrayBuffer: async () => encrypted.blob }) }); await ui.ready();
  assert.equal(ui.adopted[0].text, 'name: encrypted\n');
  assert.deepEqual(ui.detached, ['https://example.test/']);
  assert.equal(ui.requests[0][0], 'https://example.test/api/share/' + 'a'.repeat(22));
});

test('under a path prefix, sharing uploads, links and opens below it', async () => {
  const encrypted = await share.encrypt('name: prefixed\n', webcrypto);
  const script = 'https://example.org/effractor/assets/js/share-ui.js';
  const created = mount({ server: true, script, page: 'https://example.org/effractor/', fetcher: async () => ({
    ok: true, json: async () => ({ id: 'c'.repeat(22), delete_token: 'token', expires_at: null }),
  }) }); await created.ready();
  await created.fire(created.nodes['share-create']);
  assert.equal(created.requests[0][0], 'https://example.org/effractor/api/share?ttl=90d');
  assert.match(created.nodes['share-link'].value, /^https:\/\/example\.org\/effractor\/s\/c{22}#/);
  const opened = mount({ server: true, script, page: share.link('https://example.org/effractor/', 'a'.repeat(22), encrypted.key),
    fetcher: async () => ({ ok: true, arrayBuffer: async () => encrypted.blob }) }); await opened.ready();
  assert.equal(opened.requests[0][0], 'https://example.org/effractor/api/share/' + 'a'.repeat(22));
  assert.equal(opened.adopted[0].text, 'name: prefixed\n');
  assert.deepEqual(opened.detached, ['https://example.org/effractor/']);
});

test('the expiry offers only what the server keeps', async () => {
  const ui = mount({ server: true, page: 'https://example.test/', maxTtl: '30d' }); await ui.ready();
  const ttl = ui.nodes['share-expiry'].children[0];
  assert.deepEqual(ttl.options.map((o) => o[0]), ['1d', '30d']);
  assert.equal(ttl.value, '30d');
});

test('an expired share is marked in My shares', async () => {
  const ui = mount({ server: true, page: 'https://example.test/', fetcher: async () => ({
    ok: true, json: async () => ({ id: 'b'.repeat(22), delete_token: 'token', expires_at: 1 }),
  }) }); await ui.ready();
  await ui.fire(ui.nodes['share-create']);
  const row = ui.nodes['my-shares'].children[0];
  assert.match(row.children[1].textContent, /^Expired/);
});
