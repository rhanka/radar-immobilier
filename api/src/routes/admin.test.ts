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

// ── Tests invitations ────────────────────────────────────────────────────────

/**
 * Mock DB étendu pour les invitations : supporte deux collections
 * (users + invitations) via un discriminant sur la table sélectionnée.
 *
 * La stratégie consiste à intercepter `select().from(table)` en regardant
 * le nom interne de la table Drizzle (accédé via `[Symbol.for('drizzle:Name')]`).
 */
function makeDbWithInvitations(
  users: {
    id: string;
    sub: string;
    email: string | null;
    name: string | null;
    status: string;
    isAdmin: boolean;
    createdAt: Date;
    approvedAt: Date | null;
    approvedBy: string | null;
  }[],
  invitations: {
    id: string;
    email: string;
    token: string;
    status: string;
    invitedBy: string;
    invitedAt: Date;
    acceptedAt: Date | null;
    expiresAt: Date | null;
    note: string | null;
  }[] = [],
) {
  const updates: { field: string; value: string; set: Record<string, unknown> }[] = [];
  const inserts: Record<string, unknown>[] = [];

  const db = {
    select: () => ({
      from: (table: unknown) => {
        // Discriminate which collection to use based on the drizzle table name
        const tableName =
          table &&
          typeof table === "object" &&
          Symbol.for("drizzle:Name") in (table as object)
            ? (table as Record<symbol, unknown>)[Symbol.for("drizzle:Name")]
            : null;
        const isInvitations = tableName === "account_invitations";
        const collection: unknown[] = isInvitations ? invitations : users;

        return {
          where: (filter: unknown) => {
            const parsed = parseEqFilter(filter);
            return {
              limit: (n: number) => {
                if (!parsed) return Promise.resolve(collection.slice(0, n));
                return Promise.resolve(
                  collection
                    .filter((u) => (u as Record<string, unknown>)[parsed.field] === parsed.value)
                    .slice(0, n),
                );
              },
              then: (
                resolve: (v: unknown[]) => unknown,
                reject?: (e: unknown) => unknown,
              ) => {
                const result = parsed
                  ? collection.filter((u) => (u as Record<string, unknown>)[parsed.field] === parsed.value)
                  : collection;
                return Promise.resolve(result).then(resolve, reject);
              },
            };
          },
          orderBy: () => ({
            then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
              Promise.resolve(collection).then(resolve, reject),
          }),
          then: (resolve: (v: unknown[]) => unknown, reject?: (e: unknown) => unknown) =>
            Promise.resolve(collection).then(resolve, reject),
        };
      },
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

describe("adminRoute — invitations", () => {
  const adminUser = {
    id: "a1",
    sub: "admin-sub",
    email: "admin@sent-tech.ca",
    name: "Admin Principal",
    status: "approved",
    isAdmin: true,
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

  it("POST /invitations sans session retourne 401", async () => {
    const db = makeDbWithInvitations([adminUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const res = await app.request("/api/v1/admin/invitations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "test@example.com" }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /invitations avec email invalide retourne 400", async () => {
    const db = makeDbWithInvitations([adminUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/invitations", {
      method: "POST",
      headers: {
        cookie: `radar_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "pas-un-email" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("validation_failed");
  });

  it("POST /invitations avec email valide crée une invitation et retourne 200", async () => {
    const db = makeDbWithInvitations([adminUser]);
    const app = adminRoute({
      db,
      sessionSecret: SESSION_SECRET,
      now: () => Date.parse("2026-06-20T10:00:00Z"),
    });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/invitations", {
      method: "POST",
      headers: {
        cookie: `radar_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "steve@example.com", note: "Bienvenue Steve" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.invitation.email).toBe("steve@example.com");
    expect(body.invitation.status).toBe("pending");
    expect(body.invitation.invitedBy).toBe(adminUser.sub);
    // Mode dégradé (pas de config SMTP) : sent=false, link fourni
    expect(body.email.sent).toBe(false);
    // Le lien d'invitation passe par le sas API qui force l'auth IdP (jamais
    // une route SPA qui réutiliserait une session existante).
    expect(body.email.link).toContain("/api/v1/auth/enroll?token=");

    // DB: une insertion dans account_invitations
    expect(db._inserts).toHaveLength(1);
    const inserted = db._inserts[0]!;
    expect(inserted["email"]).toBe("steve@example.com");
    expect(inserted["status"]).toBe("pending");
    expect(inserted["invitedBy"]).toBe(adminUser.sub);
    expect(inserted["note"]).toBe("Bienvenue Steve");
    expect(typeof inserted["token"]).toBe("string");
    // Token est base64url non vide
    expect((inserted["token"] as string).length).toBeGreaterThan(20);
  });

  it("POST /invitations sans note fonctionne aussi", async () => {
    const db = makeDbWithInvitations([adminUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/invitations", {
      method: "POST",
      headers: {
        cookie: `radar_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "fardin@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.invitation.email).toBe("fardin@example.com");
  });

  it("GET /invitations retourne la liste des invitations", async () => {
    const existingInvitation = {
      id: "inv-1",
      email: "alice@example.com",
      token: "tok-abc",
      status: "pending",
      invitedBy: adminUser.sub,
      invitedAt: new Date("2026-06-19T09:00:00Z"),
      acceptedAt: null,
      expiresAt: null,
      note: null,
    };
    const db = makeDbWithInvitations([adminUser], [existingInvitation]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/invitations", {
      headers: { cookie: `radar_session=${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.invitations)).toBe(true);
    expect(body.invitations).toHaveLength(1);
    expect(body.invitations[0].email).toBe("alice@example.com");
  });

  it("GET /invitations sans session retourne 401", async () => {
    const db = makeDbWithInvitations([adminUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const res = await app.request("/api/v1/admin/invitations");
    expect(res.status).toBe(401);
  });

  it("POST /invitations avec JSON invalide retourne 400", async () => {
    const db = makeDbWithInvitations([adminUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/invitations", {
      method: "POST",
      headers: {
        cookie: `radar_session=${token}`,
        "content-type": "application/json",
      },
      body: "not json",
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_json");
  });

  it("POST /invitations réhabilite un compte 'rejected' existant en 'pending' + audite", async () => {
    // Bug prod : un email avec un vieux account_users 'rejected' réinvité
    // restait 'rejected' → l'invité voyait « refusé » malgré l'invitation.
    const rejectedUser = {
      id: "r1",
      sub: "rejected-sub",
      email: "comeback@example.com",
      name: "Come Back",
      status: "rejected",
      isAdmin: false,
      createdAt: new Date(),
      approvedAt: null,
      approvedBy: null,
    };
    const db = makeDbWithInvitations([adminUser, rejectedUser]);
    const app = adminRoute({
      db,
      sessionSecret: SESSION_SECRET,
      now: () => Date.parse("2026-06-21T10:00:00Z"),
    });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/invitations", {
      method: "POST",
      headers: {
        cookie: `radar_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "comeback@example.com" }),
    });
    expect(res.status).toBe(200);

    // Le compte rejected doit avoir été repassé en 'pending'.
    const statusUpdate = db._updates.find(
      (u) => u.field === "sub" && u.value === rejectedUser.sub,
    );
    expect(statusUpdate).toBeDefined();
    expect(statusUpdate!.set).toEqual({ status: "pending" });

    // Un événement d'audit 'reinvited' doit avoir été journalisé.
    const auditEvent = db._inserts.find(
      (i) => i["toStatus"] === "pending" && i["reason"] === "reinvited",
    );
    expect(auditEvent).toBeDefined();
    expect(auditEvent).toMatchObject({
      userSub: rejectedUser.sub,
      fromStatus: "rejected",
      toStatus: "pending",
      actorSub: adminUser.sub,
      reason: "reinvited",
    });
  });

  it("POST /invitations ne touche PAS un compte 'approved' existant", async () => {
    const approvedUser = {
      id: "ap1",
      sub: "approved-sub",
      email: "already@example.com",
      name: "Already In",
      status: "approved",
      isAdmin: false,
      createdAt: new Date(),
      approvedAt: new Date(),
      approvedBy: "admin-sub",
    };
    const db = makeDbWithInvitations([adminUser, approvedUser]);
    const app = adminRoute({ db, sessionSecret: SESSION_SECRET });
    const token = await makeAdminSession();
    const res = await app.request("/api/v1/admin/invitations", {
      method: "POST",
      headers: {
        cookie: `radar_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ email: "already@example.com" }),
    });
    expect(res.status).toBe(200);
    // Aucun update de statut sur le compte approuvé, aucun audit 'reinvited'.
    expect(db._updates.some((u) => u.value === approvedUser.sub)).toBe(false);
    expect(db._inserts.some((i) => i["reason"] === "reinvited")).toBe(false);
  });
});
