/**
 * ogc-pull — Pulls lot/zone collections from the OGC API geo (api.geo.sent-tech.ca)
 * and upserts them into lot_versions / zone_versions in Postgres.
 *
 * ## Architecture
 *
 * - OGC API endpoint : https://api.geo.sent-tech.ca
 * - Lots    : collections named `qc-lots-<city-slug>`
 * - Zones   : collections named `qc-zonage-<city-slug>` or `qc-zonage-<city-slug>-<layer>`
 * - Items are fetched paginated: GET /collections/<id>/items?limit=10000&offset=N&f=json
 *   until numberReturned < pageSize (last page).
 *
 * ## Upsert strategy
 *
 * Tables have no ON CONFLICT constraint we can rely on, so we use a manual
 * SELECT-then-INSERT/UPDATE pattern keyed on (no_lot, city_slug) for lots and
 * (code_affiche, city_slug) for zones, targeting rows where known_to IS NULL
 * (i.e. the current open version). If a row already exists we UPDATE the geom
 * and geom_source; otherwise we INSERT a fresh version.
 *
 * canonical_id is derived deterministically:
 *   `ogc:lots:<city_slug>:<no_lot_norm>` for lots
 *   `ogc:zones:<city_slug>:<code_norm>` for zones
 *
 * ## Memory bounding
 *
 * Upserts are committed per batch of BATCH_SIZE features to avoid
 * accumulating all features in memory (Node heap).
 *
 * ## Loi 25 / anti-PII
 * Only public cadastral data (NO_LOT, geometry, zone code). No owner data.
 */

import pg from "pg";
import type { Database } from "../../db/client.js";
import { lotSourceLockKey } from "../facets/lots/lot-source-serialization.js";
import { normalizeZoneCode as normalizeZoneCodeUnified } from "./extract-refs.js";
import { publicProvenanceFromProperties } from "./provenance.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OgcGeometry {
  type: string;
  coordinates?: unknown;
  geometries?: OgcGeometry[];
}

export interface OgcFeature {
  type: "Feature";
  id?: string | number;
  geometry: OgcGeometry | null;
  properties: Record<string, unknown>;
}

export interface OgcFeatureCollection {
  type: "FeatureCollection";
  numberMatched?: number;
  numberReturned?: number;
  features: OgcFeature[];
  links?: { href: string; rel: string }[];
}

export interface OgcCollectionItem {
  id: string;
  title?: string;
}

export interface OgcCollectionsResponse {
  collections: OgcCollectionItem[];
}

export interface PullResult {
  citySlug: string;
  lotsUpserted: number;
  zonesUpserted: number;
  lotsSkipped: number;
  zonesSkipped: number;
  errors: string[];
}

