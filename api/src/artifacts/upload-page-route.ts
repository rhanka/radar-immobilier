import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCookie } from "hono/cookie";
import {
  checkAdmission,
  createArtifactAdmissionAuthority,
  isApprovedAccountStatus,
  readAccountStatus,
  type AccountStatusQueryable,
  type ActivationConfig,
  type MembershipQueryable,
  artifactRefusalResponse,
} from "@radar/artifacts-host";
import { renderUploadPage } from "@sentropic/artifacts/server/upload-page";
import type { UploadPageService } from "@sentropic/artifacts/server/upload-page";
import type { AuthConfig } from "../config.js";
import {
  SESSION_COOKIE_NAME,
  verifySession,
  type VerifiedSession,
} from "../services/auth/session.js";
import { controlCacheHeaders } from "./control-cache.js";

/**
 * Browser upload page routes (files parity LOT 2), mounted on the control
 * origin next to `/api/v1/artifacts/control`.
 *
 * The page lets a human stage large files straight from disk to object
 * storage: bytes travel browser → S3 through presigned PUTs and never cross
 * a model payload. The model mints the page (`artifacts_create_upload_page`
 * returns `uploadPageUrl`), the human opens it, exchanges the single-use
 * token for a `__Host-` page cookie, stages files, then returns to the chat
 * to publish (`artifacts_publish_bundle` / `_v2` over the staged assets).
 * The page row binds the cookie to one artifact: every file call carries
 * the artifactId and the service refuses a cookie bound to another artifact.
 *
 * Auth/session rules mirror the control route (`control-route.ts` guard):
 * application session cookie only (MCP Bearer [REDACTED] refused), exact-Origin
 * check on writes, same-origin fetch metadata on reads, closed-by-default
 * admission reread (entry plus before every write), approved-account
 * fallback without activation. The page API additionally requires the
 * `x-artifact-upload: 1` custom header (simple-request CSRF defence,
 * enforced again by the page service against the control origin).
 */

const PAGE_BODY_MAX_BYTES = 64 * 1024;

export interface UploadPageRouteCfg {
  readonly controlOrigin: string;
  readonly s3Origins: readonly string[];
}

export interface UploadPageRouteDeps {
  readonly auth: AuthConfig;
  readonly accounts: AccountStatusQueryable;
  readonly readActivation?: (() => ActivationConfig) | undefined;
  readonly storageScope?: string | undefined;
  readonly service?: UploadPageService | undefined;
  readonly config?: UploadPageRouteCfg | undefined;
}

function jsonError(c: Context, status: ContentfulStatusCode, body: Record<string, string>): Response {
  const { error = "invalid_request", ...details } = body;
  return c.json(artifactRefusalResponse(status, error, status === 503, details).body as object, status);
}

/** Entry guard: session cookie, origin/fetch metadata, admission, approval. */
async function guardPage(
  c: Context,
  deps: UploadPageRouteDeps,
  allowNavigation = false,
): Promise<{ session: VerifiedSession } | Response> {
  if (c.req.header("authorization") !== undefined) {
    return jsonError(c, 401, { error: "cookie_required" });
  }
  const token = getCookie(c, SESSION_COOKIE_NAME);
  const session = token
    ? await verifySession(token, { sessionSecret: deps.auth.sessionSecret })
    : null;
  if (!session) {
    return jsonError(c, 401, { error: "unauthenticated" });
  }
  const origin = c.req.header("origin");
  const read = c.req.method === "GET" || c.req.method === "HEAD";
  const fetchSite = c.req.header("sec-fetch-site");
  const navigation = allowNavigation && c.req.method === "GET" && c.req.header("sec-fetch-mode") === "navigate" &&
    c.req.header("sec-fetch-dest") === "document";
  if ((read ? origin !== undefined && origin !== deps.auth.appBaseUrl : origin !== deps.auth.appBaseUrl) ||
    (read && fetchSite !== undefined && fetchSite !== "same-origin" && !navigation)) {
    return jsonError(c, 403, { error: "forbidden_origin" });
  }
  if (!deps.service || !deps.config) return jsonError(c, 503, { error: "capability_unavailable" });
  if (deps.readActivation) {
    let admission;
    try {
      admission = await checkAdmission(
        createArtifactAdmissionAuthority(
          deps.accounts as AccountStatusQueryable & MembershipQueryable,
          deps.readActivation, deps.storageScope), session.sub, deps.storageScope,
      );
    } catch {
      return jsonError(c, 503, { error: "capability_unavailable" });
    }
    if (!admission.allowed) {
      return jsonError(c, admission.status, admission.body);
    }
    return { session };
  }
  const status = await readAccountStatus(deps.accounts, session.sub);
  if (!isApprovedAccountStatus(status)) {
    return jsonError(c, 403, { error: "account_not_approved", status: status ?? "unknown" });
  }
  return { session };
}

