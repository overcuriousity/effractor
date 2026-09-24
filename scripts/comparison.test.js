const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../assets/js/comparison.js');

const doc = require('./fixtures/graph/lecture-doc.json');
const catalog = require('./fixtures/catalog.json');
const lecture = require('./fixtures/graph/lecture-graph.json');
const R = (name) => require('./fixtures/graph/results-' + name + '.json');

test('a scenario is put without touching the baseline or the document it came from', () => {
  const before = JSON.stringify(doc);
  const edit = C.putScenario(doc, 'patch-only', 'Patch SSH', [{ entity: 'openssh', defense: 'patched', value: true }]);
  assert.equal(JSON.stringify(doc), before);
  assert.equal(edit.doc.entities.openssh.defenses.patched, false);
  assert.deepEqual(edit.doc.scenarios['patch-only'], {
    label: 'Patch SSH',
    changes: [{ entity: 'openssh', defense: 'patched', value: true }],
  });
  assert.equal(edit.scenario, 'patch-only');
  // Existing scenarios keep their place; the new one comes last.
  assert.deepEqual(Object.keys(edit.doc.scenarios), ['patch', 'protect', 'both', 'deny', 'patch-only']);
});

test('a permission change is written in the file’s own shape', () => {
  const edit = C.putScenario(doc, 'shut', 'Shut SSH', [{ association: 'allow-ssh', value: false }]);
  assert.deepEqual(edit.doc.scenarios.shut.changes, [{ association: 'allow-ssh', field: 'allowed', value: false }]);
});

test('switches are set, replaced and cleared one at a time', () => {
  let d = C.putScenario(doc, 'mix', 'Mix', []).doc;
  d = C.setChange(d, 'mix', { entity: 'openssh', defense: 'patched' }, true).doc;
  d = C.setChange(d, 'mix', { association: 'allow-ssh' }, false).doc;
  // Setting the same switch again replaces it: one scenario sets a switch once.
  d = C.setChange(d, 'mix', { entity: 'openssh', defense: 'patched' }, 'unknown').doc;
  assert.deepEqual(d.scenarios.mix.changes, [
    { entity: 'openssh', defense: 'patched', value: 'unknown' },
    { association: 'allow-ssh', field: 'allowed', value: false },
  ]);
  d = C.setChange(d, 'mix', { entity: 'openssh', defense: 'patched' }, null).doc;
  assert.deepEqual(d.scenarios.mix.changes, [{ association: 'allow-ssh', field: 'allowed', value: false }]);
  // Nothing to clear: no edit.
  assert.equal(C.setChange(d, 'mix', { entity: 'openssh', defense: 'patched' }, null), null);
  assert.equal(C.setChange(d, 'nobody', { entity: 'openssh', defense: 'patched' }, true), null);
  // A no-op scenario is a scenario too.
  assert.deepEqual(C.putScenario(doc, 'none', 'Nothing', []).doc.scenarios.none.changes, []);
});

test('unknown and x- fields of a scenario survive an edit', () => {
  const withExtra = JSON.parse(JSON.stringify(doc));
  withExtra.scenarios.patch['x-owner'] = 'blue team';
  withExtra.scenarios.patch.changes[0]['x-ticket'] = 'SEC-1';
  const d = C.setChange(withExtra, 'patch', { association: 'allow-ssh' }, false).doc;
  assert.equal(d.scenarios.patch['x-owner'], 'blue team');
  assert.equal(d.scenarios.patch.changes[0]['x-ticket'], 'SEC-1');
  const r = C.rename(withExtra, 'patch', 'Patch it').doc;
  assert.equal(r.scenarios.patch['x-owner'], 'blue team');
  assert.equal(r.scenarios.patch.label, 'Patch it');
});

test('an attacker speed is set on a scenario and cleared back to the written one', () => {
  let d = C.setSpeed(doc, 'patch', 4).doc;
  assert.deepEqual(d.scenarios.patch.attacker, { speed: 4 });
  assert.deepEqual(Object.keys(d.scenarios.patch), ['label', 'attacker', 'changes']);
  d = C.setSpeed(d, 'patch', null).doc;
  assert.equal('attacker' in d.scenarios.patch, false);
  assert.equal(C.setSpeed(d, 'patch', null), null);
});

