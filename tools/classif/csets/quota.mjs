import {writeFileSync} from 'node:fs';
import {call} from './seat.mjs';
import {home} from './inputs.mjs';
const r=await call('Reply only with {"ready":true}.');
const status={at:new Date().toISOString(),code:r.code,rateLimits:r.rateLimits,
 toolEvents:r.toolEvents,latencyMs:r.latencyMs,usage:r.usage,authError:r.authError};
writeFileSync(`${home}/quota-start.json`,JSON.stringify(status),{mode:0o600});
console.log(status);
