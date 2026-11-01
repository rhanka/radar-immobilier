// Steve's workbook (the original "Triage" and "Codes de motif" tabs carried inside reference-c.xlsx).
// Layout from origin/feat/oracle-c-draft 01-extract-triage.mjs: header row 5, Q = "Classement",
// R = "Code de motif"; A = line number (#), C = city, H = bylaw, L = object (node ids).
// Partitions from the gap analysis (etude-classif sources-bundle.md:478 and :34, :595-613):
//   retained 121 = Triage 124 minus #14, #55, #58 (no resolvable radar node);
//   evaluation set = retained minus the 8 rows not evaluated in the final pass
//   (#18, #27, #77, #82, #93, #104, #112, #119) = 113 rows.
import { readXlsx } from './xlsx-lite.mjs';

export const HEADER_ROW = 5;
export const NOT_RETAINED = [14, 55, 58];
export const NOT_EVALUATED = [18, 27, 77, 82, 93, 104, 112, 119];
export const EXPECTED = { triage: 124, retained: 121, evaluation: 113, codes: 28 };

export const slugify = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Full graph node ids only (an abbreviated id with an ellipsis is not kept).
export const NODE_ID_RE = /\b(?:signal|event|doc|source|bylaw|zone|lot)-[a-z0-9][a-z0-9._-]*[a-z0-9]/gi;
export const SHA_RE = /\b[0-9a-f]{64}\b/g;

export function nodeIdsIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(NODE_ID_RE)) {
    const end = m.index + m[0].length;
    if (String(text)[end] === '…') continue;
    out.add(m[0]);
  }
  return [...out];
}

export const shasIn = (text) => [...new Set(String(text ?? '').match(SHA_RE) ?? [])];

/** Normalises a bylaw cell into a list of bylaw numbers (e.g. "2024-12, 2024-13"). */
export function bylawsIn(text) {
  const out = new Set();
  for (const m of String(text ?? '').matchAll(/\b\d{1,4}(?:[-./]\d{1,4}){0,3}(?:-[A-Z]{1,3}\d{0,3})?\b/g)) {
    if (/\d/.test(m[0]) && m[0].length >= 3) out.add(m[0]);
  }
  return [...out];
}

// Anchors that pin the Triage line numbering (public facts, sources-bundle.md:478): line #14 is
// in Saint-Jean-Baptiste, #55 in Mont-Saint-Hilaire, #58 in Sainte-Cécile-de-Milton.
export const ANCHORS = { 14: 'saint-jean-baptiste', 55: 'mont-saint-hilaire', 58: 'sainte-cecile-de-milton' };