test('a scenario is removed alone, and a new id never collides', () => {
  const edit = C.removeScenario(doc, 'both');
  assert.deepEqual(Object.keys(edit.doc.scenarios), ['patch', 'protect', 'deny']);
  assert.match(edit.notice, /Ctrl\+Z/);
  assert.equal(C.removeScenario(doc, 'nobody'), null);
  assert.equal(C.freshId(doc, 'Patch the SSH server'), 'patch-the-ssh-server');
  assert.equal(C.freshId(doc, 'Patch'), 'patch-2');
  assert.equal(C.freshId(doc, '42'), 'scenario-42');
  assert.equal(C.freshId(doc, '__proto__'), 'proto');
  assert.equal(C.freshId({ scenarios: {} }, ''), 'scenario');
});

test('what a scenario can switch: each defence a component has and each permission', () => {
  const all = C.switches(doc, catalog);
  const ssh = all.find((s) => s.entity === 'openssh');
  assert.equal(ssh.defense, 'patched');
  assert.equal(ssh.baseline, false);
  const permit = all.find((s) => s.association === 'allow-ssh');
  assert.ok(permit.label.length > 0);
  assert.equal(permit.baseline, true);
  // A network has no defence and is not offered.
  assert.equal(all.some((s) => s.entity === 'client-net'), false);
  // Each switch once.
  assert.equal(new Set(all.map((s) => s.key)).size, all.length);
});

test('a scenario’s own settings, read back for its form', () => {
  const both = C.settings(doc, 'both');
  assert.deepEqual(both.values, { 'entities.openssh.defenses.patched': true, 'entities.server-key.defenses.protected': true });
  assert.equal(both.speed, null);
  assert.equal(C.settings(doc, 'nobody'), null);
});

test('selecting a scenario is kept only while the document still names it', () => {
  assert.equal(C.selectable(doc, 'deny'), 'deny');
  assert.equal(C.selectable(C.removeScenario(doc, 'deny').doc, 'deny'), '');
  assert.equal(C.selectable(doc, '__proto__'), '');
  assert.equal(C.selectable(doc, ''), '');
});

test('rows put both curves on their one grid, bands and all', () => {
  const r = R('fast');
  const rows = C.rows(r);
  assert.equal(rows.length, 65);
  const b = r.baseline.outcome.available.ttc_cdf;
  const s = r.scenario.outcome.available.ttc_cdf;
  rows.forEach((row, i) => {
    assert.deepEqual(row, [b[i][0], b[i][1], b[i][2], b[i][3], s[i][1], s[i][2], s[i][3]]);
  });
  // A side with no numbers has empty columns, not zeros.
  const u = C.rows(R('scenario-unknown'));
  assert.equal(u.length, 65);
  assert.deepEqual(u[64].slice(4), [null, null, null]);
  // A structural side's band is its value.
  const d = C.rows(R('deny'));
  assert.deepEqual(d[64].slice(4), [0, 0, 0]);
  // No scenario: no comparison rows.
  assert.deepEqual(C.rows(R('available')), []);
});

test('the benefit is the paired difference the solver gave, never a difference of intervals', () => {
  const up = C.summary(R('deny'));
  assert.equal(up.benefit, 1);
  assert.deepEqual(up.ci, { lo: 1, hi: 1 });
  assert.equal(up.verdict, 'lower');
  const zero = C.summary(R('patch'));
  assert.equal(zero.benefit, 0);
  assert.equal(zero.verdict, 'same');
  const worse = C.summary(R('fast'));
  const d = R('fast').delta.available;
  assert.equal(worse.benefit, d.mean);
  assert.deepEqual(worse.ci, d.ci);
  assert.equal(worse.verdict, 'higher');
  const b = R('fast').baseline.outcome.available.ci;
  const s = R('fast').scenario.outcome.available.ci;
  assert.notDeepEqual(worse.ci, { lo: b.lo - s.hi, hi: b.hi - s.lo });
  // One sample: a difference, and why there is no interval.
  const one = C.summary(R('deny-one'));
  assert.equal(one.benefit, 1);
  assert.equal(one.ci, null);
  assert.equal(one.ciReason, 'fewer than two paired samples');
  // Known baseline, unknown scenario: no benefit, and what is missing.
  const unk = C.summary(R('scenario-unknown'));
  assert.equal(unk.benefit, null);
  assert.deepEqual(unk.missing, ['scenarios.doubt.changes[0]']);
  assert.equal(unk.baseline.p, 1);
  assert.equal(unk.scenario.p, null);
  // Illustrative inputs are said per side.
  assert.equal(worse.illustrative.baseline, true);
  assert.equal(worse.illustrative.scenario, true);
  // No scenario: nothing to compare.
  assert.equal(C.summary(R('available')), null);
  assert.equal(C.summary(null), null);
});

