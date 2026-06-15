/**
 * G2 — Service de peuplement des polygones géo : zones + lots.
 *
 * ## Rôle
 * Pour les villes du registre (ArcGIS ou CKAN) :
 *   1. Fetch les polygones de ZONES via les adapters (@radar/sources).
 *   2. UPSERT dans `zone_versions` (geom MultiPolygon SRID 4326, code_norm,
 *      city_slug, geom_fetched_at). Idempotent.
 *   3. (Optionnel) Fetch les LOTS du Cadastre allégé par bbox de commune.
 *   4. UPSERT dans `lot_versions`. Idempotent.
 *   5. Lance `resolveGeoRefsBatch` sur les noeuds Signal/DesignationEvent
 *      des villes peuplées.
 *
 * ## Bornage STRICT pour les lots
 * - 1-2 villes DEMO par run (Longueuil + Saguenay).
 * - Filtre SPATIAL par bbox de commune (JAMAIS la province).
 * - 4 642 815 lots totaux QC → on ne récupère que les lots de la commune ciblée.
 *
 * ## Idempotence
 * - zone_versions : INSERT ... ON CONFLICT (canonical_id) WHERE known_to IS NULL
 *   DO UPDATE SET geom, geom_fetched_at.
 * - lot_versions  : même pattern.
 *
 * ## Loi 25
 * - Zonage = données publiques (règlement d'urbanisme). Aucun PII.
 * - Cadastre = NO_LOT + géométrie, aucun propriétaire. Aucun PII.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  ArcgisZonageAdapter,
  CadastreAllegeAdapter,
  CkanZonageAdapter,
  ARCGIS_SERVICE_REGISTRY,
  CKAN_ZONAGE_REGISTRY,
  type ArcgisServiceEntry,
  type CkanZonageEntry,
} from "@radar/sources";

/**
 * Type minimal fetch compatible avec les adapters @radar/sources/geo.
 * Défini localement pour éviter l'import du sous-chemin interne du package.
 * Duplique volontairement FetchLike de geo-fetch-utils.ts (même signature).
 */
