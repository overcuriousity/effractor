const { test } = require('node:test');
const assert = require('node:assert');
const V = require('../assets/js/attack-view.js');
const fixture = require('./fixtures/graph/lecture-graph.json');
const doc = require('./fixtures/graph/lecture-doc.json');

const { graph, support } = fixture;
const clone = value => JSON.parse(JSON.stringify(value));
// A step's provenance, as the module supplied it.
const origins = (g, id) => g.nodes.find(n => n.id === id).origins;

test('a component leads to the steps generated from it, and a step back to its sources', () => {
  const ids = V.stepsFor(graph, 'entity/sshd');
  assert.ok(ids.includes('action/service-deploy-exploit/sshd'));
  assert.ok(ids.includes('state/service/sshd/control'));
  assert.ok(!ids.includes('input/foothold/workstation/admin'));
  ids.forEach(id => assert.ok(graph.nodes.some(n => n.id === id), id));
  const deploy = origins(graph, 'action/service-deploy-exploit/sshd');
  assert.ok(deploy.some(o => o.paths.includes('entities.sshd.parameters.deploy-exploit')));
  // Back again: every component a step's origins bind leads to that step.
  deploy.forEach(o => o.entities.forEach(e => assert.ok(V.stepsFor(graph, 'entity/' + e).includes('action/service-deploy-exploit/sshd'))));
  assert.deepEqual(V.stepsFor(graph, 'entity/nothing-here'), []);
  // Flows and relationships have their steps too.
  assert.ok(V.stepsFor(graph, 'flow/ssh').includes('action/flow-connect/ssh'));
  assert.ok(V.stepsFor(graph, 'association/allow-ssh').includes('input/flow-permission/filter/ssh'));
});

test('a renamed label changes what a step says, not what is selected', () => {
  const renamed = clone(graph);
  renamed.nodes.forEach(n => { n.label = n.label.replace('SSH server', 'OpenSSH'); });
  assert.deepEqual(V.stepsFor(renamed, 'entity/sshd'), V.stepsFor(graph, 'entity/sshd'));
  const drawn = V.describe(renamed, support, null).graph.nodes.find(n => n.id === 'step/action/service-deploy-exploit/sshd');
  assert.equal(drawn.label, 'Use the exploit · OpenSSH');
  assert.equal(V.originOf(renamed, 'action/service-deploy-exploit/sshd'), 'entity/sshd');
  // A step's own component: the state's owner, the action's object.
  assert.equal(V.originOf(graph, 'state/host/server/admin'), 'entity/server');
  assert.equal(V.originOf(graph, 'state/flow/ssh/connected'), 'flow/ssh');
  assert.equal(V.originOf(graph, 'action/flow-connect/ssh'), 'flow/ssh');
  assert.equal(V.originOf(graph, 'action/credential-extract/workstation/server-key'), 'entity/server-key');
  assert.equal(V.originOf(graph, 'input/foothold/workstation/admin'), 'entity/workstation');
  assert.equal(V.originOf(graph, 'state/nothing'), null);
});

