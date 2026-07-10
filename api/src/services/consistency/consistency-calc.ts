/**
 * WP3 LOT1+LOT2 — Calcul PUR de la cohérence E2E (E0 PV↔signal, E1
 * signal↔zone, E2 zone↔grille).
 *
 * Fonctions SANS I/O : prennent des comptes déjà agrégés (par le job batch —
 * PG pour E0/E1 via `load-consistency-raw.ts`, API geo OGC pour E2 via
 * `load-zone-grid-raw.ts`) et dérivent le contrat `CityConsistency` —
 * dénominateurs EXPLICITES, tri-état MAILLON FAIBLE (jamais une moyenne),
 * jamais un dénominateur vide promu à 100 %. Testable sans DB/réseau
 * (cf. `consistency-calc.test.ts`).
 *
 * Périmètre :
 *   - E0 PV↔signal (grounding)   : signaux groundés (citation vérifiable) /
 *     signaux publiés. Réutilise la définition `signals.withCitation`
 *     existante (cf. `api/src/routes/source-coverage.ts`).
 *   - E1 signal↔zone (rappel)   : désignations-zone matchées à une zone
 *     SERVIE/courante (mapper #74, `geo_resolutions`/`geo_unresolved`) /
 *     désignations-zone. Distingue arête « fiable » (match structuré/exact,
 *     score_confiance élevé) vs repli texte plus incertain, et reporte
 *     l'applicabilité (signaux désignant une zone / signaux publiés) pour ne
 *     jamais peindre une ville sans designation-zone comme « 100 % cohérente ».
 *   - E2 zone↔grille (rappel, LOT2) : codes de zone COMMUNS entre
 *     `qc-zonage-<slug>` (Z, servi) et `qc-zonage-norms-<slug>` (G, grille de
 *     normes parsée) / |Z|. Reprend EXACTEMENT la méthode du rapport
 *     `docs/reports/coherence-zones-normes-focus30_2026-07.md`. `zoneGrid`
 *     N'EST PAS encore inclus dans le tri-état global `state`/`blockers`
 *     (E0/E1 uniquement à ce lot, cf. `computeConsistencyState`) — c'est une
 *     arête additionnelle affichée séparément ; son intégration au maillon
 *     faible global (seuil 0,80 du design doc) est un lot ultérieur.
 *
 * Design de référence (SOURCE DE VÉRITÉ) :
 *   docs/spec/reports/DESIGN_E2E_CONSISTENCY_SOURCES.md
 */

export type ConsistencyState = "coherent" | "partial" | "unmeasured";
export type ConsistencyMode = "batch-pg" | "unmeasured";
export type EdgeStatus = "measured" | "non_applicable" | "non_mesure";

/**
 * Une métrique num/dénom avec un STATUT explicite.
 *
 * `status: "measured"` ⇒ `rate = num / denom` (denom > 0).
 * `status !== "measured"` ⇒ `rate = null` — un dénominateur vide n'est
 * JAMAIS promu à 1.0 (100 %). `non_applicable` = rien à mesurer pour cette
 * ville (ex. aucun signal publié) ; `non_mesure` = la donnée existe mais le
 * recensement batch (mapper PG) n'a pas encore tourné pour cette ville.
 */
export interface EdgeMetric {
  num: number;
  denom: number;
  rate: number | null;
  status: EdgeStatus;
}

export interface SignalZoneEdge extends EdgeMetric {
  /** Dont matches « fiables » (arête structurée/exacte — cf. RELIABLE_ZONE_MATCH_THRESHOLD). */
  reliableNum: number;
  /** reliableNum / num — null si num = 0 (rien à qualifier). */
  reliableRate: number | null;
  /** Applicabilité anti-100%-trompeur : signaux désignant une zone / signaux publiés. */
  applicability: EdgeMetric;
}

