import { Hono } from "hono";
import { isNotNull, isNull, sql } from "drizzle-orm";
import { QC_MUNICIPALITIES, getGeoSourceInventory } from "@radar/sources";
import type { ScrapeStatusSourceT, ScrapeStatusT } from "@radar/domain";
import type { Database } from "../db/client.js";
import type { ObjectStore } from "../storage/object-store.js";
import { graphNodes, lotVersions, zoneVersions } from "../db/schema.js";
import { readAll } from "../services/scrape-status/store.js";
import { mergeWithDerived } from "../services/scrape-status/derive.js";

/**
 * GET /api/source/coverage — couverture qualité de données par ville,
 * lecture BULK set-based, province-wide (~1104 villes).
 *
 * Honnêteté (D6, anti-survente) : chaque cellule est un TRI-ÉTAT —
 *   - `verified` : substantié LIVE (lignes réelles en base / fixture capturée).
 *   - `declared` : déclaré mais NON substantié (statut annoncé, source connue
 *                  mais pas ingérée, aucune ligne en base).
 *   - `absent`   : rien de connu.
 * Jamais de « vert » fabriqué : un layer n'est `verified` que si la preuve est
 * vérifiable au moment de la requête.
 *
 * Réutilise les agrégateurs existants (D5) — pas de job batch, pas de table
 * nouvelle, pas de scan S3 raw live, pas de 1104 appels per-city :
 *   - L1 raw    : statut DÉRIVÉ scrape-status (mergeWithDerived, en mémoire).
 *   - L2 graph  : un GROUP BY city_slug sur graph_nodes.
 *   - L4 zonage : un GROUP BY city_slug sur zone_versions (versions courantes).
 *   - L5 lots   : un GROUP BY city_slug sur lot_versions (versions courantes).
 * Soit 3 requêtes agrégées set-based + une lecture scrape-status, point.
 */

const DEFAULT_STALE_AFTER_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

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

const STATE_RANK: Record<CoverageState, number> = {
  absent: 0,
  declared: 1,
  verified: 2,
};

export interface SourceCoverageDeps {
  store: ObjectStore;
  db?: Database;
  now?: () => number;
  staleAfterDays?: number;
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

interface GeoCell {
  state: CoverageState;
  served: boolean;
  freshness: Freshness;
}

interface CityCoverage {
  citySlug: string;
  cityName: string;
  mrc: string | null;
  priorityRank: number | null;
  l1Raw: RawCell;
  l2Graph: GraphCell;
  l4Zonage: GeoCell;
  l5Lots: GeoCell;
  worstStatus: CoverageState;
  nextMarginalGain: "zonage" | "lots" | null;
}

interface CoverageResponse {
  generatedAt: string;
  totals: {
    cities: number;
    l1Raw: number;
    l2Graph: number;
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

interface GeoAgg {
  currentVersions: number;
  withGeometry: number;
  lastKnownFrom: string | null;
}

export function sourceCoverageRoute(deps: SourceCoverageDeps): Hono {
  const app = new Hono();

  app.get("/api/source/coverage", async (c) => {
    const nowMs = (deps.now ?? (() => Date.now()))();
    const staleMs =
      (deps.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS) * MS_PER_DAY;

    // ── L1 raw : statut scrape-status dérivé (en mémoire, pas de scan S3) ──
    const stored = await readAll(deps.store);
    const scrapeStatuses = mergeWithDerived(stored);
    const rawByCity = new Map<string, ScrapeStatusT[]>();
    for (const rec of scrapeStatuses) {
      if (!RAW_SOURCES.includes(rec.source)) continue;
      const list = rawByCity.get(rec.citySlug) ?? [];
      list.push(rec);
      rawByCity.set(rec.citySlug, list);
    }

    // ── L2/L4/L5 : agrégats set-based GROUP BY city_slug (ou vide sans db) ──
    const { graphByCity, zoneByCity, lotByCity } = deps.db
      ? await loadBulkAggregates(deps.db)
      : {
          graphByCity: new Map<string, GraphAgg>(),
          zoneByCity: new Map<string, GeoAgg>(),
          lotByCity: new Map<string, GeoAgg>(),
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
      const l4Zonage = buildGeoCell(
        zoneByCity.get(mun.slug),
        inventory?.zonage,
        nowMs,
        staleMs,
      );
      const l5Lots = buildGeoCell(
        lotByCity.get(mun.slug),
        inventory?.lots,
        nowMs,
        staleMs,
      );

      const worstStatus = worstOf([
        l1Raw.state,
        l2Graph.state,
        l4Zonage.state,
        l5Lots.state,
      ]);

      return {
        citySlug: mun.slug,
        cityName: mun.name,
        mrc: mun.mrc,
        priorityRank: mun.priorityRank,
        l1Raw,
        l2Graph,
        l4Zonage,
        l5Lots,
        worstStatus,
        nextMarginalGain: computeNextMarginalGain(l2Graph, l4Zonage, l5Lots),
      };
    });

    const totals = {
      cities: cities.length,
      l1Raw: cities.filter((x) => x.l1Raw.state === "verified").length,
      l2Graph: cities.filter((x) => x.l2Graph.state === "verified").length,
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

  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Agrégats set-based (3 requêtes GROUP BY city_slug, jamais 1104 per-city)
// ─────────────────────────────────────────────────────────────────────────────

async function loadBulkAggregates(db: Database): Promise<{
  graphByCity: Map<string, GraphAgg>;
  zoneByCity: Map<string, GeoAgg>;
  lotByCity: Map<string, GeoAgg>;
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

  return { graphByCity, zoneByCity, lotByCity };
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

function buildGeoCell(
  agg: GeoAgg | undefined,
  descriptor: { availability: string } | undefined,
  nowMs: number,
  staleMs: number,
): GeoCell {
  const currentVersions = agg?.currentVersions ?? 0;
  const withGeometry = agg?.withGeometry ?? 0;
  // « servi » = au moins une géométrie réellement disponible pour la carte.
  const served = withGeometry > 0;

  // Source d'inventaire connue mais pas (encore) ingérée = déclaré.
  const inventoryDeclared =
    descriptor !== undefined &&
    descriptor.availability !== "unknown" &&
    descriptor.availability !== "none";

  let state: CoverageState;
  if (served) state = "verified";
  else if (currentVersions > 0 || inventoryDeclared) state = "declared";
  else state = "absent";

  // « complet » = toutes les versions courantes portent une géométrie.
  const complete =
    served && currentVersions > 0 && withGeometry >= currentVersions;
  const freshness = freshnessLevel(
    agg?.lastKnownFrom ?? null,
    nowMs,
    staleMs,
    complete,
  );

  return { state, served, freshness };
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

function worstOf(states: CoverageState[]): CoverageState {
  return states.reduce<CoverageState>(
    (worst, s) => (STATE_RANK[s] < STATE_RANK[worst] ? s : worst),
    "verified",
  );
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
