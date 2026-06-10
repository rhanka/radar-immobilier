import { z } from "zod";

/**
 * Pure parser + zonage-change detector for municipal procès-verbaux (PV) text.
 *
 * A PV is the verbatim transcript of a municipal council session. This module
 * implements WP A.2.2: given the plain text of a PV (HTML or pdftotext output),
 * detect the "avis de motion → n° règlement → changement de zonage" chain that
 * signals a residential densification opportunity.
 *
 * ANTI-INVENTION (rules/MASTER.md §Scraping Policy + Fair Benchmarking §ABSOLUTE):
 * - Nothing is fabricated. A field is only populated when the pattern matches
 *   verbatim bytes from the real document.
 * - High-precision rules first: `avis de motion` + `règlement de zonage` wording
 *   is required to fire the `changementZonage: true` flag.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Item schema
// ─────────────────────────────────────────────────────────────────────────────

/** One PV item enumerated by the index page (before fetching the full text). */
export const PvIndexItem = z.object({
  /** Title / file name of the PV as displayed in the index. */
  title: z.string().min(1),
  /** Absolute URL of the PV document (HTML or PDF). */
  url: z.string().url(),
  /** ISO date (YYYY-MM-DD) when parseable from the title/context, else NON_DISPONIBLE. */
  dateIso: z.string().min(1),
  /** Human-readable date label from the index, verbatim. */
  dateLabel: z.string().min(1),
});
export type PvIndexItemT = z.infer<typeof PvIndexItem>;

// ─────────────────────────────────────────────────────────────────────────────
// Detection result
// ─────────────────────────────────────────────────────────────────────────────

/** Result of `detectZonageChange` applied to the plain text of one PV. */
export const ZonageChangeDetection = z.object({
  /**
   * True when the text contains an "avis de motion" (or closely related wording
   * such as "avis de motion a été donné", "il donne avis de motion") in the
   * context of a règlement.
   */
  avisDeMotion: z.boolean(),
  /**
   * Règlement numbers that are themselves the OBJECT of an avis de motion for a
   * zonage change (new/proposed règlement numbers).  Only populated when the
   * immediate item context contains "zonage" / "règlement de zonage" /
   * "règlement d'urbanisme".  Empty when no zonage motion is detected.
   *
   * Anti-over-aggregation rule: each context is bounded by the enclosing
   * paragraph (previous and next \n\n), preventing cross-item contamination.
   * The règlement being MODIFIED ("modifiant le règlement de zonage numéro Y")
   * is excluded when a distinct NEW number exists in the same context; when
   * the modified number is the only one present (e.g. Châteauguay Z-3001),
   * it is retained.
   *
   * Verbatim, no fabrication.
   */
  reglementNumbers: z.array(z.string()),
  /**
   * True only when ALL THREE conditions hold (high-precision rule):
   *   1. `avisDeMotion` is true.
   *   2. At least one règlement number is present.
   *   3. The matching context explicitly names a change to the zonage / zoning.
   */
  changementZonage: z.boolean(),
  /**
   * Excerpt(s) of the verbatim PV text that triggered each positive detection,
   * limited to ~200 chars around the match for traceability.  Empty when
   * nothing fired.
   */
  excerpts: z.array(z.string()),
  /**
   * Zone codes mentioned in the same paragraph as the detected motion
   * (e.g. "H-521", "H-609").  Best-effort, may be empty.
   */
  zoneRefs: z.array(z.string()),
  /**
   * Free-text hint about the density type authorised, extracted verbatim when
   * the text mentions multi-family or densification keywords in the context of
   * the motion.  Null when absent (anti-invention).
   */
  densiteAutorisee: z.string().nullable(),
});
export type ZonageChangeDetectionT = z.infer<typeof ZonageChangeDetection>;

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

export const PV_NON_DISPONIBLE = "non-disponible";

