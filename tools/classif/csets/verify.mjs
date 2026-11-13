import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readdirSync} from 'node:fs';
import {home,json,hash,refresh} from './inputs.mjs';
const m=json('docs/spec/reports/classif-csets/manifest.json');
for(const [file,sha] of Object.entries(m.sourceHashes)) assert.equal(hash(readFileSync(`${refresh}/${file}`)),sha,file);
for(const file of ['api/src/services/graph/refresh-profile.ts','api/src/services/graph/refresh-single-pass.ts'])
 assert.equal(hash(readFileSync(`${home}/deps/${file}`)),m.sourceHashes[file],`executed copy ${file}`);
const native=json(`${home}/tuning/native-validation.json`);
assert.equal(native.length,242);assert.ok(native.every(r=>r.valid&&r.compositionMatches));
const results=json('docs/spec/reports/classif-csets/aggregates.json');
for(const mode of ['A','B']){
 const r=results.tuning[mode];
 assert.equal(r.units,252);assert.equal(r.matrix.rows.flat().reduce((a,b)=>a+b,0),252);
 assert.equal(r.refShown-r.trueShown,r.misses);
}
for(const file of ['report.md','aggregates.json','manifest.json']){
 const bytes=readFileSync(`docs/spec/reports/classif-csets/${file}`,'utf8');
 assert.ok(!/dev-(?:sig|pv)-[a-f0-9]{12}/.test(bytes),`per-unit identity in ${file}`);
}
assert.equal(results.execution.measuredResponses,494);assert.equal(results.execution.toolEvents,0);
assert.equal(results.classificationOnly.records.length,4);
assert.ok(!/"(?:itemId|input|request|result|text)"\s*:/.test(readFileSync('docs/spec/reports/classif-csets/aggregates.json','utf8')));
for(const r of results.classificationOnly.records){
 const m=r.metrics;
 assert.equal(m.units,252);assert.equal(m.matrix.rows.flat().reduce((a,b)=>a+b,0),252);
 assert.equal(m.refShown-m.trueShown,m.misses);
 assert.equal(m.refShown,results.baseline[r.half].refShown);
 assert.equal(m.D4,m.misses===0?'pass':'fail');
 assert.equal(r.execution.toolEvents,0);assert.equal(r.execution.concurrency,10);
 if(r.half==='blind'){
  const dir=`${home}${r.version==='v2'?'/v2':''}/blind`;
  const files=readdirSync(dir).filter(f=>f.startsWith('B-'));
  assert.equal(files.length,252);assert.ok(files.every(f=>f.endsWith('.sealed')));
  assert.ok(files.every(f=>readFileSync(`${dir}/${f}`).subarray(0,5).toString()==='REFC1'));
 }
}
console.log({sourceHashes:'verified',nativeResponses:242,exactRequests:242,aggregateInvariants:'pass',publicPerUnitIdentifiers:0});
