// Oracle v3: the 100-document gold built by SEQUENTIAL multi-model consensus (owner decision
// relayed by i-cond, 2026-09-17): Astra xhigh x2, then Fable 5.1 xhigh x2 completing it, then
// Gemini high x2 completing it, then one convergence vote by the three models on every dispute.
// Pure functions only (no network, no file writes) so every rule below is unit-tested in
// oracle-v3-lib.test.mjs. Runners, builders and the scorer import from here.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

export const ORACLE_V3_DIR = "docs/reviews/refresh-benchmark/v101b/oracle-v3";
export const STAGES = Object.freeze(["adoption", "piia", "derogation_mineure", "avis_motion",
  "projet_reglement", "second_projet", "inconnu"]);
export const PROCEDURES = Object.freeze(["ppcmoi", "usage_conditionnel", "consultation_publique"]);
export const FAMILIES = Object.freeze({
  astra: { model: "gpt-6-astra", effort: "xhigh", transport: "codex" },
  fable: { model: "claude-fable-5-1", effort: "xhigh", transport: "claude-cli" },
  gemini: { model: "gemini-3.8-flash", effort: "high", transport: "cloud-code" },
});
export const PASS_STEPS = Object.freeze(["astra", "fable", "gemini"].flatMap((family) =>
  [1, 2].map((pass) => Object.freeze({ id: `${family}-pass${pass}`, kind: "pass", family, pass,
    ...FAMILIES[family] }))));
export const CONVERGE_STEPS = Object.freeze(["astra", "fable", "gemini"].map((family) =>
  Object.freeze({ id: `converge-${family}`, kind: "converge", family, ...FAMILIES[family] })));
export const STEPS = Object.freeze([...PASS_STEPS, ...CONVERGE_STEPS]);
export const stepById = (id) => STEPS.find((step) => step.id === id)
  ?? (() => { throw new Error(`unknown oracle-v3 step ${id}`); })();

export const sha256 = (value) => createHash("sha256").update(value).digest("hex");

// Same normalisation as provenanceViolations in v101-score-lib.mjs (contract v9).
export const normalizeV9 = (value) => String(value).normalize("NFKC").normalize("NFD")
  .replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

export async function loadPrompts(repositoryRoot) {
  const markdown = await readFile(resolve(repositoryRoot, ORACLE_V3_DIR, "prompt-annotation.md"), "utf8");
  const block = (name) => {
    const match = markdown.match(new RegExp(`<!-- PROMPT-${name}-BEGIN -->\\n([\\s\\S]*?)\\n<!-- PROMPT-${name}-END -->`, "u"));
    if (!match) throw new Error(`prompt-annotation.md has no PROMPT-${name} block`);
    return { text: match[1], sha256: sha256(match[1]) };
  };
  return { pass: block("PASS"), converge: block("CONVERGE") };
}

export function documentPages(text) {
  const pages = text.split("\f");
  if (pages.at(-1) === "") pages.pop();
  return pages;
}

const pagesBlock = (pages) => pages.map((page, index) => `=== PAGE ${index + 1} ===\n${page}`).join("\n");
const identity = (document, pages) =>
  `Document : ${document.id} (ville ${document.city}, date ${document.date}, ${pages.length} pages)`;
// The current gold is shown without history or authorship: a pass judges units, not annotators.
export const publicUnit = ({ id, label, stage, procedure, objet, page, citation, anchor }) =>
  ({ id, label, stage, procedure: procedure ?? null, objet, page, citation, anchor });

export function passUserMessage(document, pages, currentUnits) {
  return `${identity(document, pages)}\n\nCORRIGÉ COURANT (${currentUnits.length} unités) :\n`
    + `${JSON.stringify({ units: currentUnits.map(publicUnit) }, null, 1)}\n\nTEXTE DU DOCUMENT :\n${pagesBlock(pages)}`;
}

export function convergeUserMessage(document, pages, disputes) {
  return `${identity(document, pages)}\n\nDÉSACCORDS (${disputes.length}) :\n`
    + `${JSON.stringify({ disputes: disputes.map(({ dispute, options }) => ({ dispute,
      options: Object.fromEntries(options.map(({ option, unit }) =>
        [option, unit ? publicUnit({ ...unit, id: undefined }) : "absent"])) })) }, null, 1)}`
    + `\n\nTEXTE DU DOCUMENT :\n${pagesBlock(pages)}`;
}

