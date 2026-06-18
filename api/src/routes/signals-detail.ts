/**
 * WP Signaux — Detail route.
 *
 * GET /api/signals/:city/detail
 *
 * Returns the real DesignationEvent canonicals for a city from the persisted
 * ontology project state (the same object the ontology route loads for counts).
 *
 * Anti-invention policy (rules cardinales §0.2):
 *   - Only returns events that exist in the real persisted project state.
 *   - Cities without a project state return events=[].
 *   - NO PII ever returned (no owner, no lot owner, no address owner).
 *   - Règlement numbers / zone refs are derived from the canonical's member
 *     mentions (normalized_terms), never fabricated.
 */

import { Hono } from "hono";

import type { ObjectStore } from "../storage/object-store.js";
import {
  parseProjectState,
  projectStateKey,
  type OntologyProjectState,
} from "../services/exploitation/project-state.js";
import type { CanonicalEntity } from "../services/exploitation/reconcile.js";
import type { MentionNode } from "../services/exploitation/mentions.js";

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies
// ─────────────────────────────────────────────────────────────────────────────

export interface SignalsDetailDeps {
  store: ObjectStore;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shape
// ─────────────────────────────────────────────────────────────────────────────

export type EvidenceMissingField =
  | "description"
  | "citation"
  | "pdfLink"
  | "documentDate"
  | "page"
  | "bbox";

export interface EvidenceCompleteness {
  hasDescription: boolean;
  hasCitationExcerpt: boolean;
  hasPdfLink: boolean;
  hasDocumentDate: boolean;
  hasPage: boolean;
  hasBbox: boolean;
  missing: EvidenceMissingField[];
}

export interface SignalEvidenceRef {
  docSha: string | null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  rawRef: string | null;
  rawObjectKey: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
}

export interface SignalEvidence {
  description: string | null;
  citation: string | null;
  excerpt: string | null;
  sourceUrl: string | null;
  documentUrl: string | null;
  rawRef: string | null;
  rawObjectKey: string | null;
  sourceRef: string | null;
  documentDate: string | null;
  page: number | null;
  bbox: [number, number, number, number] | null;
  refs: SignalEvidenceRef[];
  completeness: EvidenceCompleteness;
}

/** One real DesignationEvent from the ontology project state (NO PII). */
export interface DesignationEventDetail {
  /** Human-readable label extracted from the canonical (verbatim from source). */
  label: string;
  /**
   * Règlement numbers that key this event (extracted from member mentions'
   * normalized_terms; may be empty when the canonical label carries the info
   * but the parser did not emit structured terms).
   */
  reglementNumbers: string[];
  /**
   * Zone codes referenced by this event (extracted from aliases or label;
   * may be empty).
   */
  zoneRefs: string[];
  /**
   * Raw S3 evidence ref (the procès-verbal or avis-public key). Never null
   * for a real DesignationEvent canonical (anti-invention: no evidence ⇒ no
   * canonical). May be empty string when evidenceRefs is unexpectedly empty.
   */
  sourceRef: string;
  /**
   * ISO date from the project-state generatedAt (when the event was observed).
   * Proxy for dateObserved — the real observation date is the document date
   * embedded in the S3 key (not re-parsed here).
   */
  dateObserved: string;
  /** Explicit evidence contract. Missing fields stay visible to the UI. */
  evidence: SignalEvidence;
}

export interface SignalDetailResponse {
  ok: boolean;
  citySlug: string;
  events: DesignationEventDetail[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Load a persisted project state from object storage. Returns null on miss. */
async function loadState(
  store: ObjectStore,
  citySlug: string,
): Promise<OntologyProjectState | null> {
  const key = projectStateKey(citySlug);
  const head = await store.head(key);
  if (!head) return null;
  const bytes = await store.get(key);
  return parseProjectState(bytes);
}

/**
 * ZONE_CODE_RE — letter(s) + optional hyphen + digits (e.g. H-431, RA-2, R2).
 * Conservative: requires ≥1 letter prefix then an optional hyphen then ≥1 digit.
 * Never matches pure numbers or pure words.
 */
const ZONE_CODE_RE = /\b([A-Za-z]{1,4}-?\d+)\b/gu;

/**
 * Extract règlement numbers from a DesignationEvent canonical.
 *
 * Two-pass strategy (anti-invention, format-agnostic):
 *
 *   Pass 1 (PRIMARY) — read the structured `reglementNumbers` field on
 *     DesignationEvent member mentions. This field is set by pvMentions when
 *     detectZonageChange returns non-empty reglementNumbers. It contains the
 *     verbatim parser output, covering ALL règlement formats (digit-prefix
 *     like "1926-26", letter-prefix like "Z-3001", multi-segment like
 *     "V654-2026-33", etc.) without any format regex. Numbers are uppercased
 *     for canonical display.
 *
 *   Pass 2 (FALLBACK) — if no mention carries the structured field (legacy
 *     data pre-dating this fix), fall back to the normalized_terms filter with
 *     the format regexes previously used. Ensures backward-compatibility for
 *     project states persisted before this change.
 *
 * Nothing is fabricated: a number only appears when it was explicitly set on
 * the mention by the parser.
 */
function extractReglementNumbers(
  canonical: CanonicalEntity,
  mentionIndex: Map<string, MentionNode>,
): string[] {
  const seen = new Set<string>();

  // Pass 1 — read the structured reglementNumbers field (format-agnostic).
  for (const mId of canonical.memberMentionIds) {
    const m = mentionIndex.get(mId);
    if (!m || m.type !== "DesignationEvent") continue;
    if (m.reglementNumbers && m.reglementNumbers.length > 0) {
      for (const num of m.reglementNumbers) {
        seen.add(num.toUpperCase());
      }
    }
  }

  // Pass 2 — fallback for legacy mentions without the structured field.
  if (seen.size === 0) {
    for (const mId of canonical.memberMentionIds) {
      const m = mentionIndex.get(mId);
      if (!m || m.type !== "DesignationEvent") continue;
      for (const term of m.normalized_terms) {
        // Règlement numbers come in two legacy-supported styles:
        //   - Digit-prefix: "1926-26", "38-41", "1528-17"
        //   - Letter-single-prefix: "z-3001" (Châteauguay) → "Z-3001"
        // normalized_terms are lowercased by norm(); store canonical upper-case.
        if (/^\d[\d-]+\d$/u.test(term) || /^[A-Za-z]-\d{3,4}$/u.test(term)) {
          seen.add(term.toUpperCase());
        }
      }
    }
  }

  return Array.from(seen).sort();
}

/**
 * Extract zone codes from a DesignationEvent canonical.
 *
 * Strategy (two-pass, anti-invention):
 *   1. Member mentions' `zoneRefs` field — verbatim codes extracted by the PV
 *      parser from the real bytes (most reliable, set by pvMentions when
 *      detectZonageChange returns non-empty zoneRefs).
 *   2. Fallback: scan the canonical label and aliases for ZONE_CODE_RE matches
 *      (e.g. H-431 embedded in the label text).  Only codes found verbatim.
 * Nothing is fabricated.
 */
function extractZoneRefs(
  canonical: CanonicalEntity,
  mentionIndex: Map<string, MentionNode>,
): string[] {
  const seen = new Set<string>();

  // Pass 1 — structured zoneRefs from DesignationEvent member mentions.
  for (const mId of canonical.memberMentionIds) {
    const m = mentionIndex.get(mId);
    if (!m || m.type !== "DesignationEvent") continue;
    if (m.zoneRefs && m.zoneRefs.length > 0) {
      for (const z of m.zoneRefs) {
        seen.add(z.toUpperCase());
      }
    }
  }

  // Pass 2 — label / alias scan (fallback when mention has no zoneRefs field).
  // Exclude codes that are règlement identifiers (letter-prefix style, e.g.
  // Z-3001) which can appear in labels like "règlement de zonage Z-3001".
  // Precision guard: skip any code immediately preceded by "règlement" in the
  // label text (same rule as the PV parser's extractZoneCodes).
  if (seen.size === 0) {
    const targets = [canonical.label, ...canonical.aliases];
    for (const text of targets) {
      const matches = text.matchAll(ZONE_CODE_RE);
      for (const match of matches) {
        const code = match[1]!.toUpperCase();
        const matchStart = match.index ?? 0;
        const lookback = text.slice(Math.max(0, matchStart - 40), matchStart);
        if (/r[eè]glement\b/i.test(lookback)) continue;
        seen.add(code);
      }
    }
  }

  return Array.from(seen).sort();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function parseDocumentDateFromRef(sourceRef: string): string | null {
  const dashed = sourceRef.match(
    /(?:^|[^\d])(\d{4})[-/](\d{2})[-/](\d{2})(?:[^\d]|$)/u,
  );
  const compact = sourceRef.match(
    /(?:^|[^\d])(\d{4})(\d{2})(\d{2})(?:[^\d]|$)/u,
  );
  const match = dashed ?? compact;
  if (!match) return null;

  const [, year, month, day] = match;
  const candidate = `${year}-${month}-${day}`;
  const date = new Date(`${candidate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : candidate;
}

function buildCompleteness(evidence: Omit<SignalEvidence, "completeness">): EvidenceCompleteness {
  const completeness: EvidenceCompleteness = {
    hasDescription: evidence.description !== null,
    hasCitationExcerpt: evidence.citation !== null || evidence.excerpt !== null,
    hasPdfLink:
      evidence.sourceUrl !== null ||
      evidence.documentUrl !== null ||
      evidence.rawRef !== null ||
      evidence.rawObjectKey !== null ||
      evidence.sourceRef !== null,
    hasDocumentDate: evidence.documentDate !== null,
    hasPage: evidence.page !== null,
    hasBbox: evidence.bbox !== null,
    missing: [],
  };

  if (!completeness.hasDescription) completeness.missing.push("description");
  if (!completeness.hasCitationExcerpt) completeness.missing.push("citation");
  if (!completeness.hasPdfLink) completeness.missing.push("pdfLink");
  if (!completeness.hasDocumentDate) completeness.missing.push("documentDate");
  if (!completeness.hasPage) completeness.missing.push("page");
  if (!completeness.hasBbox) completeness.missing.push("bbox");

  return completeness;
}

function buildLegacyEvidence(sourceRef: string): SignalEvidence {
  const normalizedSourceRef = readString(sourceRef);
  const documentDate = normalizedSourceRef
    ? parseDocumentDateFromRef(normalizedSourceRef)
    : null;
  const refs: SignalEvidenceRef[] = normalizedSourceRef
    ? [
        {
          docSha: null,
          citation: null,
          excerpt: null,
          sourceUrl: null,
          documentUrl: null,
          rawRef: normalizedSourceRef,
          rawObjectKey: normalizedSourceRef,
          page: null,
          bbox: null,
        },
      ]
    : [];
  const evidenceWithoutCompleteness: Omit<SignalEvidence, "completeness"> = {
    description: null,
    citation: null,
    excerpt: null,
    sourceUrl: null,
    documentUrl: null,
    rawRef: normalizedSourceRef,
    rawObjectKey: normalizedSourceRef,
    sourceRef: normalizedSourceRef,
    documentDate,
    page: null,
    bbox: null,
    refs,
  };

  return {
    ...evidenceWithoutCompleteness,
    completeness: buildCompleteness(evidenceWithoutCompleteness),
  };
}

/**
 * Map a DesignationEvent canonical to its detail DTO.
 * No PII: canonical entities at the DesignationEvent level never carry owner info.
 */
function toDetail(
  canonical: CanonicalEntity,
  mentionIndex: Map<string, MentionNode>,
  generatedAt: string,
): DesignationEventDetail {
  return {
    label: canonical.label,
    reglementNumbers: extractReglementNumbers(canonical, mentionIndex),
    zoneRefs: extractZoneRefs(canonical, mentionIndex),
    sourceRef: canonical.evidenceRefs[0] ?? "",
    dateObserved: generatedAt,
    evidence: buildLegacyEvidence(canonical.evidenceRefs[0] ?? ""),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mount the signals-detail route on a Hono instance.
 *
 * GET /api/signals/:city/detail
 *   → { ok: true, citySlug, events: DesignationEventDetail[] }
 *
 * Always returns 200 with ok:true and events:[] for cities without a state
 * (honest empty — no fabrication). Uses the same object store as ontologyRoute.
 */
export function signalsDetailRoute(deps: SignalsDetailDeps): Hono {
  const app = new Hono();

  app.get("/api/signals/:city/detail", async (c) => {
    const citySlug = c.req.param("city");

    const state = await loadState(deps.store, citySlug);

    // No project state → honest empty (city not yet seeded or state expired).
    if (!state) {
      return c.json<SignalDetailResponse>({
        ok: true,
        citySlug,
        events: [],
      });
    }

    // Build a mention index for O(1) lookup during event mapping.
    const mentionIndex = new Map<string, MentionNode>(
      state.mentions.map((m) => [m.id, m]),
    );

    const events: DesignationEventDetail[] = state.canonicals
      .filter((c) => c.type === "DesignationEvent")
      .map((c) => toDetail(c, mentionIndex, state.generatedAt));

    return c.json<SignalDetailResponse>({
      ok: true,
      citySlug: state.citySlug,
      events,
    });
  });

  return app;
}
