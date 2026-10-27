import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { FacetError, FacetHeadConflictError, FacetTargetVersionConflictError } from "../services/facets/target.js";
import { recoverHistoricalFacet, writeFacet } from "../services/facets/writer.js";
import { readCityFacets, readReasonCodes } from "../services/facets/reader.js";
import { FACET_PROFILE } from "../services/facets/codebook.js";
import { privateSignalResponse } from "../services/facets/private-response.js";
import { legacyFenceError, legacyFenceStatus, type LegacyRetirementState } from "../services/facets/legacy-retirement.js";
import { facetEventResponse } from "../services/facets/response.js";

const target = z.object({
  citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  type: z.enum(["Signal", "DesignationEvent"]),
  id: z.string().min(1).max(512).refine((id) => !id.includes(String.fromCharCode(0))),
}).strict();
const basket = z.enum(["pertinent", "a_surveiller"]);
// The negative lookahead enforces the absolute end, including a final newline.
const reasonCode = z.string().max(128).regex(/^[A-Z0-9]+(-[A-Z0-9]+)*(?![\s\S])/).optional();
const expectedHeadId = z.string().guid().nullable();
const expectedSelectionHeads = z.object({
  pertinent: z.string().guid().nullable().optional(),
  a_surveiller: z.string().guid().nullable().optional(),
}).strict().optional();
const displayedFingerprint = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const discardSchema = z.object({
  target, reasonCode, deselect: z.array(basket).max(2).optional(),
  expectedHeadId, expectedSelectionHeads, displayedFingerprint,
}).strict().superRefine((value, ctx) => {
  const removals = [...new Set(value.deselect ?? [])].sort();
  if (removals.length === 0) {
    if (value.expectedSelectionHeads !== undefined) {
      ctx.addIssue({ code: "custom", message: "invalid_facet_command" });
    }
    return;
  }
  const expected = value.expectedSelectionHeads;
  if (expected === undefined) {
    ctx.addIssue({ code: "custom", message: "invalid_facet_command" });
    return;
  }
  const keys = Object.keys(expected).sort();
  if (keys.length !== removals.length || keys.some((key, index) => key !== removals[index])) {
    ctx.addIssue({ code: "custom", message: "invalid_facet_command" });
  }
});
const schemas = {
  select: z.object({ target, basket, reasonCode, expectedHeadId, displayedFingerprint }).strict(),
  deselect: z.object({ target, basket, expectedHeadId, displayedFingerprint }).strict(),
  discard: discardSchema,
  restore: z.object({ target, expectedHeadId, displayedFingerprint }).strict(),
};
const historicalSchemas = {
  select: z.object({ target, basket, reasonCode }).strict(),
  deselect: z.object({ target, basket }).strict(),
  discard: z.object({ target, reasonCode, deselect: z.array(basket).max(2).optional() }).strict(),
  restore: z.object({ target }).strict(),
};
const headSchemas = {
  select: historicalSchemas.select.extend({ expectedHeadId }),
  deselect: historicalSchemas.deselect.extend({ expectedHeadId }),
  discard: historicalSchemas.discard.extend({ expectedHeadId, expectedSelectionHeads }),
  restore: historicalSchemas.restore.extend({ expectedHeadId }),
};
export interface SignalFacetsDeps { db: Database; auth?: { enabled: boolean }; retirement?: LegacyRetirementState }
export function signalFacetsRoute(deps: SignalFacetsDeps): Hono {
  const app = new Hono();
  app.use("/api/v1/signal-facets/*", privateSignalResponse);
  app.use("/api/v1/signal-facets/*", async (c, next) => {
    const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
    if (!["GET", "HEAD"].includes(c.req.method) && session.via === "bearer") return c.json({ error: "browser_session_required" }, 403);
    if (c.req.method === "GET" && !z.object({}).strict().safeParse(c.req.query()).success) {
      return c.json({ error: "invalid_facet_query" }, 400);
    }
    return next();
  });
  for (const action of ["select", "deselect", "discard", "restore"] as const) {
    app.post(`/api/v1/signal-facets/${action}`, async (c) => {
      const fence = legacyFenceStatus(deps.retirement);
      if (fence !== null) {
        return c.json({ error: legacyFenceError(fence),
          successor: `POST /api/v1/workspaces/:workspaceId/signal-facets/personal/${action}` }, fence);
      }
      const body = await c.req.json().catch(() => null);
      const parsed = schemas[action].safeParse(body);
      const key = z.string().guid().transform((value) => value.toLowerCase()).safeParse(c.req.header("Idempotency-Key"));
      if (!key.success) return c.json({ error: "invalid_facet_command" }, 400);
      const previousHead = headSchemas[action].safeParse(body);
      const historical = parsed.success ? null : previousHead.success
        ? previousHead : historicalSchemas[action].safeParse(body);
      if (!parsed.success && !historical?.success) return c.json({ error: "invalid_facet_command" }, 400);
      const session = c.get("session" as never) as { sub: string };
      try {
        const event = parsed.success
          ? await writeFacet(deps.db, session.sub, { ...parsed.data, action, commandKey: key.data })
          : await recoverHistoricalFacet(deps.db, session.sub,
            { ...historical!.data!, action, commandKey: key.data });
        return c.json({ ok: true, event: event ? facetEventResponse(event) : null });
      } catch (error) {
        if (error instanceof FacetHeadConflictError) {
          return c.json({ error: error.message, current: error.current }, error.status);
        }
        if (error instanceof FacetTargetVersionConflictError) {
          return c.json({ error: error.message, current: error.current }, error.status);
        }
        if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
        throw error;
      }
    });
  }
  app.get("/api/v1/signal-facets/reason-codes", async (c) => {
    const fence = legacyFenceStatus(deps.retirement);
    if (fence !== null) {
      return c.json({ error: legacyFenceError(fence),
        successor: "GET /api/v1/workspaces/:workspaceId/signal-facets/reason-codes" }, fence);
    }
    const session = c.get("session" as never) as { sub: string };
    try {
      const codes = await readReasonCodes(deps.db, session.sub);
      return c.json({ ok: true, profileId: FACET_PROFILE, codes });
    } catch (error) {
      if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  app.get("/api/v1/signal-facets/cities/:city", async (c) => {
    const fence = legacyFenceStatus(deps.retirement);
    if (fence !== null) {
      return c.json({ error: legacyFenceError(fence),
        successor: "GET /api/v1/workspaces/:workspaceId/signal-facets/personal/cities/:city" }, fence);
    }
    const session = c.get("session" as never) as { sub: string };
    const city = c.req.param("city");
    if (!target.shape.citySlug.safeParse(city).success) return c.json({ error: "invalid_city" }, 400);
    try {
      return c.json({ ok: true, heads: await readCityFacets(deps.db, session.sub, city) });
    } catch (error) {
      if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  return app;
}
