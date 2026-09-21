// Working state (spec 7.2): the text being edited, kept in this browser across
// reloads, and the name a document is saved under. One document, one key —
// IndexedDB because the spec says so and a share list will join it there.
// Where there is no IndexedDB (a private window may refuse it) nothing is
// kept and nothing fails.
(function () {
  var DB = "effractor";
  var STORE = "working";
  var KEY = "document";

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
      // The text last saved, or null.
      load: function () {
        return request("readonly", function (s) {
          return s.get(KEY);
        }).then(function (text) {
          return typeof text === "string" ? text : null;
        });
      },
      save: function (text) {
        return request("readwrite", function (s) {
          return s.put(text, KEY);
        });
      },
      clear: function () {
        return request("readwrite", function (s) {
          return s.delete(KEY);
        });
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