test('each source field leads to the place in the architecture that sets it', () => {
  const at = path => V.sourceTarget(doc, path);
  // Patching: the switch and both discovery slots.
  const find = origins(graph, 'action/product-find-exploit/openssh')[0];
  assert.deepEqual(find.paths.map(at), [
    { select: 'entity/openssh', slot: 'find-exploit', path: 'entities.openssh.parameters.find-exploit' },
    { select: 'entity/openssh', slot: 'find-exploit-patched', path: 'entities.openssh.parameters.find-exploit-patched' },
    { select: 'entity/openssh', field: 'defense', defense: 'patched', path: 'entities.openssh.defenses.patched' },
  ]);
  // Extraction: the credential's slot.
  assert.deepEqual(at('entities.server-key.parameters.extract'), { select: 'entity/server-key', slot: 'extract', path: 'entities.server-key.parameters.extract' });
  // A flow's connect.
  assert.deepEqual(at('flows.ssh.parameters.connect'), { select: 'flow/ssh', slot: 'connect', path: 'flows.ssh.parameters.connect' });
  // An unfinished route: the flow, at its next hop; a component or flow as a whole.
  assert.deepEqual(at('flows.ssh.route'), { select: 'flow/ssh', field: 'route', path: 'flows.ssh.route' });
  assert.deepEqual(at('flows.ssh.route[1]'), { select: 'flow/ssh', field: 'route', path: 'flows.ssh.route[1]' });
  assert.deepEqual(at('flows.ssh.source'), { select: 'flow/ssh', path: 'flows.ssh.source' });
  assert.deepEqual(at('entities.sshd'), { select: 'entity/sshd', path: 'entities.sshd' });
  assert.deepEqual(at('entities.gone'), { source: 'entities.gone', path: 'entities.gone' });
  // A permission: the firewall's relationship to the flow.
  assert.deepEqual(at('associations.allow-ssh.allowed'), { select: 'association/allow-ssh', field: 'allowed', path: 'associations.allow-ssh.allowed' });
  // The foothold is set on its component.
  assert.deepEqual(at('attacker.footholds[0]'), { select: 'entity/workstation', field: 'foothold', path: 'attacker.footholds[0]' });
  // A scenario change has no control of its own: its line in the source.
  assert.deepEqual(at('scenarios.patch.changes[0]'), { source: 'scenarios.patch.changes[0]', path: 'scenarios.patch.changes[0]' });
  // What names nothing in this document goes to the source too, never to a
  // selection that does not exist.
  assert.deepEqual(at('entities.gone.parameters.login'), { source: 'entities.gone.parameters.login', path: 'entities.gone.parameters.login' });
  assert.deepEqual(at('attacker.footholds[7]'), { source: 'attacker.footholds[7]', path: 'attacker.footholds[7]' });
  // No target or no foothold yet: a choice of components, never the source.
  const bare = { ...doc, attacker: {} };
  assert.deepEqual(V.sourceTarget(bare, 'attacker.target'), { pick: 'target', path: 'attacker.target' });
  assert.deepEqual(V.sourceTarget(bare, 'attacker.footholds'), { pick: 'foothold', path: 'attacker.footholds' });
  assert.deepEqual(V.sourceTarget({ ...doc, attacker: { footholds: [] } }, 'attacker.footholds'), { pick: 'foothold', path: 'attacker.footholds' });
  // Hosting privilege: the relationship that grants it, bound by the origin.
  const hosting = origins(graph, 'state/host/server/admin').find(o => o.rule === 'execution-privilege');
  assert.deepEqual(hosting.associations, ['service-hosting']);
});

test('a step inspected says its rule, its time and its state, blocked ones included', () => {
  const find = V.inspect(graph, support, 'action/product-find-exploit/openssh');
  assert.equal(find.status, 'possible');
  assert.equal(find.kind, 'action');
  assert.deepEqual(find.timing, { status: 'illustrative', expression: 'Exponential(mean 10)', note: graph.nodes.find(n => n.id === 'action/product-find-exploit/openssh').timing.note });
  assert.deepEqual(find.rules, ['product-find-exploit']);
  assert.ok(find.components.includes('openssh'));

  const admin = V.inspect(graph, support, 'state/network/admin-net/access');
  assert.equal(admin.status, 'unreachable');
  assert.equal(admin.kind, 'fact');
  assert.deepEqual(admin.rules, []);
  assert.match(admin.reason, /nothing/);

  // Denied at the firewall: blocked, with the value that blocks it.
  const denied = clone(fixture);
  const i = denied.graph.nodes.findIndex(n => n.id === 'input/flow-permission/filter/ssh');
  denied.graph.nodes[i].timing.expression = 'denied';
  denied.support.nodes[i].status = 'blocked';
  const policy = V.inspect(denied.graph, denied.support, 'input/flow-permission/filter/ssh');
  assert.equal(policy.status, 'blocked');
  assert.equal(policy.kind, 'input');
  assert.match(policy.reason, /denied/);
  assert.deepEqual(origins(denied.graph, 'input/flow-permission/filter/ssh')[0].paths, ['associations.allow-ssh.allowed']);
  assert.equal(V.inspect(graph, support, 'state/nothing'), null);
});

