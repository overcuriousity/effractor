// The session as rows to draw (chat spec §7): each call one line of plain
// words beside its result, tokens only as reported, the running step's
// events after what is stored. And whether Undo turn may be offered.
(function () {
  var INTERRUPTED = " [interrupted]";
  var LIMIT = " [cut at the reply limit]";
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
    return String(result.output).replace(/(, id | → )\S+$/, "");
  }

  // What clicking a call selects: the item it made or changed. Results name
  // the plain id (", id web"), qualified here from the document; sessions
  // from before name the qualified one (" → entity/web").
  function target(row, doc) {
    if (!row.result || !row.result.ok) return null;
    if (row.name === "show") return row.input && row.input.id ? String(row.input.id) : null;
    var out = String(row.result.output), m = / → (\S+)$/.exec(out);
    if (m) return m[1];
    if (!(m = /, id (\S+)$/.exec(out))) return null;
    var id = m[1], d = doc || {};
    var has = function (o) { return !!o && Object.prototype.hasOwnProperty.call(o, id); };
    if (has(d.entities)) return "entity/" + id;
    if (has(d.associations)) return "association/" + id;
    if (has(d.flows)) return "flow/" + id;
    return id;
  }

  // A reported count, short: 890, 12.4k, 1.2M.
  function count(n) {
    if (n == null) return "—";
    if (n < 1000) return String(n);
    if (n < 1e6) return (Math.round(n / 100) / 10) + "k";
    return (Math.round(n / 1e5) / 10) + "M";
  }

  function textOf(content) {
    return (content || []).filter(function (b) { return b.type === "text"; }).map(function (b) { return b.text; }).join("\n");
  }

  // The server marks a text the stream broke off, or the reply limit cut.
  function said(text, turn) {
    var interrupted = text.slice(-INTERRUPTED.length) === INTERRUPTED;
    if (interrupted) text = text.slice(0, -INTERRUPTED.length);
    var cut = text.slice(-LIMIT.length) === LIMIT;
    if (cut) text = text.slice(0, -LIMIT.length);
    return { kind: "said", text: text, turn: turn, interrupted: interrupted, cut: cut };
  }

  // `running`: the last turn is still going, so its tokens are not summed yet.
  function rows(messages, live, running) {
    var out = [], calls = {}, turn = 1, spent = {};
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
          // A count no step reported stays unknown, never 0.
          var t = spent[turn] = spent[turn] || { input: null, output: null };
          if (m.input_tokens != null) t.input = (t.input || 0) + m.input_tokens;
          if (m.output_tokens != null) t.output = (t.output || 0) + m.output_tokens;
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
    // One tokens line at the end of each turn: what its steps reported.
    var last = out.length ? out[out.length - 1].turn : null;
    for (var i = out.length - 1; i >= 0; i--) {
      var n = out[i].turn;
      var ends = i === out.length - 1 || out[i + 1].turn !== n;
      if (ends && spent[n] && !(running && n === last)) {
        out.splice(i + 1, 0, { kind: "tokens", input: spent[n].input, output: spent[n].output, turn: n });
      }
    }
    // The step now streaming.
    var text = null, thinking = null;
    (live || []).forEach(function (e) {
      var d = e.data || {};
      if (e.event === "text") {
        if (!text) { text = { kind: "said", text: "", turn: turn, interrupted: false, live: true }; out.push(text); }
        text.text += d.text || "";
      } else if (e.event === "thinking") {
        if (!thinking) { thinking = { kind: "thinking", text: "", turn: turn, live: true }; out.push(thinking); }
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

  var api = { rows: rows, words: words, target: target, count: count, undoTurn: undoTurn };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorAssistantTranscript = api;
})();
