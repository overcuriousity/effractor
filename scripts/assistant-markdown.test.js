const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../assets/js/assistant/markdown.js');

const FENCE = '`'.repeat(3);

test('paragraphs, lists, code and emphasis', () => {
  assert.deepEqual(M.parse('Hello **you** and `x`.\n\n- a\n- *b*\n\n' + FENCE + '\nlet y\n' + FENCE), [
    { type: 'p', inline: [{ t: 'text', v: 'Hello ' }, { t: 'b', v: 'you' }, { t: 'text', v: ' and ' }, { t: 'code', v: 'x' }, { t: 'text', v: '.' }] },
    { type: 'ul', items: [[{ t: 'text', v: 'a' }], [{ t: 'i', v: 'b' }]] },
    { type: 'code', text: 'let y' },
  ]);
});

test('html, links and images stay literal text', () => {
  const b = M.parse('<script>alert(1)</script> [x](javascript:alert(1)) ![i](http://e/x.png)');
  assert.equal(b.length, 1);
  assert.deepEqual(b[0].inline, [{ t: 'text', v: '<script>alert(1)</script> [x](javascript:alert(1)) ![i](http://e/x.png)' }]);
});

test('numbered lists and headings', () => {
  assert.deepEqual(M.parse('## Routes\n1. one\n2. two').map((b) => b.type), ['h', 'ol']);
});

test('an unclosed fence is code to the end, and unclosed emphasis is text', () => {
  assert.deepEqual(M.parse(FENCE + '\nopen'), [{ type: 'code', text: 'open' }]);
  assert.deepEqual(M.parse('a **b'), [{ type: 'p', inline: [{ t: 'text', v: 'a **b' }] }]);
});

test('drawing uses text only: markup in the text never becomes elements', () => {
  const made = [];
  const el = (tag) => ({ tag, children: [], textContent: '', appendChild(c) { this.children.push(c); } });
  const doc = {
    createDocumentFragment: () => el('#frag'),
    createElement: (tag) => (made.push(tag), el(tag)),
    createTextNode: (t) => ({ tag: '#text', textContent: t }),
  };
  const frag = M.render(M.parse('<img src=x onerror=alert(1)> **b**'), doc);
  assert.deepEqual(made, ['p', 'strong']);
  assert.equal(frag.children[0].children[0].textContent, '<img src=x onerror=alert(1)> ');
});
