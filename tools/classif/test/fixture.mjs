// Synthetic, label-free-by-construction fixtures: a fake Steve workbook (124 rows, 28 codes)
// written as a stored (uncompressed) XLSX, and a fake reference-c folder sealed with a test key.
// No real data is used anywhere in the tests.
import { Buffer } from 'node:buffer';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { seal, sha256 } from '../lib/refc1.mjs';
import { toCsv } from '../lib/csv.mjs';

export function zipStore(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(entries.length, 8); eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12); eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sheetXml = (rows) => `<worksheet><sheetData>${rows.map(([r, cells]) => `<row r="${r}">${Object.entries(cells)
  .map(([c, v]) => `<c r="${c}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`;

export const CODES = ['P-VILLE-TERRITOIRE', 'P-NOUV-ZONE', 'P-PERIM-URB', 'P-DENSITE', 'P-USAGE-MULTI', 'P-TYPO-INTERM', 'P-PROJ-INTEGRE', 'P-NORMES',
  'S-MANDAT-AMONT', 'S-PLANIFIE', 'S-PORTEE-FLOUE', 'S-CONTRAINTE', 'S-RESTRICTIF', 'S-INFO-MANQUANTE', 'S-PPCMOI-SERIE', 'S-PREEMPTION',
  'N-ACCESSOIRE', 'N-RETIRE', 'N-FORME', 'N-ODJ-SEUL', 'N-NON-RES', 'N-ADMIN', 'N-RESTRICTIF', 'N-UNIFAM', 'N-DOUBLON', 'N-HORS-TERR', 'N-FAUX-POSITIF', 'V2-PRECEDENT'];

export const VERDICTS = ['Pertinent', 'À surveiller', 'Non pertinent'];

export function fakeRows(n = 124) {
  return Array.from({ length: n }, (_, i) => {
    const line = i + 1;
    const anchor = { 14: "Saint-Jean-Baptiste", 55: "Mont-Saint-Hilaire", 58: "Sainte-Cécile-de-Milton" }[line];
    const city = anchor ?? `Ville Fictive ${line % 40}`;
    return { line, city, slug: `ville-fictive-${line % 40}`, id: `signal-ville-fictive-${line % 40}-item${line}`, verdict: VERDICTS[line % 3], code: CODES[line % 28], bylaw: `90${line}-1` };
  });
}

/**
 * layout "hash-in-A": column A holds the Triage "#" (oracle-c assumption).
 * layout "id-in-A": column A holds a non-numeric reference (e.g. "S-2026-09-15-007"), no "#"
 *   column; the line number is the Excel order. The first parser read A and found none of the
 *   expected lines (conductor run of 2026-10-31): this layout reproduces that failure.
 * layout "hash-in-S": a "N°" column elsewhere, rows physically shuffled.
 */
export function fakeWorkbook(rows = fakeRows(), { layout = "id-in-A" } = {}) {
  const head = { B: 'Passe', C: 'Municipalité', H: 'Règlement', L: 'Objet', Q: 'Classement', R: 'Code de motif' };
  if (layout === "hash-in-A") head.A = '#';
  if (layout === "id-in-A") head.A = 'Réf.';
  if (layout === "hash-in-S") head.S = 'N°';
  const ordered = layout === "hash-in-S" ? [...rows].sort((a, b) => ((a.line * 37) % 124) - ((b.line * 37) % 124)) : rows;
  const triage = [[5, head], ...ordered.map((r, i) => {
    const cells = { B: '1 — 5 filtres', C: r.city, H: r.bylaw, L: `Signal ${r.id} (page 2)`, Q: r.verdict, R: r.code };
    if (layout === "hash-in-A") cells.A = String(r.line);
    if (layout === "id-in-A") cells.A = `S-2026-09-${String(15 + (r.line % 7)).padStart(2, "0")}-${String((r.line * 7919) % 1000).padStart(3, "0")}`;
    if (layout === "hash-in-S") cells.S = String(r.line);
    return [6 + i, cells];
  })];
  const codes = [[4, { A: 'Classement', B: 'Code', C: 'Signification' }],
    ...CODES.map((c, i) => [5 + i, { A: 'x', B: c, C: `Definition of ${c} (ex. ligne 12). Ex : cas 3.` }])];
  return zipStore([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Triage" sheetId="1" r:id="rId1"/><sheet name="Codes de motif" sheetId="2" r:id="rId2"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>'],
    ['xl/worksheets/sheet1.xml', sheetXml(triage)],
    ['xl/worksheets/sheet2.xml', sheetXml(codes)],
  ]);
}

/** Writes a fake reference-c folder (sealed xlsx + csv + README with plaintext hashes). */
export function fakeReferenceC(dir, refKey, rows = fakeRows(), opts = {}) {
  mkdirSync(dir, { recursive: true });
  const xlsx = fakeWorkbook(rows, opts);
  const retained = rows.filter((r) => ![14, 55, 58].includes(r.line));
  const csv = Buffer.from(`﻿${toCsv([['#', 'Ville', 'Liens'], ...retained.map((r) => [r.line, r.city, `https://example.invalid/doc/${'a'.repeat(63)}${r.line % 10} ${r.id}`])])}`);
  writeFileSync(path.join(dir, 'reference-c.xlsx.sealed'), seal(refKey, xlsx));
  writeFileSync(path.join(dir, 'reference-c.csv.sealed'), seal(refKey, csv));
  writeFileSync(path.join(dir, 'README.md'), `| Sealed file | Content | SHA-256 of plaintext |\n|---|---|---|\n| \`reference-c.xlsx.sealed\` | x | \`${sha256(xlsx)}\` |\n| \`reference-c.csv.sealed\` | x | \`${sha256(csv)}\` |\n`);
  return { xlsx, csv };
}

export const newKey = () => randomBytes(32);

export const fakeFetchNodes = (ids) => ids.filter((id) => !id.endsWith('item20')).map((id) => ({
  id, type: 'Signal', label: `Label ${id}`, city_slug: id.replace(/^signal-/, '').replace(/-item\d+$/, ''),
  props: { properties: { date: '2026-05-01', docSha: 'b'.repeat(64), reglement_number: '2026-01' }, refs: [{ docSha: 'c'.repeat(64), excerpt: `Extrait du document pour ${id} avec assez de mots pour former plusieurs shingles de douze mots chacun ici` }] },
}));