export interface PullGeoOgcOptions {
  /** OGC API base URL (default: https://api.geo.sent-tech.ca) */
  baseUrl?: string;
  /** Items per page (default: 10000) */
  pageSize?: number;
  /** Pull lots (default: true) */
  pullLots?: boolean;
  /** Pull zones (default: true) */
  pullZones?: boolean;
  /**
   * Override de collection-id de zone EXACT par ville.
   * Quand fourni pour un citySlug, UNIQUEMENT cette collection est tirée
   * (le préfixe qc-zonage-<slug>* est ignoré).
   *
   * Exemple : { "mont-tremblant": "qc-zonage-mont-tremblant-arcgis",
   *              "rimouski": "qc-zonage-rimouski" }
   */
  zoneCollectionOverrides?: Record<string, string>;
  /** Injectable fetch for tests (default: global fetch) */
  fetchImpl?: typeof fetch;
  /** Logger interface */
  logger?: {
    info(obj: unknown, msg?: string): void;
    warn(obj: unknown, msg?: string): void;
    error(obj: unknown, msg?: string): void;
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_OGC_BASE_URL = "https://api.geo.sent-tech.ca";
const DEFAULT_PAGE_SIZE = 10_000;
const BATCH_SIZE = 500;

// ─── Normalisation helpers ────────────────────────────────────────────────────

/**
 * Normalise un NO_LOT cadastral : supprime tous les espaces.
 * "4 516 943" → "4516943"
 */
export function normalizeNoLot(raw: unknown): string {
  return String(raw ?? "").replace(/\s+/g, "");
}

/**
 * Normalise un code de zone pour le stockage OGC.
 *
 * Délègue à la fonction canonique de extract-refs.ts pour garantir la cohérence
 * entre ce qui est stocké dans zone_versions.code_norm et ce qui est produit
 * par l'extracteur de texte libre.
 *
 * @deprecated Utiliser directement `normalizeZoneCode` de extract-refs.ts.
 */
export function normalizeZoneCode(raw: unknown): string {
  return normalizeZoneCodeUnified(raw);
}

/**
 * Dérive un canonical_id déterministe pour un lot OGC.
 */
export function lotCanonicalId(citySlug: string, noLotNorm: string): string {
  return `ogc:lots:${citySlug}:${noLotNorm}`;
}

/**
 * Dérive un canonical_id déterministe pour une zone OGC.
 */
export function zoneCanonicalId(citySlug: string, codeNorm: string): string {
  return `ogc:zones:${citySlug}:${codeNorm}`;
}

export interface OgcLotStoredRow {
  id: string;
  city_slug: string;
  canonical_id: string;
}

export interface OgcLotStoredIdentity {
  id: string;
  citySlug: string;
  canonicalId: string;
}

export interface OgcLotInsertDecision {
  citySlug: string;
  canonicalId: string;
  noLotNorm: string;
  rawRef: string;
}

export type OgcLotValidatedMutation =
  | { kind: "update"; rowId: string; identity: { citySlug: string; canonicalId: string } }
  | { kind: "insert"; decision: OgcLotInsertDecision };

export function resolveOgcLotUpdateIdentity(stored: OgcLotStoredIdentity) {
  return { citySlug: stored.citySlug, canonicalId: stored.canonicalId };
}

export function decideOgcLotInsert(citySlug: string, noLotNorm: string): OgcLotInsertDecision {
  return {
    citySlug,
    canonicalId: lotCanonicalId(citySlug, noLotNorm),
    noLotNorm,
    rawRef: `ogc:${citySlug}:${noLotNorm}`,
  };
}

// A row appearing after discovery uses its stored update identity.
// upsertLotBatch locks the resulting identity on the same pg client before
// rechecking, so a newly selected identity is never mutated unlocked.
export function revalidateOgcLotInsertDecision(
  decision: OgcLotInsertDecision,
  updateRow: OgcLotStoredIdentity | null,
): OgcLotValidatedMutation {
  if (updateRow) {
    return { kind: "update", rowId: updateRow.id, identity: resolveOgcLotUpdateIdentity(updateRow) };
  }
  return { kind: "insert", decision };
}

function toOgcLotStoredIdentity(row: OgcLotStoredRow | undefined): OgcLotStoredIdentity | null {
  if (!row?.id || !row.city_slug || !row.canonical_id) return null;
  return { id: row.id, citySlug: row.city_slug, canonicalId: row.canonical_id };
}

interface OgcLotPendingWrite {
  noLotNorm: string;
  geomJson: string | null;
  evidence: string;
  decision: OgcLotInsertDecision;
  lockCitySlug: string;
  lockCanonicalId: string;
}

/** Deterministic target order shared with lot-batch.ts. */
function compareOgcLotLockTarget(
  left: { citySlug: string; canonicalId: string },
  right: { citySlug: string; canonicalId: string },
): number {
  const leftKey = JSON.stringify([left.citySlug, left.canonicalId]);
  const rightKey = JSON.stringify([right.citySlug, right.canonicalId]);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

// ─── OGC Fetcher ─────────────────────────────────────────────────────────────

/**
 * Retourne la liste des collection ids du catalogue qui commencent par `prefix`.
 */
export async function fetchCollectionIds(
  baseUrl: string,
  prefix: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `${baseUrl}/collections?f=json&limit=10000`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`GET ${url} → HTTP ${res.status}`);
  }
  const body = (await res.json()) as OgcCollectionsResponse;
  return (body.collections ?? [])
    .map((c) => c.id)
    .filter((id) => id.startsWith(prefix));
}

/**
 * Génère les pages de features d'une collection OGC avec pagination par offset.
 * Yields un tableau de features par page.
 */
export async function* fetchCollectionFeatures(
  baseUrl: string,
  collectionId: string,
  pageSize: number = DEFAULT_PAGE_SIZE,
  fetchImpl: typeof fetch = fetch,
): AsyncGenerator<OgcFeature[]> {
  let offset = 0;
  let totalExpected: number | undefined;

  for (;;) {
    const url =
      `${baseUrl}/collections/${encodeURIComponent(collectionId)}/items` +
      `?limit=${pageSize}&offset=${offset}&f=json`;

    const res = await fetchImpl(url);
    if (!res.ok) {
      throw new Error(`GET ${url} → HTTP ${res.status}`);
    }

    const page = (await res.json()) as OgcFeatureCollection;

    if (totalExpected === undefined && page.numberMatched !== undefined) {
      totalExpected = page.numberMatched;
    }

    const features = page.features ?? [];
    if (features.length === 0) break;

    yield features;

    const numberReturned = page.numberReturned ?? features.length;
    offset += numberReturned;

    // Dernière page : moins de features que demandé
    if (numberReturned < pageSize) break;
    // Sécurité : on a tout récupéré
    if (totalExpected !== undefined && offset >= totalExpected) break;
  }
}

// ─── Upsert helpers ───────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Upsert un batch de features lots dans lot_versions.
 * Clé : (no_lot, city_slug) WHERE known_to IS NULL.
 * - Trouvé → UPDATE geom + geom_source + raw_ref.
 * - Absent → INSERT nouvelle version.
 *
 * Utilise du SQL brut pour ST_SetSRID(ST_GeomFromGeoJSON(...)) car Drizzle
 * ne supporte pas les fonctions PostGIS directement.
 */
export async function upsertLotBatch(
  db: Database,
  pool: pg.Pool,
  citySlug: string,
  features: OgcFeature[],
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const today = todayIso();
    const now = nowIso();

    // Phase 1 — discovery without mutation. The stored identity may differ
    // from the derived canonical id: lock the stored identity when found.
    const pending: OgcLotPendingWrite[] = [];
    for (const feature of features) {
      const rawNoLot =
        feature.properties?.["NO_LOT"] ??
        feature.properties?.["no_lot"];
      const noLotNorm = normalizeNoLot(rawNoLot);

      if (!noLotNorm) {
        skipped++;
        continue;
      }

      const geomJson = feature.geometry
        ? JSON.stringify(feature.geometry)
        : null;

      const decision = decideOgcLotInsert(citySlug, noLotNorm);
      const evidence = JSON.stringify([{
        source: "ogc-api",
        fetchedAt: now,
        ...publicProvenanceFromProperties(feature.properties),
      }]);

      const discovered = await client.query<OgcLotStoredRow>(
        `SELECT id, city_slug, canonical_id FROM lot_versions
         WHERE no_lot = $1 AND city_slug = $2 AND known_to IS NULL
         LIMIT 1`,
        [noLotNorm, citySlug],
      );
      const preLockRow = toOgcLotStoredIdentity(discovered.rows[0]);
      pending.push({
        noLotNorm,
        geomJson,
        evidence,
        decision,
        lockCitySlug: preLockRow ? preLockRow.citySlug : decision.citySlug,
        lockCanonicalId: preLockRow ? preLockRow.canonicalId : decision.canonicalId,
      });
    }

    // Every target lock is acquired on this same client, deduplicated and in
    // lot-batch order, before any mutation. Transaction-scoped advisory locks
    // are retained through COMMIT/ROLLBACK.
    const lockTargets = new Map<string, { citySlug: string; canonicalId: string }>();
    for (const item of pending) {
      const key = lotSourceLockKey(item.lockCitySlug, item.lockCanonicalId);
      if (!lockTargets.has(key)) {
        lockTargets.set(key, { citySlug: item.lockCitySlug, canonicalId: item.lockCanonicalId });
      }
    }
    for (const target of [...lockTargets.values()].sort(compareOgcLotLockTarget)) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        lotSourceLockKey(target.citySlug, target.canonicalId),
      ]);
    }

    // Phase 2 — revalidate under the lock, then mutate. A revalidation that
    // changes the required lock set fails explicitly instead of mutating a
    // newly selected, unlocked identity; the whole batch rolls back.
    for (const item of pending) {
      const { noLotNorm, geomJson, evidence, decision } = item;
      const rechecked = await client.query<OgcLotStoredRow>(
        `SELECT id, city_slug, canonical_id FROM lot_versions
         WHERE no_lot = $1 AND city_slug = $2 AND known_to IS NULL
         LIMIT 1`,
        [noLotNorm, citySlug],
      );
      const updateRow = toOgcLotStoredIdentity(rechecked.rows[0]);
      const requiredCitySlug = updateRow ? updateRow.citySlug : decision.citySlug;
      const requiredCanonicalId = updateRow ? updateRow.canonicalId : decision.canonicalId;
      if (requiredCitySlug !== item.lockCitySlug || requiredCanonicalId !== item.lockCanonicalId) {
        throw new Error(`ogc_lot_source_lock_changed:${noLotNorm}`);
      }
      const validated = revalidateOgcLotInsertDecision(decision, updateRow);

      if (validated.kind === "update") {
        if (geomJson) {
          await client.query(
            `UPDATE lot_versions
             SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                 geom_source = 'ogc-api',
                 raw_ref = $2,
                 evidence = $3::jsonb
             WHERE id = $4`,
            [geomJson, decision.rawRef, evidence, validated.rowId],
          );
        } else {
          await client.query(
            `UPDATE lot_versions SET evidence = $1::jsonb WHERE id = $2`,
            [evidence, validated.rowId],
          );
        }
        upserted++;
      } else {
        if (geomJson) {
          await client.query(
            `INSERT INTO lot_versions
               (canonical_id, no_lot, city_slug, recon_status, valid_from, known_from,
                geom, geom_source, raw_ref, evidence)
             VALUES
               ($1, $2, $3, 'validated', $4::date, $5::timestamptz,
                ST_SetSRID(ST_GeomFromGeoJSON($6), 4326), 'ogc-api', $7, $8::jsonb)`,
            [
              validated.decision.canonicalId,
              noLotNorm,
              citySlug,
              today,
              now,
              geomJson,
              validated.decision.rawRef,
              evidence,
            ],
          );
        } else {
          await client.query(
            `INSERT INTO lot_versions
               (canonical_id, no_lot, city_slug, recon_status, valid_from, known_from,
                geom_source, raw_ref, evidence)
             VALUES
               ($1, $2, $3, 'validated', $4::date, $5::timestamptz,
                'none', $6, $7::jsonb)`,
            [
              validated.decision.canonicalId,
              noLotNorm,
              citySlug,
              today,
              now,
              validated.decision.rawRef,
              evidence,
            ],
          );
        }
        upserted++;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { upserted, skipped };
}

/**
 * Ordre de priorité pour la lecture du code de zone dans les propriétés OGC.
 *
 * Couvre les attributs rencontrés sur les différentes grilles québécoises :
 *  - NUM_ZONE   : mont-tremblant (arcgis)
 *  - NO_ZONAGE  : rimouski
 *  - CODE_MUN   : saint-eustache, sainte-catherine, etc.
 *  - CODE / code / ZONAGE / zonage : autres variantes connues
 */
export const ZONE_CODE_ATTRS = [
  "NUM_ZONE",
  "NO_ZONAGE",
  "ZONE_CODE",
  "zone_code",
  "CODE_ZONE",
  "code_zone",
  "CODE_MUN",
  "code_mun",
  "ZONE",
  "zone",
  "CODE",
  "code",
  "ZONAGE",
  "zonage",
] as const;

/**
 * Extrait le premier attribut de code de zone non-vide dans les propriétés d'une feature.
 * Retourne null si aucun attribut n'est trouvé.
 */
export function extractZoneCode(
  properties: Record<string, unknown>,
  featureId?: string | number,
): string | null {
  for (const attr of ZONE_CODE_ATTRS) {
    const val = properties[attr];
    if (val !== null && val !== undefined && String(val).trim() !== "") {
      return String(val);
    }
  }
  // Repli sur l'id de la feature si aucun attribut n'est trouvé
  if (featureId !== undefined && featureId !== null && String(featureId).trim() !== "") {
    return String(featureId);
  }
  return null;
}

/**
 * Upsert un batch de features zones dans zone_versions.
 * Clé : (code_affiche, city_slug) WHERE known_to IS NULL.
 *
 * Le code de zone est lu depuis les propriétés selon ZONE_CODE_ATTRS (ordre de priorité).
 * URL_GRILLE est conservé dans les métadonnées evidence si présent.
 */
export async function upsertZoneBatch(
  db: Database,
  pool: pg.Pool,
  citySlug: string,
  collectionId: string,
  features: OgcFeature[],
): Promise<{ upserted: number; skipped: number }> {
  let upserted = 0;
  let skipped = 0;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const today = todayIso();
    const now = nowIso();

    // Kind dérivé du suffixe de couche dans l'id collection
    // "qc-zonage-saint-eustache-rcu" → "rcu"
    // "qc-zonage-saint-eustache" → "zonage"
    const layerMatch = collectionId.match(/-([a-z0-9]+)$/);
    // On vérifie que le match n'est pas le slug de ville lui-même
    // (on considère qu'un suffixe de couche est court ≤ 6 chars)
    const kind =
      layerMatch && layerMatch[1]!.length <= 6 &&
      !["est", "nord", "sud", "ouest"].includes(layerMatch[1]!)
        ? layerMatch[1]!
        : "zonage";

    for (const feature of features) {
      const rawCode = extractZoneCode(feature.properties ?? {}, feature.id);

      const codeNorm = normalizeZoneCode(rawCode);
      if (!codeNorm) {
        skipped++;
        continue;
      }

      const geomJson = feature.geometry
        ? JSON.stringify(feature.geometry)
        : null;

      const canonId = zoneCanonicalId(citySlug, codeNorm);
      const rawRef = `ogc:${collectionId}:${codeNorm}`;

      // Conserver URL_GRILLE (lien PDF de la grille) si présent dans les props
      const urlGrille =
        feature.properties?.["URL_GRILLE"] ??
        feature.properties?.["url_grille"] ??
        null;
      const evidenceEntry: Record<string, unknown> = {
        source: "ogc-api",
        collectionId,
        fetchedAt: now,
        ...publicProvenanceFromProperties(feature.properties),
      };
      if (urlGrille) {
        evidenceEntry["urlGrille"] = String(urlGrille);
      }

      const existing = await client.query<{ id: string }>(
        `SELECT id FROM zone_versions
         WHERE code_affiche = $1 AND city_slug = $2 AND known_to IS NULL
         LIMIT 1`,
        [codeNorm, citySlug],
      );

      if (existing.rowCount && existing.rowCount > 0) {
        // UPDATE : toujours réécrire code_norm pour corriger les enregistrements sans code_norm
        if (geomJson) {
          await client.query(
            `UPDATE zone_versions
             SET geom = ST_SetSRID(ST_GeomFromGeoJSON($1), 4326),
                 geom_source = 'ogc-api',
                 raw_ref = $2,
                 evidence = $3::jsonb,
                 code_norm = $5
             WHERE id = $4`,
            [geomJson, rawRef, JSON.stringify([evidenceEntry]), existing.rows[0]!.id, codeNorm],
          );
        } else {
          // Pas de géom mais on met à jour code_norm quand même
          await client.query(
            `UPDATE zone_versions SET code_norm = $1, evidence = $2::jsonb WHERE id = $3`,
            [codeNorm, JSON.stringify([evidenceEntry]), existing.rows[0]!.id],
          );
        }
        upserted++;
      } else {
        if (geomJson) {
          await client.query(
            `INSERT INTO zone_versions
               (canonical_id, city_slug, code_affiche, code_norm, kind, recon_status,
                valid_from, known_from, geom, geom_source, raw_ref, evidence)
             VALUES
               ($1, $2, $3, $10, $4, 'validated',
                $5::date, $6::timestamptz,
                ST_SetSRID(ST_GeomFromGeoJSON($7), 4326), 'ogc-api', $8, $9::jsonb)`,
            [
              canonId,
              citySlug,
              codeNorm,
              kind,
              today,
              now,
              geomJson,
              rawRef,
              JSON.stringify([evidenceEntry]),
              codeNorm, // $10 = code_norm
            ],
          );
        } else {
          await client.query(
            `INSERT INTO zone_versions
               (canonical_id, city_slug, code_affiche, code_norm, kind, recon_status,
                valid_from, known_from, geom_source, raw_ref, evidence)
             VALUES
               ($1, $2, $3, $9, $4, 'validated',
                $5::date, $6::timestamptz,
                'none', $7, $8::jsonb)`,
            [
              canonId,
              citySlug,
              codeNorm,
              kind,
              today,
              now,
              rawRef,
              JSON.stringify([evidenceEntry]),
              codeNorm, // $9 = code_norm
            ],
          );
        }
        upserted++;
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  return { upserted, skipped };
}

// ─── Main pull function ───────────────────────────────────────────────────────

const silentLogger: Required<PullGeoOgcOptions>["logger"] = {
  info: (_obj: unknown, _msg?: string) => {},
  warn: (_obj: unknown, _msg?: string) => {},
  error: (_obj: unknown, _msg?: string) => {},
};

/**
 * Pull lots et zones pour une liste de villes depuis l'API OGC geo
 * et les upsert dans Postgres.
 *
 * @param db        Drizzle Database handle
 * @param pool      pg.Pool brut pour les requêtes PostGIS
 * @param citySlugs Liste de slugs ville (ex. ["saint-eustache", "sainte-catherine"])
 * @param opts      Options du pull
 */
export async function pullGeoOgc(
  db: Database,
  pool: pg.Pool,
  citySlugs: string[],
  opts: PullGeoOgcOptions = {},
): Promise<PullResult[]> {
  const {
    baseUrl = DEFAULT_OGC_BASE_URL,
    pageSize = DEFAULT_PAGE_SIZE,
    pullLots = true,
    pullZones = true,
    zoneCollectionOverrides = {},
    fetchImpl = fetch,
    logger = silentLogger,
  } = opts;

  // Charger le catalogue une fois (seulement si nécessaire pour les collections sans override)
  const needsCatalogueForLots = pullLots;
  // On a besoin du catalogue pour les zones seulement si au moins une ville n'a pas d'override
  const needsCatalogueForZones =
    pullZones &&
    citySlugs.some((slug) => !zoneCollectionOverrides[slug]);

  logger.info({ baseUrl }, "ogc-pull: chargement catalogue collections");
  const lotsCollIds = needsCatalogueForLots
    ? await fetchCollectionIds(baseUrl, "qc-lots-", fetchImpl)
    : [];
  const zoneCollIds = needsCatalogueForZones
    ? await fetchCollectionIds(baseUrl, "qc-zonage-", fetchImpl)
    : [];

  logger.info(
    {
      lots: lotsCollIds.length,
      zones: zoneCollIds.length,
      zoneOverrides: Object.keys(zoneCollectionOverrides).length,
    },
    "ogc-pull: catalogue chargé",
  );

  const results: PullResult[] = [];

  for (const citySlug of citySlugs) {
    const result: PullResult = {
      citySlug,
      lotsUpserted: 0,
      zonesUpserted: 0,
      lotsSkipped: 0,
      zonesSkipped: 0,
      errors: [],
    };

    // ── Lots ──────────────────────────────────────────────────────────────────
    if (pullLots) {
      const lotsCollId = `qc-lots-${citySlug}`;
      if (!lotsCollIds.includes(lotsCollId)) {
        logger.warn(
          { citySlug, collectionId: lotsCollId },
          "ogc-pull: collection lots absente du catalogue",
        );
        result.errors.push(`collection lots absente: ${lotsCollId}`);
      } else {
        logger.info(
          { citySlug, collectionId: lotsCollId },
          "ogc-pull: pull lots démarré",
        );
        try {
          const batch: OgcFeature[] = [];
          for await (const page of fetchCollectionFeatures(
            baseUrl,
            lotsCollId,
            pageSize,
            fetchImpl,
          )) {
            batch.push(...page);
            while (batch.length >= BATCH_SIZE) {
              const slice = batch.splice(0, BATCH_SIZE);
              const r = await upsertLotBatch(db, pool, citySlug, slice);
              result.lotsUpserted += r.upserted;
              result.lotsSkipped += r.skipped;
              logger.info(
                { citySlug, upserted: r.upserted, total: result.lotsUpserted },
                "ogc-pull: batch lots upserted",
              );
            }
          }
          if (batch.length > 0) {
            const r = await upsertLotBatch(db, pool, citySlug, batch);
            result.lotsUpserted += r.upserted;
            result.lotsSkipped += r.skipped;
          }
          logger.info(
            {
              citySlug,
              lotsUpserted: result.lotsUpserted,
              lotsSkipped: result.lotsSkipped,
            },
            "ogc-pull: lots terminé",
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error({ citySlug, err: msg }, "ogc-pull: erreur lots");
          result.errors.push(`lots: ${msg}`);
        }
      }
    }

    // ── Zones ─────────────────────────────────────────────────────────────────
    if (pullZones) {
      // Si un override de collection exacte est fourni pour cette ville,
      // on l'utilise directement sans passer par le catalogue par préfixe.
      const overrideCollId = zoneCollectionOverrides[citySlug];
      const cityZoneCollIds = overrideCollId
        ? [overrideCollId]
        : zoneCollIds.filter(
            (id) =>
              id === `qc-zonage-${citySlug}` ||
              id.startsWith(`qc-zonage-${citySlug}-`),
          );

      if (overrideCollId) {
        logger.info(
          { citySlug, collectionId: overrideCollId },
          "ogc-pull: utilisation override collection zones",
        );
      } else if (cityZoneCollIds.length === 0) {
        logger.warn(
          { citySlug },
          "ogc-pull: aucune collection zones pour cette ville",
        );
      }

      for (const zoneCollId of cityZoneCollIds) {
        logger.info(
          { citySlug, collectionId: zoneCollId },
          "ogc-pull: pull zones démarré",
        );
        try {
          const batch: OgcFeature[] = [];
          for await (const page of fetchCollectionFeatures(
            baseUrl,
            zoneCollId,
            pageSize,
            fetchImpl,
          )) {
            batch.push(...page);
            while (batch.length >= BATCH_SIZE) {
              const slice = batch.splice(0, BATCH_SIZE);
              const r = await upsertZoneBatch(db, pool, citySlug, zoneCollId, slice);
              result.zonesUpserted += r.upserted;
              result.zonesSkipped += r.skipped;
            }
          }
          if (batch.length > 0) {
            const r = await upsertZoneBatch(db, pool, citySlug, zoneCollId, batch);
            result.zonesUpserted += r.upserted;
            result.zonesSkipped += r.skipped;
          }
          logger.info(
            {
              citySlug,
              collectionId: zoneCollId,
              zonesUpserted: result.zonesUpserted,
            },
            "ogc-pull: zones terminé",
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(
            { citySlug, collectionId: zoneCollId, err: msg },
            "ogc-pull: erreur zones",
          );
          result.errors.push(`zones(${zoneCollId}): ${msg}`);
        }
      }
    }

    results.push(result);
  }

  return results;
}
