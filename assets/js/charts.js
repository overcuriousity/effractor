// Solver grids in, chart/table data out. No model semantics live here.
(function () {
  function available(result, name) { return result && result[name] && result[name].available; }
  function cdf(result) {
    var exact = available(result, 'exact'), sampled = available(result, 'sampled');
    var grid = new Map();
    (exact ? exact.ttc_cdf : []).forEach(function (p) { grid.set(p[0], [p[0], p[1], null, null, null]); });
    (sampled ? sampled.ttc_cdf : []).forEach(function (p) {
      var row = grid.get(p[0]) || [p[0], null, null, null, null];
      row.splice(2, 3, p[1], p[2], p[3]); grid.set(p[0], row);
    });
    return { rows: Array.from(grid.values()).sort(function (a, b) { return a[0] - b[0]; }), confidence: sampled ? sampled.confidence : null,
      reason: result && result.exact && result.exact.unavailable ? result.exact.unavailable.reason : 'Solve to plot' };
  }
  function loss(result) {
    var sampled = available(result, 'sampled'), value = sampled && sampled.loss;
    return { rows: value ? value.exceedance : [], percentiles: value ? ['p50', 'p90', 'p95', 'p99'].map(function (key) { return [key, value[key]]; }) : [],
      reason: sampled ? 'No assets' : (result && result.sampled && result.sampled.unavailable ? result.sampled.unavailable.reason : 'Solve to plot') };
  }
  function x(value, max) { return 48 + (max > 0 ? value / max : 0) * 296; }
  function y(value) { return 204 - value * 172; }
  function line(points, max) {
    var pen = false;
    return points.map(function (p) {
      if (!Number.isFinite(p[0]) || !Number.isFinite(p[1])) { pen = false; return ''; }
      var command = (pen ? 'L' : 'M') + x(p[0], max) + ',' + y(p[1]); pen = true; return command;
    }).filter(Boolean).join(' ');
  }
  function nearest(rows, value) {
    var best = -1, distance = Infinity;
    rows.forEach(function (row, i) { var d = Math.abs(row[0] - value); if (d < distance) { best = i; distance = d; } });
    return best;
  }
  function exactSnapshot(begun, doc) {
    return { exact: begun.exact, horizon: doc.horizon, time_unit: doc.time_unit, currency: doc.currency };
  }
  var api = { exactSnapshot: exactSnapshot, cdf: cdf, loss: loss, line: line, nearest: nearest, x: x, y: y };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorCharts = api;
})();
