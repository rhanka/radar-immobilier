import {readFileSync,writeFileSync} from 'node:fs';
import {loadRefreshProfileContext,extractRefreshProfile} from './api/src/services/graph/refresh-profile.ts';
import {loadSinglePassPrompt} from './api/src/services/graph/refresh-single-pass.ts';
import {seal,unseal,keyFromEnv} from '/lane/tools/classif/lib/refc1.mjs';
const context=loadRefreshProfileContext({root:'/src',profilePath:'/src/radar/ontology/ontology-profile.yaml',unregisteredOnly:true});
const singlePassPrompt=await loadSinglePassPrompt();
const half=process.env.CSETS_HALF??'tuning',blind=half==='blind';
const key=blind?keyFromEnv('CLASSIF_BLIND_KEY'):null;
const bytes=readFileSync(`/private/validation-batch.${blind?'sealed':'json'}`);
const batch=JSON.parse(blind?unseal(key,bytes):bytes.toString());
const results=[];
for(const row of batch){
 let valid=false,error:string|null=null;
 try {
  await extractRefreshProfile([row.chunk],{context,singlePassPrompt,maxOutputTokens:32000,
   textClient:{async generateJson(request:any){request.validateResponse(row.text);valid=true;throw new Error('validated');}} as any});
 }catch(e){if(!valid) error=(e as Error).message;}
 results.push({file:row.file,digest:row.digest,valid,error});
}
const resultBytes=Buffer.from(JSON.stringify(results));
writeFileSync(`/private/${half}/native-validation.${blind?'sealed':'json'}`,blind?seal(key,resultBytes):resultBytes,{mode:0o600});
console.log({nativeValidated:results.length,valid:results.filter(x=>x.valid).length});
