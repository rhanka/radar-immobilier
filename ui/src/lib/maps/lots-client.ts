/**
 * Client for OGC lots collections exposed at /api/geo/collections.
 *
 * Retourne un FeatureCollection GeoJSON de lots cadastraux réels (MRNF)
 * pour une ville.  Propriétés exposées : uniquement `noLot`, `citySlug`
 * et `potentialScore` (Loi 25 — aucune PII, aucun propriétaire).
 *
 * Lorsque la ville n'a pas de source lots (ok=false) on retourne
 * un FeatureCollection vide plutôt que de lever, sauf si
 * opts.throwOnEmpty=true.
 *
 * CS-L2 : `potentialScore` (0–10) est retourné par l'API (PR #165).
 * Échelle DISTINCTE du 0-5 T2 et du 0-100 legacy.
 * Quand non disponible (endpoint non enrichi) : undefined.
 */
import { resolveLotPotentialScore } from "./lot-potential-visual.js";
import {
  featureProof,
  zoneLotProvenance,
  type FeatureProof,
  type ImmoZoneLotProvenance,
} from "./geo-provenance.js";
import { fetchWithTimeout } from "$lib/net/fetch-with-timeout.js";

/** Properties d'un lot cadastral (uniquement données publiques non-PII). */
export interface LotProperties {
  noLot: string;
  citySlug?: string;
  /** Opaque geo envelope, preserved verbatim when supplied. */
  proof?: FeatureProof;
  /** Opaque geo envelope, preserved verbatim when supplied. */
  immo_zone_lot_provenance?: ImmoZoneLotProvenance;
  /**
   * Score de potentiel par lot (0–10, échelle distincte du 0-5 T2 et du 0-100 legacy).
   * Calculé à partir de ZoneVersion.densiteLogHa, kind, usages, TOD.
   * undefined si l'endpoint ne l'a pas encore enrichi.
   * Source historique : /api/geo/:city/lots (feat/api-score-potentiel-lot).
   * Source prod actuelle : /api/geo/collections/qc-lots-{city}/items.
   */
  potentialScore?: number | null;
  /** État de résolution du score visuel. */
  potentialScoreStatus?: "scored" | "fallback" | "unavailable";
  /** Source de résolution du score visuel. */
  potentialScoreSource?: "api" | "zone" | "flags" | "none";
  /** Explication courte du score/fallback. */
  potentialScoreReason?: string;
  /** Mode de la source (carte-steve uniquement). */
  mode?: string;
  /** Flag emprise de rue — carte-steve uniquement. */
  isRue?: boolean;
  /** Flag dans périmètre TOD — carte-steve uniquement. */
  tod?: boolean;
  /** Flag multifamilial 4+ — carte-steve uniquement. */
  multifamilial4plus?: boolean;
  /**
   * Source honnête du flag 4+ quand l'API l'expose ("grille" = norme extraite
   * de la grille de zonage ; "heuristique" = dérivation par type de zone).
   */
  multifamilial4plusSource?: string | null;
  /** Flag priorité calculé par la source (carte-steve) quand exposé. */
  priorite?: boolean | null;
  /**
   * Adresse civique du LOT (donnée publique du rôle d'évaluation) quand la
   * source l'expose. Identifie la propriété, pas une personne — aucun nom de
   * propriétaire n'est jamais exposé (Loi 25).
   */
  adresse?: string | null;
  /**
   * Code postal du lot servi par geo en FSA 3 caractères (ex. « J3Y » —
   * secteur postal, PAS le code 6 caractères licencié Postes Canada).
   * Affiché tel quel ; « — » quand non servi.
   */
  codePostal?: string | null;
  /**
   * Façade du lot (m). La valeur CANONIQUE servie par geo (`frontage_m`)
   * prime ; à défaut la `facade_m` mesurée par la source. La fiche l'affiche
   * sans mention « estimée » ; quand absente, l'UI retombe sur l'estimation
   * géométrique (`estimatedFacadeM`), étiquetée comme telle.
   */
  facadeM?: number | null;
  /** Profondeur mesurée par la source (m) quand exposée. */
  profondeurM?: number | null;
  /**
   * Superficie RÉELLE du lot en m² : `surface_m2` servie par geo (aire du
   * polygone, ~100 % des lots), sinon `superficie_m2_calculee` de la source.
   */
  superficieM2?: number | null;
  /** Usage public résolu quand disponible; null sinon. */
  usageCode?: string | null;
  /** Champs publics du rôle d'évaluation quand l'API geo les expose. */
  valuation?: {
    usageCode?: string | null;
    categorie?: string | null;
    valeurTotale?: number | null;
    valeurTerrain?: number | null;
    valeurBatiment?: number | null;
    nbLogements?: number | null;
    nbEtages?: number | null;
    anneeConstruction?: number | null;
  } | null;
  /**
   * Normes de zonage VERBATIM portées par le lot quand la source geo les
   * expose (normes foldées par lot via `zone_code` : hauteur max, étages,
   * marges min, densité, façade min, superficie min). geo les sert en paires
   * `<norme>_value`/`<norme>_unit` (verbatim-or-null) ; valeurs telles
   * qu'extraites — aucune conversion inventée ; null/absent quand la grille
   * n'est pas extraite. NE PAS confondre `superficieMin` (NORME de zonage)
   * avec `superficieM2` (aire réelle `surface_m2`), ni `frontageMin` (norme)
   * avec `facadeM` (façade réelle `frontage_m`).
   */
  normes?: {
    hauteur?: string | null;
    etages?: string | null;
    margeAvant?: string | null;
    margeArriere?: string | null;
    margeLaterale?: string | null;
    densite?: string | null;
    /** Façade MIN normée (norme de grille — distincte de la façade réelle). */
    frontageMin?: string | null;
    /** Superficie MIN normée (norme de grille — distincte de l'aire réelle). */
    superficieMin?: string | null;
  } | null;
  /** Zone résolue pour le lot quand disponible; null sinon. */
  zone?: {
    kind: string;
    usages: string[];
    densiteLogHa: number | null;
    code?: string | null;
    grillePdfUrl?: string | null;
    /**
     * Provenance du règlement en vigueur qui porte la norme (zone de norme,
     * servie par geo via `qc-zonage-norms-<slug>`). Valeurs RÉELLES — null
     * quand la source ne les porte pas ; jamais devinées. La fiche affiche
     * « Règl. {numero} ({millesime}) » + lien source, ou « Règlement non
     * renseigné » quand le numéro est absent.
     */
    reglementNumero?: string | null;
    reglementMillesime?: number | null;
    reglementPageSource?: string | null;
    reglementUrl?: string | null;
    /**
     * Usage dominant RÉEL de la zone servi par geo (`qc-zonage-<slug>`, mesuré
     * live sur 222 villes) — passthrough d'affichage, null quand la source ne
     * le porte pas (jamais une classification dérivée). La fiche l'affiche
     * « Usage dominant : {valeur} » (+ sa source quand servie).
     */
    usageDominant?: string | null;
    /** Source du usage dominant (ex. « zone-nomenclature ») quand servie. */
    usageDominantSource?: string | null;
  } | null;
  /** Raw zone code/group from an OGC lot collection when present. */
  zoneCode?: string | null;
  /**
   * Description verbatim de la zone portée par le lot quand la source
   * l'expose (ex. « Min 16 log · 6 étages · Mixte »). Texte tel quel.
   */
  zoneDescription?: string | null;
  /** Lien direct vers la grille PDF quand exposé hors objet zone. */
  grillePdfUrl?: string | null;
  /**
   * Identifiant de version du lot cadastral, requis pour le marquage prospect
   * (clé du mark côté API). Présent quand la collection OGC l'expose
   * (`lotVersionId` / `lot_version_id`) ; absent sinon → marquage marks désactivé.
   */
  lotVersionId?: string | null;
  /** UI-derived projection state for signal mode; not persisted by the API. */
  signalProjection?: "direct" | "inherited" | "none";
  /** UI-derived : lot SÉLECTIONNÉ (exergue orange C3) — jamais persisté. */
  isSelected?: boolean;
}

