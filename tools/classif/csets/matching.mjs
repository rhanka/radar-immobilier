import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const oracleCandidates=[
 process.env.BENCH_B_DIR&&`${process.env.BENCH_B_DIR}/harness/oracle-v3-lib.mjs`,
 '/home/antoinefa/src/radar-immobilier/tmp/refresh-single-pass/tools/bench-v11/harness/oracle-v3-lib.mjs',
 '/home/antoinefa/src/radar-immobilier/.claude/worktrees/agent-ae1c01a14a9859391/tools/bench-v11/harness/oracle-v3-lib.mjs',
].filter(Boolean);
const oraclePath=oracleCandidates.find(existsSync)??oracleCandidates[0];
const {pairOneToOne}=await import(pathToFileURL(oraclePath).href);
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
