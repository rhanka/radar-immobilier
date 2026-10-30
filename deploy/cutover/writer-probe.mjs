// Writer probe of the cutover rehearsal: 5 writes/s through the public URL to
// POST /api/internal/cutover-probe (bearer CUTOVER_PROBE_TOKEN), one JSON line per answer.
// Usage: node deploy/cutover/writer-probe.mjs <base-url> <probe-run-id> <output.jsonl>
/* global fetch, AbortSignal */
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
export async function writeOnce(base, run, seq, token, fetchImpl = fetch) {
  const t = Date.now();
  try {
    const res = await fetchImpl(`${base}/api/internal/cutover-probe`, { method: 'POST', signal: AbortSignal.timeout(2000),
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ run, seq }) });
    let body = {};
    try { body = await res.json(); } catch { /* non-JSON body */ }
    return { t, seq, code: res.status, ms: Date.now() - t, db: body.db ?? null, error: body.error ?? null };
  } catch (e) {
    return { t, seq, code: 0, ms: Date.now() - t, db: null, error: e.name === 'TimeoutError' ? 'timeout' : 'connection' };
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, run, out] = process.argv.slice(2);
  const token = process.env.CUTOVER_PROBE_TOKEN || '';
  if (!/^[a-z0-9-]{1,64}$/.test(run || '') || token.length < 32) { process.stderr.write('writer probe refused: run id or token\n'); process.exit(2); }
  let running = true;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { running = false; });
  for (let seq = 1; running; seq++) {
    const tick = Date.now();
    void writeOnce(base, run, seq, token).then(r => appendFileSync(out, `${JSON.stringify(r)}\n`));
    await sleep(Math.max(0, 200 - (Date.now() - tick)));
  }
  await sleep(2100);
}
