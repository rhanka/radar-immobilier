import path from 'node:path';
import {ROUTES,callSeat,ensureCodexHome,isCodexSeat} from '../run-seat.mjs';
// Reuse C's transport, parser, isolation and tool accounting, with a lane-owned home.
// Never sweep or write the Astra homes of concurrently running lanes.
function ensureLaneCodexRoute(label){
 const base=ROUTES[label];
 if(!base) throw new Error(`unknown route ${label}`);
 const laneLabel=`csets-${label}`;
 if(!ROUTES[laneLabel]){
  ROUTES[laneLabel]={...base,build(dir,_file,prompt){
   return {cmd:'codex',args:['exec','-m',base.model,'-c',`model_reasoning_effort=${base.effort}`,'-s','read-only',
   '--skip-git-repo-check','--json','-o',path.join(dir,'last-message.md'),'-'],stdin:prompt,
   env:{CODEX_HOME:ensureCodexHome(laneLabel,{model:base.model,effort:base.effort,root:'/tmp/radar-csets-seats'})}};
  }};
 }
 return laneLabel;
}
// BENCH_MODEL is a route label of the shared catalogue (run-seat.mjs ROUTES):
// astra-low, astra-6.2-low (codex seats), gemini-4-hydrogen-low,
// gemini-4-neon-low, gemini-3.8-flash-low (agy seats). Unknown labels fail
// in callSeat, never silently fall back.
export const benchModel=process.env.BENCH_MODEL??'astra-low';
export const isCodexBench=isCodexSeat(benchModel);
export const call=prompt=>isCodexBench
 ?callSeat(ensureLaneCodexRoute(benchModel),prompt,{timeoutMs:1800000})
 :callSeat(benchModel,prompt,{timeoutMs:1800000});
