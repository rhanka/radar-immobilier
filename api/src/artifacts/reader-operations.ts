/**
 * Named, versioned reader API operations (ARTEFACTS A6/H5).
 *
 * Content calls operations by name — never an arbitrary URL, authority
 * header or identity. Each operation validates method, parameters and
 * response. Legacy geo/signal reads run on synthetic fixtures; the basket
 * reads below are bound by the L3 bridge to the existing classification
 * services (no new basket storage):
 * - baskets.context.v1 -> readFacetContext
 * - baskets.search.v1 -> searchSignalClassifications
 * - baskets.state.v1 -> readSignalClassification
 * A closed capability fails locally (503) without disabling publication,
 * page opening or unrelated operations.
 */
import { z } from "zod";
import { SignalQuery, StateQuery, WorkspaceId } from "../services/facets/classification-query.js";

export const READER_OPERATIONS = [
  "geo.read.v1",
  "signals.protected-read.v1",
  "status.closed.v1",
  "baskets.context.v1",
  "baskets.search.v1",
  "baskets.state.v1",
] as const;
export type ReaderOperationName = (typeof READER_OPERATIONS)[number];
export type BasketOperationName = Extract<ReaderOperationName, `baskets.${string}`>;

const geoParams = z.object({
  collectionId: z.string().regex(/^qc-(zonage|lots)-[a-z0-9-]+$/),
  limit: z.number().int().min(1).max(100).default(10),
}).strict();

const signalsParams = z.object({
  city: z.string().min(1).max(64),
}).strict();

export const basketsContextParams = z.object({
  workspaceId: WorkspaceId,
}).strict();

export const basketsSearchParams = SignalQuery.extend({
  workspaceId: WorkspaceId,
}).strict();

export const basketsStateParams = StateQuery.extend({
  workspaceId: WorkspaceId,
}).strict();

export function isReaderOperation(name: string): name is ReaderOperationName {
  return (READER_OPERATIONS as readonly string[]).includes(name);
}

export function isBasketOperation(name: string): name is BasketOperationName {
  return name === "baskets.context.v1" || name === "baskets.search.v1" || name === "baskets.state.v1";
}

export function operationMethod(name: ReaderOperationName): "GET" {
  void name;
  return "GET";
}

export function validateOperationParams(
  name: ReaderOperationName,
  params: unknown,
): { ok: true; params: unknown } | { ok: false; error: string } {
  try {
    if (name === "geo.read.v1") return { ok: true, params: geoParams.parse(params) };
    if (name === "signals.protected-read.v1") return { ok: true, params: signalsParams.parse(params) };
    if (name === "baskets.context.v1") return { ok: true, params: basketsContextParams.parse(params) };
    if (name === "baskets.search.v1") return { ok: true, params: basketsSearchParams.parse(params) };
    if (name === "baskets.state.v1") return { ok: true, params: basketsStateParams.parse(params) };
    return { ok: true, params: {} };
  } catch {
    return { ok: false, error: "invalid_params" };
  }
}
export interface SyntheticGeoFeature {
  readonly zoneCode: string;
  readonly citySlug: string;
}

export function syntheticGeoItems(collectionId: string, limit: number): SyntheticGeoFeature[] {
  const city = collectionId.split("-").slice(2).join("-") || "valleyfield";
  const count = Math.min(limit, 2);
  const items: SyntheticGeoFeature[] = [];
  for (let i = 0; i < count; i += 1) {
    items.push({ zoneCode: `H-10${i + 1}`, citySlug: city });
  }
  return items;
}

export interface SyntheticSignal {
  readonly id: string;
  readonly city: string;
  readonly kind: string;
  readonly detail: string | null;
}

export function syntheticSignals(city: string, readerSub: string): SyntheticSignal[] {
  if (city !== "valleyfield") return [];
  if (readerSub === "reader-alice") {
    return [
      { id: "sig-1", city, kind: "zonage", detail: "H-101 densification evidence" },
      { id: "sig-2", city, kind: "derogation", detail: "minor variance file 24-118" },
    ];
  }
  if (readerSub === "reader-bob") {
    return [{ id: "sig-1", city, kind: "zonage", detail: null }];
  }
  return [];
}
