// Scenario changes the Compare tab writes (comparison.js putScenario) are
// judged by the browser's wasm module, as the page would send them: a
// switch set twice, a defence the component does not have, a permission
// that is not one, an association that is not there are each refused at
// their path, and a good one saves. The Rust format tests check the same
// refusals natively; this checks them through wasm. Run after
// scripts/build-wasm.sh.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = new Function(fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm.js'), 'utf8') + '; return wasm_bindgen;')();
api.initSync({ module: fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm_bg.wasm')) });
const C = require('../assets/js/comparison.js');
const doc = require('./fixtures/graph/lecture-doc.json');

// "code path" of every error, from saving and, when it saves, validating.
function errors(d) {
  const saved = JSON.parse(api.serialize(JSON.stringify(d)));
  const answer = saved.ok == null ? saved : JSON.parse(api.validate(saved.ok));
  return answer.diagnostics.filter(x => x.severity === 'error').map(x => x.code + ' ' + x.path);
}

const CASES = [
  {
    name: 'a defence set twice',
    changes: [{ entity: 'openssh', defense: 'patched', value: true }, { entity: 'openssh', defense: 'patched', value: false }],
    want: ['conflicting-change scenarios.twice.changes[1]'],
  },
  {
    name: 'a permission set twice',
    changes: [{ association: 'allow-ssh', value: false }, { association: 'allow-ssh', value: false }],
    want: ['conflicting-change scenarios.twice.changes[1]'],
  },
  {
    name: 'a defence the component does not have',
    changes: [{ entity: 'sshd', defense: 'patched', value: true }],
    want: ['unknown-state scenarios.twice.changes[0].defense'],
  },
  {
    name: 'an association that is no permission',
    changes: [{ association: 'bridge-filter', value: false }],
    want: ['association-type scenarios.twice.changes[0].association'],
  },
  {
    name: 'an association that is not there',
    changes: [{ association: 'nothing', value: false }],
    want: ['unknown-reference scenarios.twice.changes[0].association'],
  },
];

let failed = false;
if (errors(doc).length) {
  console.error('the lecture document does not save in wasm:', errors(doc));
  process.exit(1);
}
const good = C.putScenario(doc, 'twice', 'Twice', [{ entity: 'openssh', defense: 'patched', value: true }, { association: 'allow-ssh', value: false }]);
if (errors(good.doc).length) {
  console.error('a good scenario was refused:', errors(good.doc));
  failed = true;
}
for (const c of CASES) {
  const found = errors(C.putScenario(doc, 'twice', 'Twice', c.changes).doc);
  const missing = c.want.filter(w => !found.includes(w));
  if (missing.length) {
    console.error(c.name + ': wasm did not say ' + missing.join(', ') + '; it said', found);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('scenario changes: wasm refuses a switch set twice and one that is not there, each at its path');
