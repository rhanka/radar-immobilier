/**
 * J1.2d/e wagon 3 — `signals.by-city.v1` (§4.3): the scoped by-city aggregate
 * served to an artifact reader through the named reader op (no generic
 * `/__app/` relay). Same service as the app route (`readScopedByCity`), same
 * population (viewer + workspace visibility), output rebuilt by allowlist:
 * counters only, no signal, user or document identifier.
 *
 * Params are strict: `workspaceId` plus the app client's filter subset.
 * `showDiscarded` (any value) and any other key refuse locally with 400 and
 * never reach the service — the UI never emits it.
 */
import { z } from "zod";
import { vivierCountsSchema } from "@radar/domain";
import { ClassificationError } from "../services/facets/classification-errors.js";
import { WorkspaceId } from "../services/facets/classification-query.js";

/** A real civil date (`2026-02-31` refuses): the regex shape, then a UTC round-trip. */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, "not a civil date");

/**
 * Exact §4.3 allowlist. `workspaceId` is the lowercase guid path scope; the
 * filters mirror the app client (`graph-signals-by-city-client.ts`). Unknown
 * keys (including `showDiscarded`) fail the strict parse → 400 without any
 * business call. `dateFrom <= dateTo` is enforced here — the app handler
 * does not check the order, the gate does.
 */
export const byCityParams = z.object({
  workspaceId: WorkspaceId,
  dateFrom: isoDate.optional(),
  dateTo: isoDate.optional(),
  dateBasis: z.enum(["document", "scrap"]).optional(),
  excludePiia: z.literal("1").optional(),
  excludeDerogations: z.literal("1").optional(),
}).strict().superRefine((params, context) => {
  if (params.dateFrom !== undefined && params.dateTo !== undefined && params.dateTo < params.dateFrom) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dateTo"], message: "dateTo precedes dateFrom" });
  }
});

export type ByCityParams = z.infer<typeof byCityParams>;

/** Service query derived from validated op params: never shows discarded. */
export function toByCityServiceQuery(params: ByCityParams): {
  dateRange?: { dateFrom?: string; dateTo?: string; dateBasis?: "scrap"; excludePiia?: true; excludeDerogations?: true };
  showDiscarded: false;
} {
  const filtered = params.dateFrom !== undefined || params.dateTo !== undefined
    || params.dateBasis === "scrap" || params.excludePiia !== undefined || params.excludeDerogations !== undefined;
  if (!filtered) return { showDiscarded: false };
  return {
    dateRange: {
      ...(params.dateFrom !== undefined ? { dateFrom: params.dateFrom } : {}),
      ...(params.dateTo !== undefined ? { dateTo: params.dateTo } : {}),
      ...(params.dateBasis === "scrap" ? { dateBasis: "scrap" as const } : {}),
      ...(params.excludePiia !== undefined ? { excludePiia: true as const } : {}),
      ...(params.excludeDerogations !== undefined ? { excludeDerogations: true as const } : {}),
    },
    showDiscarded: false,
  };
}

const countSchema = z.number().int().nonnegative();

/** The 16 exact intersection keys of the {z,m,p,r} axes (§4.2). */
const subsetCountsSchema = z.object({
  "": countSchema,
  z: countSchema,
  m: countSchema,
  p: countSchema,
  r: countSchema,
  "z|m": countSchema,
  "z|p": countSchema,
  "z|r": countSchema,
  "m|p": countSchema,
  "m|r": countSchema,
  "p|r": countSchema,
  "z|m|p": countSchema,
  "z|m|r": countSchema,
  "z|p|r": countSchema,
  "m|p|r": countSchema,
  "z|m|p|r": countSchema,
}).strict();

/**
 * Exact §4.2 body rebuilt by allowlist. Any extra key at any level fails the
 * strict parse — the dispatch maps that to a typed 502, never transmitted.
 * The vivier invariant (total = qualified + residentialUnknown + excluded)
 * is re-verified by `vivierCountsSchema` itself.
 */
export const byCityResponseSchema = z.object({
  ok: z.literal(true),
  totalCount: countSchema,
  cities: z.array(z.object({
    citySlug: z.string().min(1).max(128),
    signalCount: countSchema,
    subsetCounts: subsetCountsSchema,
    vivierV2Counts: vivierCountsSchema,
  }).strict()),
}).strict().superRefine((body, context) => {
  const sum = body.cities.reduce((total, city) => total + city.signalCount, 0);
  if (sum !== body.totalCount) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["totalCount"],
      message: "totalCount must equal the sum of city signalCount" });
  }
});

export type ByCityResponse = z.infer<typeof byCityResponseSchema>;

/** Parse a service result through the allowlist; any deviation is a typed 502. */
export function parseByCityResponse(value: unknown): ByCityResponse {
  const parsed = byCityResponseSchema.safeParse(value);
  if (!parsed.success) throw new ClassificationError("upstream_bad_payload");
  return parsed.data;
}
