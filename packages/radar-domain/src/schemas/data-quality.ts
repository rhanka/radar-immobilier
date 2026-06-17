import { z } from "zod";

export const DataQualityState = z.enum(["unknown", "partial", "fresh", "stale"]);
export type DataQualityStateT = z.infer<typeof DataQualityState>;

export const DataQualityFreshness = z.enum(["unknown", "fresh", "stale"]);
export type DataQualityFreshnessT = z.infer<typeof DataQualityFreshness>;

const NullableIsoDateTime = z.string().datetime().nullable();

export const DataQualityCollectionCounts = z.object({
  records: z.number().int().nonnegative(),
  todo: z.number().int().nonnegative(),
  identified: z.number().int().nonnegative(),
  scraped: z.number().int().nonnegative(),
  graphified: z.number().int().nonnegative(),
  error: z.number().int().nonnegative(),
});
export type DataQualityCollectionCountsT = z.infer<
  typeof DataQualityCollectionCounts
>;

export const DataQualityCollectionSummary = z.object({
  status: DataQualityState,
  freshness: DataQualityFreshness,
  lastObservedAt: NullableIsoDateTime,
  counts: DataQualityCollectionCounts,
});
export type DataQualityCollectionSummaryT = z.infer<
  typeof DataQualityCollectionSummary
>;

export const DataQualityOntologyCounts = z.object({
  nodes: z.number().int().nonnegative(),
  edges: z.number().int().nonnegative(),
  signals: z.number().int().nonnegative(),
  designationEvents: z.number().int().nonnegative(),
  zones: z.number().int().nonnegative(),
  lots: z.number().int().nonnegative(),
  bylaws: z.number().int().nonnegative(),
});
export type DataQualityOntologyCountsT = z.infer<
  typeof DataQualityOntologyCounts
>;

export const DataQualityOntologySummary = z.object({
  status: DataQualityState,
  freshness: DataQualityFreshness,
  lastObservedAt: NullableIsoDateTime,
  counts: DataQualityOntologyCounts,
});
export type DataQualityOntologySummaryT = z.infer<
  typeof DataQualityOntologySummary
>;

export const DataQualityGeoSource = z.object({
  availability: z.string(),
  quality: z.string(),
  hasUrl: z.boolean(),
});
export type DataQualityGeoSourceT = z.infer<typeof DataQualityGeoSource>;

export const DataQualityGeoCounts = z.object({
  inventoryLayers: z.number().int().nonnegative(),
  currentVersions: z.number().int().nonnegative(),
  withGeometry: z.number().int().nonnegative(),
});
export type DataQualityGeoCountsT = z.infer<typeof DataQualityGeoCounts>;

export const DataQualityGeoSummary = z.object({
  status: DataQualityState,
  freshness: DataQualityFreshness,
  lastObservedAt: NullableIsoDateTime,
  source: DataQualityGeoSource.nullable(),
  counts: DataQualityGeoCounts,
});
export type DataQualityGeoSummaryT = z.infer<typeof DataQualityGeoSummary>;

export const DataQualityCitySummary = z.object({
  citySlug: z.string().min(1),
  generatedAt: z.string().datetime(),
  councilMinutes: DataQualityCollectionSummary,
  youtube: DataQualityCollectionSummary,
  ontology: DataQualityOntologySummary,
  zones: DataQualityGeoSummary,
  lots: DataQualityGeoSummary,
});
export type DataQualityCitySummaryT = z.infer<typeof DataQualityCitySummary>;