export interface LotGeometry {
  type: string;
  coordinates: unknown;
}

export interface LotFeature {
  type: "Feature";
  geometry: LotGeometry | null;
  properties: LotProperties;
}

export interface LotFeatureCollection {
  type: "FeatureCollection";
  features: LotFeature[];
}

export interface LotsResponse {
  ok: boolean;
  citySlug: string;
  source: "donnees-quebec" | "carte-steve" | "none";
  /** Mode de la source (carte-steve uniquement). */
  mode?: "carte-steve" | "donnees-quebec";
  /** Raison de l'échec (ok=false seulement). */
  reason?: string;
  /** OGC collection id when loaded from the live geo API. */
  collectionId?: string;
  /** OGC total match count. May be greater than the loaded features length. */
  numberMatched?: number;
  /** OGC returned feature count for the current page. */
  numberReturned?: number;
  featureCollection: LotFeatureCollection;
}

export interface FetchLotsOptions {
  limit?: number;
  /** Décalage OGC (pagination multi-pages, cf. fetchAllLots). */
  offset?: number;
  bbox?: [number, number, number, number];
  baseUrl?: string;
  /** Signal d'annulation externe (anti-course au changement de ville). */
  signal?: AbortSignal;
  /** Timeout requête (ms). Défaut : `DEFAULT_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
}

interface OgcFeatureCollection {
  type: "FeatureCollection";
  features: unknown[];
  numberMatched?: number;
  numberReturned?: number;
}

const EMPTY_LOTS: LotFeatureCollection = { type: "FeatureCollection", features: [] };

export function lotsCollectionId(citySlug: string): string {
  return `qc-lots-${citySlug}`;
}

export function resolveLotsUrl(
  citySlug: string,
  opts: FetchLotsOptions = {},
): string {
  const baseUrl = opts.baseUrl ?? import.meta.env.VITE_API_BASE_URL ?? "";
  const base = baseUrl ? baseUrl.replace(/\/$/, "") : "";
  const path = `/api/geo/collections/${encodeURIComponent(lotsCollectionId(citySlug))}/items`;
  const params = new URLSearchParams();
  if (opts.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts.offset !== undefined && opts.offset > 0) {
    params.set("offset", String(opts.offset));
  }
  if (opts.bbox) params.set("bbox", opts.bbox.join(","));
  const qs = params.toString();
  return `${base}${path}${qs ? `?${qs}` : ""}`;
}

/**
 * Charge les lots cadastraux d'une ville depuis l'API OGC live.
 *
 * - Retourne le FeatureCollection quand ok=true.
 * - Retourne { ok:false, featureCollection:{features:[]} } quand aucune
 *   collection `qc-lots-{citySlug}` n'existe — pas de faux compteur à 0.
 * - Lève en cas d'erreur réseau ou HTTP non-2xx hors collection absente.
 */
export async function fetchLots(
  citySlug: string,
  opts: FetchLotsOptions = {},
): Promise<LotsResponse> {
  const url = resolveLotsUrl(citySlug, opts);
  const res = await fetchWithTimeout(url, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });
  const collectionId = lotsCollectionId(citySlug);
  if (res.status === 404) {
    return {
      ok: false,
      citySlug,
      source: "none",
      reason: `Collection lots non configurée dans l'API geo : ${collectionId}`,
      collectionId,
      numberMatched: 0,
      numberReturned: 0,
      featureCollection: EMPTY_LOTS,
    };
  }
  if (!res.ok) {
    throw new Error(`lots HTTP ${res.status} for ${citySlug}`);
  }
  const body = await res.json();
  if (isLegacyLotsResponse(body)) {
    const featureCollection = normalizeFeatureCollection(body.featureCollection, body.citySlug);
    return {
      ...body,
      featureCollection,
      collectionId: body.collectionId ?? collectionId,
      numberMatched: body.numberMatched ?? featureCollection.features.length,
      numberReturned: body.numberReturned ?? featureCollection.features.length,
    };
  }
  if (!isOgcFeatureCollection(body)) {
    throw new Error(`lots: réponse geo inattendue pour ${citySlug}`);
  }

