// Layout: ELK, in a worker of its own (spec 7.1). The page never computes a
// position and never stores one.
(function () {
  var workerUrl = new URL("../vendor/elk/elk-worker.min.js", document.currentScript.src).href;
  function createLayout() {
    var graph = window.effractorGraph;
    // elk-api.js is the shim; the engine is the worker script beside it.
    var elk = new window.ELK({ workerUrl: workerUrl });
    return function layout(described) {
      return graph.layoutWith(function (elkGraph) {
        return elk.layout(elkGraph);
      }, described);
    };
  }
  window.effractorLayout = { createLayout: createLayout };
})();
