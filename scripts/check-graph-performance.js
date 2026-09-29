// What generating and sampling the course's architecture costs in the
// browser's wasm module, under node. Run after scripts/build-wasm.sh.
//
//   node scripts/check-graph-performance.js [file.yaml] [scenario]
//
// The baseline and one scenario are measured apart, each as one cold run and
// five warm ones, so the comparison's work is not hidden in the baseline's.
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const BUDGET_MS = 1000;
const SAMPLES = 10000;

function ok(text) {
  const reply = JSON.parse(text);
  if (!reply.ok) throw new Error((reply.diagnostics || []).map(d => d.message).join('; ') || 'no answer');
  return reply.ok;
}

function measure(api, source, scenario, now = () => performance.now()) {
  const start = now();
  const graph = ok(api.generate(source, 'performance')).graph;
  const generated = now();
  let progress = ok(api.solve_graph_begin(source, scenario || '', 'performance')).progress;
  while (progress.done < progress.total) {
    const next = ok(api.solve_step());
    if (next.done <= progress.done || next.total !== progress.total || next.done > next.total) throw new Error('invalid sampling progress');
    progress = next;
  }
  const result = ok(api.solve_finish()).result;
  const solved = now();
  return {
    scenario: scenario || null,
    generate_ms: generated - start,
    solve_ms: solved - generated,
    nodes: graph.nodes.length,
    edges: graph.nodes.reduce((n, node) => n + node.inputs.length, 0),
    samples: result.samples,
    library: graph.library.id + ' ' + graph.library.version,
    semantics: graph.semantics,
  };
}

// Why a run is outside the budget, or null.
function reason(run) {
  if (run.samples !== SAMPLES) return run.samples + ' samples, the budget is for ' + SAMPLES;
  const ms = run.generate_ms + run.solve_ms;
  return ms < BUDGET_MS ? null : ms + ' ms, the budget is ' + BUDGET_MS;
}

function withinBudget(run) {
  return reason(run) === null;
}

function range(runs, key) {
  const values = runs.map(r => r[key]);
  return [Math.min(...values), Math.max(...values)];
}

function summary(runs) {
  const warm = runs.slice(1);
  return {
    cold: { generate_ms: runs[0].generate_ms, solve_ms: runs[0].solve_ms },
    warm: { runs: warm.length, generate_ms: range(warm, 'generate_ms'), solve_ms: range(warm, 'solve_ms') },
  };
}

if (require.main === module) {
  try {
    const root = path.resolve(__dirname, '..');
    const file = process.argv[2] || path.join(root, 'docs/course/lecture-architecture.yaml');
    const source = fs.readFileSync(file, 'utf8');
    const wasm = path.join(root, 'assets/wasm');
    const cases = ['', process.argv[3] || 'both'].map(scenario => {
      // A module of its own, so the first run of each is a cold one. Loading
      // and instantiating it is not timed.
      const api = require('./wasm.js').loadWasm();
      const runs = Array.from({ length: 6 }, () => measure(api, source, scenario));
      new Set(runs.map(reason).filter(Boolean)).forEach(why => console.error((scenario || 'baseline') + ': ' + why));
      const { nodes, edges, samples, library, semantics } = runs[0];
      return Object.assign({ scenario: scenario || 'baseline', nodes, edges, samples, library, semantics, within_budget: runs.every(withinBudget) }, summary(runs));
    });
    console.log(JSON.stringify({
      file: path.relative(root, file),
      runtime: process.version,
      platform: process.platform,
      arch: process.arch,
      bundle_bytes: { wasm: fs.statSync(path.join(wasm, 'effractor_wasm_bg.wasm')).size, js: fs.statSync(path.join(wasm, 'effractor_wasm.js')).size },
      budget_ms: BUDGET_MS,
      includes: 'generate: parse, validation, generation, serialization; solve: parse, generation, sampling, the comparison, serialization',
      cases,
    }, (key, value) => (typeof value === 'number' && !Number.isInteger(value) ? Math.round(value * 100) / 100 : value), 2));
    if (!cases.every(c => c.within_budget)) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { measure, reason, withinBudget, summary };
