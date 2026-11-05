// Annotation circuit through Engram (plan §B-L1 "Annotation with current Engram"):
//  prompt = Engram profile prompt (skill-runtime profile-prompt) + classification instruction
//  (pack: Steve's criteria, 28 definitions, guide Gk) + items; the seat returns compact JSON that
//  this module turns into an Engram Extraction (Annotation / Evidence / anchor / registry nodes and
//  targets / justified_by / has_verdict / cites edges), validated by `engram profile
//  validate-extraction`. Invalid output = execution failure.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseJsonObject } from '../run-seat.mjs';
import { sha256 } from '../lib/render.mjs';

export const CAUSES = ['missing-information', 'conflicting-information', 'scope-unclear', 'other'];

// Provenances D1 (owner decision 04/11, review §A-4): label_provenance is one of these four.
// golden_precedent and external_evidence are EVIDENCE fields (cited rows, complement used),
// never provenance values; `unresolved` is a STATUS of the reference row, never a provenance.
export const PROVENANCES = ['human_single', 'human_adjudicated', 'model_consensus', 'mixed'];

// Residual cause classes of the ambiguity map (plan v3 A3, review §A-1c).
export const RESIDUAL_CAUSES = ['code-pair-confusion', 'definition-gap', 'missing-information', 'data-outside-immo', 'golden-set-conflict'];

export function loadPack(packDir, guide) {
  const read = (f) => readFileSync(path.join(packDir, f), 'utf8');
  const pack = { criteria: read('criteria.md'), definitions: read('codes-definitions.md'), guide: read(`guide-${guide}.md`), guideVersion: guide };
  pack.sha256 = sha256(`${pack.criteria}\n${pack.definitions}\n${pack.guide}`);
  return pack;
}

export const OUTPUT_SCHEMA = `{"annotations":[{"item_id":"<item id>","code":"<one reason code>","ambiguous":true|false,
 "ambiguity_cause":null|"missing-information"|"conflicting-information"|"scope-unclear"|"other",
 "quote":"<verbatim excerpt of the item text supporting the code, at most 300 characters>","reason":"<at most 40 words>"}]}`;

export const CROSSREVIEW_SCHEMA = `{"annotations":[{"item_id":"<item id>","code":"<one reason code>","ambiguous":true|false,
 "ambiguity_cause":null|"missing-information"|"conflicting-information"|"scope-unclear"|"other",
 "quote":"<verbatim excerpt of the item text supporting the code, at most 300 characters>","reason":"<at most 40 words>",
 "changed":true|false,
 "golden_precedent":[<golden pack row numbers cited as precedent, may be empty>],
 "label_provenance":"model_consensus"|"mixed"}]}`;

function itemsBlock(items, extra = () => '') {
  return items.map((it) => `### item_id: ${it.itemId}\n\n${it.input}\n${extra(it)}`).join('\n\n---\n\n');
}

export function buildPrompt({ profilePrompt, pack, items, mode = 'independent', context = new Map(), goldenPack = null }) {
  const head = `${profilePrompt.trim()}

# Classification task — Steve's residential densification radar (guide ${pack.guideVersion})

You are one of three independent annotators. For EACH item below, choose exactly ONE reason code of the
registry \`reason_codes\`; the main category (verdict) is the registry partition of that code and is never
chosen separately. Judge from the item text only${mode === 'reconcile' ? ', the anonymised votes and the traced complements shown with the item' : ''}${mode === 'crossreview' ? ', your previous vote, the two other anonymised votes, the traced complements and the golden pack precedent shown with the item. Precedence: item text > code definitions > guide > golden analogy. The precedent supports, never replaces, your judgment' : ''}.
Flag \`ambiguous\` when the text does not let you decide between codes of different verdicts, and give the
cause. Quote the item text verbatim. The harness converts each entry into the Engram extraction described
above: Annotation —targets→ the item anchor, —justified_by→ ReasonCode (registry_record_id = code),
—has_verdict→ Verdict (registry partition), —cites→ Evidence (quote, source_file = corpus/<item_id>.md, page).

## Steve's criteria

${pack.criteria.trim()}

## Reason code definitions

${pack.definitions.trim()}

## Annotation guide ${pack.guideVersion}

${pack.guide.trim()}
`;
  const task = mode === 'reconcile'
    ? `\n## Reconciliation\n\nEach item below did not reach agreement. You see your previous annotation, the two other annotations (anonymised) with their evidence, and any traced external complement. Keep or change your annotation; the \`reason\` must cite the evidence that decides. Add "changed": true|false to each entry.\n`
    : mode === 'crossreview'
      ? `\n## Cross-review\n\nEach item below did not reach agreement, or was flagged ambiguous. You see your previous annotation, the two other annotations (anonymised) with their evidence, any traced external complement, and the golden pack (Steve's 2026-09-21 triage rows: verdict, reason code, frozen input as served). Keep or change your annotation; the \`reason\` must cite the item evidence that decides (verbatim localized quote + fact from the item), never the precedent alone. When a golden row guided you, cite its number in \`golden_precedent\` with the resemblance AND the difference; when none did, leave it empty. Set \`label_provenance\` to "mixed" when you cite a precedent, "model_consensus" otherwise. NEVER copy a golden excerpt into \`quote\` or \`reason\`: \`quote\` is verbatim from the item text only.\n`
      : '';
  const extra = (it) => context.get(it.itemId) ?? '';
  const packSection = mode === 'crossreview' && goldenPack ? `\n## Golden pack (precedent only, Steve's triage 2026-09-21)\n\n${goldenPack.trim()}\n` : '';
  return `${head}${task}${packSection}
## Output

Return ONLY one JSON object, no prose, exactly one entry per item, same item_id:
${mode === 'crossreview' ? CROSSREVIEW_SCHEMA : OUTPUT_SCHEMA}

## Items

${itemsBlock(items, extra)}
`;
}

