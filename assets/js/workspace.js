// Panel chrome: resize, collapse, theme button. No model logic lives here.
// Sizes are written through the CSSOM (style.setProperty), which the CSP
// permits where it forbids style attributes.
(function () {
  var LIMITS = { min: 160, max: 520 };
  var KEY = "effractor.panels";

  function clampWidth(px) {
    if (!(px >= LIMITS.min)) return LIMITS.min; // also catches NaN
    return Math.round(Math.min(px, LIMITS.max));
  }

  // dx is pointer movement to the right. The right panel grows leftwards.
  function nextWidth(side, width, dx) {
    return clampWidth(side === "left" ? width + dx : width - dx);
  }

  if (typeof module !== "undefined") module.exports = { clampWidth: clampWidth, nextWidth: nextWidth, LIMITS: LIMITS };
  if (typeof document === "undefined") return;

  var root = document.getElementById("app");
  var state = { left: 220, right: 264, leftOpen: true, rightOpen: true };
  try {
    var saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    for (var k in state) if (typeof saved[k] === typeof state[k]) state[k] = saved[k];
  } catch (e) {}

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
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {}
  }

  document.querySelectorAll("[data-toggle]").forEach(function (button) {
    button.addEventListener("click", function () {
      var side = button.getAttribute("data-toggle");
      state[side + "Open"] = !state[side + "Open"];
      apply();
    });
  });

  document.querySelectorAll("[data-resize]").forEach(function (grip) {
    var side = grip.getAttribute("data-resize");
    grip.addEventListener("pointerdown", function (down) {
      if (!state[side + "Open"]) return;
      var start = state[side];
      grip.setPointerCapture(down.pointerId);
      grip.setAttribute("data-dragging", "");
      function move(e) {
        state[side] = nextWidth(side, start, e.clientX - down.clientX);
        apply();
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
      apply();
    });
    grip.addEventListener("keydown", function (e) {
      var dx = e.key === "ArrowRight" ? 16 : e.key === "ArrowLeft" ? -16 : 0;
      if (!dx) return;
      e.preventDefault();
      state[side] = nextWidth(side, state[side], dx);
      apply();
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
  labelTheme();

  apply();
})();
