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
    // The * joins two parts: without both it is not the notation, and
    // "30% Exponential(…)" without it is not either.
    if ((m[1] != null && m[2] != null) !== /\*/.test(expr)) return null;
    return { chance: m[1] == null ? null : Number(m[1]), mean: m[2] == null ? null : Number(m[2]) };
  }
  function join(parts) {
    var c = parts.chance, mean = parts.mean;
    var time = mean == null || mean === '' ? '' : 'Exponential(mean ' + mean + ')';
    if (c == null || c === '' || Number(c) === 100) return time || (c == null || c === '' ? '' : '100%');
    return time ? c + '% * ' + time : c + '%';
  }
  var HOURS = { h: 1, d: 24, y: 8760 };
  // A time in `from` units, in `to` units; twelve digits, so a year typed
  // as days does not come back as 364.99999999999994.
  function convert(v, from, to) {
    return Number((Number(v) * HOURS[from] / HOURS[to]).toPrecision(12));
  }
  function unitName(unit, count) {
    return ({ h: 'hour', d: 'day', y: 'year' }[unit] || unit) + (Number(count) === 1 ? '' : 's');
  }
  function describe(expr, unit) {
    var text = String(expr || '').trim();
    if (!text) return 'choose a timing · or write one';
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
  // What the solver is handed for a sketch: the whole mean, not a rounded
  // one, so the sketch is of this rate and not a neighbour's.
  function showRate(rate) {
    return 'Exponential(mean ' + 1 / rate + ')';
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
    // `suffix`: words, or a control of its own (the time's unit).
    function part(label, suffix, title) {
      var box = document.createElement('label'); box.className = 'ttc-part'; box.title = title;
      var name = document.createElement('span'); name.className = 'hint'; name.textContent = label;
      // Text, not a number field: that one reads "1,5" as nothing at all.
      var field = document.createElement('input'); field.type = 'text'; field.inputMode = 'decimal'; field.className = 'num number';
      var tail = suffix;
      if (typeof suffix === 'string') { tail = document.createElement('span'); tail.className = 'hint'; tail.textContent = suffix; }
      box.append(name, field, tail);
      return { box: box, field: field };
    }
    var chance = part('Chance', '%', 'How likely the step succeeds at all · empty: certain');
    chance.field.max = '100';
    // Typed in any unit, written in the document's.
    // Shown in the largest unit it is at least one of: 730 days reads 2 years.
    var start = split(input.value);
    var hours = start && start.mean != null ? start.mean * HOURS[unit] : null;
    var shown = hours == null || !HOURS[unit] ? unit : hours >= HOURS.y ? 'y' : hours >= HOURS.d ? 'd' : 'h';
    var per = window.effractorMenu.dropdown([['h', 'hours'], ['d', 'days'], ['y', 'years']], shown);
    per.setAttribute('aria-label', 'Unit of the average time');
    per.classList && per.classList.add('ttc-unit');
    var mean = part('Average time', per, 'How long it takes on average when it succeeds · empty: at once');
    // Ids from the field's, so a form drawn again gives the focus back to
    // the part that had it.
    if (input.id) { picker.id = input.id + '-preset'; chance.field.id = input.id + '-chance'; mean.field.id = input.id + '-mean'; per.id = input.id + '-unit'; }
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
        if (typing !== mean.field) mean.field.value = split_.mean == null ? '' : String(convert(split_.mean, unit, per.value));
      }
      hint.textContent = describe(text, unit);
    }
    // While a field writes the text, the text's own listener must leave that
    // field alone too, or "0.0" would be read back as "0" mid-number.
    var typing = null;
    // Each part as it reads, or why it does not: said on the hint line.
    var SPECS = [[chance, { min: 0, max: 100 }, 'Chance'], [mean, { min: 0, above: true }, 'Average time']];
    function readParts() {
      var read = window.effractorEdit.readNumber, out = { problem: null };
      SPECS.forEach(function (x) {
        var r = read(x[0].field.value, x[1]);
        x[0].field.toggleAttribute('aria-invalid', !!r.error);
        if (r.error && !out.problem) out.problem = x[2] + ': ' + r.error;
        var v = r.value === undefined ? null : x[0] === mean ? convert(r.value, per.value, unit) : r.value;
        out[x[0] === chance ? 'chance' : 'mean'] = v === null ? null : String(v);
      });
      return out;
    }
    function fromParts(e) {
      // Half-typed ("." on the way to ".5") is not yet a problem: the text
      // waits, and leaving the field says why if it still does not read.
      var parts_ = readParts();
      if (parts_.problem) return;
      hint.classList.remove('field-problem');
      input.value = join({ chance: parts_.chance, mean: parts_.mean });
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
      // Only what reads is committed; what does not stays, said on the hint line.
      f.addEventListener('change', function () {
        var problem = readParts().problem;
        if (problem) {
          hint.textContent = problem;
          hint.classList.add('field-problem');
          return;
        }
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });
    // Another unit: what is typed is read in it, and written as it now reads.
    per.addEventListener('change', function () {
      if (mean.field.value.trim() === '' || readParts().problem) return;
      fromParts({ target: mean.field });
      input.dispatchEvent(new Event('change', { bubbles: true }));
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
  var api = { PRESETS: PRESETS, convert: convert, split: split, join: join, describe: describe, showChance: showChance, showRate: showRate, options: options, attach: attach };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorTtc = api;
})();
