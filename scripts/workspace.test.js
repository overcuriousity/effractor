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

// Nothing is shown unless asked for: a first visit has both panels closed,
// and what a visitor last set on this origin wins after that.
test("a first visit opens no panel; a saved layout is kept, junk is not", () => {
  const { initialState } = require("../assets/js/workspace.js");
  assert.deepEqual(initialState({}), { left: 220, right: 264, leftOpen: false, rightOpen: false });
  assert.deepEqual(initialState({ leftOpen: true, right: 300 }), { left: 220, right: 300, leftOpen: true, rightOpen: false });
  assert.deepEqual(initialState({ leftOpen: "yes", left: "wide" }), { left: 220, right: 264, leftOpen: false, rightOpen: false });
});

test("review: a panel the page opened is not saved as the visitor's choice", () => {
  const { saved } = require("../assets/js/workspace.js");
  const shown = { left: 240, right: 300, leftOpen: true, rightOpen: true };
  assert.deepEqual(saved(shown, { right: true }), { left: 240, right: 300, leftOpen: true, rightOpen: false });
  assert.deepEqual(saved(shown, {}), shown);
});
