// Admin routes — account approval workflow.
//
//   GET  /api/v1/admin/users            -> list all account_users (admin only)
//   GET  /api/v1/admin/users/pending    -> list pending accounts (admin only)
//   POST /api/v1/admin/users/:sub/approve -> approve an account (admin only)
//   POST /api/v1/admin/users/:sub/reject  -> reject an account (admin only)
//   POST /api/v1/admin/users/:sub/status  -> set approved/rejected/suspended
//
// All routes require an authenticated session with isAdmin === true in
// account_users. Returns 401 if no session, 403 if not admin.

import { Hono, type Context } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { accountUserStatusEvents, accountUsers } from "../db/schema.js";
import {
  SESSION_COOKIE_NAME,
  verifySession,
} from "../services/auth/session.js";

export interface AdminDeps {
  db: Database;
  /** Session secret to verify the session cookie. */
  sessionSecret: string;
  /** Clock injection for deterministic exp checks. */
  now?: () => number;
}

const AdminStatusTarget = z.enum(["approved", "rejected", "suspended"]);
type AdminStatusTargetT = z.infer<typeof AdminStatusTarget>;

const StatusBody = z.object({
  status: AdminStatusTarget,
  reason: z.string().trim().min(1).max(500).optional(),
});

/**
 * Resolve the session and check that the requester is an admin.
 * Returns the admin account on success, or an error Response.
 */
async function requireAdmin(
  c: Context,
  deps: AdminDeps,
): Promise<{ sub: string } | Response> {
  const nowFn = deps.now ?? (() => Date.now());
  const token = getCookie(c, SESSION_COOKIE_NAME);
  if (!token) {
    return c.json({ error: "unauthenticated" }, 401) as unknown as Response;
  }
  const session = await verifySession(token, {
    sessionSecret: deps.sessionSecret,
    now: nowFn(),
  });
  if (!session) {
    return c.json({ error: "unauthenticated" }, 401) as unknown as Response;
  }

  const rows = await deps.db
    .select()
    .from(accountUsers)
    .where(eq(accountUsers.sub, session.sub))
    .limit(1);

  if (
    rows.length === 0 ||
    !rows[0]!.isAdmin ||
    rows[0]!.status !== "approved"
  ) {
    return c.json({ error: "forbidden" }, 403) as unknown as Response;
  }

  return { sub: session.sub };
}

function isResponse(v: unknown): v is Response {
  return v instanceof Response || (typeof v === "object" && v !== null && "status" in v && "headers" in v);
}

async function updateAccountStatus(
  deps: AdminDeps,
  params: {
    targetSub: string;
    actorSub: string;
    status: AdminStatusTargetT;
    reason?: string;
  },
): Promise<
  | {
      sub: string;
      fromStatus: string;
      status: AdminStatusTargetT;
      actorSub: string;
      at: Date;
      reason: string;
    }
  | null
> {
  const rows = await deps.db
    .select()
    .from(accountUsers)
    .where(eq(accountUsers.sub, params.targetSub))
    .limit(1);

  if (rows.length === 0) return null;

  const at = new Date((deps.now ?? (() => Date.now()))());
  const reason = params.reason ?? defaultStatusReason(params.status);
  const update =
    params.status === "approved"
      ? {
          status: params.status,
          approvedAt: at,
          approvedBy: params.actorSub,
        }
      : {
          status: params.status,
        };

  await deps.db
    .update(accountUsers)
    .set(update)
    .where(eq(accountUsers.sub, params.targetSub));

  await deps.db.insert(accountUserStatusEvents).values({
    userSub: params.targetSub,
    fromStatus: rows[0]!.status,
    toStatus: params.status,
    actorSub: params.actorSub,
    reason,
    createdAt: at,
  });

  return {
    sub: params.targetSub,
    fromStatus: rows[0]!.status,
    status: params.status,
    actorSub: params.actorSub,
    at,
    reason,
  };
}

function defaultStatusReason(status: AdminStatusTargetT): string {
  switch (status) {
    case "approved":
      return "Approved by admin";
    case "rejected":
      return "Rejected by admin";
    case "suspended":
      return "Suspended by admin";
  }
}

function statusResponse(c: Context, change: NonNullable<Awaited<ReturnType<typeof updateAccountStatus>>>) {
  return c.json({
    ok: true,
    sub: change.sub,
    fromStatus: change.fromStatus,
    status: change.status,
    audit: {
      actorSub: change.actorSub,
      at: change.at.toISOString(),
      reason: change.reason,
    },
  });
}

export function adminRoute(deps: AdminDeps): Hono {
  const app = new Hono();

  /** List all accounts (admin only). */
  app.get("/api/v1/admin/users", async (c) => {
    const result = await requireAdmin(c, deps);
    if (isResponse(result)) return result as Response;

    const users = await deps.db.select().from(accountUsers);
    return c.json({ ok: true, users });
  });

  /** List pending accounts (admin only). */
  app.get("/api/v1/admin/users/pending", async (c) => {
    const result = await requireAdmin(c, deps);
    if (isResponse(result)) return result as Response;

    const users = await deps.db
      .select()
      .from(accountUsers)
      .where(eq(accountUsers.status, "pending"));
    return c.json({ ok: true, users });
  });

  /** Approve an account (admin only). */
  app.post("/api/v1/admin/users/:sub/approve", async (c) => {
    const result = await requireAdmin(c, deps);
    if (isResponse(result)) return result as Response;
    const adminSub = (result as { sub: string }).sub;

    const targetSub = c.req.param("sub");
    const change = await updateAccountStatus(deps, {
      targetSub,
      actorSub: adminSub,
      status: "approved",
    });
    if (!change) {
      return c.json({ error: "not_found" }, 404);
    }
    return statusResponse(c, change);
  });

  /** Reject an account (admin only). */
  app.post("/api/v1/admin/users/:sub/reject", async (c) => {
    const result = await requireAdmin(c, deps);
    if (isResponse(result)) return result as Response;
    const adminSub = (result as { sub: string }).sub;

    const targetSub = c.req.param("sub");
    const change = await updateAccountStatus(deps, {
      targetSub,
      actorSub: adminSub,
      status: "rejected",
    });
    if (!change) {
      return c.json({ error: "not_found" }, 404);
    }
    return statusResponse(c, change);
  });

  /** Set account status with an explicit audit reason (admin only). */
  app.post("/api/v1/admin/users/:sub/status", async (c) => {
    const result = await requireAdmin(c, deps);
    if (isResponse(result)) return result as Response;
    const adminSub = (result as { sub: string }).sub;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const parsed = StatusBody.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: "validation_failed", detail: parsed.error.format() },
        400,
      );
    }

    const targetSub = c.req.param("sub");
    const change = await updateAccountStatus(deps, {
      targetSub,
      actorSub: adminSub,
      status: parsed.data.status,
      ...(parsed.data.reason ? { reason: parsed.data.reason } : {}),
    });
    if (!change) {
      return c.json({ error: "not_found" }, 404);
    }
    return statusResponse(c, change);
  });

  return app;
}
