/**
 * G2 — Service de peuplement des polygones géo : zones + lots.
 *
 * ## Rôle
 * Pour les villes du registre (CKAN Données Québec via @sentropic/geo-sources-americas) :
 *   1. Fetch les polygones de ZONES via `acquireCkanGeoJson` de `@sentropic/geo`.
 *   2. UPSERT dans `zone_versions` (geom MultiPolygon SRID 4326, code_norm,
 *      city_slug, geom_fetched_at). Idempotent.
 *   3. (Optionnel) Fetch les LOTS du Cadastre allégé par bbox de commune via
 *      `crawlQcCadastreLots` de `@sentropic/geo-sources-americas`.
 *   4. UPSERT dans `lot_versions`. Idempotent.
 *   5. Lance `resolveGeoRefsBatch` sur les noeuds Signal/DesignationEvent
 *      des villes peuplées.
 *
 * ## Sources (depuis @sentropic/geo 0.1.1 + @sentropic/geo-sources-americas 0.1.1)
 * - Zones  : `acquireCkanGeoJson` (@sentropic/geo) sur les 11 manifestes
 *   `QC_ZONAGE_CKAN_MANIFESTS` (@sentropic/geo-sources-americas).
 * - Lots   : `crawlQcCadastreLots` (@sentropic/geo-sources-americas),
 *   avec bornage STRICT par bbox commune (LOT_CITY_BBOXES).
 *
 * ## Bornage STRICT pour les lots
 * - 1-2 villes DEMO par run (Longueuil + Saguenay).
 * - Filtre SPATIAL par bbox de commune (JAMAIS la province).
 * - 4 642 815 lots totaux QC → on ne récupère que les lots de la commune ciblée.
 *
 * ## Idempotence (fix ON CONFLICT)
 * - zone_versions / lot_versions n'ont PAS de contrainte UNIQUE sur canonical_id
 *   (elles ont une contrainte EXCLUDE non-overlap + un INDEX simple).
 * - `ON CONFLICT (canonical_id) WHERE known_to IS NULL` référençait une cible
 *   inexistante → erreur PG. Fix : upsert manuel UPDATE → INSERT si 0 rows.
 *
 * ## Loi 25
 * - Zonage = données publiques (règlement d'urbanisme). Aucun PII.
 * - Cadastre = NO_LOT + géométrie, aucun propriétaire. Aucun PII.
 */

import { sql } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import {
  acquireCkanGeoJson,
  type CkanGeoJsonResult,
} from "@sentropic/geo";
import {
  QC_ZONAGE_CKAN_MANIFESTS,
  crawlQcCadastreLots,
  type CrawlQcCadastreLotsOptions,
} from "@sentropic/geo-sources-americas";
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
   * Forwarded à acquireCkanGeoJson et crawlQcCadastreLots.
   */
  fetchImpl?: typeof fetch;
  /**
   * Villes à peupler (slugs). Défaut = toutes les villes des manifestes CKAN.
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

// ─── Détection du champ zone ──────────────────────────────────────────────────

/**
 * Candidats prioritaires pour le champ code-de-zone dans les GeoJSON CKAN QC.
 * Ordre de priorité issu de l'observation des données réelles (2026-06-14/15).
 */
const ZONE_CODE_FIELD_CANDIDATES = [
  "NO_ZONE",
  "no_zone",
  "CODEZONE",
  "CODE_ZONE",
  "Zonage",
  "zonage",
  "zone_",
  "ZONE",
  "zone",
  "NOM_ZONE",
  "nom_zone",
  "DESIGNATION",
  "designation",
  "CATEGORIE",
  "categorie",
] as const;

/**
 * Détecte le champ code-de-zone dans les propriétés d'une feature GeoJSON.
 * Retourne le premier candidat trouvé parmi ZONE_CODE_FIELD_CANDIDATES,
 * ou le premier champ String non-OID en fallback.
 */
function detectZoneCodeField(
  properties: Record<string, unknown>,
): string | null {
  const keys = new Set(Object.keys(properties));
  for (const candidate of ZONE_CODE_FIELD_CANDIDATES) {
    if (keys.has(candidate)) return candidate;
  }
  // Fallback : premier champ String non-numérique non-OID
  for (const key of keys) {
    const val = properties[key];
    if (
      typeof val === "string" &&
      val.length > 0 &&
      !["id", "objectid", "fid", "gid", "shape", "shape_length", "shape_area"].includes(
        key.toLowerCase(),
      )
    ) {
      return key;
    }
  }
  return null;
}

// ─── Registre combiné depuis geo-sources-americas ────────────────────────────

