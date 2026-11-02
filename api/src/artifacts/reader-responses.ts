import { z } from "zod";
import type { ReaderOperationName } from "./reader-operations.js";
import { Availability, FacetContextResponse } from "../services/facets/classification-context-contract.js";
import { WorkspaceId } from "../services/facets/classification-query.js";
import { SignalSearchResponse } from "../services/facets/classification-search-contract.js";
import { SignalStateResponse } from "../services/facets/classification-state.js";

const geoResponse = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(z.object({ zoneCode: z.string(), citySlug: z.string() }).strict()).max(100),
}).strict();
const signal = z.object({ id: z.string(), city: z.string(), kind: z.string(), detail: z.string().nullable() }).strict();
const signalsResponse = z.object({ city: z.string(), reader: z.string(), signals: z.array(signal) }).strict();

/** Discovery exposes labels and signal/basket availability, never account or membership details. */
export const ReaderWorkspacesResponse = z.object({
  ok: z.literal(true),
  workspaces: z.array(z.object({
    id: WorkspaceId, slug: z.string(), label: z.string(),
    signals: z.object({ availability: Availability }).strict(),
  }).strict()),
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
  if (op === "workspaces.list.v1") return ReaderWorkspacesResponse.parse(value);
  if (op === "geo.read.v1") return geoResponse.parse(value);
  if (op === "baskets.context.v1") return FacetContextResponse.parse(value);
  if (op === "baskets.search.v1") return SignalSearchResponse.parse(value);
  if (op === "baskets.state.v1") return SignalStateResponse.parse(value);
  if (op !== "signals.protected-read.v1") throw new Error("Capability unavailable");
  const response = signalsResponse.parse(value);
  if (response.reader !== readerSub) throw new Error("Reader identity mismatch");
  return response;
}
