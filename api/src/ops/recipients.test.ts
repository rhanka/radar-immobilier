import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { loadConfig, resolveOpsConfig } from "../config.js";
import {
  bearerMatches,
  createDrizzleRecipientsStore,
  isMissingWorkspaceTablesError,
  mergeRecipients,
  opsRecipientsRoute,
  resolveRecipients,
  type RecipientsStore,
} from "./recipients.js";

const BEARER = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-11-09T12:00:00.000Z");

function authHeader(value: string = BEARER): { authorization: string } {
  return { authorization: `Bearer ${value}` };
}

function fakeStore(overrides: Partial<RecipientsStore> = {}): RecipientsStore {
  return {
    listAppAdmins: async () => [
      { accountRef: "acc-b", email: "b@example.test" },
      { accountRef: "acc-a", email: "a@example.test" },
    ],
    listWorkspaceManagers: async () => [
      { accountRef: "acc-a", email: "a@example.test" },
      { accountRef: "acc-c", email: "c@example.test" },
    ],
    ...overrides,
  };
}

function route(store: RecipientsStore) {
  return opsRecipientsRoute({
    store,
    bearer: BEARER,
    expectedTarget: "immo-preprod",
    referenceWorkspaceSlug: "ref-workspace",
    now: () => NOW.getTime(),
  });
}

describe("mergeRecipients", () => {
  it("deduplicates by account, merges basis, drops missing emails, sorts", () => {
    expect(
      mergeRecipients(
        [
          { accountRef: "acc-b", email: "b@example.test" },
          { accountRef: "acc-a", email: "a@example.test" },
          { accountRef: "acc-x", email: null },
        ],
        [{ accountRef: "acc-a", email: "a@example.test" }],
      ),
    ).toEqual([
      {
        accountRef: "acc-a",
        email: "a@example.test",
        basis: ["workspace:manage_members", "app:is_admin"],
      },
      { accountRef: "acc-b", email: "b@example.test", basis: ["app:is_admin"] },
    ]);
  });
});

describe("resolveRecipients fallback", () => {
  it("falls back to is_admin alone when workspace tables are missing", async () => {
    const missing = Object.assign(new Error("relation not found"), {
      code: "42P01",
    });
    expect(isMissingWorkspaceTablesError(missing)).toBe(true);
    const store = fakeStore({
      listWorkspaceManagers: async () => {
        throw missing;
      },
    });
    const resolved = await resolveRecipients(store, "ref-workspace");
    expect(resolved.workspaceTierAvailable).toBe(false);
    expect(resolved.admins).toEqual([
      { accountRef: "acc-a", email: "a@example.test", basis: ["app:is_admin"] },
      { accountRef: "acc-b", email: "b@example.test", basis: ["app:is_admin"] },
    ]);
  });

  it("falls back when Drizzle wraps the pg error in the cause chain", async () => {
    const pgError = Object.assign(
      new Error('relation "workspace_memberships" does not exist'),
      { code: "42P01" },
    );
    const wrapped = new Error(
      "Failed query: select from workspace_memberships",
      { cause: pgError },
    );
    expect(isMissingWorkspaceTablesError(wrapped)).toBe(true);
    const messageOnly = new Error("Failed query: select", {
      cause: new Error('relation "workspaces" does not exist'),
    });
    expect(isMissingWorkspaceTablesError(messageOnly)).toBe(true);
    const store = fakeStore({
      listWorkspaceManagers: async () => {
        throw wrapped;
      },
    });
    const resolved = await resolveRecipients(store, "ref-workspace");
    expect(resolved.workspaceTierAvailable).toBe(false);
    expect(resolved.admins).toEqual([
      { accountRef: "acc-a", email: "a@example.test", basis: ["app:is_admin"] },
      { accountRef: "acc-b", email: "b@example.test", basis: ["app:is_admin"] },
    ]);
  });

  it("uses the fallback tier when no reference slug is configured", async () => {
    const resolved = await resolveRecipients(fakeStore(), undefined);
    expect(resolved.workspaceTierAvailable).toBe(false);
    expect(resolved.admins).toEqual([
      { accountRef: "acc-a", email: "a@example.test", basis: ["app:is_admin"] },
      { accountRef: "acc-b", email: "b@example.test", basis: ["app:is_admin"] },
    ]);
  });

  it("propagates non-missing-table errors", async () => {
    const store = fakeStore({
      listWorkspaceManagers: async () => {
        throw new Error("connection reset");
      },
    });
    await expect(resolveRecipients(store, "ref-workspace")).rejects.toThrow(
      "connection reset",
    );
  });
});

