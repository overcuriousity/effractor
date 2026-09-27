// The chat panel (chat spec §7): floats over the canvas at the left, bound to
// the account document open in this mode. Sessions are the document's,
// shared; each message says who wrote it. The agent's tool calls run here,
// through the page's own edit path, so its edits land on the canvas live.
(function () {
  var app = window.effractor, A = window.effractorAccounts;
  var C = window.effractorAssistantClient, T = window.effractorAssistantTranscript;
  var M = window.effractorAssistantMarkdown, P = window.effractorAssistantPage, TOOLS = window.effractorAssistantTools;
  var $ = function (id) { return document.getElementById(id); };
  var chat = $("chat"), openButton = $("chat-open");
  if (!app || !A || !C || !chat || !openButton) return;

  var here = document.currentScript ? document.currentScript.src : "";
  var client = C.createAssistantClient(window.fetch.bind(window));
  var log = $("chat-log"), form = $("chat-form"), input = $("chat-text"), sendButton = $("chat-send");
  var titleButton = $("chat-title"), said = $("chat-said"), edge = $("chat-edge");
  var WIDTH = "effractor.chat.width";

  var info = null;       // GET /api/assistant, for whoever is logged in
  var doc = null;        // the account document the chat is bound to
  var sid = null;        // the session shown
  var session = null;    // its GET payload: session, messages, turn, role, may_manage
  var live = [];         // events of the step streaming now
  var answered = null;   // results of the tool calls being run now
  var running = false, stopping = false, ending = null, poll = null;
  var turnNo = 0;        // counts turns begun here; a loop whose number is old has ended
  var turnDoc = null;    // the document the running turn is about
  var records = {};      // turn → {before, after}: Undo turn, in this page only
  var catalog = null;    // tools.json
  var drawn = [];        // what the log shows, row by row: {key, kind, node}
  var frame = 0;         // a draw waiting for the next animation frame
  var pin = false;       // scroll to the end on the next draw (the user just sent)

  function remember(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, String(value));
    } catch (e) { /* private window: forgotten, as nothing */ }
  }
  function recall(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }

  function note(text) {
    said.hidden = !text;
    said.textContent = text || "";
  }

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function loadCatalog() {
    if (catalog) return Promise.resolve(catalog);
    return window.fetch(new URL("tools.json", here).href).then(function (r) { return r.json(); }).then(function (c) {
      catalog = c;
      return c;
    });
  }

  // ---- which document, and whether the chat is here at all ----

  function refresh() {
    var id = A.sync && A.sync.openId ? A.sync.openId() : null;
    if (!A.session || !A.session.user) {
      info = null;
      return show(false, null);
    }
    // A yes is kept; a no is asked again (the admin may be granting it now).
    var asked = info && info.allowed ? Promise.resolve(info) : client.info().then(function (r) {
      info = r.ok ? r.data : { allowed: false };
      return info;
    });
    asked.then(function () { show(!!(info && info.allowed), id); });
  }

  function show(available, id) {
    chat.hidden = !available;
    if (!available) {
      close();
      if (doc != null) abandon();
      doc = null;
      return;
    }
    if (id !== doc) {
      abandon();
      doc = id;
      sid = Number(recall("effractor.chat." + doc)) || null;
      session = null;
      records = {};
      if (isOpen()) load();
    }
  }

  function isOpen() {
    return chat.classList.contains("is-open");
  }

  function open() {
    chat.classList.add("is-open");
    openButton.setAttribute("aria-expanded", "true");
    load();
    input.focus();
  }
  function close() {
    if (!isOpen()) return;
    chat.classList.remove("is-open");
    openButton.setAttribute("aria-expanded", "false");
  }
  function toggle() {
    if (chat.hidden) return;
    if (isOpen()) close();
    else open();
  }

  // `loaded`: runs once the session has arrived, before it is drawn.
  function load(loaded) {
    if (doc == null || !sid) {
      if (loaded) loaded();
      session = null;
      return Promise.resolve(draw());
    }
    return client.get(sid).then(function (r) {
      if (loaded) loaded();
      if (r.ok) session = r.data;
      else {
        sid = null;
        session = null;
        remember("effractor.chat." + doc, null);
      }
      draw();
      if (session && session.turn && !running) watch();
    });
  }

  // Someone else's turn: follow it until it ends.
  function watch() {
    if (poll) return;
    poll = setInterval(function () {
      if (!sid) return unwatch();
      client.get(sid).then(function (r) {
        if (!r.ok) return unwatch();
        session = r.data;
        draw();
        if (!session.turn) {
          unwatch();
          note("");
        }
      });
    }, 2000);
  }
  function unwatch() {
    if (poll) clearInterval(poll);
    poll = null;
  }

  // ---- drawing ----

  function viewer() {
    return session ? session.role === "viewer" : false;
  }

  function empty() {
    var box = el("div", "chat-quiet chat-empty");
    box.appendChild(el("p", null, "Goes to " + (info && info.host) + " · " + (info && info.model)));
    if (viewer()) box.appendChild(el("p", null, "can read, not edit"));
    return box;
  }

  // A tool call: one line of plain words with its state (running, done,
  // refused). A click selects what it made; a second shows input and result.
  function callLine(row) {
    var box = el("div", "chat-call");
    var b = el("button", "chat-call-line");
    b.type = "button";
    box.appendChild(b);
    box._row = row;
    b.addEventListener("click", function () {
      var r = box._row, target = T.target(r, app.state.doc);
      var detail = box.querySelector("pre");
      if (target && app.state.selected !== target) return app.select(target);
      if (detail) return detail.remove();
      box.appendChild(el("pre", null, callDetail(r)));
    });
    patchCall(box, row);
    return box;
  }
  function callDetail(row) {
    return JSON.stringify(row.input, null, 1) + (row.result ? "\n→ " + row.result.output : "");
  }
  function patchCall(box, row) {
    box._row = row;
    var state = !row.result ? "is-running" : row.result.ok ? "is-done" : "is-refused";
    box.className = "chat-call " + state;
    box.firstChild.textContent = row.words;
    var detail = box.querySelector("pre");
    if (detail) detail.textContent = callDetail(row);
  }

  // Sessions belong to a document kept in the account: say so, and offer it.
  function unsaved() {
    titleButton.textContent = "Chat";
    reset();
    var box = el("div", "chat-quiet chat-empty");
    box.appendChild(el("p", null, "Chats are kept with a saved document"));
    var b = el("button", "btn btn-ghost", "Save to documents");
    b.type = "button";
    b.addEventListener("click", function () {
      A.sync.save().then(refresh);
    });
    box.appendChild(b);
    log.appendChild(box);
    input.disabled = sendButton.disabled = true;
  }

  function reset() {
    log.textContent = "";
    drawn = [];
  }

  // Many events arrive per frame while a reply streams: one draw per frame.
  function schedule() {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = 0;
      draw();
    });
  }

  function build(row, streaming) {
    var node;
    if (row.kind === "user") {
      node = el("div", "chat-from-user");
      if (row.author) node.appendChild(el("div", "chat-who", row.author));
      node.appendChild(el("div", "chat-user", row.text));
      return node;
    }
    if (row.kind === "said") return patch(el("div", "chat-agent"), row, streaming);
    if (row.kind === "thinking") {
      node = el("details", "chat-thinking");
      node.appendChild(el("summary"));
      node.appendChild(el("div", "chat-thinking-text"));
      return patch(node, row, streaming);
    }
    if (row.kind === "call") return callLine(row);
    if (row.kind === "marker") return el("p", "chat-quiet", "… " + row.n + " earlier turns left out");
    return el("div", "chat-tokens", T.count(row.input) + " in · " + T.count(row.output) + " out");
  }

  // Changes a drawn row in place, so a streaming text grows where it is and
  // an opened fold stays open; returns the node.
  function patch(node, row, streaming) {
    if (row.kind === "said") {
      node.textContent = "";
      node.appendChild(M.render(M.parse(row.text), document));
      if (row.interrupted) node.appendChild(el("p", "chat-quiet", "interrupted"));
      if (row.cut) node.appendChild(el("p", "chat-quiet", "cut at the reply limit"));
      node.classList.toggle("is-streaming", streaming);
    } else if (row.kind === "thinking") {
      node.firstChild.textContent = streaming ? "Thinking…" : "Thinking";
      node.firstChild.classList.toggle("is-live", streaming);
      node.lastChild.textContent = row.text;
    } else if (row.kind === "call") {
      patchCall(node, row);
    }
    return node;
  }

  // The row at `i` as `row`: kept when unchanged, patched when it grew, else
  // built anew.
  function place(i, row, streaming, before) {
    var key = JSON.stringify(row) + (streaming ? "~" : "");
    var had = drawn[i];
    if (had && had.key === key) return;
    if (had && had.kind === row.kind && /^(said|thinking|call)$/.test(row.kind)) {
      patch(had.node, row, streaming);
      had.key = key;
      return;
    }
    var node = build(row, streaming);
    if (had) log.replaceChild(node, had.node);
    else log.insertBefore(node, before);
    drawn[i] = { key: key, kind: row.kind, node: node };
  }

  // Below the rows: waiting for the model, Undo turn, Continue.
  var waiting = el("div", "chat-waiting");
  waiting.appendChild(el("span", "chat-pulse"));
  waiting.appendChild(el("span", null, "Thinking…"));
  var after = el("div", "chat-after");

  function draw() {
    if (doc == null) return unsaved();
    input.disabled = sendButton.disabled = false;
    titleButton.textContent = session && session.session.title ? session.session.title : sid ? "Untitled" : "New session";
    var messages = session ? session.messages : [];
    if (answered && answered.length) {
      messages = messages.concat([{ role: "tool", turn: answered.turn, content: answered.map(function (r) {
        return { type: "tool_result", id: r.id, ok: r.ok, output: r.output };
      }) }]);
    }
    var rows = T.rows(messages, live, running);
    var atEnd = pin || log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    pin = false;
    if (!rows.length) {
      reset();
      log.appendChild(empty());
    } else if (!drawn.length) reset();
    if (waiting.parentNode !== log) log.appendChild(waiting);
    if (after.parentNode !== log) log.appendChild(after);
    var last = rows[rows.length - 1];
    rows.forEach(function (row, i) {
      place(i, row, running && !!row.live && row === last, waiting);
    });
    while (drawn.length > rows.length) drawn.pop().node.remove();
    waiting.hidden = !running || !!answered || !!(last && last.live);
    waiting.lastChild.textContent = stopping ? "Stopping…" : "Thinking…";
    drawAfter(last ? last.turn : null);
    // Someone else's turn: the field says who is asking.
    var other = !running && session && session.turn ? session.turn.by : null;
    input.placeholder = other ? other + " is asking …" : "Ask …";
    sendButton.classList.toggle("is-stop", running);
    sendButton.title = running ? "Stop" : "Send (Enter)";
    sendButton.setAttribute("aria-label", running ? "Stop" : "Send");
    if (atEnd) log.scrollTop = log.scrollHeight;
  }

  function drawAfter(lastTurn) {
    after.textContent = "";
    if (running || lastTurn == null) return;
    var record = records[lastTurn];
    if (record && record.before !== record.after) {
      var can = T.undoTurn(record, app.state.text);
      var u = el("button", "btn btn-ghost chat-undo", "Undo turn");
      u.type = "button";
      u.disabled = !can.offer;
      if (!can.offer) u.title = can.why;
      u.addEventListener("click", function () { undoTurn(record); });
      after.appendChild(u);
    }
    if (ending === "steps") {
      var more = el("button", "link-button", "Continue");
      more.type = "button";
      more.addEventListener("click", function () { say("Continue."); });
      after.appendChild(more);
    }
  }

  function undoTurn(record) {
    app.solver.parse(record.before).then(function (parsed) {
      if (!parsed.ok) return note("could not read the text before the turn");
      return app.tryEdit({ doc: parsed.ok, select: null }).then(function (r) {
        if (!r.ok) note(r.reason);
        draw();
      });
    });
  }

  // ---- a turn ----

  function refused(r) {
    if (r.status === 409) {
      watch();
      return String(r.data || "busy");
    }
    if (r.status === 429) return "daily budget reached";
    if (r.status === 413) return "too long for this chat";
    if (r.status === 503) return "no endpoint";
    if (r.status === 0) return "offline";
    return String(r.data || "not done");
  }

  function ensureSession() {
    if (sid) return Promise.resolve(true);
    return client.create(doc).then(function (r) {
      if (!r.ok) {
        note(refused(r));
        return false;
      }
      sid = r.data.id;
      remember("effractor.chat." + doc, sid);
      return true;
    });
  }

  function say(text) {
    if (running || !text.trim()) return;
    if (info && C.bytes(text) > info.message_bytes) return note("too long for this chat");
    if (info && text.length > info.context * 3) return note("too long for the model");
    note("");
    ensureSession().then(function (ok) {
      if (!ok) return;
      input.value = "";
      fit();
      pin = true;
      running = true;
      stopping = false;
      ending = null;
      live = [];
      turnDoc = doc;
      var mine = ++turnNo, before = app.state.text;
      draw();
      client.send(sid, text, P.stateLine(app), listen(mine)).then(function (r) { return step(r, before, mine, false); });
    });
  }

  // The events of turn `mine`; none once it has been left (abandon()).
  function listen(mine) {
    return function (e) {
      if (mine !== turnNo) return;
      live.push(e);
      if (e.event === "end") ending = e.data.reason;
      if (e.event === "error") ending = "error";
      if (e.event === "error") note(e.data.reason);
      schedule();
    };
  }

  // The document changed under a running turn: it is stopped on the server,
  // and its loop here ends without running another call (the executor
  // refuses calls on another document too).
  function abandon() {
    if (!running) return;
    client.stop(sid);
    turnNo++;
    running = false;
    stopping = false;
    live = [];
    answered = null;
    note("the turn was stopped: its document was closed");
  }

  // After each streamed step: run its tool calls and go on, or finish.
  // `held`: the step answered tool results, so the turn is still ours on the
  // server, and a failed POST would leave it held: it is stopped.
  function step(r, before, mine, held) {
    if (mine !== turnNo) return;
    if (!r.ok) {
      running = false;
      live = [];
      // Only when the results never reached the server is its claim still
      // held: a 400 means it moved on (the turn was taken over), a 409 is
      // someone else's turn, a 429 ended it already.
      if (held && (r.status === 0 || r.status === 413 || r.status >= 500)) {
        client.stop(sid);
        note("the tool results were not sent (" + refused(r) + "), so the turn was stopped");
      } else note(refused(r));
      return load();
    }
    var calls = live.filter(function (e) { return e.event === "tool_call"; }).map(function (e) { return e.data; });
    // The step is stored now: drawn from the session, not twice.
    return load(function () { live = []; }).then(function () {
      if (mine !== turnNo) return;
      var turn = session && session.messages.length ? session.messages[session.messages.length - 1].turn : null;
      if (turn != null && !records[turn]) records[turn] = { before: before, after: before };
      if (ending !== "tools" || stopping) return finish(turn);
      return runCalls(calls, turn, mine).then(function (results) {
        if (mine !== turnNo) return;
        answered = null;
        if (stopping) return finish(turn);
        return client.results(sid, results, P.stateLine(app), listen(mine)).then(function (next) { return step(next, before, mine, true); });
      });
    });
  }

  function runCalls(calls, turn, mine) {
    var profile = app.state.doc ? app.state.doc.profile : null;
    var components = profile === "architecture"
      ? app.solver.catalog().then(function (a) { return a.ok || null; }, function () { return null; })
      : Promise.resolve(null);
    return Promise.all([loadCatalog(), components]).then(function (got) {
      var x = P.createExecutor({ app: app, tools: TOOLS, catalog: got[0], componentCatalog: got[1], profile: profile,
        docId: turnDoc, openId: function () { return A.sync && A.sync.openId ? A.sync.openId() : null; } });
      var access = viewer() ? "read" : "edit";
      answered = [];
      answered.turn = turn;
      return calls.reduce(function (chain, call) {
        return chain.then(function () {
          if (stopping || mine !== turnNo) return;
          return x.run(call, access).then(function (result) {
            if (mine !== turnNo) return;
            answered.push(result);
            draw();
          });
        });
      }, Promise.resolve()).then(function () {
        // Calls not run (stopped) are said so by the server.
        return answered.map(function (a) { return { id: a.id, ok: a.ok, output: a.output }; });
      });
    });
  }

  function finish(turn) {
    running = false;
    answered = null;
    if (turn != null && records[turn]) records[turn].after = app.state.text;
    draw();
  }

  // ---- the session menu ----

  function sessionMenu() {
    var anchor = titleButton.getBoundingClientRect();
    client.sessions(doc).then(function (r) {
      var me = A.session.user ? A.session.user.id : null;
      var owner = session && session.role === "owner";
      var items = [["New session", "", function () {
        sid = null;
        session = null;
        records = {};
        ending = null;
        remember("effractor.chat." + doc, null);
        draw();
        input.focus();
      }]];
      (r.ok ? r.data : []).forEach(function (s) {
        var label = (s.title || "Untitled") + " · " + s.created_by_name + " · " + new Date(s.created_at * 1000).toLocaleDateString();
        var openIt = function () {
          sid = s.id;
          remember("effractor.chat." + doc, sid);
          ending = null;
          load();
        };
        if (s.created_by === me || owner) {
          items.push([label, "", [
            ["Open", "", openIt],
            ["Rename", "", function () { openIt(); renameInPlace(s); }],
            ["Delete", "", function () { removeSession(s); }],
          ]]);
        } else items.push([label, "", openIt]);
      });
      app.showMenu(items, anchor.left, anchor.bottom, anchor);
    });
  }

  function renameInPlace(s) {
    var field = el("input");
    field.value = s.title || "";
    titleButton.hidden = true;
    titleButton.after(field);
    field.focus();
    var done = function (save) {
      if (!field.isConnected) return;
      field.remove();
      titleButton.hidden = false;
      if (!save || !field.value.trim()) return;
      client.rename(s.id, field.value.trim()).then(function (r) {
        if (!r.ok) note(refused(r));
        load();
      });
    };
    field.addEventListener("keydown", function (e) {
      e.stopPropagation();
      if (e.key === "Enter") done(true);
      if (e.key === "Escape") done(false);
    });
    field.addEventListener("blur", function () { done(true); });
  }

  function removeSession(s) {
    client.remove(s.id).then(function (r) {
      if (!r.ok) return note(refused(r));
      if (sid === s.id) {
        sid = null;
        session = null;
        remember("effractor.chat." + doc, null);
        draw();
      }
      app.say("deleted “" + (s.title || "Untitled") + "”", [["Undo", function () {
        client.restore(s.id).then(function () {
          sid = s.id;
          remember("effractor.chat." + doc, sid);
          load();
        });
      }]]);
    });
  }

  // ---- wiring ----

  openButton.addEventListener("click", toggle);
  $("chat-close").addEventListener("click", function () {
    close();
    openButton.focus();
  });
  titleButton.addEventListener("click", function () { if (doc != null) sessionMenu(); });
  // Granted or configured just now: asked again when the admin is done.
  var adminDialog = $("admin-dialog");
  if (adminDialog) adminDialog.addEventListener("close", refresh);
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (running) {
      stopping = true;
      return client.stop(sid);
    }
    say(input.value);
  });
  // The field grows with what is typed, up to a few lines.
  function fit() {
    input.style.setProperty("height", "auto");
    input.style.setProperty("height", Math.min(input.scrollHeight + 2, 128) + "px");
  }
  input.addEventListener("input", fit);
  input.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      form.requestSubmit();
    }
  });
  chat.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    e.stopPropagation();
    if (e.target === input) input.blur();
    else {
      close();
      openButton.focus();
    }
  });
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key === ".") {
      e.preventDefault();
      toggle();
    }
  });

  // The width, dragged at the inner edge; the pointer is taken only once a
  // press becomes a drag. Followed on the document, so a press that leaves
  // the edge before that still ends where it is released.
  var saved = Number(recall(WIDTH));
  document.documentElement.style.setProperty("--chat-width", (saved >= 300 && saved <= 560 ? saved : 360) + "px");
  edge.addEventListener("pointerdown", function (e) {
    var startX = e.clientX, startW = chat.getBoundingClientRect().width, dragging = false;
    function move(m) {
      if (!dragging && Math.abs(m.clientX - startX) < 3) return;
      if (!dragging) {
        dragging = true;
        chat.classList.add("is-resizing");
        edge.setPointerCapture(e.pointerId);
      }
      var w = Math.max(300, Math.min(560, Math.round(startW + m.clientX - startX)));
      document.documentElement.style.setProperty("--chat-width", w + "px");
    }
    function up() {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", up);
      chat.classList.remove("is-resizing");
      if (dragging) remember(WIDTH, Math.round(chat.getBoundingClientRect().width));
    }
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", up);
  });

  app.ready.then(refresh);
  if (A.session && A.session.onChange) A.session.onChange(function () {
    info = null;
    refresh();
  });
  var lastDoc = null;
  app.onChange(function () {
    var id = A.sync && A.sync.openId ? A.sync.openId() : null;
    if (id !== lastDoc) {
      lastDoc = id;
      refresh();
    }
    if (isOpen() && !running) draw();
  });
})();
