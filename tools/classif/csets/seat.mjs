import path from 'node:path';
import {ROUTES,callSeat,ensureCodexHome} from '../run-seat.mjs';
// Reuse C's transport, parser, isolation and tool accounting, with a lane-owned home.
// Never sweep or write the Astra homes of concurrently running lanes.
ROUTES['csets-astra-low']={...ROUTES['astra-low'],build(dir,_file,prompt){
 return {cmd:'codex',args:['exec','-m','gpt-6-astra','-c','model_reasoning_effort=low','-s','read-only',
 '--skip-git-repo-check','--json','-o',path.join(dir,'last-message.md'),'-'],stdin:prompt,
 env:{CODEX_HOME:ensureCodexHome('csets-astra-low',{model:'gpt-6-astra',effort:'low',root:'/tmp/radar-csets-seats'})}};
}};
export const call=prompt=>callSeat('csets-astra-low',prompt,{timeoutMs:1800000});
