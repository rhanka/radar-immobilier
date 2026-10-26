import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { getCookie } from "hono/cookie";
import { bodyLimit } from "hono/body-limit";
import {
  checkAdmission,
  createArtifactAdmissionAuthority,
  isApprovedAccountStatus,
  readAccountStatus,
  type AccountStatusQueryable,
  type ActivationConfig,
  type ArtifactControl,
  type MembershipQueryable,
} from "@radar/artifacts-host";
import type { AuthConfig } from "../config.js";
import { controlCacheHeaders } from "./control-cache.js";
import {
  SESSION_COOKIE_NAME,
  verifySession,
  type VerifiedSession,
} from "../services/auth/session.js";

export type ControlOp = "ensure" | "publish" | "meta" | "list";

const unavailableBackend: ArtifactControl = {
  handle: () => Promise.resolve({ status: 503, body: { error: "capability_unavailable" } }),
};

export interface ControlRouteDeps {
  readonly auth: AuthConfig;
  readonly accounts: AccountStatusQueryable;
  readonly backend?: ArtifactControl | undefined;
  /**
   * H3 rehearsal activation reader (861C units 2-3). Absent preserves the H2
   * behavior (approval check only). Present enforces closed-by-default cohort
   * admission at entry and rereads it before every write dispatch. Provider
   * commits already in flight need separate enforcement.
   */
  readonly readActivation?: (() => ActivationConfig) | undefined;
}

export const CONTROL_MAX_BODY_BYTES = 2 * 1024 * 1024;

function jsonError(c: Context, status: 400 | 401 | 403 | 413 | 415 | 503, body: Record<string, string>): Response {
  return c.json(body, status);
}

async function guard(
  c: Context,
  deps: ControlRouteDeps,
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
  if ((read ? origin !== undefined && origin !== deps.auth.appBaseUrl : origin !== deps.auth.appBaseUrl) ||
    (read && fetchSite !== undefined && fetchSite !== "same-origin")) {
    return jsonError(c, 403, { error: "forbidden_origin" });
  }
  // A failed startup probe must not query the same unavailable database.
  if (!deps.backend) return jsonError(c, 503, { error: "capability_unavailable" });
  if (deps.readActivation) {
    const admission = await checkAdmission(
      createArtifactAdmissionAuthority(
        deps.accounts as AccountStatusQueryable & MembershipQueryable, deps.readActivation), session.sub,
    );
    if (!admission.allowed) {
      return c.json(admission.body, admission.status);
    }
    return { session };
  }
  const status = await readAccountStatus(deps.accounts, session.sub);
  if (!isApprovedAccountStatus(status)) {
    return c.json({ error: "account_not_approved", status: status ?? "unknown" }, 403);
  }
  return { session };
}

async function guardPost(
  c: Context,
  deps: ControlRouteDeps,
): Promise<{ session: VerifiedSession; body: unknown } | Response> {
  const guarded = await guard(c, deps);
  if (guarded instanceof Response) return guarded;
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.split(";")[0]?.trim().toLowerCase() !== "application/json") {
    return jsonError(c, 415, { error: "unsupported_media_type" });
  }
  const bytes = new Uint8Array(await c.req.arrayBuffer());
  if (bytes.byteLength > CONTROL_MAX_BODY_BYTES) {
    return jsonError(c, 413, { error: "body_too_large" });
  }
  let body: unknown = null;
  if (bytes.byteLength > 0) {
    try {
      body = JSON.parse(Buffer.from(bytes).toString("utf8"));
    } catch {
      return jsonError(c, 400, { error: "invalid_json" });
    }
  }
  return { session: guarded.session, body };
}

export function controlRoute(deps: ControlRouteDeps): Hono {
  const backend = deps.backend ?? unavailableBackend;
  const app = new Hono();
  app.use("*", controlCacheHeaders);
  app.use("*", bodyLimit({
    maxSize: CONTROL_MAX_BODY_BYTES,
    onError: (c) => c.json({ error: "body_too_large" }, 413),
  }));
  async function dispatch(op: ControlOp, c: Context, session: VerifiedSession, body: unknown) {
    if (deps.readActivation && (op === "ensure" || op === "publish")) {
      // Reread after the entry guard, immediately before storage dispatch.
      const commit = await checkAdmission(
        createArtifactAdmissionAuthority(
          deps.accounts as AccountStatusQueryable & MembershipQueryable, deps.readActivation), session.sub,
      );
      if (!commit.allowed) {
        return c.json(commit.body, commit.status);
      }
    }
    const result = await backend.handle(op, session.sub, body);
    return c.json(result.body as object, result.status as ContentfulStatusCode);
  }

  app.post("/ensure", async (c) => {
    const guarded = await guardPost(c, deps);
    if (guarded instanceof Response) return guarded;
    return dispatch("ensure", c, guarded.session, guarded.body);
  });

  app.post("/publish", async (c) => {
    const guarded = await guardPost(c, deps);
    if (guarded instanceof Response) return guarded;
    return dispatch("publish", c, guarded.session, guarded.body);
  });

  app.get("/meta", async (c) => {
    const guarded = await guard(c, deps);
    if (guarded instanceof Response) return guarded;
    return dispatch("meta", c, guarded.session, c.req.query());
  });

  app.get("/list", async (c) => {
    const guarded = await guard(c, deps);
    if (guarded instanceof Response) return guarded;
    return dispatch("list", c, guarded.session, c.req.query());
  });

  app.all("*", async (c) => {
    const guarded = await guard(c, deps);
    if (guarded instanceof Response) return guarded;
    return c.json({ error: "capability_unavailable" }, 503);
  });

  return app;
}
