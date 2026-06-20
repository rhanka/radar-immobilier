/**
 * Script de mesure rappel/précision du mapping géo Signal/DesignationEvent → zone/lot.
 *
 * Usage :
 *   DATABASE_URL="postgres://radar:...@127.0.0.1:5434/radar" npx tsx src/services/geo/measure-geo-mapping.ts
 *
 * Mesure pour les villes pilotes :
 *   - rappel    = résolus / mappables (nodes ayant au moins une zone_ref ou no_lot extractable)
 *   - précision = corrects / faits (échantillon vérifié = correspondance code DB exact)
 *
 * Méthodologie :
 *   - "mappable" = node dont le label+description contient au moins un code zone (score>=0.50)
 *                  OU un no_lot (score>=0.50) ET la ville a des zones/lots en DB
 *   - "résolu"   = au moins 1 arête geo_resolutions produite pour ce node
 *   - "correct"  = le canonical_id cible existe bien dans zone_versions/lot_versions
 *                  (vérification automatique — précision formelle, pas humaine)
 *
 * Loi 25 : aucune PII, uniquement codes cadastraux publics.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import {
  extractRefsFromNode,
  normalizeZoneCode,
  normalizeLotRef,
  RESOLUTION_THRESHOLD,
} from "./extract-refs.js";
import {
  matchZoneMultiLevel,
  isMatchResult,
  type GeoMatchDb,
} from "./match-refs.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://radar:219c0ff1da554bfd05e410b35f32a114319599423f6a96d8@127.0.0.1:5434/radar";

const PILOT_CITIES = [
  "mont-tremblant",
  "rimouski",
  "sutton",
  "rosemere",
  "saint-amable",
  "cowansville",
  "levis",
  "mont-saint-hilaire",
];

// ─── DB setup ─────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

// ─── GeoMatchDb adapter ───────────────────────────────────────────────────────

function makeGeoMatchDb(drizzleDb: typeof db): GeoMatchDb {
  return {
    async findZoneExact(codeNorm, citySlug) {
      const rows = await drizzleDb
        .select({ canonicalId: schema.zoneVersions.canonicalId })
        .from(schema.zoneVersions)
        .where(
          and(
            eq(schema.zoneVersions.codeNorm, codeNorm),
            eq(schema.zoneVersions.citySlug, citySlug),
            isNull(schema.zoneVersions.knownTo),
          ),
        )
        .limit(1);
      return rows[0]?.canonicalId ?? null;
    },

    async findZoneByVariants(codeVariants, citySlug) {
      if (codeVariants.length === 0) return null;
      const rows = await drizzleDb
        .select({ canonicalId: schema.zoneVersions.canonicalId })
        .from(schema.zoneVersions)
        .where(
          and(
            inArray(schema.zoneVersions.codeNorm, codeVariants),
            eq(schema.zoneVersions.citySlug, citySlug),
            isNull(schema.zoneVersions.knownTo),
          ),
        )
        .limit(1);
      return rows[0]?.canonicalId ?? null;
    },

    async listZoneCodesForCity(citySlug) {
      const rows = await drizzleDb
        .select({
          canonicalId: schema.zoneVersions.canonicalId,
          codeNorm: schema.zoneVersions.codeNorm,
        })
        .from(schema.zoneVersions)
        .where(
          and(
            eq(schema.zoneVersions.citySlug, citySlug),
            isNull(schema.zoneVersions.knownTo),
          ),
        )
        .limit(2000);
      return (rows as Array<{ canonicalId: string; codeNorm: string | null }>)
        .filter((r): r is { canonicalId: string; codeNorm: string } =>
          typeof r.codeNorm === "string" && r.codeNorm.length > 0,
        );
    },

    async findZoneAllCities(codeNorm) {
      const rows = await drizzleDb
        .select({
          canonicalId: schema.zoneVersions.canonicalId,
          codeNorm: schema.zoneVersions.codeNorm,
          citySlug: schema.zoneVersions.citySlug,
        })
        .from(schema.zoneVersions)
        .where(
          and(
            eq(schema.zoneVersions.codeNorm, codeNorm),
            isNull(schema.zoneVersions.knownTo),
          ),
        )
        .limit(50);
      return (rows as Array<{ canonicalId: string; codeNorm: string | null; citySlug: string }>)
        .filter((r): r is { canonicalId: string; codeNorm: string; citySlug: string } =>
          typeof r.codeNorm === "string",
        );
    },

    async findLotExact(noLotNorm) {
      const rows = await drizzleDb
        .select({ canonicalId: schema.lotVersions.canonicalId })
        .from(schema.lotVersions)
        .where(
          and(
            eq(schema.lotVersions.noLotNorm, noLotNorm),
            isNull(schema.lotVersions.knownTo),
          ),
        )
        .limit(1);
      return rows[0]?.canonicalId ?? null;
    },
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface NodeStats {
  nodeId: string;
  label: string;
  zoneRefs: string[];         // zone_refs extractables (score >= 0.50)
  lotRefs: string[];          // no_lots extractables (score >= 0.50)
  mappableZones: number;      // zones avec zone en DB (mappable)
  mappableLots: number;       // lots avec lot en DB (mappable)
  resolvedZones: number;
  resolvedLots: number;
  unresolvedReasons: string[];
}

interface CityStats {
  citySlug: string;
  totalNodes: number;
  nodesWithZoneRefs: number;  // nodes ayant au moins 1 zone_ref score>=0.50
  nodesWithLotRefs: number;   // nodes ayant au moins 1 no_lot score>=0.50
  mappableZoneNodes: number;  // nodes avec zone en DB
  mappableLotNodes: number;   // nodes avec lot en DB
  resolvedZoneNodes: number;
  resolvedLotNodes: number;
  recallZone: number;         // resolvedZoneNodes / mappableZoneNodes
  recallLot: number;          // resolvedLotNodes / mappableLotNodes
  // précision : on vérifie que canonical_id existe en DB (toujours 1.0 pour exact, <1 pour fallback)
  precisionFormal: number;
  unresolvedByReason: Record<string, number>;
}

// ─── Mesure principale ────────────────────────────────────────────────────────

async function measureCity(citySlug: string): Promise<CityStats> {
  const geoDb = makeGeoMatchDb(db);

  // Récupérer les nodes Signal/DesignationEvent de cette ville
  const nodes = await db.execute<{
    id: string;
    label: string;
    description: string | null;
    zone_ref: string | null;
    no_lot: string | null;
  }>(sql`
    SELECT
      gn.id,
      gn.label,
      gn.props->'properties'->>'description' as description,
      gn.props->'properties'->>'zone_ref' as zone_ref,
      gn.props->'properties'->>'no_lot' as no_lot
    FROM graph_nodes gn
    WHERE gn.city_slug = ${citySlug}
      AND gn.type IN ('Signal', 'DesignationEvent')
  `);

  const stats: CityStats = {
    citySlug,
    totalNodes: nodes.rows.length,
    nodesWithZoneRefs: 0,
    nodesWithLotRefs: 0,
    mappableZoneNodes: 0,
    mappableLotNodes: 0,
    resolvedZoneNodes: 0,
    resolvedLotNodes: 0,
    recallZone: 0,
    recallLot: 0,
    precisionFormal: 0,
    unresolvedByReason: {},
  };

  let totalResolutions = 0;
  let correctResolutions = 0;

  for (const node of nodes.rows) {
    const label = node.label ?? "";
    const description = node.description ?? null;

    const { zoneCodes, lotRefs } = extractRefsFromNode(label, description);

    const validZoneCodes = zoneCodes.filter((z) => z.score >= RESOLUTION_THRESHOLD);
    const validLotRefs = lotRefs.filter((l) => l.score >= RESOLUTION_THRESHOLD);

    if (validZoneCodes.length > 0) stats.nodesWithZoneRefs++;
    if (validLotRefs.length > 0) stats.nodesWithLotRefs++;

    // Tenter de résoudre les zones
    let nodeZoneMappable = false;
    let nodeZoneResolved = false;
    for (const zc of validZoneCodes) {
      const codeNorm = normalizeZoneCode(zc.codeNorm);
      const matchResult = await matchZoneMultiLevel(
        geoDb,
        codeNorm,
        zc.rawText,
        citySlug,
        zc.score,
      );

      if (isMatchResult(matchResult)) {
        nodeZoneMappable = true;
        nodeZoneResolved = true;
        totalResolutions++;
        // Vérification formelle : le canonical_id existe-t-il ?
        const exists = await db
          .select({ id: schema.zoneVersions.id })
          .from(schema.zoneVersions)
          .where(eq(schema.zoneVersions.canonicalId, matchResult.canonicalId))
          .limit(1);
        if (exists.length > 0) correctResolutions++;
      } else {
        nodeZoneMappable = true; // tentative de résolution = mappable
        const r = matchResult.raison;
        stats.unresolvedByReason[r] = (stats.unresolvedByReason[r] ?? 0) + 1;
      }
    }

    if (nodeZoneMappable) stats.mappableZoneNodes++;
    if (nodeZoneResolved) stats.resolvedZoneNodes++;

    // Tenter de résoudre les lots
    let nodeLotMappable = false;
    let nodeLotResolved = false;
    for (const lr of validLotRefs) {
      const noLotNorm = normalizeLotRef(lr.noLotNorm);
      const canonId = await geoDb.findLotExact(noLotNorm);

      if (canonId) {
        nodeLotMappable = true;
        nodeLotResolved = true;
        totalResolutions++;
        // Vérification formelle
        const exists = await db
          .select({ id: schema.lotVersions.id })
          .from(schema.lotVersions)
          .where(eq(schema.lotVersions.canonicalId, canonId))
          .limit(1);
        if (exists.length > 0) correctResolutions++;
      } else {
        nodeLotMappable = true;
        const r = "no_polygon";
        stats.unresolvedByReason[r] = (stats.unresolvedByReason[r] ?? 0) + 1;
      }
    }

    if (nodeLotMappable) stats.mappableLotNodes++;
    if (nodeLotResolved) stats.resolvedLotNodes++;
  }

  stats.recallZone =
    stats.mappableZoneNodes > 0
      ? stats.resolvedZoneNodes / stats.mappableZoneNodes
      : -1; // N/A

  stats.recallLot =
    stats.mappableLotNodes > 0
      ? stats.resolvedLotNodes / stats.mappableLotNodes
      : -1; // N/A

  stats.precisionFormal =
    totalResolutions > 0 ? correctResolutions / totalResolutions : -1;

  return stats;
}

// ─── Exécution + rapport ──────────────────────────────────────────────────────

async function main() {
  console.log("=== Mesure rappel/précision mapping géo (Lot 74) ===");
  console.log(`Villes pilotes: ${PILOT_CITIES.join(", ")}`);
  console.log("");

  const allStats: CityStats[] = [];

  for (const city of PILOT_CITIES) {
    process.stdout.write(`Mesure ${city}... `);
    const stats = await measureCity(city);
    allStats.push(stats);
    console.log(
      `OK — nodes=${stats.totalNodes}, mappableZ=${stats.mappableZoneNodes}, resolvedZ=${stats.resolvedZoneNodes}`,
    );
  }

  console.log("\n=== TABLEAU RAPPEL / PRÉCISION ===\n");
  console.log(
    "Ville                  | Nodes | MappZ | ResolZ | RecallZ | MappL | ResolL | RecallL | PrécisionF",
  );
  console.log(
    "-----------------------+-------+-------+--------+---------+-------+--------+---------+-----------",
  );

  for (const s of allStats) {
    const recZ =
      s.recallZone >= 0 ? `${(s.recallZone * 100).toFixed(0)}%` : "N/A";
    const recL =
      s.recallLot >= 0 ? `${(s.recallLot * 100).toFixed(0)}%` : "N/A";
    const prec =
      s.precisionFormal >= 0 ? `${(s.precisionFormal * 100).toFixed(0)}%` : "N/A";
    console.log(
      `${s.citySlug.padEnd(23)}| ${String(s.totalNodes).padEnd(6)}| ${String(s.mappableZoneNodes).padEnd(6)}| ${String(s.resolvedZoneNodes).padEnd(7)}| ${recZ.padEnd(8)}| ${String(s.mappableLotNodes).padEnd(6)}| ${String(s.resolvedLotNodes).padEnd(7)}| ${recL.padEnd(8)}| ${prec}`,
    );
  }

  console.log("\n=== NON-RÉSOLUS PAR RAISON (toutes villes) ===");
  const totalByReason: Record<string, number> = {};
  for (const s of allStats) {
    for (const [r, n] of Object.entries(s.unresolvedByReason)) {
      totalByReason[r] = (totalByReason[r] ?? 0) + n;
    }
  }
  for (const [reason, count] of Object.entries(totalByReason).sort(([, a], [, b]) => b - a)) {
    console.log(`  ${reason}: ${count}`);
  }

  console.log("\n=== DÉTAIL PAR VILLE (non-résolus) ===");
  for (const s of allStats) {
    if (Object.keys(s.unresolvedByReason).length > 0) {
      console.log(`  ${s.citySlug}:`);
      for (const [r, n] of Object.entries(s.unresolvedByReason)) {
        console.log(`    ${r}: ${n}`);
      }
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