/** Trim an excerpt to ~200 characters, centred on the match position. */
function trimExcerpt(text: string, matchIndex: number, window = 200): string {
  const half = Math.floor(window / 2);
  const start = Math.max(0, matchIndex - half);
  const end = Math.min(text.length, matchIndex + half);
  const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
  return (start > 0 ? "…" : "") + raw + (end < text.length ? "…" : "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Index-page parsers
// ─────────────────────────────────────────────────────────────────────────────

const FRENCH_MONTHS_PV: Record<string, string> = {
  janvier: "01", février: "02", fevrier: "02", mars: "03", avril: "04",
  mai: "05", juin: "06", juillet: "07", août: "08", aout: "08",
  septembre: "09", octobre: "10", novembre: "11",
  décembre: "12", decembre: "12",
};

/** "séance du 10 mars 2025" or "10 mars 2025" → "2025-03-10", else NON_DISPONIBLE. */
function extractIsoFromLabel(label: string): string {
  const m = label
    .toLowerCase()
    .match(/(\d{1,2})\s+([a-zàâçéèêëîïôûù]+)\s+(\d{4})/i);
  if (!m || !m[1] || !m[2] || !m[3]) return PV_NON_DISPONIBLE;
  const month = FRENCH_MONTHS_PV[m[2]];
  if (!month) return PV_NON_DISPONIBLE;
  return `${m[3]}-${month}-${m[1].padStart(2, "0")}`;
}

/** Decode minimal HTML entities in a fragment. */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&ecirc;/g, "ê")
    .replace(/&agrave;/g, "à")
    .replace(/&laquo;/g, "«")
    .replace(/&raquo;/g, "»")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip all HTML tags from a fragment. */
function stripTags(s: string): string {
  return decodeHtmlEntities(s.replace(/<[^>]+>/g, " "));
}

/**
 * Parse a WordPress-style or plain HTML PV index page.
 *
 * Strategy: look for `<a>` elements whose href ends in `.pdf` or whose text
 * contains "procès-verbal" / "séance" / "PV".  Tolerates a wide range of CMS
 * markups (WordPress, Craft, static HTML) because every Québec municipality
 * page is different.
 *
 * Pagination / JS-rendered pages are NOT handled here (Obscura fallback noted
 * but not required at test time — download direct + fixture).
 */
export function parsePvIndex(html: string, baseUrl: string): PvIndexItemT[] {
  const items: PvIndexItemT[] = [];
  const seen = new Set<string>();

  // Match every <a href="...">...</a> in the page.
  const anchorRe = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const attrs = m[1] ?? "";
    const inner = stripTags(m[2] ?? "");

    const hrefMatch = attrs.match(/href="([^"]+)"/i) ?? attrs.match(/href='([^']+)'/i);
    let url = hrefMatch?.[1]?.trim() ?? "";
    if (!url) continue;

    // Resolve relative URLs against baseUrl.
    if (/^\//.test(url)) {
      try {
        const base = new URL(baseUrl);
        url = `${base.protocol}//${base.host}${url}`;
      } catch {
        // Malformed baseUrl — skip.
        continue;
      }
    }
    if (!/^https?:\/\//i.test(url)) continue;

    // Accept links that are clearly PV documents.
    const isPdf = /\.pdf(\?[^"]*)?$/i.test(url);
    const labelLower = inner.toLowerCase();
    const isPv =
      labelLower.includes("procès-verbal") ||
      labelLower.includes("proces-verbal") ||
      labelLower.includes("procès verbal") ||
      labelLower.includes("séance") ||
      labelLower.includes("seance") ||
      /\bpv\b/.test(labelLower) ||
      /\bprocès\b/.test(labelLower);

    if (!isPdf && !isPv) continue;
    if (seen.has(url)) continue;
    seen.add(url);

    const title = inner || url.split("/").pop() || url;
    const dateIso = extractIsoFromLabel(title);
    const parsed = PvIndexItem.safeParse({
      title,
      url,
      dateIso,
      dateLabel: title,
    });
    if (parsed.success) items.push(parsed.data);
  }

  return items;
}

/**
 * Filter a list of PV index items to those whose date falls within [since, until].
 * Items whose date is NON_DISPONIBLE are always included (conservative).
 */
export function filterPvByWindow(
  items: PvIndexItemT[],
  since: string,
  until: string,
): PvIndexItemT[] {
  return items.filter((item) => {
    if (item.dateIso === PV_NON_DISPONIBLE) return true;
    return item.dateIso >= since && item.dateIso <= until;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Zonage-change detector
// ─────────────────────────────────────────────────────────────────────────────

/**
 * High-precision regex patterns for the "avis de motion → règlement de zonage"
 * chain in Québec municipal PV text.
 *
 * Rule: `avis de motion` fires only when:
 *   1. The phrase "avis de motion" (or "avis de motion a été donné", "donne avis
 *      de motion") appears.
 *   2. Within the same paragraph (~400 chars), a règlement number is cited AND
 *      the text references "zonage" (directly or via "règlement de zonage" /
 *      "règlement d'urbanisme" / "modifier le règlement").
 *
 * Multi-family / densification keywords (habitation multifamiliale, bifamiliale,
 * logements multiples, densification, maison de chambres, …) are used to populate
 * `densiteAutorisee` when present in the same context.
 *
 * Nothing is invented: the detector fires ONLY on verbatim bytes.
 */
const AVIS_MOTION_RE =
  /(?:avis\s+de\s+motion(?:\s+a\s+[eé]t[eé]\s+donn[eé])?|(?:donne|doit\s+donner|lui\s+donne)\s+avis\s+de\s+motion)/gi;

/**
 * Règlement-number pattern (Québec municipal numbering):
 *  - Sequential (Valleyfield style): 150-49, 209-47, 216-34, 701-102
 *    → 2–3 digits "-" 1–3 digits
 *  - Year-prefixed (Beauharnois / newer style): 2024-58, 2025-11
 *    → (19|20)YY "-" 1–3 digits
 * Both must be preceded by "règlement" to avoid false positives on lot ids.
 */
const REGLEMENT_NUMBER_RE =
  /r[eè]glement\s+(?:n(?:[o°]|um[eé]ro)?\s*\.?\s*)?(\d{2,4}-\d{1,4})\b/gi;

/**
 * Z-prefix règlement-number pattern for municipalities using letter-prefixed
 * numbering (e.g. Châteauguay: Z-3001, G-062-22).
 *
 * PRECISION GUARD: requires the full phrase "règlement de zonage" immediately
 * before the letter-prefix number. This prevents misidentifying zone codes
 * (e.g. "zone C-754") or non-zonage bylaws ("règlement de construction Z-3300")
 * as règlement numbers.  Group 1 captures the letter-prefixed number.
 */
const REGLEMENT_ZONAGE_LETTER_RE =
  /r[eè]glement\s+de\s+zonage\s+([A-Z]-\d{3,4})\b/gi;

/**
 * V-prefix règlement-number pattern for municipalities using compound-prefix
 * numbering (e.g. Saint-Rémi: V654-2026-33, V655-2026-03).
 *
 * Format: one uppercase letter + 2–4 digits + "-" + 4-digit year + "-" + 1–3 digits.
 *
 * PRECISION GUARD: only applied when the surrounding context window already
 * contains a "règlement de zonage" keyword (checked by the caller), preventing
 * false positives from other V-prefix bylaws such as tarification (V700-2026-09).
 * Group 1 captures the full V-prefix number.
 */
const REGLEMENT_VPREFIX_RE =
  /r[eè]glement\s+(?:n(?:[o°]|um[eé]ro)?\s*\.?\s*)?([A-Z]\d{2,4}-\d{4}-\d{1,3})\b/gi;

/** Zone code pattern (matches Valleyfield codes like H-521, C-627-3). All-uppercase. */
const ZONE_CODE_RE = /\b([A-Z]{1,4}-\d{2,4}(?:-\d{1,3})?)\b/g;

/**
 * Mixed-case zone code pattern for municipalities using non-standard casing
 * (e.g. Sainte-Martine: MxtV-2).
 *
 * PRECISION GUARD: requires the literal word "zone " immediately before the
 * code. This ensures only genuine zone designators are captured and prevents
 * ordinary words or règlement numbers from being mistaken for zone codes.
 * Allows 1–4 letters (mixed case) followed by "-" and 1–4 digits.
 * Group 1 captures the zone code (preserving verbatim casing).
 */
const ZONE_CODE_CONTEXT_RE = /\bzone\s+([A-Za-z]{1,4}-\d{1,4}(?:-\d{1,3})?)\b/gi;

/**
 * Keywords that indicate a change to the zoning bylaw (high-precision).
 *
 * Only ZONING-SPECIFIC terms qualify. Generic "modifier le règlement" /
 * "modification du règlement" were intentionally removed: they match any bylaw
 * amendment (e.g. a circulation or borrowing bylaw) and caused false positives
 * (e.g. Sainte-Catherine 2026-05, a circulation bylaw). Genuine zoning changes
 * always reference "zonage" or "règlement d'urbanisme" (verified across the
 * Saint-Damase, Saint-Constant and Valleyfield fixtures).
 */
const ZONAGE_KEYWORDS_RE =
  /\b(?:zonage|r[eè]glement\s+de\s+zonage|r[eè]glement\s+d[''']urbanisme)\b/i;

/** Multi-family / densification keywords (best-effort, only for densiteAutorisee). */
const DENSITE_RE =
  /(?:habitation\s+multifamiliale|bifamiliale|trifamiliale|maison\s+de\s+chambres|logements?\s+multiples?|logements?\s+locatifs?|densification|multi\s*[-–]\s*logements?|maison\s+de\s+rapport|plex\b|duplex\b|triplex\b|quadruplex\b|immeuble\s+(?:r[eé]sidentiel|locatif)|appartements?\s+(?:ou\s+)?logements?|r[eé]sidentiel\s+(?:multi|densif))/i;

/**
 * Extract all règlement numbers cited in a text window (case-insensitive,
 * deduped, verbatim).
 *
 * Handles three numbering styles:
 *   - Digit-only (e.g. 1926-26, 2024-58): via REGLEMENT_NUMBER_RE
 *   - Single-letter-prefix zonage bylaws (e.g. Z-3001): via REGLEMENT_ZONAGE_LETTER_RE
 *     (only matched when explicitly preceded by "règlement de zonage", to
 *     prevent confusing zone codes like C-754 with règlement identifiers)
 *   - Compound V-prefix zonage bylaws (e.g. V654-2026-33): via REGLEMENT_VPREFIX_RE
 *     (only applied when the context already contains a "règlement de zonage"
 *     keyword, preventing false positives from non-zonage V-prefix bylaws such as
 *     tarification — V700-2026-09)
 */
function extractReglementNumbers(window: string): string[] {
  const numbers: string[] = [];
  const re = new RegExp(REGLEMENT_NUMBER_RE.source, "gi");
  for (const m of window.matchAll(re)) {
    if (m[1]) numbers.push(m[1]);
  }
  const reZ = new RegExp(REGLEMENT_ZONAGE_LETTER_RE.source, "gi");
  for (const m of window.matchAll(reZ)) {
    if (m[1]) numbers.push(m[1]);
  }
  // V-prefix compound numbers (e.g. V654-2026-33): only apply when context
  // explicitly references "règlement de zonage" to avoid catching non-zonage
  // V-prefix bylaws (e.g. tarification V700-2026-09).
  if (ZONAGE_KEYWORDS_RE.test(window)) {
    const reV = new RegExp(REGLEMENT_VPREFIX_RE.source, "gi");
    for (const m of window.matchAll(reV)) {
      if (m[1]) numbers.push(m[1]);
    }
  }
  return Array.from(new Set(numbers));
}

/**
 * Extract zone codes from a text window (deduped), excluding codes that are
 * actually règlement numbers.
 *
 * Two passes:
 *   Pass A — standard all-uppercase codes (ZONE_CODE_RE): matches H-521, C-627-3.
 *   Pass B — mixed-case codes preceded by "zone " (ZONE_CODE_CONTEXT_RE): matches
 *     MxtV-2 and similar non-standard municipal zone designators that cannot be
 *     captured by the all-uppercase pattern.
 *
 * Two-pass exclusion (applied to both):
 *   1. Any code already captured by `reglementNumbers` (e.g. Z-3001 captured
 *      via REGLEMENT_ZONAGE_LETTER_RE) is excluded from zoneRefs.
 *   2. Any code immediately preceded (within 40 chars) by the word "règlement"
 *      (with or without context "de zonage", "de construction", etc.) is
 *      excluded — those are bylaw identifiers, not zone designators.
 *      Example: "règlement de construction Z-3300" → Z-3300 excluded.
 *
 * This prevents pollution of the form zoneRefs=[C-754,C-810,H-812,Z-3001,Z-3300]
 * and produces the expected zoneRefs=[C-754,C-810,H-812].
 * For Sainte-Martine, "zone MxtV-2" is captured by Pass B → zoneRefs=[MxtV-2].
 */
function extractZoneCodes(window: string, reglementNumbers: string[] = []): string[] {
  const reglementSet = new Set(reglementNumbers.map((r) => r.toUpperCase()));
  const codes: string[] = [];

  // Pass A: standard all-uppercase zone codes.
  const re = new RegExp(ZONE_CODE_RE.source, "g");
  for (const m of window.matchAll(re)) {
    const code = m[1];
    if (!code) continue;
    // Exclude codes already identified as règlement numbers.
    if (reglementSet.has(code.toUpperCase())) continue;
    // Exclude codes preceded by "règlement" within 40 chars (bylaw identifiers).
    const matchStart = m.index ?? 0;
    const lookback = window.slice(Math.max(0, matchStart - 40), matchStart);
    if (/r[eè]glement\b/i.test(lookback)) continue;
    codes.push(code);
  }

  // Pass B: mixed-case zone codes that require the "zone " context prefix.
  // Only captures codes NOT already found by Pass A (case-insensitive dedup).
  const existingUpper = new Set(codes.map((c) => c.toUpperCase()));
  const reCtx = new RegExp(ZONE_CODE_CONTEXT_RE.source, "gi");
  for (const m of window.matchAll(reCtx)) {
    const code = m[1];
    if (!code) continue;
    // Exclude if already in règlement numbers or already captured by Pass A.
    if (reglementSet.has(code.toUpperCase())) continue;
    if (existingUpper.has(code.toUpperCase())) continue;
    codes.push(code);
  }

  return Array.from(new Set(codes));
}

/**
 * Pattern that matches a règlement number appearing as the TARGET of a
 * "modifiant" / "amendant" clause, e.g.:
 *   "modifiant le règlement de zonage numéro 2019-342"
 *   "amendant le règlement de zonage numéro V654-2017-00"
 *   "modifiant le règlement d'urbanisme numéro 150-49"
 *
 * Group 1 captures the number of the EXISTING (modified) règlement — NOT the
 * new proposed règlement that is the actual object of the avis de motion.
 *
 * Two sub-patterns cover both numbering styles:
 *   - Digit-only modified numbers (e.g. 2019-342): MODIFIANT_REGLEMENT_RE
 *   - V-prefix modified numbers (e.g. V654-2017-00): MODIFIANT_REGLEMENT_VPREFIX_RE
 *
 * Used to distinguish new règlements (proposed) from referenced/modified ones
 * when both appear in the same context window.  If the context contains ONLY
 * modified règlement numbers (e.g. Châteauguay "modifiant le règlement de
 * zonage Z-3001" with no separate new number), the modified numbers are kept.
 */
const MODIFIANT_REGLEMENT_RE =
  /(?:modifiant|amendant)\s+le\s+r[eè]glement\s+(?:de\s+zonage|d[''']urbanisme)\s+(?:n(?:[o°]|um[eé]ro)?\s*\.?\s*)?(\d{2,4}-\d{1,4})\b/gi;

/** Same as MODIFIANT_REGLEMENT_RE but for V-prefix compound numbers (e.g. V654-2017-00). */
const MODIFIANT_REGLEMENT_VPREFIX_RE =
  /(?:modifiant|amendant)\s+le\s+r[eè]glement\s+(?:de\s+zonage|d[''']urbanisme)\s+(?:n(?:[o°]|um[eé]ro)?\s*\.?\s*)?([A-Z]\d{2,4}-\d{4}-\d{1,3})\b/gi;

/**
 * Extract règlement numbers that are the TARGET of a "modifiant" / "amendant"
 * clause within a context window (i.e. the OLD règlement being amended, not the
 * new proposed one).  Returns an empty set when none are found.
 *
 * Handles both digit-only (2019-342) and V-prefix (V654-2017-00) numbers.
 * These are EXCLUDED from `reglementNumbers` when distinct new règlement
 * numbers exist in the same context.
 */
function extractModifiedReglementNumbers(window: string): Set<string> {
  const modified = new Set<string>();
  const re = new RegExp(MODIFIANT_REGLEMENT_RE.source, "gi");
  for (const m of window.matchAll(re)) {
    if (m[1]) modified.add(m[1]);
  }
  const reV = new RegExp(MODIFIANT_REGLEMENT_VPREFIX_RE.source, "gi");
  for (const m of window.matchAll(reV)) {
    if (m[1]) modified.add(m[1]);
  }
  return modified;
}

/**
 * Given the full set of extracted règlement numbers and the set of "modified"
 * règlement numbers from "modifiant le règlement de zonage numéro Y" clauses,
 * return the subset that are genuinely NEW (the object of the avis de motion).
 *
 * Rule:
 *   - If there exist numbers NOT in the modified set → return only those.
 *   - If ALL extracted numbers are in the modified set (Châteauguay pattern:
 *     "modifiant le règlement de zonage Z-3001" with no distinct new number)
 *     → return all of them (the modified number is the best proxy for the
 *     règlement being changed).
 *
 * This preserves Châteauguay's Z-3001 and Saint-Constant's 1926-26 while
 * excluding 2019-342 (Sainte-Martine) and 1528-17 (Saint-Constant) from the
 * output when those modified-rule numbers appear alongside distinct new numbers.
 */
function filterNewReglements(
  allNumbers: string[],
  modifiedNumbers: Set<string>,
): string[] {
  const newNumbers = allNumbers.filter((n) => !modifiedNumbers.has(n));
  return newNumbers.length > 0 ? newNumbers : allNumbers;
}

/**
 * Regex to detect the PAST-TENSE reference form of "avis de motion":
 * "avis de motion a été donné".
 *
 * These appear in ATTENDU QUE / CONSIDÉRANT QUE clauses within the adoption
 * section of a resolution (e.g. "Attendu qu'un avis de motion a été donné lors
 * de la séance du …").  They reference a motion that was ALREADY given in a
 * previous clause — the relevant règlement information is in the FORWARD
 * direction (the "Que le conseil adopte … le règlement numéro X…" clause),
 * NOT in the backward direction.
 *
 * For these past-tense matches we suppress the backward window entirely to
 * prevent backward contamination from preceding Attendu clauses that may
 * reference other règlements (Sainte-Martine 2026-510 adoption section
 * references "modifié par le projet de Règlement numéro 2026-509").
 */
const AVIS_MOTION_PAST_TENSE_RE = /avis\s+de\s+motion\s+a\s+[eé]t[eé]\s+donn[eé]/i;

/**
 * Detect "avis de motion → changement de zonage" in the plain text of a PV.
 *
 * Algorithm:
 *   1. Find every occurrence of `AVIS_MOTION_RE` in the text.
 *   2. For each match, extract a context window:
 *      - ACTIVE form ("Donne avis de motion", "Avis de motion est donné"):
 *        backward window capped at the previous \n\n AND ±400 chars.  This
 *        handles PVs where the section header names the règlement BEFORE the
 *        motion phrase (Saint-Damase pattern) while preventing cross-item
 *        backward contamination (Sainte-Martine 2026-510 vs 2026-509).
 *      - PAST-TENSE form ("avis de motion a été donné"): ZERO backward window.
 *        These appear in ATTENDU QUE clauses; the règlement being adopted is
 *        named FORWARD.  Backward context only risks picking up references to
 *        other règlements from preceding Attendu lines.
 *      - BOTH forms: forward window capped at the next \n\n AND ±400 chars,
 *        preventing cross-item contamination (Vaudreuil-Dorion pattern).
 *   3. Within that window, look for a règlement number AND a zonage keyword.
 *   4. If both are present → `changementZonage: true` (high-precision).
 *      Only règlement numbers from zonage contexts are added to
 *      `reglementNumbers`; non-zonage motions do NOT contribute to the list.
 *   5. Modified-règlement exclusion: when the context contains both a NEW
 *      règlement number (the object of the avis de motion) and an OLD one (via
 *      "modifiant le règlement de zonage numéro Y"), only the new number is
 *      kept in `reglementNumbers`.  When only the old number exists (Châteauguay
 *      Z-3001: "d'un règlement modifiant le règlement de zonage Z-3001"), it is
 *      retained as the best available identifier.
 *   6. If only a motion is present but no règlement/zonage → `avisDeMotion: true`
 *      but `changementZonage: false` (medium-confidence, reported separately).
 *
 * Returns a typed `ZonageChangeDetectionT` — never throws.
 */
export function detectZonageChange(pvText: string): ZonageChangeDetectionT {
  const allReglementNumbers: string[] = [];
  const allZoneRefs: string[] = [];
  const excerpts: string[] = [];
  let foundAvisDeMotion = false;
  let foundChangement = false;
  let densiteAutorisee: string | null = null;

  const WINDOW = 400; // chars each side of the motion phrase

  const motionRe = new RegExp(AVIS_MOTION_RE.source, "gi");
  for (const m of pvText.matchAll(motionRe)) {
    const idx = m.index ?? 0;
    const matchEnd = idx + (m[0]?.length ?? 0);
    const isPastTense = AVIS_MOTION_PAST_TENSE_RE.test(m[0] ?? "");

    // Backward window:
    //   - Past-tense form: zero backward window (règlement info is in the
    //     forward "Que le conseil adopte…" clause, not behind the match).
    //   - Active form: capped at the previous \n\n paragraph separator AND at
    //     400 chars before the match, whichever is MORE recent.
    let ctxStart: number;
    if (isPastTense) {
      ctxStart = idx;
    } else {
      const prevParaBreak = pvText.lastIndexOf("\n\n", idx);
      ctxStart = prevParaBreak === -1
        ? Math.max(0, idx - WINDOW)
        : Math.max(prevParaBreak + 2, idx - WINDOW);
    }

    // Forward window: capped at the next \n\n after the match end AND at 400
    // chars after the match end.  Prevents cross-item contamination from the
    // forward direction (Vaudreuil-Dorion pattern).
    const nextParaBreak = pvText.indexOf("\n\n", matchEnd);
    const forwardLimit = nextParaBreak === -1
      ? Math.min(pvText.length, matchEnd + WINDOW)
      : Math.min(matchEnd + WINDOW, nextParaBreak);
    const ctxEnd = forwardLimit;
    const ctx = pvText.slice(ctxStart, ctxEnd);

    const regNumbers = extractReglementNumbers(ctx);
    const hasZonageKw = ZONAGE_KEYWORDS_RE.test(ctx);
    // Pass regNumbers so that règlement identifiers (e.g. Z-3001) are not
    // also listed as zone codes in zoneRefs.
    const zoneCodes = extractZoneCodes(ctx, regNumbers);
    const densMatch = ctx.match(DENSITE_RE);

    foundAvisDeMotion = true;

    if (regNumbers.length > 0 && hasZonageKw) {
      foundChangement = true;
      // Precision filter: exclude the MODIFIED règlement number ("modifiant le
      // règlement de zonage numéro Y") when a distinct NEW number exists.
      const modifiedNums = extractModifiedReglementNumbers(ctx);
      const newNums = filterNewReglements(regNumbers, modifiedNums);
      allReglementNumbers.push(...newNums);
      allZoneRefs.push(...zoneCodes);
      excerpts.push(trimExcerpt(pvText, idx));
      if (densMatch && !densiteAutorisee) {
        densiteAutorisee = densMatch[0].replace(/\s+/g, " ").trim();
      }
    } else if (regNumbers.length > 0) {
      // Motion with règlement but no explicit zonage keyword — avisDeMotion
      // reported, but règlement numbers are NOT added to reglementNumbers
      // (which is reserved for zonage-specific règlements only).
      excerpts.push(trimExcerpt(pvText, idx));
    }
  }

  return ZonageChangeDetection.parse({
    avisDeMotion: foundAvisDeMotion,
    reglementNumbers: Array.from(new Set(allReglementNumbers)),
    changementZonage: foundChangement,
    excerpts,
    zoneRefs: Array.from(new Set(allZoneRefs)),
    densiteAutorisee,
  });
}
