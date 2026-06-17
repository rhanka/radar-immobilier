import { describe, expect, it } from "vitest";
import { adminRoute } from "./admin.js";
import { signSession } from "../services/auth/session.js";

const SESSION_SECRET = "test-secret-32-bytes-long-padding!!!";

/**
 * Extract the field name + comparison value from a drizzle eq() result.
 * The queryChunks array contains:
 *   - a column chunk (has 'columnType' and 'name')
 *   - a value/param chunk (has 'value' as a non-array string)
 */
function parseEqFilter(filter: unknown): { field: string; value: string } | null {
  if (!filter || typeof filter !== "object") return null;
  const chunks: unknown[] = (filter as { queryChunks?: unknown[] }).queryChunks ?? [];
  const fieldChunk = chunks.find(
    (c) =>
      c &&
      typeof c === "object" &&
      "name" in (c as object) &&
      "columnType" in (c as object),
  ) as { name: string } | undefined;
  const valueChunk = chunks.find(
    (c) =>
      c &&
      typeof c === "object" &&
      "value" in (c as object) &&
      typeof (c as { value: unknown }).value === "string",
  ) as { value: string } | undefined;
  if (!fieldChunk || !valueChunk) return null;
  return { field: fieldChunk.name, value: valueChunk.value };
}

// In-memory DB mock for tests (no real Postgres required)
function makeDb(users: {
  id: string;
  sub: string;
  email: string | null;
  name: string | null;
  status: string;
  isAdmin: boolean;
  createdAt: Date;
  approvedAt: Date | null;
  approvedBy: string | null;
}[]) {
  const updates: { field: string; value: string; set: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: (filter: unknown) => {
          const parsed = parseEqFilter(filter);
          return {
            limit: (n: number) => {
              if (!parsed) return Promise.resolve(users.slice(0, n));
              return Promise.resolve(
                users
                  .filter((u) => (u as Record<string, unknown>)[parsed.field] === parsed.value)
                  .slice(0, n),
              );
            },
            then: (
              resolve: (v: unknown[]) => unknown,
              reject?: (e: unknown) => unknown,
            ) => {
              const result = parsed
                ? users.filter((u) => (u as Record<string, unknown>)[parsed.field] === parsed.value)
                : users;
              return Promise.resolve(result).then(resolve, reject);
            },
          };
        },
        then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(users).then(resolve, reject),
      }),
    }),
    insert: () => ({
      values: (vals: Record<string, unknown>) => {
        inserts.push(vals);
        return Promise.resolve();
      },
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (filter: unknown) => {
          const parsed = parseEqFilter(filter);
          if (parsed) updates.push({ ...parsed, set });
          return Promise.resolve();
        },
      }),
    }),
    _updates: updates,
    _inserts: inserts,
  };
  return db as unknown as Parameters<typeof adminRoute>[0]["db"] & {
    _updates: typeof updates;
    _inserts: typeof inserts;
  };
}

describe("adminRoute", () => {
  const adminUser = {
    id: "a1",
    sub: "admin-sub",
    email: "admin@sent-tech.ca",
    name: "Admin",
    status: "approved",
    isAdmin: true,
    createdAt: new Date(),
    approvedAt: null,
    approvedBy: null,
  };
  const pendingUser = {
    id: "b1",
    sub: "pending-sub",
    email: "bob@example.com",
    name: "Bob",
    status: "pending",
    isAdmin: false,
    createdAt: new Date(),
    approvedAt: null,
    approvedBy: null,
  };

  async function makeAdminSession() {
    return signSession(
      { sub: adminUser.sub },
      { sessionSecret: SESSION_SECRET, ttlSeconds: 3600 },
    );
  }
  async function makeNonAdminSession() {
    return signSession(
      { sub: pendingUser.sub },
      { sessionSecret: SESSION_SECRET, ttlSeconds: 3600 },
    );
  }

  it("GET /pending without session returns 401", async () => {
    const db = makeDb([adminUser, pendingUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const res = await app.request("/api/v1/admin/users/pending");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthenticated");
  });

  it("GET /pending with non-admin session returns 403", async () => {
    const db = makeDb([adminUser, pendingUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeNonAdminSession();
    const res = await app.request("/api/v1/admin/users/pending", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("forbidden");
  });

  it("GET /pending with admin session returns 200 and pending users", async () => {
    const db = makeDb([adminUser, pendingUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/users/pending", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.users)).toBe(true);
    // Should only return pending users
    expect(body.users.every((u: { status: string }) => u.status === "pending")).toBe(true);
  });

  it("POST /approve with admin session returns 200", async () => {
    const db = makeDb([adminUser, pendingUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeAdminSession();
    const res = await app.request(
      `/api/v1/admin/users/${encodeURIComponent(pendingUser.sub)}/approve`,
      {
        method: "POST",
        headers: { cookie: `radar_session=${token}` },
      },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("approved");
    expect(db._updates[0]!.set.status).toBe("approved");
    expect(db._updates[0]!.set.approvedAt).toBeInstanceOf(Date);
    expect(db._inserts[0]).toMatchObject({
      userSub: pendingUser.sub,
      fromStatus: "pending",
      toStatus: "approved",
      actorSub: adminUser.sub,
      reason: "Approved by admin",
    });
  });

  it("POST /reject audits the transition without overloading approvedAt", async () => {
    const db = makeDb([adminUser, pendingUser]);
    const app = adminRoute({
      db,
      sessionSecret: SESSION_SECRET,
      now: () => Date.parse("2026-06-17T12:00:00Z"),
    });
    const token = await makeAdminSession();
    const res = await app.request(
      `/api/v1/admin/users/${encodeURIComponent(pendingUser.sub)}/reject`,
      {
        method: "POST",
        headers: { cookie: `radar_session=${token}` },
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("rejected");
    expect(body.audit).toEqual({
      actorSub: adminUser.sub,
      at: "2026-06-17T12:00:00.000Z",
      reason: "Rejected by admin",
    });
    expect(db._updates[0]!.set).toEqual({ status: "rejected" });
    expect(db._inserts[0]).toMatchObject({
      userSub: pendingUser.sub,
      fromStatus: "pending",
      toStatus: "rejected",
      actorSub: adminUser.sub,
      reason: "Rejected by admin",
      createdAt: new Date("2026-06-17T12:00:00Z"),
    });
  });

  it("POST /status can suspend a user with an explicit reason", async () => {
    const db = makeDb([adminUser, pendingUser]);
    const app = adminRoute({
      db,
      sessionSecret: SESSION_SECRET,
      now: () => Date.parse("2026-06-17T13:00:00Z"),
    });
    const token = await makeAdminSession();
    const res = await app.request(
      `/api/v1/admin/users/${encodeURIComponent(pendingUser.sub)}/status`,
      {
        method: "POST",
        headers: {
          cookie: `radar_session=${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          status: "suspended",
          reason: "Offboarding requested",
        }),
      },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("suspended");
    expect(body.audit.reason).toBe("Offboarding requested");
    expect(db._updates[0]!.set).toEqual({ status: "suspended" });
    expect(db._inserts[0]).toMatchObject({
      userSub: pendingUser.sub,
      fromStatus: "pending",
      toStatus: "suspended",
      actorSub: adminUser.sub,
      reason: "Offboarding requested",
    });
  });
});
