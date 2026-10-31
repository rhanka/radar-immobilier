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
  const rows = [];
  for (const [r, cells] of [...triage.rows.entries()].sort((a, b) => a[0] - b[0])) {
    if (r <= HEADER_ROW || !cells.get('Q')) continue;
    const lineNo = Number(String(cells.get('A') ?? '').replace(/[^\d]/g, ''));
    const allText = [...cells.values()].join('\n');
    const citySlug = slugify(cells.get('C'));
    // Column L may abbreviate the city part of an id with "…" (oracle-c 01-extract-triage.mjs).
    const abbreviated = (String(cells.get('L') ?? '').match(/(?:signal|event)-[A-Za-z0-9….-]+/g) ?? [])
      .filter((s) => s.includes('…'))
      .map((s) => s.replace(/[.…-]+$/, '').replace('…', citySlug));
    rows.push({
      excelRow: r,
      lineNo,
      pass: cells.get('B') ?? null,
      city: cells.get('C') ?? '',
      citySlug,
      bylaws: bylawsIn(cells.get('H')),
      nodeIds: [...new Set([...nodeIdsIn(allText), ...abbreviated])],
      docShas: shasIn(allText),
      verdict: cells.get('Q'),
      code: cells.get('R') ?? null,
    });
  }
  const codes = [];
  for (const [r, cells] of codesSheet.rows) {
    if (r <= 4) continue;
    const code = cells.get('B');
    if (code && /^(P|S|N|V2)-/.test(code)) codes.push({ verdict: cells.get('A') ?? null, code, meaning: cells.get('C') ?? '' });
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
  return { rows, codes, workbookNodeIds: [...workbookNodeIds], workbookShas: [...workbookShas] };
}

/** Splits rows into retained and evaluation partitions and checks the documented counts. */
export function partition(rows, { strict = true } = {}) {
  const byLine = new Map(rows.map((r) => [r.lineNo, r]));
  const problems = [];
  if (rows.length !== EXPECTED.triage) problems.push(`Triage rows ${rows.length} != ${EXPECTED.triage}`);
  if (byLine.size !== rows.length) problems.push('duplicate line numbers in column A');
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
