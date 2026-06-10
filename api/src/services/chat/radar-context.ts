/**
 * feat(chat): Radar context builder for the chat assistant.
 *
 * Fetches live data from the radar's internal endpoints and produces a compact
 * textual summary injected into the chat system prompt. The assistant can then
 * answer factual questions about the radar without fabricating data.
 *
 * Anti-invention policy:
 *   - Only data returned by the real endpoints is surfaced.
 *   - If an endpoint is unreachable or returns no data, the summary says so.
 *   - NO PII is ever included (endpoints themselves enforce this).
 *
 * Endpoints consumed (same-process loopback):
 *   GET /api/signals/by-city      — DesignationEvent counts per city
 *   GET /api/opportunites          — scored + ranked opportunities
 *   GET /api/signals/:city/detail  — per-city DesignationEvent details
 */

/** Internal base URL of the running API (same process, loopback). */
const apiBaseUrl = (env: NodeJS.ProcessEnv = process.env): string => {
  const port = env.PORT && env.PORT.trim().length > 0 ? env.PORT.trim() : "3000";
  return `http://127.0.0.1:${port}`;
};

/** One city signal summary for context injection. */
export interface CitySignalSummary {
  citySlug: string;
  /** Number of DesignationEvent canonicals (zonage changes). */
  designationEventCount: number;
}

/** Top-ranked opportunity for context injection (NO PII). */
export interface TopOpportunity {
  citySlug: string;
  label: string;
  score: number;
  zoneRefs: string[];
  reglementNumbers: string[];
}

/**
 * Compact radar context snapshot. Injected verbatim into the chat system
 * prompt so the LLM can answer factual questions about the radar.
 */
export interface RadarContextSnapshot {
  /** ISO timestamp when this snapshot was built. */
  builtAt: string;
  /** Cities that have at least one zonage change signal. */
  citiesWithZonage: CitySignalSummary[];
  /** Total number of DesignationEvent signals across all cities. */
  totalSignals: number;
  /** Top-5 opportunities by score (may be empty if none are seeded). */
  topOpportunites: TopOpportunity[];
  /** Whether the context could be fetched successfully. */
  ok: boolean;
  /** Human-readable error if ok=false. */
  error?: string;
}

// ─── Response shapes mirroring the live endpoints ────────────────────────────

interface ByCityItem {
  citySlug: string;
  designationEventCount: number;
  generatedAt: string | null;
}

interface ByCityResponse {
  ok: boolean;
  items: ByCityItem[];
}

interface OpportuniteFacteurs {
  proximite: number;
  zoneType: number;
  recence: number;
}

interface OpportuniteItem {
  citySlug: string;
  reglementNumbers: string[];
  zoneRefs: string[];
  label: string;
  sourceRef: string;
  dateObserved: string;
  score: number;
  facteurs: OpportuniteFacteurs;
}

interface OpportunitesResponse {
  ok: boolean;
  total: number;
  scoreVersion: string;
  items: OpportuniteItem[];
}

// ─── Context builder ──────────────────────────────────────────────────────────

const MAX_TOP_OPPORTUNITIES = 5;

/**
 * Build a compact radar context snapshot by querying the live internal
 * endpoints. Safe to call from the chat turn handler; errors are caught and
 * surfaced as `ok: false` so the assistant can say "données non disponibles"
 * rather than crashing.
 *
 * @param fetchImpl - Injected fetch implementation (defaults to global fetch).
 * @param env - Process environment (defaults to process.env).
 */
