import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { ClassificationError, classificationFailure } from "../services/facets/classification-errors.js";
import { decodeQuery, WorkspaceId } from "../services/facets/classification-query.js";
import { readFacetContext } from "../services/facets/classification-context.js";
import { FacetContextResponse } from "../services/facets/classification-context-contract.js";

const prefix = "/api/v1/workspaces/:workspaceId";
const isReadPath = (path: string) => /^\/api\/v1\/workspaces\/[^/]+\/(?:facet-context|signal-facets\/(?:search|state))$/.test(path);
export const classificationBoundary: MiddlewareHandler = async (c, next) => {
  if (!isReadPath(c.req.path)) return next();
  c.header("Cache-Control", "private, no-store");
  c.header("Vary", "Cookie, Authorization");
  try {
    await next();
    if (c.res.status < 400) return;
    const body = await c.res.clone().json().catch(() => null);
    if (body?.ok === false && typeof body.requestId === "string") return;
    const code = c.res.status === 401 ? "unauthenticated" : c.res.status === 403
      ? body?.error === "account_not_approved" ? "account_not_approved" : "workspace_not_authorized" : "internal_error";
    const failure = classificationFailure(new ClassificationError(code));
    c.res = c.json(failure.body, failure.status);
  } catch (error) {
    const failure = classificationFailure(error);
    c.res = c.json(failure.body, failure.status);
  }
};
export interface ClassificationDeps { db: Database; auth?: { enabled: boolean } }
export function scopedClassificationRoute(deps: ClassificationDeps) {
  const app = new Hono();
  app.use("*", classificationBoundary);
  app.use("*", async (c, next) => {
    const session = c.get("session" as never) as { sub?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) throw new ClassificationError("unauthenticated");
    if (!WorkspaceId.safeParse(c.req.param("workspaceId")).success) throw new ClassificationError("invalid_query");
    await next();
  });
  app.get(`${prefix}/facet-context`, async (c) => {
    decodeQuery(new URL(c.req.url).searchParams, z.object({}).strict());
    const session = c.get("session" as never) as { sub: string };
    const context = await readFacetContext(deps.db, session.sub, WorkspaceId.parse(c.req.param("workspaceId")));
    return c.json(FacetContextResponse.parse({ ok: true, context }));
  });
  return app;
}
