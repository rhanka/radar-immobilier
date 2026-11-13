import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {load,sourceText,home,hash} from './inputs.mjs';
const rows=load('tuning'),byId=new Map(rows.map(x=>[x.item.itemId,x.item]));
const batch=[];
for(const file of readdirSync(`${home}/tuning`).filter(x=>x.startsWith('A-')&&x.endsWith('.json'))){
 const c=JSON.parse(readFileSync(`${home}/tuning/${file}`,'utf8'));
 if(!c.request||!c.result) continue;
 const item=byId.get(c.itemId),text=sourceText(item);
 const docSha=item.anchor.docSha??item.anchor.docShas?.[0]??hash(text);
 batch.push({file,digest:c.digest,text:c.result.text,chunk:{id:'csets',docSha,originalKey:`${item.itemId}.pdf`,
 sourceUrl:`https://csets.invalid/${docSha}`,pages:[1],text:`[PDF PAGE 1]\n${text}`}});
}
writeFileSync(`${home}/validation-batch.json`,JSON.stringify(batch),{mode:0o600});
console.log({nativeValidationBatch:batch.length});
