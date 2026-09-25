const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { check, contrast } = require("./check-contrast.js");

const css = fs.readFileSync(path.join(__dirname, "../assets/css/00-tokens.css"), "utf8");

test("contrast() matches WCAG reference values", () => {
  assert.equal(contrast("#000000", "#ffffff").toFixed(2), "21.00");
  assert.equal(contrast("#767676", "#ffffff").toFixed(2), "4.54");
});
test("the shipped tokens pass", () => assert.deepStrictEqual(check(css), []));
test("a label ink under 4.5:1 fails", () => {
  const broken = css.replace("--viz-imp-3-ink: #2d2d2d", "--viz-imp-3-ink: #ffffff");
  assert.match(check(broken).join("\n"), /light: --viz-imp-3-ink on --viz-imp-3 is \d\.\d\d, needs 4\.5/);
});
test("an outline under 3:1 against the canvas fails", () => {
  const broken = css.replace("--viz-outline: #6c6c65", "--viz-outline: #d0ccc0");
  assert.match(check(broken).join("\n"), /light: --viz-outline on --viz-canvas is \d\.\d\d, needs 3/);
});
test("the accent on a selected row is held to 4.5:1", () => {
  const broken = css.replace("--color-accent: #366687", "--color-accent: #386889");
  assert.match(check(broken).join("\n"), /light: --color-accent on --color-bg-active is 4\.4\d, needs 4\.5/);
});
test("a ramp that is not monotone in lightness fails", () => {
  const broken = css.replace("--viz-imp-2: #f7afa6", "--viz-imp-2: #fff0ee");
  assert.match(check(broken).join("\n"), /light: ramp lightness is not strictly monotone/);
});
test("the two dark blocks must not drift apart", () => {
  const i = css.lastIndexOf("--viz-imp-5: #fdb6ad");
  const broken = css.slice(0, i) + "--viz-imp-5: #fdb6ae" + css.slice(i + 20);
  assert.match(check(broken).join("\n"), /dark blocks differ: --viz-imp-5/);
});
test("a component family under 3:1 against the canvas fails", () => {
  const broken = css.replace("--viz-family-compute: #2f7667", "--viz-family-compute: #d8e8e2");
  assert.match(check(broken).join("\n"), /light: --viz-family-compute on --viz-canvas is \d\.\d\d, needs 3/);
});
