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
 * Strategy (anti-invention): use the member mentions' normalized_terms —
 * those are the verbatim terms the parser extracted from the real bytes.
 * When no mentions are available, return empty.
 */
function extractReglementNumbers(
  canonical: CanonicalEntity,
  mentionIndex: Map<string, MentionNode>,
): string[] {
  const seen = new Set<string>();
  for (const mId of canonical.memberMentionIds) {
    const m = mentionIndex.get(mId);
    if (!m) continue;
    // Only DesignationEvent mentions carry règlement numbers as terms.
    if (m.type !== "DesignationEvent") continue;
    for (const term of m.normalized_terms) {
      // Règlement numbers look like "1926-26", "38-41", "1528-17":
      // digit-hyphen-digit pattern (not a zone code which starts with a letter).
      if (/^\d[\d-]+\d$/u.test(term)) {
        seen.add(term);
      }
    }
  }
  return Array.from(seen).sort();
}

/**
 * Extract zone codes from a DesignationEvent canonical.
 *
 * Strategy: scan the canonical label and all aliases for ZONE_CODE_RE matches
 * (e.g. H-431, RA-2). Anti-invention: only returns codes found verbatim.
 */
function extractZoneRefs(canonical: CanonicalEntity): string[] {
  const seen = new Set<string>();
  const targets = [canonical.label, ...canonical.aliases];
  for (const text of targets) {
    const matches = text.matchAll(ZONE_CODE_RE);
    for (const m of matches) {
      seen.add(m[1]!.toUpperCase());
    }
  }
  return Array.from(seen).sort();
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
    zoneRefs: extractZoneRefs(canonical),
    sourceRef: canonical.evidenceRefs[0] ?? "",
    dateObserved: generatedAt,
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