/**
 * Classification honnête DÉDIÉE à l'arête zone↔grille (badge UI) — distincte
 * du tri-état global `ConsistencyState` (E0/E1) :
 *   - `ok`                 : rappel mesuré >= ZONE_GRID_OK_THRESHOLD (50 %).
 *   - `partiel`            : rappel mesuré > 0 mais < seuil.
 *   - `millesime-disjoint` : grille SERVIE (codes présents) mais rappel = 0
 *     exactement — même méthode que le rapport focus-30 (deux millésimes de
 *     zonage disjoints, ex. Mont-Tremblant RA-4xx vs RA-1xx).
 *   - `absente`            : collection `qc-zonage-norms-<slug>` absente
 *     (404) ou vide — rien à mapper côté grille.
 *   - `zonage-absent`      : |Z| = 0 — aucune zone servie pour cette ville,
 *     rien à mesurer (dénominateur vide, JAMAIS promu à 100 %).
 *   - `non_mesure`         : le job batch E2 n'a pas encore mesuré cette
 *     ville (hors scope du dernier run, ou run jamais exécuté).
 */
export type ZoneGridState =
  | "ok"
  | "partiel"
  | "millesime-disjoint"
  | "absente"
  | "zonage-absent"
  | "non_mesure";

export interface ZoneGridEdge extends EdgeMetric {
  /** Classification honnête pour l'affichage (cf. `ZoneGridState`). */
  state: ZoneGridState;
  /**
   * true si au moins un feature de `qc-zonage-<slug>` porte une source
   * contenant "ancien"/"former" (ex. ArcGIS `Ancien_zonage`) — détection
   * EMPIRIQUE sur les properties de la feature (champ `source`/`confidence`),
   * PAS une métadonnée déclarative de collection (aucune n'existe côté OGC).
   * Indépendant du taux de recouvrement mesuré : un zonage flaggé stale peut
   * quand même avoir un rappel > 0.
   */
  staleZoningSource: boolean;
}

export interface CityConsistencyEdges {
  pvSignal: EdgeMetric;
  signalZone: SignalZoneEdge;
  zoneGrid: ZoneGridEdge;
}

export interface CityConsistency {
  citySlug: string;
  mode: ConsistencyMode;
  /** ISO 8601 ; null quand `mode === "unmeasured"` (aucun snapshot pour cette ville). */
  generatedAt: string | null;
  state: ConsistencyState;
  edges: CityConsistencyEdges;
  blockers: string[];
}

// ── Seuils « Cohérent » (design réconcilié, volontairement stricts — le
// mapper actuel (~59 %) doit apparaître « À qualifier », pas « pass ») ────────
export const PV_SIGNAL_COHERENT_THRESHOLD = 0.95;
export const SIGNAL_ZONE_COHERENT_THRESHOLD = 0.85;

/**
 * Seuil `ok` de l'arête zone↔grille (E2), volontairement plus permissif que
 * le seuil « Cohérent » du design doc (0,80, réservé au futur maillon-faible
 * global) — c'est le seuil de LECTURE (badge par ville), repris directement
 * du rapport focus-30 (`docs/reports/coherence-zones-normes-focus30_2026-07.md`,
 * section « Lecture par catégorie » : OK >= 50 %, Partiel < 50 %).
 */
export const ZONE_GRID_OK_THRESHOLD = 0.5;

/**
 * Seuil de confiance « fiable » pour une désignation-zone MATCHÉE : distingue
 * une arête forte (champ structuré `zone_ref` ou match exact, score élevé)
 * d'un repli texte plus incertain (variantes/distance d'édition/city
 * fallback — cf. `match-refs.ts`). Même valeur que `graphGeoConfidence()`
 * (`priority-resolver.ts`) — même distinction arête-forte / repli-texte
 * nommée de façon cohérente à travers le code base.
 */
export const RELIABLE_ZONE_MATCH_THRESHOLD = 0.9;

