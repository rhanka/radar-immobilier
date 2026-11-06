import { contractInteger } from "@radar/domain";
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
import { appMeParams } from "./reader-me.js";
import { byCityParams } from "./reader-by-city.js";
import { coherentCityParams } from "./reader-coherent-city.js";
import { documentsPvParams } from "./reader-documents.js";

export const READER_OPERATIONS = [
  "geo.read.v1",
  "geo.cities.v1",
  "geo.collection-items.v1",
  "signals.protected-read.v1",
  "status.closed.v1",
  "app.me.v1",
  "workspaces.list.v1",
  "signals.by-city.v1",
  "signals.coherent-city.v1",
  "documents.pv.v1",
  "baskets.context.v1",
  "baskets.search.v1",
  "baskets.state.v1",
] as const;
export type ReaderOperationName = (typeof READER_OPERATIONS)[number];
export type BasketOperationName = Extract<ReaderOperationName, `baskets.${string}`>;
export const workspacesListParams = z.object({}).strict();

const geoParams = z.object({
  collectionId: z.string().regex(/^qc-(zonage|lots)-[a-z0-9-]+$/),
  limit: contractInteger().min(1).max(100).default(10),
}).strict();

const signalsParams = z.object({
  city: z.string().min(1).max(64),
}).strict();

// ── I-1B governed geo operations (converged-geo-mesh r3 §2) ──
// Municipal, non-personal catalogue reads. `geo.cities.v1` takes no
// parameter; `geo.collection-items.v1` is bounded (limit default 200 / max
// 1000, bbox mandatory above 200 — enforced by the reader-geo service) and
// serves the known-licence qc-zonage catalogue only.
export const geoCitiesParams = z.object({}).strict();

const geoBbox = z.string().regex(
  /^-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?,-?\d+(\.\d+)?$/,
);

// J1 zonage: `offset` is bounded and `fields` selects a subset of the
// record's served fields (closed set checked by the reader-geo service,
// unknown field = typed 400 before any upstream call).
export const GEO_COLLECTION_ITEMS_QUERY_KEYS = ["collectionId", "limit", "bbox", "offset", "fields"] as const;

export const geoCollectionItemsParams = z.object({
  collectionId: z.string().min(1).max(128),
  limit: contractInteger().min(1).max(1000).default(200),
  bbox: geoBbox.optional(),
  offset: contractInteger().min(0).max(100_000).optional(),
  fields: z.string().max(256).regex(/^[A-Za-z]+(,[A-Za-z]+){0,15}$/).optional(),
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

// ── I-1B: operations gated by the `geo.read` capability (synthetic legacy
// `geo.read.v1` plus the governed catalogue operations). Isolated predicate
// so the I2-partage rebase keeps one obvious hunk.
export type GeoReadOperationName = "geo.read.v1" | "geo.cities.v1" | "geo.collection-items.v1";

export function isGeoReadOperation(name: string): name is GeoReadOperationName {
  return name === "geo.read.v1" || name === "geo.cities.v1" || name === "geo.collection-items.v1";
}

export function isWorkspaceReadOperation(name: string): name is BasketOperationName | "workspaces.list.v1" {
  return name === "workspaces.list.v1" || isBasketOperation(name);
}

/** J1.2d/e scoped signal ops: same workspace visibility as the basket reads. */
export type ScopedSignalOperationName = "signals.by-city.v1" | "signals.coherent-city.v1";

export function isScopedSignalOperation(name: string): name is ScopedSignalOperationName {
  return name === "signals.by-city.v1" || name === "signals.coherent-city.v1";
}

/**
 * J1.2d/e §11.3 binary resource op: the PV PDF, authorized by the sealed
 * session cookie alone (pdf.js sets no grant header; no `?grant=` URL).
 */
export function isDocumentOperation(name: string): name is "documents.pv.v1" {
  return name === "documents.pv.v1";
}

/** Every op served under Gate B (`baskets.read` consent re-read per call). */
export function isGateBOperation(name: string): boolean {
  return isWorkspaceReadOperation(name) || isScopedSignalOperation(name) || isDocumentOperation(name);
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
    if (name === "app.me.v1") return { ok: true, params: appMeParams.parse(params) };
    if (name === "workspaces.list.v1") return { ok: true, params: workspacesListParams.parse(params) };
    if (name === "signals.by-city.v1") return { ok: true, params: byCityParams.parse(params) };
    if (name === "signals.coherent-city.v1") return { ok: true, params: coherentCityParams.parse(params) };
    if (name === "documents.pv.v1") return { ok: true, params: documentsPvParams.parse(params) };
    if (name === "geo.read.v1") return { ok: true, params: geoParams.parse(params) };
    if (name === "geo.cities.v1") return { ok: true, params: geoCitiesParams.parse(params) };
    if (name === "geo.collection-items.v1") return { ok: true, params: geoCollectionItemsParams.parse(params) };
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
