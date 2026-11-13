import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {load,sourceText,home,hash} from './inputs.mjs';
import {seal,unseal,keyFromEnv} from '../lib/refc1.mjs';
const half=process.argv[2]??'tuning',blind=half==='blind';
const key=blind?keyFromEnv('CLASSIF_BLIND_KEY'):null;
const rows=load(half),byId=new Map(rows.map(x=>[x.item.itemId,x.item]));
const batch=[];
for(const file of readdirSync(`${home}/${half}`).filter(x=>x.startsWith('A-')&&x.endsWith(blind?'.sealed':'.json'))){
 const bytes=readFileSync(`${home}/${half}/${file}`);
 const c=JSON.parse(blind?unseal(key,bytes):bytes.toString());
 if(!c.request||!c.result) continue;
 const item=byId.get(c.itemId),text=sourceText(item);
 const docSha=item.anchor.docSha??item.anchor.docShas?.[0]??hash(text);
 batch.push({file,digest:c.digest,text:c.result.text,chunk:{id:'csets',docSha,originalKey:`${item.itemId}.pdf`,
 sourceUrl:`https://csets.invalid/${docSha}`,pages:[1],text:`[PDF PAGE 1]\n${text}`}});
}
const bytes=Buffer.from(JSON.stringify(batch));
writeFileSync(`${home}/validation-batch.${blind?'sealed':'json'}`,blind?seal(key,bytes):bytes,{mode:0o600});
console.log({nativeValidationBatch:batch.length});
