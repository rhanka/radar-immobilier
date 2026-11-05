import { z } from "zod";
import type { ReaderOperationName } from "./reader-operations.js";
import { appMeResponseSchema } from "./reader-me.js";
import { parseByCityResponse } from "./reader-by-city.js";
import { Availability, FacetContextResponse } from "../services/facets/classification-context-contract.js";
import { WorkspaceId } from "../services/facets/classification-query.js";
import { SignalSearchResponse } from "../services/facets/classification-search-contract.js";
import { SignalStateResponse } from "../services/facets/classification-state.js";
import { ZONING_PROJECTION_FIELDS } from "../services/geo/zoning-projection.js";

const geoResponse = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({ zoneCode: z.string(), citySlug: z.string() }).strict()).max(100),
}).strict();
const signal = z.object({ id: z.string(), city: z.string(), kind: z.string(), detail: z.string().nullable() }).strict();
const signalsResponse = z.object({ city: z.string(), reader: z.string(), signals: z.array(signal) }).strict();

// ── I-1B governed geo responses (converged-geo-mesh r3 §2) ──
// Bounded catalogue reads: cities of the served catalogue, and bounded
// FeatureCollections with numberMatched/numberReturned/truncated. Field
// content itself is enforced by the reader-geo allowlist, not here.
const geoCitiesResponse = z.object({
  ok: z.literal(true),
  cities: z.array(z.object({
    citySlug: z.string(),
    zoneCount: z.number(),
    lotCount: z.number(),
    signalCount: z.number(),
    collections: z.array(z.string()),
  }).strict()),
}).strict();

const ZONING_V1_RESPONSE_KEYS: ReadonlySet<string> = new Set([
  ...ZONING_PROJECTION_FIELDS,
  "proof",
  "immo_zone_lot_provenance",
]);

const geoCollectionItemsResponse = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({
    type: z.literal("Feature"),
    geometry: z.unknown(),
    properties: z.record(z.string(), z.unknown()),
  }).strict()).max(1000),
  numberMatched: z.number().int().nonnegative(),
  numberReturned: z.number().int().nonnegative(),
  truncated: z.boolean(),
  // J1 zonage: paging cursor, projection kind and the licence record.
  nextOffset: z.number().int().nonnegative().nullable(),
  projection: z.enum(["zoning-v1", "allowlist"]),
  collectionId: z.string(),
  licenseId: z.string(),
  license: z.object({
    id: z.string(),
    title: z.string(),
    href: z.string().nullable(),
    attribution: z.string().nullable(),
  }).strict(),
  rights: z.union([
    z.object({ source: z.literal("geo") }).strict(),
    z.object({ source: z.literal("derived-from-licence"), licenceId: z.string(), attribution: z.string() }).strict(),
  ]),
  contract: z.object({
    status: z.string(),
    snapshot_sha256: z.string().optional(),
    reason: z.string().optional(),
  }).strict(),
}).strict().superRefine((value, ctx) => {
  // J1 zonage: a zoning-v1 page carries the CLOSED projection keys only.
  if (value.projection !== "zoning-v1") return;
  for (const feature of value.features) {
    for (const key of Object.keys(feature.properties)) {
      if (!ZONING_V1_RESPONSE_KEYS.has(key)) {
        ctx.addIssue({ code: "custom", message: "zoning-v1 property outside the closed projection" });
        return;
      }
    }
  }
});


/**
 * J1.2d/e §3.3 server-side shape adapter output: what the app
 * `parseWorkspacesResponse` accepts — nested workspace rows with constant
 * read-only capabilities — served alongside the published v1 row (labels
 * and signal/basket availability) that existing starter pages read. Never
 * `accountId`, never `scope`, never the real capabilities.
 */
export const ReaderWorkspacesResponse = z.object({
  ok: z.literal(true),
  workspaces: z.array(z.object({
    id: WorkspaceId, slug: z.string(), label: z.string(),
    signals: z.object({ availability: Availability }).strict(),
    workspace: z.object({ id: WorkspaceId, slug: z.string(), label: z.string() }).strict(),
    moderateArchive: z.literal(false),
    manageMembers: z.literal(false),
  }).strict().refine((row) => row.workspace.id === row.id && row.workspace.slug === row.slug
    && row.workspace.label === row.label)).max(64),
}).strict();

/**
 * A bound adapter must normalize receiving API results into these shapes.
 * Basket operations reuse the existing classification contracts byte for
 * byte (same schemas, limits and strictness as the workspace routes):
 * - baskets.context.v1 -> FacetContextResponse
 * - baskets.search.v1 -> SignalSearchResponse
 * - baskets.state.v1 -> SignalStateResponse
 */
export function validateReaderResponse(op: ReaderOperationName, value: unknown, readerSub: string): Record<string, unknown> {
  if (op === "app.me.v1") return appMeResponseSchema.parse(value);
  if (op === "workspaces.list.v1") return ReaderWorkspacesResponse.parse(value);
  if (op === "signals.by-city.v1") return parseByCityResponse(value);
  if (op === "geo.read.v1") return geoResponse.parse(value);
  if (op === "geo.cities.v1") return geoCitiesResponse.parse(value);
  if (op === "geo.collection-items.v1") return geoCollectionItemsResponse.parse(value);
  if (op === "baskets.context.v1") return FacetContextResponse.parse(value);
  if (op === "baskets.search.v1") return SignalSearchResponse.parse(value);
  if (op === "baskets.state.v1") return SignalStateResponse.parse(value);
  if (op !== "signals.protected-read.v1") throw new Error("Capability unavailable");
  const response = signalsResponse.parse(value);
  if (response.reader !== readerSub) throw new Error("Reader identity mismatch");
  return response;
}