test('a table of every step inspects each with one index built once', () => {
  const at = V.index(graph);
  for (const n of graph.nodes) assert.deepEqual(V.inspect(graph, support, n.id, at), V.inspect(graph, support, n.id));
  assert.equal(V.inspect(graph, support, 'state/nothing', at), null);
  const big = chain(20000);
  const once = V.index(big.graph);
  const t = Date.now();
  for (const n of big.graph.nodes) V.inspect(big.graph, big.support, n.id, once);
  const ms = Date.now() - t;
  assert.ok(ms < 1000, '20000 steps took ' + ms + ' ms');
});

// ---- Cycle 2: what the canvas draws ----

// A generated-looking graph of `n` steps in a chain, the last the target.
// Every step an ALL: a fact with one producer would be drawn in it.
function chain(n) {
  const nodes = [];
  for (let i = 0; i < n; i++) {
    nodes.push({ id: 'state/x/n' + i + '/s', label: 'Step ' + i, kind: i === 0 ? 'input' : 'all', inputs: i === 0 ? [] : ['state/x/n' + (i - 1) + '/s'], origins: [{ rule: 'r', version: 1, entities: ['e' + i], associations: [], flows: [], paths: [], assumptions: [] }], timing: { status: i % 2 ? 'illustrative' : 'logical', expression: null, note: null, paths: [], missing: [] } });
  }
  return { graph: { target: nodes[n - 1].id, nodes }, support: { nodes: nodes.map(x => ({ id: x.id, status: 'possible', missing: [] })), target_support: [] } };
}

test('every drawn edge runs from a prerequisite to what depends on it', () => {
  const { graph: drawn } = V.describe(graph, support, null);
  assert.equal(drawn.profile, 'attack-graph');
  const { drawnAs } = V.describe(graph, support, null);
  const byId = Object.fromEntries(graph.nodes.map(n => ['step/' + n.id, n]));
  // Each line of the graph is drawn once: as itself, on a line between
  // two boxes, or inside one.
  const inside = Object.keys(drawnAs).filter(k => k.includes('>') && !drawnAs[k].includes('>')).length;
  // A line between boxes is named for them; the graph's own lines it
  // stands for are its id, when that is one, and its aliases.
  const own = id => { const [from, to] = id.split('>'); return !!byId[to] && byId[to].inputs.includes(from.slice(5)); };
  const lines = drawn.edges.reduce((sum, e) => sum + (own(e.id) ? 1 : 0) + (e.aliases || []).length, 0);
  assert.equal(lines + inside, graph.nodes.reduce((sum, n) => sum + n.inputs.length, 0));
  drawn.edges.forEach(e => (e.aliases || []).forEach(id => assert.ok(own(id), id)));
  drawn.edges.forEach(e => assert.ok(own(e.id) || (e.aliases || []).length, e.id));
});

