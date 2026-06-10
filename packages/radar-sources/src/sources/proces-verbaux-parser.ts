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
   * Règlement numbers extracted when the avis-de-motion context names a règlement
   * modifying the zonage bylaw.  Empty when no such number is found.
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
  /r[eè]glement\s+(?:n[o°]?\s*\.?\s*)?(\d{2,4}-\d{1,4})\b/gi;

/** Zone code pattern (matches Valleyfield codes like H-521, C-627-3). */
const ZONE_CODE_RE = /\b([A-Z]{1,4}-\d{2,4}(?:-\d{1,3})?)\b/g;

/** Keywords that indicate a change to the zoning bylaw (high-precision). */
const ZONAGE_KEYWORDS_RE =
  /\b(?:zonage|r[eè]glement\s+de\s+zonage|r[eè]glement\s+d[''']urbanisme|modifier\s+le\s+r[eè]glement|modification\s+du\s+r[eè]glement)\b/i;

/** Multi-family / densification keywords (best-effort, only for densiteAutorisee). */
const DENSITE_RE =
  /(?:habitation\s+multifamiliale|bifamiliale|trifamiliale|maison\s+de\s+chambres|logements?\s+multiples?|logements?\s+locatifs?|densification|multi\s*[-–]\s*logements?|maison\s+de\s+rapport|plex\b|duplex\b|triplex\b|quadruplex\b|immeuble\s+(?:r[eé]sidentiel|locatif)|appartements?\s+(?:ou\s+)?logements?|r[eé]sidentiel\s+(?:multi|densif))/i;

/**
 * Extract all règlement numbers cited in a text window (case-insensitive,
 * deduped, verbatim).
 */
function extractReglementNumbers(window: string): string[] {
  const numbers: string[] = [];
  const re = new RegExp(REGLEMENT_NUMBER_RE.source, "gi");
  for (const m of window.matchAll(re)) {
    if (m[1]) numbers.push(m[1]);
  }
  return Array.from(new Set(numbers));
}

/** Extract zone codes from a text window (deduped). */
function extractZoneCodes(window: string): string[] {
  const codes: string[] = [];
  const re = new RegExp(ZONE_CODE_RE.source, "g");
  for (const m of window.matchAll(re)) {
    if (m[1]) codes.push(m[1]);
  }
  return Array.from(new Set(codes));
}

/**
 * Detect "avis de motion → changement de zonage" in the plain text of a PV.
 *
 * Algorithm:
 *   1. Find every occurrence of `AVIS_MOTION_RE` in the text.
 *   2. For each match, extract a context window of ±400 chars.
 *   3. Within that window, look for a règlement number AND a zonage keyword.
 *   4. If both are present → `changementZonage: true` (high-precision).
 *   5. If only a motion is present but no règlement/zonage → `avisDeMotion: true`
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
    const ctxStart = Math.max(0, idx - WINDOW);
    const ctxEnd = Math.min(pvText.length, idx + (m[0]?.length ?? 0) + WINDOW);
    const ctx = pvText.slice(ctxStart, ctxEnd);

    const regNumbers = extractReglementNumbers(ctx);
    const hasZonageKw = ZONAGE_KEYWORDS_RE.test(ctx);
    const zoneCodes = extractZoneCodes(ctx);
    const densMatch = ctx.match(DENSITE_RE);

    foundAvisDeMotion = true;

    if (regNumbers.length > 0 && hasZonageKw) {
      foundChangement = true;
      allReglementNumbers.push(...regNumbers);
      allZoneRefs.push(...zoneCodes);
      excerpts.push(trimExcerpt(pvText, idx));
      if (densMatch && !densiteAutorisee) {
        densiteAutorisee = densMatch[0].replace(/\s+/g, " ").trim();
      }
    } else if (regNumbers.length > 0) {
      // Motion with règlement but no explicit zonage keyword — conservative:
      // still report but don't flag changementZonage.
      allReglementNumbers.push(...regNumbers);
      allZoneRefs.push(...zoneCodes);
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
