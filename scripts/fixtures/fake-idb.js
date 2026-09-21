// Asynchronous requests and transaction completion, including a late abort.
function fakeIndexedDB(options = {}) {
  const stores = new Map();
  let version = options.version || 0;
  if (version) stores.set('working', new Map([['document', options.working]]));
  const db = {
    objectStoreNames: { contains: name => stores.has(name) },
    createObjectStore: name => stores.set(name, new Map()),
    close() {},
    transaction(name) {
      const map = stores.get(name);
      if (!map) throw new Error('NotFoundError');
      const tx = {};
      function request(action) {
        const req = {};
        setTimeout(() => {
          if (options.abort) {
            if (tx.onabort) tx.onabort();
            return;
          }
          req.result = action();
          if (req.onsuccess) req.onsuccess();
          if (tx.oncomplete) tx.oncomplete();
        }, 0);
        return req;
      }
      tx.objectStore = () => ({
        get: key => request(() => map.get(key)),
        getAll: () => request(() => [...map.values()]),
        put: (value, key) => request(() => { map.set(key, value); return key; }),
        delete: key => request(() => { map.delete(key); }),
      });
      return tx;
    },
  };
  return {
    open(name, requested) {
      if (options.refuses) throw new Error('SecurityError');
      const req = {};
      setTimeout(() => {
        req.result = db;
        if (requested > version && req.onupgradeneeded) req.onupgradeneeded();
        version = requested;
        if (req.onsuccess) req.onsuccess();
      }, 0);
      return req;
    },
  };
}
module.exports = { fakeIndexedDB };
