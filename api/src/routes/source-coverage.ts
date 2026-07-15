import { Hono } from "hono";
import { and, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { QC_MUNICIPALITIES, getGeoSourceInventory } from "@radar/sources";
import type { ScrapeStatusSourceT, ScrapeStatusT } from "@radar/domain";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { graphNodes, lotVersions, zoneVersions } from "../db/schema.js";
import { listCitiesWithSignalNodes } from "../services/graph/graph-store.js";
import { readAll } from "../services/scrape-status/store.js";
import { mergeWithDerived } from "../services/scrape-status/derive.js";
import { DEFAULT_OGC_BASE_URL } from "../services/geo/ogc-pull.js";
import {
  loadGeoFeatureCollection,
  measureNormesCoverage,
  type GeoNormesError,
} from "../services/geo/normes-keys.js";
import {
  measureCityLotFields,
  type CityLotFieldsResponse,
} from "../services/geo/lot-fields-coverage.js";

/**
 * GET /api/source/coverage — couverture qualité de données par ville,
 * lecture BULK set-based, province-wide (~1104 villes).
 *
 * Honnêteté (D6, anti-survente) : chaque cellule est un TRI-ÉTAT —
 *   - `verified` : substantié LIVE (lignes réelles en base / collection listée
 *                  live par l'API geo / fixture capturée).
 *   - `declared` : déclaré mais NON substantié (statut annoncé, source connue
 *                  mais pas ingérée, aucune ligne en base).
 *   - `absent`   : rien de connu.
 * Jamais de « vert » fabriqué : un layer n'est `verified` que si la preuve est
 * vérifiable au moment de la requête.
 *
 * Réutilise les agrégateurs existants (D5) — pas de job batch, pas de table
 * nouvelle, pas de scan S3 raw live, pas de 1104 appels per-city :
 *   - L1 raw     : statut DÉRIVÉ scrape-status (mergeWithDerived, en mémoire).
 *   - L2 graph   : un GROUP BY city_slug sur graph_nodes.
 *   - Signaux    : un GROUP BY city_slug sur graph_nodes (Signal +
 *                  DesignationEvent) avec la part portant une citation/extrait
 *                  vérifiable (props/citation/excerpt/refs, mêmes clés que la
 *                  route graph-signals) + le compte de signaux PRIORITAIRES
 *                  z∩m∩p par ville (`listCitiesWithSignalNodes`, la MÊME
 *                  classification que la vue Signaux et que la cohorte « 33 »
 *                  de l'axe de reporting — zonage ∩ multifamilial 4+ ∩ précoce).
 *   - L4 zonage / L5 lots : « servi » = la collection `qc-zonage-<slug>` /
 *                  `qc-lots-<slug>` est présente dans le LISTING LIVE de l'API
 *                  geo (`${geo}/collections`, UNE seule requête pour toute la
 *                  province, cache TTL ~10 min) OU une géométrie locale existe
 *                  en base (le store local est prioritaire dans la route
 *                  /api/geo/collections). C'est ce que la carte SERT réellement
 *                  — le PG local seul sous-estimait massivement (70/1106 alors
 *                  que geo sert 500+ zonages). Repli honnête : listing
 *                  injoignable → statut PG local seul (dégradé, jamais de 5xx).
 *   - TOD        : « servi » = collection `qc-tod-<slug>` dans le MÊME listing
 *                  live (aucun store local aujourd'hui) ; listing injoignable →
 *                  `absent` (dégradé honnête, jamais de vert fabriqué).
 *   - Normes     : reprise de la mesure grilles LAZY (endpoint /:citySlug/grilles)
 *                  quand elle est chaude en cache ; sinon `absent` honnête
 *                  (aucune grille prouvée à date — jamais mesuré en bulk).
 * Soit 4 requêtes agrégées set-based + une requête province-wide par nœud
 * signal (classification z/m/p en TS) + une lecture scrape-status + un GET
 * listing geo (caché), point.
 *
 * Statut agrégé par ville (`worstStatus`, couleur carte) — tri-état client :
 *   - « Servi »       (`verified`) : les couches CŒUR (PV, signaux, zonage,
 *                     lots) sont TOUTES substantiées live.
 *   - « Partiel »     (`declared`) : AU MOINS une couche (cœur ou annexe) est
 *                     servie, mais pas toutes les couches cœur.
 *   - « Non couvert » (`absent`)   : aucune couche servie.
 * Les couches annexes (graphe, normes/grilles, TOD — éparses aujourd'hui)
 * comptent pour « Partiel » mais ne bloquent jamais le « Servi » (honnête sans
 * repeindre la province en gris). Voir computeCoverageStatus (unit-testée).
 *
 * GET /api/source/coverage/:citySlug/grilles — détail LAZY par ville :
 * présence de grilles de zonage (grillePdfUrl) / normes (densité, usages) sur
 * les zones SERVIES LIVE par geo. Donnée éparse aujourd'hui : « Non couvert »
 * honnête quand absente ; `available: false` quand geo est injoignable (jamais
 * de faux « Non couvert »).
 *
 * GET /api/source/coverage/:citySlug/lot-fields — détail LAZY par ville :
 * couverture des champs LOT enrichis servis par geo sur `qc-lots-<slug>`
 * (superficie réelle `surface_m2`, adresse, code postal FSA, normes foldées).
 * Mesure par le service `lot-fields-coverage` (échantillon stratifié déclaré
 * quand > 450 lots, % honnêtes, verbatim-or-null) ; `available: false` quand
 * geo est injoignable. Le bulk expose la cellule `lotFields` UNIQUEMENT depuis
 * cette mesure lazy quand elle est chaude en cache (même contrat que normes) —
 * cette couche est INFORMATIVE : elle n'entre PAS dans `worstStatus`.
 */

const DEFAULT_STALE_AFTER_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** TTL du cache du listing live des collections geo (1 requête pour tout). */
const GEO_LISTING_TTL_MS = 10 * 60_000;
/** TTL raccourci après un échec du listing (retente vite, sans marteler geo). */
const GEO_LISTING_FAILURE_TTL_MS = 60_000;
/** TTL du cache grilles par ville + borne d'entrées (purge complète au-delà). */
const GRILLES_TTL_MS = 5 * 60_000;
const GRILLES_CACHE_MAX = 64;
const GEO_ITEMS_LIMIT = 10_000;

/**
 * Sources « raw » (L1) = toutes les sources scrape-status SAUF `zonage`
 * (qui alimente la couche géo L4, pas le raw documentaire).
 */
const RAW_SOURCES: readonly ScrapeStatusSourceT[] = [
  "conseils-municipaux",
  "avis-publics",
  "youtube-seances",
  "role-evaluation",
];

type CoverageState = "verified" | "declared" | "absent";
type Freshness = "fresh" | "partial" | "stale" | "unknown";

export interface SourceCoverageDeps {
  store: ObjectStore;
  db?: Database;
  now?: () => number;
  staleAfterDays?: number;
  /** fetch injectable (tests / proxys). Défaut : fetch global. */
  fetchImpl?: typeof fetch;
  /** Base OGC geo (défaut GEO_OGC_BASE_URL ?? api.geo.sent-tech.ca). */
  geoBaseUrl?: string;
  /** Override du TTL du cache listing geo (tests). */
  geoListingTtlMs?: number;
}

interface RawCell {
  state: CoverageState;
  count: number;
  freshness: Freshness;
}

interface GraphCell {
  state: CoverageState;
  ontologyVersion: string | null;
  freshness: Freshness;
}

interface SignalsCell {
  state: CoverageState;
  /** Signaux projetés en base (Signal + DesignationEvent). */
  count: number;
  /** Dont porteurs d'une citation/extrait vérifiable. */
  withCitation: number;
  /**
   * Dont signaux PRIORITAIRES z∩m∩p : zonage ∩ multifamilial 4+ ∩ précoce
   * (subsetCounts["z|m|p"] de `listCitiesWithSignalNodes` — la cohorte « 33 »
   * de l'axe de reporting « 30 villes / 33 signaux précoces »). C'est ce compte
   * qui définit le périmètre focus côté client (`computeFocusScope`).
   */
  priority: number;
  freshness: Freshness;
}

interface GeoCell {
  state: CoverageState;
  served: boolean;
  /** Preuve du servi : listing live geo (`geo`) ou store local (`local`). */
  servedBy: "geo" | "local" | null;
  freshness: Freshness;
}

/**
 * Normes (grilles de zonage) au niveau bulk : reprend la mesure LAZY du détail
 * ville (endpoint grilles) quand elle est chaude en cache ; sinon `absent`
 * honnête (« aucune grille prouvée à date »), jamais un vert fabriqué.
 */
interface NormesCell {
  state: CoverageState;
  freshness: Freshness;
}

/**
 * Champs LOT enrichis (superficie/adresse/CP/normes foldées) au niveau bulk :
 * reprend la mesure LAZY per-city (endpoint lot-fields) quand elle est chaude
 * en cache ; sinon `absent` honnête (jamais mesuré en bulk — le bulk reste
 * set-based + un listing). Couche INFORMATIVE : n'entre pas dans worstStatus.
 */
interface LotFieldsCell {
  state: CoverageState;
  freshness: Freshness;
}

interface CityCoverage {
  citySlug: string;
  cityName: string;
  mrc: string | null;
  priorityRank: number | null;
  l1Raw: RawCell;
  l2Graph: GraphCell;
  signals: SignalsCell;
  l4Zonage: GeoCell;
  normes: NormesCell;
  l5Lots: GeoCell;
  lotFields: LotFieldsCell;
  tod: GeoCell;
  worstStatus: CoverageState;
  nextMarginalGain: "zonage" | "lots" | null;
}

interface CoverageResponse {
  generatedAt: string;
  totals: {
    cities: number;
    l1Raw: number;
    l2Graph: number;
    signals: number;
    l4Zonage: number;
    l5Lots: number;
  };
  cities: CityCoverage[];
}

interface GraphAgg {
  nodeCount: number;
  lastCreatedAt: string | null;
  ontologyVersion: string | null;
}

interface SignalAgg {
  signalCount: number;
  withCitation: number;
  /** Signaux prioritaires z∩m∩p (zonage ∩ multifamilial 4+ ∩ précoce). */
  priorityCount: number;
  lastCreatedAt: string | null;
}

interface GeoAgg {
  currentVersions: number;
  withGeometry: number;
  lastKnownFrom: string | null;
}

/** Listing live des collections geo, indexé par slug (préfixes exacts). */
interface GeoLiveListing {
  zonage: Set<string>;
  lots: Set<string>;
  tod: Set<string>;
}

export type CityGrillesError = GeoNormesError;

/** Réponse du détail règlements/normes par ville (endpoint lazy). */
export type CityGrillesResponse =
  | {
      citySlug: string;
      available: false;
      error: CityGrillesError;
    }
  | {
      citySlug: string;
      available: true;
      zoneCount: number;
      numberMatched: number | null;
      complete: boolean;
      zonesWithGrille: number;
      zonesWithReglement: number;
      zonesWithLegacyNormes: number;
      zonesWithNormativeValues: number;
      /** Union of evidence predicates, counted once per served zone feature. */
      covered: number;
      state: CoverageState;
    };

export function sourceCoverageRoute(deps: SourceCoverageDeps): Hono {
  const app = new Hono();
  const fetchImpl = deps.fetchImpl ?? fetch;
  const nowFn = deps.now ?? (() => Date.now());
  const resolveBase = (): string =>
    (
      deps.geoBaseUrl ??
      process.env["GEO_OGC_BASE_URL"] ??
      DEFAULT_OGC_BASE_URL
    ).replace(/\/$/, "");

  // ── Listing live geo : UNE requête pour toute la province, cache TTL ────────
  let listingCache: {
    expiresAt: number;
    value: Promise<GeoLiveListing | null>;
  } | null = null;

  async function loadLiveListing(): Promise<GeoLiveListing | null> {
    try {
      const res = await fetchImpl(`${resolveBase()}/collections?f=json`);
      if (!res.ok) return null;
      const body = (await res.json()) as { collections?: unknown };
      if (!body || !Array.isArray(body.collections)) return null;
      const zonage = new Set<string>();
      const lots = new Set<string>();
      const tod = new Set<string>();
      for (const item of body.collections) {
        if (typeof item !== "object" || item === null) continue;
        const id = (item as { id?: unknown }).id;
        if (typeof id !== "string") continue;
        // Correspondance EXACTE `qc-zonage-<slug>` / `qc-lots-<slug>` /
        // `qc-tod-<slug>` : les variantes suffixées (ex. `…-arcgis`) ne matchent
        // aucun slug de municipalité et sont naturellement exclues (la carte
        // requête par slug).
        if (id.startsWith("qc-zonage-")) {
          zonage.add(id.slice("qc-zonage-".length));
        } else if (id.startsWith("qc-lots-")) {
          lots.add(id.slice("qc-lots-".length));
        } else if (id.startsWith("qc-tod-")) {
          tod.add(id.slice("qc-tod-".length));
        }
      }
      return { zonage, lots, tod };
    } catch {
      return null;
    }
  }

  function getLiveListing(): Promise<GeoLiveListing | null> {
    const now = nowFn();
    if (listingCache && listingCache.expiresAt > now) return listingCache.value;
    const ttl = deps.geoListingTtlMs ?? GEO_LISTING_TTL_MS;
    const value = loadLiveListing().then((listing) => {
      if (listing === null) {
        // Échec : TTL raccourci pour retenter vite sans marteler geo.
        listingCache = {
          expiresAt: nowFn() + Math.min(ttl, GEO_LISTING_FAILURE_TTL_MS),
          value: Promise.resolve(null),
        };
      }
      return listing;
    });
    listingCache = { expiresAt: now + ttl, value };
    return value;
  }

  app.get("/api/source/coverage", async (c) => {
    const nowMs = nowFn();
    const staleMs =
      (deps.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS) * MS_PER_DAY;

    // ── L1 raw (scrape-status, mémoire) + listing live geo (caché) ───────────
    const [stored, listing] = await Promise.all([
      readAll(deps.store),
      getLiveListing(),
    ]);
    const scrapeStatuses = mergeWithDerived(stored);
    const rawByCity = new Map<string, ScrapeStatusT[]>();
    for (const rec of scrapeStatuses) {
      if (!RAW_SOURCES.includes(rec.source)) continue;
      const list = rawByCity.get(rec.citySlug) ?? [];
      list.push(rec);
      rawByCity.set(rec.citySlug, list);
    }

    // ── L2/L4/L5/signaux : agrégats set-based GROUP BY city_slug ─────────────
    const { graphByCity, zoneByCity, lotByCity, signalByCity } = deps.db
      ? await loadBulkAggregates(deps.db)
      : {
          graphByCity: new Map<string, GraphAgg>(),
          zoneByCity: new Map<string, GeoAgg>(),
          lotByCity: new Map<string, GeoAgg>(),
          signalByCity: new Map<string, SignalAgg>(),
        };

    const cities: CityCoverage[] = QC_MUNICIPALITIES.map((mun) => {
      const cityRaw = rawByCity.get(mun.slug) ?? [];
      const inventory = getGeoSourceInventory(mun.slug);

      const l1Raw = buildRawCell(cityRaw, nowMs, staleMs);
      const l2Graph = buildGraphCell(
        graphByCity.get(mun.slug),
        cityRaw,
        nowMs,
        staleMs,
      );
      const signals = buildSignalsCell(
        signalByCity.get(mun.slug),
        l2Graph,
        nowMs,
        staleMs,
      );
      const l4Zonage = buildGeoCell(
        zoneByCity.get(mun.slug),
        inventory?.zonage,
        listing ? listing.zonage.has(mun.slug) : null,
        nowMs,
        staleMs,
      );
      const l5Lots = buildGeoCell(
        lotByCity.get(mun.slug),
        inventory?.lots,
        listing ? listing.lots.has(mun.slug) : null,
        nowMs,
        staleMs,
      );
      const tod = buildTodCell(listing ? listing.tod.has(mun.slug) : null);
      const normes = buildNormesCell(mun.slug, nowMs);
      const lotFields = buildLotFieldsCell(mun.slug, nowMs);

      // Statut agrégé (couleur carte) : Servi = couches cœur complètes,
      // Partiel = au moins une couche servie, Non couvert = rien de servi.
      const worstStatus = computeCoverageStatus({
        l1Raw: l1Raw.state,
        l2Graph: l2Graph.state,
        signals: signals.state,
        l4Zonage: l4Zonage.state,
        normes: normes.state,
        l5Lots: l5Lots.state,
        tod: tod.state,
      });

      return {
        citySlug: mun.slug,
        cityName: mun.name,
        mrc: mun.mrc,
        priorityRank: mun.priorityRank,
        l1Raw,
        l2Graph,
        signals,
        l4Zonage,
        normes,
        l5Lots,
        lotFields,
        tod,
        worstStatus,
        nextMarginalGain: computeNextMarginalGain(l2Graph, l4Zonage, l5Lots),
      };
    });

    const totals = {
      cities: cities.length,
      l1Raw: cities.filter((x) => x.l1Raw.state === "verified").length,
      l2Graph: cities.filter((x) => x.l2Graph.state === "verified").length,
      signals: cities.filter((x) => x.signals.state === "verified").length,
      l4Zonage: cities.filter((x) => x.l4Zonage.state === "verified").length,
      l5Lots: cities.filter((x) => x.l5Lots.state === "verified").length,
    };

    const body: CoverageResponse = {
      generatedAt: new Date(nowMs).toISOString(),
      totals,
      cities,
    };

    return c.json(body);
  });

  // ── Détail grilles par ville (lazy, cache TTL, live geo) ───────────────────
  // `resolved` = dernière valeur résolue de la promesse : lisible en SYNCHRONE
  // par le bulk (cellule normes) sans jamais déclencher de mesure per-city.
  interface GrillesCacheEntry {
    expiresAt: number;
    value: Promise<CityGrillesResponse>;
    resolved?: CityGrillesResponse;
  }
  const grillesCache = new Map<string, GrillesCacheEntry>();

  /**
   * Cellule « Normes (grilles) » du bulk : reprend la mesure grilles LAZY quand
   * elle est chaude en cache (mesurée live au détail ville, TTL court) ; sinon
   * `absent` HONNÊTE (« aucune grille prouvée à date »). Jamais de fetch
   * per-city ici : le bulk reste set-based + un listing.
   */
  function buildNormesCell(citySlug: string, nowMs: number): NormesCell {
    const cached = grillesCache.get(citySlug);
    const measured =
      cached && cached.expiresAt > nowMs && cached.resolved?.available
        ? cached.resolved
        : null;
    if (measured?.state) {
      return { state: measured.state, freshness: "fresh" };
    }
    return { state: "absent", freshness: "unknown" };
  }

  async function loadCityGrilles(citySlug: string): Promise<CityGrillesResponse> {
    const zonage = await loadGeoFeatureCollection(
      resolveBase(),
      `qc-zonage-${citySlug}`,
      GEO_ITEMS_LIMIT,
      fetchImpl,
    );
    if (!zonage.ok) return { citySlug, available: false, error: zonage.error };
    if (!zonage.found) {
      return {
        citySlug,
        available: true,
        zoneCount: 0,
        numberMatched: 0,
        complete: true,
        zonesWithGrille: 0,
        zonesWithReglement: 0,
        zonesWithLegacyNormes: 0,
        zonesWithNormativeValues: 0,
        covered: 0,
        state: "absent",
      };
    }

    const geoNormes = await loadGeoFeatureCollection(
      resolveBase(),
      `qc-zonage-norms-${citySlug}`,
      GEO_ITEMS_LIMIT,
      fetchImpl,
    );
    if (!geoNormes.ok) {
      return { citySlug, available: false, error: geoNormes.error };
    }

    const counters = measureNormesCoverage(zonage.features, geoNormes.features);

    const zoneCount = zonage.features.length;
    const complete = zonage.complete && geoNormes.complete;
    const state: CoverageState =
      !complete
        ? "declared"
        : counters.covered === 0
          ? "absent"
          : zoneCount > 0 && counters.covered >= zoneCount
            ? "verified"
            : "declared";
    return {
      citySlug,
      available: true,
      zoneCount,
      numberMatched: zonage.numberMatched,
      complete,
      ...counters,
      state,
    };
  }

  app.get("/api/source/coverage/:citySlug/grilles", async (c) => {
    const citySlug = c.req.param("citySlug");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(citySlug)) {
      return c.json({ ok: false, error: "invalid_city_slug" }, 404);
    }
    const now = nowFn();
    const cached = grillesCache.get(citySlug);
    let promise: Promise<CityGrillesResponse>;
    if (cached && cached.expiresAt > now) {
      promise = cached.value;
    } else {
      if (grillesCache.size >= GRILLES_CACHE_MAX) grillesCache.clear();
      promise = loadCityGrilles(citySlug);
      const entry: GrillesCacheEntry = {
        expiresAt: now + GRILLES_TTL_MS,
        value: promise,
      };
      grillesCache.set(citySlug, entry);
      // Stash de la valeur résolue pour lecture synchrone par le bulk (normes).
      void promise.then((value) => {
        entry.resolved = value;
      });
    }
    const result = await promise;
    if (!result.available) {
      // Retry the next lazy request rather than caching a geo failure.
      grillesCache.delete(citySlug);
    }
    return c.json(result);
  });

  // ── Détail champs LOT enrichis par ville (lazy, cache TTL, live geo) ────────
  // Même mécanique que grilles : `resolved` lisible en SYNCHRONE par le bulk
  // (cellule lotFields) sans jamais déclencher de mesure per-city au bulk.
  interface LotFieldsCacheEntry {
    expiresAt: number;
    value: Promise<CityLotFieldsResponse | null>;
    resolved?: CityLotFieldsResponse | null;
  }
  const lotFieldsCache = new Map<string, LotFieldsCacheEntry>();

  /**
   * Cellule « Champs lot » du bulk : reprend la mesure lot-fields LAZY quand
   * elle est chaude en cache ; sinon `absent` honnête (jamais mesuré en bulk).
   * Couche INFORMATIVE : n'entre pas dans worstStatus.
   */
  function buildLotFieldsCell(citySlug: string, nowMs: number): LotFieldsCell {
    const cached = lotFieldsCache.get(citySlug);
    const measured =
      cached && cached.expiresAt > nowMs && cached.resolved?.available
        ? cached.resolved
        : null;
    if (measured?.state) {
      // Mesurée live il y a ≤ TTL → prouvée à la requête.
      return { state: measured.state, freshness: "fresh" };
    }
    return { state: "absent", freshness: "unknown" };
  }

  app.get("/api/source/coverage/:citySlug/lot-fields", async (c) => {
    const citySlug = c.req.param("citySlug");
    if (!/^[a-z0-9][a-z0-9-]*$/.test(citySlug)) {
      return c.json({ ok: false, error: "invalid_city_slug" }, 404);
    }
    const now = nowFn();
    const cached = lotFieldsCache.get(citySlug);
    let promise: Promise<CityLotFieldsResponse | null>;
    if (cached && cached.expiresAt > now) {
      promise = cached.value;
    } else {
      if (lotFieldsCache.size >= GRILLES_CACHE_MAX) lotFieldsCache.clear();
      promise = measureCityLotFields(citySlug, resolveBase(), fetchImpl);
      const entry: LotFieldsCacheEntry = {
        expiresAt: now + GRILLES_TTL_MS,
        value: promise,
      };
      lotFieldsCache.set(citySlug, entry);
      // Stash de la valeur résolue pour lecture synchrone par le bulk.
      void promise.then((value) => {
        entry.resolved = value;
      });
    }
    const result = await promise;
    if (result === null) {
      // geo injoignable : pas de cache d'échec long, dégradé honnête.
      lotFieldsCache.delete(citySlug);
      const degraded: CityLotFieldsResponse = { citySlug, available: false };
      return c.json(degraded);
    }
    return c.json(result);
  });

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrégats set-based (5 requêtes, jamais 1104 per-city)
// Ordre STABLE (les tests mockent la file dans cet ordre) :
//   1. graph  2. zones  3. lots  4. signaux  5. signaux prioritaires z∩m∩p
//   (la 5e est `listCitiesWithSignalNodes` — une requête province-wide par
//   nœud signal, classée en TS : mêmes helpers que la vue Signaux, y compris
//   les replis `etape`/`deriveEtape` impossibles en SQL pur)
// ─────────────────────────────────────────────────────────────────────────────

async function loadBulkAggregates(db: Database): Promise<{
  graphByCity: Map<string, GraphAgg>;
  zoneByCity: Map<string, GeoAgg>;
  lotByCity: Map<string, GeoAgg>;
  signalByCity: Map<string, SignalAgg>;
}> {
  const graphRows = await db
    .select({
      citySlug: graphNodes.citySlug,
      nodeCount: sql<number>`count(*)::int`,
      lastCreatedAt: sql<string | null>`max(${graphNodes.createdAt})`,
      ontologyVersion: sql<
        string | null
      >`max(${graphNodes.props} ->> 'ontology_version')`,
    })
    .from(graphNodes)
    .where(isNotNull(graphNodes.citySlug))
    .groupBy(graphNodes.citySlug);

  const zoneRows = await db
    .select({
      citySlug: zoneVersions.citySlug,
      currentVersions: sql<number>`count(*)::int`,
      withGeometry: sql<number>`count(${zoneVersions.geom})::int`,
      lastKnownFrom: sql<string | null>`max(${zoneVersions.knownFrom})`,
    })
    .from(zoneVersions)
    .where(isNull(zoneVersions.knownTo))
    .groupBy(zoneVersions.citySlug);

  const lotRows = await db
    .select({
      citySlug: lotVersions.citySlug,
      currentVersions: sql<number>`count(*)::int`,
      withGeometry: sql<number>`count(${lotVersions.geom})::int`,
      lastKnownFrom: sql<string | null>`max(${lotVersions.knownFrom})`,
    })
    .from(lotVersions)
    .where(isNull(lotVersions.knownTo))
    .groupBy(lotVersions.citySlug);

  // Signaux projetés (Signal + DesignationEvent) + part avec citation/extrait
  // vérifiable — mêmes clés d'évidence que la route graph-signals (props ou
  // props.properties : citation/excerpt ; items de props.refs : citation/excerpt).
  const signalRows = await db
    .select({
      citySlug: graphNodes.citySlug,
      signalCount: sql<number>`count(*)::int`,
      withCitation: sql<number>`(count(*) filter (where
        coalesce(
          ${graphNodes.props} ->> 'citation',
          ${graphNodes.props} -> 'properties' ->> 'citation',
          ${graphNodes.props} ->> 'excerpt',
          ${graphNodes.props} -> 'properties' ->> 'excerpt'
        ) is not null
        or (
          jsonb_typeof(${graphNodes.props} -> 'refs') = 'array'
          and exists (
            select 1
            from jsonb_array_elements(${graphNodes.props} -> 'refs') as ref
            where jsonb_typeof(ref.value) = 'object'
              and coalesce(ref.value ->> 'citation', ref.value ->> 'excerpt')
                is not null
          )
        )
      ))::int`,
      lastCreatedAt: sql<string | null>`max(${graphNodes.createdAt})`,
    })
    .from(graphNodes)
    .where(
      and(
        inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
        isNotNull(graphNodes.citySlug),
      ),
    )
    .groupBy(graphNodes.citySlug);

  const graphByCity = new Map<string, GraphAgg>();
  for (const row of graphRows) {
    if (!row.citySlug) continue;
    graphByCity.set(row.citySlug, {
      nodeCount: Number(row.nodeCount ?? 0),
      lastCreatedAt: toIsoOrNull(row.lastCreatedAt),
      ontologyVersion: row.ontologyVersion ?? null,
    });
  }

  const zoneByCity = new Map<string, GeoAgg>();
  for (const row of zoneRows) {
    if (!row.citySlug) continue;
    zoneByCity.set(row.citySlug, {
      currentVersions: Number(row.currentVersions ?? 0),
      withGeometry: Number(row.withGeometry ?? 0),
      lastKnownFrom: toIsoOrNull(row.lastKnownFrom),
    });
  }

  const lotByCity = new Map<string, GeoAgg>();
  for (const row of lotRows) {
    if (!row.citySlug) continue;
    lotByCity.set(row.citySlug, {
      currentVersions: Number(row.currentVersions ?? 0),
      withGeometry: Number(row.withGeometry ?? 0),
      lastKnownFrom: toIsoOrNull(row.lastKnownFrom),
    });
  }

  // Signaux PRIORITAIRES z∩m∩p par ville : classification canonique de la vue
  // Signaux (`listCitiesWithSignalNodes`), subsetCounts["z|m|p"]. C'est le
  // périmètre focus (« villes à signaux précoces ») — la cohorte « 33 ».
  const prioritySignalCities = await listCitiesWithSignalNodes(db);
  const priorityBySlug = new Map<string, number>();
  for (const entry of prioritySignalCities) {
    priorityBySlug.set(entry.citySlug, entry.subsetCounts["z|m|p"] ?? 0);
  }

  const signalByCity = new Map<string, SignalAgg>();
  for (const row of signalRows) {
    if (!row.citySlug) continue;
    signalByCity.set(row.citySlug, {
      signalCount: Number(row.signalCount ?? 0),
      withCitation: Number(row.withCitation ?? 0),
      priorityCount: priorityBySlug.get(row.citySlug) ?? 0,
      lastCreatedAt: toIsoOrNull(row.lastCreatedAt),
    });
  }

  return { graphByCity, zoneByCity, lotByCity, signalByCity };
}

// ─────────────────────────────────────────────────────────────────────────────
// Construction des cellules tri-état (honnêteté par cellule, D6)
// ─────────────────────────────────────────────────────────────────────────────

function buildRawCell(
  cityRaw: ScrapeStatusT[],
  nowMs: number,
  staleMs: number,
): RawCell {
  const collected = cityRaw.filter(
    (r) => r.status === "scraped" || r.status === "graphified",
  );
  const identified = cityRaw.filter((r) => r.status === "identified");

  let state: CoverageState;
  if (collected.length > 0) state = "verified";
  else if (identified.length > 0) state = "declared";
  else state = "absent";

  // « complet » = au moins une source pleinement exploitée (graphified).
  const complete = collected.some((r) => r.status === "graphified");
  const lastIso = latestIso(cityRaw.map((r) => r.lastRunAt));
  const freshness = freshnessLevel(lastIso, nowMs, staleMs, complete);

  return { state, count: collected.length, freshness };
}

function buildGraphCell(
  agg: GraphAgg | undefined,
  cityRaw: ScrapeStatusT[],
  nowMs: number,
  staleMs: number,
): GraphCell {
  const nodeCount = agg?.nodeCount ?? 0;
  // « graphified » déclaré par scrape-status mais non substantié par des
  // lignes en base = `declared` (anti-survente : pas de vert sans preuve live).
  const declaredGraphified = cityRaw.some((r) => r.status === "graphified");

  let state: CoverageState;
  if (nodeCount > 0) state = "verified";
  else if (declaredGraphified) state = "declared";
  else state = "absent";

  const freshness = freshnessLevel(
    agg?.lastCreatedAt ?? null,
    nowMs,
    staleMs,
    nodeCount > 0,
  );

  return { state, ontologyVersion: agg?.ontologyVersion ?? null, freshness };
}

/**
 * Signaux extraits : `verified` = des signaux projetés existent en base (preuve
 * live). Ville structurée (L2 non-absent) mais sans signal projeté = `declared`
 * (la chaîne a atteint la structuration, la projection signaux n'est pas
 * substantiée). Rien de connu = `absent`. Jamais de vert fabriqué.
 */
function buildSignalsCell(
  agg: SignalAgg | undefined,
  l2Graph: GraphCell,
  nowMs: number,
  staleMs: number,
): SignalsCell {
  const count = agg?.signalCount ?? 0;
  const withCitation = agg?.withCitation ?? 0;
  const priority = agg?.priorityCount ?? 0;

  let state: CoverageState;
  if (count > 0) state = "verified";
  else if (l2Graph.state !== "absent") state = "declared";
  else state = "absent";

  const freshness = freshnessLevel(
    agg?.lastCreatedAt ?? null,
    nowMs,
    staleMs,
    count > 0,
  );

  return { state, count, withCitation, priority, freshness };
}

function buildGeoCell(
  agg: GeoAgg | undefined,
  descriptor: { availability: string } | undefined,
  liveServed: boolean | null,
  nowMs: number,
  staleMs: number,
): GeoCell {
  const currentVersions = agg?.currentVersions ?? 0;
  const withGeometry = agg?.withGeometry ?? 0;
  // « servi » = la collection est LISTÉE LIVE par l'API geo (ce que la carte
  // sert réellement) OU une géométrie locale existe (store local prioritaire
  // dans /api/geo/collections). `liveServed === null` = listing injoignable →
  // repli honnête sur le seul store local (dégradé, jamais de vert fabriqué).
  const servedLive = liveServed === true;
  const servedLocal = withGeometry > 0;
  const served = servedLive || servedLocal;
  const servedBy: GeoCell["servedBy"] = servedLive
    ? "geo"
    : servedLocal
      ? "local"
      : null;

  // Source d'inventaire connue mais pas (encore) servie = déclaré.
  const inventoryDeclared =
    descriptor !== undefined &&
    descriptor.availability !== "unknown" &&
    descriptor.availability !== "none";

  let state: CoverageState;
  if (served) state = "verified";
  else if (currentVersions > 0 || inventoryDeclared) state = "declared";
  else state = "absent";

  // Fraîcheur : datée par le store local quand il existe ; une collection
  // servie LIVE est prouvée à la requête (listing ≤ TTL) → `fresh`.
  const complete =
    servedLocal && currentVersions > 0 && withGeometry >= currentVersions;
  let freshness = freshnessLevel(
    agg?.lastKnownFrom ?? null,
    nowMs,
    staleMs,
    complete,
  );
  if (servedLive && freshness === "unknown") freshness = "fresh";

  return { state, served, servedBy, freshness };
}

/**
 * Couche TOD : « servi » = collection `qc-tod-<slug>` dans le listing LIVE geo
 * (aucun store local aujourd'hui). Listing injoignable (`liveServed === null`)
 * → `absent` (dégradé honnête, jamais de vert fabriqué). Une collection servie
 * live est prouvée à la requête (listing ≤ TTL) → `fresh`.
 */
function buildTodCell(liveServed: boolean | null): GeoCell {
  const served = liveServed === true;
  return {
    state: served ? "verified" : "absent",
    served,
    servedBy: served ? "geo" : null,
    freshness: served ? "fresh" : "unknown",
  };
}

/**
 * D7 — prochain gain marginal : ville graphifiée (L2 substantié) MAIS sans
 * zonage/lots servis = complétion « cheap ». Le graphe est le prérequis : si la
 * ville n'est pas encore graphifiée live, le prochain gain n'est pas cheap → null.
 */
function computeNextMarginalGain(
  l2: GraphCell,
  l4: GeoCell,
  l5: GeoCell,
): "zonage" | "lots" | null {
  if (l2.state !== "verified") return null;
  if (!l4.served) return "zonage";
  if (!l5.served) return "lots";
  return null;
}

/** États des couches d'une ville pour le statut agrégé (couleur carte). */
export interface CoverageStatusInput {
  l1Raw: CoverageState;
  l2Graph: CoverageState;
  signals: CoverageState;
  l4Zonage: CoverageState;
  normes: CoverageState;
  l5Lots: CoverageState;
  tod: CoverageState;
}

/**
 * Statut agrégé tri-état d'une ville (couleur carte, badge « Couverture ») :
 *   - `verified` (« Servi »)       : les couches CŒUR — PV (l1Raw), signaux,
 *     zonage (l4), lots (l5) — sont TOUTES substantiées live.
 *   - `declared` (« Partiel »)     : AU MOINS une couche (cœur ou annexe) est
 *     servie, mais pas toutes les couches cœur.
 *   - `absent`   (« Non couvert ») : AUCUNE couche servie (un statut seulement
 *     déclaré ne compte pas — anti-survente, rien n'est réellement servi).
 * Les couches annexes (graphe l2, normes/grilles, TOD — éparses aujourd'hui)
 * comptent pour « Partiel » mais ne bloquent jamais le « Servi » : une ville
 * cœur-complète reste verte même sans grille ni périmètre TOD publiés.
 */
export function computeCoverageStatus(
  input: CoverageStatusInput,
): CoverageState {
  const core = [input.l1Raw, input.signals, input.l4Zonage, input.l5Lots];
  if (core.every((s) => s === "verified")) return "verified";
  const all = [...core, input.l2Graph, input.normes, input.tod];
  if (all.some((s) => s === "verified")) return "declared";
  return "absent";
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers fraîcheur / dates
// ─────────────────────────────────────────────────────────────────────────────

function freshnessLevel(
  iso: string | null,
  nowMs: number,
  staleMs: number,
  complete: boolean,
): Freshness {
  if (!iso) return "unknown";
  const observed = Date.parse(iso);
  if (Number.isNaN(observed)) return "unknown";
  if (nowMs - observed > staleMs) return "stale";
  return complete ? "fresh" : "partial";
}

function latestIso(
  values: readonly (string | Date | null | undefined)[],
): string | null {
  let latest: Date | null = null;
  for (const value of values) {
    const date = toDate(value);
    if (!date) continue;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest ? latest.toISOString() : null;
}

function toIsoOrNull(value: unknown): string | null {
  const date = toDate(value as string | Date | null | undefined);
  return date ? date.toISOString() : null;
}

function toDate(
  value: string | Date | number | null | undefined,
): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