type GeoFetchLike = (
  url: string,
  init?: { signal?: AbortSignal; headers?: Record<string, string> },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;
import { normalizeZoneCode, normalizeLotRef } from "./extract-refs.js";
import { resolveGeoRefsBatch, type GeoResolveInput } from "./resolve-refs.js";

// ─── Types publics ────────────────────────────────────────────────────────────

/** Résultats de peuplement pour une ville. */
export interface CityPopulateResult {
  citySlug: string;
  zonesUpserted: number;
  zonesSkipped: number;
  lotsUpserted: number;
  lotsSkipped: number;
  /** Résolution après peuplement (peut être undefined si runResolution=false). */
  resolution?: {
    total: number;
    resolvedZones: number;
    resolvedLots: number;
    unresolvedZones: number;
    unresolvedLots: number;
  };
  error?: string;
}

/** Options du service de peuplement. */
export interface PopulateGeoOptions {
  /**
   * Fetch injectable (pour tests mockés, défaut = globalThis.fetch).
   * Typé FetchLike pour compatibilité avec les adapters @radar/sources.
   */
  fetchImpl?: GeoFetchLike;
  /**
   * Villes à peupler (slugs). Défaut = toutes les villes des registres.
   * Peut restreindre à un sous-ensemble.
   */
  citySlugs?: string[];
  /**
   * Active le peuplement des lots via Cadastre allégé (défaut = true).
   * Mettre à false pour ne traiter que les zones (plus rapide).
   */
  populateLots?: boolean;
  /**
   * Ville(s) à cibler pour les lots (bornage strict, 1-2 villes max).
   * Défaut = ["longueuil", "saguenay"].
   */
  lotCitySlugs?: string[];
  /**
   * Lance la résolution géo après le peuplement (défaut = true).
   */
  runResolution?: boolean;
  /**
   * Logger injectable (défaut = no-op).
   */
  logger?: GeoLogger;
}

/** Interface logger minimale (compatible pino + console). */
export interface GeoLogger {
  info: (msgOrObj: string | object, ...args: unknown[]) => void;
  warn: (msgOrObj: string | object, ...args: unknown[]) => void;
  error: (msgOrObj: string | object, ...args: unknown[]) => void;
  debug?: (msgOrObj: string | object, ...args: unknown[]) => void;
}

/** Bilan global de peuplement. */
export interface PopulateGeoResult {
  citiesProcessed: number;
  citiesOk: number;
  citiesErrored: number;
  totalZonesUpserted: number;
  totalLotsUpserted: number;
  totalSignalsResolved: number;
  totalSignalsUnresolved: number;
  byCity: CityPopulateResult[];
}

// ─── Registres combinés ────────────────────────────────────────────────────────

interface CitySourceEntry {
  citySlug: string;
  source: "arcgis" | "ckan";
  arcgis?: ArcgisServiceEntry;
  ckan?: CkanZonageEntry;
}

function buildCombinedRegistry(citySlugs?: string[]): CitySourceEntry[] {
  const arcgisMap = new Map<string, ArcgisServiceEntry>();
  for (const e of ARCGIS_SERVICE_REGISTRY) {
    arcgisMap.set(e.citySlug, e);
  }

  const ckanMap = new Map<string, CkanZonageEntry>();
  for (const e of CKAN_ZONAGE_REGISTRY) {
    ckanMap.set(e.citySlug, e);
  }

  // Union des villes — ArcGIS prime sur CKAN pour la même ville
  const allSlugs = new Set<string>([
    ...arcgisMap.keys(),
    ...ckanMap.keys(),
  ]);

  const entries: CitySourceEntry[] = [];
  for (const slug of allSlugs) {
    if (citySlugs && !citySlugs.includes(slug)) continue;
    if (arcgisMap.has(slug)) {
      entries.push({
        citySlug: slug,
        source: "arcgis",
        arcgis: arcgisMap.get(slug)!,
      });
    } else {
      entries.push({
        citySlug: slug,
        source: "ckan",
        ckan: ckanMap.get(slug)!,
      });
    }
  }

  return entries;
}

// ─── Bbox hardcodées pour les lots (bornage STRICT) ──────────────────────────

/**
 * Bbox connues pour les villes demo lots.
 * Ces bbox bornent le fetch du Cadastre allégé PROVINCE-ENTIÈRE.
 * Source : vérification manuelle + données MELCC 2026-06-14.
 *
 * AVERTISSEMENT : Ne JAMAIS passer une bbox couvrant la province.
 * La couche contient 4 642 815 lots. Une bbox trop large = OOM.
 */
export const LOT_CITY_BBOXES: Record<
  string,
  { minLon: number; minLat: number; maxLon: number; maxLat: number }
> = {
  longueuil: {
    minLon: -73.65,
    minLat: 45.47,
    maxLon: -73.39,
    maxLat: 45.60,
  },
  saguenay: {
    minLon: -71.45,
    minLat: 48.20,
    maxLon: -70.70,
    maxLat: 48.60,
  },
};

/** Villes démo par défaut pour le peuplement des lots. */
export const DEFAULT_LOT_CITIES = ["longueuil", "saguenay"] as const;

// ─── UPSERT zone_versions ─────────────────────────────────────────────────────

/**
 * UPSERT un polygone de zone dans `zone_versions`.
 *
 * canonical_id = "zone-{citySlug}-{codeNorm-slugifié}".
 * geom = ST_Multi(ST_GeomFromGeoJSON(...)) → MultiPolygon SRID 4326.
 * ON CONFLICT (canonical_id) WHERE known_to IS NULL → idempotent.
 */
async function upsertZoneVersion(
  db: Database,
  citySlug: string,
  zoneCode: string,
  geomGeoJson: unknown,
  geomFetchedAt: string,
): Promise<"upserted" | "skipped"> {
  const codeNorm = normalizeZoneCode(zoneCode);
  if (!codeNorm || codeNorm.length < 2) return "skipped";

  const canonicalId = `zone-${citySlug}-${codeNorm
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")}`;
  const geomJson = JSON.stringify(geomGeoJson);

  await db.execute(sql`
    INSERT INTO zone_versions
      (id, canonical_id, city_slug, code_affiche, kind, recon_status,
       valid_from, known_from, geom, geom_source, geom_fetched_at,
       code_norm, raw_ref, evidence)
    VALUES
      (gen_random_uuid(),
       ${canonicalId},
       ${citySlug},
       ${zoneCode},
       'zone',
       'validated',
       CURRENT_DATE,
       NOW(),
       ST_Multi(ST_GeomFromGeoJSON(${geomJson}))::geometry(MultiPolygon,4326),
       'arcgis-zonage',
       ${geomFetchedAt}::timestamptz,
       ${codeNorm},
       ${zoneCode},
       '[]'::jsonb)
    ON CONFLICT (canonical_id) WHERE known_to IS NULL
    DO UPDATE SET
      geom             = EXCLUDED.geom,
      geom_fetched_at  = EXCLUDED.geom_fetched_at,
      code_norm        = EXCLUDED.code_norm,
      code_affiche     = EXCLUDED.code_affiche
  `);

  return "upserted";
}

// ─── UPSERT lot_versions ──────────────────────────────────────────────────────

/**
 * UPSERT un lot cadastral dans `lot_versions`.
 *
 * canonical_id = "lot-{noLotNorm}".
 * geom = ST_Multi(ST_GeomFromGeoJSON(...)) → MultiPolygon SRID 4326.
 * ON CONFLICT (canonical_id) WHERE known_to IS NULL → idempotent.
 */
async function upsertLotVersion(
  db: Database,
  citySlug: string,
  noLot: string,
  geomGeoJson: unknown,
  geomFetchedAt: string,
): Promise<"upserted" | "skipped"> {
  const noLotNorm = normalizeLotRef(noLot);
  if (!noLotNorm || noLotNorm.length < 7) return "skipped";

  const canonicalId = `lot-${noLotNorm}`;
  const geomJson = JSON.stringify(geomGeoJson);

  await db.execute(sql`
    INSERT INTO lot_versions
      (id, canonical_id, no_lot, city_slug, recon_status,
       valid_from, known_from, geom, geom_source, geom_fetched_at,
       no_lot_norm, raw_ref, evidence)
    VALUES
      (gen_random_uuid(),
       ${canonicalId},
       ${noLot},
       ${citySlug},
       'validated',
       CURRENT_DATE,
       NOW(),
       ST_Multi(ST_GeomFromGeoJSON(${geomJson}))::geometry(MultiPolygon,4326),
       'cadastre-allege',
       ${geomFetchedAt}::timestamptz,
       ${noLotNorm},
       ${noLot},
       '[]'::jsonb)
    ON CONFLICT (canonical_id) WHERE known_to IS NULL
    DO UPDATE SET
      geom            = EXCLUDED.geom,
      geom_fetched_at = EXCLUDED.geom_fetched_at,
      city_slug       = EXCLUDED.city_slug
  `);

  return "upserted";
}

// ─── Récupération des signaux en DB pour une ville ────────────────────────────

/**
 * Récupère les noeuds Signal et DesignationEvent d'une ville depuis graph_nodes.
 */
async function fetchSignalInputsForCity(
  db: Database,
  citySlug: string,
): Promise<GeoResolveInput[]> {
  const rows = await db.execute<{
    id: string;
    type: string;
    label: string;
    city_slug: string;
    props: Record<string, unknown>;
  }>(sql`
    SELECT id, type, label, city_slug, props
    FROM graph_nodes
    WHERE city_slug = ${citySlug}
      AND type IN ('Signal', 'DesignationEvent')
    ORDER BY id
  `);

  return (rows.rows ?? []).map((row) => {
    const props = (row.props ?? {}) as Record<string, unknown>;
    const properties = (props["properties"] as Record<string, unknown> | undefined) ?? {};
    const description = (properties["description"] as string | undefined) ?? null;

    return {
      nodeId: row.id,
      nodeType: (row.type === "DesignationEvent"
        ? "DesignationEvent"
        : "Signal") as "Signal" | "DesignationEvent",
      citySlug: row.city_slug,
      label: row.label,
      description,
      asOfDate: null,
    };
  });
}

// ─── Peuplement zones — ArcGIS ────────────────────────────────────────────────

async function populateZonesArcgis(
  db: Database,
  entry: ArcgisServiceEntry,
  fetchImpl: GeoFetchLike,
  logger: GeoLogger,
  geomFetchedAt: string,
): Promise<{ upserted: number; skipped: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapterOpts: any = {
    city: entry.citySlug,
    serviceUrl: entry.serviceUrl,
    fetchImpl,
  };
  if (entry.zoneCodeField !== null) adapterOpts.zoneCodeField = entry.zoneCodeField;
  const adapter = new ArcgisZonageAdapter(adapterOpts);

  let upserted = 0;
  let skipped = 0;

  for await (const zone of adapter.fetchAllZones()) {
    const status = await upsertZoneVersion(
      db,
      entry.citySlug,
      zone.zoneCode,
      zone.geometry,
      geomFetchedAt,
    );
    if (status === "skipped") {
      skipped++;
    } else {
      upserted++;
    }
    if ((upserted + skipped) % 500 === 0) {
      logger.info(
        { citySlug: entry.citySlug, upserted, skipped },
        "populate-geo: zones ArcGIS en cours",
      );
    }
  }

  return { upserted, skipped };
}

// ─── Peuplement zones — CKAN ──────────────────────────────────────────────────

async function populateZonesCkan(
  db: Database,
  entry: CkanZonageEntry,
  fetchImpl: GeoFetchLike,
  logger: GeoLogger,
  geomFetchedAt: string,
): Promise<{ upserted: number; skipped: number }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ckanOpts: any = {
    city: entry.citySlug,
    resourceUrl: entry.geojsonUrl,
    packageId: entry.packageId,
    organization: entry.organization,
    fetchImpl,
  };
  if (entry.zoneCodeField !== null) ckanOpts.zoneCodeField = entry.zoneCodeField;
  const adapter = new CkanZonageAdapter(ckanOpts);

  const zones = await adapter.fetchAllZones();
  let upserted = 0;
  let skipped = 0;

  for (const zone of zones) {
    const status = await upsertZoneVersion(
      db,
      entry.citySlug,
      zone.zoneCode,
      zone.geometry,
      geomFetchedAt,
    );
    if (status === "skipped") {
      skipped++;
    } else {
      upserted++;
    }
  }

  logger.info(
    { citySlug: entry.citySlug, upserted, skipped },
    "populate-geo: zones CKAN terminé",
  );

  return { upserted, skipped };
}

