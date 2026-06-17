/**
 * Geo resolver for priority/opportunity rows.
 *
 * Graph edges are canonical when present. Flat fields such as zone_ref/no_lot
 * are only a weak text fallback and are marked as such.
 */

export type PriorityGeoResolutionStatus =
  | "graph"
  | "text-fallback"
  | "missing";

export interface PriorityGeoInput {
  id: string;
  citySlug: string;
  graphNodeIds?: string[];
  zoneRefs?: string[];
  lotNumbers?: string[];
  props?: Record<string, unknown>;
}

export interface PriorityGraphNode {
  id: string;
  type: string;
  label?: string | null;
  citySlug?: string | null;
  props?: Record<string, unknown> | null;
}

export interface PriorityGraphEdge {
  srcId: string;
  dstId: string;
  kind: string;
  props?: Record<string, unknown> | null;
}

export interface PriorityGraphLayer {
  nodes: PriorityGraphNode[];
  edges: PriorityGraphEdge[];
}

export interface ResolvedPriorityZone {
  code: string;
  source: "graph-edge" | "text-fallback";
  confidence: number;
  graphNodeId?: string;
}

export interface ResolvedPriorityLot {
  noLot: string;
  source: "graph-edge" | "text-fallback";
  confidence: number;
  graphNodeId?: string;
}

export interface PriorityGeoResolution {
  priorityId: string;
  citySlug: string;
  resolutionStatus: PriorityGeoResolutionStatus;
  confidence: number;
  zones: ResolvedPriorityZone[];
  lots: ResolvedPriorityLot[];
}

const GRAPH_CONFIDENCE = 0.9;
const TEXT_FALLBACK_CONFIDENCE = 0.35;

const ZONE_CODE_RE = /\b([A-Za-z]{1,5}-?\d+(?:-\d+)?)\b/gu;
const LOT_NUMBER_RE = /\b(\d[\d ]{3,}\d)\b/gu;

const ZONE_PROP_KEYS = [
  "zoneRefs",
  "zone_refs",
  "zone_ref",
  "zoneRef",
  "zones",
];

const LOT_PROP_KEYS = [
  "lotNumbers",
  "lot_numbers",
  "lot_number",
  "no_lot",
  "noLot",
  "lots",
];

export function graphGeoConfidence(): number {
  return GRAPH_CONFIDENCE;
}

export function textFallbackGeoConfidence(): number {
  return TEXT_FALLBACK_CONFIDENCE;
}

function nestedProps(props: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const nested = props?.["properties"];
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    return { ...(props ?? {}), ...(nested as Record<string, unknown>) };
  }
  return props ?? {};
}

function stringValues(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => stringValues(entry));
  }
  if (typeof value === "string") {
    return value
      .split(/[,;]/u)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === "number") {
    return [String(value)];
  }
  return [];
}

function propsValues(props: Record<string, unknown> | null | undefined, keys: string[]): string[] {
  const record = nestedProps(props);
  return keys.flatMap((key) => stringValues(record[key]));
}

function normalizeZone(code: string): string {
  return code.trim().toUpperCase();
}

function normalizeLot(noLot: string): string {
  return noLot.trim().replace(/\s+/gu, " ");
}

function uniq<T extends { code?: string; noLot?: string; source: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = item.code ?? item.noLot ?? "";
    const sourceKey = `${item.source}:${key}`;
    if (!key || seen.has(sourceKey)) continue;
    seen.add(sourceKey);
    result.push(item);
  }
  return result;
}

function isZoneNode(node: PriorityGraphNode): boolean {
  const type = node.type.toLowerCase();
  return type === "zone" || node.id.toLowerCase().startsWith("zone::");
}

function isLotNode(node: PriorityGraphNode): boolean {
  const type = node.type.toLowerCase();
  return type === "lot" || node.id.toLowerCase().startsWith("lot::");
}

function zoneCodeFromNode(node: PriorityGraphNode): string | null {
  const props = nestedProps(node.props);
  const candidates = [
    props["codeAffiche"],
    props["code_affiche"],
    props["zone_ref"],
    props["zoneRef"],
    props["code"],
    node.label,
  ];
  for (const candidate of candidates) {
    const values = stringValues(candidate);
    for (const value of values) {
      const match = value.match(ZONE_CODE_RE)?.[0];
      if (match) return normalizeZone(match);
    }
  }
  return null;
}

