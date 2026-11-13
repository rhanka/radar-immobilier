import { Hono } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { addSignalNote, readSignalMcp } from "../services/graph/signal-mcp.js";
import { privateSignalResponse } from "../services/facets/private-response.js";

const target = z.object({ scope: z.enum(["personal", "workspace"]),
  citySlug: z.string().min(1).max(128).regex(/^[a-z0-9-]+$/),
  type: z.enum(["Signal", "DesignationEvent"]), id: z.string().min(1).max(512) }).strict();
const note = z.object({ target, text: z.string().trim().min(1).max(2000),
  version: z.string().regex(/^[a-f0-9]{32}$/) }).strict();
export function signalMcpRoute(deps: { db: Database; auth?: { enabled: boolean } }) {
  const app = new Hono();
  const path = "/api/v1/workspaces/:workspaceId/signal-facets/annotations";
  app.use(`${path}*`, privateSignalResponse);
  app.use(`${path}*`, async (c, next) => {
    const session = c.get("session" as never) as { sub?: string; via?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) return c.json({ error: "unauthenticated" }, 401);
    if (session.via === "bearer") return c.json({ error: "browser_session_required" }, 403);
    if (!z.string().guid().safeParse(c.req.param("workspaceId")).success) return c.json({ error: "invalid_workspace" }, 400);
    return next();
  });
  app.get(path, async (c) => {
    const parsed = target.safeParse(c.req.query());
    if (!parsed.success) return c.json({ error: "invalid_signal_target" }, 400);
    const session = c.get("session" as never) as { sub: string };
    const state = await readSignalMcp(deps.db, session.sub, { ...parsed.data, workspaceId: c.req.param("workspaceId") });
    return state.error ? c.json({ error: state.error }, 403) : c.json(state);
  });
  app.post(path, async (c) => {
    const parsed = note.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid_note" }, 400);
    const session = c.get("session" as never) as { sub: string };
    const saved = await addSignalNote(deps.db, session.sub, { ...parsed.data.target,
      workspaceId: c.req.param("workspaceId") }, parsed.data.text, parsed.data.version);
    return saved.error ? c.json(saved, saved.error === "annotation_version_conflict" ? 409 : 403) : c.json(saved, 201);
  });
  return app;
}
