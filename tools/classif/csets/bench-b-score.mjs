import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {benchModel} from './seat.mjs';
import {wilson} from './metrics.mjs';

const SYSTEM_SHA256='bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461';
const TUNING_IDS_SHA256='60ca595a97187eaef736723bb5ff313efafa8a1ed08c80d5fe6b97d76a180505';
const BLIND_IDS_SHA256='61b8d4d544e4a00d02193f6b05b1d86fe467d90baa18cd52b821883b7b89620b';
const sha256=x=>createHash('sha256').update(x).digest('hex');
const benchDir=process.env.BENCH_B_DIR??'/home/antoinefa/src/radar-immobilier/.claude/worktrees/agent-ae1c01a14a9859391/tools/bench-v11';
const benchHome=process.env.BENCH_B_HOME??`/home/antoinefa/.local/share/radar-classif/bench-b-models/${benchModel}`;
const splitFile=process.env.BENCH_B_SPLIT_FILE??'/home/antoinefa/src/radar-immobilier/tmp/classif-1passe/tools/classif/1passe/split.json';
const outPath=process.env.BENCH_B_OUT??null;
// Step 1: validate raw outputs with the exact frozen bench-v11 validator (v9 contract + provenance).
process.env.BENCH_DIR=benchDir;
const valOut=execFileSync(process.execPath,[`${benchDir}/full/validate-outputs.mjs`,benchHome],{
 env:{...process.env,BENCH_DIR:benchDir},encoding:'utf8',
});
console.log(valOut.trim());
// Step 2: score against oracle 676 using the exact frozen bench-v11 scorer.
const {scoreSource}=await import(pathToFileURL(`${benchDir}/full/score-676.mjs`).href);
const {aggregate}=await import(pathToFileURL(`${benchDir}/harness/score-oracle-v3.mjs`).href);
const manifest=JSON.parse(readFileSync(`${benchDir}/harness/manifest-v101b.json`,'utf8'));
const split=JSON.parse(readFileSync(splitFile,'utf8'));
if(sha256(`${split.tuning.join('\n')}\n`)!==TUNING_IDS_SHA256||sha256(`${split.blind.join('\n')}\n`)!==BLIND_IDS_SHA256){
 throw new Error('Frozen tuning/blind split checksum mismatch');
}
const tuningSet=new Set(split.tuning);
const blindSet=new Set(split.blind);
const cacheEntries=new Map();
for(const doc of manifest.documents){
 const f=`${benchHome}/cache/${doc.id}.json`;
 if(existsSync(f)) cacheEntries.set(doc.id,JSON.parse(readFileSync(f,'utf8')));
}
const resolveDoc=async documentId=>{
 const meta=cacheEntries.get(documentId);
 if(!meta||meta.code!==0||meta.toolEvents!==0) return {state:'refused_or_missing'};
 const out=`${benchHome}/validated/low--${documentId}.output.json`;
 if(!existsSync(out)) return {state:'refused_or_missing'};
 return {state:'accepted',output:JSON.parse(readFileSync(out,'utf8'))};
};
const scored=await scoreSource(benchModel,'seat-bench-b',resolveDoc);

const failClassesFor=docIds=>{
 const fc={J:0,V:0,Pr:0,T:0};
 for(const id of docIds){
  const meta=cacheEntries.get(id);
  if(!meta||meta.code!==0||meta.toolEvents!==0){ fc.T+=1; continue; }
  const rc=`${benchHome}/validated/low--${id}.receipt.json`;
  if(!existsSync(rc)){ fc.T+=1; continue; }
  const c=JSON.parse(readFileSync(rc,'utf8')).validation.failureClass;
  if(c==='json') fc.J+=1;
  else if(c==='profile') fc.V+=1;
  else if(c==='provenance') fc.Pr+=1;
 }
 return fc;
};

const enrich=agg=>({
 ...agg,
 support:agg.tp+agg.fn,
 missed:agg.fn,
 recallWilson95:wilson(agg.tp,agg.tp+agg.fn),
 precisionWilson95:wilson(agg.tp,agg.tp+agg.fp),
});