  const features = body.features
    .map((feature) => normalizeOgcLotFeature(feature, citySlug))
    .filter((feature): feature is LotFeature => feature !== null);
  return {
    ok: true,
    citySlug,
    source: "donnees-quebec",
    mode: "donnees-quebec",
    collectionId,
    numberMatched: body.numberMatched ?? features.length,
    numberReturned: body.numberReturned ?? features.length,
    featureCollection: { type: "FeatureCollection", features },
  };
}

export interface FetchAllLotsOptions extends Omit<FetchLotsOptions, "limit" | "offset"> {
  /**
   * Taille de page demandée. Grande par défaut (10 000) : le store local sert
   * TOUT en une page (il ignore `offset`), et un serveur OGC qui plafonne
   * (ex. 1 000) déclenche la pagination par `offset` ci-dessous.
   */
  pageLimit?: number;
  /** Garde-fou : nombre maximal de pages chargées. */
  maxPages?: number;
  /**
   * Callback de chargement PROGRESSIF : reçoit après chaque page la réponse
   * FUSIONNÉE (features dédupliquées par noLot) — la carte peut peindre au fil
   * de l'eau sans attendre la dernière page.
   */
  onPage?: (partial: LotsResponse, pageIndex: number) => void;
}

/**
 * Charge TOUS les lots d'une ville (C8 — parité référence : la carte affiche
 * l'intégralité, pas une page de 500).
 *
 * Stratégie multi-pages tolérante aux deux serveurs réels :
 *  - store local API : ignore `offset` mais sert tout sous `pageLimit` → une
 *    seule page suffit ; si une page suivante ne produit AUCUN lot nouveau
 *    (offset ignoré), on s'arrête — jamais de boucle infinie ;
 *  - passthrough OGC : plafonne `limit` côté upstream → pages successives par
 *    `offset = nb de lots fusionnés`, jusqu'à `numberMatched`.
 *
 * Les pages sont FUSIONNÉES avec déduplication par `noLot` (clé d'identité des
 * couches carto et des matchs MapLibre). L'annulation (signal) et le timeout
 * de `fetchLots` s'appliquent à chaque page — une réponse périmée lève et le
 * garde anti-course de l'appelant l'ignore.
 */
