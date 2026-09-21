// The least IndexedDB store.js needs, for `node --test`: one database, object
// stores as maps, requests that answer in a later turn as the real ones do.
function fakeIndexedDB(options) {
  const stores = new Map();
  const later = (req, result) => {
    setTimeout(() => {
      req.result = result;
      if (req.onsuccess) req.onsuccess();
    }, 0);
    return req;
  };
  const db = {
    createObjectStore: (name) => stores.set(name, new Map()),
    transaction: (name) => ({
      objectStore: () => {
        const map = stores.get(name);
        return {
          get: (key) => later({}, map.get(key)),
          put: (value, key) => later({}, void map.set(key, value)),
          delete: (key) => later({}, void map.delete(key)),
        };
      },
    }),
  };
  let created = false;
  return {
    open() {
      if (options && options.refuses) throw new Error("SecurityError");
      const req = {};
      setTimeout(() => {
        req.result = db;
        if (!created && req.onupgradeneeded) req.onupgradeneeded();
        created = true;
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}

module.exports = { fakeIndexedDB };
