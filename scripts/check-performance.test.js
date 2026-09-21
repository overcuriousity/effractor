const { test } = require('node:test');
const assert = require('node:assert/strict');
const { measure, withinBudget } = require('./check-performance.js');

test('performance measurement includes all sample chunks and final result serialization', () => {
 let steps=0;
 const api={
  solve_begin:()=>JSON.stringify({ok:{exact:{available:{p_top:.5,ttc_cdf:[[0,0],[10,.5]],bdd_nodes:3}},progress:{done:0,total:2}}}),
  solve_step:()=>JSON.stringify({ok:{done:++steps,total:2}}),
  solve_finish:()=>{assert.equal(steps,2);return JSON.stringify({ok:{sampled:{available:{samples:10000}}}});},
 };
 const clock=[10,12,19];
 assert.deepEqual(measure(api,'yaml',()=>clock.shift()),{exact_ms:2,total_ms:9,samples:10000});
});
test('budget checks require ten thousand samples and enforce both limits',()=>{
 assert.equal(withinBudget({exact_ms:99,total_ms:999,samples:10000}),true);
 assert.equal(withinBudget({exact_ms:100,total_ms:999,samples:10000}),false);
 assert.equal(withinBudget({exact_ms:99,total_ms:1000,samples:10000}),false);
 assert.equal(withinBudget({exact_ms:1,total_ms:2,samples:100}),false);
});
test('invalid inputs and stalled sampling fail instead of producing performance claims',()=>{
 assert.throws(()=>measure({solve_begin:()=>JSON.stringify({diagnostics:[{message:'bad model'}]})},'',()=>0),/bad model/);
 const stalled={solve_begin:()=>JSON.stringify({ok:{exact:{available:{p_top:.5,ttc_cdf:[[0,0],[10,.5]],bdd_nodes:3}},progress:{done:0,total:1}}}),solve_step:()=>JSON.stringify({ok:{done:0,total:1}})};
 assert.throws(()=>measure(stalled,'',()=>0),/progress/);
});

test('an unavailable exact result cannot pass the exact-result timing budget',()=>{
 const api={solve_begin:()=>JSON.stringify({ok:{exact:{unavailable:{reason:'BDD limit'}},progress:{done:0,total:0}}}),solve_finish:()=>JSON.stringify({ok:{sampled:{available:{samples:10000}}}})};
 assert.throws(()=>measure(api,'',()=>0),/exact result unavailable/);
});
