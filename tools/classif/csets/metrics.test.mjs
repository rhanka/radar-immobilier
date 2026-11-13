import {test} from 'node:test';
import assert from 'node:assert/strict';
import {metrics,wilson,annotation} from './metrics.mjs';
import {pairAct} from './matching.mjs';
test('missing and unclassified shown units fail D4; P to S stays shown',()=>{
 const m=metrics([{ref:'pertinent',pred:'a_surveiller',detected:true},
  {ref:'a_surveiller',pred:null,absent:true},{ref:'pertinent',pred:'non_classe'},
  {ref:'non_pertinent',pred:'pertinent',detected:true}]);
 assert.equal(m.misses,2);assert.equal(m.recall,1/3);assert.equal(m.precision,1/2);
 assert.equal(m.D4,'fail');assert.deepEqual(m.matrix.rows,[[0,1,0,1],[0,0,0,1],[1,0,0,0],[0,0,0,0]]);
});
test('Wilson bound remains below one at zero misses',()=>{
 assert.ok(Math.abs(wilson(95,95).low-0.9611351464605271)<1e-12);
 assert.equal(wilson(0,0).low,null);
});
test('annotation rejects a class inconsistent with its reason code',()=>{
 assert.equal(annotation({classe:'pertinent',reasonCode:'N-FORME',reason:'Step 6'}),null);
});
test('pairing credits a native flat stage and rejects another stage',()=>{
 const text='Le conseil adopte le règlement de zonage 123.';
 const node={id:'act',etape:'adoption',citations:[{page:1,excerpt:text}]};
 assert.equal(pairAct('étape = adoption ;',text,[node]),node);
 assert.equal(pairAct('étape = avis_motion ;',text,[node]),null);
 const nested={...node,properties:{etape:'adoption'}};
 assert.equal(pairAct('étape = adoption ;',text,[nested]),nested);
});
