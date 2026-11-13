import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {json,hash,home,refresh} from './inputs.mjs';
import {wilson} from './metrics.mjs';
const files=['api/src/services/graph/refresh-profile.ts','api/src/services/graph/refresh-single-pass.ts',
 'radar/prompts/refresh-single-pass-v1.md','radar/prompts/refresh-single-pass.json',
 'radar/ontology/ontology-profile.yaml','package-lock.json'];
const tuning=json('tools/classif/l4/manifests/series-7-dev.json').aggregates['astra-low'];
const blind=json('/home/antoinefa/.local/share/radar-classif/blind/series-7-astra-low.json');
const baseline=s=>({...s,recallWilson95:wilson(s.refShown,s.refShown),
 precisionWilson95:wilson(s.refShown,s.predShown),misses:0});
const manifest={kind:'single-pass-csets',promptSha256:json(`${refresh}/radar/prompts/refresh-single-pass.json`).sha256,
 compositionSha256:hash(readFileSync(`${home}/composition.json`)),
 refreshHead:execFileSync('git',['-C',refresh,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),
 sourceHashes:Object.fromEntries(files.map(f=>[f,hash(readFileSync(`${refresh}/${f}`))])),
 referenceManifest:json('tools/classif/l3/manifests/reference-d.json'),
 series7:json('tools/classif/l4/manifests/series-7.json'),
 baseline:{tuning:baseline(tuning),blind:baseline({...blind.stats,failures:blind.failures})},
 surface:{model:'gpt-6-astra',effort:'low',transport:'codex ChatGPT',concurrency:10,
 weeklyQuotaStop:90,web:false,acceptedToolEvents:0,emptyCwd:true,laneSeatHome:'/tmp/radar-csets-seats'},
 quotaStart:json(`${home}/quota-start.json`),
 limitations:['Reference units include whole PVs, not exclusively identified acts.',
 'Mode A signal source coverage is frozen excerpts, not complete PDFs.',
 'C baseline uses exact one-sided Clopper-Pearson bounds; new bounds are two-sided Wilson.',
 'Blind key must be injected by the conductor; never read environment files.']};
writeFileSync('docs/spec/reports/classif-csets/manifest.json',JSON.stringify(manifest,null,1)+'\n');
console.log({manifestWritten:true,compositionSha256:manifest.compositionSha256});
