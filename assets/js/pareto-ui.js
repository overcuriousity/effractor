(function () {
  var app = window.effractor, data = window.effractorPareto, number = window.effractorResults.number, probability = window.effractorResults.probability;
  var $ = function (id) { return document.getElementById(id); };
  var root = $('pareto-view'), axis = { x: 'cost', y: 'time' }, sort = 'cost', descending = false, selected = null, last;
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function svg(tag, attrs, text) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(attrs).forEach(function (key) { e.setAttribute(key, attrs[key]); }); if (text != null) e.textContent = text; return e; }
  function label(id) { return app.state.doc.nodes[id] ? app.state.doc.nodes[id].label : id; }
  var TIME_HELP = 'Average completion time, assuming all steps succeed.';
  function timeUnit(result) { return ({ h: 'hours', d: 'days', y: 'years' })[result.time_unit] || result.time_unit; }
  // Cost and time are amounts; detection and success, probabilities.
  function amount(row, key) { return row[key] === null ? '∞' : key === 'detection' || key === 'success' ? probability(row[key]) : number(row[key]); }
  function select(index) {
    selected = selected === index ? null : index;
    var row = data.all(app.state.results).find(function (r) { return r.index === selected; });
    app.renderer.highlight(row ? data.path(app.state.doc, row.leaves) : [], 'pareto'); mark();
  }
  function mark() {
    var attacks = data.all(app.state.results);
    root.querySelectorAll('[data-attack]').forEach(function (element) {
      var index = Number(element.dataset.attack), row = attacks[index];
      element.classList.toggle('is-active', index === selected);
      element.classList.toggle('has-selected', !!row && row.leaves.indexOf(app.state.selected) >= 0);
      if (element.tagName === 'BUTTON') element.setAttribute('aria-pressed', String(index === selected));
    });
  }
  function scatter(result) {
    var section = el('section', null, 'pareto-scatter'), pickers = el('div', null, 'pareto-axes');
    var units = { cost: result.currency, time: timeUnit(result), detection: 'probability' };
    var titles = { cost: 'Cost', time: 'Mean time', detection: 'Detection' };
    ['x', 'y'].forEach(function (which) {
      var picker = window.effractorMenu.dropdown(['cost', 'time', 'detection'].map(function (k) { return [k, titles[k] + ' · ' + units[k]]; }), axis[which]);
      picker.id = 'pareto-axis-' + which; picker.setAttribute('aria-label', which.toUpperCase() + ' axis');
      picker.addEventListener('change', function () { axis = data.axes(axis, which, picker.value); render(); $('pareto-axis-' + which).focus(); });
      pickers.append(el('span', which.toUpperCase()), picker);
    });
    section.appendChild(pickers);
    var points = data.points(result, axis.x, axis.y), all = data.all(result);
    if (!points.length) { section.appendChild(el('p', 'No finite points on these axes', 'empty')); return section; }
    var maxX = 0, maxY = 0;
    points.forEach(function (p) { maxX = Math.max(maxX, p[axis.x]); maxY = Math.max(maxY, p[axis.y]); });
    var x = function (v) { return 48 + (maxX > 0 ? v / maxX : 0) * 296; };
    var y = function (v) { return 204 - (maxY > 0 ? v / maxY : 0) * 172; };
    var plot = svg('svg', { viewBox: '0 0 360 250', class: 'analysis-chart', role: 'img', tabindex: '0', 'aria-label': titles[axis.x] + ' versus ' + titles[axis.y] + '; arrows inspect, Enter selects' });
    [0, .5, 1].forEach(function (f) {
      plot.appendChild(svg('line', { x1: 48, x2: 344, y1: y(maxY * f), y2: y(maxY * f), class: 'chart-grid' }));
      plot.appendChild(svg('text', { x: 42, y: y(maxY * f) + 3, 'text-anchor': 'end' }, number(maxY * f)));
      plot.appendChild(svg('text', { x: x(maxX * f), y: 219, 'text-anchor': f === 1 ? 'end' : f === 0 ? 'start' : 'middle' }, number(maxX * f)));
    });
    plot.appendChild(svg('text', { x: 48, y: 16 }, titles[axis.y] + ' · ' + units[axis.y]));
    plot.appendChild(svg('text', { x: 196, y: 241, 'text-anchor': 'middle' }, titles[axis.x] + ' · ' + units[axis.x]));
    var tooltip = el('p', '◇ Front · · Dominated', 'chart-tooltip'); tooltip.setAttribute('aria-live', 'polite');
    var cross = svg('g', { class: 'chart-cross', visibility: 'hidden' });
    var vertical = svg('line', { y1: 32, y2: 204 }), horizontal = svg('line', { x1: 48, x2: 344 }); cross.append(vertical, horizontal);
    var active = 0;
    function inspect(i) {
      active = (i + points.length) % points.length; var r = points[active];
      tooltip.textContent = r.leaves.map(label).join(' · ') + ' — cost ' + amount(r, 'cost') + ' ' + result.currency + ' · mean time ' + amount(r, 'time') + ' ' + timeUnit(result) + ' · detection ' + amount(r, 'detection') + ' · success ' + amount(r, 'success');
      vertical.setAttribute('x1', x(r[axis.x])); vertical.setAttribute('x2', x(r[axis.x]));
      horizontal.setAttribute('y1', y(r[axis.y])); horizontal.setAttribute('y2', y(r[axis.y])); cross.setAttribute('visibility', 'visible');
    }
    // Dominated dots first so the front stays selectable when points coincide.
    points.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) { return Number(a.r.on_front) - Number(b.r.on_front); }).forEach(function (entry) {
      var r = entry.r, px = x(r[axis.x]), py = y(r[axis.y]);
      var point = r.on_front ? svg('path', { d: 'M' + px + ',' + (py - 4) + 'l4,4 -4,4 -4,-4 Z' }) : svg('circle', { cx: px, cy: py, r: 2.5 });
      point.setAttribute('class', r.on_front ? 'pareto-point front' : 'pareto-point dominated'); point.dataset.attack = r.index;
      point.addEventListener('pointerenter', function () { inspect(entry.i); });
      point.addEventListener('click', function () { inspect(entry.i); select(r.index); }); plot.appendChild(point);
    });
    plot.appendChild(cross);
    plot.addEventListener('pointerleave', function () { cross.setAttribute('visibility', 'hidden'); });
    plot.addEventListener('focus', function () { inspect(active); });
    plot.addEventListener('keydown', function (e) {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' '].indexOf(e.key) < 0) return;
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Enter' || e.key === ' ') select(points[active].index);
      else inspect(active + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1));
    });
    section.append(plot, tooltip, el('p', '◇ Front · · Dominated' + (all.length > points.length ? ' · ' + (all.length - points.length) + ' nonfinite omitted' : ''), 'hint'));
    return section;
  }
  function render() {
    root.replaceChildren();
    var result = app.state.results, a = result && result.attacker && result.attacker.available;
    if (!a) { root.appendChild(el('p', result && result.attacker && result.attacker.unavailable ? result.attacker.unavailable.reason : 'Calculate to compare paths', 'empty')); return; }
    var rows = data.rows(result, sort, descending, label);
    if (!rows.length) { root.appendChild(el('p', 'No attack paths', 'empty')); return; }
    var scroll = el('div', null, 'analysis-scroll'), table = el('table', null, 'analysis-table pareto-table'), head = el('thead'), header = el('tr');
    var headings = [['leaves', 'Path'], ['cost', 'Cost · ' + result.currency], ['time', 'Mean time (' + timeUnit(result) + ')'], ['detection', 'Detection'], ['success', 'Success']];
    headings.forEach(function (h) {
      var th = el('th', null, h[0] === 'leaves' ? '' : 'num'); th.scope = 'col';
      th.setAttribute('aria-sort', sort === h[0] ? descending ? 'descending' : 'ascending' : 'none');
      var button = el('button', h[1], 'pareto-sort'); button.type = 'button'; button.id = 'pareto-sort-' + h[0];
      if (h[0] === 'time') button.title = TIME_HELP;
      button.addEventListener('click', function () { descending = sort === h[0] ? !descending : false; sort = h[0]; render(); $('pareto-sort-' + h[0]).focus(); });
      th.appendChild(button); header.appendChild(th);
    });
    head.appendChild(header); table.appendChild(head);
    var body = el('tbody');
    rows.forEach(function (r) {
      var tr = el('tr'); tr.dataset.attack = r.index; if (r.cheapest) tr.classList.add('cheapest');
      var cell = el('td'), button = el('button', r.leaves.map(label).join(' · '), 'pareto-path');
      button.type = 'button'; button.dataset.attack = r.index; button.addEventListener('click', function () { select(r.index); }); cell.appendChild(button);
      if (r.cheapest) {
        var pinned = el('span', 'Cheapest · pinned', 'pareto-cheapest');
        pinned.title = 'Remains first when sorting'; cell.appendChild(pinned);
      }
      tr.appendChild(cell); ['cost', 'time', 'detection', 'success'].forEach(function (key) { tr.appendChild(el('td', amount(r, key), 'num')); }); body.appendChild(tr);
    });
    table.appendChild(body); scroll.appendChild(table); root.appendChild(scroll);
    root.appendChild(el('p', TIME_HELP, 'hint'));
    if (a.assumed_free.length || a.assumed_unnoticed.length) root.appendChild(el('p', 'Missing attributes count as zero: ' + a.assumed_free.length + ' cost · ' + a.assumed_unnoticed.length + ' detection', 'hint'));
    var cuts = result.cut_sets && result.cut_sets.available;
    if (cuts && cuts.truncated) root.appendChild(el('p', 'Partial paths · ' + cuts.truncated, 'hint'));
    root.appendChild(scatter(result)); mark();
  }
  app.onChange(function () {
    var attack = app.state.doc && app.state.doc.profile === 'attack-tree';
    var tab = $('tab-btn-pareto'); tab.hidden = !attack;
    if (!attack && tab.getAttribute('aria-selected') === 'true') $('tab-btn-results').click();
    if (last !== app.state.results) { last = app.state.results; selected = null; app.renderer.highlight([], 'pareto'); render(); }
    else mark();
  });
})();
