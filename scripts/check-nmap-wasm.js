// The documents an nmap import produces (scripts/fixtures/nmap/imported*.doc.json,
// pinned by scripts/nmap.test.js and nmap-route.test.js: a plain import, one
// with a router and a firewall, one with vulnerability checks, one with the
// routers of a traced route) are saved and validated by the
// browser's wasm module, as the page would. Run after scripts/build-wasm.sh.
const fs = require('node:fs');
const path = require('node:path');

const { loadWasm } = require('./wasm.js');

const root = path.resolve(__dirname, '..');
const api = loadWasm();

const load = name => JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/nmap', name), 'utf8'));
const image = load('imported.doc.json');
const errors = answer => answer.diagnostics.filter(d => d.severity === 'error');

function check(doc) {
  const saved = JSON.parse(api.serialize(JSON.stringify(doc)));
  if (saved.ok == null) return errors(saved);
  return errors(JSON.parse(api.validate(saved.ok)));
}

// The scanners beside nmap (roadmap scanner-readers, greenbone-import,
// nuclei-import, nuclei-templates), each after nmap.
const others = ['masscan/imported.doc.json', 'greenbone/imported.doc.json', 'nuclei/imported.doc.json', 'nuclei/imported-identify.doc.json'];
for (const name of ['imported.doc.json', 'imported-router.doc.json', 'imported-checks.doc.json', 'imported-route.doc.json'].concat(others)) {
  const found = check(name.includes('/') ? JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures', name), 'utf8')) : load(name));
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
console.log('scanner imports: the imported documents save and validate in wasm');
