// Saving the open document a moment after each edit (accounts spec §6.1–6.2),
// pure: the caller gives the request and the timers. A save carries the
// version it was based on; a 409 is somebody else's newer save and stops
// everything until the person chooses, a missing network retries, a 404/403
// means the document is no longer theirs to save.
(function () {
  var WAITS = [2000, 4000, 8000, 16000, 32000, 60000];

  function createAutosave(o) {
    // Called as plain functions: a browser refuses setTimeout as a method
    // of any object but the window.
    var timers = o.timers || {
      set: function (fn, ms) { return setTimeout(fn, ms); },
      clear: function (id) { clearTimeout(id); },
    };
    var delay = o.delay == null ? 800 : o.delay;
    var version = null, saved = null, pending = null, name = null;
    var timer = null, inflight = null, state = "saved", tries = 0, stopped = false, refused = null;

    function set(s) {
      if (state === s) return;
      state = s;
      if (o.onState) o.onState(s);
    }
    function schedule(ms) {
      if (timer) timers.clear(timer);
      timer = timers.set(run, ms);
    }
    function retry() {
      set("retrying");
      schedule(WAITS[Math.min(tries++, WAITS.length - 1)]);
    }
    function run() {
      timer = null;
      if (stopped || pending === null || pending === saved) return Promise.resolve();
      if (inflight) return inflight.then(run);
      var body = pending, base = version;
      set("saving");
      // Asked at once, not a tick later: a save as the page closes must
      // leave before it does.
      var asked;
      try {
        asked = Promise.resolve(o.put(name, body, base));
      } catch (e) {
        asked = Promise.reject(e);
      }
      inflight = asked.then(function (res) {
        inflight = null;
        // A save is an answer with the version it made; anything else (a
        // proxy's page with a 200) is not known to have saved.
        if (res && res.ok && res.data && typeof res.data.version === "number") {
          tries = 0;
          version = res.data.version;
          saved = body;
          if (pending !== body) return run();
          set("saved");
          return;
        }
        if (res.status === 409 && res.data && typeof res.data === "object") {
          stopped = true;
          set("conflict");
          if (o.onConflict) o.onConflict({ theirs: res.data, mine: body });
          return;
        }
        // The session ended (expired, or revoked elsewhere): retrying is
        // pointless until somebody logs in again.
        if (res.status === 401) {
          stopped = true;
          set("loggedout");
          if (o.onLoggedOut) o.onLoggedOut();
          return;
        }
        // The server will not take this text (too large, not valid): the
        // same text would be refused again.
        if (res.status === 400 || res.status === 413) {
          stopped = true;
          refused = body;
          set("refused");
          if (o.onRefused) o.onRefused(res.data);
          return;
        }
        if (res.status === 404 || res.status === 403) {
          stopped = true;
          set("lost");
          if (o.onLost) o.onLost(res.status);
          return;
        }
        retry();
      }, function () {
        // The request itself failed: tried again, never left in the way of
        // every later save.
        inflight = null;
        retry();
      });
      return inflight;
    }

    return {
      bind: function (b) {
        if (timer) timers.clear(timer);
        timer = null; version = b.version; saved = b.saved; pending = null; tries = 0; stopped = false;
        set("saved");
      },
      change: function (text, docName) {
        // A refusal was about that text: another one may be taken.
        if (stopped && state === "refused" && text !== refused) {
          stopped = false;
          set("saved");
        }
        if (stopped || version === null) return;
        pending = text;
        name = docName;
        if (text !== saved) return schedule(delay);
        // Back to what the server has (an undo): nothing waits any more.
        if (timer) timers.clear(timer);
        timer = null;
        tries = 0;
        if (!inflight) set("saved");
      },
      flush: function () {
        if (timer) timers.clear(timer);
        timer = null;
        return run();
      },
      stop: function () {
        stopped = true;
        if (timer) timers.clear(timer);
        timer = null;
      },
      state: function () { return state; },
      name: function () { return name; },
      version: function () { return version; },
      saved: function () { return saved; },
    };
  }

  var api = { createAutosave: createAutosave };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") {
    window.effractorAccounts = window.effractorAccounts || {};
    window.effractorAccounts.createAutosave = createAutosave;
  }
})();
