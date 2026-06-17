import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  DataQualityCitySummary,
  type DataQualityCitySummaryT,
  type DataQualityCollectionCountsT,
  type DataQualityCollectionSummaryT,
  type DataQualityFreshnessT,
  type DataQualityGeoSummaryT,
  type DataQualityOntologySummaryT,
  type DataQualityStateT,
  type ScrapeStatusSourceT,
  type ScrapeStatusT,
} from "@radar/domain";
import { getGeoSourceInventory } from "@radar/sources";
import type { Database } from "../../db/client.js";
import {
  graphEdges,
  graphNodes,
  lotVersions,
  zoneVersions,
} from "../../db/schema.js";

const DEFAULT_STALE_AFTER_DAYS = 180;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const SCRAPE_STATUSES: readonly ScrapeStatusT["status"][] = [
  "todo",
  "identified",
  "scraped",
  "graphified",
  "error",
];

interface BuildDataQualitySummaryInput {
  citySlug: string;
  scrapeStatuses: ScrapeStatusT[];
  db?: Database;
  now?: () => number;
  staleAfterDays?: number;
}

interface GraphSnapshot {
  nodes: { id: string; type: string; createdAt: Date }[];
  edges: { srcId: string; dstId: string }[];
}

interface GeoVersionSnapshot {
  geom: string | null;
  knownFrom: Date;
}

interface DbSnapshot {
  graph: GraphSnapshot;
  zones: GeoVersionSnapshot[];
  lots: GeoVersionSnapshot[];
}

const EMPTY_DB_SNAPSHOT: DbSnapshot = {
  graph: { nodes: [], edges: [] },
  zones: [],
  lots: [],
};

export async function buildDataQualityCitySummary(
  input: BuildDataQualitySummaryInput,
): Promise<DataQualityCitySummaryT> {
  const nowDate = new Date((input.now ?? (() => Date.now()))());
  const staleAfterMs =
    (input.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS) * MS_PER_DAY;
  const cityStatuses = input.scrapeStatuses.filter(
    (item) => item.citySlug === input.citySlug,
  );
  const dbSnapshot = input.db
    ? await loadDbSnapshot(input.db, input.citySlug)
    : EMPTY_DB_SNAPSHOT;

  const summary: DataQualityCitySummaryT = {
    citySlug: input.citySlug,
    generatedAt: nowDate.toISOString(),
    councilMinutes: summarizeCollection(
      cityStatuses,
      "conseils-municipaux",
      nowDate,
      staleAfterMs,
    ),
    youtube: summarizeCollection(
      cityStatuses,
      "youtube-seances",
      nowDate,
      staleAfterMs,
    ),
    ontology: summarizeOntology(dbSnapshot.graph, nowDate, staleAfterMs),
    zones: summarizeGeoLayer(
      input.citySlug,
      "zonage",
      dbSnapshot.zones,
      nowDate,
      staleAfterMs,
    ),
    lots: summarizeGeoLayer(
      input.citySlug,
      "lots",
      dbSnapshot.lots,
      nowDate,
      staleAfterMs,
    ),
  };

  return DataQualityCitySummary.parse(summary);
}

async function loadDbSnapshot(
  db: Database,
  citySlug: string,
): Promise<DbSnapshot> {
  const nodes = await db
    .select({
      id: graphNodes.id,
      type: graphNodes.type,
      createdAt: graphNodes.createdAt,
    })
    .from(graphNodes)
    .where(eq(graphNodes.citySlug, citySlug));

  let edges: GraphSnapshot["edges"] = [];
  if (nodes.length > 0) {
    const nodeIds = nodes.map((node) => node.id);
    const nodeSet = new Set(nodeIds);
    const candidateEdges = await db
      .select({
        srcId: graphEdges.srcId,
        dstId: graphEdges.dstId,
      })
      .from(graphEdges)
      .where(inArray(graphEdges.srcId, nodeIds));
    edges = candidateEdges.filter((edge) => nodeSet.has(edge.dstId));
  }

  const zones = await db
    .select({
      geom: zoneVersions.geom,
      knownFrom: zoneVersions.knownFrom,
    })
    .from(zoneVersions)
    .where(
      and(
        eq(zoneVersions.citySlug, citySlug),
        isNull(zoneVersions.knownTo),
      ),
    );

  const lots = await db
    .select({
      geom: lotVersions.geom,
      knownFrom: lotVersions.knownFrom,
    })
    .from(lotVersions)
    .where(
      and(
        eq(lotVersions.citySlug, citySlug),
        isNull(lotVersions.knownTo),
      ),
    );

  return {
    graph: { nodes, edges },
    zones,
    lots,
  };
}

