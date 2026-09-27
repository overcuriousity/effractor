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
  var records = {};      // turn → {before, after}: Undo turn, in this page only
  var catalog = null;    // tools.json

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
      doc = null;
      return;
    }
    if (id !== doc) {
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

  function load() {
    if (doc == null) {
      session = null;
      return Promise.resolve(draw());
    }
    if (!sid) {
      session = null;
      return Promise.resolve(draw());
    }
    return client.get(sid).then(function (r) {
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
    var box = el("div", "chat-quiet");
    box.appendChild(el("p", null, "Goes to " + (info && info.host) + " · " + (info && info.model)));
    if (viewer()) box.appendChild(el("p", null, "can read, not edit"));
    return box;
  }

  function callLine(row) {
    var b = el("button", "chat-call" + (row.result && !row.result.ok ? " is-refused" : ""), row.words);
    b.type = "button";
    var detail = null;
    var target = row.result && row.result.ok ? String(row.result.output).split(" → ")[1] : null;
    if (!target && row.name === "show" && row.input) target = row.input.id;
    b.addEventListener("click", function () {
      if (target && app.state.selected !== target) return app.select(target);
      if (detail) {
        detail.remove();
        detail = null;
        return;
      }
      detail = el("pre", null, JSON.stringify(row.input, null, 1) + (row.result ? "\n→ " + row.result.output : ""));
      b.after(detail);
    });
    return b;
  }

  // Sessions belong to a document kept in the account: say so, and offer it.
  function unsaved() {
    titleButton.textContent = "Chat";
    log.textContent = "";
    var box = el("div", "chat-quiet");
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
    var rows = T.rows(messages, live);
    var atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    log.textContent = "";
    if (!rows.length) log.appendChild(empty());
    var lastTurn = rows.length ? rows[rows.length - 1].turn : null;
    rows.forEach(function (row) {
      if (row.kind === "user") {
        log.appendChild(el("div", "chat-who", row.author));
        log.appendChild(el("div", "chat-user", row.text));
      } else if (row.kind === "said") {
        var box = el("div", "chat-said-by-agent");
        box.appendChild(M.render(M.parse(row.text), document));
        if (row.interrupted) box.appendChild(el("p", "chat-quiet", "interrupted"));
        log.appendChild(box);
      } else if (row.kind === "thinking") {
        var d = el("details");
        d.appendChild(el("summary", null, "thinking"));
        d.appendChild(el("pre", null, row.text));
        log.appendChild(d);
      } else if (row.kind === "call") {
        log.appendChild(callLine(row));
      } else if (row.kind === "marker") {
        log.appendChild(el("p", "chat-quiet", "… " + row.n + " earlier turns left out"));
      } else if (row.kind === "tokens") {
        log.appendChild(el("div", "chat-tokens", "in " + (row.input == null ? "—" : row.input) + " · out " + (row.output == null ? "—" : row.output)));
      }
    });
    if (!running && lastTurn != null) {
      var record = records[lastTurn];
      if (record) {
        var can = T.undoTurn(record, app.state.text);
        var u = el("button", "btn btn-ghost chat-undo", "Undo turn");
        u.type = "button";
        u.disabled = !can.offer;
        if (!can.offer) u.title = can.why;
        u.addEventListener("click", function () { undoTurn(record); });
        if (record.before !== record.after) log.appendChild(u);
      }
      if (ending === "steps") {
        var more = el("button", "link-button", "Continue");
        more.type = "button";
        more.addEventListener("click", function () { say("Continue."); });
        log.appendChild(more);
      }
    }
    sendButton.textContent = running ? "Stop" : "Send";
    if (atEnd || running) log.scrollTop = log.scrollHeight;
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
    if (info && text.length > info.message_bytes) return note("too long for this chat");
    if (info && text.length > info.context * 3) return note("too long for the model");
    note("");
    ensureSession().then(function (ok) {
      if (!ok) return;
      input.value = "";
      running = true;
      stopping = false;
      ending = null;
      live = [];
      var before = app.state.text;
      draw();
      client.send(sid, text, P.stateLine(app), onEvent).then(function (r) { return step(r, before); });
    });
  }

  function onEvent(e) {
    live.push(e);
    if (e.event === "end") ending = e.data.reason;
    if (e.event === "error") ending = "error";
    if (e.event === "error") note(e.data.reason);
    draw();
  }

  // After each streamed step: run its tool calls and go on, or finish.
  function step(r, before) {
    if (!r.ok) {
      running = false;
      live = [];
      note(refused(r));
      return load();
    }
    var calls = live.filter(function (e) { return e.event === "tool_call"; }).map(function (e) { return e.data; });
    return load().then(function () {
      live = [];
      var turn = session && session.messages.length ? session.messages[session.messages.length - 1].turn : null;
      if (turn != null && !records[turn]) records[turn] = { before: before, after: before };
      if (ending !== "tools" || stopping) return finish(turn);
      return runCalls(calls, turn).then(function (results) {
        answered = null;
        if (stopping) return finish(turn);
        return client.results(sid, results, P.stateLine(app), onEvent).then(function (next) { return step(next, before); });
      });
    });
  }

  function runCalls(calls, turn) {
    var profile = app.state.doc ? app.state.doc.profile : null;
    var components = profile === "architecture"
      ? app.solver.catalog().then(function (a) { return a.ok || null; }, function () { return null; })
      : Promise.resolve(null);
    return Promise.all([loadCatalog(), components]).then(function (got) {
      var x = P.createExecutor({ app: app, tools: TOOLS, catalog: got[0], componentCatalog: got[1], profile: profile });
      var access = viewer() ? "read" : "edit";
      answered = [];
      answered.turn = turn;
      return calls.reduce(function (chain, call) {
        return chain.then(function () {
          if (stopping) return;
          return x.run(call, access).then(function (result) {
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
  // press becomes a drag.
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
      edge.removeEventListener("pointermove", move);
      edge.removeEventListener("pointerup", up);
      chat.classList.remove("is-resizing");
      if (dragging) remember(WIDTH, Math.round(chat.getBoundingClientRect().width));
    }
    edge.addEventListener("pointermove", move);
    edge.addEventListener("pointerup", up);
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
