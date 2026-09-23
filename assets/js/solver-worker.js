// The solver's worker: the wasm module and a message loop around it.
//
// in   {id, type: "validate" | "parse", text}    out  {id, type: "result", result}
//      {id, type: "serialize", document}              {id, type: "result", result}
//      {id, type: "sketch", expression, horizon}      {id, type: "result", result}
//      {id, type: "catalog"}                          {id, type: "result", result}
//      {id, type: "generate", text, revision}         {id, type: "result", result}
//      {id, type: "solve", text,                      {id, type: "exact", result}   a tree
//       scenario?, revision?}                         {id, type: "begun", result}   an architecture
//                                                     {id, type: "progress", done, total}…
//                                                     {id, type: "result", result}
//      {id, type: "cancel"}                           {id, type: "cancelled"}
//                                                     {type: "crashed", message}
//
// Sampling runs in slices and gives the event loop a turn between them; that
// turn is when a cancel gets in, and it is the whole of the cancel mechanism.
// A panic leaves the wasm module dead: it is reported once, and the page
// replaces this worker.
(function () {
  var SLICE_MS = 12;

  function createHandler(env) {
    var api = env.api;
    var solving = null; // id of the solve in progress
    var dead = false;

    function guarded(work) {
      if (dead) return;
      try {
        work();
      } catch (e) {
        dead = true;
        solving = null;
        env.post({ type: "crashed", message: env.panicMessage() || String((e && e.message) || e) });
      }
    }

    function slice(id) {
      // Cancelled or replaced while this turn was waiting.
      if (solving !== id) return;
      var start = env.now();
      var progress;
      do progress = JSON.parse(api.solve_step()).ok;
      while (progress.done < progress.total && env.now() - start < SLICE_MS);
      env.post({ id: id, type: "progress", done: progress.done, total: progress.total });
      if (progress.done < progress.total) return next(id);
      solving = null;
      env.post({ id: id, type: "result", result: JSON.parse(api.solve_finish()) });
    }

    function next(id) {
      env.schedule(function () {
        guarded(function () {
          slice(id);
        });
      });
    }

    function stop() {
      if (solving === null) return;
      api.solve_cancel();
      env.post({ id: solving, type: "cancelled" });
      solving = null;
    }

    function handle(m) {
      if (m.type === "cancel") {
        if (m.id === solving) stop();
      } else if (m.type === "solve") {
        stop();
        // A scenario or revision can only mean a generated graph; without
        // them the module tells a tree from an architecture itself.
        var graph = typeof m.scenario === "string" || typeof m.revision === "string";
        var begun = JSON.parse(
          graph ? api.solve_graph_begin(m.text, m.scenario || "", m.revision || "") : api.solve_begin(m.text)
        );
        if (!begun.ok) return env.post({ id: m.id, type: "result", result: begun });
        solving = m.id;
        // A graph has no exact part, and nothing about it is sent as one.
        env.post({ id: m.id, type: "exact" in begun.ok ? "exact" : "begun", result: begun.ok });
        // Sampling starts in a later turn: what is known already is on its way
        // to the page before the first sample is drawn.
        next(m.id);
      } else if (m.type === "sketch") {
        env.post({ id: m.id, type: "result", result: JSON.parse(api.ttc_sketch(m.expression, m.horizon)) });
      } else if (m.type === "generate") {
        // A missing argument is the caller's mistake, not a dead module.
        if (typeof m.text !== "string" || typeof m.revision !== "string") {
          return env.post({ id: m.id, type: "result", result: { error: "generate needs text and revision" } });
        }
        env.post({ id: m.id, type: "result", result: JSON.parse(api.generate(m.text, m.revision)) });
      } else if (m.type === "catalog") {
        env.post({ id: m.id, type: "result", result: JSON.parse(api.component_catalog()) });
      } else if (m.type === "crash") {
        api.crash();
      } else {
        var input = m.type === "serialize" ? JSON.stringify(m.document) : m.text;
        env.post({ id: m.id, type: "result", result: JSON.parse(api[m.type](input)) });
      }
    }

    return function (m) {
      guarded(function () {
        handle(m);
      });
    };
  }

  if (typeof module !== "undefined") module.exports = { createHandler: createHandler, SLICE_MS: SLICE_MS };
  if (typeof importScripts === "undefined") return;

  var panic = null;
  // The wasm module's panic hook calls this, just before the trap.
  self.effractorPanic = function (message) {
    panic = message;
  };

  var waiting = [];
  var handler = function (m) {
    waiting.push(m);
  };
  self.onmessage = function (e) {
    handler(e.data);
  };

  try {
    importScripts(new URL("../wasm/effractor_wasm.js", self.location).href);
    wasm_bindgen({ module_or_path: new URL("../wasm/effractor_wasm_bg.wasm", self.location).href }).then(
      function () {
        handler = createHandler({
          api: wasm_bindgen,
          post: function (m) {
            self.postMessage(m);
          },
          schedule: function (f) {
            setTimeout(f, 0);
          },
          now: function () {
            return performance.now();
          },
          panicMessage: function () {
            return panic;
          },
        });
        waiting.splice(0).forEach(handler);
      },
      function (e) {
        self.postMessage({ type: "crashed", message: "the solver did not load: " + e });
      }
    );
  } catch (e) {
    self.postMessage({ type: "crashed", message: "the solver did not load: " + e });
  }
})();