test('junctions, badges and states are said in symbols and words, not colour alone', () => {
  const drawn = V.describe(graph, support, null).graph.nodes;
  const at = id => drawn.find(n => n.id === 'step/' + id);
  assert.equal(at('action/service-login/server-account/sshd').inscription, 'ALL');
  assert.equal(at('state/host/server/admin').inscription, 'ANY');
  assert.equal(at('input/foothold/workstation/admin').symbol, 'basic');
  assert.equal(at('state/host/server/admin').badge, 'target');
  assert.equal(at('input/foothold/workstation/admin').badge, 'foothold');
  // Unreachable: a word as well as a class.
  const admin = at('state/network/admin-net/access');
  assert.equal(admin.tag, 'unreachable');
  assert.ok(admin.classes.includes('is-unreachable'));
  // Neutral: no importance classes, no tree style.
  drawn.forEach(n => assert.ok(!n.classes.some(c => /^imp-/.test(c)), n.id));

  // A blocked step and an unknown one.
  const variant = clone(fixture);
  const i = variant.graph.nodes.findIndex(n => n.id === 'input/flow-permission/filter/ssh');
  variant.support.nodes[i].status = 'blocked';
  const j = variant.graph.nodes.findIndex(n => n.id === 'action/product-find-exploit/openssh');
  variant.graph.nodes[j].timing = { status: 'unknown', expression: null, note: null, paths: ['entities.openssh.parameters.find-exploit'], missing: ['entities.openssh.parameters.find-exploit'] };
  const again = V.describe(variant.graph, variant.support, null).graph.nodes;
  const blocked = again.find(n => n.id === 'step/input/flow-permission/filter/ssh');
  assert.equal(blocked.tag, 'blocked');
  assert.ok(blocked.classes.includes('is-blocked'));
  const unknown = again.find(n => n.id === 'step/action/product-find-exploit/openssh');
  assert.equal(unknown.tag, 'unknown');
  assert.equal(unknown.unquantified, true);
  assert.ok(unknown.classes.includes('is-unknown'));
});

test('a cycle is drawn as edges, once each, and the walk ends', () => {
  const g = clone(chain(4));
  // n0 → n1 → n2 → n3, and n3 back into n1.
  g.graph.nodes[1].inputs.push(g.graph.nodes[3].id);
  const { graph: drawn, shown, total } = V.describe(g.graph, g.support, { id: 'step/' + g.graph.nodes[2].id, limit: 3 });
  assert.equal(total, 4);
  assert.equal(shown, 3);
  assert.equal(new Set(drawn.nodes.map(n => n.id)).size, 3);
  const all = V.describe(g.graph, g.support, null).graph;
  assert.ok(all.edges.some(e => e.from === 'step/' + g.graph.nodes[3].id && e.to === 'step/' + g.graph.nodes[1].id));
  assert.equal(all.edges.length, 4);
});

test('a graph larger than the canvas shows a window with an honest count; search still finds every step', () => {
  const big = chain(501);
  const first = V.describe(big.graph, big.support, null);
  assert.equal(first.total, 501);
  assert.equal(first.shown, 500);
  assert.equal(first.graph.nodes.length, 500);
  // Without a focus the window is round the target.
  assert.ok(first.graph.nodes.some(n => n.id === 'step/' + big.graph.target));
  assert.ok(!first.graph.nodes.some(n => n.id === 'step/state/x/n0/s'));
  // The edge that leaves the window is said on the step it leaves.
  assert.equal(first.graph.nodes.find(n => n.id === 'step/state/x/n1/s').attributes, '+1 not shown');
  assert.equal(V.search(big.graph, '').length, 501);
  assert.deepEqual(V.search(big.graph, 'step 0'), ['state/x/n0/s']);
  // Focusing a step outside the window brings it in.
  const focused = V.describe(big.graph, big.support, { id: 'step/state/x/n0/s' });
  assert.ok(focused.graph.nodes.some(n => n.id === 'step/state/x/n0/s'));
  assert.equal(focused.shown, 500);
  // A component's steps can be the focus too.
  assert.ok(V.describe(big.graph, big.support, { id: 'entity/e0' }).graph.nodes.some(n => n.id === 'step/state/x/n0/s'));
  // The graph handed in is not changed.
  assert.deepEqual(big, chain(501));
  // A step with more prerequisites than the canvas holds: exactly the limit.
  const star = chain(2);
  for (let k = 0; k < 600; k++) {
    star.graph.nodes.push({ id: 'input/s' + k, label: 'In ' + k, kind: 'input', inputs: [], origins: [], timing: { status: 'foothold', expression: null, note: null, paths: [], missing: [] } });
    star.graph.nodes[1].inputs.push('input/s' + k);
  }
  const windowed = V.describe(star.graph, { nodes: [] }, null);
  assert.equal(windowed.shown, 500);
  assert.equal(windowed.total, 602);
  assert.equal(windowed.graph.nodes.find(n => n.id === 'step/' + star.graph.target).attributes, '+102 not shown');
});

