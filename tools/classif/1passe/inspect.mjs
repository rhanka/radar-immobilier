import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const home = path.join(os.homedir(), '.local/share/radar-classif');
const manifest = JSON.parse(fs.readFileSync(`${home}/1passe-bc/source/manifest.json`, 'utf8'));
const needed = new Map(manifest.documents.map((d) => [d.sha256, d]));
const found = new Map();
const out = `${home}/1passe-bc/texts`;
fs.mkdirSync(out, { recursive: true, mode: 0o700 });
function walk(dir) {
  let entries; try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (['.git', 'node_modules', '.env', 'custody'].includes(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.isFile() && /^([a-f0-9]{64})(\.raw)?\.(txt|pdf)$/.test(e.name)) {
      const sha = e.name.slice(0, 64), d = needed.get(sha);
      if (!d || found.has(sha)) continue;
      let bytes = fs.readFileSync(f);
      if (e.name.endsWith('.pdf')) {
        if (createHash('sha256').update(bytes).digest('hex') !== d.sha256) continue;
        const r = spawnSync('pdftotext', ['-q', '-enc', 'UTF-8', f, '-'], { maxBuffer: 10000000 });
        if (r.status !== 0) continue;
        bytes = r.stdout;
      }
      if (createHash('sha256').update(bytes).digest('hex') !== d.textSha256) continue;
      fs.writeFileSync(`${out}/${sha}.txt`, bytes, { mode: 0o600 }); found.set(sha, f);
    }
  }
}
walk('/home/antoinefa/src/radar-immobilier/tmp');
walk(home);
for (const [sha, d] of needed) {
  if (found.has(sha)) continue;
  try {
    const response = await fetch(d.sourceUrl, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) continue;
    const pdf = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(pdf).digest('hex') !== sha) continue;
    const pdfPath = `${out}/${sha}.pdf`;
    fs.writeFileSync(pdfPath, pdf, { mode: 0o600 });
    const r = spawnSync('pdftotext', ['-q', '-enc', 'UTF-8', pdfPath, '-'], { maxBuffer: 10000000 });
    if (r.status || createHash('sha256').update(r.stdout).digest('hex') !== d.textSha256) continue;
    fs.writeFileSync(`${out}/${sha}.txt`, r.stdout, { mode: 0o600 }); found.set(sha, pdfPath);
  } catch { /* texte non vérifié : porte fermée */ }
}
fs.writeFileSync(`${home}/1passe-bc/text-verification.json`, JSON.stringify({ at: new Date().toISOString(), verified: found.size, expected: needed.size, files: Object.fromEntries(found) }), { mode: 0o600 });
console.log(JSON.stringify({ verified: found.size, expected: needed.size, missing: needed.size - found.size }));
if (found.size !== needed.size) process.exitCode = 1;
