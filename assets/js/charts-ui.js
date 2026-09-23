(function () {
  var app = window.effractor, data = window.effractorCharts, number = window.effractorResults.number;
  var graphs = window.effractorGraphResults;
  var NS = 'http://www.w3.org/2000/svg';
  function el(tag, text, className) {
    var e = document.createElement(tag); if (text != null) e.textContent = text; if (className) e.className = className; return e;
  }
  function svg(tag, attrs, text) {
    var e = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (key) { e.setAttribute(key, attrs[key]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function table(headers, rows) {
    var details = el('details', null, 'chart-table'), summary = el('summary', 'Table');
    var scroll = el('div', null, 'analysis-scroll'), t = el('table', null, 'analysis-table');
    var head = el('thead'), tr = el('tr');
    headers.forEach(function (h) { var th = el('th', h, 'num'); th.scope = 'col'; tr.appendChild(th); });
    head.appendChild(tr); t.appendChild(head);
    var body = el('tbody');
    rows.forEach(function (row) { var r = el('tr'); row.forEach(function (value) { r.appendChild(el('td', number(value), 'num')); }); body.appendChild(r); });
    t.appendChild(body); scroll.appendChild(t); details.append(summary, scroll); return details;
  }
  var positions = Object.create(null);
  function draw(kind, result) {
    var root = document.getElementById(kind + '-chart');
    var focused = root.contains(document.activeElement) ? document.activeElement.tagName.toLowerCase() : null;
    var open = root.querySelector('details'); open = open && open.open;
    root.replaceChildren();
    var cdf = kind === 'ttc';
    // A generated graph's target: one sampled curve, its rows as the solver
    // gave them — [t, P, lower, upper] — and never an exact part.
    var graph = cdf && graphs.isGraphResults(result);
    if (cdf) document.getElementById('ttc-title').textContent = graph || (app.state.doc && app.state.doc.profile === 'architecture') ? graphs.TITLE : 'Time to top event';
    var model = graph ? graphs.cdf(result.baseline.outcome) : cdf ? data.cdf(result) : data.loss(result);
    // Known by structure it is a solid line with no band; sampled, dashed in its band.
    var structural = graph && model.method === 'structural';
    var rows = graph ? model.rows.map(function (r) { return structural ? [r[0], r[1], null, null, null] : [r[0], null, r[1], r[2], r[3]]; }) : model.rows;
    if (!rows.length) {
      root.appendChild(el('p', graph ? 'Not available · ' + model.reason : model.reason, 'empty'));
      (model.missing || []).forEach(function (path) { root.appendChild(el('p', path, 'hint mono')); });
      return;
    }
    var max = cdf ? result.horizon : rows[rows.length - 1][0];
    var unit = cdf ? result.time_unit : result.currency;
    var title = graph ? 'P(target by time)' : cdf ? 'P(top ≤ time)' : 'P(loss ≥ amount)';
    var plot = svg('svg', { viewBox: '0 0 360 244', class: 'analysis-chart', role: 'img', tabindex: '0', 'aria-label': title + ' · Left/Right: values' });
    plot.appendChild(svg('title', {}, title));
    [0, .25, .5, .75, 1].forEach(function (v) {
      plot.appendChild(svg('line', { x1: 48, x2: 344, y1: data.y(v), y2: data.y(v), class: 'chart-grid' }));
      plot.appendChild(svg('text', { x: 42, y: data.y(v) + 3, 'text-anchor': 'end' }, number(v)));
    });
    [0, .5, 1].forEach(function (fraction) {
      plot.appendChild(svg('text', { x: data.x(max * fraction, max), y: 220, 'text-anchor': fraction === 1 ? 'end' : fraction === 0 ? 'start' : 'middle' }, number(max * fraction)));
    });
    plot.appendChild(svg('text', { x: 196, y: 239, 'text-anchor': 'middle' }, unit));
    if (cdf) {
      var band = rows.filter(function (r) { return r[3] !== null && r[4] !== null; });
      if (band.length) {
        var outline = band.map(function (r) { return [r[0], r[3]]; }).concat(band.slice().reverse().map(function (r) { return [r[0], r[4]]; }));
        plot.appendChild(svg('path', { d: data.line(outline, max) + ' Z', class: 'chart-band' }));
      }
      [1, 2].forEach(function (column) {
        plot.appendChild(svg('path', { d: data.line(rows.map(function (r) { return [r[0], r[column]]; }), max), class: column === 1 ? 'chart-line' : 'chart-line chart-sampled' }));
      });
      var pointwise = model.confidence === null ? '' : ' · ' + number(model.confidence * 100) + '% pointwise band';
      root.appendChild(el('p', graph ? graphs.cdfKey(model) : '— Exact · ┄ Sampled' + pointwise, 'hint chart-key'));
    } else {
      plot.appendChild(svg('path', { d: data.line(rows, max), class: 'chart-line' }));
      // A degenerate all-zero loss curve has one point, not a visible segment.
      if (rows.length === 1) plot.appendChild(svg('circle', { cx: data.x(rows[0][0], max), cy: data.y(rows[0][1]), r: 3, class: 'chart-dot' }));
    }
    var cross = svg('g', { class: 'chart-cross', visibility: 'hidden' });
    var vertical = svg('line', { y1: 32, y2: 204 }), horizontal = svg('line', { x1: 48, x2: 344 });
    cross.append(vertical, horizontal); plot.appendChild(cross);
    var tooltip = el('p', 'Left/Right: values', 'chart-tooltip num'); tooltip.setAttribute('aria-live', 'polite');
    var active = positions[kind] || 0;
    function inspect(index) {
      active = Math.max(0, Math.min(rows.length - 1, index));
      positions[kind] = active;
      var row = rows[active], value = cdf ? (row[1] === null ? row[2] : row[1]) : row[1];
      cross.setAttribute('visibility', 'visible');
      vertical.setAttribute('x1', data.x(row[0], max)); vertical.setAttribute('x2', data.x(row[0], max));
      horizontal.setAttribute('y1', data.y(value)); horizontal.setAttribute('y2', data.y(value));
      var interval = row[3] === null ? '' : ' [' + number(row[3]) + ', ' + number(row[4]) + ']';
      tooltip.textContent = number(row[0]) + ' ' + unit + (graph ? ' · P ' + number(row[2] === null ? row[1] : row[2]) + interval : cdf ? ' · exact ' + number(row[1]) + ' · sampled ' + number(row[2]) + interval : ' · P ≥ ' + number(row[1]));
    }
    plot.addEventListener('pointermove', function (e) {
      var point = plot.createSVGPoint(); point.x = e.clientX; point.y = e.clientY;
      var matrix = plot.getScreenCTM(); if (!matrix) return;
      var local = point.matrixTransform(matrix.inverse());
      inspect(data.nearest(rows, Math.max(0, Math.min(1, (local.x - 48) / 296)) * max));
    });
    plot.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); });
    plot.addEventListener('focus', function () { inspect(active); });
    plot.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation(); inspect(active + (e.key === 'ArrowRight' ? 1 : -1));
    });
    root.append(plot, tooltip);
    if (!cdf) {
      var stats = el('dl', null, 'chart-quantiles');
      model.percentiles.forEach(function (p) { stats.append(el('dt', p[0]), el('dd', app.format.money(p[1], unit), 'num')); });
      root.append(stats, el('p', 'At most one event per horizon', 'hint'));
    }
    var equivalent = graph
      ? table(['Time · ' + unit, 'Probability', 'Lower', 'Upper'], model.rows)
      : table(cdf ? [unit, 'Exact', 'Sampled', 'Lower', 'Upper'] : [unit, 'P(loss ≥)'], rows);
    equivalent.open = !!open; root.appendChild(equivalent);
    if (focused) (focused === "summary" ? equivalent.querySelector("summary") : plot).focus();
  }
  var last;
  app.onChange(function () {
    if (last === app.state.chartResults) return;
    last = app.state.chartResults; draw('ttc', last); draw('loss', last);
  });
})();