function lotNumberFromNode(node: PriorityGraphNode): string | null {
  const props = nestedProps(node.props);
  const candidates = [
    props["no_lot"],
    props["noLot"],
    props["lot_number"],
    props["lotNumber"],
    node.label,
  ];
  for (const candidate of candidates) {
    const values = stringValues(candidate);
    for (const value of values) {
      const match = value.match(LOT_NUMBER_RE)?.[0];
      if (match) return normalizeLot(match);
    }
  }
  return null;
}

function graphStartIds(priority: PriorityGeoInput): Set<string> {
  return new Set([priority.id, ...(priority.graphNodeIds ?? [])].filter(Boolean));
}

function graphEdgeResolutions(
  priority: PriorityGeoInput,
  graph: PriorityGraphLayer | undefined,
): { zones: ResolvedPriorityZone[]; lots: ResolvedPriorityLot[] } {
  if (!graph) return { zones: [], lots: [] };

  const startIds = graphStartIds(priority);
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const adjacentIds = new Set<string>();

  for (const edge of graph.edges) {
    if (startIds.has(edge.srcId)) adjacentIds.add(edge.dstId);
    if (startIds.has(edge.dstId)) adjacentIds.add(edge.srcId);
  }

  const zones: ResolvedPriorityZone[] = [];
  const lots: ResolvedPriorityLot[] = [];

  for (const id of adjacentIds) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (node.citySlug && node.citySlug !== priority.citySlug) continue;

    if (isZoneNode(node)) {
      const code = zoneCodeFromNode(node);
      if (code) {
        zones.push({
          code,
          source: "graph-edge",
          confidence: GRAPH_CONFIDENCE,
          graphNodeId: node.id,
        });
      }
      continue;
    }

    if (isLotNode(node)) {
      const noLot = lotNumberFromNode(node);
      if (noLot) {
        lots.push({
          noLot,
          source: "graph-edge",
          confidence: GRAPH_CONFIDENCE,
          graphNodeId: node.id,
        });
      }
    }
  }

  return {
    zones: uniq(zones),
    lots: uniq(lots),
  };
}

function fallbackZones(priority: PriorityGeoInput): ResolvedPriorityZone[] {
  const explicit = priority.zoneRefs ?? [];
  const fromProps = propsValues(priority.props, ZONE_PROP_KEYS);
  return uniq(
    [...explicit, ...fromProps]
      .map(normalizeZone)
      .filter(Boolean)
      .map((code) => ({
        code,
        source: "text-fallback" as const,
        confidence: TEXT_FALLBACK_CONFIDENCE,
      })),
  );
}

function fallbackLots(priority: PriorityGeoInput): ResolvedPriorityLot[] {
  const explicit = priority.lotNumbers ?? [];
  const fromProps = propsValues(priority.props, LOT_PROP_KEYS);
  return uniq(
    [...explicit, ...fromProps]
      .map(normalizeLot)
      .filter(Boolean)
      .map((noLot) => ({
        noLot,
        source: "text-fallback" as const,
        confidence: TEXT_FALLBACK_CONFIDENCE,
      })),
  );
}

export function resolvePriorityGeo(
  priority: PriorityGeoInput,
  graph?: PriorityGraphLayer,
): PriorityGeoResolution {
  const graphResolved = graphEdgeResolutions(priority, graph);
  if (graphResolved.zones.length > 0 || graphResolved.lots.length > 0) {
    return {
      priorityId: priority.id,
      citySlug: priority.citySlug,
      resolutionStatus: "graph",
      confidence: GRAPH_CONFIDENCE,
      zones: graphResolved.zones,
      lots: graphResolved.lots,
    };
  }

  const zones = fallbackZones(priority);
  const lots = fallbackLots(priority);
  if (zones.length > 0 || lots.length > 0) {
    return {
      priorityId: priority.id,
      citySlug: priority.citySlug,
      resolutionStatus: "text-fallback",
      confidence: TEXT_FALLBACK_CONFIDENCE,
      zones,
      lots,
    };
  }

  return {
    priorityId: priority.id,
    citySlug: priority.citySlug,
    resolutionStatus: "missing",
    confidence: 0,
    zones: [],
    lots: [],
  };
}
