// The chat's routes (chat spec §4.3) over an injected fetch, and the reply
// stream read as it arrives. Every answer resolves; a refusal is data for the
// caller to show, and no network is status 0.
(function () {
  var base = typeof document !== "undefined" && document.currentScript
    ? new URL("../../../", document.currentScript.src).pathname.replace(/\/$/, "")
    : "";

  // Server-sent events, whatever the chunking: {event, data} with data parsed.
  function createParser() {
    var buf = "";
    function block(text) {
      var event = "", data = [];
      text.split("\n").forEach(function (line) {
        line = line.replace(/\r$/, "");
        if (line.indexOf("event:") === 0) event = line.slice(6).trim();
        else if (line.indexOf("data:") === 0) data.push(line.slice(5).replace(/^ /, ""));
      });
      if (!data.length) return null;
      var raw = data.join("\n");
      try {
        return { event: event, data: JSON.parse(raw) };
      } catch (e) {
        return { event: event, data: raw };
      }
    }
    return {
      feed: function (text) {
        buf += text.replace(/\r\n/g, "\n");
        var out = [], at;
        while ((at = buf.indexOf("\n\n")) >= 0) {
          var one = block(buf.slice(0, at));
          buf = buf.slice(at + 2);
          if (one) out.push(one);
        }
        return out;
      },
    };
  }

  function createAssistantClient(fetchImpl, prefix) {
    var root = prefix === undefined ? base : prefix;

    function send(method, path, body) {
      var init = { method: method, credentials: "same-origin", headers: {} };
      if (body !== undefined) {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      return Promise.resolve().then(function () { return fetchImpl(root + path, init); });
    }

    function request(method, path, body) {
      return send(method, path, body).then(function (res) {
        if (res.status === 204) return { ok: res.ok, status: res.status, data: null };
        var type = (res.headers && res.headers.get("content-type")) || "";
        var read = type.indexOf("application/json") === 0 ? res.json() : res.text();
        return read.then(function (data) {
          return { ok: res.ok, status: res.status, data: data === "" ? null : data };
        });
      }, function () {
        return { ok: false, status: 0, data: "offline" };
      });
    }

    // A POST answered with a stream: each event to `on`, resolved at its end.
    function stream(path, body, on) {
      return send("POST", path, body).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) { return { ok: false, status: res.status, data: text }; });
        }
        var reader = res.body.getReader(), decoder = new TextDecoder(), parser = createParser();
        function pump() {
          return reader.read().then(function (step) {
            if (step.done) {
              parser.feed(decoder.decode() + "\n\n").forEach(on);
              return { ok: true, status: res.status };
            }
            parser.feed(decoder.decode(step.value, { stream: true })).forEach(on);
            return pump();
          });
        }
        return pump();
      }).catch(function () {
        return { ok: false, status: 0, data: "offline" };
      });
    }

    var S = "/api/assistant/sessions/";
    return {
      info: function () { return request("GET", "/api/assistant"); },
      sessions: function (doc) { return request("GET", "/api/documents/" + doc + "/assistant/sessions"); },
      create: function (doc) { return request("POST", "/api/documents/" + doc + "/assistant/sessions"); },
      get: function (sid) { return request("GET", S + sid); },
      rename: function (sid, title) { return request("PATCH", S + sid, { title: title }); },
      remove: function (sid) { return request("DELETE", S + sid); },
      restore: function (sid) { return request("POST", S + sid + "/restore"); },
      stop: function (sid) { return request("POST", S + sid + "/stop"); },
      send: function (sid, text, state, on) { return stream(S + sid + "/messages", { text: text, state: state }, on); },
      results: function (sid, results, state, on) { return stream(S + sid + "/results", { results: results, state: state }, on); },
      request: request,
    };
  }

  var api = { createParser: createParser, createAssistantClient: createAssistantClient };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorAssistantClient = api;
})();
