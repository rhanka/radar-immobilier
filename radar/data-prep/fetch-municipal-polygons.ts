/**
 * fetch-municipal-polygons.ts — pipeline RE-JOUABLE
 *
 * Fetches all Québec municipal polygons and joins them to the internal registry
 * (packages/radar-sources/src/geo/municipalities.qc.json).
 *
 * DATA SOURCE (Plan B — StatCan CSD 2025):
 *   https://geo.statcan.gc.ca/geo_wa/rest/services/2025/lcsd000a25s_e/MapServer/0
 *   No authentication required. WGS84 (EPSG:4326). Very fast (~3s for all QC).
 *   Note: SDA MERN was the primary source but its geometry endpoint was unreachable
 *   (timeout >2min per page) at time of authoring (2026-06-13). Plan B is used.
 *   Join key: CSDUID is the StatCan CSD identifier; our registry has no MAMH code,
 *   so join is by normalized name + CDNAME (≈MRC) with CSDTYPE priority tiebreaking.
 *
 * Coordinate system: WGS84 EPSG:4326 — no reprojection needed.
 *
 * Simplification: ogr2ogr Douglas-Peucker, tolerance 0.0005° (~55m at QC latitude).
 *
 * Usage:
 *   node --experimental-strip-types radar/data-prep/fetch-municipal-polygons.ts
 *
 * Output:
 *   radar/data-prep/output/municipalities.geojson
 *   Properties: { citySlug, mamhCode, name, mrc }
 *   Note: mamhCode is populated from CSDUID (7-digit StatCan code) for traceability.
 *
 * Re-run: idempotent — safe to run at any time. The raw GeoJSON is cached at
 *   radar/data-prep/output/municipalities.raw.geojson for inspection.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ─── paths ────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "../..");
const REGISTRY_PATH = resolve(
  REPO_ROOT,
  "packages/radar-sources/src/geo/municipalities.qc.json",
);
const OUTPUT_DIR = resolve(__dirname, "output");
const RAW_OUTPUT = resolve(OUTPUT_DIR, "municipalities.raw.geojson");
const FINAL_OUTPUT = resolve(OUTPUT_DIR, "municipalities.geojson");

// ─── StatCan CSD 2025 endpoint ────────────────────────────────────────────────

const STATCAN_BASE =
  "https://geo.statcan.gc.ca/geo_wa/rest/services/2025/lcsd000a25s_e/MapServer/0/query";
const STATCAN_FIELDS = "CSDUID,CSDNAME,CDUID,CDNAME,CSDTYPE";
const PAGE_SIZE = 2000;

// ─── CSDTYPE priority (V > VL > MÉ > CT > PE …) ─────────────────────────────
// Used as tiebreaker when same name appears as both a ville and a canton.
const CSDTYPE_PRIORITY: Record<string, number> = {
  V: 1, VL: 2, VN: 3, VC: 4, CU: 5,
  MÉ: 6, CT: 7, PE: 8,
  TC: 9, TI: 10, TK: 11, "S-É": 12, IRI: 13, GR: 14, VK: 15, NO: 100,
};

// ─── Manual overrides: StatCan name → registry slug ──────────────────────────
// Used for entries where normalized names diverge between the two datasets.
const MANUAL_OVERRIDES: Record<string, string> = {
  // StatCan "Hatley" CT in Memphrémagog → registry "Hatley (township municipality)"
  "2445055": "hatley-township-municipality",
  // StatCan "Saint-Germain" MÉ in Kamouraska → registry "Saint-Germain-de-Kamouraska"
  "2414045": "saint-germain-de-kamouraska",
  // StatCan "Eeyou Istchee Baie-James" → registry "Eeyou Istchee James Bay"
  "2499060": "eeyou-istchee-james-bay",
};

// ─── types ────────────────────────────────────────────────────────────────────

interface RegistryEntry {
  slug: string;
  name: string;
  mrc: string | null;
}

interface MunicipalFeatureProperties {
  citySlug: string;
  mamhCode: string;
  name: string;
  mrc: string | null;
}

interface RawFeature {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: unknown;
  };
}

interface GeoJsonFeatureCollection {
  type: "FeatureCollection";
  features: RawFeature[];
  exceededTransferLimit?: boolean;
  error?: { message: string };
}

// ─── normalization ────────────────────────────────────────────────────────────

/**
 * Normalize a municipality name for join comparison:
 * - NFD decompose → remove combining marks (strip accents)
 * - Remove apostrophes (L'Île → lile)
 * - Lowercase
 * - Collapse non-alphanum runs to hyphens
 */