export async function fetchAllLots(
  citySlug: string,
  opts: FetchAllLotsOptions = {},
): Promise<LotsResponse> {
  const pageLimit = opts.pageLimit ?? 10_000;
  const maxPages = opts.maxPages ?? 30;
  const seen = new Set<string>();
  const merged: LotFeature[] = [];
  let last: LotsResponse | null = null;

  for (let page = 0; page < maxPages; page++) {
    const res = await fetchLots(citySlug, {
      ...opts,
      limit: pageLimit,
      offset: merged.length,
    });
    // Ville sans collection (ok=false) : réponse honnête telle quelle en
    // première page ; sinon on garde ce qui est déjà fusionné.
    if (!res.ok) {
      if (page === 0) return res;
      break;
    }
    let added = 0;
    for (const feature of res.featureCollection.features) {
      const noLot = feature.properties.noLot;
      if (seen.has(noLot)) continue;
      seen.add(noLot);
      merged.push(feature);
      added += 1;
    }
    last = res;
    const snapshot = mergedSnapshot(res, merged);
    opts.onPage?.(snapshot, page);
    const matched = res.numberMatched ?? merged.length;
    const pageIsFull = res.featureCollection.features.length >= pageLimit;
    // Stop : page sans nouveauté (offset ignoré / fin réelle), ou total atteint
    // sur une page non pleine (une page pleine peut cacher une suite).
    if (added === 0) break;
    if (merged.length >= matched && !pageIsFull) break;
  }

  if (!last) {
    return {
      ok: false,
      citySlug,
      source: "none",
      reason: "Aucune page de lots chargée.",
      collectionId: lotsCollectionId(citySlug),
      numberMatched: 0,
      numberReturned: 0,
      featureCollection: EMPTY_LOTS,
    };
  }
  return mergedSnapshot(last, merged);
}

/** Réponse fusionnée : features dédupliquées + compteurs honnêtes. */
function mergedSnapshot(base: LotsResponse, merged: LotFeature[]): LotsResponse {
  return {
    ...base,
    featureCollection: { type: "FeatureCollection", features: [...merged] },
    numberReturned: merged.length,
    numberMatched: Math.max(base.numberMatched ?? 0, merged.length),
  };
}

