/**
 * 6I scoped workspace-archive routes: moderator-only common archive.
 * GATED: this router is not mounted in `app.ts` until the protected 6H
 * activation opens the scope. Legacy routes keep serving unchanged
 * behavior; nothing here retires them (6K/6L own that cutover).
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
import {
  readWorkspaceArchiveCity,
  type WorkspaceArchiveHead,
} from "../services/facets/workspace-reader.js";
import { writeWorkspaceArchiveFacet } from "../services/facets/workspace-writer.js";
import { facetEventResponse } from "../services/facets/response.js";
import {
  WorkspaceError,
  WorkspaceRevisionConflictError,
} from "../services/workspaces/types.js";

const target = z.object({
  citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  type: z.enum(["Signal", "DesignationEvent"]),
  id: z.string().min(1).max(512),
}).strict();
const reasonCode = z.string().max(128).regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/);
const expectedHeadId = z.string().uuid().nullable();
const displayedFingerprint = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const workspaceId = z.string().uuid();
const city = z.string().min(1).max(128).regex(/^[a-z0-9-]+$/);

const discardSchema = z.object({ target, reasonCode, expectedHeadId, displayedFingerprint }).strict();
const restoreSchema = z.object({ target, expectedHeadId, displayedFingerprint }).strict();

export interface ScopedWorkspaceArchiveDeps {
  db: Database;
  auth?: { enabled: boolean };
}

function headResponse(head: WorkspaceArchiveHead) {
  return head;
}

export function scopedWorkspaceArchiveRoute(deps: ScopedWorkspaceArchiveDeps): Hono {
  const app = new Hono();
  app.use("/api/v1/workspaces/:workspaceId/signal-facets/*", async (c, next) => {
    c.header("Cache-Control", "private, no-store");
    c.header("Vary", "Cookie, Authorization");
    await next();
  });
  app.use("/api/v1/workspaces/:workspaceId/signal-facets/*", async (c, next) => {
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
  for (const action of ["discard", "restore"] as const) {
    app.post(`/api/v1/workspaces/:workspaceId/signal-facets/workspace/${action}`, async (c) => {
      const body = await c.req.json().catch(() => null);
      const schema = action === "discard" ? discardSchema : restoreSchema;
      const parsed = schema.safeParse(body);
      const key = z.string().uuid().transform((value) => value.toLowerCase())
        .safeParse(c.req.header("Idempotency-Key"));
      if (!parsed.success || !key.success) {
        return c.json({ error: "invalid_facet_command" }, 400);
      }
      const session = c.get("session" as never) as { sub: string };
      try {
        const event = await writeWorkspaceArchiveFacet(deps.db, session.sub,
          c.req.param("workspaceId"), { ...parsed.data, action, commandKey: key.data });
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
  app.get("/api/v1/workspaces/:workspaceId/signal-facets/archive/cities/:city", async (c) => {
    const session = c.get("session" as never) as { sub: string };
    if (!city.safeParse(c.req.param("city")).success) {
      return c.json({ error: "invalid_scoped_identity" }, 400);
    }
    try {
      const rows = await readWorkspaceArchiveCity(deps.db, session.sub,
        c.req.param("workspaceId"), c.req.param("city"));
      return c.json({ ok: true, heads: rows.map((row) => ({
        target: row.target,
        personal: row.personal ? headResponse(row.personal) : null,
        workspace: row.workspace ? headResponse(row.workspace) : null,
        effectiveDiscarded: row.effectiveDiscarded,
        capabilities: row.capabilities,
      })) });
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
