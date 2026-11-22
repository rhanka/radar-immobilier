import {pairOneToOne} from '/home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass/tools/bench-v11/harness/oracle-v3-lib.mjs';
export function pairAct(input,text,acts){
 const stage=input.match(/étape = ([^;\n]+)/)?.[1]?.trim();
 const human={page:1,stage,anchor:text.slice(0,20),citation:text};
 const candidates=acts.flatMap(node=>(node.citations??[]).map(cite=>{
  // Native Graphify JSON is flat; some archived representations nest properties.
  // This is exactly the properties fallback used by bench-v11 scoreValidV2.
  const properties=node.properties??node;
  return {page:cite.page,stage:stage?(properties.etape??properties.stage??properties.stade):undefined,
   anchor:cite.excerpt?.slice(0,20)??'',citation:cite.excerpt??'',node};
 }));
 return pairOneToOne([human],candidates).pairs[0]?.[1]?.node??null;
}
