// Panel chrome: resize, collapse, theme button. No model logic lives here.
// Sizes are written through the CSSOM (style.setProperty), which the CSP
// permits where it forbids style attributes.
(function () {
  var LIMITS = { min: 160, max: 520 };
  // A new key: the old one was written on every load, so every returning
  // visitor had the open-open first layout saved as if they had chosen it.
  var KEY = "effractor.panels.2";

  function clampWidth(px) {
    if (!(px >= LIMITS.min)) return LIMITS.min; // also catches NaN
    return Math.round(Math.min(px, LIMITS.max));
  }

  // dx is pointer movement to the right. The right panel grows leftwards.
  function nextWidth(side, width, dx) {
    return clampWidth(side === "left" ? width + dx : width - dx);
  }

  // Nothing is shown unless asked for: a first visit has both panels closed.
  // What the visitor last set on this origin wins after that; junk does not.
  function initialState(saved) {
    var state = { left: 220, right: 264, leftOpen: false, rightOpen: false };
    for (var k in state) if (saved && typeof saved[k] === typeof state[k]) state[k] = saved[k];
    return state;
  }

  if (typeof module !== "undefined") module.exports = { clampWidth: clampWidth, nextWidth: nextWidth, initialState: initialState, LIMITS: LIMITS };
  if (typeof document === "undefined") return;

  var root = document.getElementById("app");
  var state;
  try {
    state = initialState(JSON.parse(localStorage.getItem(KEY) || "{}"));
  } catch (e) {
    state = initialState({});
  }

  function apply() {
    root.style.setProperty("--left-w", clampWidth(state.left) + "px");
    root.style.setProperty("--right-w", clampWidth(state.right) + "px");
    // The attribute wins over the property for a closed panel: see the CSS.
    ["left", "right"].forEach(function (side) {
      var open = state[side + "Open"];
      if (open) root.removeAttribute("data-" + side);
      else {
        root.setAttribute("data-" + side, "closed");
        root.style.removeProperty("--" + side + "-w");
      }
      var toggle = document.querySelector('[data-toggle="' + side + '"]');
      if (toggle) toggle.setAttribute("aria-pressed", String(open));
    });
  }

  // Saved only when the visitor changed something: a layout nobody chose is
  // not a preference.
  function change() {
    apply();
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
  }

  document.querySelectorAll("[data-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var side = button.getAttribute("data-toggle");
      state[side + "Open"] = !state[side + "Open"];
      change();
    });
  });

  // For the actions that need a panel: a solve, the controls tool, the source.
  window.effractorWorkspace = {
    open: function (side) {
      if (state[side + "Open"]) return;
      state[side + "Open"] = true;
      apply(); // opened by the page, not chosen: not saved
    },
  };

  document.querySelectorAll("[data-resize]").forEach(function (grip) {
    var side = grip.getAttribute("data-resize");
    grip.addEventListener("pointerdown", function (down) {
      if (!state[side + "Open"]) return;
      var start = state[side];
      grip.setPointerCapture(down.pointerId);
      grip.setAttribute("data-dragging", "");
      function move(e) {
        state[side] = nextWidth(side, start, e.clientX - down.clientX);
        change();
      }
      function up() {
        grip.removeAttribute("data-dragging");
        grip.removeEventListener("pointermove", move);
        grip.removeEventListener("pointerup", up);
        grip.removeEventListener("pointercancel", up);
      }
      grip.addEventListener("pointermove", move);
      grip.addEventListener("pointerup", up);
      grip.addEventListener("pointercancel", up);
    });
    grip.addEventListener("dblclick", function () {
      state[side + "Open"] = !state[side + "Open"];
      change();
    });
    grip.addEventListener("keydown", function (e) {
      var dx = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0;
      if (!dx) return;
      e.preventDefault();
      state[side] = nextWidth(side, state[side], dx);
      change();
    });
  });

  var themeButton = document.getElementById("theme-switch");
  var NAMES = { light: "Light", dark: "Dark", system: "System" };
  function labelTheme() {
    themeButton.textContent = NAMES[window.effractorTheme.get()];
  }
  themeButton.addEventListener("click", function () {
    window.effractorTheme.cycle();
    labelTheme();
  });
  // A click cycles; a right-click offers the three by name.
  themeButton.addEventListener("contextmenu", function (e) {
    if (!window.effractor || !window.effractor.showMenu) return;
    e.preventDefault();
    var current = window.effractorTheme.get();
    window.effractor.showMenu(Object.keys(NAMES).map(function (key) {
      return [NAMES[key], key === current ? "✓" : "", function () {
        window.effractorTheme.set(key);
        labelTheme();
      }];
    }), e.clientX, e.clientY);
  });
  labelTheme();

  apply();
})();
