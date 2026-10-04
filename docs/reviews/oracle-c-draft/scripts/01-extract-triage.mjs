#!/usr/bin/env node
// Step 1 — read Steve's workbook (radar-triage-signaux.xlsx, read-only) and extract the Triage
// sheet labels + the motif-code dictionary into work/triage.json. Verifies the source sha256.
// Usage: node 01-extract-triage.mjs <path/to/radar-triage-signaux.xlsx>
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readXlsx } from './lib/xlsx-lite.mjs';
import { WORK, slugify } from './lib/common.mjs';

const EXPECTED_SHA = 'c7e19f46feb78c245fcd04b3e64fd4ac6f174f2d30ff1d4c77aa5a2bf0dc1bb8';
const src = process.argv[2];
if (!src) { console.error('usage: 01-extract-triage.mjs <xlsx>'); process.exit(2); }
const buf = fs.readFileSync(src);
const sha = crypto.createHash('sha256').update(buf).digest('hex');
if (sha !== EXPECTED_SHA) { console.error(`sha256 mismatch: ${sha}`); process.exit(1); }

const { sheets } = readXlsx(buf);
const triage = sheets.find((s) => s.name === 'Triage');
const codesSheet = sheets.find((s) => s.name === 'Codes de motif');
if (!triage || !codesSheet) throw new Error('expected sheets Triage and Codes de motif');

const HEADER_ROW = 5;
const header = triage.rows.get(HEADER_ROW);
if (header.get('Q') !== 'Classement' || header.get('R') !== 'Code de motif') throw new Error('unexpected Triage header');

const ID_RE = /(signal|event)-[A-Za-z0-9….-]+/g;
const rows = [];
for (const [r, cells] of [...triage.rows.entries()].sort((a, b) => a[0] - b[0])) {
  if (r <= HEADER_ROW || !cells.get('Q')) continue;
  const city = cells.get('C');
  const citySlug = slugify(city);
  const objet = cells.get('L') ?? '';
  const ids = [...new Set((objet.match(ID_RE) ?? []).map((s) => s.replace(/[.…-]+$/, '').replace('…', citySlug)))];
  rows.push({
    excelRow: r,
    lineNo: cells.get('A'),
    pass: cells.get('B'),
    city,
    citySlug,
    mrc: cells.get('D'),
    signalDate: cells.get('E'),
    docType: cells.get('F'),
    state: cells.get('G'),
    reglement: cells.get('H') ?? null,
    filtrage: cells.get('O'),
    sens: cells.get('P'),
    verdict: cells.get('Q'),
    motif: cells.get('R'),
    nodeIds: ids,
    noSignal: /AUCUN SIGNAL/.test(objet),
    // Steve's free-text columns (L objet, M analyse, S suite, T recommandation) are NOT exported:
    // they would leak his reasoning into model inputs and carry personal names (C-79).
  });
}

const codes = [];
for (const [r, cells] of codesSheet.rows) {
  if (r <= 4) continue;
  const code = cells.get('B');
  if (code && /^(P|S|N|V2)-/.test(code)) codes.push({ verdict: cells.get('A'), code, meaning: cells.get('C') });
}

fs.mkdirSync(WORK, { recursive: true });
fs.writeFileSync(path.join(WORK, 'triage.json'), JSON.stringify({ source: path.basename(src), sha256: sha, rows, codes }, null, 1));
console.log(JSON.stringify({ sha256: sha, rows: rows.length, codes: codes.length, withIds: rows.filter((x) => x.nodeIds.length).length }));
