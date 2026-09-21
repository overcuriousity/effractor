const { test } = require('node:test');
const assert = require('node:assert/strict');
const p = require('../assets/js/pareto.js');
const attacks = [
 { leaves:['a'], cost:5, time:null, detection:.1, success:.5, on_front:true },
 { leaves:['b'], cost:8, time:2, detection:.3, success:.8, on_front:true },
 { leaves:['c'], cost:10, time:3, detection:.4, success:.4, on_front:false },
];
const result = { attacker:{available:{cheapest:0,attacks}}, profile:'attack-tree' };
test('table pins the cheapest path during every sort and omits dominated rows', () => {
 assert.deepEqual(p.rows(result,'cost',true).map(r=>r.index),[0,1]);
 assert.deepEqual(p.rows(result,'time',false).map(r=>r.index),[0,1]);
 assert.equal(p.rows(result,'cost',false)[0].cheapest,true);
 assert.deepEqual(p.rows(null,'cost',false),[]);
 assert.equal(attacks[0].time,null);
});
test('scatter keeps dominated context, excludes nonfinite axes, and never encodes null as zero',()=>{
 const points=p.points(result,'cost','time');
 assert.deepEqual(points.map(r=>r.index),[1,2]);
 assert.equal(points[1].on_front,false);
 assert.deepEqual(p.points(result,'cost','detection').map(r=>r.index),[0,1,2]);
});
test('switching axes swaps the other axis when necessary',()=>{
 assert.deepEqual(p.axes({x:'cost',y:'time'},'x','time'),{x:'time',y:'cost'});
 assert.deepEqual(p.axes({x:'cost',y:'time'},'y','detection'),{x:'cost',y:'detection'});
});
test('highlight includes connecting ancestors in a shared DAG without unrelated branches',()=>{
 const doc={top:'top',nodes:{top:{children:['left','right','other']},left:{children:['a']},right:{children:['a','b']},other:{children:['c']},a:{},b:{},c:{}}};
 assert.deepEqual(new Set(p.path(doc,['a'])),new Set(['a','left','right','top']));
});

test('path sorting follows displayed labels rather than hidden ids',()=>{
 const r={attacker:{available:{cheapest:null,attacks:[{...attacks[0],leaves:['z']},{...attacks[1],leaves:['a']}]}}};
 const labels={z:'Alpha',a:'Zulu'};
 assert.deepEqual(p.rows(r,'leaves',false,id=>labels[id]).map(r=>r.index),[0,1]);
});
test('unreachable parents and ancestors above top do not enter highlighted paths',()=>{
 const doc={top:'top',nodes:{top:{children:['a']},a:{},spare:{children:['a']},above:{children:['top']}}};
 assert.deepEqual(new Set(p.path(doc,['a'])),new Set(['a','top']));
});