test('a generated step cannot be edited: every edit action on it is refused, and says so', () => {
  ['deleteNode', 'reparent', 'rename', 'addChild', 'unlink'].forEach(action => {
    assert.match(V.refuse(action), /generated.*read-only/);
  });
  ['select', 'source', 'focus'].forEach(action => assert.equal(V.refuse(action), null));
});

test('ELK lays out the attack graph, cycles included, with every line from a prerequisite up into its dependent', async () => {
  const ELK = require('elkjs');
  const { layoutWith } = require('../assets/js/graph.js');
  const run = g => new ELK().layout(g);
  for (const g of [fixture, (() => { const c = clone(chain(6)); c.graph.nodes[1].inputs.push(c.graph.nodes[5].id); return c; })()]) {
    const { graph: drawn } = V.describe(g.graph, g.support, null);
    const laid = await layoutWith(run, drawn);
    assert.equal(laid.arrows, true);
    assert.equal(laid.nodes.length, drawn.nodes.length);
    const box = Object.fromEntries(laid.nodes.map(n => [n.id, n]));
    assert.equal(laid.edges.length, drawn.edges.length);
    laid.edges.forEach(e => {
      const start = e.points[0], end = e.points[e.points.length - 1];
      // Leaves the prerequisite's box at its top, arrives under the dependent's symbol.
      assert.ok(Math.abs(start.y - box[e.from].y) < 1e-6, e.id + ' start');
      assert.ok(Math.abs(end.y - (box[e.to].y + box[e.to].height)) < 1e-6, e.id + ' end');
    });
  }
});

test('a focus larger than the canvas is cut to the limit, and a focus that is gone falls back to the target', () => {
  // One component bound by 600 steps.
  const wide = chain(2);
  for (let k = 0; k < 600; k++) {
    wide.graph.nodes.push({ id: 'input/w' + k, label: 'W ' + k, kind: 'input', inputs: [], origins: [{ rule: 'r', version: 1, entities: ['hub'], associations: [], flows: [], paths: [], assumptions: [] }], timing: { status: 'foothold', expression: null, note: null, paths: [], missing: [] } });
  }
  const cut = V.describe(wide.graph, { nodes: [] }, { id: 'entity/hub' });
  assert.equal(cut.shown, 500);
  assert.equal(cut.graph.nodes.length, 500);
  const gone = V.describe(chain(501).graph, { nodes: [] }, { id: 'step/state/x/nowhere/s' });
  assert.equal(gone.shown, 500);
  assert.ok(gone.graph.nodes.some(n => n.id === 'step/state/x/n500/s'), 'round the target');
});

test('a key belongs to the control it is typed in: letters to fields, Enter and space to buttons too', () => {
  assert.equal(V.ownsKey('INPUT', 'g'), true);
  assert.equal(V.ownsKey('TEXTAREA', 'g'), true);
  assert.equal(V.ownsKey('BUTTON', 'g'), false);
  assert.equal(V.ownsKey('BUTTON', 'Enter'), true);
  assert.equal(V.ownsKey('BUTTON', ' '), true);
  assert.equal(V.ownsKey('BUTTON', 'Tab'), true, 'keyboard focus moves on');
  assert.equal(V.ownsKey('svg', 'g'), false);
});

