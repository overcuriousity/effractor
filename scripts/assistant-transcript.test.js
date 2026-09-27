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
  assert.deepEqual(rows[1], { kind: 'said', text: 'Hello', turn: 1, interrupted: false, live: true });
});

test('Undo turn is offered only while nothing changed since', () => {
  assert.deepEqual(T.undoTurn({ before: 'a', after: 'b' }, 'b'), { offer: true });
  assert.deepEqual(T.undoTurn({ before: 'a', after: 'b' }, 'c'), { offer: false, why: 'changed since' });
  assert.deepEqual(T.undoTurn(null, 'c'), { offer: false, why: 'only where it ran' });
  assert.deepEqual(T.undoTurn({ before: 'a', after: 'a' }, 'a'), { offer: false, why: 'nothing edited' });
});

test('a result names the plain id; the line reads without it', () => {
  assert.equal(T.words('add_entity', {}, { ok: true, output: 'Added network “Internet”, id internet' }), 'Added network “Internet”');
  assert.equal(T.words('add_entity', {}, { ok: true, output: 'Added host “Web” → entity/web' }), 'Added host “Web”', 'sessions from before');
});

test('a call selects what it made: the plain id qualified from the document, or the old form', () => {
  const doc = { entities: { internet: {} }, associations: { 'a-b': {} }, flows: { https: {} } };
  const row = (output, name, input) => ({ name: name || 'add_entity', input: input || {}, result: { ok: true, output } });
  assert.equal(T.target(row('Added network “Internet”, id internet'), doc), 'entity/internet');
  assert.equal(T.target(row('Linked “a” attached “b”, id a-b'), doc), 'association/a-b');
  assert.equal(T.target(row('Flow “HTTPS”, id https'), doc), 'flow/https');
  assert.equal(T.target(row('Added “Pump”, id pump'), { nodes: { pump: {} } }), 'pump');
  assert.equal(T.target(row('Added host “Web” → entity/web'), doc), 'entity/web');
  assert.equal(T.target(row('shown', 'show', { id: 'flow/https' }), doc), 'flow/https');
  assert.equal(T.target({ name: 'remove', input: {}, result: { ok: false, output: 'no' } }, doc), null);
  assert.equal(T.target({ name: 'add_entity', input: {}, result: null }, doc), null);
});

test('tokens: one line per turn, what the steps reported summed; none for the turn still running', () => {
  const turn = [
    { role: 'user', turn: 1, author: 'ann', content: [{ type: 'text', text: 'go' }] },
    { role: 'assistant', turn: 1, content: [{ type: 'tool_call', id: 'c1', name: 'problems', input: {} }], input_tokens: 50, output_tokens: 7 },
    { role: 'tool', turn: 1, content: [{ type: 'tool_result', id: 'c1', ok: true, output: '{}' }] },
    { role: 'assistant', turn: 1, content: [{ type: 'text', text: 'Done.' }], input_tokens: 60, output_tokens: null },
  ];
  const rows = T.rows(turn, []);
  assert.deepEqual(rows.map((r) => r.kind), ['user', 'call', 'said', 'tokens']);
  assert.deepEqual([rows[3].input, rows[3].output], [110, 7]);
  assert.deepEqual(T.rows(turn, [], true).map((r) => r.kind), ['user', 'call', 'said']);
  const unreported = turn.map((m) => Object.assign({}, m, { input_tokens: null, output_tokens: null }));
  assert.ok(!T.rows(unreported, []).some((r) => r.kind === 'tokens'), 'nothing reported, nothing shown');
  const inOnly = turn.map((m) => Object.assign({}, m, { output_tokens: null }));
  assert.equal(T.rows(inOnly, []).find((r) => r.kind === 'tokens').output, null, 'unreported stays unknown');
});

test('token counts read short', () => {
  assert.deepEqual([T.count(890), T.count(12400), T.count(1234567), T.count(null)], ['890', '12.4k', '1.2M', '—']);
});
