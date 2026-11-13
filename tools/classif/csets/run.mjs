import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {call} from './seat.mjs';
import {load,request,home,hash,json} from './inputs.mjs';
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
const guard=createQuotaGuard({threshold:90,isCodex:()=>true});
const initial=json(`${home}/quota-start.json`);
if(initial.code!==0||!initial.rateLimits?.primary) throw new Error('Fresh quota probe required');
if(Date.now()-Date.parse(initial.at)>3600000) throw new Error('Quota probe is stale');
guard.observe('astra-low',initial.rateLimits);
let stop=null,done=0,cached=0;
const started=new Date().toISOString();
const log=`${home}/calls.jsonl`;
// Read and checksum every request before spawning any child. A filesystem refusal
// must not leave half of the first worker batch running without a parent receipt.
const jobs=rows.flatMap(({item})=>['A','B'].map(mode=>({item,mode,req:request(item,mode)})));
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
  let result=null;
  if(req){
   appendJsonlRecord(log,{at:new Date().toISOString(),half,mode,intent:true,inputHash:digest});
   result=await call(req.prompt);
   appendJsonlRecord(log,{at:new Date().toISOString(),half,mode,intent:false,inputHash:digest,
    code:result.code,latencyMs:result.latencyMs,usage:result.usage,toolEvents:result.toolEvents,...quotaFields(result)});
   guard.observe('astra-low',result.rateLimits);
   if(result.authError||result.binaryMissing||result.rateLimits?.rate_limit_reached_type) stop='account-or-quota-refusal';
   if(!result.rateLimits?.primary) stop='quota-observation-missing';
  }
  const bytes=Buffer.from(JSON.stringify({digest,itemId:item.itemId,mode,request:req,result}));
  writeFileSync(file,blind?seal(key,bytes):bytes,{mode:0o600});
  done++;
  if(done%10===0) console.log(JSON.stringify({half,completed:done,cached,total:jobs.length,quota:result?.rateLimits?.primary?.used_percent}));
 }
}
await Promise.all(Array.from({length:10},worker));
const status={half,started,ended:new Date().toISOString(),completed:done,cached,total:jobs.length,
 stopped:stop??guard.paused??null,concurrency:10};
writeFileSync(`${home}/${half}-status.json`,JSON.stringify(status,null,2),{mode:0o600});
console.log(status);
if(stop||guard.paused) process.exitCode=2;
