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
    if (c == null || c === '' || Number(c) === 100) return time || (c == null || c === '' ? '' : '100%');
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
  // Never an exponent: the file's grammar has none in a chance.
  function showChance(p) {
    var x = Number((p * 100).toPrecision(12));
    var s = String(x);
    var m = /^(\d)(?:\.(\d+))?e-(\d+)$/.exec(s); // "2.5e-10": move the point
    if (m) s = '0.' + new Array(Number(m[3])).join('0') + m[1] + (m[2] || '');
    return s + '%';
  }
  function showRate(rate) {
    return 'Exponential(mean ' + Number((1 / rate).toPrecision(3)) + ')';
  }
  function options(unit) {
    return [['', 'Choose timing…']].concat(PRESETS.map(function (p) {
      return [p[1], p[0].replace(/(\d+) \{u\}/, function (m, n) { return n + ' ' + unitName(unit, n); })];
    }), [['custom', 'Custom…']]);
  }
  // The original input stays the value/change interface for the editor. The
  // preset picker and the Chance / Average time fields are two ways of
  // writing it; a shape they cannot hold (Gamma, Never…) hides the fields.
  function attach(input, unit) {
    var wrap = document.createElement('div'); wrap.className = 'ttc-field';
    function chosen() { var v = input.value.trim(); var p = PRESETS.filter(function (x) { return x[1] === v; })[0]; return p ? p[1] : v ? 'custom' : ''; }
    var picker = window.effractorMenu.dropdown(options(unit), chosen());
    picker.setAttribute('aria-label', 'Timing preset');
    function part(label, suffix, title) {
      var box = document.createElement('label'); box.className = 'ttc-part'; box.title = title;
      var name = document.createElement('span'); name.className = 'hint'; name.textContent = label;
      var field = document.createElement('input'); field.type = 'number'; field.min = '0'; field.step = 'any'; field.className = 'num';
      var tail = document.createElement('span'); tail.className = 'hint'; tail.textContent = suffix;
      box.append(name, field, tail);
      return { box: box, field: field };
    }
    var chance = part('Chance', '%', 'How likely the step succeeds at all · empty: certain');
    chance.field.max = '100';
    var mean = part('Average time', unitName(unit, 2), 'How long it takes on average when it succeeds · empty: at once');
    var parts = document.createElement('div'); parts.className = 'ttc-parts';
    parts.append(chance.box, mean.box);
    var hint = document.createElement('p'); hint.className = 'hint ttc-description';
    hint.id = input.id + '-description'; input.setAttribute('aria-describedby', hint.id);
    input.placeholder = 'e.g. 50% * Exponential(mean 10)';
    // From the text to the picker, the fields and the hint. The field being
    // typed in keeps what the person typed.
    function explain(typing) {
      var text = input.value.trim();
      picker.value = chosen();
      var split_ = text ? split(text) : { chance: null, mean: null };
      parts.hidden = !split_;
      if (split_) {
        if (typing !== chance.field) chance.field.value = split_.chance == null ? '' : split_.chance;
        if (typing !== mean.field) mean.field.value = split_.mean == null ? '' : split_.mean;
      }
      hint.textContent = describe(text, unit);
    }
    // While a field writes the text, the text's own listener must leave that
    // field alone too, or "0.0" would be read back as "0" mid-number.
    var typing = null;
    function fromParts(e) {
      input.value = join({ chance: chance.field.value === '' ? null : chance.field.value, mean: mean.field.value === '' ? null : mean.field.value });
      typing = e.target;
      try {
        explain(typing);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      } finally {
        typing = null;
      }
    }
    [chance.field, mean.field].forEach(function (f) {
      f.addEventListener('input', fromParts);
      f.addEventListener('change', function () { input.dispatchEvent(new Event('change', { bubbles: true })); });
    });
    picker.addEventListener('change', function () {
      if (picker.value === 'custom' || picker.value === '') { input.focus(); input.select(); return; }
      input.value = picker.value; explain();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('input', function () { explain(typing); });
    input.addEventListener('change', function () { explain(); });
    wrap.append(picker, parts, input, hint); explain(); return wrap;
  }
  var api = { PRESETS: PRESETS, split: split, join: join, describe: describe, showChance: showChance, showRate: showRate, options: options, attach: attach };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorTtc = api;
})();
