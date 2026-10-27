/**
 * Authorized artifact content serving (ARTEFACTS A6/H5, L3).
 *
 * Serves the pinned release files (real HTML/CSS/JS set) to holders of a
 * valid session cookie plus a matching signed grant. The ticket is exchanged
 * before custom code runs and never appears in the final URL, Referer or
 * logs. Old tabs keep their pinned release; a newer release never leaks
 * through an old grant.
 *
 * Native files use the session scoped to a pinned release host, including
 * module/CSS imports and dynamic scripts. Published JavaScript calls H5 with
 * fetch and the x-preview-grant header:
 *   const grant = new URLSearchParams(location.search).get("grant");
 *   fetch("/__reader/api/baskets.search.v1?workspaceId=...&citySlug=...", {
 *     headers: { "x-preview-grant": grant },
 *   });
 * Grant renewal is available at POST /__reader/renew (presented grant in
 * header, session cookie required) before the 55 s expiry.
 */
import { Hono, type Context } from "hono";
import {
  applyReaderContentHeaders,
  isEmbedPath,
  isServiceWorkerPath,
  servedBodyLeaksCredentials,
} from "./content-isolation.js";
import { parseContentHost } from "./content-host.js";
import { mintGrant, verifyGrant, type GrantIssuer } from "./preview-grant.js";
import { renewGrant } from "./preview-renewal.js";
import { readSessionClaims } from "./preview-session.js";
import { adaptGrantToReader, canInvoke, type ApiReaderContext } from "./reader-context.js";
import type { AuthorityReader } from "./reader-profile.js";
import { validateReaderResponse } from "./reader-responses.js";
import {
  isBasketOperation,
  basketsContextParams,
  basketsSearchParams,
  basketsStateParams,
  isReaderOperation,
  operationMethod,
  validateOperationParams,
  type ReaderOperationName,
} from "./reader-operations.js";
import { READER_EXAMPLE_HTML } from "./reader-example.js";
import {
  normalizeReleaseHtml,
  normalizeReleasePath,
  releaseCspForHtml,
  type ReleaseFileProvider,
} from "./release-files.js";
import { ClassificationError, classificationFailure } from "../services/facets/classification-errors.js";
import { decodeQuery } from "../services/facets/classification-query.js";

