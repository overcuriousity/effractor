// When to solve: after every change, once the author pauses, and never two
// runs at a time. A change cancels a run that is still busy with the text it
// replaced. What a run does, and how, is the page's business (`start`); this
// only decides when. Pure: the clock and the solver are handed in.
(function () {
  var DELAY_MS = 300;
  // A sampled run that took longer than this is not repeated after every
  // edit: the exact part still is, and Solve samples on request.
  var SAMPLE_BUDGET_MS = 2000;

  function samplesAutomatically(lastSampledMs) {
    return typeof lastSampledMs !== "number" || lastSampledMs <= SAMPLE_BUDGET_MS;
  }

  // o.start(explicit) → a promise that settles when the run is over, however
  // it ended; o.cancel() asks the running one to end.
  function createAutoSolve(o) {
    var timer = null;
    var busy = null; // the running run: {explicit}
    var queued = null; // what starts when it ends: {explicit}
    var carried = false; // an explicit run a change cancelled: the next is explicit too

    function launch(explicit) {
      busy = { explicit: explicit };
      Promise.resolve()
        .then(function () {
          return o.start(explicit);
        })
        .then(settle, settle);
    }

    function settle() {
      busy = null;
      var next = queued;
      queued = null;
      if (next) launch(next.explicit);
    }

    function request(explicit) {
      if (!busy) return launch(explicit);
      queued = { explicit: explicit || !!(queued && queued.explicit) };
      o.cancel();
    }

    function wait() {
      if (timer !== null) o.clearTimeout(timer);
      timer = null;
    }

    return {
      // The document changed: what is running describes the old one.
      changed: function () {
        wait();
        if (busy) {
          carried = carried || busy.explicit;
          queued = null;
          o.cancel();
        }
        timer = o.setTimeout(function () {
          timer = null;
          var explicit = carried;
          carried = false;
          request(explicit);
        }, DELAY_MS);
      },
      // Solve, asked for: now, with everything.
      now: function () {
        wait();
        carried = false;
        request(true);
      },
      // Cancel, asked for: nothing runs until the next change or Solve.
      stop: function () {
        wait();
        carried = false;
        queued = null;
        if (busy) o.cancel();
      },
      running: function () {
        return busy !== null;
      },
    };
  }

  var api = { createAutoSolve: createAutoSolve, samplesAutomatically: samplesAutomatically, DELAY_MS: DELAY_MS, SAMPLE_BUDGET_MS: SAMPLE_BUDGET_MS };
  if (typeof module !== "undefined") module.exports = api;
  if (typeof window !== "undefined") window.effractorAutoSolve = api;
})();
