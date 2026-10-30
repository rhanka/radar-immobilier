// Read probe of the cutover rehearsal: 5 Hz on /health, /build.json and the MCP metadata,
// one JSON line per response (or transport error) until SIGTERM/SIGINT.
// Usage: node deploy/cutover/availability-probe.mjs <base-url> <output.jsonl>
/* global fetch, AbortSignal */
import { appendFileSync } from 'node:fs';
import process from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
export const PATHS = ['/health', '/build.json', '/.well-known/oauth-protected-resource/mcp'];
export async function probeOnce(base, path, fetchImpl = fetch) {
  const t = Date.now();
  try {
    const res = await fetchImpl(base + path, { signal: AbortSignal.timeout(2000), headers: { 'cache-control': 'no-cache' } });
    const text = await res.text();
    let sha = null;
    try { sha = JSON.parse(text).sha ?? null; } catch { /* non-JSON body */ }
    return { t, path, code: res.status, ms: Date.now() - t, sha };
  } catch (e) {
    return { t, path, code: 0, ms: Date.now() - t, error: e.name === 'TimeoutError' ? 'timeout' : 'connection' };
  }
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const [base, out] = process.argv.slice(2);
  let running = true;
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { running = false; });
  while (running) {
    const tick = Date.now();
    for (const path of PATHS) void probeOnce(base, path).then(r => appendFileSync(out, `${JSON.stringify(r)}\n`));
    await sleep(Math.max(0, 200 - (Date.now() - tick)));
  }
  await sleep(2100);
}
