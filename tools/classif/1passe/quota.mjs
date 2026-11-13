import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { codexIsolatedConfig, seatEnv } from '../run-seat.mjs';

export const seatHome = path.join(os.homedir(), '.codex', '1passe-seat-astra-medium');
export function prepareSeat() {
  fs.mkdirSync(seatHome, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(seatHome, 'config.toml'), codexIsolatedConfig({ name: 'B+C', model: 'gpt-6-astra', effort: 'medium' }), { mode: 0o600 });
  const auth = path.join(seatHome, 'auth.json');
  if (!fs.existsSync(auth)) fs.copyFileSync(path.join(os.homedir(), '.codex', 'auth.json'), auth);
  fs.chmodSync(auth, 0o600);
}
export async function readQuota() {
  prepareSeat();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bc-quota-'));
  return new Promise((resolve, reject) => {
    const p = spawn('codex', ['app-server'], { cwd: dir, env: seatEnv({ CODEX_HOME: seatHome }), stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = '', settled = false;
    const end = (err, value) => {
      if (settled) return; settled = true; clearTimeout(timer); p.kill();
      fs.rmSync(dir, { recursive: true, force: true });
      if (err) reject(err); else resolve(value);
    };
    const timer = setTimeout(() => end(new Error('quota indisponible après 30 secondes')), 30000);
    const send = (x) => p.stdin.write(`${JSON.stringify(x)}\n`);
    p.stdout.on('data', (b) => {
      buffer += b;
      while (buffer.includes('\n')) {
        const i = buffer.indexOf('\n'), line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.id === 1) { send({ method: 'initialized' }); send({ id: 2, method: 'account/rateLimits/read' }); }
        if (j.id === 2) {
          if (j.error) end(new Error(`quota RPC : ${j.error.code}`));
          else end(null, { at: new Date().toISOString(), ordinaryUsageAllowed: j.result.ordinaryUsageAllowed, rateLimits: j.result.rateLimits });
        }
      }
    });
    p.stderr.resume(); p.on('error', () => end(new Error('échec du transport quota')));
    p.on('close', () => { if (!settled) end(new Error('quota : fermeture sans réponse')); });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'bc-quota', version: '1' }, capabilities: {} } });
  });
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  readQuota().then((q) => console.log(JSON.stringify(q))).catch((e) => { console.error(e.message); process.exitCode = 1; });
}