export function parseJsonObject(text) {
  const trimmed = String(text ?? "").trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/iu);
  let body = fenced ? fenced[1] : trimmed;
  let parsed;
  try { parsed = JSON.parse(body); }
  catch {
    // Tolerate prose around a single JSON object; the raw text stays in the annotation file.
    const start = body.indexOf("{"); const end = body.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("no JSON object in annotator output");
    body = body.slice(start, end + 1); parsed = JSON.parse(body);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("annotator output is not a JSON object");
  return parsed;
}

// Normalised string plus, for each normalised character, the raw index it came from. Used to map a
// normalised match back to the verbatim raw span of the frozen page.
function indexedNormalization(raw) {
  let text = ""; const origin = [];
  for (let index = 0; index < raw.length;) {
    const codePoint = raw.codePointAt(index); const char = String.fromCodePoint(codePoint);
    const normalized = normalizeV9(char);
    for (const piece of normalized) { text += piece; origin.push(index); }
    index += char.length;
  }
  return { text, origin };
}

const collapse = (value) => value.replace(/\s+/gu, " ").trim();

export function locate(pageText, excerpt) {
  const needle = normalizeV9(excerpt);
  if (!needle) return null;
  const { text, origin } = indexedNormalization(pageText);
  const start = text.indexOf(needle);
  if (start < 0) return null;
  const rawStart = origin[start]; const lastRaw = origin[start + needle.length - 1];
  const rawEnd = lastRaw + String.fromCodePoint(pageText.codePointAt(lastRaw)).length;
  return { start: rawStart, end: rawEnd, raw: collapse(pageText.slice(rawStart, rawEnd)) };
}

// Grounding (brief step 3): a citation must be found in the frozen text of the document, v9
// normalisation. The declared page is tried first; a citation found verbatim on another page of
// the same document is kept with its page corrected (and counted). Citations below the contract
// floor (20 code points, 12 normalised) are rejected; above 200 code points they are clipped to the
// first 200, which stays grounded because a prefix of a normalised match is still a match.
export function groundUnit(unit, pages) {
  const reject = (code) => ({ ok: false, code });
  if (!unit || typeof unit !== "object") return reject("not_an_object");
  if (!STAGES.includes(unit.stage)) return reject("stage_out_of_vocabulary");
  if (typeof unit.citation !== "string") return reject("citation_missing");
  let citation = unit.citation; let clipped = false;
  if ([...citation].length > 200) { citation = [...citation].slice(0, 200).join(""); clipped = true; }
  if ([...citation].length < 20 || [...normalizeV9(citation)].length < 12) return reject("citation_too_short");
  const declared = Number.isInteger(unit.page) ? unit.page : Number.parseInt(unit.page, 10);
  const order = [declared - 1, ...pages.keys()].filter((index, position, all) =>
    index >= 0 && index < pages.length && all.indexOf(index) === position);
  for (const pageIndex of order) {
    const span = locate(pages[pageIndex], citation);
    if (!span) continue;
    const anchorInCitation = typeof unit.anchor === "string" && normalizeV9(unit.anchor).length >= 6
      && normalizeV9(span.raw).includes(normalizeV9(unit.anchor))
      ? locate(pages[pageIndex].slice(span.start, span.end), unit.anchor) : null;
    const anchor = anchorInCitation?.raw ?? [...span.raw].slice(0, 60).join("");
    return { ok: true, unit: { label: String(unit.label ?? ""), stage: unit.stage,
      procedure: PROCEDURES.includes(unit.procedure) ? unit.procedure : null,
      objet: typeof unit.objet === "string" ? unit.objet : "",
      page: pageIndex + 1, citation: span.raw, anchor, spanStart: span.start, spanEnd: span.end },
    pageCorrected: pageIndex + 1 !== declared, clipped, anchorReplaced: !anchorInCitation };
  }
  return reject("citation_not_found_in_document");
}


// Object key: the identifier of the regulatory/land object, reduced so that "Règlement no 2026-05",
// "règlement 2026-05" and "2026-05" agree, and "lot 5 191 695" equals "5191695".
const OBJECT_STOPWORDS = /\b(?:reglements?|projets?|premier|second|resolutions?|numeros?|no|n|nos|lots?|matricules?|dossiers?|demandes?|de|du|des|la|le|les|d|l|au|aux|sur|et|a)\b/gu;
export function objectKey(objet) {
  if (typeof objet !== "string") return "";
  return objet.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[°º]/gu, " ").replace(/(\d)[\s  .]+(?=\d{3}\b)/gu, "$1")
    .replace(/[^\p{L}\p{N}]+/gu, " ").replace(OBJECT_STOPWORDS, " ")
    .replace(/\s+/gu, "");
}

