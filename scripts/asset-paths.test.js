const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Catch worker URLs accidentally escaping the Pages repository prefix. The
// server's /s/id route must also load workers beside the scripts, not the page.
for (const [page, assets] of [
  ['https://example.test/effractor/', 'https://example.test/effractor/assets/'],
  ['https://example.test/s/snapshot', 'https://example.test/assets/'],
]) {
  test(`workers load from the script's asset directory at ${page}`, () => {
    let elkWorker, solverWorker;
    const stop = new Error('stop before mounting the editor');
    const context = vm.createContext({
      URL, location: new URL(page),
      document: { currentScript: { src: assets + 'js/layout.js' } },
      Worker: function (url) { solverWorker = String(url); },
      window: {
        ELK: function (options) { elkWorker = String(options.workerUrl); },
        effractorStore: { createStore: () => ({}) },
        createSolver: makeWorker => { makeWorker(); return {}; },
        effractorRenderer: { createSvgRenderer: () => { throw stop; } },
      },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/layout.js'), 'utf8'), context);
    context.window.effractorLayout.createLayout();
    context.document.currentScript.src = assets + 'js/app.js';
    assert.throws(() => vm.runInContext(fs.readFileSync(path.join(__dirname, '../assets/js/app.js'), 'utf8'), context), error => error === stop);
    assert.equal(elkWorker, assets + 'vendor/elk/elk-worker.min.js');
    assert.equal(solverWorker, assets + 'js/solver-worker.js');
  });
}
