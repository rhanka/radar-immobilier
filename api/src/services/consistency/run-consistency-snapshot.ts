/**
 * WP3 LOT1+LOT2 — Job batch : calcule et matérialise le snapshot de cohérence
 * E2E (E0 PV↔signal, E1 signal↔zone, E2 zone↔grille) par ville dans
 * `consistency_snapshots`.
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
 *   SKIP_ZONE_GRID="1"               — désactive la mesure LIVE E2 (utile hors
 *                                       réseau/OGC injoignable) ; E2 ressort
 *                                       honnêtement `non_mesure`, E0/E1 inchangés.
 *
 * Déploiement prod : `deploy/k8s/35-consistency-snapshot-cronjob.yaml`
 * exécute `node dist/services/consistency/run-consistency-snapshot.js` après la
 * projection nightly. IMPORTANT : E1 dépend de la sortie du mapper #74
 * (`run-geo-mapper.ts`). Si `geo_resolutions`/`geo_unresolved` sont vides, le
 * job écrit honnêtement `non_mesure` pour l'arête signal→zone. E2 dépend de
 * l'API geo OGC LIVE (`api.geo.sent-tech.ca`, `qc-zonage-<slug>` +
 * `qc-zonage-norms-<slug>`) — 2 requêtes/ville espacées + retries
 * (`load-zone-grid-raw.ts`) ; une ville dont la mesure échoue après retries
 * ressort honnêtement `non_mesure` pour E2 sans bloquer les autres villes ni
 * E0/E1.
 *
 * Périmètre par défaut : FOCUS-30 (villes `priorityRank` 1..30 — cf.
 * docs/spec/SPEC_CONSOLIDATED_2026-07.md §1.2, `QC_MUNICIPALITIES` déjà triée
 * priorityRank ascendant). Idempotent : upsert sur city_slug, un run réécrit
 * chaque ligne avec la mesure la plus récente. Aucune ré-extraction : E0/E1
 * lisent exclusivement la sortie déjà produite par le mapper #74
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
import { loadZoneGridRawInputs } from "./load-zone-grid-raw.js";
import { deriveCityConsistency, type ZoneGridRawInput } from "./consistency-calc.js";
import { writeConsistencySnapshots } from "./consistency-snapshot-store.js";

const DATABASE_URL =
  process.env["DATABASE_URL"] ??
  "postgres://radar:219c0ff1da554bfd05e410b35f32a114319599423f6a96d8@127.0.0.1:5434/radar";

const CITIES_FILTER = process.env["CITIES"]
  ? process.env["CITIES"].split(",").map((s) => s.trim()).filter(Boolean)
  : null;
const SCOPE = process.env["SCOPE"] ?? "focus30";
const FOCUS_30_SIZE = 30;
const SKIP_ZONE_GRID = process.env["SKIP_ZONE_GRID"] === "1";

const zoneGridLogger = {
  info: (obj: unknown, msg?: string) => console.log(msg ?? "load-zone-grid-raw", obj),
  warn: (obj: unknown, msg?: string) => console.warn(msg ?? "load-zone-grid-raw", obj),
};


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
    console.log(`=== Snapshot cohérence E2E (WP3 LOT1+LOT2) — ${cities.length} ville(s), scope=${scopeLabel} ===`);

    const diagnostics = await loadGeoMapperDiagnostics(db);
    logGeoMapperDiagnostics(diagnostics);

    const rawInputs = await loadCityConsistencyRawInputs(db, cities);

    // E2 zone↔grille : mesure LIVE OGC, bornée au même scope que E0/E1
    // (focus-30 par défaut). SKIP_ZONE_GRID=1 pour désactiver (réseau/OGC
    // injoignable) — E2 ressort honnêtement non_mesure, E0/E1 inchangés.
    let zoneGridMap = new Map<string, ZoneGridRawInput>();
    if (SKIP_ZONE_GRID) {
      console.warn("SKIP_ZONE_GRID=1 : mesure E2 zone→grille désactivée, toutes les villes ressortent non_mesure.");
    } else {
      console.log(`E2 zone→grille : mesure OGC live démarrée (${cities.length} ville(s), ~2 requêtes/ville espacées)…`);
      zoneGridMap = await loadZoneGridRawInputs(cities, { logger: zoneGridLogger });
    }

    const generatedAt = new Date().toISOString();
    const consistencies = rawInputs.map((raw) =>
      deriveCityConsistency(raw, generatedAt, zoneGridMap.get(raw.citySlug)),
    );

    await writeConsistencySnapshots(db, consistencies);

    const byState = { coherent: 0, partial: 0, unmeasured: 0 };
    const byE1 = { measured: 0, non_applicable: 0, non_mesure: 0 };
    const byE2 = { ok: 0, partiel: 0, "millesime-disjoint": 0, absente: 0, "zonage-absent": 0, non_mesure: 0 };
    let staleZoningCount = 0;
    for (const c of consistencies) {
      byState[c.state] += 1;
      byE1[c.edges.signalZone.status] += 1;
      byE2[c.edges.zoneGrid.state] += 1;
      if (c.edges.zoneGrid.staleZoningSource) staleZoningCount += 1;
    }
    console.log(
      `Écrit ${consistencies.length} snapshot(s) — ` +
        `state: coherent=${byState.coherent} partial=${byState.partial} unmeasured=${byState.unmeasured}; ` +
        `E1 signal→zone: measured=${byE1.measured} non_applicable=${byE1.non_applicable} non_mesure=${byE1.non_mesure}`,
    );
    console.log(
      `E2 zone→grille — ok=${byE2.ok} partiel=${byE2.partiel} millesime-disjoint=${byE2["millesime-disjoint"]} ` +
        `absente=${byE2.absente} zonage-absent=${byE2["zonage-absent"]} non_mesure=${byE2.non_mesure} ` +
        `stale-source=${staleZoningCount}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
