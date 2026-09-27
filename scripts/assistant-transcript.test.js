const { test } = require('node:test');
const assert = require('node:assert/strict');
const T = require('../assets/js/assistant/transcript.js');

const msgs = [
  { role: 'user', turn: 1, author: 'ann', content: [{ type: 'text', text: 'add a host' }] },
  { role: 'assistant', turn: 1, content: [{ type: 'text', text: 'Adding.' }, { type: 'tool_call', id: 'c1', name: 'add_entity', input: { kind: 'host', label: 'Web' } }], input_tokens: 50, output_tokens: 7 },
  { role: 'tool', turn: 1, content: [{ type: 'tool_result', id: 'c1', ok: true, output: 'Added host “Web” → entity/web' }] },
  { role: 'marker', turn: 2, content: [{ type: 'marker', left_out_turns: 3 }] },
];

test('calls pair with their results and read in plain words', () => {
  const rows = T.rows(msgs, []);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'said', 'call', 'tokens', 'marker']);
  const call = rows[2];
  assert.deepEqual([call.words, call.result.ok], ['Added host “Web”', true]);
});

test('a call without a result yet is running, and a refused one says why', () => {
  const rows = T.rows(msgs.slice(0, 2), []);
  assert.equal(rows.find((r) => r.kind === 'call').words, '…');
  assert.equal(T.words('remove', {}, { ok: false, output: 'no component “x”' }), 'Not done: no component “x”');
});

test('live events of the running step follow the stored rows', () => {
  const rows = T.rows(msgs.slice(0, 1), [{ event: 'text', data: { text: 'Hel' } }, { event: 'text', data: { text: 'lo' } }]);
  assert.deepEqual(rows[1], { kind: 'said', text: 'Hello', turn: 1, interrupted: false });
});

test('Undo turn is offered only while nothing changed since', () => {
  assert.deepEqual(T.undoTurn({ before: 'a', after: 'b' }, 'b'), { offer: true });
  assert.deepEqual(T.undoTurn({ before: 'a', after: 'b' }, 'c'), { offer: false, why: 'changed since' });
  assert.deepEqual(T.undoTurn(null, 'c'), { offer: false, why: 'only where it ran' });
  assert.deepEqual(T.undoTurn({ before: 'a', after: 'a' }, 'a'), { offer: false, why: 'nothing edited' });
});