export function keysCompatible(left, right) {
  if (!left || !right) return null;
  if (left === right) return "equal";
  const [short, long] = left.length <= right.length ? [left, right] : [right, left];
  return short.length >= 4 && /\d/u.test(short) && long.includes(short) ? "contained" : "conflict";
}

// Same-object test between two grounded units of one document: same stage, object keys that do
// not conflict. Used for the duplicate-add guard and for the calibration against the human gold.
export function sameObject(left, right) {
  return left.stage === right.stage
    && keysCompatible(objectKey(left.objet), objectKey(right.objet)) !== "conflict";
}

// An add duplicates an active unit when it is the same object at the same stage AND its verbatim
// span overlaps the existing one on the same page. Two agenda items on the same address (distinct
// lines, e.g. Valcourt 7.1 and 7.2) are therefore not duplicates; the seven by-laws of one
// resolution are not either, their object keys conflict.
export function isDuplicate(candidate, existing) {
  return sameObject(candidate, existing) && candidate.page === existing.page
    && candidate.spanStart < existing.spanEnd && existing.spanStart < candidate.spanEnd;
}

const CONTENT_FIELDS = ["label", "stage", "procedure", "objet", "page", "citation", "anchor"];
export const contentKey = (unit) => JSON.stringify(CONTENT_FIELDS.map((field) => unit[field] ?? null));

export const emptyState = (documentId) => ({ documentId, nextId: 1, units: [] });
const cloneState = (state) => JSON.parse(JSON.stringify(state));
export const activeUnits = (state) => state.units.filter(({ status }) => status === "active")
  .map(({ id, current }) => ({ id, ...current }));

// Applies one pass's operations to the current gold. Returns the new state (the input is not
// mutated), the operations applied and every rejected operation with its code. Rejection codes:
// not_an_object, op_unknown, reason_missing, unknown_id, conflicting_ops_same_id, duplicate_add,
// no_change, and every groundUnit code (stage_out_of_vocabulary, citation_missing,
// citation_too_short, citation_not_found_in_document).
export function applyOperations(state, operations, pages, stepId) {
  const next = cloneState(state);
  const applied = []; const rejects = []; const touched = new Set();
  const counters = { pageCorrected: 0, clipped: 0, anchorReplaced: 0 };
  const reject = (index, code, operation) => rejects.push({ step: stepId, index, code,
    op: operation?.op ?? null, id: operation?.id ?? null,
    stage: operation?.unit?.stage ?? null, page: operation?.unit?.page ?? null,
    citation: typeof operation?.unit?.citation === "string" ? operation.unit.citation.slice(0, 200) : null });
  const byId = new Map(next.units.map((unit) => [unit.id, unit]));
  const ground = (index, operation) => {
    const grounded = groundUnit(operation.unit, pages);
    if (!grounded.ok) { reject(index, grounded.code, operation); return null; }
    for (const flag of Object.keys(counters)) if (grounded[flag]) counters[flag] += 1;
    return grounded.unit;
  };
  (Array.isArray(operations) ? operations : []).forEach((operation, index) => {
    if (!operation || typeof operation !== "object") return reject(index, "not_an_object", null);
    if (!["add", "remove", "correct"].includes(operation.op)) return reject(index, "op_unknown", operation);
    const reason = typeof operation.reason === "string" ? operation.reason.trim() : "";
    if (!reason) return reject(index, "reason_missing", operation);
    if (operation.op === "add") {
      const unit = ground(index, operation);
      if (!unit) return undefined;
      const active = next.units.filter(({ status }) => status === "active");
      if (active.some(({ current }) => isDuplicate(unit, current))) return reject(index, "duplicate_add", operation);
      const id = `u${String(next.nextId).padStart(2, "0")}`; next.nextId += 1;
      next.units.push({ id, status: "active", current: unit, versions: [{ step: stepId, unit }],
        events: [{ step: stepId, op: "add", reason }] });
      touched.add(id); applied.push({ op: "add", id });
      return undefined;
    }
    const target = byId.get(operation.id);
    if (!target || target.status !== "active") return reject(index, "unknown_id", operation);
    if (touched.has(target.id)) return reject(index, "conflicting_ops_same_id", operation);
    if (operation.op === "remove") {
      target.status = "removed"; target.events.push({ step: stepId, op: "remove", reason });
      touched.add(target.id); applied.push({ op: "remove", id: target.id });
      return undefined;
    }
    const unit = ground(index, operation);
    if (!unit) return undefined;
    if (contentKey(unit) === contentKey(target.current)) return reject(index, "no_change", operation);
    target.current = unit; target.versions.push({ step: stepId, unit });
    target.events.push({ step: stepId, op: "correct", reason });
    touched.add(target.id); applied.push({ op: "correct", id: target.id });
    return undefined;
  });
  return { state: next, applied, rejects, counters };
}

