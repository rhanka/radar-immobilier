// Pure helpers of the Chaperon Immobilier triage reprise (reference set C):
// CSV/xlsx reading, plan building, fresh-export diff. No I/O beyond reading the
// given files; nothing here touches a database or a cluster.
import { execFileSync } from 'node:child_process';

export const SOURCE = {
  label: 'reprise triage Chaperon 21/09',
  workbookRevision: '2026-09-18',
  transmitted: '2026-09-21',
  // SHA-256 of the plaintext reference-c.csv, as listed in docs/spec/reports/reference-c/README.md.
  referenceCsvSha256: 'f47ec61f0c14ad38e844732871ad5edaf0e1cc9bbda7e70b334ed91770703d07',
};
export const PROFILE = 'immo-steve-2026-09';
export const MAPPING_VERSION = 'chaperon-refc-facets/v1';

const VERDICTS = { 'Pertinent': 'pertinent', 'À surveiller': 'a_surveiller', 'Non pertinent': 'non_pertinent' };

export function parseCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export const slugify = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const normalizeText = (s) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').trim();

/** "[p. N] « text »" segments of a citation cell, normalized; the whole cell when unsegmented. */
export function citationSegments(cell) {
  const segments = [...cell.matchAll(/\[p\.\s*(\d+)\]\s*«([\s\S]*?)»/g)]
    .map((m) => ({ page: Number(m[1]), norm: normalizeText(m[2]).slice(0, 80) }));
  return segments.length ? segments : [{ page: null, norm: normalizeText(cell).slice(0, 80) }];
}

/** Pure: reference set C rows -> one classification target per graph node id. */
export function buildPlan(csvText) {
  const [header, ...rows] = parseCsv(csvText);
  const col = (name) => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`reference set C column missing: ${name}`);
    return index;
  };
  const c = { row: col('#'), ville: col('Ville'), q: col('Classement (Steve)'), r: col('Code motif (Steve)'),
    p: col('Sens (Steve)'), ids: col('ID signal'), pv: col('Lien PV'), citation: col('Citation') };
  const targets = []; const issues = [];
  for (const r of rows) {
    if (r.length !== header.length) { issues.push({ row: r[c.row], issue: 'width' }); continue; }
    const verdict = VERDICTS[r[c.q].trim()];
    const reasonCode = r[c.r].trim();
    if (!verdict) { issues.push({ row: r[c.row], issue: 'unknown_classement' }); continue; }
    if (!reasonCode) { issues.push({ row: r[c.row], issue: 'missing_reason_code' }); continue; }
    const ids = r[c.ids].split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0) { issues.push({ row: r[c.row], issue: 'no_node_id' }); continue; }
    const rawRefs = [...r[c.pv].matchAll(/rawRef=([^#&\s]+)/g)].map((m) => decodeURIComponent(m[1]));
    for (const id of ids) {
      targets.push({ row: Number(r[c.row]), citySlugHint: slugify(r[c.ville]), nodeId: id, verdict, reasonCode,
        sens: r[c.p].trim() || null, rawRefs, citations: citationSegments(r[c.citation]) });
    }
  }
  return { rows: rows.length, columns: header.length, targets, issues };
}

/** Minimal xlsx reader (unzip binary, no dependency): rows of one named sheet. */
export function readSheet(file, sheetName) {
  const unz = (p) => execFileSync('unzip', ['-p', file, p], { maxBuffer: 1 << 28 }).toString('utf8');
  const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&amp;/g, '&');
  const strings = [...unz('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)]
    .map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const rid = new RegExp(`<sheet [^>]*name="${sheetName}"[^>]*r:id="([^"]+)"`).exec(unz('xl/workbook.xml'));
  if (!rid) throw new Error(`sheet not found: ${sheetName}`);
  const rels = unz('xl/_rels/workbook.xml.rels');
  const target = new RegExp(`Id="${rid[1]}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid[1]}"`).exec(rels);
  const xml = unz(`xl/${(target[1] || target[2]).replace(/^\/?xl\//, '')}`);
  return [...xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)].map(([, n, body]) => ({
    n: Number(n),
    cells: Object.fromEntries([...body.matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)]
      .map(([, colName, attrs, inner]) => {
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner || '');
        const is = /<is>([\s\S]*?)<\/is>/.exec(inner || '');
        let value = v ? v[1] : is ? [...is[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('') : '';
        value = /t="s"/.test(attrs) && v ? strings[Number(v[1])] : dec(value);
        return [colName, value];
      })),
  }));
}

/** Compare the decisions (P/Q/R) and node ids (L) of a fresh Triage export with set C. Counts and row numbers only. */
export function diffFresh(csvText, freshRows) {
  const [header, ...rows] = parseCsv(csvText);
  const at = (name) => header.indexOf(name);
  const sealed = new Map(rows.map((r) => [Number(r[at('#')]), r]));
  const fresh = new Map(freshRows.filter((r) => r.n > 5 && /^\d+(\.0+)?$/.test((r.cells.A || '').trim()))
    .map((r) => [Number(r.cells.A), r.cells]));
  const changed = []; const idChanged = [];
  for (const [row, r] of sealed) {
    const f = fresh.get(row);
    if (!f) continue;
    const same = (a, b) => (a || '').trim() === (b || '').trim();
    if (!same(r[at('Sens (Steve)')], f.P) || !same(r[at('Classement (Steve)')], f.Q)
      || !same(r[at('Code motif (Steve)')], f.R)) changed.push(row);
    const freshId = /^((?:signal|event)-[A-Za-z0-9_.-]+)/.exec(f.L || '')?.[1];
    if (freshId && !r[at('ID signal')].split(/\s+/).includes(freshId)) idChanged.push(row);
  }
  return { freshRows: fresh.size, sealedRows: sealed.size,
    missingInFresh: [...sealed.keys()].filter((k) => !fresh.has(k)),
    newInFresh: [...fresh.keys()].filter((k) => !sealed.has(k)),
    decisionChanged: changed, nodeIdChanged: idChanged };
}