interface CityZoneSource {
  citySlug: string;
  geojsonUrl: string;
  datasetId: string;
}

/**
 * Construit la liste des sources de zones depuis `QC_ZONAGE_CKAN_MANIFESTS`.
 * Chaque manifeste a un `id` de la forme `ca-qc/zonage-{ville}` ;
 * le citySlug est extrait de la partie après `zonage-`.
 */
function buildZoneRegistry(citySlugs?: string[]): CityZoneSource[] {
  const entries: CityZoneSource[] = [];

  for (const manifest of QC_ZONAGE_CKAN_MANIFESTS) {
    // id: "ca-qc/zonage-{ville}" → citySlug = "{ville}"
    const match = manifest.id.match(/^ca-qc\/zonage-(.+)$/);
    if (!match) continue;
    const citySlug = match[1]!;

    if (citySlugs && !citySlugs.includes(citySlug)) continue;

    // Chaque manifeste a exactement un dataset (GeoJSON WGS84)
    const dataset = manifest.datasets[0];
    if (!dataset) continue;

    entries.push({
      citySlug,
      geojsonUrl: dataset.url,
      datasetId: dataset.id,
    });
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

// ─── UPSERT zone_versions (idempotent, upsert manuel) ────────────────────────

/**
 * UPSERT un polygone de zone dans `zone_versions`.
 *
 * canonical_id = "zone-{citySlug}-{codeNorm-slugifié}".
 * geom = ST_Multi(ST_GeomFromGeoJSON(...)) → MultiPolygon SRID 4326.
 *
 * Fix ON CONFLICT : les tables zone_versions/lot_versions ont une contrainte
 * EXCLUDE (non-overlap) + un INDEX simple sur canonical_id, mais PAS de
 * contrainte UNIQUE — `ON CONFLICT (canonical_id) WHERE known_to IS NULL`
 * référençait une cible inexistante et échouait. Upsert manuel :
 * UPDATE d'abord, INSERT si 0 lignes retournées.
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

  // 1. Tente la mise à jour de la version vivante (known_to IS NULL)
  const updateResult = await db.execute<{ id: string }>(sql`
    UPDATE zone_versions
    SET
      geom             = ST_Multi(ST_GeomFromGeoJSON(${geomJson}))::geometry(MultiPolygon,4326),
      geom_fetched_at  = ${geomFetchedAt}::timestamptz,
      code_norm        = ${codeNorm},
      code_affiche     = ${zoneCode}
    WHERE canonical_id = ${canonicalId}
      AND known_to IS NULL
    RETURNING id
  `);

  if ((updateResult.rows ?? []).length > 0) {
    return "upserted";
  }

  // 2. Pas de version vivante existante → INSERT
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
       'ckan-zonage',
       ${geomFetchedAt}::timestamptz,
       ${codeNorm},
       ${zoneCode},
       '[]'::jsonb)
  `);

  return "upserted";
}

// ─── UPSERT lot_versions (idempotent, upsert manuel) ─────────────────────────

/**
 * UPSERT un lot cadastral dans `lot_versions`.
 *
 * canonical_id = "lot-{noLotNorm}".
 * geom = ST_Multi(ST_GeomFromGeoJSON(...)) → MultiPolygon SRID 4326.
 *
 * Même stratégie que upsertZoneVersion : UPDATE d'abord, INSERT si nécessaire.
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

  // 1. Tente la mise à jour de la version vivante
  const updateResult = await db.execute<{ id: string }>(sql`
    UPDATE lot_versions
    SET
      geom            = ST_Multi(ST_GeomFromGeoJSON(${geomJson}))::geometry(MultiPolygon,4326),
      geom_fetched_at = ${geomFetchedAt}::timestamptz,
      city_slug       = ${citySlug}
    WHERE canonical_id = ${canonicalId}
      AND known_to IS NULL
    RETURNING id
  `);

  if ((updateResult.rows ?? []).length > 0) {
    return "upserted";
  }

  // 2. Pas de version vivante → INSERT
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

// ─── Peuplement zones via geo (acquireCkanGeoJson) ────────────────────────────

async function populateZonesCkan(
  db: Database,
  entry: CityZoneSource,
  fetchImpl: typeof fetch,
  logger: GeoLogger,
  geomFetchedAt: string,
): Promise<{ upserted: number; skipped: number }> {
  let result: CkanGeoJsonResult;
  try {
    result = await acquireCkanGeoJson(entry.geojsonUrl, { fetchImpl });
  } catch (err) {
    throw new Error(
      `acquireCkanGeoJson failed for ${entry.citySlug} (${entry.geojsonUrl}): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const features = result.collection.features;
  if (features.length === 0) {
    logger.warn(
      { citySlug: entry.citySlug, url: entry.geojsonUrl },
      "populate-geo: FeatureCollection vide depuis CKAN",
    );
    return { upserted: 0, skipped: 0 };
  }

  // Détection du champ zone sur la première feature
  const firstProps =
    (features[0]?.properties as Record<string, unknown> | null | undefined) ?? {};
  const zoneCodeField = detectZoneCodeField(firstProps);

  if (!zoneCodeField) {
    throw new Error(
      `[populate-geo] Impossible de détecter le champ code-de-zone pour ${entry.citySlug}. ` +
        `Champs disponibles : ${Object.keys(firstProps).join(", ")}.`,
    );
  }

  logger.info(
    { citySlug: entry.citySlug, zoneCodeField, featureCount: features.length },
    "populate-geo: champ zone détecté",
  );

  let upserted = 0;
  let skipped = 0;

  for (const feature of features) {
    const props = (feature.properties as Record<string, unknown> | null | undefined) ?? {};
    const rawCode = props[zoneCodeField];
    if (rawCode == null || (typeof rawCode === "string" && rawCode.trim() === "")) {
      skipped++;
      continue;
    }
    const zoneCode = String(rawCode).trim();
    const geometry = feature.geometry;
    if (
      !geometry ||
      !["Polygon", "MultiPolygon"].includes(geometry.type)
    ) {
      skipped++;
      continue;
    }

    const status = await upsertZoneVersion(
      db,
      entry.citySlug,
      zoneCode,
      geometry,
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
        "populate-geo: zones CKAN en cours",
      );
    }
  }

  logger.info(
    { citySlug: entry.citySlug, upserted, skipped },
    "populate-geo: zones CKAN terminé",
  );

  return { upserted, skipped };
}

// ─── Peuplement lots via geo (crawlQcCadastreLots) ───────────────────────────

async function populateLots(
  db: Database,
  citySlug: string,
  fetchImpl: typeof fetch,
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

  // Bornage STRICT : extent réduit à la bbox de la commune
  const extent: CrawlQcCadastreLotsOptions["extent"] = [
    bbox.minLon,
    bbox.minLat,
    bbox.maxLon,
    bbox.maxLat,
  ];

  logger.info(
    { citySlug, extent },
    "populate-geo: crawlQcCadastreLots démarré (bbox-tiling)",
  );

  const crawlResult = await crawlQcCadastreLots({ fetchImpl, extent });

  let upserted = 0;
  let skipped = 0;

  for (const feature of crawlResult.collection.features) {
    const props =
      (feature.properties as Record<string, unknown> | null | undefined) ?? {};

    // Le normaliseur cadastre produit AdminProperties avec NO_LOT verbatim
    const noLot =
      (props["NO_LOT"] as string | undefined) ??
      (props["no_lot"] as string | undefined) ??
      null;

    if (!noLot) {
      skipped++;
      continue;
    }

    const geometry = feature.geometry;
    if (
      !geometry ||
      !["Polygon", "MultiPolygon"].includes(geometry.type)
    ) {
      skipped++;
      continue;
    }

    const status = await upsertLotVersion(
      db,
      citySlug,
      noLot,
      geometry,
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

  logger.info(
    {
      citySlug,
      upserted,
      skipped,
      pages: crawlResult.provenance.pages,
      recipeVersion: crawlResult.recipeVersion,
    },
    "populate-geo: lots cadastre terminés",
  );

  return { upserted, skipped };
}

// ─── Peuplement principal ─────────────────────────────────────────────────────

/**
 * Peuple les polygones de zones + lots pour les villes du registre,
 * puis lance la résolution géo.
 *
 * Sources :
 *   - Zones : `acquireCkanGeoJson` (@sentropic/geo) sur les 11 manifestes
 *     `QC_ZONAGE_CKAN_MANIFESTS` (@sentropic/geo-sources-americas).
 *   - Lots  : `crawlQcCadastreLots` (@sentropic/geo-sources-americas),
 *     bornage STRICT par bbox commune (LOT_CITY_BBOXES).
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
    fetchImpl = globalThis.fetch as typeof fetch,
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
  const registry = buildZoneRegistry(citySlugs);

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
      // 1. Zones (via acquireCkanGeoJson de @sentropic/geo)
      logger.info(
        { citySlug: entry.citySlug, source: "ckan", datasetId: entry.datasetId },
        "populate-geo: peuplement zones",
      );

      const zonesStats = await populateZonesCkan(
        db,
        entry,
        fetchImpl,
        logger,
        geomFetchedAt,
      );

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
          "populate-geo: peuplement lots (crawlQcCadastreLots)",
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
