// Timing presets, and a TTC split into a chance and an average time and
// joined back. Pure except `attach`. The solver owns semantics.
(function () {
  var PRESETS = [
    ['Easy · about 1 {u}', 'Exponential(mean 1)'],
    ['Hard · about 10 {u}', 'Exponential(mean 10)'],
    ['Very hard · about 100 {u}', 'Exponential(mean 100)'],
    ['Easy · 50% chance', '50%'],
    ['Hard · 50% chance, about 10 {u}', '50% * Exponential(mean 10)'],
    ['Very hard · 50% chance, about 100 {u}', '50% * Exponential(mean 100)'],
    ['Never', 'Never'],
    ['Immediate', 'Immediate'],
  ];
  var NUM = '([0-9]*\\.?[0-9]+(?:e[-+]?[0-9]+)?)';
  var SHAPE = new RegExp('^\\s*(?:' + NUM + '\\s*%)?\\s*(?:\\*\\s*)?(?:Exponential\\(\\s*mean\\s+' + NUM + '\\s*\\))?\\s*$', 'i');
  function split(expr) {
    var m = SHAPE.exec(String(expr || ''));
    if (!m || (m[1] == null && m[2] == null)) return null;
    // "30% Exponential(…)" without * is not the notation.
    if (m[1] != null && m[2] != null && !/\*/.test(expr)) return null;
    return { chance: m[1] == null ? null : Number(m[1]), mean: m[2] == null ? null : Number(m[2]) };
  }
  function join(parts) {
    var c = parts.chance, mean = parts.mean;
    var time = mean == null || mean === '' ? '' : 'Exponential(mean ' + mean + ')';
    if (c == null || c === '' || Number(c) === 100) return time;
    return time ? c + '% * ' + time : c + '%';
  }
  function unitName(unit, count) {
    return ({ h: 'hour', d: 'day', y: 'year' }[unit] || unit) + (Number(count) === 1 ? '' : 's');
  }
  function describe(expr, unit) {
    var text = String(expr || '').trim();
    if (!text) return 'Choose timing, or write it below.';
    if (text === 'Never') return 'Never succeeds · blocked.';
    if (text === 'Immediate') return 'Succeeds at once.';
    var p = split(text);
    if (!p) return 'Custom distribution · time in ' + unitName(unit, 2) + '.';
    var chance = p.chance == null ? '' : p.chance + '% chance';
    var time = p.mean == null ? 'at once' : 'about ' + p.mean + ' ' + unitName(unit, p.mean) + ' on average';
    return (chance ? chance + ', then ' : 'Succeeds, ') + time + (p.chance == null || p.chance === 100 ? '' : '; otherwise never') + '.';
  }
  function showChance(p) {
    return String(Number((p * 100).toPrecision(12))) + '%';
  }
  function showRate(rate) {
    return 'Exponential(mean ' + Number((1 / rate).toPrecision(3)) + ')';
  }
  function options(unit) {
    var u = unitName(unit, 2);
    return [['', 'Choose timing…']].concat(PRESETS.map(function (p) { return [p[1], p[0].replace('{u}', u)]; }), [['custom', 'Custom…']]);
  }
  // The original input stays the value/change interface for the editor.
  function attach(input, unit) {
    var wrap = document.createElement('div'); wrap.className = 'ttc-field';
    function chosen() { var v = input.value.trim(); var p = PRESETS.filter(function (x) { return x[1] === v; })[0]; return p ? p[1] : v ? 'custom' : ''; }
    var picker = window.effractorMenu.dropdown(options(unit), chosen());
    picker.setAttribute('aria-label', 'Timing preset');
    var hint = document.createElement('p'); hint.className = 'hint ttc-description';
    hint.id = input.id + '-description'; input.setAttribute('aria-describedby', hint.id);
    input.placeholder = 'e.g. 50% * Exponential(mean 10)';
    function explain() { picker.value = chosen(); hint.textContent = describe(input.value.trim(), unit); }
    picker.addEventListener('change', function () {
      if (picker.value === 'custom' || picker.value === '') { input.focus(); input.select(); return; }
      input.value = picker.value; explain();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('input', explain); input.addEventListener('change', explain);
    wrap.append(picker, input, hint); explain(); return wrap;
  }
  var api = { PRESETS: PRESETS, split: split, join: join, describe: describe, showChance: showChance, showRate: showRate, options: options, attach: attach };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorTtc = api;
})();
