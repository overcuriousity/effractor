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
          req = idb.open(DB, 1);
        } catch (e) {
          return resolve(null);
        }
        req.onupgradeneeded = function () {
          req.result.createObjectStore(STORE);
        };
        req.onsuccess = function () {
          resolve(req.result);
        };
        req.onerror = req.onblocked = function () {
          resolve(null);
        };
      });
      return opened;
    }

    // `run` gets the object store and returns a request; resolves to its result,
    // or to null if there is no database or the request fails.
    function request(mode, run) {
      return open().then(function (db) {
        if (!db) return null;
        return new Promise(function (resolve) {
          var req;
          try {
            req = run(db.transaction(STORE, mode).objectStore(STORE));
          } catch (e) {
            return resolve(null);
          }
          req.onsuccess = function () {
            resolve(req.result === undefined ? null : req.result);
          };
          req.onerror = function () {
            resolve(null);
          };
        });
      });
    }

    return {
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