function isLegacyLotsResponse(value: unknown): value is LotsResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<LotsResponse>;
  return (
    typeof candidate.ok === "boolean" &&
    typeof candidate.citySlug === "string" &&
    typeof candidate.source === "string" &&
    candidate.featureCollection?.type === "FeatureCollection" &&
    Array.isArray(candidate.featureCollection.features)
  );
}

function isOgcFeatureCollection(value: unknown): value is OgcFeatureCollection {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<OgcFeatureCollection>;
  return candidate.type === "FeatureCollection" && Array.isArray(candidate.features);
}

function normalizeOgcLotFeature(feature: unknown, citySlug: string): LotFeature | null {
  if (typeof feature !== "object" || feature === null) return null;
  const raw = feature as {
    type?: unknown;
    geometry?: unknown;
    properties?: Record<string, unknown> | null;
  };
  if (raw.type !== "Feature") return null;
  const properties = raw.properties ?? {};
  const noLot = readString(properties.noLot) ?? readString(properties.NO_LOT) ?? readString(properties.code);
  if (!noLot) return null;

  return {
    type: "Feature",
    geometry: normalizeGeometry(raw.geometry),
    properties: {
      noLot,
      citySlug,
      ...normalizeOgcLotProperties(properties),
    },
  };
}

function normalizeFeatureCollection(
  collection: LotFeatureCollection,
  citySlug: string,
): LotFeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features
      .map((feature) => normalizeExistingLotFeature(feature, citySlug))
      .filter((feature): feature is LotFeature => feature !== null),
  };
}

function normalizeExistingLotFeature(feature: LotFeature, citySlug: string): LotFeature | null {
  const noLot = readString(feature.properties.noLot);
  if (!noLot) return null;
  return {
    type: "Feature",
    geometry: normalizeGeometry(feature.geometry),
    properties: {
      noLot,
      citySlug: feature.properties.citySlug ?? citySlug,
      ...normalizeOgcLotProperties({ ...feature.properties, noLot }),
    },
  };
}

