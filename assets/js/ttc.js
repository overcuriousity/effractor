// Human labels for the format's named TTC presets. The solver owns semantics.
(function () {
  var PRESETS = [
    ['EasyAndCertain', 1, 1], ['HardAndCertain', 10, 1], ['VeryHardAndCertain', 100, 1],
    ['EasyAndUncertain', 0, .5], ['HardAndUncertain', 10, .5], ['VeryHardAndUncertain', 100, .5],
    ['Infinity', null, 0], ['Zero', 0, 1],
  ];
  function unitName(unit, count) {
    return ({ h: 'hour', d: 'day', y: 'year' }[unit] || unit) + (count === 1 ? '' : 's');
  }
  function preset(value) {
    var alias = value === 'Enabled' ? 'Infinity' : value === 'Disabled' ? 'Zero' : value;
    return PRESETS.find(function (p) { return p[0] === alias; });
  }
  function label(p, unit) {
    if (p[2] === 0) return 'Never · blocked';
    if (p[1] === 0) return p[2] === 1 ? 'Immediate · always' : 'Immediate · 50% chance';
    return 'Mean ' + p[1] + ' ' + unitName(unit, p[1]) + ' · ' + (p[2] === 1 ? 'eventual success' : '50% eventual success');
  }
  function describe(value, unit) {
    var p = preset(value);
    if (!value) return 'Choose a preset or enter a distribution.';
    if (!p) return 'Custom distribution · time in ' + unitName(unit, 2);
    if (p[2] === 0) return value + ': never occurs · blocked.';
    if (p[1] === 0) return value + ': ' + (p[2] === 1 ? 'immediate success.' : '50% immediate success; otherwise never.');
    return value + ': ' + (p[2] === 1 ? 'eventual success' : '50% eventual success; otherwise never') + '. Exponential wait, mean ' + p[1] + ' ' + unitName(unit, p[1]) + (p[2] === 1 ? '.' : ' if successful.') + ' Not a guarantee within the horizon.';
  }
  function options(unit) {
    return [['', 'Choose timing…']].concat(PRESETS.map(function (p) { return [p[0], label(p, unit)]; }), [['custom', 'Custom distribution…']]);
  }
  // The original input stays the value/change interface for the editor.
  function attach(input, unit) {
    var wrap = document.createElement('div'); wrap.className = 'ttc-field';
    function chosen() { var p = preset(input.value.trim()); return p ? p[0] : input.value.trim() ? 'custom' : ''; }
    var picker = window.effractorMenu.dropdown(options(unit), chosen());
    picker.setAttribute('aria-label', 'Timing preset');
    var hint = document.createElement('p'); hint.className = 'hint ttc-description';
    hint.id = input.id + '-description'; input.setAttribute('aria-describedby', hint.id);
    input.placeholder = 'e.g. Exponential(0.1)';
    function explain() { picker.value = chosen(); hint.textContent = describe(input.value.trim(), unit); }
    picker.addEventListener('change', function () {
      if (picker.value === 'custom' || picker.value === '') { input.focus(); input.select(); return; }
      input.value = picker.value; explain();
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    input.addEventListener('input', explain); input.addEventListener('change', explain);
    wrap.append(picker, input, hint); explain(); return wrap;
  }
  var api = { describe: describe, options: options, attach: attach };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof window !== 'undefined') window.effractorTtc = api;
})();
