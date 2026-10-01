// The chat's administration (chat spec §5), for site admins: the endpoint
// with its models listed as typed and a Test, the limits, who may use it,
// and what was used. The key is never shown; the field only replaces it.
(function () {
  if (typeof document === "undefined") return;
  var A = window.effractorAccounts, M = window.effractorMenu, client = A && A.client;
  if (!A || !client) return;

  var LIMITS = [
    ["steps", "Steps per turn", 1, 10000],
    ["context", "Context (tokens)", 1024, 10000000],
    ["reply_tokens", "Reply (tokens)", 16, 1000000],
    ["message_bytes", "Message size (bytes)", 1024, 8 << 20],
    ["daily_tokens", "Daily tokens per user", 1, 1e12],
    ["timeout_seconds", "Timeout (s)", 5, 3600],
  ];

  var el = window.effractorDom.el;
  function button(text, fn, cls) {
    var b = el("button", text, cls || "btn btn-ghost");
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  }
  function row(grid, text, control) {
    var l = el("label", text);
    grid.appendChild(l);
    grid.appendChild(control);
    return control;
  }
  function refused(res) {
    return res.status === 403 ? String(res.data || "not yours to change") : res.status === 0 ? "offline" : String(res.data || "not done");
  }

  function grantSwitch(on, who, say) {
    var pick = M.dropdown([["off", "Off"], ["on", "On"]], on ? "on" : "off");
    pick.addEventListener("change", function () {
      client.request(pick.value === "on" ? "PUT" : "DELETE", "/api/admin/assistant/grants", who).then(function (res) {
        say(res.ok ? "saved" : refused(res));
      });
    });
    return pick;
  }
  function granted(grants, who) {
    return grants.some(function (g) { return g.user === who.user && who.user != null || g.group === who.group && who.group != null; });
  }

  function show(box, say) {
    box.textContent = "";
    return Promise.all([
      client.request("GET", "/api/admin/assistant"),
      client.request("GET", "/api/admin/users"),
      client.request("GET", "/api/admin/groups"),
    ]).then(function (r) {
      if (!r[0].ok) return say(refused(r[0]));
      draw(box, say, r[0].data, r[1].ok ? r[1].data : [], r[2].ok ? r[2].data : []);
    });
  }

  function draw(box, say, got, users, groups) {
    var cfg = got.config;
    box.appendChild(el("h3", "Endpoint", "label"));
    var grid = el("div", null, "dialog-grid");
    box.appendChild(grid);
    var provider = row(grid, "Provider", M.dropdown([["openai", "OpenAI-compatible"], ["anthropic", "Anthropic"]], cfg.provider));
    var address = row(grid, "Address", el("input"));
    address.value = cfg.address;
    address.placeholder = cfg.provider === "anthropic" ? "https://api.anthropic.com" : "http://localhost:11434/v1";
    // Fixed as the pinned key is: set by the operator, or the one the
    // operator's key was first saved with, which it goes to alone.
    var addressNote = el("p", null, "hint");
    grid.appendChild(addressNote);
    function fixAddress() {
      address.disabled = !!cfg.address_fixed;
      addressNote.textContent = cfg.address_pinned ? "address set by the operator" : cfg.address_fixed ? "address fixed: the operator's key goes only here" : "";
      addressNote.hidden = !cfg.address_fixed;
    }
    fixAddress();
    var key = row(grid, "Key", el("input"));
    key.type = "password";
    key.autocomplete = "off";
    key.placeholder = cfg.key_pinned ? "set by the operator" : cfg.key_set ? "stored · type to replace" : "not set";
    key.disabled = cfg.key_pinned;
    var agent = row(grid, "User-Agent", el("input"));
    agent.value = cfg.user_agent || "";
    agent.placeholder = "only if the endpoint asks";
    var modelBox = row(grid, "Model", el("span"));
    var model = null, contextTouched = false;
    var reason = el("p", null, "hint");

    function modelField(list) {
      modelBox.textContent = "";
      var current = model ? model.value : cfg.model;
      if (list.length) {
        var options = list.map(function (m) { return [m.id, m.id]; });
        if (current && !list.some(function (m) { return m.id === current; })) options.unshift([current, current]);
        model = M.dropdown(options, current || list[0].id);
        model.addEventListener("change", function () {
          var hit = list.filter(function (m) { return m.id === model.value; })[0];
          if (hit && hit.context && !contextTouched) limits.context.value = hit.context;
        });
      } else {
        model = el("input");
        model.value = current || "";
      }
      modelBox.appendChild(model);
    }
    modelField([]);

    var asked = 0, timer = null;
    function listModels() {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var mine = ++asked;
        var body = { provider: provider.value, address: address.value };
        if (key.value) body.key = key.value;
        body.user_agent = agent.value.trim();
        client.request("POST", "/api/admin/assistant/models", body).then(function (res) {
          if (mine !== asked) return;
          var list = res.ok ? res.data.models : [];
          modelField(list);
          // Listing needs a recent login, as saving does: an old one is told.
          reason.textContent = !res.ok ? "models: " + refused(res) : res.data.reason ? "models: " + res.data.reason : "";
        });
      }, 400);
    }
    [address, key, agent].forEach(function (f) { f.addEventListener("input", listModels); });
    if (cfg.address) listModels();
    grid.appendChild(reason);

    var tested = el("p", null, "hint");
    var test = el("div", null, "dialog-actions");
    test.appendChild(button("Test", function () {
      tested.textContent = "…";
      told = tested;
      save(true).then(function (ok) {
        if (!ok) return;
        client.request("POST", "/api/admin/assistant/test").then(function (res) {
          tested.textContent = res.ok ? res.data.said : refused(res);
        });
      });
    }));
    grid.appendChild(test);
    grid.appendChild(tested);

    box.appendChild(el("h3", "Limits", "label"));
    var lgrid = el("div", null, "dialog-grid");
    box.appendChild(lgrid);
    var limits = {};
    LIMITS.forEach(function (l) {
      var f = row(lgrid, l[1], el("input"));
      f.inputMode = "numeric";
      f.value = cfg[l[0]] == null ? "" : cfg[l[0]];
      if (l[0] === "daily_tokens") f.placeholder = "off";
      if (l[0] === "context") f.addEventListener("input", function () { contextTouched = true; });
      limits[l[0]] = f;
    });

    // Only what changed goes; a key goes only when typed, and a new address
    // keeps the stored key.
    // What a save said, beside the button pressed as well as at the foot.
    var told = null;
    function tell(text) {
      say(text);
      if (told) told.textContent = text;
    }
    function save(quiet) {
      var body = {};
      if (provider.value !== cfg.provider) body.provider = provider.value;
      if (address.value.trim() !== cfg.address) body.address = address.value.trim();
      if (key.value) body.key = key.value;
      if (agent.value.trim() !== (cfg.user_agent || "")) body.user_agent = agent.value.trim();
      if (model && model.value !== cfg.model) body.model = model.value;
      for (var i = 0; i < LIMITS.length; i++) {
        var name = LIMITS[i][0], text = limits[name].value.trim();
        if (name === "daily_tokens" && text === "") {
          if (cfg.daily_tokens != null) body.daily_tokens = null;
          continue;
        }
        var n = Number(text.replace(",", "."));
        if (!Number.isInteger(n) || n < LIMITS[i][2] || n > LIMITS[i][3]) {
          tell(LIMITS[i][1].toLowerCase() + ": " + LIMITS[i][2] + " to " + LIMITS[i][3]);
          return Promise.resolve(false);
        }
        if (n !== cfg[name]) body[name] = n;
      }
      if (!Object.keys(body).length) {
        if (!quiet) tell("nothing changed");
        return Promise.resolve(true);
      }
      return client.request("PUT", "/api/admin/assistant", body).then(function (res) {
        if (!res.ok) {
          tell(refused(res));
          return false;
        }
        tell(quiet ? "" : "saved");
        return client.request("GET", "/api/admin/assistant").then(function (fresh) {
          if (fresh.ok) {
            cfg = fresh.data.config;
            key.value = "";
            key.placeholder = cfg.key_pinned ? "set by the operator" : cfg.key_set ? "stored · type to replace" : "not set";
            address.value = cfg.address;
            fixAddress();
          }
          return true;
        });
      });
    }
    var actions = el("div", null, "dialog-actions");
    var savedNote = el("p", null, "hint");
    actions.appendChild(button("Save", function () {
      told = savedNote;
      save(false);
    }, "btn"));
    lgrid.appendChild(actions);
    lgrid.appendChild(savedNote);

    box.appendChild(el("h3", "Who may use it", "label"));
    var ggrid = el("div", null, "dialog-grid");
    box.appendChild(ggrid);
    groups.forEach(function (g) {
      row(ggrid, g.name + " (group)", grantSwitch(granted(got.grants, { group: g.id }), { group: g.id }, say));
    });
    users.forEach(function (u) {
      row(ggrid, u.name, grantSwitch(granted(got.grants, { user: u.id }), { user: u.id }, say));
    });
    if (!groups.length && !users.length) ggrid.appendChild(el("p", "No users yet", "hint"));

    box.appendChild(el("h3", "Last 24 hours", "label"));
    if (!got.usage.length) box.appendChild(el("p", "Nothing used", "hint"));
    else {
      var table = el("table", null, "chat-usage");
      var head = el("tr");
      ["User", "Requests", "In", "Out"].forEach(function (h) { head.appendChild(el("th", h)); });
      table.appendChild(head);
      got.usage.forEach(function (u) {
        var tr = el("tr");
        tr.appendChild(el("td", u.user));
        [u.requests, u.input, u.output].forEach(function (n) { tr.appendChild(el("td", String(n), "num")); });
        table.appendChild(tr);
      });
      box.appendChild(table);
      if (got.usage.some(function (u) { return u.unreported > 0; })) {
        box.appendChild(el("p", "some requests reported no tokens · the daily budget cannot count them", "hint"));
      }
    }
  }

  // The grant, beside the other fields of a user's or group's detail.
  function extra(grid, row, tab, field, say) {
    if (!A.session.user || !A.session.user.admin || (tab !== "users" && tab !== "groups")) return;
    var who = tab === "users" ? { user: row.id } : { group: row.id };
    var slot = el("span", "…");
    field(grid, "admin-chat-grant", "Chat", slot);
    client.request("GET", "/api/admin/assistant").then(function (res) {
      if (!res.ok) return;
      var pick = grantSwitch(granted(res.data.grants, who), who, say);
      pick.id = "admin-chat-grant";
      slot.replaceWith(pick);
    });
  }

  A.assistantAdmin = { show: show };
  A.adminExtras = (A.adminExtras || []).concat([extra]);
})();
