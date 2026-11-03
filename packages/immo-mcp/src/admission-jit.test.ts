// Lot I1 — unit tests for the immo-mcp JIT mirror (no DB, no network).
import { describe, expect, it, vi } from "vitest";
import {
  admissionJitInputFromClaims,
  reconcileAdmissionLink,
  type AdmissionJitStore,
} from "./admission-jit.js";
import { accountAuthorizer } from "./account-binding.js";

interface FakeAccount {
  sub: string;
  email: string | null;
  status: string;
  isAdmin: boolean;
  approvedAt: string | null;
  admissionSource: string;
}

/** Minimal in-memory store honouring the SQL shapes issued by the mirror. */
function fakeStore(opts: {
  profiles?: { email: string; status: string; role: string; name: string | null }[];
  accounts?: FakeAccount[];
  failOnWrite?: boolean;
}): AdmissionJitStore & { accounts: FakeAccount[] } {
  const profiles = new Map((opts.profiles ?? []).map((p) => [p.email, p]));
  const accounts = new Map((opts.accounts ?? []).map((a) => [a.sub, { ...a }]));
  const lower = (value: string) => value.trim().toLowerCase();
  return {
    accounts: [...accounts.values()],
    async query(sql: string, args: unknown[]) {
      if (opts.failOnWrite && /^(INSERT|UPDATE)/i.test(sql.trim())) {
        throw new Error("writable pool down");
      }
      if (sql.includes("FROM admission_sync_profiles")) {
        const row = profiles.get(String(args[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("FROM account_users WHERE sub")) {
        const row = accounts.get(String(args[0]));
        return {
          rows: row
            ? [{
              sub: row.sub,
              email: row.email,
              status: row.status,
              approved_at: row.approvedAt,
              admission_source: row.admissionSource,
            }]
            : [],
        };
      }
      if (sql.includes("WHERE admission_source = 'prod_sync'")) {
        const norm = String(args[0]);
        const exclude = args.length > 1 ? String(args[1]) : undefined;
        const hit = [...accounts.values()].find(
          (a) => a.admissionSource === "prod_sync" && a.email !== null && lower(a.email) === norm && a.sub !== exclude,
        );
        return { rows: hit ? [{ sub: hit.sub }] : [] };
      }
      if (sql.includes("WHERE admission_source = 'local'")) {
        const norm = String(args[0]);
        const exclude = args.length > 1 ? String(args[1]) : undefined;
        const hit = [...accounts.values()].find(
          (a) => a.admissionSource === "local" && a.email !== null && lower(a.email) === norm && a.sub !== exclude,
        );
        return { rows: hit ? [{ sub: hit.sub }] : [] };
      }
      if (sql.includes("SET status = 'approved'")) {
        const row = accounts.get(String(args[1]));
        if (row && row.admissionSource === "prod_sync") {
          row.status = "approved";
          row.isAdmin = Boolean(args[0]);
          return { rows: [{ id: "x" }] };
        }
        return { rows: [] };
      }
      if (sql.includes("SET email")) {
        const row = accounts.get(String(args[4]));
        if (row && row.status === "pending" && row.admissionSource === "local") {
          if ([...accounts.values()].some((a) => a.admissionSource === "prod_sync" && a.email !== null && lower(a.email) === lower(String(args[0])))) {
            throw Object.assign(new Error("duplicate"), { code: "23505" });
          }
          row.email = String(args[0]);
          row.status = "approved";
          row.isAdmin = Boolean(args[2]);
          row.approvedAt = String(args[3]);
          row.admissionSource = "prod_sync";
          return { rows: [{ id: "x" }] };
        }
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO account_users")) {
        const sub = String(args[0]);
        const email = String(args[1]);
        if (accounts.has(sub)) return { rows: [] };
        if ([...accounts.values()].some((a) => a.admissionSource === "prod_sync" && a.email !== null && lower(a.email) === lower(email))) {
          throw Object.assign(new Error("duplicate"), { code: "23505" });
        }
        accounts.set(sub, {
          sub,
          email,
          status: "approved",
          isAdmin: Boolean(args[3]),
          approvedAt: String(args[4]),
          admissionSource: "prod_sync",
        });
        return { rows: [{ id: "x" }] };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
}

const TRUSTED = { trustedIssuers: ["https://preprod.auth.sent-tech.ca"] };
const PROFILE = [{ email: "jit@example.ca", status: "approved", role: "member", name: "Jit" }];

describe("reconcileAdmissionLink", () => {
  it("should create a first-time link", async () => {
    const store = fakeStore({ profiles: PROFILE });
    await expect(
      reconcileAdmissionLink(store, { sub: "s1", email: "jit@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).resolves.toEqual({ linked: true, mode: "created" });
  });

  it("should refuse unverified, untrusted, missing-email and non-admitted inputs before any write", async () => {
    const store = fakeStore({ profiles: PROFILE });
    await expect(
      reconcileAdmissionLink(store, { sub: "s1", email: "jit@example.ca", emailVerified: false, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).resolves.toEqual({ linked: false, reason: "unverified_email" });
    await expect(
      reconcileAdmissionLink(store, { sub: "s1", email: "jit@example.ca", emailVerified: true, issuer: "https://evil.test" }, TRUSTED),
    ).resolves.toEqual({ linked: false, reason: "untrusted_issuer" });
    const empty = fakeStore({ profiles: [] });
    await expect(
      reconcileAdmissionLink(empty, { sub: "s1", email: "unknown@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).resolves.toEqual({ linked: false, reason: "not_admitted" });
    const suspended = fakeStore({
      profiles: [{ email: "jit@example.ca", status: "suspended", role: "member", name: "Jit" }],
    });
    await expect(
      reconcileAdmissionLink(suspended, { sub: "s1", email: "jit@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).resolves.toEqual({ linked: false, reason: "not_approved" });
  });

  it("should upgrade a matching pending local row and refuse null-email stamping", async () => {
    const store = fakeStore({
      profiles: PROFILE,
      accounts: [{ sub: "s1", email: "  JIT@example.ca ", status: "pending", isAdmin: false, approvedAt: null, admissionSource: "local" }],
    });
    await expect(
      reconcileAdmissionLink(store, { sub: "s1", email: "jit@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).resolves.toEqual({ linked: true, mode: "upgraded" });

    const nulled = fakeStore({
      profiles: PROFILE,
      accounts: [{ sub: "s2", email: null, status: "pending", isAdmin: false, approvedAt: null, admissionSource: "local" }],
    });
    await expect(
      reconcileAdmissionLink(nulled, { sub: "s2", email: "jit@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).resolves.toEqual({ linked: false, reason: "local_conflict" });
  });

  it("should map a lost race to already_linked_elsewhere instead of 500", async () => {
    const store = fakeStore({
      profiles: PROFILE,
      accounts: [
        { sub: "winner", email: "jit@example.ca", status: "approved", isAdmin: false, approvedAt: null, admissionSource: "prod_sync" },
        { sub: "s1", email: "jit@example.ca", status: "pending", isAdmin: false, approvedAt: null, admissionSource: "local" },
      ],
    });
    await expect(
      reconcileAdmissionLink(store, { sub: "s1", email: "jit@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).resolves.toEqual({ linked: false, reason: "already_linked_elsewhere" });
  });

  it("should re-admit a revoked link and report already without relinking", async () => {
    const store = fakeStore({
      profiles: PROFILE,
      accounts: [{ sub: "s1", email: "jit@example.ca", status: "rejected", isAdmin: true, approvedAt: null, admissionSource: "prod_sync" }],
    });
    const input = { sub: "s1", email: "jit@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! };
    await expect(reconcileAdmissionLink(store, input, TRUSTED)).resolves.toEqual({
      linked: true,
      mode: "reapproved",
    });
    await expect(reconcileAdmissionLink(store, input, TRUSTED)).resolves.toEqual({
      linked: true,
      mode: "already",
    });
  });

  it("should fail closed when the writable store is down", async () => {
    const store = fakeStore({ profiles: PROFILE, failOnWrite: true });
    await expect(
      reconcileAdmissionLink(store, { sub: "s1", email: "jit@example.ca", emailVerified: true, issuer: TRUSTED.trustedIssuers[0]! }, TRUSTED),
    ).rejects.toThrow("writable pool down");
  });
});

describe("admissionJitInputFromClaims", () => {
  const issuer = "https://preprod.auth.sent-tech.ca";
  it("should extract the JIT identity from verified upstream claims", () => {
    expect(admissionJitInputFromClaims({ email: "jit@example.ca", email_verified: true, iss: issuer })).toEqual({
      email: "jit@example.ca",
      emailVerified: true,
      issuer,
    });
    expect(admissionJitInputFromClaims({ email: "jit@example.ca", iss: issuer })).toMatchObject({
      emailVerified: false,
    });
  });

  it("should return undefined when no usable email/issuer is present", () => {
    expect(admissionJitInputFromClaims(null)).toBeUndefined();
    expect(admissionJitInputFromClaims({})).toBeUndefined();
    expect(admissionJitInputFromClaims({ email: "  ", iss: issuer })).toBeUndefined();
    expect(admissionJitInputFromClaims({ email: "jit@example.ca" })).toBeUndefined();
  });
});

describe("accountAuthorizer JIT gate", () => {
  const base = { issuer: "synthetic", sub: "new-mcp-user", scopes: ["immo:read"], claims: [] };

  function jitRequest() {
    return {
      principal: {
        ...base,
        attributes: {
          workspaces: ["default"],
          email: "jit@example.ca",
          emailVerified: true,
          idpIssuer: "https://preprod.auth.sent-tech.ca",
        },
      },
      resource: "synthetic:mcp",
      correlationId: "test",
      signal: new AbortController().signal,
    } as unknown as Parameters<ReturnType<typeof accountAuthorizer>>[1];
  }

  it("should link an unknown approved user and then authorise", async () => {
    let linked = false;
    const query = vi.fn(async () => ({ rows: linked ? [{ id: "id", status: "approved" }] : [] }));
    const reconcile = vi.fn(async () => {
      linked = true;
      return { linked: true, mode: "created" as const };
    });
    const authorize = accountAuthorizer({ query }, {}, {
      jit: { trustedIssuers: ["https://preprod.auth.sent-tech.ca"], reconcile },
    });
    await expect(authorize("get_zones_geojson", jitRequest())).resolves.toBe(true);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith({
      sub: "new-mcp-user",
      email: "jit@example.ca",
      emailVerified: true,
      issuer: "https://preprod.auth.sent-tech.ca",
    });
  });

  it("should stay closed without verified JIT attributes", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const reconcile = vi.fn(async () => ({ linked: true, mode: "created" as const }));
    const authorize = accountAuthorizer({ query }, {}, {
      jit: { trustedIssuers: ["https://preprod.auth.sent-tech.ca"], reconcile },
    });
    const plain = {
      principal: { ...base, attributes: { workspaces: ["default"] } },
      resource: "synthetic:mcp",
      correlationId: "test",
      signal: new AbortController().signal,
    } as unknown as Parameters<ReturnType<typeof accountAuthorizer>>[1];
    await expect(authorize("get_zones_geojson", plain)).resolves.toBe(false);
    expect(reconcile).not.toHaveBeenCalled();
  });

  it("should fail closed when reconciliation throws", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const authorize = accountAuthorizer({ query }, {}, {
      jit: {
        trustedIssuers: ["https://preprod.auth.sent-tech.ca"],
        reconcile: async () => {
          throw new Error("down");
        },
      },
    });
    await expect(authorize("get_zones_geojson", jitRequest())).resolves.toBe(false);
  });
});
