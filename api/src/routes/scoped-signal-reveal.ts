import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { ScopeError } from "../services/facets/scope.js";
import { FacetError } from "../services/facets/target.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { FACET_PROFILE } from "../services/facets/codebook.js";
import { readScopedReasonCodes, readScopedReveal } from "../services/facets/scoped-reveal.js";
import { privateSignalResponse } from "../services/facets/private-response.js";

const workspaceId = z.string().uuid();
const citySlug = z.string().min(1).max(128).regex(/^[a-z0-9-]+$/);
const nodeType = z.enum(["Signal", "DesignationEvent"]);
const nodeId = z.string().min(1).max(512);
const REVEAL_PATH = "/api/v1/workspaces/:workspaceId/signal-facets/reveal";
const REASON_CODES_PATH = "/api/v1/workspaces/:workspaceId/signal-facets/reason-codes";
const REVEAL_GUARDED = [REVEAL_PATH, REASON_CODES_PATH];

export interface ScopedSignalRevealDeps {
  db: Database;
  auth?: { enabled: boolean };
}

export function scopedSignalRevealRoute(deps: ScopedSignalRevealDeps): Hono {
  const app = new Hono();
  for (const path of REVEAL_GUARDED) {
    app.use(path, privateSignalResponse);
  }
  for (const path of REVEAL_GUARDED) {
    app.use(path, async (c, next) => {
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
  }
  app.get(REVEAL_PATH, async (c) => {
    const params = z.object({ citySlug, type: nodeType, id: nodeId }).safeParse({
      citySlug: c.req.query("citySlug"), type: c.req.query("type"), id: c.req.query("id"),
    });
    if (!params.success) return c.json({ error: "invalid_scoped_identity" }, 400);
    const session = c.get("session" as never) as { sub: string };
    try {
      const revealed = await readScopedReveal(deps.db, session.sub,
        c.req.param("workspaceId"), params.data);
      return c.json({ ok: true, ...revealed });
    } catch (error) {
      if (error instanceof WorkspaceError || error instanceof ScopeError) {
        return c.json({ error: error.message }, error.status);
      }
      if (error instanceof FacetError) return c.json({ error: error.message }, error.status);
      throw error;
    }
  });
  app.get(REASON_CODES_PATH, async (c) => {
    const session = c.get("session" as never) as { sub: string };
    try {
      const codes = await readScopedReasonCodes(deps.db, session.sub, c.req.param("workspaceId"));
      return c.json({ ok: true, profileId: FACET_PROFILE, codes });
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
