// The documents an nmap import produces (scripts/fixtures/nmap/imported*.doc.json,
// pinned by scripts/nmap.test.js: a plain import, one with a router and a
// firewall, one with vulnerability checks) are saved and validated by the
// browser's wasm module, as the page would. Run after scripts/build-wasm.sh.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const api = new Function(fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm.js'), 'utf8') + '; return wasm_bindgen;')();
api.initSync({ module: fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm_bg.wasm')) });

const load = name => JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/nmap', name), 'utf8'));
const image = load('imported.doc.json');
const errors = answer => answer.diagnostics.filter(d => d.severity === 'error');

function check(doc) {
  const saved = JSON.parse(api.serialize(JSON.stringify(doc)));
  if (saved.ok == null) return errors(saved);
  return errors(JSON.parse(api.validate(saved.ok)));
}

for (const name of ['imported.doc.json', 'imported-router.doc.json', 'imported-checks.doc.json']) {
  const found = check(load(name));
  if (found.length) {
    console.error(name + ' does not save in wasm:', found);
    process.exit(1);
  }
}
// The check can fail: a tool on a host is refused.
const wrong = JSON.parse(JSON.stringify(image));
wrong.entities.srv.tool = 'nmap';
if (!check(wrong).some(d => d.path === 'entities.srv.tool')) {
  console.error('wasm accepted a tool on a host');
  process.exit(1);
}
console.log('nmap import: the imported documents save and validate in wasm');
