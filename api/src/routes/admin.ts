// Admin routes — account approval workflow.
//
//   GET  /api/v1/admin/users            -> list all account_users (admin only)
//   GET  /api/v1/admin/users/pending    -> list pending accounts (admin only)
//   POST /api/v1/admin/users/:sub/approve -> approve an account (admin only)
//   POST /api/v1/admin/users/:sub/reject  -> reject an account (admin only)
//
// All routes require an authenticated session with isAdmin === true in
// account_users. Returns 401 if no session, 403 if not admin.

import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { accountUsers } from "../db/schema.js";
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

/**
 * Resolve the session and check that the requester is an admin.
 * Returns the admin account on success, or an error Response.
 */
async function requireAdmin(
  c: Parameters<Parameters<Hono["get"]>[1]>[0],
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

  if (rows.length === 0 || !rows[0]!.isAdmin) {
    return c.json({ error: "forbidden" }, 403) as unknown as Response;
  }

  return { sub: session.sub };
}

function isResponse(v: unknown): v is Response {
  return v instanceof Response || (typeof v === "object" && v !== null && "status" in v && "headers" in v);
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
    const rows = await deps.db
      .select()
      .from(accountUsers)
      .where(eq(accountUsers.sub, targetSub))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "not_found" }, 404);
    }

    await deps.db
      .update(accountUsers)
      .set({
        status: "approved",
        approvedAt: new Date(),
        approvedBy: adminSub,
      })
      .where(eq(accountUsers.sub, targetSub));

    return c.json({ ok: true, sub: targetSub, status: "approved" });
  });

  /** Reject an account (admin only). */
  app.post("/api/v1/admin/users/:sub/reject", async (c) => {
    const result = await requireAdmin(c, deps);
    if (isResponse(result)) return result as Response;
    const adminSub = (result as { sub: string }).sub;

    const targetSub = c.req.param("sub");
    const rows = await deps.db
      .select()
      .from(accountUsers)
      .where(eq(accountUsers.sub, targetSub))
      .limit(1);

    if (rows.length === 0) {
      return c.json({ error: "not_found" }, 404);
    }

    await deps.db
      .update(accountUsers)
      .set({
        status: "rejected",
        approvedAt: new Date(),
        approvedBy: adminSub,
      })
      .where(eq(accountUsers.sub, targetSub));

    return c.json({ ok: true, sub: targetSub, status: "rejected" });
  });

  return app;
}
