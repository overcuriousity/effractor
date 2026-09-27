const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../assets/js/problems.js');
const LECTURE = require('./fixtures/architecture.doc.json');

const lecture = () => JSON.parse(JSON.stringify(LECTURE));
const warning = (code, path, message) => ({ severity: 'warning', code, path, message });

test('errors and incomplete parts block the graph; an unfinished flow does not', () => {
  assert.equal(P.blocks({ severity: 'error', code: 'expression', path: 'x', message: '' }), true);
  assert.equal(P.blocks(warning('incomplete', 'attacker.target', '')), true);
  assert.equal(P.blocks(warning('unfinished', 'flows.ssh.route', '')), false);
});

test('quoted ids read as the labels the canvas shows', () => {
  const doc = lecture();
  assert.equal(
    P.named(doc, '"bridge" is not attached to "server-net"'),
    '“' + doc.entities.bridge.label + '” is not attached to “' + doc.entities['server-net'].label + '”'
  );
  assert.equal(P.named(doc, '"ssh" is a flow'), '“' + doc.flows.ssh.label + '” is a flow');
  // Whatever is not a component or a flow keeps its quotes.
  assert.equal(P.named(doc, 'write "Never" here'), 'write "Never" here');
});

test('an unfinished route names the hops that fit next', () => {
  const doc = lecture();
  const label = (id) => doc.entities[id].label;
  doc.flows.ssh.route = [];
  assert.equal(P.hint(doc, warning('unfinished', 'flows.ssh.route', '')), 'next: ' + label('client-net'));
  doc.flows.ssh.route = ['client-net'];
  assert.equal(P.hint(doc, warning('unfinished', 'flows.ssh.route[0]', '')), 'next: ' + label('bridge'));
  doc.flows.ssh.route = ['client-net', 'bridge'];
  assert.match(P.hint(doc, warning('unfinished', 'flows.ssh.route', '')), new RegExp('^next: .*' + label('server-net')));
});

test('a router on the route without a permission says where to set it', () => {
  const doc = lecture();
  delete doc.associations['allow-ssh'];
  assert.equal(P.hint(doc, warning('unfinished', 'flows.ssh.route[1]', '')), 'allow or block it in this flow');
});

test('what stops the graph says where to put it right', () => {
  const doc = lecture();
  const hint = (path) => P.hint(doc, warning('incomplete', path, ''));
  assert.equal(hint('attacker.target'), 'choose a component');
  assert.equal(hint('attacker.footholds'), 'choose a component');
  assert.equal(hint('entities.sshd'), 'Tab adds its host · L links one');
  assert.equal(hint('entities.bridge'), null);
  assert.equal(hint('entities.filter'), 'Tab on a router adds one · L links a router');
  assert.equal(hint('entities.server'), null);
  // A service owes two things; the hint follows what the message says is missing.
  const product = '"sshd" is an instance of no product yet: no `instance-of` association names the software it runs';
  assert.equal(P.hint(doc, warning('incomplete', 'entities.sshd', product)), 'Tab adds its product · L links one');
  const host = '"sshd" runs nowhere yet: no `hosts` association names it';
  assert.equal(P.hint(doc, warning('incomplete', 'entities.sshd', host)), 'Tab adds its host · L links one');
});

test('items are what to finish first, in plain words', () => {
  const doc = lecture();
  doc.flows.ssh.route = ['client-net', 'bridge'];
  const list = P.items(doc, [
    warning('unfinished', 'flows.ssh.route', 'the route ends at a router: the network after it is still to come'),
    warning('incomplete', 'entities.sshd', '"sshd" runs nowhere yet: no `hosts` association names it'),
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[0].blocks, true);
  assert.equal(list[0].text, '“' + doc.entities.sshd.label + '” runs nowhere yet');
  assert.equal(list[0].path, 'entities.sshd');
  assert.equal(list[1].blocks, false);
  assert.match(list[1].hint, /^next: /);
});

test('the headline counts what stops the graph', () => {
  assert.equal(P.headline([]), null);
  assert.equal(P.headline([warning('unfinished', 'flows.a.route', '')]), null);
  assert.equal(P.headline([warning('incomplete', 'attacker.target', '')]), 'no attack graph · 1 thing to finish');
  assert.equal(
    P.headline([warning('incomplete', 'attacker.target', ''), { severity: 'error', code: 'x', path: '', message: '' }]),
    'no attack graph · 2 things to finish'
  );
});

test('what blocks, by the component it is set on', () => {
  const at = P.perComponent([
    warning('incomplete', 'entities.sshd', 'runs nowhere yet'),
    warning('incomplete', 'entities.sshd', 'is an instance of no product yet'),
    { severity: 'error', code: 'bad', path: 'entities.web.parameters.login', message: 'no time' },
    warning('unfinished', 'flows.ssh.route', 'not yet at the target'),
    warning('incomplete', 'attacker.target', 'no target yet'),
    warning('assumed', 'entities.db', 'not blocking'),
  ]);
  assert.deepEqual(Object.keys(at).sort(), ['sshd', 'web']);
  assert.deepEqual(at.sshd, ['runs nowhere yet', 'is an instance of no product yet']);
});

test('the validator is said in the form\'s words, the file\'s in the tooltip', () => {
  const plain = P.plain;
  assert.equal(plain('`assumed` needs a `ttc`'), 'assumed needs a time');
  assert.equal(plain('`calibrated` needs a nonempty `note` naming its source'), 'calibrated needs a reason');
  assert.equal(plain('an unknown parameter has no `ttc`; give it a status that says where the value comes from'), 'Unknown keeps no time');
  assert.equal(plain('"sshd" runs nowhere yet: no `hosts` association names it'), '"sshd" runs nowhere yet');
  assert.equal(plain('"sshd" is an instance of no product yet: no `instance-of` association names the software it runs'), '"sshd" has no product yet');
  assert.equal(plain('"filter" belongs to no router yet: no `filters` association names it'), '"filter" belongs to no router yet');
  assert.equal(plain('say whether "app" sees "db" in plaintext: `decrypts: true | false`'), 'say whether "app" sees "db" in plaintext');
  assert.equal(plain('"fw" has no `permits` association for this flow; it is neither allowed nor denied'), '"fw" neither allows nor blocks this flow');
  // Anything else keeps its words, without the file's quoting marks.
  assert.equal(plain('only a host\'s software may run at an unknown privilege; say `user` or `admin`'), 'only a host\'s software may run at an unknown privilege; say user or admin');
  const doc = lecture();
  const item = P.items(doc, [warning('incomplete', 'entities.sshd', '"sshd" runs nowhere yet: no `hosts` association names it')])[0];
  assert.equal(item.text, '“' + doc.entities.sshd.label + '” runs nowhere yet');
  assert.equal(item.raw, '"sshd" runs nowhere yet: no `hosts` association names it');
});

test('a refusal is told by its first error, not by a note that came first', () => {
  const error = { severity: 'error', code: 'invalid-reference', path: 'flows.web.source', message: '"internet" is a network; expected application or service' };
  const note = warning('incomplete', 'entities.web', '"web" is an instance of no product yet');
  assert.equal(P.refusal([note, error]), error);
  assert.equal(P.refusal([note]), note, 'without an error, what there is');
  assert.equal(P.refusal([]), null);
  assert.equal(P.refusal(undefined), null);
});
