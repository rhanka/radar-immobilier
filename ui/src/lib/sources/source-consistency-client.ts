/**
 * source-consistency-client — client + helpers PURS de la section « Cohérence
 * E2E » (WP3 LOT1), lane SÉPARÉE de la couverture (`source-coverage-client.ts`
 * — ne touche jamais `worstStatus`).
 *
 * Contrat : GET /api/source/consistency (api/src/routes/source-consistency.ts).
 * Batch PG DATÉ — snapshot matérialisé par `run-consistency-snapshot.ts`
 * (focus-30 par défaut, extensible province ; cf. son en-tête pour la
 * commande de régénération). Une ville ABSENTE de la réponse n'a PAS de
 * snapshot (jamais ciblée par un run, ou run pas encore exécuté) :
 * `getCityConsistency` retourne alors honnêtement `Non mesuré`
 * (`unmeasuredCityConsistency`) — jamais un faux 0 % ni un faux 100 %.
 *
 * Périmètre STRICT de ce lot : seulement E0 (PV↔signal) et E1 (signal↔zone).
 * Score = maillon faible tri-état (`coherent`/`partial`/`unmeasured`) — jamais
 * une moyenne, jamais « Non couvert » (réservé à la couverture).
 */

export type ConsistencyState = "coherent" | "partial" | "unmeasured";
export type ConsistencyMode = "batch-pg" | "unmeasured";
export type EdgeStatus = "measured" | "non_applicable" | "non_mesure";

/** Une métrique num/dénom avec un statut explicite — dénom vide ≠ 100 %. */
export interface EdgeMetric {
  num: number;
  denom: number;
  rate: number | null;
  status: EdgeStatus;
}

export interface SignalZoneEdge extends EdgeMetric {
  /** Dont matches « fiables » (arête structurée/exacte, score élevé). */
  reliableNum: number;
  reliableRate: number | null;
  /** Applicabilité anti-100%-trompeur : signaux désignant une zone / publiés. */
  applicability: EdgeMetric;
}

export interface CityConsistency {
  citySlug: string;
  mode: ConsistencyMode;
  generatedAt: string | null;
  state: ConsistencyState;
  edges: {
    pvSignal: EdgeMetric;
    signalZone: SignalZoneEdge;
  };
  blockers: string[];
}

export interface ConsistencyResponse {
  generatedAt: string | null;
  cities: Array<{ citySlug: string; consistency: CityConsistency }>;
}

const CONSISTENCY_URL = "/api/source/consistency";

/**
 * Récupère la cohérence E2E batch (toutes les villes ayant un snapshot).
 * Lève en cas d'échec HTTP : le composant appelant affiche alors un état
 * honnête (« donnée indisponible »), jamais un faux zéro/vert.
 */
export async function fetchSourceConsistency(
  fetchImpl: typeof fetch = fetch,
): Promise<ConsistencyResponse> {
  const res = await fetchImpl(CONSISTENCY_URL, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`source-consistency HTTP ${res.status}`);
  }
  return (await res.json()) as ConsistencyResponse;
}

const EMPTY_EDGE: EdgeMetric = { num: 0, denom: 0, rate: null, status: "non_mesure" };

/** Ville sans snapshot -> `Non mesuré` honnête (jamais une erreur, jamais un vert fabriqué). */
export function unmeasuredCityConsistency(citySlug: string): CityConsistency {
  return {
    citySlug,
    mode: "unmeasured",
    generatedAt: null,
    state: "unmeasured",
    edges: {
      pvSignal: EMPTY_EDGE,
      signalZone: {
        ...EMPTY_EDGE,
        reliableNum: 0,
        reliableRate: null,
        applicability: EMPTY_EDGE,
      },
    },
    blockers: [],
  };
}

/** Cherche la cohérence d'une ville dans la réponse batch ; repli `Non mesuré`. */
export function getCityConsistency(
  citySlug: string,
  response: ConsistencyResponse | null,
): CityConsistency {
  const found = response?.cities.find((c) => c.citySlug === citySlug);
  return found ? found.consistency : unmeasuredCityConsistency(citySlug);
}

/** Libellé client tri-état — copy neutre, aucun jargon interne. */
export const CONSISTENCY_STATE_LABEL: Record<ConsistencyState, string> = {
  coherent: "Cohérent",
  partial: "À qualifier",
  unmeasured: "Non mesuré",
};

/** Tonalité DS du badge tri-état (success/warning/neutral). */
export const CONSISTENCY_STATE_BADGE_TONE: Record<
  ConsistencyState,
  "success" | "warning" | "neutral"
> = {
  coherent: "success",
  partial: "warning",
  unmeasured: "neutral",
};

/** Formatte une métrique en copy neutre : « X/Y » ou statut honnête (jamais un faux 100 %). */
export function formatEdgeCount(edge: EdgeMetric): string {
  if (edge.status === "non_applicable") return "non applicable";
  if (edge.status === "non_mesure") return "non mesuré";
  return `${edge.num}/${edge.denom}`;
}

/** Fraction « fiable » en % arrondi, ou null si non calculable (aucun match). */
export function formatReliablePct(edge: SignalZoneEdge): string | null {
  if (edge.reliableRate === null) return null;
  return `${Math.round(edge.reliableRate * 100)} %`;
}

/** Sous-ligne fraîcheur : « batch PG · <date> » ou repli honnête (pas de snapshot). */
export function formatConsistencyFreshness(consistency: CityConsistency): string {
  if (consistency.mode === "unmeasured" || !consistency.generatedAt) {
    return "aucun snapshot pour cette ville";
  }
  const date = new Date(consistency.generatedAt);
  // Fuseau UTC EXPLICITE : la date du batch ne doit jamais dépendre du fuseau
  // du navigateur (un run à minuit UTC ne doit pas glisser d'un jour en local).
  const formatted = Number.isNaN(date.getTime())
    ? consistency.generatedAt
    : date.toLocaleDateString("fr-CA", { timeZone: "UTC" });
  return `batch PG · ${formatted}`;
}