/** Labels de bloqueur neutres (copy produit, D-anti-jargon — jamais « bug »). */
export const BLOCKER_LABEL = {
  NO_PUBLISHED_SIGNAL: "Aucun signal publié",
  SIGNAL_NO_CITATION: "Signal sans citation",
  NO_ZONE_DESIGNATION: "Aucune zone désignée",
  ZONE_NOT_SERVED: "Zone désignée non servie",
  PG_NOT_PULLED: "PG non pullé",
} as const;

/**
 * Construit une métrique num/dénom. `denom <= 0` ⇒ statut explicite (défaut
 * `non_applicable`) et `rate: null` — JAMAIS un rate=1 fabriqué.
 */
export function computeEdgeMetric(
  num: number,
  denom: number,
  whenEmpty: Exclude<EdgeStatus, "measured"> = "non_applicable",
): EdgeMetric {
  if (denom <= 0) {
    return { num: 0, denom: 0, rate: null, status: whenEmpty };
  }
  return { num, denom, rate: num / denom, status: "measured" };
}

/**
 * Comptes bruts E2 zone↔grille d'UNE ville (batch LIVE OGC, cf.
 * `load-zone-grid-raw.ts`), entrée OPTIONNELLE de `deriveCityConsistency`.
 */
export interface ZoneGridRawInput {
  citySlug: string;
  /** Le job batch E2 a-t-il tenté la mesure OGC pour cette ville (dans le scope du run) ? */
  measured: boolean;
  /** |Z| — codes de zone DISTINCTS servis par `qc-zonage-<slug>` (0 = zonage absent/non servi). */
  zoneCodeCount: number;
  /** La collection `qc-zonage-norms-<slug>` a-t-elle été trouvée (pas de 404) ? */
  gridCollectionFound: boolean;
  /** |G| — codes DISTINCTS portés par `qc-zonage-norms-<slug>` (0 si trouvée mais vide). */
  gridCodeCount: number;
  /** |Z ∩ G| — codes communs (numérateur du rappel E2). */
  matchedCodeCount: number;
  /** cf. `ZoneGridEdge.staleZoningSource`. */
  staleZoningSource: boolean;
}

/** Ville/arête E2 jamais ciblée par un run batch (défaut sûr, non_mesure). */
export const UNMEASURED_ZONE_GRID: ZoneGridEdge = {
  num: 0,
  denom: 0,
  rate: null,
  status: "non_mesure",
  state: "non_mesure",
  staleZoningSource: false,
};

/**
 * Dérive l'arête `zoneGrid` (E2) depuis les comptes bruts OGC d'UNE ville.
 * Reprend EXACTEMENT la méthode du rapport focus-30 : rappel = |Z∩G| / |Z|,
 * dénominateur EXPLICITE (Z vide -> non_applicable, JAMAIS un rate=1 fabriqué),
 * grille absente (404/vide) -> mesure honnête à 0 (un vrai zéro, pas une
 * absence de mesure), rappel mesuré = 0 exactement alors que la grille EST
 * servie -> `millesime-disjoint` (deux millésimes de zonage disjoints, PAS
 * une erreur applicative).
 */
export function deriveZoneGridEdge(input: ZoneGridRawInput): ZoneGridEdge {
  if (!input.measured) {
    return { ...UNMEASURED_ZONE_GRID, staleZoningSource: input.staleZoningSource };
  }
  if (input.zoneCodeCount <= 0) {
    return {
      num: 0,
      denom: 0,
      rate: null,
      status: "non_applicable",
      state: "zonage-absent",
      staleZoningSource: input.staleZoningSource,
    };
  }

  const denom = input.zoneCodeCount;
  const gridServed = input.gridCollectionFound && input.gridCodeCount > 0;
  if (!gridServed) {
    // Zonage servi (Z non vide) mais rien à mapper côté grille : mesure
    // honnête à 0 (rate=0 mesuré), PAS un statut non-mesuré.
    return {
      num: 0,
      denom,
      rate: 0,
      status: "measured",
      state: "absente",
      staleZoningSource: input.staleZoningSource,
    };
  }

  const num = input.matchedCodeCount;
  const rate = num / denom;
  const state: ZoneGridState =
    num === 0
      ? "millesime-disjoint"
      : rate >= ZONE_GRID_OK_THRESHOLD
        ? "ok"
        : "partiel";

  return { num, denom, rate, status: "measured", state, staleZoningSource: input.staleZoningSource };
}

