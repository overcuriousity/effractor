// The session as rows to draw (chat spec §7): each call one line of plain
// words beside its result, tokens only as reported, the running step's
// events after what is stored. And whether Undo turn may be offered.
(function () {
  var INTERRUPTED = " [interrupted]";
  var SAID = {
    read_document: "Read the document",
    problems: "Read the problems",
    analyse: "Solved",
    solve: "Simulated",
    attack_graph: "Built the attack graph",
    catalog: "Read the catalog",
    set_view: "Switched view",
    set_scenario: "Chose scenario",
    replace_document: "Replaced the document",
  };

  function words(name, input, result) {
    if (!result) return "…";
    if (!result.ok) return "Not done: " + result.output;
    input = input || {};
    if (name === "show") return "Showed " + input.id;
    if (name === "compare") return "Compared " + input.scenario;
    if (name === "show_route") return input.index == null ? "Hid the route" : "Showed route " + (input.index + 1);
    if (name === "show_all_steps") return input.on ? "All steps on" : "All steps off";
    if (SAID[name]) return SAID[name];
    return String(result.output).split(" → ")[0];
  }

  function textOf(content) {
    return (content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
  }

  function said(text, turn) {
    var cut = text.slice(-INTERRUPTED.length) === INTERRUPTED;
    return { kind: "said", text: cut ? text.slice(0, -INTERRUPTED.length) : text, turn: turn, interrupted: cut };
  }

  function rows(messages, live) {
    var out = [], calls = {}, turn = 1;
    function call(id, name, input) {
      var row = { kind: "call", id: id, name: name, input: input, result: null, words: "…", turn: turn };
      calls[id] = row;
      out.push(row);
    }
    (messages || []).forEach(function (m) {
      turn = m.turn || turn;
      var content = m.content || [];
      if (m.role === "user") {
        out.push({ kind: "user", author: m.author || "", text: textOf(content), turn: turn });
      } else if (m.role === "assistant") {
        content.forEach(function (b) {
          if (b.type === "thinking") out.push({ kind: "thinking", text: b.text, turn: turn });
          else if (b.type === "text") out.push(said(b.text, turn));
          else if (b.type === "tool_call") call(b.id, b.name, b.input);
        });
        if (m.input_tokens != null || m.output_tokens != null) {
          out.push({ kind: "tokens", input: m.input_tokens, output: m.output_tokens, turn: turn });
        }
      } else if (m.role === "tool") {
        content.forEach(function (b) {
          var row = calls[b.id];
          if (!row || b.type !== "tool_result") return;
          row.result = { ok: b.ok, output: b.output };
          row.words = words(row.name, row.input, row.result);
        });
      } else if (m.role === "marker") {
        content.forEach(function (b) {
          if (b.type === "marker") out.push({ kind: "marker", n: b.left_out_turns, turn: turn });
        });
      }
    });
    // The step now streaming.
    var text = null, thinking = null;
    (live || []).forEach(function (e) {
      var d = e.data || {};
      if (e.event === "text") {
        if (!text) { text = { kind: "said", text: "", turn: turn, interrupted: false }; out.push(text); }
        text.text += d.text || "";
      } else if (e.event === "thinking") {
        if (!thinking) { thinking = { kind: "thinking", text: "", turn: turn }; out.push(thinking); }
        thinking.text += d.text || "";
      } else if (e.event === "tool_call") {
        text = null;
        call(d.id, d.name, d.input);
      } else if (e.event === "marker") {
        out.push({ kind: "marker", n: d.left_out_turns, turn: turn });
      }
    });
    return out;
  }

  // `record`: {before, after}, the texts around a turn this page ran.
  function undoTurn(record, text) {
    if (!record) return { offer: false, why: "only where it ran" };
    if (record.before === record.after) return { offer: false, why: "nothing edited" };
    if (text !== record.after) return { offer: false, why: "changed since" };
    return { offer: true };
  }

  var api = { rows: rows, words: words, undoTurn: undoTurn };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorAssistantTranscript = api;
})();
