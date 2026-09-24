#!/usr/bin/env node
// The token file makes contrast claims in its comments. This is what makes
// them true: a token edit that breaks AA fails the build.
const fs = require("node:fs");

const lin = (c) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = (hex) => {
  const [r, g, b] = rgb(hex).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
// OKLab L — perceptual lightness, which is what "monotone" has to mean here.
function lightness(hex) {
  const [r, g, b] = rgb(hex).map(lin);
  return (
    0.2104542553 * Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b) +
    0.793617785 * Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b) -
    0.0040720468 * Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  );
}

// The file has exactly three declaration blocks that matter, in this order:
// bare :root (light), the media-query dark block, the [data-theme="dark"] one.
function blocks(css) {
  const found = [...css.matchAll(/:root[^{]*\{([^}]*)\}/g)].map((m) => {
    const tokens = {};
    for (const d of m[1].matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)) tokens[d[1]] = d[2];
    return tokens;
  });
  if (found.length !== 3) throw new Error(`expected 3 :root blocks, found ${found.length}`);
  return { light: found[0], darkMedia: found[1], darkAttr: found[2] };
}

const STEPS = [1, 2, 3, 4, 5];
const TEXT = [
  ["--color-fg-primary", "--color-bg-base"],
  ["--color-fg-secondary", "--color-bg-surface"],
  ["--color-fg-muted", "--color-bg-base"],
  ["--color-fg-muted", "--color-bg-surface"],
  ["--color-fg-muted", "--color-bg-elevated"],
  ...STEPS.map((n) => [`--viz-imp-${n}-ink`, `--viz-imp-${n}`]),
];
const FAMILIES = ["network", "compute", "identity", "data"];
const GRAPHIC = [
  ["--viz-outline", "--viz-canvas"],
  ...FAMILIES.map((f) => [`--viz-family-${f}`, "--viz-canvas"]),
  ...FAMILIES.map((f) => ["--viz-family-ink", `--viz-family-${f}`]),
];

function checkTheme(name, t) {
  const errors = [];
  const need = (pairs, min) => {
    for (const [fg, bg] of pairs) {
      if (!t[fg] || !t[bg]) errors.push(`${name}: ${!t[fg] ? fg : bg} is not defined`);
      else if (contrast(t[fg], t[bg]) < min)
        errors.push(`${name}: ${fg} on ${bg} is ${contrast(t[fg], t[bg]).toFixed(2)}, needs ${min}`);
    }
  };
  need(TEXT, 4.5);
  need(GRAPHIC, 3);
  const ls = STEPS.map((n) => t[`--viz-imp-${n}`]).filter(Boolean).map(lightness);
  // Anchored to the canvas: step 1 is nearest it, so the direction follows.
  const dir = Math.sign(ls[ls.length - 1] - ls[0]);
  if (ls.length === STEPS.length && !ls.every((l, i) => i === 0 || Math.sign(l - ls[i - 1]) === dir))
    errors.push(`${name}: ramp lightness is not strictly monotone`);
  return errors;
}

function check(css) {
  const { light, darkMedia, darkAttr } = blocks(css);
  const errors = [...checkTheme("light", light), ...checkTheme("dark", darkAttr)];
  for (const k of new Set([...Object.keys(darkMedia), ...Object.keys(darkAttr)]))
    if (darkMedia[k] !== darkAttr[k]) errors.push(`dark blocks differ: ${k}`);
  return errors;
}

module.exports = { check, contrast };

if (require.main === module) {
  const file = process.argv[2] ?? "assets/css/00-tokens.css";
  const errors = check(fs.readFileSync(file, "utf8"));
  for (const e of errors) console.error(`${file}: ${e}`);
  process.exit(errors.length ? 1 : 0);
}
