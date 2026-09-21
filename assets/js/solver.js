// The page's side of the solver worker: promises over its messages, one solve
// at a time, and a fresh worker after a crash. No model logic lives here.
(function () {
  function createSolver(makeWorker) {
    var worker = null;
    var pending = {}; // id -> {resolve, reject, on}; `on` marks a solve: {onExact, onProgress}
    var nextId = 1;
    var solving = null;

    var solver = {
      onCrash: null,
      validate: function (text) {
        return request({ type: "validate", text: text });
      },
      parse: function (text) {
        return request({ type: "parse", text: text });
      },
      serialize: function (document) {
        return request({ type: "serialize", document: document });
      },
      // Resolves to {result} or {cancelled: true}. `result` is what the solver
      // said: {ok, diagnostics} or {diagnostics}.
      solve: function (text, on) {
        solving = nextId;
        return request({ type: "solve", text: text }, on || {});
      },
      cancel: function () {
        if (solving !== null && worker) worker.postMessage({ id: solving, type: "cancel" });
      },
      // Panics the wasm module on purpose, to see the recovery work.
      crash: function () {
        ensure().postMessage({ type: "crash" });
      },
    };

    function ensure() {
      if (worker) return worker;
      worker = makeWorker();
      worker.onmessage = function (e) {
        receive(e.data);
      };
      worker.onerror = function (e) {
        crashed((e && e.message) || "the solver worker failed");
      };
      return worker;
    }

    function request(message, on) {
      var id = nextId++;
      message.id = id;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject, on: on };
        ensure().postMessage(message);
      });
    }

    function settle(id) {
      var p = pending[id];
      delete pending[id];
      if (solving === id) solving = null;
      return p;
    }

    function receive(m) {
      if (m.type === "crashed") return crashed(m.message);
      var p = pending[m.id];
      if (!p) return;
      if (m.type === "exact") p.on.onExact && p.on.onExact(m.result);
      else if (m.type === "progress") p.on.onProgress && p.on.onProgress(m.done, m.total);
      else if (m.type === "cancelled") settle(m.id).resolve({ cancelled: true });
      else if (m.type === "result") settle(m.id).resolve(p.on ? { result: m.result } : m.result);
    }

    function crashed(message) {
      if (worker) worker.terminate();
      worker = null;
      var waiting = pending;
      pending = {};
      solving = null;
      Object.keys(waiting).forEach(function (id) {
        waiting[id].reject(new Error(message));
      });
      if (solver.onCrash) solver.onCrash(message);
    }

    return solver;
  }

  if (typeof module !== "undefined") module.exports = { createSolver: createSolver };
  if (typeof window !== "undefined") window.createSolver = createSolver;
})();
