// The app's own pop-up lists, in place of the browser's: a dropdown that
// stands in for <select> (same `value`, same `change` event, so the forms do
// not care), and suggestions under a text field in place of <datalist>. Both
// use the one list element, styled like the context menu.
(function () {
  if (typeof document === "undefined") return;
  var list = document.createElement("div");
  list.className = "menu pick-menu";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  document.body.appendChild(list);
  var owner = null; // the control the list is open for

  function close() {
    list.hidden = true;
    if (owner) owner.setAttribute("aria-expanded", "false");
    owner = null;
  }

  // `items`: [[value, label]], `chosen(value)` on a pick. `keepFocus`: the
  // owner is a text field that must not lose the caret to a click in the list.
  function open(anchor, items, current, chosen, keepFocus) {
    close();
    if (!items.length) return;
    // A modal makes body siblings inert; keep its popup in the same layer.
    (anchor.closest("dialog") || document.body).appendChild(list);
    owner = anchor;
    anchor.setAttribute("aria-expanded", "true");
    list.replaceChildren();
    items.forEach(function (item) {
      var option = document.createElement("button");
      option.type = "button";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(item[0] === current));
      option.textContent = item[1];
      if (keepFocus) {
        option.tabIndex = -1;
        option.addEventListener("pointerdown", function (e) {
          e.preventDefault();
        });
      }
      option.addEventListener("click", function () {
        close();
        chosen(item[0]);
      });
      list.appendChild(option);
    });
    var box = anchor.getBoundingClientRect();
    var height = Math.min(items.length * 26 + 10, 260);
    var below = box.bottom + 2 + height <= window.innerHeight;
    list.style.setProperty("--menu-x", Math.max(0, Math.min(box.left, window.innerWidth - Math.max(box.width, 190))) + "px");
    list.style.setProperty("--menu-y", (below ? box.bottom + 2 : Math.max(0, box.top - 2 - height)) + "px");
    list.style.setProperty("--menu-w", box.width + "px");
    list.hidden = false;
  }

  function move(step) {
    var options = Array.prototype.slice.call(list.children);
    var at = options.indexOf(document.activeElement);
    var next = options[Math.max(0, Math.min(options.length - 1, at + step))];
    if (next) next.focus();
  }

  list.addEventListener("keydown", function (e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Escape" || e.key === "Tab") {
      var back = owner;
      close();
      if (back) back.focus();
      if (e.key === "Escape") e.stopPropagation();
    }
  });
  document.addEventListener("pointerdown", function (e) {
    if (owner && !list.contains(e.target) && !owner.contains(e.target)) close();
  });
  window.addEventListener("resize", close);
  // The form under an open list may be redrawn: the list goes with it.
  if (window.effractor) window.effractor.onChange(close);

  // ---- in place of <select> ----

  function dropdown(options, value) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "pick";
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-expanded", "false");
    var current = value == null ? "" : String(value);

    function paint() {
      var found = options.filter(function (o) { return String(o[0]) === current; })[0];
      button.textContent = found ? found[1] : current;
    }
    Object.defineProperty(button, "value", {
      get: function () { return current; },
      set: function (v) {
        current = v == null ? "" : String(v);
        paint();
      },
    });

    function show() {
      if (owner === button) return close();
      open(button, options.map(function (o) { return [String(o[0]), o[1]]; }), current, function (v) {
        button.focus();
        if (v === current) return;
        current = v;
        paint();
        button.dispatchEvent(new Event("change", { bubbles: true }));
      });
      var selected = list.querySelector('[aria-selected="true"]') || list.children[0];
      if (selected) selected.focus();
    }
    button.addEventListener("click", show);
    button.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        show();
      }
    });
    paint();
    return button;
  }

  // ---- in place of <datalist> ----

  function suggest(input, words) {
    input.setAttribute("autocomplete", "off");
    function show() {
      var typed = input.value.trim().toLowerCase();
      var matching = words.filter(function (w) {
        return w.toLowerCase().indexOf(typed) >= 0 && w.toLowerCase() !== typed;
      });
      open(input, matching.map(function (w) { return [w, w]; }), null, function (w) {
        input.value = w;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }, true);
    }
    // On focus only for an empty field: a field that has its value is not asking.
    input.addEventListener("focus", function () {
      if (!input.value.trim()) show();
    });
    input.addEventListener("input", show);
    input.addEventListener("blur", function () {
      if (owner === input) close();
    });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && owner === input) {
        e.stopPropagation();
        close();
      }
    });
    return input;
  }

  window.effractorMenu = { dropdown: dropdown, suggest: suggest, close: close };
})();
