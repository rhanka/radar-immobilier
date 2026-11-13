import {readFileSync,writeFileSync} from 'node:fs';
import {loadRefreshProfileContext,extractRefreshProfile} from './api/src/services/graph/refresh-profile.ts';
import {loadSinglePassPrompt} from './api/src/services/graph/refresh-single-pass.ts';
const context=loadRefreshProfileContext({root:'/src',profilePath:'/src/radar/ontology/ontology-profile.yaml',unregisteredOnly:true});
const singlePassPrompt=await loadSinglePassPrompt();
const batch=JSON.parse(readFileSync('/private/validation-batch.json','utf8'));
const results=[];
for(const row of batch){
 let valid=false,error:string|null=null;
 try {
  await extractRefreshProfile([row.chunk],{context,singlePassPrompt,maxOutputTokens:32000,
   textClient:{async generateJson(request:any){request.validateResponse(row.text);valid=true;throw new Error('validated');}} as any});
 }catch(e){if(!valid) error=(e as Error).message;}
 results.push({file:row.file,digest:row.digest,valid,error});
}
writeFileSync('/private/tuning/native-validation.json',JSON.stringify(results),{mode:0o600});
console.log({nativeValidated:results.length,valid:results.filter(x=>x.valid).length});