describe("opsRecipientsRoute", () => {
  it("answers the frozen v1 shape for a valid service-client bearer", async () => {
    const res = await route(fakeStore()).request(
      "/api/v1/ops/recipients?target=immo-preprod",
      { headers: authHeader() },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      v: 1,
      target: "immo-preprod",
      asOf: "2026-11-09T12:00:00.000Z",
      admins: [
        {
          accountRef: "acc-a",
          email: "a@example.test",
          basis: ["workspace:manage_members", "app:is_admin"],
        },
        { accountRef: "acc-b", email: "b@example.test", basis: ["app:is_admin"] },
        {
          accountRef: "acc-c",
          email: "c@example.test",
          basis: ["workspace:manage_members"],
        },
      ],
    });
  });

  it("refuses a missing bearer with 401 and a foreign target with 404", async () => {
    const app = route(fakeStore());
    const noToken = await app.request("/api/v1/ops/recipients?target=immo-preprod");
    expect(noToken.status).toBe(401);
    const wrongTarget = await app.request(
      "/api/v1/ops/recipients?target=immo-prod",
      { headers: authHeader() },
    );
    expect(wrongTarget.status).toBe(404);
    expect(await wrongTarget.json()).toEqual({ error: "target_not_found" });
  });

  it("should refuse a wrong bearer with 401 when the value differs", async () => {
    const res = await route(fakeStore()).request(
      "/api/v1/ops/recipients?target=immo-preprod",
      { headers: authHeader("ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") },
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("should refuse a wrong-length bearer with 401 when lengths differ", async () => {
    const res = await route(fakeStore()).request(
      "/api/v1/ops/recipients?target=immo-preprod",
      { headers: authHeader("short") },
    );
    expect(res.status).toBe(401);
  });

  it("bearerMatches is exact and length-safe", () => {
    expect(bearerMatches(BEARER, BEARER)).toBe(true);
    expect(bearerMatches("short", BEARER)).toBe(false);
    expect(bearerMatches(BEARER, "short")).toBe(false);
  });

  it("answers 503 recipients_unavailable when the store fails", async () => {
    const store = fakeStore({
      listAppAdmins: async () => {
        throw new Error("connection reset");
      },
    });
    const res = await route(store).request(
      "/api/v1/ops/recipients?target=immo-preprod",
      { headers: authHeader() },
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "recipients_unavailable" });
  });

  it("answers 404 when the target parameter is missing", async () => {
    const res = await route(fakeStore()).request("/api/v1/ops/recipients", {
      headers: authHeader(),
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "target_not_found" });
  });

  it("signals the fallback tier through the warn seam", async () => {
    const events: Record<string, unknown>[] = [];
    const store = fakeStore({
      listWorkspaceManagers: async () => {
        throw new Error("Failed query: select", {
          cause: Object.assign(
            new Error('relation "workspace_memberships" does not exist'),
            { code: "42P01" },
          ),
        });
      },
    });
    const app = opsRecipientsRoute({
      store,
      bearer: BEARER,
      expectedTarget: "immo-preprod",
      referenceWorkspaceSlug: "ref-workspace",
      now: () => NOW.getTime(),
      warn: (event) => events.push(event),
    });
    const res = await app.request(
      "/api/v1/ops/recipients?target=immo-preprod",
      { headers: authHeader() },
    );
    expect(res.status).toBe(200);
    expect(events).toEqual([
      {
        event: "ops_recipients_workspace_tier_unavailable",
        target: "immo-preprod",
      },
    ]);
  });

  it("should stay closed with 503 when the bearer is not configured", async () => {
    const app = opsRecipientsRoute({
      store: fakeStore(),
      expectedTarget: "immo-preprod",
      now: () => NOW.getTime(),
    });
    const res = await app.request("/api/v1/ops/recipients?target=immo-preprod", {
      headers: authHeader(),
    });
    expect(res.status).toBe(503);
  });
});

describe("ops config", () => {
  it("maps OPS_* env without guessing defaults", () => {
    const base = {
      NODE_ENV: "test",
      POSTGRES_HOST: "localhost",
      POSTGRES_USER: "radar",
      POSTGRES_PASSWORD: "pw",
      POSTGRES_DB: "radar",
      S3_ENDPOINT: "http://localhost:9000",
      S3_ACCESS_KEY: "minio",
      S3_SECRET_KEY: "minio",
    } as NodeJS.ProcessEnv;
    expect(resolveOpsConfig(loadConfig({ ...base }))).toEqual({});
    expect(
      resolveOpsConfig(
        loadConfig({
          ...base,
          OPS_TARGET: "immo-prod",
          OPS_REFERENCE_WORKSPACE_SLUG: "ref-workspace",
          OPS_RECIPIENTS_BEARER: BEARER,
        }),
      ),
    ).toEqual({
      expectedTarget: "immo-prod",
      referenceWorkspaceSlug: "ref-workspace",
      recipientsBearer: BEARER,
    });
    expect(() =>
      loadConfig({ ...base, OPS_TARGET: "staging" }),
    ).toThrow();
  });
});

describe("createDrizzleRecipientsStore filters", () => {
  function fakeDb(capture: { cond?: unknown }) {
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.innerJoin = () => builder;
    builder.where = (cond: unknown) => {
      capture.cond = cond;
      return Promise.resolve([]);
    };
    return { select: () => builder };
  }

  it("filters app admins on is_admin and approved status", async () => {
    const capture: { cond?: unknown } = {};
    const store = createDrizzleRecipientsStore(fakeDb(capture) as never);
    await store.listAppAdmins();
    const query = new PgDialect().sqlToQuery(capture.cond as never);
    expect(query.sql).toContain("is_admin");
    expect(query.params).toContain(true);
    expect(query.params).toContain("approved");
  });

  it("filters workspace managers on slug, active, unrevoked, manage_members", async () => {
    const capture: { cond?: unknown } = {};
    const store = createDrizzleRecipientsStore(fakeDb(capture) as never);
    await store.listWorkspaceManagers("ref-workspace");
    const query = new PgDialect().sqlToQuery(capture.cond as never);
    expect(query.sql).toContain("manage_members");
    expect(query.sql).toContain("revoked_at");
    expect(query.params).toContain("ref-workspace");
    expect(query.params).toContain("active");
    expect(query.params).toContain(true);
    expect(query.params).toContain("approved");
  });
});