/** Comptes bruts d'UNE ville (batch PG), entrée de `deriveCityConsistency`. */
export interface CityConsistencyRawInput {
  citySlug: string;
  /** Signal+DesignationEvent publiés (même compte que la couverture E0). */
  publishedSignals: number;
  /** Dont porteurs d'une citation/extrait vérifiable (E0, `signals.withCitation`). */
  groundedSignals: number;
  /**
   * Le mapper #74 (geo_resolutions ∪ geo_unresolved) a-t-il déjà traité cette
   * ville ? `false` ⇒ aucune ligne (résolue ou non) pour la ville : le
   * mapper n'a jamais tourné dessus (`non_mesure`), à distinguer du cas
   * « mapper tourné, zéro désignation-zone trouvée » (`non_applicable`).
   */
  zoneChainMapped: boolean;
  /** Désignations-zone matchées à une zone SERVIE/courante (même ville, géométrie non nulle). */
  matchedZoneDesignations: number;
  /** Dont matches « fiables » (score_confiance >= RELIABLE_ZONE_MATCH_THRESHOLD). */
  reliableMatchedZoneDesignations: number;
  /** Dénominateur E1 : toutes les désignations-zone (score >= seuil d'extraction), résolues ou non. */
  zoneDesignations: number;
  /** Signaux DISTINCTS portant ≥ 1 désignation-zone (numérateur de l'applicabilité). */
  zoneDesignatingSignals: number;
}

/**
 * Tri-état MAILLON FAIBLE (bottleneck) — JAMAIS une moyenne :
 *   - `unmeasured` : aucun signal publié pour la ville — rien du tout à
 *     mesurer dans la chaîne E2E.
 *   - `partial`    : au moins une mesure réelle existe (E0) mais la chaîne
 *     est bloquée (mapper géo non pullé) OU l'un des seuils n'est pas
 *     atteint.
 *   - `coherent`   : les arêtes APPLICABLES/MESURÉES passent leur seuil (une
 *     arête `non_applicable` ne bloque pas — elle est hors périmètre pour
 *     cette ville, pas un échec).
 */
export function computeConsistencyState(
  pvSignal: EdgeMetric,
  signalZone: EdgeMetric,
): ConsistencyState {
  if (pvSignal.status !== "measured") {
    // Aucun signal publié : rien de mesurable dans la chaîne pour cette ville.
    return "unmeasured";
  }
  if (signalZone.status === "non_mesure") {
    // E0 a une mesure réelle mais le mapper géo n'a pas tourné : chaîne
    // bloquée à l'arête zone, pas « rien mesuré ».
    return "partial";
  }
  const pvOk = pvSignal.rate! >= PV_SIGNAL_COHERENT_THRESHOLD;
  const zoneOk =
    signalZone.status !== "measured" ||
    signalZone.rate! >= SIGNAL_ZONE_COHERENT_THRESHOLD;
  return pvOk && zoneOk ? "coherent" : "partial";
}

