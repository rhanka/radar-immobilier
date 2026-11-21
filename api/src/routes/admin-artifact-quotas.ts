// Admin artifact quota routes — admin-managed quota exceptions (AQX).
//
//   GET  /api/v1/admin/artifacts/quotas/:actorId  -> effective limits, usage,
//        page-text exception, open upload sessions, recent audit events
//   POST /api/v1/admin/artifacts/quotas/:actorId  -> one audited change set:
//        actor durable quota (raise/lower limits, reset used counters),
//        storage-scope durable limits (counters are retained), page-text
//        exception (up to the 10 MiB system maximum, optional expiry, null
//        revokes), and expiry of the actor's open upload sessions.
//
// Same authority as every /api/v1/admin route: an authenticated session whose
// account_users row is approved with is_admin. Every change and its audit row
// commit in one transaction; old and new values are recorded with the reason.

import { Hono, type Context } from "hono";
import { sql } from "drizzle-orm";
import { pageTextBudgetFromRow } from "@radar/artifacts-host";
import type { Database } from "../db/client.js";
import { isResponse, requireAdmin } from "./admin.js";

export interface AdminArtifactQuotaDeps {
  db: Database;
  sessionSecret: string;
  now?: () => number;
  /** Server storage scope (ARTIFACTS_STORAGE_SCOPE); a request may name another existing scope. */
  storageScope?: string | undefined;
}

type Executor = Pick<Database, "execute">;

const SCOPE_RE = /^[A-Za-z0-9_-]{1,128}$/;
const ACTOR_RE = /^[A-Za-z0-9._:@|-]{1,256}$/;

interface QuotaRow { operation_limit: string; byte_limit: string; operations_used: string; bytes_used: string }

const quota = (row: QuotaRow | undefined) => row ? {
  operationLimit: Number(row.operation_limit), byteLimit: Number(row.byte_limit),
  operationsUsed: Number(row.operations_used), bytesUsed: Number(row.bytes_used),
} : null;

async function rows<T>(db: Executor, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

/** Read-only view used by GET and returned after every POST. */
export async function readArtifactQuotaState(db: Executor, scope: string, actorId: string) {
  const [scopeRow] = await rows<QuotaRow>(db, sql`SELECT operation_limit::text, byte_limit::text,
    operations_used::text, bytes_used::text FROM artifacts.host_quotas WHERE storage_scope_id = ${scope}`);
  const [actorRow] = await rows<QuotaRow>(db, sql`SELECT operation_limit::text, byte_limit::text,
    operations_used::text, bytes_used::text FROM artifacts.host_actor_quotas
    WHERE storage_scope_id = ${scope} AND actor_id = ${actorId}`);
  const [exception] = await rows<{ max_bytes: string; expires_at: Date | null; granted_by: string;
    granted_at: Date; reason: string; active: boolean }>(db, sql`SELECT max_bytes::text, expires_at, granted_by,
    granted_at, reason, (expires_at IS NULL OR expires_at > now()) AS active
    FROM artifacts.host_actor_page_text_exceptions WHERE storage_scope_id = ${scope} AND actor_id = ${actorId}`);
  const [uploads] = await rows<{ open: string; next_expiry: Date | null }>(db, sql`SELECT count(*)::text AS open,
    min(expires_at) AS next_expiry FROM artifacts.uploads
    WHERE storage_scope_id = ${scope} AND owner_id = ${actorId} AND state = 'open'`);
  const events = await rows<Record<string, unknown>>(db, sql`SELECT admin_sub AS "adminSub", action,
    old_values AS "oldValues", new_values AS "newValues", reason, created_at AS "createdAt"
    FROM artifacts.host_quota_admin_events WHERE storage_scope_id = ${scope} AND actor_id = ${actorId}
    ORDER BY created_at DESC, id DESC LIMIT 20`);
  return {
    actorId, storageScopeId: scope,
    scopeQuota: quota(scopeRow), actorQuota: quota(actorRow),
    pageTextBudget: pageTextBudgetFromRow(exception?.active ? exception : undefined),
    pageTextException: exception ? { maxBytes: Number(exception.max_bytes), expiresAt: exception.expires_at,
      active: exception.active, grantedBy: exception.granted_by, grantedAt: exception.granted_at,
      reason: exception.reason } : null,
    openUploadSessions: { count: Number(uploads?.open ?? 0), nextExpiryAt: uploads?.next_expiry ?? null },
    recentEvents: events,
  };
}

export function adminArtifactQuotaRoute(deps: AdminArtifactQuotaDeps): Hono {
  const app = new Hono();
  const target = (c: Context, requested?: string): { scope: string; actorId: string } | Response => {
    const actorId = c.req.param("actorId") ?? "";
    if (!ACTOR_RE.test(actorId)) return c.json({ error: "invalid_actor_id" }, 400) as unknown as Response;
    const scope = requested ?? c.req.query("storageScopeId") ?? deps.storageScope;
    if (!scope || !SCOPE_RE.test(scope)) {
      return c.json({ error: "storage_scope_required" }, 400) as unknown as Response;
    }
    return { scope, actorId };
  };

  app.get("/api/v1/admin/artifacts/quotas/:actorId", async (c) => {
    const admin = await requireAdmin(c, deps);
    if (isResponse(admin)) return admin;
    const resolved = target(c);
    if (isResponse(resolved)) return resolved;
    return c.json(await readArtifactQuotaState(deps.db, resolved.scope, resolved.actorId));
  });

  return app;
}