const INT_RE = /^\s*(?:#|n°|no\.?)?\s*(\d{1,4})(?:\.0+)?\s*$/i;

/** Column letter of the first header matching `re`, else `fallback`. */
function headerColumn(header, re, fallback) {
  for (const [col, text] of header) if (re.test(String(text).trim())) return col;
  return fallback;
}

/**
 * Line number (Triage "#") of each row. Candidates, in order: a header named "#"/"n°"/"No";
 * any column whose values are exactly the integers 1..n; the Excel order (row − first row + 1).
 * The first candidate whose numbering puts the 3 anchor cities at #14, #55, #58 is kept.
 */
export function detectNumbering(header, raw, cityCol) {
  const n = raw.length;
  const candidates = [];
  const named = [...header].filter(([, t]) => /^\s*(#|n°|no\.?|num(é|e)ro|ligne)\s*$/i.test(String(t))).map(([c]) => c);
  const cols = [...new Set([...named, ...[...header.keys()], ...new Set(raw.flatMap((r) => [...r.cells.keys()]))])];
  for (const col of cols) {
    const nums = raw.map((r) => { const m = String(r.cells.get(col) ?? '').match(INT_RE); return m ? Number(m[1]) : null; });
    if (nums.some((v) => v === null)) continue;
    const set = new Set(nums);
    if (set.size !== n || Math.min(...nums) !== 1 || Math.max(...nums) !== n) continue;
    candidates.push({ source: `column ${col} (${header.get(col) ?? 'no header'})`, nums });
  }
  candidates.push({ source: 'excel order', nums: raw.map((r) => r.excelRow - raw[0].excelRow + 1) });
  const tried = [];
  for (const c of candidates) {
    const at = (line) => slugify(raw[c.nums.indexOf(Number(line))]?.cells.get(cityCol) ?? '');
    const ok = Object.entries(ANCHORS).every(([line, slug]) => at(line).includes(slug));
    tried.push(`${c.source}: ${Object.keys(ANCHORS).map((l) => `#${l}=${at(l) || '?'}`).join(', ')}`);
    if (ok) return { source: c.source, nums: c.nums, tried };
  }
  const headers = [...header].map(([c, t]) => `${c}=${JSON.stringify(String(t).slice(0, 40))}`).join(' ');
  throw new Error(`workbook: no Triage numbering places the anchor cities at #14/#55/#58. Tried: ${tried.join(' | ')}. Row-5 headers: ${headers}`);
}

/** Parses the workbook buffer. Returns rows (all 124) and the codes dictionary. */
export function parseWorkbook(buf) {
  const { sheets } = readXlsx(buf);
  const triage = sheets.find((s) => s.name === 'Triage');
  const codesSheet = sheets.find((s) => s.name === 'Codes de motif');
  if (!triage || !codesSheet) throw new Error('workbook: expected sheets "Triage" and "Codes de motif"');
  const header = triage.rows.get(HEADER_ROW);
  if (!header || header.get('Q') !== 'Classement' || header.get('R') !== 'Code de motif') {
    throw new Error('workbook: unexpected Triage header (Q must be "Classement", R "Code de motif")');
  }
  const col = {
    city: headerColumn(header, /^(municipalit|ville)/i, 'C'),
    pass: headerColumn(header, /^passe/i, 'B'),
    bylaw: headerColumn(header, /r[èe]glement/i, 'H'),
    objet: headerColumn(header, /^objet/i, 'L'),
  };
  const raw = [...triage.rows.entries()].sort((a, b) => a[0] - b[0])
    .filter(([r, cells]) => r > HEADER_ROW && cells.get('Q'))
    .map(([excelRow, cells]) => ({ excelRow, cells }));
  const numbering = detectNumbering(header, raw, col.city);
  const rows = raw.map(({ excelRow, cells }, i) => {
    const allText = [...cells.values()].join('\n');
    const citySlug = slugify(cells.get(col.city));
    // The object column may abbreviate the city part of an id with "…" (oracle-c 01-extract-triage.mjs).
    const abbreviated = (String(cells.get(col.objet) ?? '').match(/(?:signal|event)-[A-Za-z0-9….-]+/g) ?? [])
      .filter((s) => s.includes('…'))
      .map((s) => s.replace(/[.…-]+$/, '').replace('…', citySlug));
    return {
      excelRow,
      lineNo: numbering.nums[i],
      pass: cells.get(col.pass) ?? null,
      city: cells.get(col.city) ?? '',
      citySlug,
      bylaws: bylawsIn(cells.get(col.bylaw)),
      nodeIds: [...new Set([...nodeIdsIn(allText), ...abbreviated])],
      docShas: shasIn(allText),
      verdict: cells.get('Q'),
      code: cells.get('R') ?? null,
    };
  }).sort((a, b) => a.lineNo - b.lineNo);
  // Codes: any cell that is exactly a code; its meaning = the longest other text cell of the row.
  // Layout-independent (the oracle-c reader assumed B = code, C = meaning, rows > 4).
  const codes = [];
  const seenCodes = new Set();
  for (const [, cells] of [...codesSheet.rows.entries()].sort((x, y) => x[0] - y[0])) {
    for (const [c, v] of cells) {
      const code = String(v).trim();
      if (!/^(P|S|N|V2)-[A-Z0-9-]+$/.test(code) || seenCodes.has(code)) continue;
      const others = [...cells].filter(([k]) => k !== c).map(([, t]) => String(t)).filter((t) => !/^(P|S|N|V2)-[A-Z0-9-]+$/.test(t.trim()));
      const meaning = others.sort((x, y) => y.length - x.length)[0] ?? "";
      seenCodes.add(code);
      codes.push({ code, meaning });
    }
  }
  // Every node id / sha256 / city anywhere in the workbook (all tabs): exposure is workbook-wide.
  const workbookNodeIds = new Set();
  const workbookShas = new Set();
  for (const s of sheets) {
    for (const cells of s.rows.values()) {
      for (const v of cells.values()) {
        for (const id of nodeIdsIn(v)) workbookNodeIds.add(id);
        for (const h of shasIn(v)) workbookShas.add(h);
      }
    }
  }
  return { rows, codes, numberingSource: numbering.source, columns: col, workbookNodeIds: [...workbookNodeIds], workbookShas: [...workbookShas] };
}

/** Splits rows into retained and evaluation partitions and checks the documented counts. */
export function partition(rows, { strict = true } = {}) {
  const byLine = new Map(rows.map((r) => [r.lineNo, r]));
  const problems = [];
  if (rows.length !== EXPECTED.triage) problems.push(`Triage rows ${rows.length} != ${EXPECTED.triage}`);
  if (byLine.size !== rows.length) problems.push('duplicate line numbers');
  for (const n of [...NOT_RETAINED, ...NOT_EVALUATED]) if (!byLine.has(n)) problems.push(`line #${n} missing`);
  const retained = rows.filter((r) => !NOT_RETAINED.includes(r.lineNo));
  const evaluation = retained.filter((r) => !NOT_EVALUATED.includes(r.lineNo));
  if (retained.length !== EXPECTED.retained) problems.push(`retained ${retained.length} != ${EXPECTED.retained}`);
  if (evaluation.length !== EXPECTED.evaluation) problems.push(`evaluation ${evaluation.length} != ${EXPECTED.evaluation}`);
  if (strict && problems.length) throw new Error(`partition check failed: ${problems.join('; ')}`);
  return { retained, evaluation, problems };
}

/**
 * Definitions for the allowed pack: code + verdict + meaning, with any count or example removed
 * (parentheses or sentences introduced by "ex", "exemple", "#", or containing a number of rows).
 */
export function sanitizeDefinition(text) {
  return String(text ?? '')
    .replace(/\((?:[^()]*?\b(?:ex\.?|exemples?|e\.g\.|cf\.|#|n°|lignes?|cas)\b[^()]*)\)/gi, '')
    .replace(/(?:^|[.;]\s*)(?:ex\.?|exemples?|e\.g\.)\s*:?[^.;]*[.;]?/gi, '. ')
    .replace(/#\s?\d+/g, '')
    .replace(/\b\d+\s+(?:lignes?|cas|signaux)\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/^[.\s]+|\s+$/g, '');
}

/** Verdict partition of a code, as in facet_reason_codes (api/drizzle/0014_facets_signal.sql). */
export const verdictOfCode = (code) => (/^P-/.test(code) ? 'pertinent' : /^S-/.test(code) ? 'a_surveiller' : 'non_pertinent');

/** Codes of profile immo-steve-2026-09 as seeded by the migration (public, in the repo). */
export function codebookFromMigration(sqlText) {
  return [...sqlText.matchAll(/\('immo-steve-2026-09',\s*'([^']+)',\s*'([^']+)'\)/g)].map((m) => ({ code: m[1], verdict: m[2] }));
}

export function codesMarkdown(codes) {
  const lines = ['# Reason codes (28): definitions only', '',
    'Source: Steve\'s workbook, tab "Codes de motif" (unsealed from reference-c). No count, no example.', ''];
  for (const c of codes) lines.push(`- \`${c.code}\` (${verdictOfCode(c.code)}): ${sanitizeDefinition(c.meaning)}`);
  return `${lines.join('\n')}\n`;
}
