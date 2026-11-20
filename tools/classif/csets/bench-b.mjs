import {createHash} from 'node:crypto';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {call,benchModel,isCodexBench} from './seat.mjs';
import {privateDir} from '../lib/paths.mjs';
import {createQuotaGuard,quotaFields} from '../lib/codex-quota.mjs';
import {appendJsonlRecord} from '../lib/jsonl.mjs';

const SYSTEM_SHA256='bdc1327904ac4c5a36b91dfdbe887a6f1a900b8fe5f1427249e54d83c250d461';
const QUOTA_RE=/(\b429\b|\b401\b|\b403\b|rate.?limit|quota|overloaded|capacity|usage limit|individual quota|authentication|unauthori[sz]ed|token.*expired|not logged in)/i;
const sha256=x=>createHash('sha256').update(x).digest('hex');

const benchDir=process.env.BENCH_B_DIR??'/home/antoinefa/src/radar-immobilier/.claude/worktrees/agent-ae1c01a14a9859391/tools/bench-v11';
const benchHome=privateDir(process.env.BENCH_B_HOME??`/home/antoinefa/.local/share/radar-classif/bench-b-models/${benchModel}`);
const rawDir=privateDir(`${benchHome}/raw`);
const cacheDir=privateDir(`${benchHome}/cache`);
const log=`${benchHome}/calls.jsonl`;

const manifest=JSON.parse(readFileSync(`${benchDir}/harness/manifest-v101b.json`,'utf8'));
const frozenSystem=manifest.promptFreeze.systemPrompt;
if(sha256(frozenSystem)!==SYSTEM_SHA256) throw new Error('Frozen B system prompt checksum mismatch');

const guard=createQuotaGuard({threshold:90,isCodex:()=>isCodexBench});
const initial=isCodexBench?JSON.parse(readFileSync(`${benchHome}/quota-start.json`,'utf8')):null;
if(isCodexBench){
 if(initial.code!==0||!initial.rateLimits?.primary) throw new Error('Fresh quota probe required');
 if(Date.now()-Date.parse(initial.at)>3600000) throw new Error('Quota probe is stale');
 guard.observe(benchModel,initial.rateLimits);
}

// Verify all 100 frozen prompts byte-for-byte against manifest-v101b before any call.
const prefix=`${frozenSystem}\n\nSchema: `;
const jobs=manifest.documents.map(doc=>{
 const expected=manifest.promptFreeze.documents.find(d=>d.id===doc.id);
 if(!expected) throw new Error(`Missing promptFreeze entry for ${doc.id}`);
 const promptPath=`${benchDir}/full/prompts/${doc.id}.muse.txt`;
 const fullPrompt=readFileSync(promptPath,'utf8');
 if(!fullPrompt.startsWith(prefix)) throw new Error(`Prompt prefix mismatch for ${doc.id}`);
 const rest=fullPrompt.slice(prefix.length);
 const sep=rest.indexOf('\n\n');
 if(sep<0) throw new Error(`Prompt schema separator missing for ${doc.id}`);
 const schema=rest.slice(0,sep);
 const body=rest.slice(sep+2);
 if(sha256(schema)!==expected.schemaSha256||Buffer.byteLength(schema)!==expected.schemaBytes){
  throw new Error(`Frozen schema checksum mismatch for ${doc.id}`);
 }
 if(sha256(body)!==expected.promptSha256||Buffer.byteLength(body)!==expected.promptBytes){
  throw new Error(`Frozen prompt checksum mismatch for ${doc.id}`);
 }
 return {docId:doc.id,prompt:fullPrompt,promptSha256:sha256(fullPrompt)};
});

const defaultConcurrency=isCodexBench?10:4;
const concurrency=Math.min(16,Math.max(1,Number(process.env.BENCH_CONCURRENCY??defaultConcurrency)||defaultConcurrency));
let stop=null,done=0,cached=0,cursor=0;
const started=new Date().toISOString();

async function worker(){
 while(cursor<jobs.length&&!stop&&!guard.paused){
  const {docId,prompt,promptSha256}=jobs[cursor++];
  const cacheFile=`${cacheDir}/${docId}.json`;
  const rawFile=`${rawDir}/low--${docId}.txt`;
  if(existsSync(cacheFile)){
   const prev=JSON.parse(readFileSync(cacheFile,'utf8'));
   if(prev.promptSha256!==promptSha256) throw new Error(`Cache input mismatch for ${docId}`);
   cached++;
   continue;
  }
  appendJsonlRecord(log,{at:new Date().toISOString(),docId,model:benchModel,intent:true,promptSha256});
  const result=await call(prompt);
  appendJsonlRecord(log,{at:new Date().toISOString(),docId,model:benchModel,intent:false,promptSha256,
   code:result.code,latencyMs:result.latencyMs,usage:result.usage,toolEvents:result.toolEvents,
   status:result.status??null,errorEnvelope:result.errorEnvelope||undefined,...quotaFields(result)});

  let quotaOrAccountStop=false;
  const errText=`${result.errorEnvelope??''} ${JSON.stringify(result.error??'')} ${result.stderrTail??''}`;
  const rateLimitErr=/(\b429\b|rate.?limit|usage limit|individual quota)/i.test(errText);
  if(isCodexBench){
   guard.observe(benchModel,result.rateLimits);
   if(result.authError||result.binaryMissing||result.rateLimits?.rate_limit_reached_type||rateLimitErr||(result.code!==0&&QUOTA_RE.test(errText))){
    stop='account-or-quota-refusal';
    quotaOrAccountStop=true;
   }
   if(!result.rateLimits?.primary){
    stop='quota-observation-missing';
    quotaOrAccountStop=true;
   }
  } else if(result.authError||result.binaryMissing||rateLimitErr||(result.code!==0&&QUOTA_RE.test(errText))){
   stop='account-or-quota-refusal';
   quotaOrAccountStop=true;
  }
  if(quotaOrAccountStop){
   // Do not cache a quota-aborted attempt so a later resumed run executes this document.
   continue;
  }
  const okRun=result.code===0&&result.toolEvents===0&&typeof result.text==='string'&&result.text.trim().length>0;
  if(okRun){
   writeFileSync(rawFile,result.text,{mode:0o600});
  }
  writeFileSync(cacheFile,JSON.stringify({docId,model:benchModel,promptSha256,okRun,
   code:result.code,latencyMs:result.latencyMs,usage:result.usage??null,toolEvents:result.toolEvents??0,
   toolKinds:result.toolKinds??null,status:result.status??null,
   errorEnvelope:result.errorEnvelope??'',bytes:okRun?Buffer.byteLength(result.text):0}),{mode:0o600});
  done++;
  if(done%5===0||done+cached===jobs.length){
   console.log(JSON.stringify({bench:'B',model:benchModel,completed:done,cached,total:jobs.length,
    okRun,quota:result.rateLimits?.primary?.used_percent??null}));
  }
 }
}

await Promise.all(Array.from({length:concurrency},worker));
const status={bench:'B',model:benchModel,systemPromptSha256:SYSTEM_SHA256,
 weeklyQuotaStart:initial?.rateLimits?.primary?.used_percent??null,
 started,ended:new Date().toISOString(),completed:done,cached,total:jobs.length,
 stopped:stop??guard.paused??null,concurrency};
writeFileSync(`${benchHome}/status.json`,JSON.stringify(status,null,2),{mode:0o600});
console.log(JSON.stringify(status,null,2));
if(stop||guard.paused) process.exitCode=2;
