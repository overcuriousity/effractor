(function () {
  function attacker(result) { return result && result.attacker && result.attacker.available; }
  function all(result) {
    var a = attacker(result);
    return a ? a.attacks.map(function (r, i) { return Object.assign({}, r, { index: i, cheapest: i === a.cheapest }); }) : [];
  }
  function rows(result, sort, descending, label) {
    label = label || function (id) { return id; };
    return all(result).filter(function (r) { return r.on_front || r.cheapest; }).sort(function (a, b) {
      if (a.cheapest !== b.cheapest) return a.cheapest ? -1 : 1;
      var av = sort === 'leaves' ? a.leaves.map(label).join(' · ') : a[sort], bv = sort === 'leaves' ? b.leaves.map(label).join(' · ') : b[sort];
      if (av === null || bv === null) return av === bv ? a.index - b.index : av === null ? 1 : -1;
      var order = av < bv ? -1 : av > bv ? 1 : a.index - b.index;
      return descending ? -order : order;
    });
  }
  function points(result, x, y) { return all(result).filter(function (r) { return Number.isFinite(r[x]) && Number.isFinite(r[y]); }); }
  function axes(current, which, value) {
    var next = Object.assign({}, current), other = which === 'x' ? 'y' : 'x';
    if (next[other] === value) next[other] = next[which]; next[which] = value; return next;
  }
  function path(doc, leaves) {
    var reachable = new Set(), todo = [doc.top];
    while (todo.length) {
      var next = todo.pop(); if (reachable.has(next) || !doc.nodes[next]) continue;
      reachable.add(next); (doc.nodes[next].children || []).forEach(function (child) { todo.push(child); });
    }
    var parents = Object.create(null);
    Array.from(reachable).forEach(function (id) { (doc.nodes[id].children || []).forEach(function (child) { (parents[child] || (parents[child] = [])).push(id); }); });
    var seen = new Set(), stack = leaves.filter(function (id) { return reachable.has(id); });
    while (stack.length) { var id = stack.pop(); if (seen.has(id)) continue; seen.add(id); if (id === doc.top) continue; (parents[id] || []).forEach(function (p) { stack.push(p); }); }
    return Array.from(seen);
  }
  var api = { all: all, rows: rows, points: points, axes: axes, path: path };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorPareto = api;
})();