// A unit is disputed when a pass removed or corrected it after another pass had set it. Options are
// its distinct versions (v1 = first) plus "absent"; the option matching the state after the last
// pass is flagged `current`.
export function disputesOf(state) {
  const disputes = [];
  for (const unit of state.units) {
    if (!unit.events.some(({ op }) => op === "remove" || op === "correct")) continue;
    const options = []; const seen = new Set();
    for (const { unit: version } of unit.versions) {
      const key = contentKey(version);
      if (seen.has(key)) continue;
      seen.add(key); options.push({ option: `v${options.length + 1}`, unit: version });
    }
    options.push({ option: "absent", unit: null });
    const current = unit.status === "active"
      ? options.find(({ unit: version }) => version && contentKey(version) === contentKey(unit.current)).option
      : "absent";
    disputes.push({ dispute: `d${String(disputes.length + 1).padStart(2, "0")}`, unitId: unit.id,
      options, current, events: unit.events });
  }
  return disputes;
}

// Majority of the three convergence votes. Invalid or missing votes count for nothing; without a
// 2-of-3 majority the state after the last pass stays and the dispute is `unresolved`.
export function resolveVotes(dispute, votesByFamily) {
  const valid = new Set(dispute.options.map(({ option }) => option));
  const tally = new Map();
  for (const vote of Object.values(votesByFamily)) {
    if (vote && valid.has(vote.choice)) tally.set(vote.choice, (tally.get(vote.choice) ?? 0) + 1);
  }
  const [winner] = [...tally.entries()].filter(([, count]) => count >= 2).map(([option]) => option);
  return winner ? { outcome: "resolved", choice: winner, changed: winner !== dispute.current, tally: Object.fromEntries(tally) }
    : { outcome: "unresolved", choice: dispute.current, changed: false, tally: Object.fromEntries(tally) };
}

export function applyResolutions(state, disputes, resolutions) {
  const next = cloneState(state);
  for (const dispute of disputes) {
    const resolution = resolutions[dispute.dispute];
    if (!resolution) continue;
    const unit = next.units.find(({ id }) => id === dispute.unitId);
    const option = dispute.options.find(({ option: name }) => name === resolution.choice);
    if (!option?.unit) { unit.status = "removed"; continue; }
    unit.status = "active"; unit.current = option.unit;
  }
  return next;
}

// Scorer-compatible unit (same shape as manual-oracle-v2 units, plus provenance).
export function goldUnit(unit, document, provenance) {
  return { city: document.city, documentId: document.id, id: `${document.id}#${unit.id}`,
    label: unit.label, stage: unit.stage, ...(unit.procedure ? { stage_aliases: [unit.procedure] } : {}),
    objet: unit.objet, citation: unit.citation, anchor: unit.anchor, page: unit.page,
    doc_sha: document.sha256, sourceUrl: document.sourceUrl, provenance };
}

// Calibration pairing between a human v2 unit and an oracle-v3 unit of the same document: same
// stage and a shared verbatim site - the human anchor (frozen or alternate site) inside the v3
// citation on the same page, or the v3 anchor inside the human citation / site text on that page.
export function calibrationMatch(human, candidate) {
  if (human.stage !== candidate.stage) return false;
  const sites = [{ page: human.page, anchor: human.anchor, text: human.citation },
    ...(human.alternate_sites ?? []).map((site) => ({ page: site.page, anchor: site.anchor,
      text: site.provenance?.text ?? site.anchor }))];
  const citation = normalizeV9(candidate.citation); const anchor = normalizeV9(candidate.anchor);
  return sites.some((site) => site.page === candidate.page
    && ((normalizeV9(site.anchor).length >= 6 && citation.includes(normalizeV9(site.anchor)))
      || (anchor.length >= 6 && normalizeV9(site.text).includes(anchor))));
}

export function pairOneToOne(humans, candidates, match = calibrationMatch) {
  const pairs = []; const usedCandidates = new Set();
  humans.forEach((human) => {
    const index = candidates.findIndex((candidate, position) => !usedCandidates.has(position)
      && match(human, candidate));
    if (index >= 0) { usedCandidates.add(index); pairs.push([human, candidates[index]]); }
  });
  return { pairs, missed: humans.filter((human) => !pairs.some(([paired]) => paired === human)),
    added: candidates.filter((_, position) => !usedCandidates.has(position)) };
}
