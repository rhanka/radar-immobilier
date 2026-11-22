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
import { z } from "zod";
import { PAGE_TEXT_DEFAULT_MAX_BYTES, PAGE_TEXT_SYSTEM_MAX_BYTES, pageTextBudgetFromRow } from "@radar/artifacts-host";
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
const limit = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);

export const ArtifactQuotaBody = z.object({
  reason: z.string().trim().min(1).max(500),
  storageScopeId: z.string().regex(SCOPE_RE).optional(),
  actorQuota: z.object({
    operationLimit: limit.optional(),
    byteLimit: limit.optional(),
    resetUsage: z.boolean().optional(),
  }).strict().optional(),
  scopeQuota: z.object({
    operationLimit: limit.optional(),
    byteLimit: limit.optional(),
  }).strict().optional(),
  pageTextException: z.union([z.null(), z.object({
    maxBytes: z.number().int().min(PAGE_TEXT_DEFAULT_MAX_BYTES + 1).max(PAGE_TEXT_SYSTEM_MAX_BYTES),
    expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
  }).strict()]).optional(),
  expireOpenUploads: z.literal(true).optional(),
}).strict().refine((body) => body.actorQuota !== undefined || body.scopeQuota !== undefined ||
  body.pageTextException !== undefined || body.expireOpenUploads === true, { message: "no change requested" });
export type ArtifactQuotaBodyT = z.infer<typeof ArtifactQuotaBody>;

class QuotaAdminRefusal extends Error {
  constructor(readonly status: 404 | 409 | 422, readonly code: string) { super(code); }
}

interface QuotaRow { operation_limit: string; byte_limit: string; operations_used: string; bytes_used: string }

const quota = (row: QuotaRow | undefined) => row ? {
  operationLimit: Number(row.operation_limit), byteLimit: Number(row.byte_limit),
  operationsUsed: Number(row.operations_used), bytesUsed: Number(row.bytes_used),
} : null;

async function rows<T>(db: Executor, query: ReturnType<typeof sql>): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