function summarizeCollection(
  cityStatuses: ScrapeStatusT[],
  source: ScrapeStatusSourceT,
  nowDate: Date,
  staleAfterMs: number,
): DataQualityCollectionSummaryT {
  const items = cityStatuses.filter((item) => item.source === source);
  const counts = emptyCollectionCounts();
  for (const item of items) {
    counts.records += 1;
    counts[item.status] += 1;
  }

  const lastObservedAt = latestIso(items.map((item) => item.lastRunAt));
  const freshness = freshnessFor(lastObservedAt, nowDate, staleAfterMs);
  const active =
    counts.identified + counts.scraped + counts.graphified + counts.error;
  let status: DataQualityStateT;
  if (counts.records === 0 || active === 0) {
    status = "unknown";
  } else if (freshness === "stale") {
    status = "stale";
  } else if (counts.graphified > 0) {
    status = "fresh";
  } else {
    status = "partial";
  }

  return {
    status,
    freshness,
    lastObservedAt,
    counts,
  };
}

function summarizeOntology(
  graph: GraphSnapshot,
  nowDate: Date,
  staleAfterMs: number,
): DataQualityOntologySummaryT {
  const lastObservedAt = latestIso(graph.nodes.map((node) => node.createdAt));
  const freshness = freshnessFor(lastObservedAt, nowDate, staleAfterMs);
  const counts = {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    signals: countType(graph.nodes, "Signal"),
    designationEvents: countType(graph.nodes, "DesignationEvent"),
    zones: countType(graph.nodes, "Zone"),
    lots: countType(graph.nodes, "Lot"),
    bylaws: countType(graph.nodes, "Bylaw"),
  };
  let status: DataQualityStateT;
  if (counts.nodes === 0) {
    status = "unknown";
  } else if (freshness === "stale") {
    status = "stale";
  } else if (counts.edges === 0) {
    status = "partial";
  } else {
    status = "fresh";
  }

  return {
    status,
    freshness,
    lastObservedAt,
    counts,
  };
}

function summarizeGeoLayer(
  citySlug: string,
  layer: "zonage" | "lots",
  versions: GeoVersionSnapshot[],
  nowDate: Date,
  staleAfterMs: number,
): DataQualityGeoSummaryT {
  const inventory = getGeoSourceInventory(citySlug);
  const descriptor = inventory?.[layer];
  const source = descriptor
    ? {
        availability: descriptor.availability,
        quality: descriptor.quality,
        hasUrl: descriptor.url !== undefined,
      }
    : null;
  const inventoryLayers =
    descriptor &&
    descriptor.availability !== "unknown" &&
    descriptor.availability !== "none"
      ? 1
      : 0;
  const lastObservedAt = latestIso(
    versions.map((version) => version.knownFrom),
  );
  const freshness = freshnessFor(lastObservedAt, nowDate, staleAfterMs);
  const counts = {
    inventoryLayers,
    currentVersions: versions.length,
    withGeometry: versions.filter((version) => version.geom !== null).length,
  };
  let status: DataQualityStateT;
  if (counts.currentVersions === 0 && counts.inventoryLayers === 0) {
    status = "unknown";
  } else if (freshness === "stale") {
    status = "stale";
  } else if (counts.currentVersions === 0) {
    status = "partial";
  } else if (counts.withGeometry < counts.currentVersions) {
    status = "partial";
  } else {
    status = "fresh";
  }

  return {
    status,
    freshness,
    lastObservedAt,
    source,
    counts,
  };
}

function emptyCollectionCounts(): DataQualityCollectionCountsT {
  return SCRAPE_STATUSES.reduce(
    (acc, status) => ({ ...acc, [status]: 0 }),
    { records: 0 } as DataQualityCollectionCountsT,
  );
}

function freshnessFor(
  iso: string | null,
  nowDate: Date,
  staleAfterMs: number,
): DataQualityFreshnessT {
  if (!iso) return "unknown";
  const observed = Date.parse(iso);
  if (Number.isNaN(observed)) return "unknown";
  return nowDate.getTime() - observed > staleAfterMs ? "stale" : "fresh";
}

function latestIso(values: readonly (string | Date | null | undefined)[]): string | null {
  let latest: Date | null = null;
  for (const value of values) {
    const date = toDate(value);
    if (!date) continue;
    if (!latest || date.getTime() > latest.getTime()) latest = date;
  }
  return latest ? latest.toISOString() : null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function countType(
  nodes: readonly { type: string }[],
  type: string,
): number {
  return nodes.filter((node) => node.type === type).length;
}
