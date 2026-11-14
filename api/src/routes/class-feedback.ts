import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { classFeedbackCommand } from "../services/graph/class-feedback-command.js";
import { writeClassFeedback } from "../services/graph/class-feedback.js";
import { exportClassFeedback } from "../services/graph/class-feedback-reader.js";
import { FacetError } from "../services/facets/target.js";
import { ScopeError } from "../services/facets/scope.js";
import { WorkspaceError } from "../services/workspaces/types.js";
import { privateSignalResponse } from "../services/facets/private-response.js";

export function classFeedbackRoute(deps: { db: Database; auth?: { enabled: boolean } }) {
  const app = new Hono();
  app.onError((error, c) => {
    if (error instanceof FacetError || error instanceof ScopeError || error instanceof WorkspaceError) {
      return c.json({ error: error.message }, error.status);
    }
    throw error;
  });
  const path = "/api/v1/workspaces/:workspaceId/signal-facets/class-feedback";
  app.use(`${path}*`, privateSignalResponse);
  app.use(`${path}*`, async (c, next) => {
    const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
    if (c.req.method !== "GET" && session.via === "bearer") return c.json({ error: "browser_session_required" }, 403);
    if (!z.string().guid().safeParse(c.req.param("workspaceId")).success) {
      return c.json({ error: "invalid_scoped_identity" }, 400);
    }
    try { return await next(); } catch (error) {
      if (error instanceof FacetError || error instanceof ScopeError || error instanceof WorkspaceError) {
        return c.json({ error: error.message }, error.status);
      }
      throw error;
    }
  });
  app.post(path, async (c) => {
    const parsed = classFeedbackCommand.safeParse(await c.req.json().catch(() => null));
    const key = z.string().guid().safeParse(c.req.header("Idempotency-Key"));
    if (!parsed.success || !key.success) return c.json({ error: "invalid_class_feedback" }, 400);
    const session = c.get("session" as never) as { sub: string };
    const id = await writeClassFeedback(deps.db, session.sub, c.req.param("workspaceId"),
      { ...parsed.data, commandKey: key.data });
    return c.json({ ok: true, id });
  });
  app.get(`${path}/export`, async (c) => {
    const session = c.get("session" as never) as { sub: string };
    return c.json(await exportClassFeedback(deps.db, session.sub, c.req.param("workspaceId")));
  });
  return app;
}
