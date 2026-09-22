// The source view (spec 7.2): the YAML in a plain textarea, its problems in a
// list under it. Text that parses becomes the document after a pause in the
// typing; text that does not leaves the canvas on the last valid model, marked
// stale. A canvas edit rewrites the text. No model logic lives here: wasm says
// what is valid.
(function () {
  // [start, end) of a 1-based line, clamped to the text.
  function lineRange(text, line) {
    var lines = text.split("\n");
    var at = Math.max(1, Math.min(lines.length, line || 1)) - 1;
    var start = 0;
    for (var i = 0; i < at; i++) start += lines[i].length + 1;
    return [start, start + lines[at].length];
  }

  function problemText(d) {
    var where = d.line ? d.line + (d.col ? ":" + d.col : "") : d.path || "";
    return (where ? where + "  " : "") + d.message;
  }

  if (typeof module !== "undefined") module.exports = { lineRange: lineRange, problemText: problemText };
  if (typeof document === "undefined") return;

  var app = window.effractor;
  var PAUSE_MS = 400;
  var $ = function (id) {
    return document.getElementById(id);
  };
  var area = $("source");
  var button = document.querySelector('[data-tool="source"]');
  var timer = null;

  function show(on) {
    $("app").toggleAttribute("data-source", on);
    $("view-model").hidden = on;
    $("view-source").hidden = !on;
    button.setAttribute("aria-pressed", String(on));
    if (on) window.effractorWorkspace.open("left");
    if (on) {
      area.value = app.state.text || "";
      problems([]);
      area.focus();
    }
  }

  function problems(list) {
    var ul = $("source-problems");
    ul.replaceChildren();
    list.forEach(function (d) {
      var li = document.createElement("li");
      li.textContent = problemText(d);
      li.className = "problem-" + d.severity;
      if (d.line) {
        li.tabIndex = 0;
        var go = function () {
          var range = lineRange(area.value, d.line);
          area.focus();
          area.setSelectionRange(range[0], range[1]);
        };
        li.addEventListener("click", go);
        li.addEventListener("keydown", function (e) {
          if (e.key === "Enter") go();
        });
      }
      ul.appendChild(li);
    });
    var stale = list.some(function (d) {
      return d.severity === "error";
    });
    $("canvas").classList.toggle("is-stale", stale);
    $("source-state").textContent = stale ? "not valid — the canvas shows the last valid model" : list.length ? "valid, with remarks" : "valid";
  }

  button.disabled = false;
  button.addEventListener("click", function () {
    button.blur();
    show(button.getAttribute("aria-pressed") !== "true");
  });

  area.addEventListener("input", function () {
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      app.adoptSource(area.value).then(problems);
    }, PAUSE_MS);
  });
  // Tab belongs to the text here, as two spaces: YAML is made of indentation.
  area.addEventListener("keydown", function (e) {
    if (e.key !== "Tab" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    area.setRangeText("  ", area.selectionStart, area.selectionEnd, "end");
    area.dispatchEvent(new Event("input"));
  });

  // The document changed elsewhere (a canvas edit, undo, a file): the text
  // follows. What was just typed *is* the document's text, so nothing moves
  // under the caret.
  app.onChange(function () {
    if ($("view-source").hidden || app.state.text === null || area.value === app.state.text) return;
    if (document.activeElement === area && timer !== null) return; // mid-typing: the pause will settle it
    area.value = app.state.text;
    problems([]);
  });
})();
