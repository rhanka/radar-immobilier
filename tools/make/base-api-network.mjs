// Diagnose container DNS independently of the database/application contract.
import { lookup } from 'node:dns/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
const address = (await lookup('postgres', { family: 4 })).address;
const outcomes = { named: { pass: 0, fail: 0 }, address: { pass: 0, fail: 0 } };
for (let i = 0; i < 24; i++) {
  for (const [kind, host] of [['named', 'postgres'], ['address', address]]) {
    const start = performance.now();
    const pool = new pg.Pool({ host, user: 'radar', password: 'synthetic-only',
      database: 'radar', connectionTimeoutMillis: 3000, max: 1 });
    try {
      await pool.query('SELECT 1');
      outcomes[kind].pass++;
      console.log(`${i} ${kind} PASS ${Math.round(performance.now() - start)}ms`);
    } catch (error) {
      outcomes[kind].fail++;
      console.log(`${i} ${kind} FAIL ${Math.round(performance.now() - start)}ms ${error.message}`);
    } finally { await pool.end(); }
  }
}
console.log(JSON.stringify({ address, outcomes }));
if (outcomes.address.fail) process.exitCode = 1;
