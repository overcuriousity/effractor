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

  var api = { fit: fit, zoomAt: zoomAt, pan: pan, LIMITS: LIMITS };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorView = api;
})();
