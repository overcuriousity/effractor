const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/assistant/client.js');

test('events split across chunks are read whole', () => {
  const p = C.createParser();
  assert.deepEqual(p.feed('event: text\ndata: {"te'), []);
  assert.deepEqual(p.feed('xt":"hi"}\n\nevent: end\ndata: {"reason":"done"}\n\n'), [
    { event: 'text', data: { text: 'hi' } },
    { event: 'end', data: { reason: 'done' } },
  ]);
});

test('a CRLF stream reads the same', () => {
  const p = C.createParser();
  assert.deepEqual(p.feed('event: end\r\ndata: {"reason":"tools"}\r\n\r\n'), [{ event: 'end', data: { reason: 'tools' } }]);
});

function streamOf(parts) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); } });
}

test('send streams events to the callback and resolves when the body ends', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    assert.equal(url, '/api/assistant/sessions/7/messages');
    assert.deepEqual(JSON.parse(init.body), { text: 'hi', state: '{}' });
    return { ok: true, status: 200, headers: new Map([['content-type', 'text/event-stream']]), body: streamOf(['event: text\ndata: {"text":"a"}\n\n', 'event: end\ndata: {"reason":"done"}\n\n']) };
  };
  const c = C.createAssistantClient(fetchImpl, '');
  const r = await c.send(7, 'hi', '{}', (e) => seen.push(e));
  assert.equal(r.ok, true);
  assert.deepEqual(seen.map((e) => e.event), ['text', 'end']);
});

test('a refusal is data, and no network is status 0', async () => {
  const busy = C.createAssistantClient(async () => ({ ok: false, status: 409, headers: new Map(), text: async () => 'ann is asking' }), '');
  assert.deepEqual(await busy.send(1, 'x', '', () => {}), { ok: false, status: 409, data: 'ann is asking' });
  const off = C.createAssistantClient(async () => { throw new Error('down'); }, '');
  assert.deepEqual(await off.send(1, 'x', '', () => {}), { ok: false, status: 0, data: 'offline' });
});