test('a step lights how it was reached: back along the simulated path, else its prerequisites', () => {
  const results = require('./fixtures/graph/results-available.json');
  const witness = results.baseline.witness;
  const onPath = V.lineage(graph, witness, 'state/service/sshd/reachable');
  assert.ok(onPath.nodes.includes('step/state/service/sshd/reachable'));
  assert.ok(onPath.nodes.includes('step/action/flow-connect/ssh'));
  assert.ok(onPath.nodes.includes('step/input/foothold/workstation/admin'), 'back to the foothold');
  assert.ok(!onPath.nodes.includes('step/state/host/server/admin'), 'nothing after it');
  assert.ok(onPath.edges.includes('step/action/flow-connect/ssh>step/state/flow/ssh/connected'));
  // Every lit line joins two lit steps.
  onPath.edges.forEach(e => {
    const [from, to] = e.split('>');
    assert.ok(onPath.nodes.includes(from) && onPath.nodes.includes(to), e);
  });
  // Off the path (or with no path): the step and what it needs directly.
  const off = V.lineage(graph, null, 'state/host/server/admin');
  assert.deepEqual(off.nodes.sort(), ['step/state/host/server/admin', 'step/state/service/sshd/control', 'step/state/session/server-account/sshd']);
  assert.deepEqual(off.edges.sort(), ['step/state/service/sshd/control>step/state/host/server/admin', 'step/state/session/server-account/sshd>step/state/host/server/admin']);
  assert.deepEqual(V.lineage(graph, witness, 'nothing'), { nodes: [], edges: [] });
});

test('by default only what leads to the target is drawn, and the rest is counted', () => {
  const only = V.describe(graph, support, { onlySupport: true });
  // The steps drawn: the boxes, and the facts drawn in them.
  const ids = only.graph.nodes.flatMap(n => [n.id].concat(n.aliases || [])).map(id => id.slice(5)).sort();
  assert.deepEqual(ids, support.target_support.slice().sort());
  assert.equal(only.elsewhere, graph.nodes.length - support.target_support.length);
  assert.equal(only.total, graph.nodes.length);
  // A line into the rest is said on the step it leaves, as for a window.
  only.graph.edges.forEach(e => assert.ok(ids.includes(e.from.slice(5)) && ids.includes(e.to.slice(5))));
  // Asked for, or focused, a step elsewhere is drawn: everything then is.
  const elsewhere = graph.nodes.map(n => n.id).find(id => !support.target_support.includes(id));
  const focused = V.describe(graph, support, { onlySupport: true, id: 'step/' + elsewhere });
  const as = focused.drawnAs['step/' + elsewhere] || 'step/' + elsewhere;
  assert.ok(focused.graph.nodes.some(n => n.id === as));
  assert.equal(focused.elsewhere, 0);
  // Nothing leads to the target (it cannot be reached): everything is drawn.
  const none = V.describe(graph, { ...support, target_support: [] }, { onlySupport: true });
  assert.equal(none.shown, graph.nodes.length);
  assert.equal(none.elsewhere, 0);
});

test('a step walks to what it needs and to what needs it; the path is stepped in time order', () => {
  const n = V.neighbours(graph, 'state/host/server/admin');
  assert.deepEqual(n.prerequisites, ['state/service/sshd/control', 'state/session/server-account/sshd']);
  assert.deepEqual(n.dependents, ['state/host/server/user', 'state/service/sshd/control']);
  assert.deepEqual(V.neighbours(graph, 'nothing'), { prerequisites: [], dependents: [] });
  const witness = require('./fixtures/graph/results-available.json').baseline.witness;
  const steps = V.pathSteps(witness);
  assert.ok(steps.length > 0);
  assert.ok(steps.every(id => !id.startsWith('input/')), 'inputs are where it starts, not steps taken');
  const times = Object.fromEntries(witness.nodes.map(w => [w.id, w.time]));
  steps.slice(1).forEach((id, i) => assert.ok(times[id] >= times[steps[i]], id));
  assert.ok(steps.includes(graph.target));
  assert.deepEqual(V.pathSteps(null), []);
});