async function audit(tx: Executor, input: { scope: string; actorId: string; adminSub: string; action: string;
  oldValues: unknown; newValues: unknown; reason: string }): Promise<void> {
  await tx.execute(sql`INSERT INTO artifacts.host_quota_admin_events
    (storage_scope_id, actor_id, admin_sub, action, old_values, new_values, reason)
    VALUES (${input.scope}, ${input.actorId}, ${input.adminSub}, ${input.action},
      ${input.oldValues === null ? null : JSON.stringify(input.oldValues)}::jsonb,
      ${input.newValues === null ? null : JSON.stringify(input.newValues)}::jsonb, ${input.reason})`);
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

/** Apply one validated change set atomically; every effective change writes one audit row. */
export async function applyArtifactQuotaChange(db: Database, input: { scope: string; actorId: string;
  adminSub: string; body: ArtifactQuotaBodyT; nowMs: number }): Promise<void> {
  const { scope, actorId, adminSub, body } = input;
  const reason = body.reason;
  await db.transaction(async (tx) => {
    const known = await rows(tx, sql`SELECT 1 FROM artifacts.storage_scopes WHERE id = ${scope}`);
    if (known.length === 0) throw new QuotaAdminRefusal(404, "storage_scope_not_found");
    if (body.scopeQuota) {
      const [before] = await rows<QuotaRow>(tx, sql`SELECT operation_limit::text, byte_limit::text,
        operations_used::text, bytes_used::text FROM artifacts.host_quotas WHERE storage_scope_id = ${scope} FOR UPDATE`);
      if (!before) throw new QuotaAdminRefusal(409, "scope_quota_not_provisioned");
      const next = { operationLimit: body.scopeQuota.operationLimit ?? Number(before.operation_limit),
        byteLimit: body.scopeQuota.byteLimit ?? Number(before.byte_limit) };
      await tx.execute(sql`UPDATE artifacts.host_quotas SET operation_limit = ${next.operationLimit},
        byte_limit = ${next.byteLimit} WHERE storage_scope_id = ${scope}`);
      await audit(tx, { scope, actorId, adminSub, action: "scope_quota", oldValues: quota(before),
        newValues: next, reason });
    }
    if (body.actorQuota) {
      // Same provisioning as the commit policy: a missing actor row starts as a copy of the scope row.
      await tx.execute(sql`INSERT INTO artifacts.host_actor_quotas (storage_scope_id, actor_id, operation_limit, byte_limit)
        SELECT ${scope}, ${actorId}, operation_limit, byte_limit FROM artifacts.host_quotas WHERE storage_scope_id = ${scope}
        ON CONFLICT (storage_scope_id, actor_id) DO NOTHING`);
      const [before] = await rows<QuotaRow>(tx, sql`SELECT operation_limit::text, byte_limit::text,
        operations_used::text, bytes_used::text FROM artifacts.host_actor_quotas
        WHERE storage_scope_id = ${scope} AND actor_id = ${actorId} FOR UPDATE`);
      if (!before) throw new QuotaAdminRefusal(409, "scope_quota_not_provisioned");
      const reset = body.actorQuota.resetUsage === true;
      const next = { operationLimit: body.actorQuota.operationLimit ?? Number(before.operation_limit),
        byteLimit: body.actorQuota.byteLimit ?? Number(before.byte_limit),
        operationsUsed: reset ? 0 : Number(before.operations_used), bytesUsed: reset ? 0 : Number(before.bytes_used) };
      await tx.execute(sql`UPDATE artifacts.host_actor_quotas SET operation_limit = ${next.operationLimit},
        byte_limit = ${next.byteLimit}, operations_used = ${next.operationsUsed}, bytes_used = ${next.bytesUsed}
        WHERE storage_scope_id = ${scope} AND actor_id = ${actorId}`);
      await audit(tx, { scope, actorId, adminSub, action: "actor_quota", oldValues: quota(before),
        newValues: next, reason });
    }
    if (body.pageTextException !== undefined) {
      const [before] = await rows<{ max_bytes: string; expires_at: Date | null }>(tx, sql`SELECT max_bytes::text, expires_at
        FROM artifacts.host_actor_page_text_exceptions WHERE storage_scope_id = ${scope} AND actor_id = ${actorId} FOR UPDATE`);
      const oldValues = before ? { maxBytes: Number(before.max_bytes), expiresAt: before.expires_at } : null;
      if (body.pageTextException === null) {
        await tx.execute(sql`DELETE FROM artifacts.host_actor_page_text_exceptions
          WHERE storage_scope_id = ${scope} AND actor_id = ${actorId}`);
        await audit(tx, { scope, actorId, adminSub, action: "page_text_exception", oldValues, newValues: null, reason });
      } else {
        const expiresAt = body.pageTextException.expiresAt ?? null;
        if (expiresAt !== null && Date.parse(expiresAt) <= input.nowMs) {
          throw new QuotaAdminRefusal(422, "expiry_in_past");
        }
        const maxBytes = body.pageTextException.maxBytes;
        await tx.execute(sql`INSERT INTO artifacts.host_actor_page_text_exceptions
          (storage_scope_id, actor_id, max_bytes, expires_at, granted_by, reason)
          VALUES (${scope}, ${actorId}, ${maxBytes}, ${expiresAt}::timestamptz, ${adminSub}, ${reason})
          ON CONFLICT (storage_scope_id, actor_id) DO UPDATE SET max_bytes = EXCLUDED.max_bytes,
            expires_at = EXCLUDED.expires_at, granted_by = EXCLUDED.granted_by,
            granted_at = now(), reason = EXCLUDED.reason`);
        await audit(tx, { scope, actorId, adminSub, action: "page_text_exception", oldValues,
          newValues: { maxBytes, expiresAt }, reason });
      }
    }
    if (body.expireOpenUploads === true) {
      // The upload sweeper (every minute) expires these sessions and deletes
      // their staging objects; the provider open-session bound frees at once.
      const expired = await rows<{ id: string }>(tx, sql`UPDATE artifacts.uploads SET expires_at = now()
        WHERE storage_scope_id = ${scope} AND owner_id = ${actorId} AND state = 'open' AND expires_at > now()
        RETURNING id`);
      await audit(tx, { scope, actorId, adminSub, action: "expire_open_uploads", oldValues: null,
        newValues: { sessions: expired.length }, reason });
    }
  });
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

  app.post("/api/v1/admin/artifacts/quotas/:actorId", async (c) => {
    const admin = await requireAdmin(c, deps);
    if (isResponse(admin)) return admin;
    const parsed = ArtifactQuotaBody.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    const resolved = target(c, parsed.data.storageScopeId);
    if (isResponse(resolved)) return resolved;
    try {
      await applyArtifactQuotaChange(deps.db, { ...resolved, adminSub: admin.sub, body: parsed.data,
        nowMs: (deps.now ?? Date.now)() });
    } catch (error) {
      if (error instanceof QuotaAdminRefusal) return c.json({ error: error.code }, error.status);
      throw error;
    }
    return c.json(await readArtifactQuotaState(deps.db, resolved.scope, resolved.actorId));
  });
  return app;
}