function normalizeOgcLotProperties(properties: Record<string, unknown>): Partial<LotProperties> {
  const proof = featureProof(properties.proof);
  const immoZoneLotProvenance = zoneLotProvenance(properties.immo_zone_lot_provenance);
  const potentialScore = firstNumber([
    properties.potentialScore,
    properties.potential_score,
    properties.score,
  ]);
  const mode = readString(properties.mode);
  const isRue = firstBoolean([properties.isRue, properties.is_rue]);
  const tod = firstBoolean([properties.tod, properties.inTod, properties.in_tod]);
  const multifamilial4plus = firstBoolean([
    properties.multifamilial4plus,
    properties.multifamilial_4plus,
  ]);
  const multifamilial4plusSource = firstString([
    properties.multifamilial4plusSource,
    properties.multifamilial_4plus_source,
  ]);
  const priorite = firstBoolean([properties.priorite, properties.priority]);
  // Superficie RÉELLE du lot servie par geo : `surface_m2` (aire du polygone,
  // m², ~100 % des lots). `superficie_m2` était un nom MORT (jamais servi par
  // geo — bug de mapping #350) : il n'est plus lu. Repli honnête sur la
  // `superficie_m2_calculee` de la source quand geo ne sert rien.
  const superficieM2 = firstNumber([
    properties.superficieM2,
    properties.surface_m2,
    properties.superficie_m2_calculee,
  ]);
  // Adresse civique du lot (rôle public) — jamais de nom de propriétaire.
  const adresse = firstString([
    properties.adresse,
    properties.address,
    properties.adresse_civique,
    properties.adresseCivique,
  ]);
  // Code postal servi par geo en FSA 3 caractères (ex. « J3Y » — secteur,
  // PAS le code 6 caractères licencié Postes Canada) — affiché tel quel.
  const codePostal = firstString([
    properties.codePostal,
    properties.code_postal,
    properties.postalCode,
    properties.postal_code,
  ]);
  // Façade : la valeur CANONIQUE geo (`frontage_m`) prime sur la `facade_m`
  // de la source — affichée sans « estimée » dès que geo la sert.
  const facadeM = firstNumber([
    properties.frontageM,
    properties.frontage_m,
    properties.facadeM,
    properties.facade_m,
  ]);
  const profondeurM = firstNumber([properties.profondeurM, properties.profondeur_m]);
  const usageCode = firstString([
    properties.usageCode,
    properties.usage_code,
    properties.cubf,
  ]);
  const valuation = normalizeValuation(properties.valuation, usageCode, properties);
  const zone = normalizeZone(properties.zone, properties);
  const normes = normalizeNormes(properties.normes ?? properties.norms, properties);
  const rawZoneCode = firstString([
    properties.zoneCode,
    properties.zone_code,
    properties.zoneCodeRaw,
    properties.zone_code_raw,
    typeof properties.zone === "string" ? properties.zone : null,
  ]) ?? zone?.code ?? null;
  // Placeholders "pas de zone" fréquents dans les sources → null honnête.
  const zoneCode = rawZoneCode && ["N/D", "ND", "N/A", "NA", "-"].includes(rawZoneCode.toUpperCase())
    ? null
    : rawZoneCode;
  const zoneDescription = firstString([
    properties.zoneDescription,
    properties.zone_description,
    properties.zoneDesc,
    properties.zone_desc,
  ]);
  const grillePdfUrl = firstString([
    properties.grillePdfUrl,
    properties.grille_pdf_url,
    properties.gridPdfUrl,
    properties.grid_pdf_url,
    properties.zoningGridPdfUrl,
    properties.zoning_grid_pdf_url,
  ]) ?? zone?.grillePdfUrl ?? null;
  // Réservé (marquage prospect/marques) — extrait mais pas encore câblé au retour.
  const _lotVersionId = firstString([
    properties.lotVersionId,
    properties.lot_version_id,
  ]);
  const scoreResolution = resolveLotPotentialScore({
    ...properties,
    ...(potentialScore !== null ? { potentialScore } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(zoneCode !== null ? { zoneCode } : {}),
    ...(tod !== null ? { tod } : {}),
    ...(multifamilial4plus !== null ? { multifamilial4plus } : {}),
  });

  return {
    ...(proof ? { proof } : {}),
    ...(immoZoneLotProvenance ? { immo_zone_lot_provenance: immoZoneLotProvenance } : {}),
    potentialScore: scoreResolution.score,
    potentialScoreStatus: scoreResolution.status,
    potentialScoreSource: scoreResolution.source,
    potentialScoreReason: scoreResolution.reason,
    ...(mode !== null ? { mode } : {}),
    ...(isRue !== null ? { isRue } : {}),
    ...(tod !== null ? { tod } : {}),
    ...(multifamilial4plus !== null ? { multifamilial4plus } : {}),
    ...(multifamilial4plusSource !== null ? { multifamilial4plusSource } : {}),
    ...(priorite !== null ? { priorite } : {}),
    ...(adresse !== null ? { adresse } : {}),
    ...(codePostal !== null ? { codePostal } : {}),
    ...(facadeM !== null ? { facadeM } : {}),
    ...(profondeurM !== null ? { profondeurM } : {}),
    ...(superficieM2 !== null ? { superficieM2 } : {}),
    ...(usageCode !== null ? { usageCode } : {}),
    ...(valuation !== undefined ? { valuation } : {}),
    ...(normes !== undefined ? { normes } : {}),
    ...(zone !== undefined ? { zone } : {}),
    ...(zoneCode !== null ? { zoneCode } : {}),
    ...(zoneDescription !== null ? { zoneDescription } : {}),
    ...(grillePdfUrl !== null ? { grillePdfUrl } : {}),
  };
}

function normalizeZone(
  value: unknown,
  fallback: Record<string, unknown> = {},
): LotProperties["zone"] | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
  const kind = firstString([record.kind, record.zoneKind, record.zone_kind, record.typeZone, record.type_zone]);
  const code = firstString([record.code, record.zoneCode, record.zone_code, fallback.zoneCode, fallback.zone_code]);
  const densiteLogHa = firstNumber([
    record.densiteLogHa,
    record.densite_log_ha,
    record.densityLogHa,
    record.density_log_ha,
    fallback.densiteLogHa,
    fallback.densite_log_ha,
  ]);
  const rawUsages = Array.isArray(record.usages)
    ? record.usages
    : Array.isArray(record.uses)
      ? record.uses
      : [];
  const grillePdfUrl = firstString([
    record.grillePdfUrl,
    record.grille_pdf_url,
    record.gridPdfUrl,
    record.grid_pdf_url,
    fallback.grillePdfUrl,
    fallback.grille_pdf_url,
  ]);
  // Provenance du règlement porteur (zone de norme) — verbatim-or-null, jamais
  // devinée. Numéro/URL en chaîne, millésime en nombre, page verbatim.
  const reglementNumero = firstString([
    record.reglementNumero,
    record.reglement_numero,
    fallback.reglementNumero,
    fallback.reglement_numero,
  ]);
  const reglementMillesime = firstNumber([
    record.reglementMillesime,
    record.reglement_millesime,
    fallback.reglementMillesime,
    fallback.reglement_millesime,
  ]);
  const reglementPageSource = firstVerbatim([
    record.reglementPageSource,
    record.reglement_page_source,
    fallback.reglementPageSource,
    fallback.reglement_page_source,
  ]);
  const reglementUrl = firstString([
    record.reglementUrl,
    record.reglement_url,
    fallback.reglementUrl,
    fallback.reglement_url,
  ]);
  // Usage dominant servi par geo (`qc-zonage-<slug>`) — passthrough d'affichage,
  // null quand absent (jamais une classification dérivée).
  const usageDominant = firstString([
    record.usageDominant,
    record.usage_dominant,
    fallback.usageDominant,
    fallback.usage_dominant,
  ]);
  const usageDominantSource = firstString([
    record.usageDominantSource,
    record.usage_dominant_source,
    fallback.usageDominantSource,
    fallback.usage_dominant_source,
  ]);

  if (
    !kind &&
    !code &&
    densiteLogHa === null &&
    rawUsages.length === 0 &&
    !grillePdfUrl &&
    !reglementNumero &&
    reglementMillesime === null &&
    !reglementPageSource &&
    !reglementUrl &&
    !usageDominant &&
    !usageDominantSource
  )
    return undefined;
  return {
    kind: kind ?? "non précisé",
    usages: rawUsages.map(String),
    densiteLogHa,
    ...(code !== null ? { code } : {}),
    ...(grillePdfUrl !== null ? { grillePdfUrl } : {}),
    ...(reglementNumero !== null ? { reglementNumero } : {}),
    ...(reglementMillesime !== null ? { reglementMillesime } : {}),
    ...(reglementPageSource !== null ? { reglementPageSource } : {}),
    ...(reglementUrl !== null ? { reglementUrl } : {}),
    ...(usageDominant !== null ? { usageDominant } : {}),
    ...(usageDominantSource !== null ? { usageDominantSource } : {}),
  };
}