export interface ContentServeDeps {
  readonly contentBase: string;
  readonly grantSecret: string;
  readonly sessionSecret: string;
  readonly issuer: GrantIssuer;
  readonly authority?: AuthorityReader;
  readonly readOperation?: (op: ReaderOperationName, params: unknown, context: ApiReaderContext) => Promise<unknown>;
  readonly releaseFiles?: ReleaseFileProvider | undefined;
  readonly openingContent?: Hono;
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

function presentedGrant(c: Context): string {
  return c.req.query("grant") ?? c.req.header("x-preview-grant") ?? "";
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
      return await deps.authority.getAuthorizationVersion(reader.artifactId, reader.readerSub, reader.releaseId) === reader.authorityVersion && stillOpen(reader);
    } catch { return false; }
  }

  async function authorized(c: Context, resource = false): Promise<AuthorizedReader | null> {
    const grant = presentedGrant(c);
    const host = bareHost(c.req.header("host"));
    const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now());
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    const sealed = session?.resource;
    // Cookie-only authority is restricted to native files on one pinned host.
    // An explicitly presented invalid grant never falls back to the cookie.
    const claims = grant ? await verifyGrant(grant, { ...deps.issuer, host }, deps.grantSecret, now())
      : resource && parsed.kind === "pinned" && sealed?.host === host && sealed.releaseId === parsed.releaseId &&
        sealed.issuer === deps.issuer.issuer && sealed.audience === deps.issuer.audience && sealed.tier === deps.issuer.tier
        ? { ...sealed, expiresAtMs: session!.expiresAt } : null;
    if (!claims) return null;
    if (!session || session.sid !== claims.sessionId || session.readerSub !== claims.readerSub || session.artifactId !== claims.artifactId) return null;
    const content = parseContentHost(c.req.header("host"), deps.contentBase);
    if (content.kind === "stable" && content.artifactId !== claims.artifactId) return null;
    if (content.kind === "pinned" && content.releaseId !== claims.releaseId) return null;
    if (deps.isRevoked?.(session.sid)) return null;
    if (!deps.authority) return null;
    try {
      const version = await deps.authority.getAuthorizationVersion(claims.artifactId, claims.readerSub, claims.releaseId);
      if (!version) return null;
      const context = await adaptGrantToReader(claims, deps.authority);
      if (!context) return null;
      if (await deps.authority.getAuthorizationVersion(claims.artifactId, claims.readerSub, claims.releaseId) !== version) return null;
      const reader = { ...context, validUntil: Math.min(claims.expiresAtMs, session.expiresAt), authorityVersion: version };
      return stillOpen(reader) ? reader : null;
    } catch { return null; }
  }

  app.get("/livez", (c) => c.json({ status: "ok" }));
  app.get("/health", (c) => c.json({ status: "ok" }));

  app.use("/__reader/api/*", async (c, next) => {
    if (c.req.method !== "GET" || !isBasketOperation(c.req.path.slice("/__reader/api/".length))) return next();
    try {
      await next();
      if (c.res.status < 400) return;
      const body = await c.res.clone().json().catch(() => null);
      if (body?.ok === false && typeof body.requestId === "string") return;
      const code = c.res.status === 401 ? "unauthenticated" : c.res.status === 403 ? "capability_required"
        : c.res.status === 400 ? "invalid_query" : c.res.status === 503 ? "transport_unavailable" : "internal_error";
      const failure = classificationFailure(new ClassificationError(code));
      c.res = c.json(failure.body, failure.status);
    } catch (error) {
      const failure = classificationFailure(error);
      c.res = c.json(failure.body, failure.status);
    }
  });

  app.use("*", async (c, next) => {
    applyReaderContentHeaders(c);
    if (c.req.path === "/api" || c.req.path.startsWith("/api/")) return c.json({ error: "unauthenticated" }, 401);
    if (c.req.header("authorization") || c.req.header("x-reader-sub")) return c.json({ error: "invalid_authority" }, 400);
    if (c.req.header("service-worker") || isServiceWorkerPath(c.req.path) || isEmbedPath(c.req.path)) {
      return c.json({ error: "not_found" }, 404);
    }
    return next();
  });

  app.post("/__reader/renew", async (c) => {
    const parsed = parseContentHost(c.req.header("host"), deps.contentBase);
    if (parsed.kind === "other") return c.json({ error: "not_found" }, 404);
    if (!deps.authority) {
      applyReaderContentHeaders(c);
      return c.json({ error: "capability_unavailable" }, 503);
    }
    const presented = presentedGrant(c);
    if (!presented) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    const host = bareHost(c.req.header("host"));
    const claims = await verifyGrant(presented, { ...deps.issuer, host }, deps.grantSecret, now());
    if (!claims) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now());
    if (!session || session.sid !== claims.sessionId || session.readerSub !== claims.readerSub || session.artifactId !== claims.artifactId) {
      applyReaderContentHeaders(c);
      return c.json({ error: "unauthenticated" }, 401);
    }
    applyReaderContentHeaders(c);
    const renewed = await renewGrant(
      presented,
      { authority: deps.authority, secret: deps.grantSecret, issuer: deps.issuer },
      (sid) => deps.isRevoked?.(sid) ?? false,
      now(),
    );
    if (!renewed) return c.json({ error: "unauthenticated" }, 401);
    return c.json({ grant: renewed });
  });

  if (deps.openingContent) app.route("/", deps.openingContent);

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
    if (isBasketOperation(op)) {
      applyReaderContentHeaders(c);
      if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
      try {
        const url = new URL(c.req.url);
        if (Buffer.byteLength(url.pathname + url.search) > 16384) throw new ClassificationError("request_uri_too_long");
        if (url.searchParams.getAll("grant").length > 1) throw new ClassificationError("invalid_query");
        url.searchParams.delete("grant");
        const schema = op === "baskets.context.v1" ? basketsContextParams : op === "baskets.search.v1"
          ? basketsSearchParams : basketsStateParams;
        const params = decodeQuery(url.searchParams, schema);
        const body = validateReaderResponse(op, await deps.readOperation(op, params, auth), auth.readerSub);
        if (!stillOpen(auth)) return c.json({ error: "unauthenticated" }, 401);
        if (!await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        return c.json(body);
      } catch (error) {
        const failure = classificationFailure(error);
        return c.json(failure.body, failure.status);
      }
    }
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
    const auth = await authorized(c, true);
    if (!auth) {
      applyReaderContentHeaders(c);
      if (deps.openingContent && !presentedGrant(c) && (c.req.path === "/" || c.req.path === "/index.html")) {
        return c.redirect("/__reader/start", 303);
      }
      return c.json({ error: "unauthenticated" }, 401);
    }
    const normalized = normalizeReleasePath(c.req.path);
    if (normalized) {
      const file = await deps.releaseFiles?.getFile(auth.artifactId, auth.releaseId, `/${normalized}`) ?? null;
      if (file) {
        if (!stillOpen(auth) || !await authorityCurrent(auth)) return c.json({ error: "unauthenticated" }, 401);
        const text = typeof file.body === "string" ? file.body : Buffer.from(file.body).toString("utf8");
        if (servedBodyLeaksCredentials(text)) {
          applyReaderContentHeaders(c);
          return c.json({ error: "not_found" }, 404);
        }
        applyReaderContentHeaders(c);
        if (file.contentType.startsWith("text/html")) {
          if (!presentedGrant(c)) {
            const session = readSessionClaims(c.req.header("cookie"), deps.sessionSecret, now())!;
            const grant = await mintGrant(session.resource!, deps.grantSecret, now());
            return c.redirect(`${c.req.path}?grant=${encodeURIComponent(grant)}`, 303);
          }
          const html = normalizeReleaseHtml(text);
          c.header("Content-Security-Policy", releaseCspForHtml(html));
          return c.html(html);
        }
        c.header("Content-Type", file.contentType);
        return c.body(typeof file.body === "string" ? file.body : file.body as Uint8Array);
      }
    }
    if (!deps.releaseFiles && (c.req.path === "/" || c.req.path === "/index.html")) {
      applyReaderContentHeaders(c);
      c.header("Content-Type", "text/html; charset=utf-8");
      return c.html(READER_EXAMPLE_HTML);
    }
    applyReaderContentHeaders(c);
    return c.json({ error: "not_found" }, 404);
  });

  return app;
}
