import { writeRefusal } from "./write-intent-refusal.js";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { guardWriteIntentAppSession, requireApprovedAppAccount } from "./write-intent-app-guard.js";
import { canReadWriteIntentSummary, challengeBootstrap, guardWriteIntentAppMutation, ownedWriteIntent,
  verifyAppChallenge, writeCsrf, type WriteAppDeps } from "./write-intent-app-authority.js";
import { hasDuplicateJsonKeys } from "./write-intent-binding.js";
import { writeIntentError } from "./write-intent-errors.js";
import { FacetError } from "../services/facets/target.js";
import { readAppWriteIntentResult } from "./write-intent-app-result.js";
export type { WriteAppDeps } from "./write-intent-app-authority.js";

/** Exact route mounts only: a disabled PW capability never intercepts the app. */
export function writeIntentAppRoute(deps: WriteAppDeps | null): Hono {
  const app = new Hono();
  const summary = "/artifact-write/intents/:intentId";
  const api = "/api/v1/artifacts/write-intents/:intentId";
  for (const path of [summary, api, `${api}/confirm`, `${api}/revoke`]) {
    app.use(path, async (c, next) => {
      c.header("Cache-Control", "private, no-store");
      c.header("Vary", "Cookie, Authorization");
      c.header("Cross-Origin-Opener-Policy", "same-origin");
      c.header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
      c.header("X-Frame-Options", "DENY");
      await next();
    });
    app.use(path, bodyLimit({ maxSize: 16 * 1024,
      onError: (c) => writeRefusal(c, "request_too_large", 413) }));
  }
  for (const path of [summary, api]) app.get(path, async (c) => {
    if (!deps) return writeRefusal(c, "write_transport_closed", 503);
    try {
      const failure: { code?: string } = {};
      const pass = await guardWriteIntentAppSession(c, deps, failure);
      if (pass instanceof Response) {
        if (path === summary && deps.renderLogin && failure.code !== undefined
          && ["unauthenticated", "session_expired"].includes(failure.code)) {
          return deps.renderLogin(c);
        }
        return pass;
      }
      const site = c.req.header("sec-fetch-site");
      if (path === api ? ((c.req.header("origin") !== undefined && c.req.header("origin") !== deps.domain.appOrigin)
        || (site !== undefined && site !== "same-origin"))
        : (site !== undefined && site !== "same-origin"
          && (c.req.header("sec-fetch-mode") !== "navigate" || c.req.header("sec-fetch-dest") !== "document"))) {
        return writeRefusal(c, "csrf_refused", 403);
      }
      const observed = await ownedWriteIntent(c, deps, pass, path === api);
      const approved = await requireApprovedAppAccount(c, deps, pass.session.sub);
      if (approved?.status === 503) return approved;
      const { row, data: result } = await readAppWriteIntentResult(deps, observed, pass);
      if (approved || path === api || result.state !== "pending" || !await canReadWriteIntentSummary(deps, row, pass)) {
        if (path === summary && deps.renderManagement) {
          return deps.renderManagement(c, row, { csrf: writeCsrf(deps, pass, row.intentId), result });
        }
        return c.json({ intentId: row.intentId, management: true,
          csrf: writeCsrf(deps, pass, row.intentId), ...result });
      }
      if (!deps.renderSummary) return writeRefusal(c, "write_transport_closed", 503);
      return deps.renderSummary(c, row, challengeBootstrap(row, deps, pass));
    } catch (error) { return writeIntentError(c, error); }
  });
  for (const action of ["confirm", "revoke"] as const) app.post(`${api}/${action}`, async (c) => {
    if (!deps) return writeRefusal(c, "write_transport_closed", 503);
    try {
      const pass = await guardWriteIntentAppSession(c, deps);
      if (pass instanceof Response) return pass;
      const refused = guardWriteIntentAppMutation(c, deps, pass);
      if (refused) return refused;
      const raw = await c.req.text();
      if (Buffer.byteLength(raw) > 16 * 1024) return writeRefusal(c, "request_too_large", 413);
      let body: unknown;
      try { body = JSON.parse(raw); } catch { throw new FacetError(400, "invalid_facet_command"); }
      if (hasDuplicateJsonKeys(raw) || body === null || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).sort().join(",") !== (action === "confirm" ? "challengeToken" : "")) {
        throw new FacetError(400, "invalid_facet_command");
      }
      const row = await ownedWriteIntent(c, deps, pass, action === "revoke");
      if (action === "revoke") return deps.revoke
        ? c.json(await deps.revoke(row, pass.principal)) : writeRefusal(c, "write_transport_closed", 503);
      const approved = await requireApprovedAppAccount(c, deps, pass.session.sub);
      if (approved) return approved;
      const proof = verifyAppChallenge((body as { challengeToken: unknown }).challengeToken, row, deps, pass);
      return deps.confirm ? c.json(await deps.confirm(row, proof))
        : writeRefusal(c, "write_transport_closed", 503);
    } catch (error) { return writeIntentError(c, error); }
  });
  for (const path of [summary, api, `${api}/confirm`, `${api}/revoke`]) {
    app.all(path, (c) => writeRefusal(c, "method_not_allowed", 405));
  }
  return app;
}