/** Bloqueur(s) neutre(s) expliquant l'état — jamais « bug » sans preuve. */
export function computeBlockers(
  pvSignal: EdgeMetric,
  signalZone: EdgeMetric,
): string[] {
  const blockers: string[] = [];

  if (pvSignal.status === "non_applicable") {
    blockers.push(BLOCKER_LABEL.NO_PUBLISHED_SIGNAL);
    return blockers; // rien d'autre n'est mesurable derrière ce prérequis
  }
  if (pvSignal.status === "measured" && pvSignal.rate! < PV_SIGNAL_COHERENT_THRESHOLD) {
    blockers.push(BLOCKER_LABEL.SIGNAL_NO_CITATION);
  }

  if (signalZone.status === "non_mesure") {
    blockers.push(BLOCKER_LABEL.PG_NOT_PULLED);
  } else if (signalZone.status === "non_applicable") {
    blockers.push(BLOCKER_LABEL.NO_ZONE_DESIGNATION);
  } else if (
    signalZone.status === "measured" &&
    signalZone.rate! < SIGNAL_ZONE_COHERENT_THRESHOLD
  ) {
    blockers.push(BLOCKER_LABEL.ZONE_NOT_SERVED);
  }

  return blockers;
}

/**
 * Dérive le contrat `CityConsistency` depuis les comptes bruts d'UNE ville.
 *
 * `zoneGridInput` (E2, LOT2) est OPTIONNEL et rétro-compatible : omis, la
 * ville ressort honnêtement `non_mesure` sur `edges.zoneGrid` (aucun appelant
 * E0/E1 existant n'a besoin d'être mis à jour).
 */
export function deriveCityConsistency(
  input: CityConsistencyRawInput,
  generatedAt: string,
  zoneGridInput?: ZoneGridRawInput,
): CityConsistency {
  const pvSignal = computeEdgeMetric(input.groundedSignals, input.publishedSignals);

  let signalZoneBase: EdgeMetric;
  if (!input.zoneChainMapped) {
    signalZoneBase = { num: 0, denom: 0, rate: null, status: "non_mesure" };
  } else if (input.zoneDesignations <= 0) {
    signalZoneBase = { num: 0, denom: 0, rate: null, status: "non_applicable" };
  } else {
    signalZoneBase = {
      num: input.matchedZoneDesignations,
      denom: input.zoneDesignations,
      rate: input.matchedZoneDesignations / input.zoneDesignations,
      status: "measured",
    };
  }

  const reliableRate =
    signalZoneBase.status === "measured" && input.matchedZoneDesignations > 0
      ? input.reliableMatchedZoneDesignations / input.matchedZoneDesignations
      : null;

  const applicability = computeEdgeMetric(
    input.zoneDesignatingSignals,
    input.publishedSignals,
  );

  const signalZone: SignalZoneEdge = {
    ...signalZoneBase,
    reliableNum:
      signalZoneBase.status === "measured" ? input.reliableMatchedZoneDesignations : 0,
    reliableRate,
    applicability,
  };

  const zoneGrid = deriveZoneGridEdge(
    zoneGridInput ?? {
      citySlug: input.citySlug,
      measured: false,
      zoneCodeCount: 0,
      gridCollectionFound: false,
      gridCodeCount: 0,
      matchedCodeCount: 0,
      staleZoningSource: false,
    },
  );

  return {
    citySlug: input.citySlug,
    mode: "batch-pg",
    generatedAt,
    state: computeConsistencyState(pvSignal, signalZone),
    edges: { pvSignal, signalZone, zoneGrid },
    blockers: computeBlockers(pvSignal, signalZone),
  };
}

/**
 * Ville sans snapshot du tout (jamais ciblée par un run batch, ou run pas
 * encore exécuté) : honnête, `Non mesuré` — jamais un faux zéro/vert.
 */
export function unmeasuredCityConsistency(citySlug: string): CityConsistency {
  const notMeasured: EdgeMetric = { num: 0, denom: 0, rate: null, status: "non_mesure" };
  return {
    citySlug,
    mode: "unmeasured",
    generatedAt: null,
    state: "unmeasured",
    edges: {
      pvSignal: notMeasured,
      signalZone: {
        ...notMeasured,
        reliableNum: 0,
        reliableRate: null,
        applicability: notMeasured,
      },
      zoneGrid: UNMEASURED_ZONE_GRID,
    },
    blockers: [],
  };
}
