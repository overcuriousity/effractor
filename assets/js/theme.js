// Three states: light, dark, system. Loaded as a blocking script in <head> so
// the attribute is set before first paint — the CSP allows no inline script,
// and a deferred one would flash the wrong theme.
//
// The token file treats a missing attribute as "follow the system", so that is
// how `system` is written. What is decided here is only the first visit: light,
// because the canvas is a drawing surface and reads as paper by default.
(function () {
  var KEY = "effractor.theme";
  var STATES = ["light", "dark", "system"];
  var root = document.documentElement;
  var current = "light";

  function read() {
    try {
      var v = localStorage.getItem(KEY);
      return STATES.indexOf(v) >= 0 ? v : "light";
    } catch (e) {
      return "light"; // storage blocked: the default, unpersisted
    }
  }

  function set(state) {
    current = STATES.indexOf(state) >= 0 ? state : "light";
    if (current === "system") delete root.dataset.theme;
    else root.dataset.theme = current;
    try {
      localStorage.setItem(KEY, current);
    } catch (e) {}
    return current;
  }

  set(read());

  window.effractorTheme = {
    get: function () { return current; },
    set: set,
    cycle: function () { return set(STATES[(STATES.indexOf(current) + 1) % STATES.length]); },
  };
})();
