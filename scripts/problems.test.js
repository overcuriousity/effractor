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
  const filters = Object.keys(doc.associations).find((k) => doc.associations[k].kind === 'filters');
  delete doc.associations[filters];
  assert.equal(P.hint(doc, warning('unfinished', 'flows.ssh.route[1]', '')), 'Tab on “' + doc.entities.bridge.label + '” adds a firewall');
});

test('what stops the graph says where to put it right', () => {
  const doc = lecture();
  const hint = (path) => P.hint(doc, warning('incomplete', path, ''));
  assert.equal(hint('attacker.target'), 'select a component · Target');
  assert.equal(hint('attacker.footholds'), 'select a component · Foothold');
  assert.equal(hint('entities.sshd'), 'Tab adds its host');
  assert.equal(hint('entities.bridge'), 'Tab adds its firewall');
  assert.equal(hint('entities.filter'), 'Tab on a router adds one');
  assert.equal(hint('entities.server'), null);
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
  assert.equal(list[0].text, '“' + doc.entities.sshd.label + '” runs nowhere yet: no `hosts` association names it');
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