// ─── Peuplement lots — Cadastre allégé ───────────────────────────────────────

async function populateLots(
  db: Database,
  citySlug: string,
  fetchImpl: GeoFetchLike,
  logger: GeoLogger,
  geomFetchedAt: string,
): Promise<{ upserted: number; skipped: number }> {
  const bbox = LOT_CITY_BBOXES[citySlug];
  if (!bbox) {
    logger.warn(
      { citySlug },
      "populate-geo: bbox non définie pour les lots, ville ignorée",
    );
    return { upserted: 0, skipped: 0 };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new CadastreAllegeAdapter({ city: citySlug, bbox, fetchImpl } as any);

  let upserted = 0;
  let skipped = 0;

  for await (const lot of adapter.fetchAllLots()) {
    const status = await upsertLotVersion(
      db,
      citySlug,
      lot.no_lot,
      lot.geometry,
      geomFetchedAt,
    );
    if (status === "skipped") {
      skipped++;
    } else {
      upserted++;
    }
    if ((upserted + skipped) % 1000 === 0) {
      logger.info(
        { citySlug, upserted, skipped },
        "populate-geo: lots cadastre en cours",
      );
    }
  }

  return { upserted, skipped };
}

// ─── Peuplement principal ─────────────────────────────────────────────────────

/**
 * Peuple les polygones de zones + lots pour les villes du registre,
 * puis lance la résolution géo.
 *
 * Idempotent : peut être relancé sans créer de doublons.
 * Sériel par ville (pas de concurrence) pour éviter les OOM.
 *
 * @param db      - Handle Drizzle Database.
 * @param options - Options de peuplement.
 * @returns Bilan global.
 */
export async function populateGeo(
  db: Database,
  options: PopulateGeoOptions = {},
): Promise<PopulateGeoResult> {
  const {
    fetchImpl = globalThis.fetch as GeoFetchLike,
    citySlugs,
    populateLots: doLots = true,
    lotCitySlugs = [...DEFAULT_LOT_CITIES],
    runResolution = true,
    logger = {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
  } = options;

  const geomFetchedAt = new Date().toISOString();
  const registry = buildCombinedRegistry(citySlugs);

  const result: PopulateGeoResult = {
    citiesProcessed: 0,
    citiesOk: 0,
    citiesErrored: 0,
    totalZonesUpserted: 0,
    totalLotsUpserted: 0,
    totalSignalsResolved: 0,
    totalSignalsUnresolved: 0,
    byCity: [],
  };

  logger.info(
    { totalCities: registry.length, doLots, lotCitySlugs },
    "populate-geo: démarrage",
  );

  for (const entry of registry) {
    const cityResult: CityPopulateResult = {
      citySlug: entry.citySlug,
      zonesUpserted: 0,
      zonesSkipped: 0,
      lotsUpserted: 0,
      lotsSkipped: 0,
    };

    result.citiesProcessed++;

    try {
      // 1. Zones
      logger.info(
        { citySlug: entry.citySlug, source: entry.source },
        "populate-geo: peuplement zones",
      );

      let zonesStats: { upserted: number; skipped: number };

      if (entry.source === "arcgis" && entry.arcgis) {
        zonesStats = await populateZonesArcgis(
          db,
          entry.arcgis,
          fetchImpl,
          logger,
          geomFetchedAt,
        );
      } else if (entry.source === "ckan" && entry.ckan) {
        zonesStats = await populateZonesCkan(
          db,
          entry.ckan,
          fetchImpl,
          logger,
          geomFetchedAt,
        );
      } else {
        logger.warn(
          { citySlug: entry.citySlug },
          "populate-geo: source inconnue, ignorée",
        );
        zonesStats = { upserted: 0, skipped: 0 };
      }

      cityResult.zonesUpserted = zonesStats.upserted;
      cityResult.zonesSkipped = zonesStats.skipped;
      result.totalZonesUpserted += zonesStats.upserted;

      logger.info(
        {
          citySlug: entry.citySlug,
          zonesUpserted: zonesStats.upserted,
          zonesSkipped: zonesStats.skipped,
        },
        "populate-geo: zones terminées",
      );

      // 2. Lots (bornage STRICT : seulement les villes désignées)
      if (doLots && lotCitySlugs.includes(entry.citySlug)) {
        logger.info(
          { citySlug: entry.citySlug },
          "populate-geo: peuplement lots (cadastre allégé)",
        );

        const lotsStats = await populateLots(
          db,
          entry.citySlug,
          fetchImpl,
          logger,
          geomFetchedAt,
        );

        cityResult.lotsUpserted = lotsStats.upserted;
        cityResult.lotsSkipped = lotsStats.skipped;
        result.totalLotsUpserted += lotsStats.upserted;

        logger.info(
          {
            citySlug: entry.citySlug,
            lotsUpserted: lotsStats.upserted,
            lotsSkipped: lotsStats.skipped,
          },
          "populate-geo: lots terminés",
        );
      }

      // 3. Résolution géo
      if (runResolution) {
        logger.info(
          { citySlug: entry.citySlug },
          "populate-geo: résolution géo",
        );

        const inputs = await fetchSignalInputsForCity(db, entry.citySlug);

        if (inputs.length === 0) {
          logger.info(
            { citySlug: entry.citySlug },
            "populate-geo: aucun Signal/DesignationEvent à résoudre",
          );
          cityResult.resolution = {
            total: 0,
            resolvedZones: 0,
            resolvedLots: 0,
            unresolvedZones: 0,
            unresolvedLots: 0,
          };
        } else {
          const resStats = await resolveGeoRefsBatch(db, inputs);
          cityResult.resolution = resStats;
          result.totalSignalsResolved +=
            resStats.resolvedZones + resStats.resolvedLots;
          result.totalSignalsUnresolved +=
            resStats.unresolvedZones + resStats.unresolvedLots;

          logger.info(
            {
              citySlug: entry.citySlug,
              total: resStats.total,
              resolvedZones: resStats.resolvedZones,
              resolvedLots: resStats.resolvedLots,
              unresolvedZones: resStats.unresolvedZones,
              unresolvedLots: resStats.unresolvedLots,
            },
            "populate-geo: résolution terminée",
          );
        }
      }

      result.citiesOk++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      cityResult.error = errMsg;
      result.citiesErrored++;
      logger.error(
        { citySlug: entry.citySlug, err: errMsg },
        "populate-geo: erreur ville",
      );
    }

    result.byCity.push(cityResult);
  }

  // Bilan final
  const totalResolu = result.totalSignalsResolved;
  const totalNonResolu = result.totalSignalsUnresolved;
  const total = totalResolu + totalNonResolu;
  const tauxPct =
    total > 0 ? ((totalResolu / total) * 100).toFixed(1) + "%" : "N/A";

  logger.info(
    {
      citiesProcessed: result.citiesProcessed,
      citiesOk: result.citiesOk,
      citiesErrored: result.citiesErrored,
      totalZonesUpserted: result.totalZonesUpserted,
      totalLotsUpserted: result.totalLotsUpserted,
      totalSignalsResolved: totalResolu,
      totalSignalsUnresolved: totalNonResolu,
      tauxResolution: tauxPct,
    },
    "populate-geo: BILAN FINAL",
  );

  return result;
}
