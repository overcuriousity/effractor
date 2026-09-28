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

// Owner, 2026-09-28: the inspector is resized at its corner, never below a
// smallest size. It hangs at the canvas's top right, so its free corner is
// the bottom left: dragged left it widens, dragged down it grows.
test("the inspector's corner: left widens, down grows, within its limits and the canvas", () => {
  const { dragInspector, INSPECTOR } = require("../assets/js/workspace.js");
  const room = { width: 1000, height: 700 };
  const start = { width: 280, height: 300 };
  assert.deepEqual(dragInspector(start, -60, 40, room), { width: 340, height: 340 });
  assert.deepEqual(dragInspector(start, 30, -50, room), { width: 250, height: 250 });
  assert.deepEqual(dragInspector(start, 500, -500, room), { width: INSPECTOR.minWidth, height: INSPECTOR.minHeight });
  assert.deepEqual([INSPECTOR.minWidth, INSPECTOR.minHeight], [240, 120]);
  assert.deepEqual(dragInspector(start, -5000, 5000, room), { width: 984, height: 684 }, "8 px of canvas stay at each side");
  assert.deepEqual(dragInspector(start, -0.4, 0.6, room), { width: 280, height: 301 });
  assert.deepEqual(dragInspector(start, NaN, NaN, room), { width: 280, height: 300 });
  // A canvas smaller than the smallest size: the smallest size stands.
  assert.deepEqual(dragInspector(start, 0, 0, { width: 200, height: 100 }), { width: 240, height: 120 });
});

test("the inspector's size: the width it was given and automatic height, until dragged; junk is not kept", () => {
  const { inspectorSize } = require("../assets/js/workspace.js");
  assert.deepEqual(inspectorSize(null), { width: 280, height: null });
  assert.deepEqual(inspectorSize({ width: 360, height: 420 }), { width: 360, height: 420 });
  assert.deepEqual(inspectorSize({ width: 360 }), { width: 360, height: null }, "a height set back to automatic");
  assert.deepEqual(inspectorSize({ width: 360, height: null }), { width: 360, height: null });
  assert.deepEqual(inspectorSize({ width: 10, height: 10 }), { width: 240, height: 120 });
  assert.deepEqual(inspectorSize({ width: "wide", height: "tall" }), { width: 280, height: null });
  assert.deepEqual(inspectorSize({ width: 1e9, height: 1e9 }), { width: 4000, height: 4000 }, "the canvas bounds it when shown");
  assert.deepEqual(inspectorSize([1, 2]), { width: 280, height: null });
});
