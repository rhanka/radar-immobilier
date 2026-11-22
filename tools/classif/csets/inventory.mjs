import {writeFileSync} from 'node:fs';
import {load,sourceText,home,hash} from './inputs.mjs';
import {seal,keyFromEnv} from '../lib/refc1.mjs';
const half=process.argv[2]??'tuning',blind=half==='blind';
const rows=load(half).map(({item,ref})=>({itemId:item.itemId,kind:item.kind,
 referenceClass:ref.verdict,referenceCode:ref.code,provenance:ref.label_provenance,
 sourceAnchor:item.anchor,rawKey:item.rawKey??null,inputSha256:item.inputSha256,
 input:item.input,sourceText:sourceText(item)}));
const bytes=Buffer.from(JSON.stringify(rows));
writeFileSync(`${home}/${half}-inventory.${blind?'sealed':'json'}`,blind?seal(keyFromEnv('CLASSIF_BLIND_KEY'),bytes):bytes,{mode:0o600});
console.log({half,units:rows.length,signals:rows.filter(x=>x.kind==='signal').length,
 PVs:rows.filter(x=>x.kind==='pv').length,missingSource:rows.filter(x=>!x.sourceText).length,
 inventorySha256:hash(bytes)});
