/**
 * WP3 LOT1 — Job batch : calcule et matérialise le snapshot de cohérence E2E
 * (E0 PV↔signal, E1 signal↔zone) par ville dans `consistency_snapshots`.
 *
 * Usage (régénérer le snapshot) :
 *   DATABASE_URL="postgres://radar:...@127.0.0.1:5434/radar" \
 *     npx tsx src/services/consistency/run-consistency-snapshot.ts
 *
 *   # ou, dans un environnement déployé :
 *   make exec-api CMD="npx tsx src/services/consistency/run-consistency-snapshot.ts" ENV=<env>
 *
 * Options via env :
 *   CITIES="mont-tremblant,rimouski"  — restreint aux villes listées (prime sur SCOPE).
 *   SCOPE="province"                 — toutes les villes QC_MUNICIPALITIES
 *                                       (au lieu du focus-30 par défaut).
 *
 * Déploiement prod : `deploy/k8s/35-consistency-snapshot-cronjob.yaml`
 * exécute `node dist/services/consistency/run-consistency-snapshot.js` après la
 * projection nightly. IMPORTANT : E1 dépend de la sortie du mapper #74
 * (`run-geo-mapper.ts`). Si `geo_resolutions`/`geo_unresolved` sont vides, le
 * job écrit honnêtement `non_mesure` pour l'arête signal→zone.
 *
 * Périmètre par défaut : FOCUS-30 (villes `priorityRank` 1..30 — cf.
 * docs/spec/SPEC_CONSOLIDATED_2026-07.md §1.2, `QC_MUNICIPALITIES` déjà triée
 * priorityRank ascendant). Idempotent : upsert sur city_slug, un run réécrit
 * chaque ligne avec la mesure la plus récente. Aucune ré-extraction : lit
 * exclusivement la sortie déjà produite par le mapper #74
 * (`run-geo-mapper.ts` → `geo_resolutions`/`geo_unresolved`) — si le mapper
 * n'a jamais tourné pour une ville, celle-ci ressort `non_mesure` (E1) sans
 * rien fabriquer.
 */
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "../../db/schema.js";
import { QC_MUNICIPALITIES } from "@radar/sources";
import { loadCityConsistencyRawInputs } from "./load-consistency-raw.js";
import { deriveCityConsistency } from "./consistency-calc.js";
import { writeConsistencySnapshots } from "./consistency-snapshot-store.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://radar:219c0ff1da554bfd05e410b35f32a114319599423f6a96d8@127.0.0.1:5434/radar";

const CITIES_FILTER = process.env["CITIES"]
  ? process.env["CITIES"].split(",").map((s) => s.trim()).filter(Boolean)
  : null;
const SCOPE = process.env["SCOPE"] ?? "focus30";
const FOCUS_30_SIZE = 30;


interface GeoMapperDiagnostics {
  resolutionsTotal: number;
  resolutionsByRelation: Record<string, number>;
  unresolvedTotal: number;
  unresolvedByPatternAndReason: Record<string, number>;
}

async function loadGeoMapperDiagnostics(db: ReturnType<typeof drizzle<typeof schema>>): Promise<GeoMapperDiagnostics> {
  const [resTotal, resByRelation, unresTotal, unresByReason] = await Promise.all([
    db.execute<{ count: number }>(sql`select count(*)::int as count from geo_resolutions`),
    db.execute<{ relation_type: string; count: number }>(sql`
      select relation_type, count(*)::int as count
      from geo_resolutions
      group by relation_type
      order by relation_type
    `),
    db.execute<{ count: number }>(sql`select count(*)::int as count from geo_unresolved`),
    db.execute<{ pattern_type: string; raison: string; count: number }>(sql`
      select pattern_type, raison, count(*)::int as count
      from geo_unresolved
      group by pattern_type, raison
      order by pattern_type, raison
    `),
  ]);

  return {
    resolutionsTotal: Number(resTotal.rows[0]?.count ?? 0),
    resolutionsByRelation: Object.fromEntries(
      resByRelation.rows.map((r) => [r.relation_type, Number(r.count ?? 0)]),
    ),
    unresolvedTotal: Number(unresTotal.rows[0]?.count ?? 0),
    unresolvedByPatternAndReason: Object.fromEntries(
      unresByReason.rows.map((r) => [`${r.pattern_type}:${r.raison}`, Number(r.count ?? 0)]),
    ),
  };
}

function logGeoMapperDiagnostics(diag: GeoMapperDiagnostics): void {
  console.log(
    `geo_resolutions: total=${diag.resolutionsTotal} byRelation=${JSON.stringify(diag.resolutionsByRelation)}`,
  );
  console.log(
    `geo_unresolved: total=${diag.unresolvedTotal} byPatternReason=${JSON.stringify(diag.unresolvedByPatternAndReason)}`,
  );
  if (diag.resolutionsTotal + diag.unresolvedTotal === 0) {
    console.warn(
      "Mapper #74: aucune ligne geo_resolutions/geo_unresolved — E1 signal→zone sera non_mesure tant que run-geo-mapper n'a pas tourné en prod.",
    );
  }
}

function targetCities(): string[] {
  if (CITIES_FILTER && CITIES_FILTER.length > 0) return CITIES_FILTER;
  if (SCOPE === "province") return QC_MUNICIPALITIES.map((m) => m.slug);
  // QC_MUNICIPALITIES est déjà trié priorityRank ascendant (proximité
  // Montréal), exclus appendus en fin de liste (cf. municipalities.ts) :
  // les FOCUS_30_SIZE premières entrées SONT le focus 30 (priorityRank 1..30).
  return QC_MUNICIPALITIES.slice(0, FOCUS_30_SIZE).map((m) => m.slug);
}

async function main(): Promise<void> {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const db = drizzle(pool, { schema });
  try {
    const cities = targetCities();
    const scopeLabel = CITIES_FILTER && CITIES_FILTER.length > 0 ? "CITIES" : SCOPE;
    console.log(`=== Snapshot cohérence E2E (WP3 LOT1) — ${cities.length} ville(s), scope=${scopeLabel} ===`);

    const diagnostics = await loadGeoMapperDiagnostics(db);
    logGeoMapperDiagnostics(diagnostics);

    const rawInputs = await loadCityConsistencyRawInputs(db, cities);
    const generatedAt = new Date().toISOString();
    const consistencies = rawInputs.map((raw) => deriveCityConsistency(raw, generatedAt));

    await writeConsistencySnapshots(db, consistencies);

    const byState = { coherent: 0, partial: 0, unmeasured: 0 };
    const byE1 = { measured: 0, non_applicable: 0, non_mesure: 0 };
    for (const c of consistencies) {
      byState[c.state] += 1;
      byE1[c.edges.signalZone.status] += 1;
    }
    console.log(
      `Écrit ${consistencies.length} snapshot(s) — ` +
        `state: coherent=${byState.coherent} partial=${byState.partial} unmeasured=${byState.unmeasured}; ` +
        `E1 signal→zone: measured=${byE1.measured} non_applicable=${byE1.non_applicable} non_mesure=${byE1.non_mesure}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
