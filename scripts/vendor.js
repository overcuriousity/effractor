#!/usr/bin/env node
// Copies the browser assets pinned in package.json into assets/vendor, which
// is committed and embedded into the binary. `--check` fails if that copy is
// not what the pinned packages contain — so a Dependabot bump cannot merge
// without the vendored files moving with it.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const font = (pkg, name, weight) => ({
  from: `@fontsource/${pkg}/files/${pkg}-latin-${weight}-normal.woff2`,
  to: `fonts/${name}-${weight}.woff2`,
});
const FILES = [
  // ELK runs in its own worker: the API shim on the page, the engine beside it.
  { from: "elkjs/lib/elk-api.js", to: "elk/elk-api.js" },
  { from: "elkjs/lib/elk-worker.min.js", to: "elk/elk-worker.min.js" },
  { from: "elkjs/LICENSE.md", to: "elk/LICENSE.md" },
  font("inter", "inter", 400),
  font("inter", "inter", 500),
  font("inter", "inter", 600),
  { from: "@fontsource/inter/LICENSE", to: "fonts/LICENSE-inter" },
  font("jetbrains-mono", "jetbrains-mono", 400),
  { from: "@fontsource/jetbrains-mono/LICENSE", to: "fonts/LICENSE-jetbrains-mono" },
];

const source = (f) => fs.readFileSync(path.join(ROOT, "node_modules", f.from));

function run(dest) {
  for (const f of FILES) {
    const target = path.join(dest, f.to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, source(f));
  }
}

function stale(dest) {
  return FILES.filter((f) => {
    const target = path.join(dest, f.to);
    return !fs.existsSync(target) || !fs.readFileSync(target).equals(source(f));
  }).map((f) => f.to);
}

module.exports = { FILES, run, stale };

if (require.main === module) {
  const dest = path.join(ROOT, "assets/vendor");
  if (process.argv.includes("--check")) {
    const bad = stale(dest);
    for (const f of bad) console.error(`assets/vendor/${f} is stale — run: npm run vendor`);
    process.exit(bad.length ? 1 : 0);
  }
  run(dest);
}