test('a route is a way: from the foothold, across the networks its flows cross, to the target', () => {
  const results = require('./fixtures/graph/results-available.json');
  results.baseline.routes.forEach(r => {
    const stops = V.routeStops(graph, r.witness, doc);
    assert.equal(stops[0], 'entity/workstation', 'where it starts');
    assert.equal(stops[stops.length - 1], 'entity/server', 'the target last');
    assert.equal(new Set(stops).size, stops.length, 'each once');
    // The flow with what it runs from, through and to, in route order.
    const hops = ['entity/ssh-client', 'entity/client-net', 'entity/bridge', 'entity/server-net', 'flow/ssh', 'entity/sshd'].map(id => stops.indexOf(id));
    assert.ok(hops.every(i => i >= 0), JSON.stringify(stops));
    hops.slice(1).forEach((at, i) => assert.ok(at > hops[i], JSON.stringify(stops)));
  });
  assert.deepEqual(V.routeStops(graph, null, doc), []);
});

test('steps are said by the components they are about, each once', () => {
  assert.deepEqual(V.componentsOf(graph, ['action/product-find-exploit/openssh', 'state/product/openssh/exploit-ready', 'state/host/server/admin', 'nothing']), ['entity/openssh', 'entity/server']);
  assert.deepEqual(V.componentsOf(graph, []), []);
});

test('a step every way to the target needs says so', () => {
  const drawn = V.describe(graph, support, null).graph.nodes;
  const at = id => drawn.find(n => n.id === 'step/' + id);
  assert.equal(at('action/flow-connect/ssh').tag, 'every route');
  assert.ok(at('action/flow-connect/ssh').classes.includes('is-choke'));
  assert.notEqual(at('action/product-find-exploit/openssh').tag, 'every route');
  assert.deepEqual(support.chokepoints.slice().sort(), ['action/flow-connect/ssh', 'state/flow/ssh/connected', 'state/service/sshd/reachable']);
});

test('what the attacker holds at once is marked, and the legend says only the states drawn', () => {
  const drawn = V.describe(graph, support, null).graph;
  const seeded = support.nodes.filter(s => s.status === 'seeded').map(s => 'step/' + s.id);
  assert.ok(seeded.length > 0);
  drawn.nodes.filter(n => seeded.includes(n.id)).forEach(n => assert.ok(n.classes.includes('is-seeded'), n.id));
  assert.deepEqual(V.statesIn(drawn), { seeded: true, unreachable: true });
  const plain = clone(fixture);
  plain.support.nodes.forEach(s => { s.status = 'possible'; });
  assert.deepEqual(V.statesIn(V.describe(plain.graph, plain.support, null).graph), { seeded: false, unreachable: false });
  assert.deepEqual(V.statesIn(null), { seeded: false, unreachable: false });
});

// Spec §11: a fact with a single producer folds into it.
const fact = (id, inputs, extra) => Object.assign({ id, label: id, kind: 'any', inputs, origins: [{ rule: 'r', version: 1, entities: ['e'], associations: [], flows: [], paths: [], assumptions: [] }], timing: { status: 'logical', expression: null, note: null, paths: [], missing: [] } }, extra);
const act = (id, inputs) => fact(id, inputs, { kind: 'all' });
const plainSupport = nodes => ({ nodes: nodes.map(n => ({ id: n.id, status: 'possible', missing: [] })), target_support: [] });

