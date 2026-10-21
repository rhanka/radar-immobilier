import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { FacetError, FacetHeadConflictError } from "../services/facets/target.js";
import { writeFacet } from "../services/facets/writer.js";
import { readCityFacets, readReasonCodes } from "../services/facets/reader.js";
import { FACET_PROFILE } from "../services/facets/codebook.js";
import { privateSignalResponse } from "../services/facets/private-response.js";
import { facetEventResponse } from "../services/facets/response.js";

const target = z.object({
  citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  type: z.enum(["Signal", "DesignationEvent"]),
  id: z.string().min(1).max(512).refine((id) => !id.includes(String.fromCharCode(0))),
}).strict();
const basket = z.enum(["pertinent", "a_surveiller"]);
// The negative lookahead enforces the absolute end, including a final newline.
const reasonCode = z.string().max(128).regex(/^[A-Z0-9]+(-[A-Z0-9]+)*(?![\s\S])/).optional();
const expectedHeadId = z.string().uuid().nullable();
const expectedSelectionHeads = z.object({
  pertinent: z.string().uuid().nullable().optional(),
  a_surveiller: z.string().uuid().nullable().optional(),
}).strict().optional();
const discardSchema = z.object({
  target, reasonCode, deselect: z.array(basket).max(2).optional(),
  expectedHeadId, expectedSelectionHeads,
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
  select: z.object({ target, basket, reasonCode, expectedHeadId }).strict(),
  deselect: z.object({ target, basket, expectedHeadId }).strict(),
  discard: discardSchema,
  restore: z.object({ target, expectedHeadId }).strict(),
};
export interface SignalFacetsDeps { db: Database; auth?: { enabled: boolean } }
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
      const parsed = schemas[action].safeParse(await c.req.json().catch(() => null));
      const key = z.string().uuid().transform((value) => value.toLowerCase()).safeParse(c.req.header("Idempotency-Key"));
      if (!parsed.success || !key.success) return c.json({ error: "invalid_facet_command" }, 400);
      const session = c.get("session" as never) as { sub: string };
      try {
        const event = await writeFacet(deps.db, session.sub, { ...parsed.data, action, commandKey: key.data });
        return c.json({ ok: true, event: event ? facetEventResponse(event) : null });
      } catch (error) {
        if (error instanceof FacetHeadConflictError) {
          return c.json({ error: error.message, current: error.current }, error.status);
        }
        if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
        throw error;
      }
    });
  }
  app.get("/api/v1/signal-facets/reason-codes", async (c) => {
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
