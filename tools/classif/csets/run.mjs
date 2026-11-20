import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {call,benchModel,isCodexBench} from './seat.mjs';
import {load,request,home,hash,json,modes,version} from './inputs.mjs';
import {privateDir} from '../lib/paths.mjs';
import {seal,unseal,keyFromEnv} from '../lib/refc1.mjs';
import {createQuotaGuard,quotaFields} from '../lib/codex-quota.mjs';
import {appendJsonlRecord} from '../lib/jsonl.mjs';
const half=process.argv[2]??'tuning';
if(!['tuning','blind'].includes(half)) throw new Error('Unknown half');
const blind=half==='blind';
const key=blind?keyFromEnv('CLASSIF_BLIND_KEY'):null;
const rows=load(half);
const dir=privateDir(`${home}/${half}`);
const guard=createQuotaGuard({threshold:90,isCodex:()=>isCodexBench});
const initial=isCodexBench?json(`${home}/quota-start.json`):null;
if(isCodexBench){
 if(initial.code!==0||!initial.rateLimits?.primary) throw new Error('Fresh quota probe required');
 if(Date.now()-Date.parse(initial.at)>3600000) throw new Error('Quota probe is stale');
 guard.observe(benchModel,initial.rateLimits);
}
const concurrency=Math.min(16,Math.max(1,Number(process.env.BENCH_CONCURRENCY??10)||10));
let stop=null,done=0,cached=0;
const started=new Date().toISOString();
const log=`${home}/calls.jsonl`;
// Read and checksum every request before spawning any child. A filesystem refusal
// must not leave half of the first worker batch running without a parent receipt.
const jobs=rows.flatMap(({item})=>modes.map(mode=>({item,mode,req:request(item,mode)})));
let cursor=0;
async function worker(){
 while(cursor<jobs.length&&!stop&&!guard.paused){
  const {item,mode,req}=jobs[cursor++];
  const digest=hash(JSON.stringify(req));
  const file=`${dir}/${mode}-${hash(item.itemId).slice(0,24)}.${blind?'sealed':'json'}`;
  if(existsSync(file)){
   const bytes=readFileSync(file);
   const prev=JSON.parse(blind?unseal(key,bytes):bytes.toString());
   if(prev.digest!==digest) throw new Error('Cache input mismatch');
   cached++;continue;
  }
  let result=null,quotaOrAccountStop=false;
  if(req){
   appendJsonlRecord(log,{at:new Date().toISOString(),half,mode,intent:true,inputHash:digest});
   result=await call(req.prompt);
   appendJsonlRecord(log,{at:new Date().toISOString(),half,mode,intent:false,inputHash:digest,
    code:result.code,latencyMs:result.latencyMs,usage:result.usage,toolEvents:result.toolEvents,...quotaFields(result)});
   const errText=`${result.errorEnvelope??''} ${JSON.stringify(result.error??'')} ${result.stderrTail??''}`;
   const rateLimitErr=/(\b429\b|rate.?limit|usage limit|individual quota|hit your limit|overloaded)/i.test(errText);
   const quotaErr=(result.code!==0||result.isError)&&/(\b429\b|\b401\b|\b403\b|rate.?limit|quota|authentication|unauthori[sz]ed|token.*expired|not logged in)/i.test(errText);
   if(result.rateLimits?.primary){
    const usedPct=result.rateLimits.primary.used_percent;
    if(result.rateLimits.rate_limit_reached_type||(typeof usedPct==='number'&&usedPct>=90)){stop='quota-threshold-90';quotaOrAccountStop=true;}
   }
   if(isCodexBench){
    guard.observe(benchModel,result.rateLimits);
    if(result.authError||result.binaryMissing||result.rateLimits?.rate_limit_reached_type||rateLimitErr||quotaErr){stop='account-or-quota-refusal';quotaOrAccountStop=true;}
    if(!result.rateLimits?.primary){stop='quota-observation-missing';quotaOrAccountStop=true;}
   } else if(result.authError||result.binaryMissing||rateLimitErr||quotaErr){stop='account-or-quota-refusal';quotaOrAccountStop=true;}
  }
  if(quotaOrAccountStop) continue;
  const bytes=Buffer.from(JSON.stringify({digest,itemId:item.itemId,mode,request:req,result}));
  writeFileSync(file,blind?seal(key,bytes):bytes,{mode:0o600});
  done++;
  if(done%10===0) console.log(JSON.stringify({half,completed:done,cached,total:jobs.length,quota:result?.rateLimits?.primary?.used_percent}));
 }
}
await Promise.all(Array.from({length:concurrency},worker));
const status={half,version,modes,model:benchModel,weeklyQuotaStart:initial?.rateLimits?.primary?.used_percent??null,
 started,ended:new Date().toISOString(),completed:done,cached,total:jobs.length,
 stopped:stop??guard.paused??null,concurrency};
writeFileSync(`${home}/${half}-status.json`,JSON.stringify(status,null,2),{mode:0o600});
console.log(status);
if(stop||guard.paused) process.exitCode=2;
