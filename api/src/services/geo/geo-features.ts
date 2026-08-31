/**
 * Service geo-features — G3 WP géo-intégration.
 *
 * Produit une FeatureCollection GeoJSON fusionnée pour la vue `/geo` :
 *   - Polygones zones (zone_versions avec geom + résolutions géo)
 *   - Polygones lots (lot_versions avec geom)
 *   - Points opportunités (graph_nodes Signal/DesignationEvent)
 *
 * Loi 25 : zonage public, aucune PII propriétaire.
 * Anti-invention : champs absents → null, jamais inventés.
 */

import { sql, and, eq, isNotNull, inArray } from "drizzle-orm";
import type { Database } from "../../db/client.js";
import { zoneVersions, lotVersions, geoResolutions, graphNodes } from "../../db/schema.js";
import { publicProvenanceFromEvidence } from "./provenance.js";
import {
  readRegulatoryStatus,
  aggregateRegulatoryStatus,
  type RegulatoryStatusT,
  type RegulatoryStageKindT,
} from "@radar/domain";

/** Lit le regulatoryStatus SERVI d'une ligne graph_node (locus unique R5) : champ
 *  persisté `props.properties.regulatoryStatus` (A.2) sinon fallback legacy depuis
 *  statut/etape — jamais une re-classification indépendante. */
