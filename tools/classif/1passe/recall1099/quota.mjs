import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { codexIsolatedConfig, seatEnv } from '../../run-seat.mjs';
import { home } from './context.mjs';
export const seatHome = `${home}/seat`;
export function prepareSeat() {
  fs.mkdirSync(seatHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(`${seatHome}/config.toml`, codexIsolatedConfig({ name: 'recall1099', model: 'gpt-6-astra', effort: 'low' }), { mode: 0o600 });
  if (!fs.existsSync(`${seatHome}/auth.json`)) fs.copyFileSync(path.join(os.homedir(), '.codex/auth.json'), `${seatHome}/auth.json`);
  fs.chmodSync(`${seatHome}/auth.json`, 0o600);
}
export async function readQuota() {
  prepareSeat();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'recall1099-quota-'));
  return new Promise((resolve, reject) => {
    const p = spawn('codex', ['app-server'], { cwd, env: seatEnv({ CODEX_HOME: seatHome }), stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', settled = false;
    const end = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer); p.kill();
      fs.rmSync(cwd, { recursive: true, force: true });
      if (error) reject(error); else resolve(result);
    };
    const timer = setTimeout(() => end(Error('quota unavailable')), 30000);
    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    p.stdout.on('data', (b) => {
      buffer += b;
      while (buffer.includes('\n')) {
        const i = buffer.indexOf('\n'), line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'account/rateLimits/read' }); }
        if (j.id === 2) end(j.error ? Error(`quota RPC ${j.error.code}`) : null,
          { at: new Date().toISOString(), ordinaryUsageAllowed: j.result?.ordinaryUsageAllowed, rateLimits: j.result?.rateLimits });
      }
    });
    p.stderr.resume(); p.on('error', () => end(Error('quota transport failed')));
    p.on('close', () => end(Error('quota closed without response')));
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'recall1099-quota', version: '1' }, capabilities: {} } });
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname) console.log(JSON.stringify(await readQuota()));
