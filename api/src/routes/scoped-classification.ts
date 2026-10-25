import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { ClassificationError, classificationFailure } from "../services/facets/classification-errors.js";
import { decodeQuery, SignalQuery, WorkspaceId } from "../services/facets/classification-query.js";
import { readFacetContext } from "../services/facets/classification-context.js";
import { FacetContextResponse } from "../services/facets/classification-context-contract.js";
import { boundedClassificationJson, searchSignalClassifications, type ClassificationOptions } from "../services/facets/classification-search.js";
import type { ObjectStore } from "../storage/object-store.js";

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
export interface ClassificationDeps { db: Database; store: ObjectStore; auth?: { enabled: boolean }; classification?: ClassificationOptions }
export function scopedClassificationRoute(deps: ClassificationDeps) {
  const app = new Hono();
  app.onError((error, c) => {
    const failure = classificationFailure(error);
    return c.json(failure.body, failure.status);
  });
  app.use("*", classificationBoundary);
  app.use("*", async (c, next) => {
    if (!isReadPath(c.req.path)) return next();
    const session = c.get("session" as never) as { sub?: string } | undefined;
    if (!deps.auth?.enabled || !session?.sub) throw new ClassificationError("unauthenticated");
    if (!WorkspaceId.safeParse(c.req.param("workspaceId")).success) throw new ClassificationError("invalid_query");
    const url = new URL(c.req.url);
    if (Buffer.byteLength(`${url.pathname}${url.search}`) > 16384) throw new ClassificationError("request_uri_too_long");
    await next();
  });
  app.get(`${prefix}/facet-context`, async (c) => {
    decodeQuery(new URL(c.req.url).searchParams, z.object({}).strict());
    const session = c.get("session" as never) as { sub: string };
    const context = await readFacetContext(deps.db, session.sub, WorkspaceId.parse(c.req.param("workspaceId")));
    return c.newResponse(boundedClassificationJson(FacetContextResponse.parse({ ok: true, context })), 200,
      { "Content-Type": "application/json" });
  });
  app.get(`${prefix}/signal-facets/search`, async (c) => {
    const query = decodeQuery(new URL(c.req.url).searchParams, SignalQuery);
    const session = c.get("session" as never) as { sub: string };
    const result = await searchSignalClassifications(deps, session.sub, WorkspaceId.parse(c.req.param("workspaceId")), query);
    return c.newResponse(boundedClassificationJson(result, query.limit), 200, { "Content-Type": "application/json" });
  });
  return app;
}
