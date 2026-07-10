/**
 * source-consistency-client — client + helpers PURS de la section « Cohérence
 * E2E » (WP3 LOT1+LOT2), lane SÉPARÉE de la couverture
 * (`source-coverage-client.ts` — ne touche jamais `worstStatus`).
 *
 * Contrat : GET /api/source/consistency (api/src/routes/source-consistency.ts).
 * Batch PG/OGC DATÉ — snapshot matérialisé par `run-consistency-snapshot.ts`
 * (focus-30 par défaut, extensible province ; cf. son en-tête pour la
 * commande de régénération). Une ville ABSENTE de la réponse n'a PAS de
 * snapshot (jamais ciblée par un run, ou run pas encore exécuté) :
 * `getCityConsistency` retourne alors honnêtement `Non mesuré`
 * (`unmeasuredCityConsistency`) — jamais un faux 0 % ni un faux 100 %.
 *
 * Arêtes : E0 (PV↔signal), E1 (signal↔zone), E2 (zone↔grille, LOT2 — codes
 * communs `qc-zonage-<slug>` ∩ `qc-zonage-norms-<slug>`). `getCityConsistency`
 * normalise un payload SANS `zoneGrid` (snapshot écrit avant LOT2) vers un
 * défaut `non_mesure` honnête — jamais un crash, jamais un chiffre fabriqué.
 * Score global = maillon faible tri-état (`coherent`/`partial`/`unmeasured`,
 * E0/E1 uniquement à ce stade) — jamais une moyenne, jamais « Non couvert »
 * (réservé à la couverture).
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

/** Classification honnête dédiée à l'arête zone↔grille (badge UI) — cf. API `ZoneGridState`. */
export type ZoneGridState =
  | "ok"
  | "partiel"
  | "millesime-disjoint"
  | "absente"
  | "zonage-absent"
  | "non_mesure";

export interface ZoneGridEdge extends EdgeMetric {
  state: ZoneGridState;
  /** true si un feature zonage porte une source « ancien »/« former » (ex. ArcGIS Ancien_zonage). */
  staleZoningSource: boolean;
}

export interface CityConsistency {
  citySlug: string;
  mode: ConsistencyMode;
  generatedAt: string | null;
  state: ConsistencyState;
  edges: {
    pvSignal: EdgeMetric;
    signalZone: SignalZoneEdge;
    zoneGrid: ZoneGridEdge;
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

/** Défaut honnête E2 quand aucune mesure n'est disponible (ville hors snapshot OU payload legacy pré-LOT2). */
export const UNMEASURED_ZONE_GRID: ZoneGridEdge = {
  ...EMPTY_EDGE,
  state: "non_mesure",
  staleZoningSource: false,
};

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
      zoneGrid: UNMEASURED_ZONE_GRID,
    },
    blockers: [],
  };
}

/**
 * Cherche la cohérence d'une ville dans la réponse batch ; repli `Non mesuré`.
 * Normalise un `edges.zoneGrid` absent (snapshot écrit AVANT LOT2, ou payload
 * de test non mis à jour) vers `UNMEASURED_ZONE_GRID` — jamais un crash sur
 * `.state`/`.rate` undefined, jamais un chiffre fabriqué.
 */
export function getCityConsistency(
  citySlug: string,
  response: ConsistencyResponse | null,
): CityConsistency {
  const found = response?.cities.find((c) => c.citySlug === citySlug);
  if (!found) return unmeasuredCityConsistency(citySlug);
  const { consistency } = found;
  if (consistency.edges.zoneGrid) return consistency;
  return {
    ...consistency,
    edges: { ...consistency.edges, zoneGrid: UNMEASURED_ZONE_GRID },
  };
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

/**
 * Libellé honnête de l'arête zone↔grille (E2, LOT2) — copy neutre, aucun
 * jargon interne. `millesime-disjoint` se raffine en « Ancien zonage servi »
 * quand la cause est CONFIRMÉE (source ArcGIS "Ancien_zonage" détectée sur le
 * zonage servi), sinon reste « Millésime disjoint » (constat, cause inconnue).
 */
const ZONE_GRID_STATE_LABEL: Record<Exclude<ZoneGridState, "millesime-disjoint">, string> = {
  ok: "OK",
  partiel: "À qualifier",
  absente: "Grille absente",
  "zonage-absent": "Zonage absent",
  non_mesure: "Non mesuré",
};

export function formatZoneGridState(edge: ZoneGridEdge): string {
  if (edge.state === "millesime-disjoint") {
    return edge.staleZoningSource ? "Ancien zonage servi" : "Millésime disjoint";
  }
  return ZONE_GRID_STATE_LABEL[edge.state];
}