function rowRegulatoryStatus(row: {
  regulatoryStatus: string | null;
  statut: string | null;
  etape: string | null;
}): RegulatoryStatusT {
  return readRegulatoryStatus({
    regulatoryStatus:
      row.regulatoryStatus === "firm" || row.regulatoryStatus === "anticipation"
        ? row.regulatoryStatus
        : null,
    statut: row.statut as RegulatoryStageKindT | null,
    etape: row.etape,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Types GeoJSON minimaux
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoJsonGeometry {
  type: string;
  coordinates: unknown;
}

export interface GeoJsonFeature {
  type: "Feature";
  geometry: GeoJsonGeometry | null;
  properties: Record<string, unknown>;
}

export interface GeoFeatureCollection {
  type: "FeatureCollection";
  features: GeoJsonFeature[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Properties publiques exposées (Loi 25 — aucune PII)
// ─────────────────────────────────────────────────────────────────────────────

export interface ZoneFeatureProperties {
  featureKind: "zone";
  zoneVersionId: string;
  canonicalId: string;
  zoneCode: string;
  zoneUsage: string | null;
  citySlug: string;
  signalCount: number;
  category: string | null;
  anticipation: string | null;
  /** Ferme vs anticipation AGRÉGÉ pour la zone (R5, invariant REVERSE) : ferme dès
   *  qu'≥1 nœud rattaché est ferme (via aggregateRegulatoryStatus) — un nœud-Bylaw
   *  adopté sans stade hérite du ferme de son adoption frère. `null` si aucun nœud. */
  regulatoryStatus: RegulatoryStatusT | null;
  geomSource: string;
  geomFetchedAt: string | null;
  proof?: Record<string, unknown>;
  immo_zone_lot_provenance?: Record<string, unknown>;
}

export interface LotFeatureProperties {
  featureKind: "lot";
  lotVersionId: string;
  canonicalId: string;
  noLot: string;
  citySlug: string;
  superficieM2: number | null;
  usage: string | null;
  zoneCode: string | null;
  signalCount: number;
  category: string | null;
  geomSource: string;
  geomFetchedAt: string | null;
  proof?: Record<string, unknown>;
  immo_zone_lot_provenance?: Record<string, unknown>;
}

export interface OpportuniteFeatureProperties {
  featureKind: "opportunite";
  signalId: string;
  type: string;
  label: string;
  citySlug: string;
  category: string | null;
  etape: string | null;
  /** Ferme vs anticipation SERVI par nœud (axe MARQUAGE, R5) : champ persisté A.2
   *  LU tel quel sinon fallback legacy — jamais re-classifié. Pas le hide-72. */
  regulatoryStatus: RegulatoryStatusT;
  date: string | null;
  sourceRef: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse une géométrie PostGIS retournée en GeoJSON texte (ST_AsGeoJSON).
 * Retourne null si absent ou invalide.
 */
function parseGeom(raw: string | null | undefined): GeoJsonGeometry | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as GeoJsonGeometry;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zones : FeatureCollection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résolutions géo par zone (canonical_id → { signalCount, category dominante, anticipation }).
 */
export async function buildZoneResolutionMap(
  db: Database,
  citySlug: string,
): Promise<
  Map<
    string,
    {
      signalCount: number;
      category: string | null;
      anticipation: string | null;
      regulatoryStatus: RegulatoryStatusT | null;
    }
  >
> {
  const resRows = await db
    .select({
      targetId: geoResolutions.targetId,
      nodeId: geoResolutions.nodeId,
    })
    .from(geoResolutions)
    .where(
      and(
        eq(geoResolutions.citySlug, citySlug),
        eq(geoResolutions.relationType, "concerns_zone"),
      ),
    );

  if (resRows.length === 0) return new Map();

  const nodeIds = [...new Set(resRows.map((r) => r.nodeId))];
  const nodeRows = await db
    .select({
      id: graphNodes.id,
      category: sql<string | null>`${graphNodes.props}->'properties'->>'category'`,
      etape: sql<string | null>`${graphNodes.props}->'properties'->>'etape'`,
      statut: sql<string | null>`${graphNodes.props}->'properties'->>'statut'`,
      regulatoryStatus: sql<string | null>`${graphNodes.props}->'properties'->>'regulatoryStatus'`,
    })
    .from(graphNodes)
    .where(inArray(graphNodes.id, nodeIds));

  const nodeMap = new Map(nodeRows.map((n) => [n.id, n]));

  const byZone = new Map<
    string,
    { signalCount: number; categories: string[]; etapes: string[]; regStatuses: RegulatoryStatusT[] }
  >();

  for (const res of resRows) {
    if (!byZone.has(res.targetId)) {
      byZone.set(res.targetId, { signalCount: 0, categories: [], etapes: [], regStatuses: [] });
    }
    const entry = byZone.get(res.targetId)!;
    entry.signalCount += 1;
    const node = nodeMap.get(res.nodeId);
    if (node?.category) entry.categories.push(node.category);
    if (node?.etape) entry.etapes.push(node.etape);
    // R5 invariant REVERSE : on collecte le regulatoryStatus SERVI (persisté sinon
    // fallback legacy) de CHAQUE nœud rattaché à la zone pour l'agréger (firm dès
    // qu'≥1 nœud firm) — l'adoption prime sur l'avis frère.
    if (node) entry.regStatuses.push(rowRegulatoryStatus(node));
  }

  const result = new Map<
    string,
    {
      signalCount: number;
      category: string | null;
      anticipation: string | null;
      regulatoryStatus: RegulatoryStatusT | null;
    }
  >();
  for (const [zoneId, data] of byZone.entries()) {
    result.set(zoneId, {
      signalCount: data.signalCount,
      category: data.categories[0] ?? null,
      anticipation: data.etapes[0] ?? null,
      regulatoryStatus:
        data.regStatuses.length > 0 ? aggregateRegulatoryStatus(data.regStatuses) : null,
    });
  }
  return result;
}

/**
 * Retourne la FeatureCollection des zones pour une ville (geom non-nulles seulement).
 */
export async function getZoneFeatures(
  db: Database,
  citySlug: string,
): Promise<GeoFeatureCollection> {
  const resMap = await buildZoneResolutionMap(db, citySlug);

  const rows = await db
    .select({
      id: zoneVersions.id,
      canonicalId: zoneVersions.canonicalId,
      codeAffiche: zoneVersions.codeAffiche,
      kind: zoneVersions.kind,
      geomJson: sql<string | null>`ST_AsGeoJSON(${zoneVersions.geom})`,
      geomSource: zoneVersions.geomSource,
      geomFetchedAt: zoneVersions.geomFetchedAt,
      citySlug: zoneVersions.citySlug,
      evidence: zoneVersions.evidence,
    })
    .from(zoneVersions)
    .where(
      and(
        eq(zoneVersions.citySlug, citySlug),
        isNotNull(zoneVersions.geom),
      ),
    );

  const features: GeoJsonFeature[] = rows.map((row) => {
    const res = resMap.get(row.canonicalId);
    const props: ZoneFeatureProperties = {
      featureKind: "zone",
      zoneVersionId: row.id,
      canonicalId: row.canonicalId,
      zoneCode: row.codeAffiche,
      zoneUsage: row.kind ?? null,
      citySlug: row.citySlug,
      signalCount: res?.signalCount ?? 0,
      category: res?.category ?? null,
      anticipation: res?.anticipation ?? null,
      regulatoryStatus: res?.regulatoryStatus ?? null,
      geomSource: row.geomSource,
      geomFetchedAt: row.geomFetchedAt ? row.geomFetchedAt.toISOString() : null,
      ...publicProvenanceFromEvidence(row.evidence),
    };
    return {
      type: "Feature" as const,
      geometry: parseGeom(row.geomJson),
      properties: props as unknown as Record<string, unknown>,
    };
  });

  return { type: "FeatureCollection", features };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lots : FeatureCollection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la FeatureCollection des lots pour une ville (geom non-nulles seulement).
 */
export async function getLotFeatures(
  db: Database,
  citySlug: string,
): Promise<GeoFeatureCollection> {
  const rows = await db
    .select({
      id: lotVersions.id,
      canonicalId: lotVersions.canonicalId,
      noLot: lotVersions.noLot,
      geomJson: sql<string | null>`ST_AsGeoJSON(${lotVersions.geom})`,
      geomSource: lotVersions.geomSource,
      geomFetchedAt: lotVersions.geomFetchedAt,
      citySlug: lotVersions.citySlug,
      evidence: lotVersions.evidence,
    })
    .from(lotVersions)
    .where(
      and(
        eq(lotVersions.citySlug, citySlug),
        isNotNull(lotVersions.geom),
      ),
    );

  const features: GeoJsonFeature[] = rows.map((row) => {
    const props: LotFeatureProperties = {
      featureKind: "lot",
      lotVersionId: row.id,
      canonicalId: row.canonicalId,
      noLot: row.noLot,
      citySlug: row.citySlug,
      superficieM2: null,
      usage: null,
      zoneCode: null,
      signalCount: 0,
      category: null,
      geomSource: row.geomSource,
      geomFetchedAt: row.geomFetchedAt ? row.geomFetchedAt.toISOString() : null,
      ...publicProvenanceFromEvidence(row.evidence),
    };
    return {
      type: "Feature" as const,
      geometry: parseGeom(row.geomJson),
      properties: props as unknown as Record<string, unknown>,
    };
  });

  return { type: "FeatureCollection", features };
}

// ─────────────────────────────────────────────────────────────────────────────
// Opportunités (Signal/DesignationEvent) : FeatureCollection points
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Retourne la FeatureCollection des opportunités pour une ville.
 * geometry: null pour les nœuds sans coordonnées géo.
 */
export async function getOpportuniteFeatures(
  db: Database,
  citySlug: string,
): Promise<GeoFeatureCollection> {
  const rows = await db
    .select({
      id: graphNodes.id,
      type: graphNodes.type,
      label: graphNodes.label,
      citySlug: graphNodes.citySlug,
      sourceRef: graphNodes.sourceRef,
      // `created_at` volontairement PAS sélectionné : la prod OVH n'a pas cette
      // colonne sur graph_nodes (drift, cf #468 + mémoire ovh-schema-drift-
      // created-at) → un SELECT created_at y 500e et casse la carte opportunités
      // (qui sert etape/etape_date v3.4). etape/etape_date restent inchangés.
      category: sql<string | null>`${graphNodes.props}->'properties'->>'category'`,
      etape: sql<string | null>`${graphNodes.props}->'properties'->>'etape'`,
      statut: sql<string | null>`${graphNodes.props}->'properties'->>'statut'`,
      regulatoryStatus: sql<string | null>`${graphNodes.props}->'properties'->>'regulatoryStatus'`,
      etapeDate: sql<string | null>`${graphNodes.props}->'properties'->>'etape_date'`,
      lat: sql<string | null>`${graphNodes.props}->'properties'->>'lat'`,
      lon: sql<string | null>`${graphNodes.props}->'properties'->>'lon'`,
    })
    .from(graphNodes)
    .where(
      and(
        inArray(graphNodes.type, ["Signal", "DesignationEvent"]),
        eq(graphNodes.citySlug, citySlug),
      ),
    );

  const features: GeoJsonFeature[] = rows.map((row) => {
    const lat = row.lat ? parseFloat(row.lat) : null;
    const lon = row.lon ? parseFloat(row.lon) : null;
    const hasPoint = lat !== null && lon !== null && !isNaN(lat) && !isNaN(lon);

    const props: OpportuniteFeatureProperties = {
      featureKind: "opportunite",
      signalId: row.id,
      type: row.type,
      label: row.label,
      citySlug: row.citySlug ?? citySlug,
      category: row.category,
      etape: row.etape,
      regulatoryStatus: rowRegulatoryStatus(row),
      // etape_date (v3.4) reste la source de date ; le repli createdAt est retiré
      // (colonne absente OVH — voir le SELECT ci-dessus). Quand etape_date manque,
      // date=null (dégradation acceptable ; createdAt n'existait pas sur OVH).
      date: row.etapeDate ?? null,
      sourceRef: row.sourceRef,
    };

    return {
      type: "Feature" as const,
      geometry: hasPoint
        ? { type: "Point", coordinates: [lon, lat] }
        : null,
      properties: props as unknown as Record<string, unknown>,
    };
  });

  return { type: "FeatureCollection", features };
}

// ─────────────────────────────────────────────────────────────────────────────
// Résultat fusionné pour GET /api/geo/features/:citySlug
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoFeaturesResult {
  citySlug: string;
  zoneCount: number;
  lotCount: number;
  opportuniteCount: number;
  zones: GeoFeatureCollection;
  lots: GeoFeatureCollection;
  opportunites: GeoFeatureCollection;
}

export async function getGeoFeatures(
  db: Database,
  citySlug: string,
): Promise<GeoFeaturesResult> {
  const [zones, lots, opportunites] = await Promise.all([
    getZoneFeatures(db, citySlug),
    getLotFeatures(db, citySlug),
    getOpportuniteFeatures(db, citySlug),
  ]);

  return {
    citySlug,
    zoneCount: zones.features.length,
    lotCount: lots.features.length,
    opportuniteCount: opportunites.features.length,
    zones,
    lots,
    opportunites,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Villes avec données géo ou résolutions
// ─────────────────────────────────────────────────────────────────────────────

export interface GeoCityInfo {
  citySlug: string;
  zoneCount: number;
  lotCount: number;
  signalCount: number;
}

/**
 * Retourne la liste des villes ayant des zones, des lots ou des résolutions.
 * Utilisé par le sélecteur de ville de GeoView.
 */
export async function listGeoCities(db: Database): Promise<GeoCityInfo[]> {
  const zoneRows = await db
    .select({
      citySlug: zoneVersions.citySlug,
      count: sql<number>`count(*)::int`,
    })
    .from(zoneVersions)
    .where(isNotNull(zoneVersions.geom))
    .groupBy(zoneVersions.citySlug);

  const lotRows = await db
    .select({
      citySlug: lotVersions.citySlug,
      count: sql<number>`count(*)::int`,
    })
    .from(lotVersions)
    .where(isNotNull(lotVersions.geom))
    .groupBy(lotVersions.citySlug);

  const resRows = await db
    .select({
      citySlug: geoResolutions.citySlug,
      count: sql<number>`count(*)::int`,
    })
    .from(geoResolutions)
    .groupBy(geoResolutions.citySlug);

  const byCity = new Map<string, GeoCityInfo>();

  for (const r of zoneRows) {
    if (!r.citySlug) continue;
    if (!byCity.has(r.citySlug)) {
      byCity.set(r.citySlug, {
        citySlug: r.citySlug,
        zoneCount: 0,
        lotCount: 0,
        signalCount: 0,
      });
    }
    byCity.get(r.citySlug)!.zoneCount = r.count;
  }

  for (const r of lotRows) {
    if (!r.citySlug) continue;
    if (!byCity.has(r.citySlug)) {
      byCity.set(r.citySlug, {
        citySlug: r.citySlug,
        zoneCount: 0,
        lotCount: 0,
        signalCount: 0,
      });
    }
    byCity.get(r.citySlug)!.lotCount = r.count;
  }

  for (const r of resRows) {
    if (!r.citySlug) continue;
    if (!byCity.has(r.citySlug)) {
      byCity.set(r.citySlug, {
        citySlug: r.citySlug,
        zoneCount: 0,
        lotCount: 0,
        signalCount: 0,
      });
    }
    byCity.get(r.citySlug)!.signalCount = r.count;
  }

  return Array.from(byCity.values()).sort(
    (a, b) =>
      b.zoneCount + b.lotCount + b.signalCount -
      (a.zoneCount + a.lotCount + a.signalCount),
  );
}
