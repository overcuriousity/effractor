// Working state (spec 7.2): the text being edited, kept in this browser across
// reloads, and the name a document is saved under. One text per mode (fault
// tree, attack tree, architecture) and the mode last used — IndexedDB
// because the spec says so and a share list will join it there.
// Where there is no IndexedDB (a private window may refuse it) nothing is
// kept and nothing fails; save says so, for the page to tell.
(function () {
  var DB = "effractor";
  var STORE = "working";
  // Before modes there was one text for all of them: it is handed over once.
  var LEGACY = "document";
  var MODE = "mode";
  function keyOf(profile) {
    return "document:" + profile;
  }

  function createStore(idb) {
    var opened = null;

    function open() {
      if (opened) return opened;
      opened = new Promise(function (resolve) {
        if (!idb) return resolve(null);
        var req;
        try {
          req = idb.open(DB, 2);
        } catch (e) {
          return resolve(null);
        }
        req.onupgradeneeded = function () {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
          if (!req.result.objectStoreNames.contains("shares")) req.result.createObjectStore("shares");
        };
        req.onsuccess = function () {
          req.result.onversionchange = function () { req.result.close(); opened = null; };
          resolve(req.result);
        };
        req.onerror = req.onblocked = function () {
          resolve(null);
        };
      });
      return opened;
    }

    // Writes succeed only when the transaction commits, not at request success.
    function request(mode, run, name, strict) {
      return open().then(function (db) {
        if (!db) return strict ? false : null;
        return new Promise(function (resolve) {
          var req, tx, value;
          try {
            tx = db.transaction(name || STORE, mode);
            req = run(tx.objectStore(name || STORE));
          } catch (e) { return resolve(strict ? false : null); }
          req.onsuccess = function () { value = req.result; };
          tx.oncomplete = function () { resolve(strict ? true : (value === undefined ? null : value)); };
          req.onerror = tx.onerror = tx.onabort = function () { resolve(strict ? false : null); };
        });
      });
    }

    function get(key) {
      return request("readonly", function (s) {
        return s.get(key);
      }).then(function (value) {
        return typeof value === "string" ? value : null;
      });
    }
    function put(value, key) {
      return request("readwrite", function (s) {
        return s.put(value, key);
      });
    }
    function remove(key) {
      return request("readwrite", function (s) {
        return s.delete(key);
      });
    }

    return {
      shares: function () {
        return request("readonly", function (s) { return s.getAll(); }, "shares").then(function (rows) { return rows || []; });
      },
      saveShare: function (share) {
        return request("readwrite", function (s) { return s.put(share, share.id); }, "shares", true);
      },
      removeShare: function (id) {
        return request("readwrite", function (s) { return s.delete(id); }, "shares", true);
      },
      // The text last saved in that mode, or null.
      load: function (profile) {
        return get(keyOf(profile));
      },
      // Resolves true once kept, false when the browser refused.
      save: function (text, profile) {
        return request("readwrite", function (s) {
          return s.put(text, keyOf(profile));
        }, STORE, true);
      },
      // The mode last used, or null.
      mode: function () {
        return get(MODE);
      },
      setMode: function (profile) {
        return put(profile, MODE);
      },
      // Which server document a mode's working text is (accounts spec §6.3).
      binding: function (profile) {
        return get("server:" + profile).then(function (v) {
          try { return v ? JSON.parse(v) : null; } catch (e) { return null; }
        });
      },
      bind: function (profile, value) {
        return value ? put(JSON.stringify(value), "server:" + profile) : remove("server:" + profile);
      },
      legacy: function () {
        return get(LEGACY);
      },
      dropLegacy: function () {
        return remove(LEGACY);
      },
    };
  }

  // "Web server unavailable" → web-server-unavailable.yaml. A file name, so
  // nothing a file system minds; never empty.
  function fileName(name) {
    var stem = String(name || "")
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
    return (stem || "untitled") + ".yaml";
  }

  var api = { createStore: createStore, fileName: fileName };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorStore = api;
})();
