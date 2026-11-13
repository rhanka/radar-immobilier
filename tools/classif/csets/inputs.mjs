import {readFileSync,copyFileSync,existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {privateDir} from '../lib/paths.mjs';
import {openBlindSet} from '../lib/blind.mjs';
export const source='/home/antoinefa/.local/share/radar-classif';
export const refresh='/home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass';
export const home=process.env.CLASSIF_HOME;
export const hash=x=>createHash('sha256').update(x).digest('hex');
export const json=f=>JSON.parse(readFileSync(f,'utf8'));
const jsonl=f=>readFileSync(f,'utf8').trim().split('\n').map(JSON.parse);
export function load(half){
 const corpus=new Map(jsonl(`${source}/l0/dev-items.jsonl`).map(x=>[x.itemId,x]));
 let refs;
 if(half==='tuning') {
  const file=`${source}/l3b/reference-d.jsonl`;
  if(hash(readFileSync(file))!==json('tools/classif/l3/manifests/reference-d.json').hashes.referenceD) throw new Error('Reference checksum mismatch');
  refs=jsonl(file).filter(x=>x.half===half);
 }
 else {
  privateDir(`${home}/blind`);
  if(!existsSync(`${home}/blind/blind.sealed`)) copyFileSync(`${source}/blind/blind.sealed`,`${home}/blind/blind.sealed`);
  const manifest=json('tools/classif/l3/manifests/reference-d.json');
  refs=openBlindSet({home,purpose:'single-pass-csets',expectPlainSha256:manifest.hashes.blindPlain});
 }
 return refs.map(ref=>({ref,item:corpus.get(ref.itemId)}));
}
export function sourceText(item){
 if(item.kind==='pv') return item.input.replace(/^Municipalité[^\n]*\nDocument[^\n]*\n\n/,'');
 const tail=item.input.split('Extraits du document source (verbatim) :\n')[1];
 if(!tail) return null;
 return tail.replace(/^- « /gm,'').replace(/ »$/gm,'');
}
export function request(item,mode){
 const manifest=json(`${refresh}/radar/prompts/refresh-single-pass.json`);
 const frozen=readFileSync(`${refresh}/radar/prompts/${manifest.file}`,'utf8');
 if(hash(frozen)!==manifest.sha256) throw new Error('Immutable prompt checksum mismatch');
 if(mode==='B') return {prompt:`${frozen}\n\nMode: reannotation of one existing signal. Return ONLY one annotation object.\n\n${item.input}`,schema:null};
 const text=sourceText(item);
 if(!text?.trim()) return null;
 const template=json(`${home}/composition.json`);
 if(template.promptSha256!==manifest.sha256) throw new Error('Composition and prompt differ');
 const docSha=item.anchor.docSha??item.anchor.docShas?.[0]??hash(text);
 const subst=x=>x.replaceAll('a'.repeat(64),docSha)
  .replaceAll('https://example.org/csets.pdf',`https://csets.invalid/${docSha}`)
  .replaceAll('csets.pdf',`${item.itemId}.pdf`);
 // Insert source text last; literal replacement strings must preserve source dollar signs.
 const prompt=subst(template.prompt).replace('CSETS_SOURCE_TEXT',()=>text);
 return {prompt:`${prompt}\n\nJSON schema:\n${subst(template.schema)}`,schema:subst(template.schema)};
}
