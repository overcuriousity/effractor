// Native and browser wasm give the same answers for generated graphs: the
// same calls, the same text, compared line by line. Run after
// scripts/build-wasm.sh. Model text goes through files and argument arrays,
// never through a shell.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const lecture = fs.readFileSync(path.join(root, 'docs/course/lecture-architecture.yaml'), 'utf8');
const unknown = fs.readFileSync(
  path.join(root, 'crates/effractor-components/tests/fixtures/lecture-unknown.yaml'),
  'utf8',
);
const cloud = fs.readFileSync(
  path.join(root, 'assets/examples/17-cloud-support-agent-architecture.yaml'),
  'utf8',
);
const nextcloud = fs.readFileSync(
  path.join(root, 'assets/examples/18-self-hosted-nextcloud-architecture.yaml'),
  'utf8',
);

// Past JavaScript's exact integers, so the seed has to travel as text.
const LARGE_SEED = '18446744073709551557';

const CASES = [
  { name: 'baseline', text: lecture, scenario: '' },
  { name: 'patch', text: lecture, scenario: 'patch' },
  { name: 'deny', text: lecture, scenario: 'deny' },
  { name: 'unknown', text: unknown, scenario: '' },
  {
    // Finite, slower defences and a short horizon: a paired interval with width.
    name: 'slower both',
    text: lecture
      .replace('horizon: 100', 'horizon: 10')
      .replace(/ttc: "Never"\n(\s+note: "Exercise assumption: perfect blocking)/g, 'ttc: "Exponential(mean 200)"\n$1'),
    scenario: 'both',
  },
  { name: 'large seed', text: lecture.replace('seed: 42', 'seed: ' + LARGE_SEED), scenario: 'both' },
  { name: 'cloud baseline', text: cloud, scenario: '' },
  { name: 'cloud encrypt', text: cloud, scenario: 'encrypt' },
  { name: 'nextcloud baseline', text: nextcloud, scenario: '' },
  { name: 'nextcloud patch-nextcloud', text: nextcloud, scenario: 'patch-nextcloud' },
];

// The browser module's answers, in the order the native example prints them.
function browserLines(api, text, scenario) {
  const lines = [api.parse(text), api.generate(text, 'agreement')];
  const begun = api.solve_graph_begin(text, scenario, 'agreement');
  lines.push(begun);
  const reply = JSON.parse(begun);
  const total = reply.ok ? reply.ok.progress.total : 0;
  for (let i = 0; i < total; i++) lines.push(api.solve_step());
  lines.push(api.solve_finish());
  return lines;
}

function nativeLines(binary, file, scenario) {
  const out = execFileSync(binary, scenario ? [file, scenario] : [file], { encoding: 'utf8', maxBuffer: 1 << 28 });
  return out.replace(/\n$/, '').split('\n');
}

function firstDifference(a, b) {
  if (a.length !== b.length) return 'line count ' + a.length + ' vs ' + b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) {
      let c = 0;
      while (a[i][c] === b[i][c]) c++;
      return 'line ' + (i + 1) + ', column ' + (c + 1) + ': ' + a[i].slice(c, c + 60) + ' | ' + b[i].slice(c, c + 60);
    }
  }
  return null;
}

if (require.main === module) {
  try {
    execFileSync('cargo', ['build', '--quiet', '--locked', '-p', 'effractor-wasm', '--example', 'graph-agreement'], {
      cwd: root,
      stdio: 'inherit',
    });
    const target = process.env.CARGO_TARGET_DIR || path.join(root, 'target');
    const binary = path.join(target, 'debug', 'examples', 'graph-agreement');
    const api = new Function(fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm.js'), 'utf8') + '; return wasm_bindgen;')();
    api.initSync({ module: fs.readFileSync(path.join(root, 'assets/wasm/effractor_wasm_bg.wasm')) });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'effractor-agreement-'));
    let failed = false;
    try {
      CASES.forEach(function (c, i) {
        const file = path.join(dir, i + '.yaml');
        fs.writeFileSync(file, c.text);
        const start = performance.now();
        const browser = browserLines(api, c.text, c.scenario);
        const ms = performance.now() - start;
        const difference = firstDifference(nativeLines(binary, file, c.scenario), browser);
        const result = JSON.parse(browser[browser.length - 1]).ok;
        if (!result) throw new Error(c.name + ': no result');
        if (c.name === 'large seed' && result.result.seed !== LARGE_SEED) throw new Error('large seed: seed came back as ' + result.result.seed);
        console.log((difference ? 'DIFFERS ' : 'same    ') + c.name + ' (' + browser.length + ' answers, browser ' + ms.toFixed(0) + ' ms)');
        if (difference) {
          console.log('  ' + difference);
          failed = true;
        }
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    // The page's tests read graphs and results exported from this module.
    require('./graph-fixtures.js').stale(api).forEach(function (name) {
      console.log('STALE   fixture ' + name + ': node scripts/graph-fixtures.js --write');
      failed = true;
    });
    if (failed) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { firstDifference, CASES };