export const buildRadarContext = async (
  fetchImpl: typeof fetch = fetch,
  env: NodeJS.ProcessEnv = process.env,
): Promise<RadarContextSnapshot> => {
  const base = apiBaseUrl(env);
  const builtAt = new Date().toISOString();

  try {
    // Fetch both endpoints in parallel for minimal latency.
    const [byCityRes, oppRes] = await Promise.all([
      fetchImpl(`${base}/api/signals/by-city`),
      fetchImpl(`${base}/api/opportunites`),
    ]);

    if (!byCityRes.ok) {
      return {
        builtAt,
        citiesWithZonage: [],
        totalSignals: 0,
        topOpportunites: [],
        ok: false,
        error: `signals/by-city HTTP ${byCityRes.status}`,
      };
    }

    if (!oppRes.ok) {
      return {
        builtAt,
        citiesWithZonage: [],
        totalSignals: 0,
        topOpportunites: [],
        ok: false,
        error: `opportunites HTTP ${oppRes.status}`,
      };
    }

    const byCityData = (await byCityRes.json()) as ByCityResponse;
    const oppData = (await oppRes.json()) as OpportunitesResponse;

    const citiesWithZonage: CitySignalSummary[] = (byCityData.items ?? [])
      .filter((item) => item.designationEventCount > 0)
      .map((item) => ({
        citySlug: item.citySlug,
        designationEventCount: item.designationEventCount,
      }));

    const totalSignals = citiesWithZonage.reduce(
      (sum, c) => sum + c.designationEventCount,
      0,
    );

    const topOpportunites: TopOpportunity[] = (oppData.items ?? [])
      .slice(0, MAX_TOP_OPPORTUNITIES)
      .map((item) => ({
        citySlug: item.citySlug,
        label: item.label,
        score: item.score,
        zoneRefs: item.zoneRefs,
        reglementNumbers: item.reglementNumbers,
      }));

    return {
      builtAt,
      citiesWithZonage,
      totalSignals,
      topOpportunites,
      ok: true,
    };
  } catch (error) {
    return {
      builtAt,
      citiesWithZonage: [],
      totalSignals: 0,
      topOpportunites: [],
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
};

// ─── Prompt serializer ────────────────────────────────────────────────────────

/**
 * Serialize a RadarContextSnapshot to a compact French-language text block
 * suitable for injection into a system prompt. The format is intentionally
 * terse to save tokens while remaining readable by any LLM.
 *
 * Example output:
 *   [CONTEXTE RADAR — 2025-01-15T10:00:00.000Z]
 *   Signaux zonage : 12 événements dans 4 villes.
 *   Villes avec changement de zonage : valleyfield (5), chateauguay (4), ...
 *   Top opportunités (score desc) :
 *     1. valleyfield — Zone H-431, règl. 1926-26 (score 87) : Modification zonage secteur nord
 *     ...
 */
export const serializeRadarContext = (ctx: RadarContextSnapshot): string => {
  if (!ctx.ok) {
    return (
      `[CONTEXTE RADAR — ${ctx.builtAt}]\n` +
      `Données radar non disponibles (${ctx.error ?? "erreur inconnue"}). ` +
      `Dis à l'utilisateur que les données ne sont pas accessibles en ce moment.`
    );
  }

  const lines: string[] = [`[CONTEXTE RADAR — ${ctx.builtAt}]`];

  if (ctx.totalSignals === 0) {
    lines.push(
      "Aucun signal de changement de zonage disponible (aucune ville seedée).",
    );
  } else {
    lines.push(
      `Signaux zonage : ${ctx.totalSignals} événement(s) dans ${ctx.citiesWithZonage.length} ville(s).`,
    );
    const cityList = ctx.citiesWithZonage
      .map((c) => `${c.citySlug} (${c.designationEventCount})`)
      .join(", ");
    lines.push(`Villes avec changement de zonage : ${cityList}.`);
  }

  if (ctx.topOpportunites.length === 0) {
    lines.push("Aucune opportunité classée disponible.");
  } else {
    lines.push("Top opportunités (score décroissant) :");
    ctx.topOpportunites.forEach((opp, idx) => {
      const zones =
        opp.zoneRefs.length > 0 ? `, zones : ${opp.zoneRefs.join(", ")}` : "";
      const regls =
        opp.reglementNumbers.length > 0
          ? `, règl. : ${opp.reglementNumbers.join(", ")}`
          : "";
      lines.push(
        `  ${idx + 1}. ${opp.citySlug} (score ${opp.score}${zones}${regls}) : ${opp.label}`,
      );
    });
  }

  lines.push(
    "Règle : réponds uniquement à partir de ces données. " +
      "Si une information n'est pas dans ce contexte, dis-le clairement.",
  );

  return lines.join("\n");
};
