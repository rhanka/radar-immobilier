import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {load,home,refresh,json,sourceText,hash} from './inputs.mjs';
import {parseJsonObject} from '../run-seat.mjs';
import {metrics,annotation,shown} from './metrics.mjs';
import {seal,unseal,keyFromEnv} from '../lib/refc1.mjs';
const {pairOneToOne}=await import(pathToFileURL(`${refresh}/tools/bench-v11/harness/oracle-v3-lib.mjs`));
const half=process.argv[2]??'tuning',blind=half==='blind';
const key=blind?keyFromEnv('CLASSIF_BLIND_KEY'):null;
const refs=load(half),dir=`${home}/${half}`;
const validationBytes=readFileSync(`${dir}/native-validation.${blind?'sealed':'json'}`);
const validation=new Map(JSON.parse(blind?unseal(key,validationBytes):validationBytes.toString()).map(x=>[x.file,x]));
const results={},misses=[];
for(const mode of ['A','B']){
 const scored=[];let extractions=0,unpaired=0;
 for(const {item,ref} of refs){
  const file=`${mode}-${hash(item.itemId).slice(0,24)}.${blind?'sealed':'json'}`;
  const bytes=readFileSync(`${dir}/${file}`);
  const c=JSON.parse(blind?unseal(key,bytes):bytes.toString());
  const out=parseJsonObject(c.result?.text),r={itemId:item.itemId,kind:item.kind,ref:ref.verdict,pred:null,
   detected:false,absent:false,invalid:false,predCode:null};
  const failed=!c.result||c.result.code!==0||c.result.toolEvents!==0;
  if(mode==='B'){
   const a=failed?null:annotation(out);
   r.pred=a?.classe??null;r.predCode=a?.reasonCode??null;r.invalid=!a;r.detected=Boolean(a);
  }else{
   const checked=c.request?validation.get(file):{digest:c.digest,valid:false};
   if(!checked||checked.digest!==c.digest) throw new Error('Missing native validation for a completed response');
   if(checked.compositionMatches===false) throw new Error('Production composition differs from measured request');
   r.invalid=failed||!checked.valid;
   const acts=r.invalid?[]:(out?.nodes??[]).filter(n=>['Signal','DesignationEvent'].includes(n.node_type));
   extractions+=acts.length;
   let picked=null;
   if(item.kind==='pv'){
    r.detected=acts.length>0;
    const annotations=acts.map(n=>out.annotations.find(a=>a.nodeId===n.id)).map(annotation).filter(Boolean);
    picked=['pertinent','a_surveiller','non_classe','ecarte'].map(cl=>annotations.find(a=>a.classe===cl)).find(Boolean);
   }else{
    const text=sourceText(item)??'';
    const stage=item.input.match(/étape = ([^;\n]+)/)?.[1]?.trim();
    const human={page:1,stage,anchor:text.slice(0,20),citation:text};
    const candidates=acts.flatMap(n=>(n.citations??[]).map(cite=>({page:cite.page,
     stage:stage?(n.properties?.etape??n.properties?.stage):undefined,
     anchor:cite.excerpt?.slice(0,20)??'',citation:cite.excerpt??'',node:n})));
    const paired=pairOneToOne([human],candidates);
    const match=paired.pairs[0]?.[1]?.node;
    r.detected=Boolean(match);
    picked=annotation(out?.annotations?.find(a=>a.nodeId===match?.id));
    unpaired+=acts.length-(match?1:0);
   }
   r.pred=picked?.classe??null;r.predCode=picked?.reasonCode??null;r.absent=!r.detected;
  }
  if(shown(ref.verdict)&&!shown(r.pred)) misses.push({...r,mode,input:item.input});
  scored.push(r);
 }
 results[mode]={...metrics(scored),extractions,unpairedExtractions:unpaired,
  byKind:Object.fromEntries(['signal','pv'].map(kind=>[kind,metrics(scored.filter(r=>r.kind===kind))]))};
 if(mode==='B') results[mode].detectionRecall=null;
 const bytes=Buffer.from(JSON.stringify(scored));
 writeFileSync(`${dir}/scored-${mode}.${blind?'sealed':'json'}`,blind?seal(key,bytes):bytes,{mode:0o600});
}
writeFileSync(`${home}/${half}-aggregates.json`,JSON.stringify(results,null,2),{mode:0o600});
if(!blind) writeFileSync(`${home}/tuning-misses.json`,JSON.stringify(misses,null,2),{mode:0o600});
console.log(JSON.stringify(results,null,2));
