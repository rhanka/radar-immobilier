/**
 * Runner : applique le mapping géo sur toutes les villes avec données OGC.
 *
 * Lit les graph_nodes (Signal + DesignationEvent) par ville,
 * résout les zones et lots via matchZoneMultiLevel,
 * écrit les résultats dans geo_resolutions et geo_unresolved (idempotent).
 *
 * Usage :
 *   DATABASE_URL="postgres://radar:...@127.0.0.1:5434/radar" npx tsx src/services/geo/run-geo-mapper.ts
 *
 * Options via env :
 *   CITIES="mont-tremblant,rimouski"  — restreindre à ces villes (séparé par virgule)
 *   DRY_RUN="1"                       — affiche seulement, n'écrit pas en DB
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { sql } from "drizzle-orm";
import * as schema from "../../db/schema.js";
import { resolveGeoRefsBatch, type GeoResolveInput } from "./resolve-refs.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://radar:219c0ff1da554bfd05e410b35f32a114319599423f6a96d8@127.0.0.1:5434/radar";

const DRY_RUN = process.env["DRY_RUN"] === "1";
const CITIES_FILTER = process.env["CITIES"]
  ? process.env["CITIES"].split(",").map((s) => s.trim())
  : null;

// ─── DB setup ─────────────────────────────────────────────────────────────────

const pool = new pg.Pool({ connectionString: DATABASE_URL });
const db = drizzle(pool, { schema });

// ─── Exécution ────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Runner geo-mapper ===");
  if (DRY_RUN) console.log("MODE DRY_RUN — aucune écriture DB");

  // Villes avec au moins une zone_version OU lot_version
  const citiesWithGeo = await db.execute<{ city_slug: string }>(sql`
    SELECT DISTINCT city_slug FROM (
      SELECT city_slug FROM zone_versions WHERE known_to IS NULL
      UNION
      SELECT city_slug FROM lot_versions WHERE known_to IS NULL
    ) t
    ORDER BY city_slug
  `);

  const cityList = citiesWithGeo.rows
    .map((r) => r.city_slug)
    .filter((c) => !CITIES_FILTER || CITIES_FILTER.includes(c));

  console.log(`Villes cibles : ${cityList.join(", ")}`);
  console.log(`Total : ${cityList.length} villes\n`);

  let totalResolved = 0;
  let totalUnresolved = 0;
  let totalNodes = 0;

  for (const citySlug of cityList) {
    // Récupérer les nodes Signal/DesignationEvent de cette ville
    const nodes = await db.execute<{
      id: string;
      label: string;
      description: string | null;
      zone_ref: string | null;
      no_lot: string | null;
      citation: string | null;
      excerpts: string[] | null;
      as_of_date: string | null;
    }>(sql`
      SELECT
        gn.id,
        gn.label,
        gn.props->'properties'->>'description' as description,
        gn.props->'properties'->>'zone_ref' as zone_ref,
        gn.props->'properties'->>'no_lot' as no_lot,
        gn.props->'properties'->>'citation' as citation,
        ARRAY(
          SELECT r->>'excerpt'
          FROM jsonb_array_elements(gn.props->'properties'->'refs') AS r
          WHERE r->>'excerpt' IS NOT NULL
        ) as excerpts,
        gn.props->'properties'->>'as_of_date' as as_of_date
      FROM graph_nodes gn
      WHERE gn.city_slug = ${citySlug}
        AND gn.type IN ('Signal', 'DesignationEvent')
    `);

    if (nodes.rows.length === 0) continue;

    const inputs: GeoResolveInput[] = nodes.rows.map((n) => ({
      nodeId: n.id,
      nodeType: "Signal" as const, // résolution identique pour les deux types
      citySlug,
      label: n.label ?? "",
      description: n.description,
      zoneRef: n.zone_ref,
      noLot: n.no_lot,
      citation: n.citation,
      excerpts: n.excerpts ?? undefined,
      asOfDate: n.as_of_date,
    }));

    if (DRY_RUN) {
      console.log(`[DRY] ${citySlug}: ${inputs.length} nodes (pas d'écriture)`);
      totalNodes += inputs.length;
      continue;
    }

    const stats = await resolveGeoRefsBatch(db, inputs);
    totalNodes += stats.total;
    totalResolved += stats.resolvedZones + stats.resolvedLots;
    totalUnresolved += stats.unresolvedZones + stats.unresolvedLots;

    console.log(
      `${citySlug}: ${stats.total} nodes — ` +
      `zones_résolues=${stats.resolvedZones} zones_non=${stats.unresolvedZones} ` +
      `lots_résolus=${stats.resolvedLots} lots_non=${stats.unresolvedLots}`,
    );
  }

  if (!DRY_RUN) {
    // Comptage final geo_resolutions
    const countRes = await db.execute<{ count: string }>(sql`SELECT count(*) as count FROM geo_resolutions`);
    const countUnres = await db.execute<{ count: string }>(sql`SELECT count(*) as count FROM geo_unresolved`);
    console.log(`\nTotal nodes traités    : ${totalNodes}`);
    console.log(`Total résolus (session): ${totalResolved}`);
    console.log(`Total non-résolus (session): ${totalUnresolved}`);
    console.log(`geo_resolutions (total DB) : ${countRes.rows[0]?.count ?? "?"}`);
    console.log(`geo_unresolved  (total DB) : ${countUnres.rows[0]?.count ?? "?"}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