const halfMetrics=(name,docSet)=>{
 const sub=scored.cases.filter(c=>docSet.has(c.documentId));
 const ids=[...docSet];
 const accepted=sub.filter(c=>c.accepted).length;
 return {
  half:name,
  docs:sub.length,
  accepted,
  invalid:sub.length-accepted,
  failClasses:failClassesFor(ids),
  strict:enrich(aggregate(sub)),
 };
};

const quantile=(arr,q)=>{
 if(!arr.length) return null;
 const s=[...arr].sort((a,b)=>a-b);
 return s[Math.min(s.length-1,Math.floor(q*s.length))];
};

const callsLog=existsSync(`${benchHome}/calls.jsonl`)
 ?readFileSync(`${benchHome}/calls.jsonl`,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
 :[];
const responses=callsLog.filter(r=>r.intent===false);
const intents=callsLog.filter(r=>r.intent===true);
const firstAt=intents.length?Date.parse(intents[0].at):null;
const lastAt=responses.length?Date.parse(responses.at(-1).at):null;
const wallSeconds=firstAt&&lastAt?(lastAt-firstAt)/1000:null;

const metas=[...cacheEntries.values()];
const okMetas=metas.filter(m=>m.code===0&&m.toolEvents===0);
const sumToken=(...keys)=>metas.reduce((s,m)=>{
 for(const k of keys) if(typeof m.usage?.[k]==='number') return s+m.usage[k];
 return s;
},0);
const sumTotalTokens=()=>metas.reduce((s,m)=>{
 if(typeof m.usage?.total_tokens==='number') return s+m.usage.total_tokens;
 return s+(m.usage?.input_tokens??0)+(m.usage?.cache_creation_input_tokens??0)+(m.usage?.cache_read_input_tokens??0)+(m.usage?.output_tokens??0);
},0);
const toolEventsTotal=metas.reduce((s,m)=>s+(m.toolEvents??0),0);
const status=existsSync(`${benchHome}/status.json`)?JSON.parse(readFileSync(`${benchHome}/status.json`,'utf8')):null;

// Publish aggregates only — never per-document cases (protects blind half).
const report={
 bench:'B',
 protocol:'bench-v11-oracle-676',
 systemPromptSha256:SYSTEM_SHA256,
 model:benchModel,
 scoredAt:new Date().toISOString(),
 docs:manifest.documents.length,
 completed:metas.length,
 accepted:scored.accepted,
 invalid:manifest.documents.length-scored.accepted,
 failClasses:failClassesFor(manifest.documents.map(d=>d.id)),
 toolEventsTotal,
 strict:enrich(scored.net),
 broad:enrich(scored.broad),
 stageTolerant:{...enrich(scored.stageTolerant),addedMatches:scored.stageTolerant.addedMatches},
 soft:{...enrich(scored.soft),addedMatches:scored.soft.addedMatches},
 f1n4:scored.human4.f1,
 halves:{
  tuning:halfMetrics('tuning',tuningSet),
  blind:halfMetrics('blind',blindSet),
 },
 execution:{
  callsLogged:responses.length,
  codeZero:responses.filter(r=>r.code===0).length,
  concurrency:status?.concurrency??null,
  stopped:status?.stopped??null,
  wallSeconds,
  p50Seconds:okMetas.length?quantile(okMetas.map(m=>m.latencyMs),0.5)/1000:null,
  p90Seconds:okMetas.length?quantile(okMetas.map(m=>m.latencyMs),0.9)/1000:null,
  tokens:{
   input:sumToken('input_tokens')+sumToken('cache_creation_input_tokens')+sumToken('cache_read_input_tokens'),
   output:sumToken('output_tokens'),
   thinking:sumToken('thinking_tokens','reasoning_output_tokens'),
   cached:sumToken('cache_read_tokens','cached_input_tokens','cache_read_input_tokens'),
   total:sumTotalTokens(),
  },
  costUsd:'missing source',
 },
};

writeFileSync(`${benchHome}/aggregates.json`,JSON.stringify(report,null,2),{mode:0o600});
if(outPath) writeFileSync(outPath,JSON.stringify(report,null,2)+'\n',{mode:0o644});
console.log(JSON.stringify(report,null,2));
