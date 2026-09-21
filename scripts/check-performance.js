// Reproducible wasm budget check. Run after scripts/build-wasm.sh.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
function ok(text) {
  const reply = JSON.parse(text);
  if (!reply.ok) throw new Error((reply.diagnostics || []).map(d => d.message).join('; ') || 'solver returned no result');
  return reply.ok;
}
function measure(api, source, now = () => performance.now()) {
  const start = now();
  const begun = ok(api.solve_begin(source));
  if (!begun.exact || !begun.exact.available) throw new Error("exact result unavailable");
  const exact_ms = now() - start;
  let progress = begun.progress;
  while (progress.done < progress.total) {
    const next = ok(api.solve_step());
    if (next.done <= progress.done || next.total !== progress.total || next.done > next.total) throw new Error('invalid sampling progress');
    progress = next;
  }
  const result = ok(api.solve_finish());
  const total_ms = now() - start;
  if (!result.sampled || !result.sampled.available) throw new Error('sampling unavailable');
  return { exact_ms, total_ms, samples: result.sampled.available.samples };
}
function withinBudget(result) { return result.samples === 10000 && result.exact_ms < 100 && result.total_ms < 1000; }
if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const source = fs.readFileSync(process.argv[2] || path.join(root, 'docs/course/reference-fault-tree.yaml'), 'utf8');
    const api = new Function(fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm.js'), 'utf8') + '; return wasm_bindgen;')();
    api.initSync({ module: fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm_bg.wasm')) });
    const runs = Array.from({ length: 6 }, () => measure(api, source));
    console.log(JSON.stringify({ runtime: process.version, platform: process.platform, arch: process.arch, includes: 'parse, exact, baseline sampling, control comparisons, serialization', runs }, null, 2));
    if (!runs.every(withinBudget)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { measure, withinBudget };
