/**
 * WP Opportunités — Route de scoring.
 *
 * GET /api/opportunites
 *
 * Returns all real DesignationEvent changes across ALL seeded cities,
 * scored and ranked by descending score. Each item includes the decomposed
 * score factors for transparency.
 *
 * Anti-invention policy (rules cardinales §0.2):
 *   - Only events that exist in a real persisted project state are returned.
 *   - Score is a deterministic function of real data only (distance, zone
 *     refs, observation date). No market data, no fabricated factors.
 *   - Cities without a project state contribute no opportunities.
 *   - NO PII ever returned (no owner, no address, no lot owner).
 *
 * Score formula (v1, explicit weights):
 *   score = round( (proximite×0.40 + zoneType×0.40 + recence×0.20) × 100 )
 *   See api/src/services/opportunity/scoring.ts for the full formula.
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
import { ALL_SIGNALS_CITY_SLUGS } from "../services/sources/pv-seed.js";
import {
  scoreOpportunity,
  type ScoredOpportunity,
} from "../services/opportunity/scoring.js";

// ─────────────────────────────────────────────────────────────────────────────
// Dependencies
// ─────────────────────────────────────────────────────────────────────────────

export interface OpportunitesDeps {
  store: ObjectStore;
}

// ─────────────────────────────────────────────────────────────────────────────
// Response shape (NO PII)
// ─────────────────────────────────────────────────────────────────────────────

/** Score factor breakdown (each value ∈ [0,1]). */
export interface OpportuniteFacteurs {
  /** Proximity to Montréal sub-score (0–1). */
  proximite: number;
  /** Residential/mixed zone type sub-score (0–1). */
  zoneType: number;
  /** Recency sub-score (0–1). */
  recence: number;
}

/** One scored opportunity (NO PII). */
export interface OpportuniteItem {
  citySlug: string;
  reglementNumbers: string[];
  zoneRefs: string[];
  /** Human-readable label from source bytes. */
  label: string;
  /** Raw S3 evidence ref. Never PII. */
  sourceRef: string;
  /** ISO date string — project-state generatedAt. */
  dateObserved: string;
  /** Aggregate score 0–100. */
  score: number;
  /** Decomposed factor scores (for transparency). */
  facteurs: OpportuniteFacteurs;
}

export interface OpportunitesResponse {
  ok: boolean;
  /** Total number of opportunities before any filtering. */
  total: number;
  /** Scoring formula version. */
  scoreVersion: string;
  /** Opportunities ranked by score descending. */
  items: OpportuniteItem[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const SCORE_VERSION = "v1";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (copied from signals-detail.ts — same extraction logic)
// ─────────────────────────────────────────────────────────────────────────────

const ZONE_CODE_RE = /\b([A-Za-z]{1,4}-?\d+)\b/gu;

function extractReglementNumbers(
  canonical: CanonicalEntity,
  mentionIndex: Map<string, MentionNode>,
): string[] {
  const seen = new Set<string>();
  // Pass 1 — structured reglementNumbers field
  for (const mId of canonical.memberMentionIds) {
    const m = mentionIndex.get(mId);
    if (!m || m.type !== "DesignationEvent") continue;
    if (m.reglementNumbers && m.reglementNumbers.length > 0) {
      for (const num of m.reglementNumbers) {
        seen.add(num.toUpperCase());
      }
    }
  }
  // Pass 2 — legacy fallback
  if (seen.size === 0) {
    for (const mId of canonical.memberMentionIds) {
      const m = mentionIndex.get(mId);
      if (!m || m.type !== "DesignationEvent") continue;
      for (const term of m.normalized_terms) {
        if (/^\d[\d-]+\d$/u.test(term) || /^[A-Za-z]-\d{3,4}$/u.test(term)) {
          seen.add(term.toUpperCase());
        }
      }
    }
  }
  return Array.from(seen).sort();
}

function extractZoneRefs(
  canonical: CanonicalEntity,
  mentionIndex: Map<string, MentionNode>,
): string[] {
  const seen = new Set<string>();
  // Pass 1 — structured zoneRefs field
  for (const mId of canonical.memberMentionIds) {
    const m = mentionIndex.get(mId);
    if (!m || m.type !== "DesignationEvent") continue;
    if (m.zoneRefs && m.zoneRefs.length > 0) {
      for (const z of m.zoneRefs) {
        seen.add(z.toUpperCase());
      }
    }
  }
  // Pass 2 — label/alias scan fallback
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

/** Load a city's persisted project state. Returns null on miss. */
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

/** Map a DesignationEvent canonical + mention index → ScoredOpportunity. */
function canonicalToOpportunity(
  citySlug: string,
  canonical: CanonicalEntity,
  mentionIndex: Map<string, MentionNode>,
  generatedAt: string,
): ScoredOpportunity {
  const reglementNumbers = extractReglementNumbers(canonical, mentionIndex);
  const zoneRefs = extractZoneRefs(canonical, mentionIndex);
  return scoreOpportunity(citySlug, {
    label: canonical.label,
    reglementNumbers,
    zoneRefs,
    sourceRef: canonical.evidenceRefs[0] ?? "",
    dateObserved: generatedAt,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Route
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mount the opportunites route on a Hono instance.
 *
 * GET /api/opportunites
 *   → { ok: true, total, scoreVersion, items: OpportuniteItem[] }
 *
 * Items are sorted by score descending. Cities with no project state
 * contribute 0 items (honest empty — no fabrication).
 */
export function opportunitesRoute(deps: OpportunitesDeps): Hono {
  const app = new Hono();

  app.get("/api/opportunites", async (c) => {
    // Load all city states in parallel
    const stateResults = await Promise.all(
      ALL_SIGNALS_CITY_SLUGS.map(async (citySlug) => {
        const state = await loadState(deps.store, citySlug);
        return { citySlug, state };
      }),
    );

    const opportunities: ScoredOpportunity[] = [];

    for (const { citySlug, state } of stateResults) {
      if (!state) continue;

      const mentionIndex = new Map<string, MentionNode>(
        state.mentions.map((m) => [m.id, m]),
      );

      for (const canonical of state.canonicals) {
        if (canonical.type !== "DesignationEvent") continue;
        opportunities.push(
          canonicalToOpportunity(citySlug, canonical, mentionIndex, state.generatedAt),
        );
      }
    }

    // Sort by score descending (highest opportunity first)
    opportunities.sort((a, b) => b.score - a.score);

    const items: OpportuniteItem[] = opportunities.map((opp) => ({
      citySlug: opp.citySlug,
      reglementNumbers: opp.reglementNumbers,
      zoneRefs: opp.zoneRefs,
      label: opp.label,
      sourceRef: opp.sourceRef,
      dateObserved: opp.dateObserved,
      score: opp.score,
      facteurs: opp.facteurs,
    }));

    return c.json<OpportunitesResponse>({
      ok: true,
      total: items.length,
      scoreVersion: SCORE_VERSION,
      items,
    });
  });

  return app;
}
