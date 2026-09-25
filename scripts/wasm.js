// The browser's wasm module, loaded in node the way the page loads it: the
// no-modules bundle evaluated as a script, then instantiated synchronously.
// Run scripts/build-wasm.sh first.
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function loadWasm() {
  const api = new Function(fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm.js'), 'utf8') + '; return wasm_bindgen;')();
  api.initSync({ module: fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm_bg.wasm')) });
  return api;
}

module.exports = { loadWasm };