/** Reread admission immediately before a page write (mirrors control dispatch). */
async function guardPageCommit(
  c: Context,
  deps: UploadPageRouteDeps,
  sub: string,
): Promise<Response | null> {
  if (deps.readActivation) {
    let commit;
    try {
      commit = await checkAdmission(
        createArtifactAdmissionAuthority(
          deps.accounts as AccountStatusQueryable & MembershipQueryable,
          deps.readActivation, deps.storageScope), sub, deps.storageScope,
      );
    } catch {
      return jsonError(c, 503, { error: "capability_unavailable" });
    }
    if (!commit.allowed) {
      return jsonError(c, commit.status, commit.body);
    }
  }
  return null;
}

function pageError(c: Context, cause: unknown): Response {
  const message = cause instanceof Error ? cause.message : String(cause);
  if (/unknown upload page/.test(message)) return jsonError(c, 404, { error: "not_found" });
  if (/upload page expired/.test(message)) return jsonError(c, 410, { error: "page_expired" });
  if (/not open|idempotency conflict/.test(message)) return jsonError(c, 409, { error: "page_conflict" });
  if (/forbidden|token mismatch/.test(message)) return jsonError(c, 403, { error: "forbidden_page" });
  if (/quota exceeded/.test(message)) return jsonError(c, 429, { error: "page_quota_exceeded", retryable: "true" });
  if (/^invalid|^unsupported/.test(message)) return jsonError(c, 400, { error: "invalid_request" });
  return jsonError(c, 400, { error: "invalid_request" });
}

async function readJsonBody(c: Context): Promise<{ body: Record<string, unknown> } | Response> {
  if (c.req.header("content-type")?.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return jsonError(c, 415, { error: "unsupported_media_type" });
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > PAGE_BODY_MAX_BYTES) {
    return jsonError(c, 413, { error: "body_too_large" });
  }
  try {
    const parsed: unknown = bytes.byteLength > 0 ? JSON.parse(Buffer.from(bytes).toString("utf8")) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonError(c, 400, { error: "invalid_json" });
    }
    return { body: parsed as Record<string, unknown> };
  } catch {
    return jsonError(c, 400, { error: "invalid_json" });
  }
}

function pageCall(c: Context, artifactId: unknown) {
  return {
    cookie: c.req.header("cookie") ?? "",
    origin: c.req.header("origin") ?? "",
    customHeader: c.req.header("x-artifact-upload") === "1",
    artifactId: String(artifactId ?? ""),
  };
}