/**
 * Normes de zonage VERBATIM (grille) — extraction tolérante.
 *
 * Les champs peuvent arriver dans un objet `normes` dédié ou à plat sur les
 * properties selon la source geo. Les valeurs sont gardées TELLES QUELLES
 * (texte verbatim de la grille) ; un nombre est rendu en chaîne, rien n'est
 * converti ni interprété. undefined quand aucune norme n'est exposée.
 */
function normalizeNormes(
  value: unknown,
  fallback: Record<string, unknown> = {},
): LotProperties["normes"] | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
  // Contrat geo (normes foldées par lot via zone_code, verbatim-or-null) :
  // paires `<norme>_value` (+ `<norme>_unit` quand l'unité est servie) — la
  // paire geo PRIME sur les anciens noms plats. Aucune valeur inventée.
  const normes = {
    hauteur: normeWithUnit(record, "hauteur_max_value", "hauteur_max_unit")
      ?? firstVerbatim([record.hauteur, record.hauteur_max, record.hauteurMax, record.hauteur_verbatim]),
    etages: firstVerbatim([record.etages, record.etagesMax, record.etages_max, record.nb_etages_max]),
    margeAvant: normeWithUnit(record, "marge_avant_min_value", "marge_avant_min_unit")
      ?? firstVerbatim([record.margeAvant, record.marge_avant, record.marge_avant_m]),
    margeArriere: normeWithUnit(record, "marge_arriere_min_value", "marge_arriere_min_unit")
      ?? firstVerbatim([record.margeArriere, record.marge_arriere, record.marge_arriere_m]),
    margeLaterale: normeWithUnit(record, "marge_laterale_min_value", "marge_laterale_min_unit")
      ?? firstVerbatim([record.margeLaterale, record.marge_laterale, record.marges_laterales]),
    densite: normeWithUnit(record, "densite_value", "densite_unit")
      ?? firstVerbatim([record.densite, record.densite_verbatim, record.densiteLogHa, record.densite_log_ha]),
    // Façade MIN normée — DISTINCTE de la façade réelle `frontage_m`.
    frontageMin: normeWithUnit(record, "frontage_min_value", "frontage_min_unit")
      ?? firstVerbatim([record.frontageMin, record.frontage_min]),
    // Superficie MIN normée — DISTINCTE de l'aire réelle `surface_m2`.
    superficieMin: normeWithUnit(record, "superficie_min_value", "superficie_min_unit")
      ?? firstVerbatim([record.superficieMin, record.superficie_min]),
  };
  return Object.values(normes).some((v) => v !== null) ? normes : undefined;
}

