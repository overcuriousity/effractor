const { test } = require("node:test");
const assert = require("node:assert");
const { fit, zoomAt, pan, LIMITS } = require("../assets/js/view.js");

test("fit centres the drawing and never magnifies past 1", () => {
  // Bigger than the viewport: scaled down to fit inside the padding.
  const v = fit({ width: 2000, height: 1000 }, { width: 1000, height: 600 }, 50);
  assert.equal(v.k, 0.45);
  assert.equal(v.x, 50);
  assert.equal(v.y, (600 - 1000 * 0.45) / 2);
  // Smaller: shown at its own size, centred.
  assert.deepEqual(fit({ width: 200, height: 100 }, { width: 1000, height: 600 }, 50), { k: 1, x: 400, y: 250 });
  // Nothing to fit, or nowhere to fit it, is the identity and not NaN.
  assert.deepEqual(fit({ width: 0, height: 0 }, { width: 1000, height: 600 }, 50), { k: 1, x: 500, y: 300 });
  assert.deepEqual(fit({ width: 100, height: 100 }, { width: 0, height: 0 }, 50), { k: 1, x: 0, y: 0 });
});

test("zooming keeps the point under the cursor where it is", () => {
  const before = { k: 1, x: 100, y: 50 };
  const after = zoomAt(before, { x: 300, y: 200 }, 2);
  assert.equal(after.k, 2);
  // The drawing point under the cursor: (300-100)/1 = 200 → 200*2 + x = 300.
  assert.equal(200 * after.k + after.x, 300);
  assert.equal(150 * after.k + after.y, 200);
});

test("zoom stops at its limits and stays put there", () => {
  let v = { k: 1, x: 0, y: 0 };
  for (let i = 0; i < 50; i++) v = zoomAt(v, { x: 10, y: 10 }, 2);
  assert.equal(v.k, LIMITS.max);
  const again = zoomAt(v, { x: 10, y: 10 }, 2);
  assert.deepEqual(again, v);
  for (let i = 0; i < 50; i++) v = zoomAt(v, { x: 10, y: 10 }, 0.5);
  assert.equal(v.k, LIMITS.min);
});

test("panning moves by screen pixels whatever the zoom", () => {
  assert.deepEqual(pan({ k: 3, x: 10, y: 20 }, 5, -5), { k: 3, x: 15, y: 15 });
});

const { menuAt } = require("../assets/js/view.js");

test("a menu opens against what opened it, at its real size", () => {
  const viewport = { width: 1000, height: 800 };
  const anchor = { left: 300, right: 400, top: 100 };
  // Room on the right: flush beside the anchor.
  assert.deepEqual(menuAt(anchor, { width: 200, height: 100 }, viewport), { x: 402, y: 100 });
  // No room on the right: flush on its left, whatever the menu's width.
  const right = { left: 850, right: 950, top: 100 };
  assert.deepEqual(menuAt(right, { width: 120, height: 100 }, viewport), { x: 728, y: 100 });
  assert.deepEqual(menuAt(right, { width: 300, height: 100 }, viewport), { x: 548, y: 100 });
  // Room on neither side: the side with more room, against the window's edge.
  assert.deepEqual(menuAt({ left: 150, right: 900, top: 0 }, { width: 300, height: 100 }, viewport), { x: 0, y: 0 });
  assert.deepEqual(menuAt({ left: 100, right: 850, top: 0 }, { width: 300, height: 100 }, viewport), { x: 700, y: 0 });
  // Too low: lifted just enough to fit.
  assert.deepEqual(menuAt({ left: 0, right: 10, top: 750 }, { width: 100, height: 200 }, viewport), { x: 12, y: 600 });
  // A point is an anchor of no width.
  assert.deepEqual(menuAt({ left: 500, right: 500, top: 10 }, { width: 100, height: 50 }, viewport), { x: 502, y: 10 });
});

const { revealShift } = require("../assets/js/view.js");

test("a node out of sight is brought just into view, on either axis", () => {
  const view = { k: 1, x: 0, y: 0 };
  const viewport = { width: 800, height: 600 };
  // In view: nothing moves.
  assert.deepEqual(revealShift({ x: 100, y: 100, width: 50, height: 40 }, view, viewport, 0, 16), { dx: 0, dy: 0 });
  // Under an inspector 300 wide at the right: left just enough.
  assert.deepEqual(revealShift({ x: 450, y: 100, width: 60, height: 40 }, view, viewport, 300, 16), { dx: -26, dy: 0 });
  // Off the left and above: right and down.
  assert.deepEqual(revealShift({ x: -200, y: -90, width: 60, height: 40 }, view, viewport, 0, 16), { dx: 216, dy: 106 });
  // Below: up.
  assert.deepEqual(revealShift({ x: 100, y: 700, width: 60, height: 40 }, view, viewport, 0, 16), { dx: 0, dy: -156 });
  // Scaled and panned: in screen pixels.
  assert.deepEqual(revealShift({ x: 1000, y: 0, width: 100, height: 40 }, { k: 0.5, x: 0, y: 20 }, viewport, 0, 16), { dx: 0, dy: 0 });
  // Wider than the room: its left edge shown.
  assert.deepEqual(revealShift({ x: 900, y: 100, width: 1000, height: 40 }, view, viewport, 0, 16), { dx: -884, dy: 0 });
});

test("a node wholly in sight against an edge is not moved to the margin", () => {
  assert.deepEqual(revealShift({ x: 0, y: 0, width: 50, height: 40 }, { k: 1, x: 0, y: 0 }, { width: 800, height: 600 }, 0, 16), { dx: 0, dy: 0 });
});