function normalizeName(name: string): string {
  const nfd = name.normalize("NFD");
  const noAccents = [...nfd]
    .filter((c) => !/\p{M}/u.test(c))
    .join("");
  const noApostrophe = noAccents.replace(/['']/g, "");
  const lower = noApostrophe.toLowerCase();
  return lower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ─── registry index ───────────────────────────────────────────────────────────

interface RegistryIndex {
  byNameMrc: Map<string, RegistryEntry>;
  byName: Map<string, RegistryEntry[]>;
  bySlug: Map<string, RegistryEntry>;
}

function buildRegistryIndex(entries: RegistryEntry[]): RegistryIndex {
  const byNameMrc = new Map<string, RegistryEntry>();
  const byName = new Map<string, RegistryEntry[]>();
  const bySlug = new Map<string, RegistryEntry>();

  for (const entry of entries) {
    bySlug.set(entry.slug, entry);

    const normName = normalizeName(entry.name);
    const list = byName.get(normName) ?? [];
    list.push(entry);
    byName.set(normName, list);

    if (entry.mrc !== null) {
      const normMrc = normalizeName(entry.mrc);
      // Note: for slug--mrc disambiguation pairs, the last write wins (both have same name+mrc).
      // The tiebreak between slug and slug--2 is handled separately.
      byNameMrc.set(`${normName}|${normMrc}`, entry);
    }
  }

  return { byNameMrc, byName, bySlug };
}

// ─── StatCan fetch ────────────────────────────────────────────────────────────

async function fetchPage(offset: number): Promise<GeoJsonFeatureCollection> {
  const params = new URLSearchParams({
    where: "PRUID='24'",
    outFields: STATCAN_FIELDS,
    returnGeometry: "true",
    f: "geojson",
    resultRecordCount: String(PAGE_SIZE),
    resultOffset: String(offset),
  });

  const url = `${STATCAN_BASE}?${params}`;
  console.error(`[statcan] fetch offset=${offset} …`);

  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) {
    throw new Error(
      `[statcan] HTTP ${res.status} ${res.statusText} at offset ${offset}`,
    );
  }

  const data = (await res.json()) as GeoJsonFeatureCollection;
  if (data.error) {
    throw new Error(`[statcan] API error: ${data.error.message}`);
  }

  return data;
}

async function fetchAllFeatures(): Promise<RawFeature[]> {
  const features: RawFeature[] = [];
  let offset = 0;

  while (true) {
    const page = await fetchPage(offset);
    features.push(...page.features);

    if (!page.exceededTransferLimit || page.features.length === 0) {
      break;
    }
    offset += page.features.length;
  }

  return features;
}

// ─── StatCan feature index ────────────────────────────────────────────────────

interface StatCanIndexEntry {
  feat: RawFeature;
  csduid: string;
  csdname: string;
  cdname: string;
  csdtype: string;
  normName: string;
  normMrc: string;
  typePriority: number;
}

function buildStatCanIndex(features: RawFeature[]): {
  byNameMrc: Map<string, StatCanIndexEntry>;
  byName: Map<string, StatCanIndexEntry[]>;
  byCsduid: Map<string, StatCanIndexEntry>;
} {
  const byNameMrc = new Map<string, StatCanIndexEntry>();
  const byName = new Map<string, StatCanIndexEntry[]>();
  const byCsduid = new Map<string, StatCanIndexEntry>();

  for (const feat of features) {
    const props = feat.properties as {
      CSDUID: string;
      CSDNAME: string;
      CDUID: string;
      CDNAME: string;
      CSDTYPE: string;
    };

    const entry: StatCanIndexEntry = {
      feat,
      csduid: props.CSDUID ?? "",
      csdname: props.CSDNAME ?? "",
      cdname: props.CDNAME ?? "",
      csdtype: props.CSDTYPE ?? "",
      normName: normalizeName(props.CSDNAME ?? ""),
      normMrc: normalizeName(props.CDNAME ?? ""),
      typePriority: CSDTYPE_PRIORITY[props.CSDTYPE] ?? 99,
    };

    byCsduid.set(entry.csduid, entry);

    const nameKey = `${entry.normName}|${entry.normMrc}`;
    const existing = byNameMrc.get(nameKey);
    if (!existing || entry.typePriority < existing.typePriority) {
      byNameMrc.set(nameKey, entry);
    }

    const nameList = byName.get(entry.normName) ?? [];
    nameList.push(entry);
    byName.set(entry.normName, nameList);
  }

  return { byNameMrc, byName, byCsduid };
}

