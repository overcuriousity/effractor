// The generated graph and graph results the page's pure modules are tested
// on, exported from the real wasm module — never written by hand, so no JS
// model of the generator grows beside the Rust one. The agreement check
// (check-graph-agreement.js) regenerates them and fails if one is stale.
//
//   node scripts/graph-fixtures.js --write    after scripts/build-wasm.sh
//
// --write also rewrites the component catalog and the lecture's JSON image in
// scripts/fixtures/, which Rust tests pin to the real module the same way.
const fs = require('node:fs');
const path = require('node:path');
const { loadWasm } = require('./wasm.js');

const root = path.resolve(__dirname, '..');
const DIR = path.join(root, 'scripts/fixtures/graph');
const lecture = fs.readFileSync(path.join(root, 'docs/course/lecture-architecture.yaml'), 'utf8');
const unknown = fs.readFileSync(
  path.join(root, 'crates/effractor-components/tests/fixtures/lecture-unknown.yaml'),
  'utf8',
);

function replaced(text, from, to) {
  if (!text.includes(from)) throw new Error('fixture source changed: ' + from);
  return text.replace(from, to);
}

// A result: every chunk solved, the finish answer's `ok`.
function solved(api, text, scenario) {
  const begun = JSON.parse(api.solve_graph_begin(text, scenario || '', 'fixture'));
  if (!begun.ok) throw new Error('not begun: ' + JSON.stringify(begun.diagnostics));
  for (let i = 0; i < begun.ok.progress.total; i++) api.solve_step();
  const done = JSON.parse(api.solve_finish());
  if (!done.ok) throw new Error('not finished: ' + JSON.stringify(done.diagnostics));
  return done.ok.result;
}

function build(api) {
  const generated = JSON.parse(api.generate(lecture, 'fixture'));
  if (!generated.ok) throw new Error('lecture not generated: ' + JSON.stringify(generated.diagnostics));
  return {
    'lecture-doc': JSON.parse(api.parse(lecture)).ok,
    'lecture-graph': { graph: generated.ok.graph, support: generated.ok.support },
    'results-available': solved(api, lecture),
    'results-unreachable': solved(api, replaced(lecture, '    to: ssh\n    allowed: true', '    to: ssh\n    allowed: false')),
    'results-seeded': solved(api, replaced(lecture, 'target: {entity: server, state: admin}', 'target: {entity: workstation, state: admin}')),
    'results-unknown': solved(api, unknown),
    'results-patch': solved(api, lecture, 'patch'),
    'results-deny': solved(api, lecture, 'deny'),
    'results-deny-one': solved(api, replaced(lecture, '  samples: 10000\n', '  samples: 1\n'), 'deny'),
    'results-fast': solved(
      api,
      replaced(
        replaced(lecture, 'horizon: 100\n', 'horizon: 5\n'),
        '  deny:\n',
        '  fast:\n    label: Twice as fast\n    attacker: {speed: 2}\n    changes: []\n  deny:\n',
      ),
      'fast',
    ),
    'results-scenario-unknown': solved(
      api,
      replaced(lecture, '  deny:\n', '  doubt:\n    label: Patch state unknown\n    changes:\n      - {entity: openssh, defense: patched, value: unknown}\n  deny:\n'),
      'doubt',
    ),
  };
}

function text(value) {
  return JSON.stringify(value, null, 1) + '\n';
}

// The fixtures that differ from what the module says now, by name.
function stale(api) {
  const now = build(api);
  return Object.keys(now).filter(function (name) {
    const file = path.join(DIR, name + '.json');
    return !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text(now[name]);
  });
}

if (require.main === module) {
  const api = loadWasm();
  if (process.argv.includes('--write')) {
    fs.mkdirSync(DIR, { recursive: true });
    const all = build(api);
    Object.keys(all).forEach(function (name) {
      fs.writeFileSync(path.join(DIR, name + '.json'), text(all[name]));
    });
    console.log('wrote ' + Object.keys(all).length + ' fixtures to ' + path.relative(root, DIR));
    const answer = function (json) {
      const out = JSON.parse(json);
      if (!out.ok) throw new Error(JSON.stringify(out.diagnostics));
      return out.ok;
    };
    const fixtures = path.join(root, 'scripts/fixtures');
    fs.writeFileSync(path.join(fixtures, 'catalog.json'), JSON.stringify(answer(api.component_catalog()), null, 2) + '\n');
    fs.writeFileSync(path.join(fixtures, 'architecture.doc.json'), JSON.stringify(answer(api.parse(lecture)), null, 2) + '\n');
    console.log('wrote catalog.json and architecture.doc.json to ' + path.relative(root, fixtures));
  } else {
    const names = stale(api);
    names.forEach(function (name) {
      console.log('stale fixture ' + name + ': node scripts/graph-fixtures.js --write');
    });
    if (names.length) process.exitCode = 1;
  }
}

module.exports = { build, stale, loadApi: loadWasm };
