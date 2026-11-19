import path from 'node:path';
import {ROUTES,callSeat,ensureCodexHome} from '../run-seat.mjs';
// Reuse C's transport, parser, isolation and tool accounting, with a lane-owned home.
// Never sweep or write the Astra homes of concurrently running lanes.
ROUTES['csets-astra-low']={...ROUTES['astra-low'],build(dir,_file,prompt){
 return {cmd:'codex',args:['exec','-m','gpt-6-astra','-c','model_reasoning_effort=low','-s','read-only',
 '--skip-git-repo-check','--json','-o',path.join(dir,'last-message.md'),'-'],stdin:prompt,
 env:{CODEX_HOME:ensureCodexHome('csets-astra-low',{model:'gpt-6-astra',effort:'low',root:'/tmp/radar-csets-seats'})}};
}};
// BENCH_MODEL is a route label of the shared catalogue (run-seat.mjs ROUTES):
// astra-low (codex seat, the historical default), gemini-4-hydrogen-low,
// gemini-4-neon-low, gemini-3.8-flash-low (agy seats). Unknown labels fail
// in callSeat, never silently fall back.
export const benchModel=process.env.BENCH_MODEL??'astra-low';
export const isCodexBench=benchModel==='astra-low';
export const call=prompt=>isCodexBench
 ?callSeat('csets-astra-low',prompt,{timeoutMs:1800000})
 :callSeat(benchModel,prompt,{timeoutMs:1800000});
