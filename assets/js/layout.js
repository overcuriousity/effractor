// Layout: ELK, in a worker of its own (spec 7.1). The page never computes a
// position and never stores one.
(function () {
  function createLayout() {
    var graph = window.effractorGraph;
    // elk-api.js is the shim; the engine is the worker script beside it.
    var elk = new window.ELK({ workerUrl: "/assets/vendor/elk/elk-worker.min.js" });
    return function layout(described) {
      return graph.layoutWith(function (elkGraph) {
        return elk.layout(elkGraph);
      }, described);
    };
  }
  window.effractorLayout = { createLayout: createLayout };
})();
