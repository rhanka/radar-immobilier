import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readPageTextBudget } from "@radar/artifacts-host";
import { loadConfig } from "../../src/config.js";
import * as schema from "../../src/db/schema.js";
import { adminArtifactQuotaRoute } from "../../src/routes/admin-artifact-quotas.js";
import { SESSION_COOKIE_NAME, signSession } from "../../src/services/auth/session.js";
import { migrationsFolder } from "./artifacts-h2.helpers.js";

const database = "artifacts_quota_exceptions";
const SECRET = "aqx-session-secret-32-bytes-long!!";
const SCOPE = "aqx-scope";
const OWNER = "eca6a4e3-0419-4b8d-9d21-450b3891f233";
const MIB = 1024 * 1024;
let admin: pg.Pool;
let pool: pg.Pool;
let app: ReturnType<typeof adminArtifactQuotaRoute>;

async function cookie(sub: string): Promise<string> {
  return `${SESSION_COOKIE_NAME}=${await signSession({ sub }, { sessionSecret: SECRET, ttlSeconds: 600 })}`;
}

async function post(sub: string, actorId: string, body: unknown) {
  const res = await app.request(`/api/v1/admin/artifacts/quotas/${encodeURIComponent(actorId)}`, {
    method: "POST", headers: { cookie: await cookie(sub), "content-type": "application/json" },
    body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  const env = loadConfig();
  const params = { host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB };
  admin = new pg.Pool(params);
  await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${database} TEMPLATE template0`);
  pool = new pg.Pool({ ...params, database });
  await migrate(drizzle(pool), { migrationsFolder });
  // Migration 0049 replays (IF NOT EXISTS guards).
  const { readFileSync } = await import("node:fs");
  await pool.query(readFileSync(new URL("../../drizzle/0049_artifacts_quota_exceptions.sql", import.meta.url), "utf8")
    .replace("SET LOCAL lock_timeout = '5s';", ""));
  await pool.query(`INSERT INTO account_users (sub, status, is_admin) VALUES
    ('owner-admin', 'approved', true), ('member', 'approved', false), ('suspended-admin', 'suspended', true)`);
  await pool.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1, 'test')", [SCOPE]);
  await pool.query(`INSERT INTO artifacts.host_quotas (storage_scope_id, operation_limit, byte_limit, operations_used, bytes_used)
    VALUES ($1, 100, 1000, 100, 900)`, [SCOPE]);
  await pool.query(`INSERT INTO artifacts.host_actor_quotas (storage_scope_id, actor_id, operation_limit, byte_limit,
    operations_used, bytes_used) VALUES ($1, $2, 100, 1000, 100, 900)`, [SCOPE, OWNER]);
  app = adminArtifactQuotaRoute({ db: drizzle(pool, { schema }), sessionSecret: SECRET, storageScope: SCOPE });
});

afterAll(async () => {
  await pool?.end();
  await admin?.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
  await admin?.end();
});

describe("admin artifact quota exceptions", () => {
  it("refuses anonymous, non-admin and non-approved callers", async () => {
    const anonymous = await app.request(`/api/v1/admin/artifacts/quotas/${OWNER}`);
    expect(anonymous.status).toBe(401);
    for (const sub of ["member", "suspended-admin", "unknown"]) {
      expect((await post(sub, OWNER, { reason: "x", expireOpenUploads: true })).status, sub).toBe(403);
    }
    expect((await pool.query("SELECT count(*)::int AS n FROM artifacts.host_quota_admin_events")).rows[0].n).toBe(0);
  });

  it("validates the change set and the 10 MiB system maximum", async () => {
    expect((await post("owner-admin", OWNER, { reason: "x" })).status).toBe(400);
    expect((await post("owner-admin", OWNER, { pageTextException: { maxBytes: 10 * MIB } })).status).toBe(400);
    expect((await post("owner-admin", OWNER, { reason: "x", pageTextException: { maxBytes: 10 * MIB + 1 } })).status)
      .toBe(400);
    expect((await post("owner-admin", OWNER, { reason: "x", unknown: true })).status).toBe(400);
    expect((await post("owner-admin", OWNER, { reason: "x", storageScopeId: "missing",
      expireOpenUploads: true })).status).toBe(404);
    expect((await post("owner-admin", OWNER, { reason: "x",
      pageTextException: { maxBytes: 10 * MIB, expiresAt: "2001-01-01T00:00:00Z" } })).status).toBe(422);
  });

  it("grants the exception, raises and resets the actor quota, raises the scope limit, with audit rows", async () => {
    const result = await post("owner-admin", OWNER, {
      reason: "owner request 2026-11-21: larger pages",
      pageTextException: { maxBytes: 10 * MIB },
      actorQuota: { operationLimit: 1000, byteLimit: 10_000_000_000, resetUsage: true },
      scopeQuota: { operationLimit: 10_000, byteLimit: 100_000_000_000 },
    });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      actorId: OWNER, storageScopeId: SCOPE,
      actorQuota: { operationLimit: 1000, byteLimit: 10_000_000_000, operationsUsed: 0, bytesUsed: 0 },
      // Scope counters are retained (operator convention); only the limits move.
      scopeQuota: { operationLimit: 10_000, byteLimit: 100_000_000_000, operationsUsed: 100, bytesUsed: 900 },
      pageTextBudget: { maxFileBytes: 10 * MIB, maxTotalBytes: 10 * MIB, source: "exception", expiresAt: null },
      pageTextException: { maxBytes: 10 * MIB, active: true, grantedBy: "owner-admin" },
    });
    // Enforcement reads the same row.
    await expect(readPageTextBudget(pool, SCOPE, OWNER)).resolves.toMatchObject({ maxFileBytes: 10 * MIB });
    await expect(readPageTextBudget(pool, SCOPE, "member")).resolves.toMatchObject({ maxFileBytes: 5 * MIB });
    const events = (await pool.query(`SELECT admin_sub, action, old_values, new_values, reason
      FROM artifacts.host_quota_admin_events WHERE actor_id = $1 ORDER BY action`, [OWNER])).rows;
    expect(events.map((e) => e.action)).toEqual(["actor_quota", "page_text_exception", "scope_quota"]);
    expect(events[0]).toMatchObject({ admin_sub: "owner-admin", reason: "owner request 2026-11-21: larger pages",
      old_values: { operationLimit: 100, byteLimit: 1000, operationsUsed: 100, bytesUsed: 900 },
      new_values: { operationLimit: 1000, operationsUsed: 0, bytesUsed: 0 } });
    expect(events[1]).toMatchObject({ old_values: null, new_values: { maxBytes: 10 * MIB, expiresAt: null } });
  });

  it("expires the actor's open upload sessions only and revokes the exception", async () => {
    await pool.query(`INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name)
      VALUES ('11111111-1111-4111-8111-111111111111', $1, $2, 'page')`, [SCOPE, OWNER]);
    for (const [id, owner, state] of [["21111111-1111-4111-8111-111111111111", OWNER, "open"],
      ["31111111-1111-4111-8111-111111111111", OWNER, "committed"],
      ["41111111-1111-4111-8111-111111111111", "member", "open"]]) {
      await pool.query(`INSERT INTO artifacts.uploads (id, max_size, mime_type, state, artifact_id, storage_scope_id,
        owner_id, expires_at) VALUES ($1, 10, 'text/html', $2, '11111111-1111-4111-8111-111111111111', $3, $4,
        now() + interval '20 hours')`, [id, state, SCOPE, owner]);
    }
    const get = await app.request(`/api/v1/admin/artifacts/quotas/${OWNER}`, { headers: { cookie: await cookie("owner-admin") } });
    expect(((await get.json()) as { openUploadSessions: { count: number } }).openUploadSessions.count).toBe(1);
    const result = await post("owner-admin", OWNER, { reason: "unblock create_upload", expireOpenUploads: true,
      pageTextException: null });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ pageTextBudget: { source: "default", maxFileBytes: 5 * MIB },
      pageTextException: null });
    const due = (await pool.query(`SELECT id, expires_at <= now() AS due FROM artifacts.uploads ORDER BY id`)).rows;
    expect(due.map((r) => r.due)).toEqual([true, false, false]);
    const last = (await pool.query(`SELECT action, new_values FROM artifacts.host_quota_admin_events
      WHERE actor_id = $1 AND action IN ('expire_open_uploads', 'page_text_exception') ORDER BY created_at DESC, action`,
    [OWNER])).rows;
    expect(last).toEqual(expect.arrayContaining([{ action: "expire_open_uploads", new_values: { sessions: 1 } },
      { action: "page_text_exception", new_values: null }]));
  });
});