const norm = (s) => String(s ?? '').normalize('NFC').replace(/[’‘`]/g, "'").replace(/[«»“”]/g, '"').replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * Locates the quote in the item text: { found, page } (page = 1 + form feeds before it).
 * Fail closed: only a verbatim occurrence counts. A present prefix completed by an
 * invented passage must never match, so there is no prefix fallback.
 */
export function locateQuote(input, quote) {
  const q = norm(quote).replace(/^"|"$/g, '');
  if (q.length < 8) return { found: false, page: 1 };
  const pages = String(input).split('\f');
  for (let i = 0; i < pages.length; i++) if (norm(pages[i]).includes(q)) return { found: true, page: i + 1 };
  return { found: false, page: 1 };
}

export function parseAnswers(text, items) {
  const j = parseJsonObject(text);
  const list = Array.isArray(j?.annotations) ? j.annotations : Array.isArray(j) ? j : null;
  const byId = new Map();
  for (const a of list ?? []) if (a && typeof a.item_id === 'string') byId.set(a.item_id, a);
  return items.map((it) => ({ item: it, answer: byId.get(it.itemId) ?? null }));
}

const anchorType = (it) => it.anchor?.type ?? (it.kind === 'pv' ? 'Source' : 'Signal');

/** Engram Extraction for one call (all its items). `codes` maps code → verdict (registry). */
export function toExtraction({ annotator, pass, guideVersion, pairs, codes, goldenRows = null }) {
  const nodes = new Map();
  const edges = [];
  const evidence = [];
  const add = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, n); };
  for (const { item, answer } of pairs) {
    if (!answer) continue;
    const file = `corpus/${item.itemId}.md`;
    const loc = locateQuote(item.input, answer.quote);
    const anchorId = item.anchor.id;
    add({ id: anchorId, label: anchorId, file_type: 'document', source_file: file, node_type: anchorType(item), status: 'candidate', citations: [{ source_file: file, page: 1 }] });
    const code = String(answer.code ?? '');
    add({ id: `code:${code}`, label: code, file_type: 'concept', source_file: 'registries/reason_codes.csv', node_type: 'ReasonCode', registry_id: 'reason_codes', registry_record_id: code });
    const verdict = codes.get(code) ?? null;
    if (verdict) add({ id: `verdict:${verdict}`, label: verdict, file_type: 'concept', source_file: 'registries/verdicts.csv', node_type: 'Verdict', registry_id: 'verdicts', registry_record_id: verdict });
    const annId = `annotation:${annotator}:p${pass}:${item.itemId}`;
    const evId = `evidence:${annotator}:p${pass}:${item.itemId}`;
    const cit = { source_file: file, page: loc.page, quote: String(answer.quote ?? '').slice(0, 400) };
    const golden = Array.isArray(answer.golden_precedent) ? answer.golden_precedent.filter((x) => Number.isInteger(x)) : [];
    add({ id: annId, label: `${code} (${annotator}, pass ${pass})`, file_type: 'rationale', source_file: file, node_type: 'Annotation', status: 'candidate',
      citations: [cit], evidence_refs: [evId], annotator, pass, guide_version: guideVersion, ambiguous: answer.ambiguous === true,
      ambiguity_cause: CAUSES.includes(answer.ambiguity_cause) ? answer.ambiguity_cause : null, quote_found: loc.found, reason: String(answer.reason ?? '').slice(0, 400),
      changed: answer.changed ?? null, golden_precedent: golden, label_provenance: typeof answer.label_provenance === 'string' ? answer.label_provenance : null });
    add({ id: evId, label: `evidence ${item.itemId}`, file_type: 'document', source_file: file, node_type: 'Evidence', status: 'candidate', citations: [cit] });
    evidence.push({ id: evId, source_file: file, page: loc.page, quote: cit.quote });
    const e = (target, relation, extra = {}) => edges.push({ source: annId, target, relation, confidence: 'EXTRACTED', source_file: file, status: 'candidate', citations: [cit], ...extra });
    e(anchorId, 'targets');
    e(`code:${code}`, 'justified_by');
    if (verdict) e(`verdict:${verdict}`, 'has_verdict', { derivation_method: 'registry_partition' });
    e(evId, 'cites', { evidence_refs: [evId] });
  }
  return { nodes: [...nodes.values()], edges, hyperedges: [], evidence, input_tokens: 0, output_tokens: 0 };
}

/**
 * Per-item validity from Engram's validation issues (errors attached to an item's nodes/edges), plus
 * a radar-side registry record check: `engram profile validate-extraction` 0.21.2 passes only the
 * profile (not registry-extraction.json) to validateProfileExtraction, so unknown registry records
 * are not detected by Engram itself; the same rule (unknown_registry_record_ref) is applied here.
 */
export function itemValidity(extraction, validation, pairs, codes, { goldenRows = null } = {}) {
  const bad = new Map();
  const nodeAt = (p) => { const m = /^nodes\[(\d+)\]/.exec(p ?? ''); return m ? extraction.nodes[Number(m[1])] : null; };
  const edgeAt = (i) => (i === undefined ? null : extraction.edges[i]);
  for (const issue of validation.issues ?? []) {
    if (issue.severity !== 'error') continue;
    const n = nodeAt(issue.path);
    const ed = edgeAt(issue.edgeIndex);
    const id = n?.id ?? ed?.source ?? issue.nodeId ?? '';
    for (const { item } of pairs) {
      if (id.endsWith(`:${item.itemId}`) || id === item.anchor.id || (n?.node_type === 'ReasonCode' && extraction.edges.some((x) => x.target === n.id && x.source.endsWith(`:${item.itemId}`)))) {
        bad.set(item.itemId, [...(bad.get(item.itemId) ?? []), issue.code]);
      }
    }
  }
  // Quote evidence of the extraction, per item: the Annotation node records whether its
  // quote was located verbatim in the item text (quote_found).
  const quoteFound = new Map();
  for (const n of extraction.nodes ?? []) {
    if (n?.node_type !== 'Annotation' || typeof n.id !== 'string') continue;
    for (const { item } of pairs) if (n.id.endsWith(`:${item.itemId}`)) quoteFound.set(item.itemId, n.quote_found === true);
  }
  for (const { item, answer } of pairs) {
    if (answer && codes && !codes.has(String(answer.code ?? ''))) bad.set(item.itemId, [...(bad.get(item.itemId) ?? []), 'unknown_registry_record_ref']);
    // Cross-review evidence fields: provenance must be a D1 value; cited golden rows must exist.
    if (answer && answer.label_provenance != null && !PROVENANCES.includes(answer.label_provenance)) bad.set(item.itemId, [...(bad.get(item.itemId) ?? []), 'unknown-provenance']);
    if (answer && goldenRows && Array.isArray(answer.golden_precedent) && answer.golden_precedent.some((x) => !goldenRows.has(x))) {
      bad.set(item.itemId, [...(bad.get(item.itemId) ?? []), 'unknown-golden-row']);
    }
    // Fail closed: a PV vote proves nothing when its quote cannot be found in the item text.
    // A missing citation never contributes to majorities or alphas.
    if (answer && item.kind === 'pv' && quoteFound.get(item.itemId) !== true) {
      bad.set(item.itemId, [...(bad.get(item.itemId) ?? []), 'quote-not-found']);
    }
  }
  return pairs.map(({ item, answer }) => ({ itemId: item.itemId, valid: Boolean(answer) && !bad.has(item.itemId), issues: answer ? bad.get(item.itemId) ?? [] : ['missing-answer'] }));
}
