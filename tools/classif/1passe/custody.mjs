// Après arrêt des sièges seulement. Archive scellée des résidus de cette lane.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sha256 } from '../lib/refc1.mjs';
import { home, save, writePrivate } from './context.mjs';
import { seatHome } from './quota.mjs';
const calls = fs.readFileSync(`${home}/annotation/calls.jsonl`, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const known = new Set(calls.map((r) => r.promptSha256));
const receipts = [], archive = `${home}/custody/residues`;
fs.mkdirSync(archive, { recursive: true, mode: 0o700 });
for (const entry of fs.readdirSync(os.tmpdir(), { withFileTypes: true })) {
  if (!entry.isDirectory() || !/^(classif-codex-seat-|seat-)/.test(entry.name)) continue;
  const folder = path.join(os.tmpdir(), entry.name), promptFile = path.join(folder, 'prompt.md');
  if (!fs.existsSync(promptFile)) continue;
  const bytes = fs.readFileSync(promptFile), hash = sha256(bytes);
  if (!known.has(hash)) continue;
  const payload = { prompt: bytes.toString(), files: {} };
  const answer = path.join(folder, 'work', 'last-message.md');
  if (fs.existsSync(answer)) payload.files['last-message.md'] = fs.readFileSync(answer, 'utf8');
  const target = `${archive}/${entry.name}`;
  const receipt = save(target, payload, true);
  fs.chmodSync(`${target}.sealed`, 0o600);
  receipts.push({ kind: 'temporary', hash, ...receipt });
  fs.rmSync(folder, { recursive: true, force: true });
}
function sessions(folder) {
  if (!fs.existsSync(folder)) return;
  for (const e of fs.readdirSync(folder, { withFileTypes: true })) {
    const f = path.join(folder, e.name);
    if (e.isDirectory()) sessions(f);
    else if (e.name.endsWith('.jsonl')) {
      const bytes = fs.readFileSync(f), hash = sha256(bytes);
      const target = `${archive}/session-${hash}`;
      const receipt = save(target, { bytes: bytes.toString('base64') }, true);
      fs.chmodSync(`${target}.sealed`, 0o600);
      receipts.push({ kind: 'session', hash, ...receipt });
      fs.unlinkSync(f);
    }
  }
}
sessions(path.join(seatHome, 'sessions'));
writePrivate(`${home}/custody/residue-receipts.json`, receipts);
console.log(JSON.stringify({ sealedResidues: receipts.length, receiptsSha256: sha256(JSON.stringify(receipts)) }));
