// Pan, zoom, fit: the arithmetic of a view transform {k, x, y}, where a drawing
// point p is on screen at p * k + (x, y). Pure.
(function () {
  var LIMITS = { min: 0.1, max: 4 };

  // Centre the drawing in the viewport, scaled down if it must be — and never
  // up: a three-node tree blown up to fill the canvas helps nobody.
  function fit(drawing, viewport, padding) {
    var w = viewport.width - 2 * padding;
    var h = viewport.height - 2 * padding;
    if (!(w > 0 && h > 0)) return { k: 1, x: 0, y: 0 };
    var k = 1;
    if (drawing.width > 0 && drawing.height > 0) {
      k = Math.max(LIMITS.min, Math.min(1, w / drawing.width, h / drawing.height));
    }
    return { k: k, x: (viewport.width - drawing.width * k) / 2, y: (viewport.height - drawing.height * k) / 2 };
  }

  function zoomAt(view, point, factor) {
    var k = Math.max(LIMITS.min, Math.min(LIMITS.max, view.k * factor));
    if (k === view.k) return view;
    var ratio = k / view.k;
    return { k: k, x: point.x - (point.x - view.x) * ratio, y: point.y - (point.y - view.y) * ratio };
  }

  function pan(view, dx, dy) {
    return { k: view.k, x: view.x + dx, y: view.y + dy };
  }

  // Where a menu of `size` opens beside `anchor` ({left, right, top}; a point
  // has left = right): 2px right of it if it fits, else 2px left of it, else
  // on the side with more room, against the window's edge; lifted if it
  // would run off the bottom.
  function menuAt(anchor, size, viewport) {
    var right = anchor.right + 2;
    var left = anchor.left - 2 - size.width;
    var x;
    if (right + size.width <= viewport.width) x = right;
    else if (left >= 0) x = left;
    else x = viewport.width - anchor.right >= anchor.left ? right : left;
    x = Math.max(0, Math.min(x, viewport.width - size.width));
    var y = Math.max(0, Math.min(anchor.top, viewport.height - size.height));
    return { x: x, y: y };
  }

  var api = { fit: fit, zoomAt: zoomAt, pan: pan, menuAt: menuAt, LIMITS: LIMITS };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorView = api;
})();
