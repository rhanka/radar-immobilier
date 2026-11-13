import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
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
console.log({sourceHashes:'verified',nativeResponses:242,exactRequests:242,aggregateInvariants:'pass',publicPerUnitIdentifiers:0});
