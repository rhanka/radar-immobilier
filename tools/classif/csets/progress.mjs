import {readFileSync,existsSync} from 'node:fs';
import {home} from './inputs.mjs';
const file=`${home}/calls.jsonl`;
const rows=existsSync(file)?readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
for(const half of ['tuning','blind']){
 const receipts=rows.filter(r=>r.half===half&&r.mode==='B'&&!r.intent);
 console.log({half,receipts:receipts.length,quota:receipts.at(-1)?.quotaUsedPercent,
  lastReceipt:receipts.at(-1)?.at});
}
