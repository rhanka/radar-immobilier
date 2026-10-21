import { assertScope, IMMO_SCOPES, redact } from "./auth-context.js";
import {
  authorizedCallContext,
  type InvocationContext,
} from "./invocation-context.js";
import { assertValidBbox } from "./raw-data.js";
import { RAW_GEOJSON_DEFAULT_LIMIT } from "./raw-data.js";
import type {
  Bbox,
  RawFeatureCollectionResult,
} from "./raw-data.js";

export type ToolTextResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

/** Handler per tool name: same implementation for the SDK and the mesh bridge. */
export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: InvocationContext,
) => Promise<ToolTextResult>;

function jsonResult(payload: unknown, isError = false): ToolTextResult {
  const result: ToolTextResult = {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
  };
  if (isError) result.isError = true;
  return result;
}

/**
 * Hard char bound on GeoJSON tool answers (~1 MB serialized, compact JSON).
 * `limit`/`bbox` are the primary bounds; this is the last-resort guard so a
 * pathological page (huge multipolygons) can never flood the MCP client.
 */
const MAX_GEOJSON_RESPONSE_CHARS = 1_000_000;

/** GeoJSON results are serialized COMPACT (no indent): size matters here. */
function geojsonResult(payload: RawFeatureCollectionResult): ToolTextResult {
  const text = JSON.stringify(payload);
  if (text.length > MAX_GEOJSON_RESPONSE_CHARS) {
    throw new Error(
      `response_too_large: ${text.length} caractères (max ${MAX_GEOJSON_RESPONSE_CHARS}). ` +
        "Réduisez limit ou resserrez bbox.",
    );
  }
  return { content: [{ type: "text", text }] };
}

/**
 * Shared bound checks for the two GeoJSON tools: valid bbox when present,
 * and bbox REQUIRED past the default page size (anti "give me the whole
 * city" — 15 000+ lots would flood the context).
 */
function checkGeoBounds(args: { bbox?: Bbox | undefined; limit: number }): void {
  if (args.bbox) assertValidBbox(args.bbox);
  if (args.limit > RAW_GEOJSON_DEFAULT_LIMIT && !args.bbox) {
    throw new Error(
      `bbox_required: limit > ${RAW_GEOJSON_DEFAULT_LIMIT} exige un bbox ` +
        "[minLon, minLat, maxLon, maxLat] pour borner la réponse.",
    );
  }
}

interface SearchLotsToolArgs {
  city: string;
  zone?: string;
  no_lot?: string;
  minArea?: number;
  limit: number;
}

interface GetLotCardToolArgs {
  city: string;
  no_lot: string;
}

interface SearchSignalsToolArgs {
  city: string;
  etape?: string;
  query?: string;
  showDiscarded?: boolean;
  limit: number;
}

interface GetOpportunityDossierToolArgs {
  city: string;
  opportunityId: string;
}

interface ListDocumentsToolArgs {
  city?: string;
  limit: number;
}

interface ReadDocumentExcerptToolArgs {
  documentId: string;
  offset: number;
  maxChars: number;
}

async function searchLotsHandler(
  rawArgs: Record<string, unknown>,
  ctx: InvocationContext,
): Promise<ToolTextResult> {
  const args = rawArgs as unknown as SearchLotsToolArgs;
  assertScope(ctx.auth, IMMO_SCOPES.search);
  const lots = await ctx.data.searchLots(args);
  return jsonResult({ city: args.city, count: lots.length, lots });
}

async function getLotCardHandler(
  rawArgs: Record<string, unknown>,
  ctx: InvocationContext,
): Promise<ToolTextResult> {
  const args = rawArgs as unknown as GetLotCardToolArgs;
  assertScope(ctx.auth, IMMO_SCOPES.read);
  const card = await ctx.data.getLotCard(args);
  if (!card) return jsonResult({ found: false, city: args.city, no_lot: args.no_lot });
  return jsonResult({ found: true, lot: card });
}

async function searchSignalsHandler(
  rawArgs: Record<string, unknown>,
  ctx: InvocationContext,
): Promise<ToolTextResult> {
  const args = rawArgs as unknown as SearchSignalsToolArgs;
  assertScope(ctx.auth, IMMO_SCOPES.search);
  // Per-user egress (D4): the CURRENT snapshot bearer reaches the radar API.
  // No exchange is performed here; a later stage swaps this credential.
  const signals = await ctx.data.searchSignals(args, authorizedCallContext(ctx));
  return jsonResult({ city: args.city, count: signals.length, signals });
}

/**
 * One handler per tool, keyed by exact tool name. The SDK registrar and the
 * future cluster-mesh bridge resolve through this map: there is no second
 * dispatcher and no duplicated business logic.
 */
export const TOOL_HANDLERS: Readonly<Record<string, ToolHandler>> = Object.freeze({
  search_lots: searchLotsHandler,
  get_lot_card: getLotCardHandler,
  search_signals: searchSignalsHandler,
});