test('a fact with one producer is drawn in its producer, a second line under its name; alternatives keep their box', () => {
  const described = V.describe(graph, support, null);
  const ids = described.graph.nodes.map(n => n.id);
  const extract = described.graph.nodes.find(n => n.id === 'step/action/credential-extract/workstation/admin-key');
  // extract → key held → credential held: both facts in the one box.
  assert.ok(!ids.includes('step/state/credential/admin-key/possessed'));
  assert.ok(!ids.includes('step/state/account/admin-account/material'));
  assert.deepEqual(extract.aliases, ['step/state/account/admin-account/material', 'step/state/credential/admin-key/possessed']);
  assert.equal(extract.lines.length, 2);
  // The fact's line leaves out what the producer's name already says.
  assert.equal(extract.lines[1], 'held +1');
  const login = described.graph.nodes.find(n => n.id === 'step/action/service-login/server-account/sshd');
  assert.equal(login.lines[1], 'Logged in');
  const foothold = described.graph.nodes.find(n => n.id === 'step/input/foothold/workstation/admin');
  assert.equal(foothold.lines[1], 'admin control');
  const control = described.graph.nodes.find(n => n.id === 'step/state/host/workstation/user');
  assert.match(control.lines[1], /^SSH client · controll/);
  assert.ok(extract.classes.includes('is-folded'));
  assert.match(extract.label, /\n.*credential held/);
  // A fact reached more than one way keeps its ANY box.
  const user = described.graph.nodes.find(n => n.id === 'step/state/host/workstation/user');
  assert.equal(user && user.inscription, 'ANY');
  // The target is drawn as itself, and nothing is drawn in it.
  const target = described.graph.nodes.find(n => n.id === 'step/' + graph.target);
  assert.equal(target.badge, 'target');
  assert.equal(target.aliases, undefined);
  assert.ok(ids.includes('step/state/host/server/user'));
  // Every step and line is drawn as something that is drawn.
  const drawnIds = new Set(ids.concat(described.graph.edges.map(e => e.id)));
  graph.nodes.forEach(n => {
    const as = described.drawnAs['step/' + n.id] || 'step/' + n.id;
    assert.ok(drawnIds.has(as), n.id);
    n.inputs.forEach(i => {
      const e = 'step/' + i + '>step/' + n.id;
      assert.ok(drawnIds.has(described.drawnAs[e] || e), e);
    });
  });
  // Every line's original ids lead to it; no line runs inside a box.
  described.graph.edges.forEach(e => {
    assert.notEqual(e.from, e.to, e.id);
    (e.aliases || []).forEach(a => assert.equal(described.drawnAs[a], e.id));
  });
  // Steps shown are counted as steps, not boxes.
  assert.equal(described.shown, graph.nodes.length);
});

test('what folds: one producer, both drawn; never into the target or round a cycle; lines from both ends merge', () => {
  const nodes = [
    fact('in', [], { kind: 'input', timing: { status: 'foothold', expression: null, note: null, paths: [], missing: [] } }),
    act('p', ['in']),
    fact('f', ['p']),
    fact('g', ['f']),
    act('d', ['p', 'f']),
    fact('c1', ['c2']),
    fact('c2', ['c1']),
    act('t', ['d', 'g', 'c1']),
    fact('after', ['t']),
  ];
  const g = { target: 't', nodes };
  const d = V.describe(g, plainSupport(nodes), null);
  const at = Object.fromEntries(d.graph.nodes.map(n => [n.id, n]));
  assert.deepEqual(at['step/p'].aliases, ['step/f', 'step/g']);
  assert.equal(d.drawnAs['step/g'], 'step/p');
  // A cycle of facts, each the other's only producer: both stay.
  assert.ok(at['step/c1'] && at['step/c2']);
  // Nothing is drawn in the target.
  assert.ok(at['step/after']);
  // d needs p and f, one box: one line, both ids on it.
  const into = d.graph.edges.filter(e => e.to === 'step/d');
  assert.equal(into.length, 1);
  assert.equal(into[0].id, 'step/p>step/d');
  assert.deepEqual(into[0].aliases, ['step/f>step/d']);
  // A line inside the box is drawn as the box.
  assert.equal(d.drawnAs['step/p>step/f'], 'step/p');
  // g's line to t leaves p's box.
  assert.equal(d.drawnAs['step/g>step/t'], 'step/p>step/t');
  // Held apart by the window: a fact whose producer is not drawn is drawn
  // as itself (f, p outside), and what it produces still folds into it.
  const w = V.describe(g, plainSupport(nodes), { id: 'step/g', limit: 2 });
  assert.deepEqual(w.graph.nodes.map(n => [n.id, n.aliases]), [['step/f', ['step/g']]]);
  assert.equal(w.shown, 2);
});