export function uploadPageRoute(deps: UploadPageRouteDeps): Hono {
  const app = new Hono();
  app.use("*", controlCacheHeaders);

  // Page document: navigation from the chat link (token rides the URL
  // fragment, never the wire). Empty S3 origins (plain-http storage) keep
  // this document closed with 503; the mint/exchange/file endpoints below
  // keep working without it.
  app.get("/upload/:pageSessionId", async (c) => {
    const guarded = await guardPage(c, deps, true);
    if (guarded instanceof Response) return guarded;
    try {
      const html = renderUploadPage({ s3Origins: [...deps.config!.s3Origins] });
      c.header("Content-Type", "text/html; charset=utf-8");
      c.header("Referrer-Policy", "same-origin");
      return c.html(html);
    } catch {
      return jsonError(c, 503, { error: "capability_unavailable" });
    }
  });

  // Single token exchange: the minted token becomes a `__Host-` page cookie
  // bound to the artifact; the token never works twice.
  app.post("/upload/:pageSessionId/exchange", async (c) => {
    const guarded = await guardPage(c, deps);
    if (guarded instanceof Response) return guarded;
    const commit = await guardPageCommit(c, deps, guarded.session.sub);
    if (commit) return commit;
    const parsed = await readJsonBody(c);
    if (parsed instanceof Response) return parsed;
    if (typeof parsed.body.token !== "string" || parsed.body.token === "") {
      return jsonError(c, 400, { error: "invalid_request" });
    }
    try {
      const result = await deps.service!.exchange({ pageSessionId: c.req.param("pageSessionId"),
        token: parsed.body.token, origin: deps.config!.controlOrigin });
      c.header("Set-Cookie", result.cookie);
      return c.json({ ok: true, maxAgeSeconds: result.maxAgeSeconds });
    } catch (cause) {
      return pageError(c, cause);
    }
  });

  // Open one staged-file session (the browser PUTs bytes straight to S3).
  app.post("/upload/:pageSessionId/files", async (c) => {
    const guarded = await guardPage(c, deps);
    if (guarded instanceof Response) return guarded;
    const commit = await guardPageCommit(c, deps, guarded.session.sub);
    if (commit) return commit;
    const parsed = await readJsonBody(c);
    if (parsed instanceof Response) return parsed;
    const { path, mimeType, size, artifactId } = parsed.body;
    if (typeof path !== "string" || typeof mimeType !== "string" || typeof size !== "number") {
      return jsonError(c, 400, { error: "invalid_request" });
    }
    try {
      const created = await deps.service!.createFile({ ...pageCall(c, artifactId), path, mimeType, size });
      return c.json(created, 201);
    } catch (cause) {
      return pageError(c, cause);
    }
  });

  // Pin one uploaded file to its manifest path after the browser PUT.
  app.post("/upload/:pageSessionId/files/:uploadId/commit", async (c) => {
    const guarded = await guardPage(c, deps);
    if (guarded instanceof Response) return guarded;
    const commit = await guardPageCommit(c, deps, guarded.session.sub);
    if (commit) return commit;
    const parsed = await readJsonBody(c);
    if (parsed instanceof Response) return parsed;
    const { path, mimeType, digest, size, idempotencyKey, artifactId } = parsed.body;
    if (typeof path !== "string" || typeof mimeType !== "string" || typeof digest !== "string" ||
      typeof size !== "number" || typeof idempotencyKey !== "string") {
      return jsonError(c, 400, { error: "invalid_request" });
    }
    try {
      const record = await deps.service!.commitFile({ ...pageCall(c, artifactId),
        uploadId: c.req.param("uploadId"), path, mimeType, digest, size, idempotencyKey });
      return c.json(record, 201);
    } catch (cause) {
      return pageError(c, cause);
    }
  });

  // Staged files of this page (chat fallback "copy asset list").
  app.get("/upload/:pageSessionId/files", async (c) => {
    const guarded = await guardPage(c, deps);
    if (guarded instanceof Response) return guarded;
    const artifactId = c.req.query("artifactId");
    if (!artifactId) return jsonError(c, 400, { error: "invalid_request" });
    try {
      const staged = await deps.service!.listStaged({ ...pageCall(c, artifactId) });
      return c.json({ files: staged });
    } catch (cause) {
      return pageError(c, cause);
    }
  });

  return app;
}