// ─── join logic ───────────────────────────────────────────────────────────────

interface JoinResult {
  features: (RawFeature & { properties: MunicipalFeatureProperties })[];
  matchCount: number;
  /** Registry entries that got a polygon. */
  matchedSlugs: Set<string>;
  /** StatCan entries that had no registry match (NO/IRI/TNO etc.) */
  unmatchedStatCan: StatCanIndexEntry[];
}

function joinToRegistry(
  statcanFeatures: RawFeature[],
  registry: RegistryEntry[],
): JoinResult {
  const { bySlug } = buildRegistryIndex(registry);
  const scIndex = buildStatCanIndex(statcanFeatures);

  const outputFeatures: JoinResult["features"] = [];
  const matchedSlugs = new Set<string>();
  const usedCsdUids = new Set<string>();

  // Pass 1: manual overrides (CSDUID → slug)
  for (const [csduid, slug] of Object.entries(MANUAL_OVERRIDES)) {
    const scEntry = scIndex.byCsduid.get(csduid);
    const regEntry = bySlug.get(slug);
    if (!scEntry || !regEntry) {
      console.error(
        `[join] WARN manual override CSDUID=${csduid} → slug=${slug}: one side missing`,
      );
      continue;
    }
    matchedSlugs.add(slug);
    usedCsdUids.add(csduid);
    outputFeatures.push({
      ...scEntry.feat,
      properties: {
        citySlug: slug,
        mamhCode: csduid,
        name: scEntry.csdname,
        mrc: scEntry.cdname || null,
      },
    });
  }

  // Pass 2: auto-join registry entries by name + MRC
  for (const entry of registry) {
    if (matchedSlugs.has(entry.slug)) continue; // already matched by override

    const normName = normalizeName(entry.name);
    const normMrc = entry.mrc !== null ? normalizeName(entry.mrc) : null;

    let scEntry: StatCanIndexEntry | undefined;

    // Strategy 1: name + MRC exact
    if (normMrc) {
      scEntry = scIndex.byNameMrc.get(`${normName}|${normMrc}`);
    }

    // Strategy 2: name only
    if (!scEntry) {
      const candidates = scIndex.byName.get(normName) ?? [];
      if (candidates.length === 1) {
        scEntry = candidates[0];
      } else if (candidates.length > 1) {
        // Prefer matching MRC
        if (normMrc) {
          scEntry = candidates.find((c) => c.normMrc === normMrc);
        }
        if (!scEntry) {
          // Pick highest-priority type
          scEntry = [...candidates].sort(
            (a, b) => a.typePriority - b.typePriority,
          )[0];
          console.error(
            `[join] WARN multi-candidate: ${entry.name} (${entry.mrc}) → ` +
              `picked ${scEntry?.csduid} ${scEntry?.csdname} (${scEntry?.csdtype})`,
          );
        }
      }
    }

    if (!scEntry || usedCsdUids.has(scEntry.csduid)) {
      if (scEntry && usedCsdUids.has(scEntry.csduid)) {
        // CSDUID already consumed — duplicate registry entry for same polygon (e.g., slug--2)
        // Allow sharing the same polygon geometry
        matchedSlugs.add(entry.slug);
        outputFeatures.push({
          ...scEntry.feat,
          properties: {
            citySlug: entry.slug,
            mamhCode: scEntry.csduid,
            name: scEntry.csdname,
            mrc: scEntry.cdname || null,
          },
        });
      }
      // else: genuinely no match
      continue;
    }

    usedCsdUids.add(scEntry.csduid);
    matchedSlugs.add(entry.slug);
    outputFeatures.push({
      ...scEntry.feat,
      properties: {
        citySlug: entry.slug,
        mamhCode: scEntry.csduid,
        name: scEntry.csdname,
        mrc: scEntry.cdname || null,
      },
    });
  }

  // Collect unmatched StatCan entries
  const unmatchedStatCan = [...scIndex.byCsduid.values()].filter(
    (e) => !usedCsdUids.has(e.csduid),
  );

  return {
    features: outputFeatures,
    matchCount: matchedSlugs.size,
    matchedSlugs,
    unmatchedStatCan,
  };
}

// ─── simplification ───────────────────────────────────────────────────────────

