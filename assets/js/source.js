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

  // The 1-based line of a document path such as `entities.web.parameters.login`
  // in block YAML, as the canonical writer lays it out; where the path goes
  // on inside a flow map (`{patched: false}`) or nowhere, the deepest line
  // found. Null if not even its first key is there.
  function pathLine(text, path) {
    if (!path) return null;
    var keys = String(path).split(".");
    var lines = text.split("\n");
    var blank = function (line) {
      return /^\s*(#.*)?$/.test(line);
    };
    var indentOf = function (line) {
      return /^\s*/.exec(line)[0].length;
    };
    var from = 0;
    var end = lines.length;
    var found = null;
    for (var k = 0; k < keys.length; k++) {
      // `changes[1]`: the key, then the second item of the list under it.
      var parts = /^([^[\]]*)((?:\[\d+\])*)$/.exec(keys[k]);
      if (!parts) return found;
      var hit = -1;
      var level = null;
      for (var i = from; i < end && hit < 0; i++) {
        var m = /^(\s*)("?)([^":\s]+)\2:(\s|$)/.exec(lines[i]);
        if (!m) continue;
        if (level === null) level = m[1].length;
        if (m[1].length === level && m[3] === parts[1]) hit = i;
      }
      if (hit < 0) return found;
      found = hit + 1;
      from = hit + 1;
      // A list may sit at its key's own indentation: its dashes belong to it.
      for (end = from; end < lines.length; end++) {
        if (blank(lines[end])) continue;
        var indent = indentOf(lines[end]);
        if (indent < level || (indent === level && !/^\s*-(\s|$)/.test(lines[end]))) break;
      }
      var indices = parts[2] ? parts[2].slice(1, -1).split("][").map(Number) : [];
      for (var x = 0; x < indices.length; x++) {
        var item = -1;
        var dash = null;
        var seen = 0;
        for (var j = from; j < end && item < 0; j++) {
          var d = /^(\s*)-(\s|$)/.exec(lines[j]);
          if (!d) continue;
          if (dash === null) dash = d[1].length;
          if (d[1].length === dash && seen++ === indices[x]) item = j;
        }
        // No such item, or a list written on one line: the list's line.
        if (item < 0) return found;
        found = item + 1;
        from = item;
        for (end = item + 1; end < lines.length; end++) {
          if (!blank(lines[end]) && indentOf(lines[end]) <= dash) break;
        }
        // The item's first key sits on its dash line: read it as indented.
        lines[item] = lines[item].replace(/^(\s*)-/, "$1 ");
        level = null;
      }
    }
    return found;
  }

  if (typeof module !== "undefined") module.exports = { lineRange: lineRange, problemText: problemText, pathLine: pathLine };
  if (typeof document === "undefined") return;

  var app = window.effractor;
  var blocksGraph = window.effractorProblems.blocks;
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
      problems(app.state.diagnostics || []);
      area.focus();
    } else if (!app.state.sourceValid && app.state.text !== null) {
      // Closed on text that did not parse: the document is what stays.
      clearTimeout(timer);
      timer = null;
      app.adoptSource(app.state.text);
      $("canvas").classList.remove("is-stale");
    }
  }

  function problems(list) {
    var ul = $("source-problems");
    ul.replaceChildren();
    list.forEach(function (d) {
      var li = document.createElement("li");
      li.textContent = problemText(d);
      li.className = "problem-" + d.severity;
      // A warning that still keeps the attack graph from being built.
      if (d.severity !== "error" && blocksGraph(d)) {
        li.classList.add("problem-blocking");
        li.title = "blocks the attack graph";
      }
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
    // At once, not after the pause: nothing about the old text is shown now.
    app.markSourceDirty();
    clearTimeout(timer);
    timer = setTimeout(function () {
      timer = null;
      app.adoptSource(area.value).then(function (list) {
        if (list) problems(list); // null: more typing overtook this text
      });
    }, PAUSE_MS);
  });

  // A text that did not open, to be put right here: in the source view with
  // its problems, the canvas on the document it had until the text parses.
  app.showSourceText = function (text, list) {
    if ($("view-source").hidden) show(true);
    clearTimeout(timer);
    timer = null;
    area.value = text;
    app.markSourceDirty();
    problems(list);
    var first = list.filter(function (d) {
      return d.line;
    })[0];
    if (!first) return;
    var range = lineRange(text, first.line);
    area.focus();
    area.setSelectionRange(range[0], range[1]);
  };

  // Straight to where a path of the document is written: opens the source
  // view and selects that line.
  app.showSourcePath = function (path) {
    if ($("view-source").hidden) show(true);
    var line = pathLine(area.value, path);
    if (line === null) return app.say("not found in the source");
    var range = lineRange(area.value, line);
    area.focus();
    area.setSelectionRange(range[0], range[1]);
  };
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
    problems(app.state.diagnostics || []);
  });
})();