/**
 * Norme geo « valeur + unité » : compose `<norme>_value` avec `<norme>_unit`
 * quand les deux sont servis, la valeur seule sinon (verbatim-or-null —
 * aucune unité inventée). null quand la valeur n'est pas servie.
 */
function normeWithUnit(
  record: Record<string, unknown>,
  valueKey: string,
  unitKey: string,
): string | null {
  const value = firstVerbatim([record[valueKey]]);
  if (value === null) return null;
  const unit = readString(record[unitKey]);
  return unit ? `${value} ${unit}` : value;
}

function normalizeValuation(
  value: unknown,
  fallbackUsageCode: string | null,
  fallback: Record<string, unknown> = {},
): LotProperties["valuation"] | undefined {
  const record = typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : fallback;
  // Candidats supplémentaires : noms de champs BRUTS de la carte de référence
  // CS-L6 (val_totale, nb_logements_role, utilisation…) pour que la fiche ne
  // soit jamais vide quand la source les expose sous ces noms.
  const valuation = {
    usageCode: firstString([record.usageCode, record.usage_code, record.cubf]) ?? fallbackUsageCode,
    categorie: firstString([record.categorie, record.category, record.usageLabel, record.usage_label, record.utilisation]),
    valeurTotale: firstNumber([record.valeurTotale, record.valeur_totale, record.totalValue, record.total_value, record.val_totale]),
    valeurTerrain: firstNumber([record.valeurTerrain, record.valeur_terrain, record.landValue, record.land_value, record.val_terrain]),
    valeurBatiment: firstNumber([record.valeurBatiment, record.valeur_batiment, record.buildingValue, record.building_value, record.val_batiment]),
    nbLogements: firstNumber([record.nbLogements, record.nb_logements, record.logements, record.dwellingCount, record.nb_logements_role]),
    nbEtages: firstNumber([record.nbEtages, record.nb_etages, record.etages, record.floorCount]),
    anneeConstruction: firstNumber([record.anneeConstruction, record.annee_construction, record.yearBuilt, record.year_built]),
  };
  return Object.values(valuation).some((v) => v !== null && v !== undefined) ? valuation : undefined;
}

function normalizeGeometry(value: unknown): LotGeometry | null {
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string" &&
    "coordinates" in value
  ) {
    return value as LotGeometry;
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function firstString(values: readonly unknown[]): string | null {
  for (const value of values) {
    const parsed = readString(value);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** Valeur verbatim : chaîne non vide telle quelle, nombre fini rendu en chaîne. */
function firstVerbatim(values: readonly unknown[]): string | null {
  for (const value of values) {
    const parsed = readString(value);
    if (parsed !== null) return parsed;
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function firstNumber(values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim().length > 0) {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function firstBoolean(values: readonly unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "oui"].includes(normalized)) return true;
      if (["false", "0", "no", "non"].includes(normalized)) return false;
    }
  }
  return null;
}