test('changed steps are the ones reading a switch the scenario sets', () => {
  const patch = C.changedSteps(lecture.graph, doc, 'patch');
  assert.deepEqual(patch.steps, ['action/product-find-exploit/openssh']);
  assert.equal(patch.speed, null);
  const deny = C.changedSteps(lecture.graph, doc, 'deny');
  assert.ok(deny.steps.length >= 1);
  deny.steps.forEach((id) => assert.ok(lecture.graph.nodes.some((n) => n.id === id), id));
  assert.ok(deny.steps.every((id) => /allow-ssh|permission/.test(JSON.stringify(lecture.graph.nodes.find((n) => n.id === id)))));
  const fast = C.changedSteps(lecture.graph, C.setSpeed(doc, 'patch', 2).doc, 'patch');
  assert.equal(fast.speed, 2);
  assert.deepEqual(C.changedSteps(lecture.graph, doc, 'nobody'), { steps: [], speed: null });
});

test('routes: blocked by the scenario, changed by it, and still open, from the solver’s states', () => {
  const deny = C.routes(lecture.graph, R('deny'), doc, 'deny');
  // Denying the only flow blocks the target and everything that needed it.
  assert.ok(deny.blocked.includes(R('deny').target));
  assert.equal(deny.remaining.length, 0);
  const patch = C.routes(lecture.graph, R('patch'), doc, 'patch');
  // Patched with Never: the exploit is blocked; the login route remains.
  assert.ok(patch.blocked.includes('action/product-find-exploit/openssh'));
  assert.ok(patch.remaining.some((id) => /login/.test(id)), patch.remaining.join(', '));
  assert.equal(patch.remaining.includes('action/product-find-exploit/openssh'), false);
  // States are the solver's: a remaining step is possible under the scenario,
  // however few samples reached it.
  const status = Object.fromEntries(R('patch').scenario.nodes.map((n) => [n.id, n.status]));
  patch.remaining.forEach((id) => assert.ok(status[id] === 'possible' || status[id] === 'seeded', id));
  // Without a scenario side there is nothing to say.
  assert.equal(C.routes(lecture.graph, R('available'), doc, ''), null);
});

test('a changed step that stays open is listed as changed, not as remaining', () => {
  // As a finite replacement leaves it: the patched exploit still possible.
  const r = JSON.parse(JSON.stringify(R('patch')));
  r.scenario.nodes = r.baseline.nodes;
  const out = C.routes(lecture.graph, r, doc, 'patch');
  assert.deepEqual(out.changed, ['action/product-find-exploit/openssh']);
  assert.equal(out.remaining.includes('action/product-find-exploit/openssh'), false);
  assert.equal(out.blocked.includes('action/product-find-exploit/openssh'), false);
});

test('putting a scenario again keeps its x- fields and speed', () => {
  const withExtra = C.setSpeed(JSON.parse(JSON.stringify(doc)), 'patch', 3).doc;
  withExtra.scenarios.patch['x-owner'] = 'blue team';
  const d = C.putScenario(withExtra, 'patch', 'Patch again', []).doc;
  assert.deepEqual(d.scenarios.patch, { label: 'Patch again', attacker: { speed: 3 }, changes: [], 'x-owner': 'blue team' });
});
