/**
 * 6H scoped signal-facet routes: personal commands evaluated in an explicit
 * workspace. GATED: this router is not mounted in `app.ts` until the
 * protected 6H activation opens the scope. Legacy routes keep serving
 * unchanged behavior; nothing here retires them (6K/6L own that cutover).
 */
import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import {
  FacetError,
  FacetHeadConflictError,
  FacetTargetVersionConflictError,
} from "../services/facets/target.js";
import { ScopeError } from "../services/facets/scope.js";
import { readScopedPersonalHeads } from "../services/facets/scoped-reader.js";
import { writeScopedPersonalFacet } from "../services/facets/scoped-writer.js";
import { privateSignalResponse } from "../services/facets/private-response.js";
import { facetEventResponse } from "../services/facets/response.js";
import { WorkspaceError, WorkspaceRevisionConflictError } from "../services/workspaces/types.js";

const target = z.object({
  citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  type: z.enum(["Signal", "DesignationEvent"]),
  id: z.string().min(1).max(512),
}).strict();
const basket = z.enum(["pertinent", "a_surveiller"]);
const reasonCode = z.string().max(128).regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/).optional();
const expectedHeadId = z.string().guid().nullable();
const expectedSelectionHeads = z.object({
  pertinent: z.string().guid().nullable().optional(),
  a_surveiller: z.string().guid().nullable().optional(),
}).strict().optional();
const displayedFingerprint = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const workspaceId = z.string().guid();
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

const schemas = {
  select: z.object({ target, basket, reasonCode, expectedHeadId, displayedFingerprint }).strict(),
  deselect: z.object({ target, basket, expectedHeadId, displayedFingerprint }).strict(),
  discard: z.object({
    target, reasonCode, deselect: z.array(basket).max(2).optional(),
    expectedHeadId, expectedSelectionHeads, displayedFingerprint,
  }).strict(),
  restore: z.object({ target, expectedHeadId, displayedFingerprint }).strict(),
};

export interface ScopedSignalFacetsDeps {
  db: Database;
  auth?: { enabled: boolean };
}

const SCOPED_PERSONAL_PREFIX = "/api/v1/workspaces/:workspaceId/signal-facets/personal/*";

export function scopedSignalFacetsRoute(deps: ScopedSignalFacetsDeps): Hono {
  const app = new Hono();
  app.use(SCOPED_PERSONAL_PREFIX, privateSignalResponse);
  app.use(SCOPED_PERSONAL_PREFIX, async (c, next) => {
    const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
    if (c.req.method !== "GET" && session.via === "bearer") {
      return c.json({ error: "browser_session_required" }, 403);
    }
    if (!workspaceId.safeParse(c.req.param("workspaceId")).success) {
      return c.json({ error: "invalid_scoped_identity" }, 400);
    }
    return next();
  });
  for (const action of ["select", "deselect", "discard", "restore"] as const) {
    app.post(`/api/v1/workspaces/:workspaceId/signal-facets/personal/${action}`, async (c) => {
      const body = await c.req.json().catch(() => null);
      const parsed = schemas[action].safeParse(body);
      const key = z.string().guid().transform((value) => value.toLowerCase())
        .safeParse(c.req.header("Idempotency-Key"));
      if (!key.success) return c.json({ error: "invalid_facet_command" }, 400);
      const previousHead = parsed.success ? null : headSchemas[action].safeParse(body);
      const historical = parsed.success ? null : previousHead!.success
        ? previousHead : historicalSchemas[action].safeParse(body);
      if (!parsed.success && !historical!.success) {
        return c.json({ error: "invalid_facet_command" }, 400);
      }
      const session = c.get("session" as never) as { sub: string };
      try {
        const event = parsed.success
          ? await writeScopedPersonalFacet(deps.db, session.sub,
            c.req.param("workspaceId"), { ...parsed.data, action, commandKey: key.data })
          : await writeScopedPersonalFacet(deps.db, session.sub,
            c.req.param("workspaceId"), { ...historical!.data!, action, commandKey: key.data });
        return c.json({ ok: true, event: event ? facetEventResponse(event) : null });
      } catch (error) {
        if (error instanceof FacetHeadConflictError) {
          return c.json({ error: error.message, current: error.current }, error.status);
        }
        if (error instanceof FacetTargetVersionConflictError) {
          return c.json({ error: error.message, current: error.current }, error.status);
        }
        if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
        if (error instanceof WorkspaceRevisionConflictError) {
          return c.json({ error: error.message, current: error.current }, error.status);
        }
        if (error instanceof WorkspaceError || error instanceof ScopeError) {
          return c.json({ error: error.message }, error.status);
        }
        throw error;
      }
    });
  }
  app.get("/api/v1/workspaces/:workspaceId/signal-facets/personal/cities/:city", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    try {
      const heads = await readScopedPersonalHeads(deps.db, session.sub,
        c.req.param("workspaceId"), c.req.param("city"));
      return c.json({ ok: true, heads });
    } catch (error) {
      if (error instanceof WorkspaceError || error instanceof ScopeError) {
        return c.json({ error: error.message }, error.status);
      }
      if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  return app;
}