/**
 * Simplify geometries using ogr2ogr Douglas-Peucker.
 * Tolerance 0.0005° ≈ 55m at QC latitude — suitable for municipal map overview.
 * Requires ogr2ogr (GDAL) to be on PATH.
 */
function simplifyWithOgrOgr(inputPath: string, outputPath: string): void {
  const cmd = [
    "ogr2ogr",
    "-f", "GeoJSON",
    "-simplify", "0.0005",
    outputPath,
    inputPath,
  ].join(" ");

  console.error(`[simplify] ${cmd}`);
  execSync(cmd, { stdio: ["ignore", "ignore", "inherit"] });
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.error("═══════════════════════════════════════════════════════");
  console.error("[data-prep] Municipal polygon pipeline — START");
  console.error(`[data-prep] Registry:  ${REGISTRY_PATH}`);
  console.error(`[data-prep] Output:    ${FINAL_OUTPUT}`);
  console.error("═══════════════════════════════════════════════════════");

  // 1. Load registry
  const registry = JSON.parse(
    readFileSync(REGISTRY_PATH, "utf8"),
  ) as RegistryEntry[];
  console.error(`[data-prep] Registry loaded: ${registry.length} municipalities`);

  // 2. Create output dir
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 3. Fetch all StatCan features
  console.error("[data-prep] Fetching StatCan CSD 2025 QC polygons …");
  const t0 = Date.now();
  const rawFeatures = await fetchAllFeatures();
  const fetchMs = Date.now() - t0;
  console.error(
    `[data-prep] Fetched ${rawFeatures.length} features in ${(fetchMs / 1000).toFixed(1)}s`,
  );

  // 4. Join
  console.error("[data-prep] Joining to registry …");
  const { features, matchCount, matchedSlugs, unmatchedStatCan } =
    joinToRegistry(rawFeatures, registry);

  const registryTotal = registry.length;
  const coveragePct = ((matchCount / registryTotal) * 100).toFixed(1);

  // 5. Report registry entries with no polygon
  const noPolygon = registry.filter((e) => !matchedSlugs.has(e.slug));

  // 6. Write raw GeoJSON
  const rawCollection = { type: "FeatureCollection", features };
  writeFileSync(RAW_OUTPUT, JSON.stringify(rawCollection), "utf8");
  const rawKb = (readFileSync(RAW_OUTPUT).length / 1024).toFixed(0);
  console.error(`[data-prep] Wrote raw GeoJSON: ${RAW_OUTPUT} (${rawKb} KB)`);

  // 7. Simplify with ogr2ogr
  if (existsSync(FINAL_OUTPUT)) {
    execSync(`rm -f "${FINAL_OUTPUT}"`, { stdio: "ignore" });
  }
  simplifyWithOgrOgr(RAW_OUTPUT, FINAL_OUTPUT);
  const finalKb = (readFileSync(FINAL_OUTPUT).length / 1024).toFixed(0);

  // 8. Final report
  console.error("\n═══════════════════ COVERAGE REPORT ═══════════════════");
  console.error(`  Endpoint:        StatCan CSD 2025 MapServer/0 (Plan B)`);
  console.error(`  Reason for B:    SDA MERN geometry endpoint timed out (>2min/page)`);
  console.error(`  StatCan QC:      ${rawFeatures.length} CSDs fetched`);
  console.error(`  Registry size:   ${registryTotal}`);
  console.error(`  Joined:          ${matchCount}/${registryTotal} (${coveragePct}%)`);
  console.error(`  StatCan unused:  ${unmatchedStatCan.length} (NO/IRI/TNO territories)`);
  console.error(`  Output raw:      ${rawKb} KB`);
  console.error(`  Output final:    ${finalKb} KB (simplified 0.0005°)`);
  console.error(`  Output file:     ${FINAL_OUTPUT}`);

  if (noPolygon.length > 0) {
    console.error(
      `\n  Registry entries with NO polygon: ${noPolygon.length}`,
    );
    for (const e of noPolygon) {
      console.error(`    slug=${e.slug} | ${e.name} | mrc=${e.mrc ?? "—"}`);
    }
    console.error(
      "  (Cause: absent from StatCan 2025 — merged, renamed, or First Nations territory)",
    );
  }
  console.error("════════════════════════════════════════════════════════\n");

  if (noPolygon.length > 0) {
    // Non-zero but not fatal — the pipeline still produced a usable artefact
    process.exitCode = 0;
  }
}

main().catch((err: unknown) => {
  console.error("[data-prep] FATAL:", err);
  process.exit(1);
});
