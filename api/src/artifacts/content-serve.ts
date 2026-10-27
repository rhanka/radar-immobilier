/**
 * Authorized artifact content serving (ARTEFACTS A6/H5).
 *
 * Serves the pinned technical example to holders of a valid session cookie
 * plus a matching signed grant. The ticket is exchanged before custom code
 * runs and never appears in the final URL, Referer or logs. Old tabs keep
 * their pinned release; a newer release never leaks through an old grant.
 */
import { Hono, type Context } from "hono";
import { applyReaderContentHeaders, isEmbedPath, isServiceWorkerPath } from "./content-isolation.js";
import { parseContentHost } from "./content-host.js";
import { verifyGrant, type GrantIssuer } from "./preview-grant.js";
import { readSessionClaims } from "./preview-session.js";
import { adaptGrantToReader, canInvoke, type ApiReaderContext } from "./reader-context.js";
import type { AuthorityReader } from "./reader-profile.js";
import { validateReaderResponse } from "./reader-responses.js";
import {
  isReaderOperation,
  operationMethod,
  validateOperationParams,
  type ReaderOperationName,
} from "./reader-operations.js";
import { READER_EXAMPLE_HTML } from "./reader-example.js";

export interface ContentServeDeps {
  readonly contentBase: string;
  readonly grantSecret: string;
  readonly sessionSecret: string;
  readonly issuer: GrantIssuer;
  readonly authority?: AuthorityReader;
  readonly readOperation?: (op: ReaderOperationName, params: unknown, context: ApiReaderContext) => Promise<unknown>;
  readonly now?: () => number;
  /** Optional revocation predicate; revoked sessions fail closed. */
  readonly isRevoked?: (sessionId: string) => boolean;
}
type AuthorizedReader = ApiReaderContext & { readonly validUntil: number; readonly authorityVersion: string };

function bareHost(header: string | undefined): string {
  const raw = (header ?? "").trim().toLowerCase();
  if (raw === "" || raw.includes("]")) return raw;
  const colon = raw.lastIndexOf(":");
  if (colon !== -1) {
    const port = raw.slice(colon + 1);
    if (port !== "" && /^[0-9]+$/.test(port)) return raw.slice(0, colon);
  }
  return raw;
}

export function createReaderContentApp(deps: ContentServeDeps): Hono {
  const app = new Hono();
  const now = deps.now ?? (() => Date.now());

  function stillOpen(reader: AuthorizedReader): boolean {
    return reader.validUntil > now() && !deps.isRevoked?.(reader.sessionId);
  }

  async function authorityCurrent(reader: AuthorizedReader): Promise<boolean> {
    if (!deps.authority) return false;
    try {
      return await deps.authority.getAuthorizationVersion(reader.artifactId) === reader.authorityVersion && stillOpen(reader);
    } catch { return false; }
  }

  async function authorized(c: Context): Promise<AuthorizedReader | null> {
    const grant = c.req.query("grant") ?? c.req.header("x-preview-grant") ?? "";
    if (!grant) return null;
    const host = bareHost(c.req.header("host"));
    const claims = await verifyGrant(grant, { ...deps.issuer, host }, deps.grantSecret, now());
    if (!claims) return null;
    const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now());
    if (!session || session.sid !== claims.sessionId || session.readerSub !== claims.readerSub || session.artifactId !== claims.artifactId) return null;
    const content = parseContentHost(c.req.header("host"), deps.contentBase);
    if (content.kind === "stable" && content.artifactId !== claims.artifactId) return null;
    if (content.kind === "pinned" && content.releaseId !== claims.releaseId) return null;
    if (deps.isRevoked?.(session.sid)) return null;
    if (!deps.authority) return null;
    try {
      const version = await deps.authority.getAuthorizationVersion(claims.artifactId);
      if (!version) return null;
      const context = await adaptGrantToReader(claims, deps.authority);
      if (!context) return null;
      if (await deps.authority.getAuthorizationVersion(claims.artifactId) !== version) return null;
      const reader = { ...context, validUntil: Math.min(claims.expiresAtMs, session.expiresAt), authorityVersion: version };
      return stillOpen(reader) ? reader : null;
    } catch { return null; }
  }

  app.get("/livez", (c) => c.json({ status: "ok" }));
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("*", async (c, next) => {
    applyReaderContentHeaders(c);
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.json({ error: "unauthenticated" }, 401);
    if (c.req.header("authorization") || c.req.header("x-reader-sub")) return c.json({ error: "invalid_authority" }, 400);
    if (c.req.header("service-worker") || isServiceWorkerPath(c.req.path) || isEmbedPath(c.req.path)) {
      return c.json({ error: "not_found" }, 404);
    }
    return next();
  });

  app.all("/__reader/api/:op", async (c) => {
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    if (parsed.kind === "other") return c.json({ error: "not_found" }, 404);
    const op = c.req.param("op");
    if (!isReaderOperation(op)) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unknown_operation" }, 404);
    }
    if (c.req.method !== operationMethod(op)) {
      applyReaderContentHeaders(c);
      return c.json({ error: "method_not_allowed" }, 405);
    }
    const auth = await authorized(c);
    if (!auth) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    if (op === "status.closed.v1") {
      applyReaderContentHeaders(c);
      return c.json({ error: "capability_unavailable" }, 503);
    }
    const capability = op === "geo.read.v1" ? "geo.read" : "signals.protected-read";
    if (!canInvoke(auth, capability, auth.releaseId)) return c.json({ error: "forbidden" }, 403);
    if (!deps.readOperation) return c.json({ error: "capability_unavailable" }, 503);
    if (op === "geo.read.v1") {
      const params = validateOperationParams(op, {
        ...Object.fromEntries(Object.entries(c.req.query()).filter(([key]) => key !== "grant")),
        collectionId: c.req.query("collectionId") ?? "qc-zonage-valleyfield",
        limit: Number(c.req.query("limit") ?? "10"),
      });
      if (!params.ok) {
        applyReaderContentHeaders(c);
        return c.json({ error: "invalid_params" }, 400);
      }
      applyReaderContentHeaders(c);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      try {
        const body = validateReaderResponse(op, await deps.readOperation(op, params.params, auth), auth.readerSub);
        if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
        if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        return c.json(body);
      }
      catch { return c.json({ error: "capability_unavailable" }, 503); }
    }
    const checked = validateOperationParams(op as ReaderOperationName, { ...Object.fromEntries(Object.entries(c.req.query()).filter(([key]) => key !== "grant")), city: c.req.query("city") ?? "valleyfield" });
    if (!checked.ok) {
      applyReaderContentHeaders(c);
      return c.json({ error: "invalid_params" }, 400);
    }
    applyReaderContentHeaders(c);
    if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
    try {
      const body = validateReaderResponse(op, await deps.readOperation(op, checked.params, auth), auth.readerSub);
      if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      return c.json(body);
    }
    catch { return c.json({ error: "capability_unavailable" }, 503); }
  });

  app.get("*", async (c) => {
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    if (parsed.kind === "other") return c.json({ error: "not_found" }, 404);
    if (isServiceWorkerPath(c.req.path) || isEmbedPath(c.req.path)) {
      applyReaderContentHeaders(c);
      return c.json({ error: "not_found" }, 404);
    }
    const auth = await authorized(c);
    if (!auth) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    applyReaderContentHeaders(c);
    c.header("Content-Type", "text/html; charset=utf-8");
    return c.html(READER_EXAMPLE_HTML);
  });

  return app;
}
