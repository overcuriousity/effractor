const { test } = require("node:test");
const assert = require("node:assert");
const { clampWidth, nextWidth, LIMITS } = require("../assets/js/workspace.js");

test("panel widths are clamped to their limits", () => {
  assert.equal(clampWidth(50), LIMITS.min);
  assert.equal(clampWidth(9999), LIMITS.max);
  assert.equal(clampWidth(300.6), 301);
  assert.equal(clampWidth(NaN), LIMITS.min);
});
test("dragging the left grip right widens the left panel; the right grip mirrors it", () => {
  assert.equal(nextWidth("left", 220, 30), 250);
  assert.equal(nextWidth("right", 264, 30), 234);
});
test("arrow keys resize in the direction they point", () => {
  assert.equal(nextWidth("left", 220, 16), 236);
  assert.equal(nextWidth("right", 264, -16), 280);
});
