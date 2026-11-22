import {writeFileSync} from 'node:fs';
import {loadRefreshProfileContext,extractRefreshProfile} from './api/src/services/graph/refresh-profile.ts';
import {loadSinglePassPrompt} from './api/src/services/graph/refresh-single-pass.ts';
const context=loadRefreshProfileContext({root:'/src',profilePath:'/src/radar/ontology/ontology-profile.yaml',unregisteredOnly:true});
const singlePassPrompt=await loadSinglePassPrompt();
let captured:unknown;
try {
 await extractRefreshProfile([{id:'csets',docSha:'a'.repeat(64),originalKey:'csets.pdf',sourceUrl:'https://example.org/csets.pdf',pages:[1],text:'[PDF PAGE 1]\nCSETS_SOURCE_TEXT',} as any],{
 context,singlePassPrompt,maxOutputTokens:32000,
 textClient:{async generateJson(request:unknown){captured=request;throw new Error('captured');}} as any,
 });
} catch(error) {if((error as Error).message!=='captured') throw error;}
if(!captured) throw new Error('Prompt capture failed');
const {prompt,schema}=captured as {prompt:string;schema:string};
writeFileSync('/private/composition.json',JSON.stringify({prompt,schema,promptSha256:singlePassPrompt.sha256}),{mode:0o600});
console.log('Exact production prompt and schema captured');
