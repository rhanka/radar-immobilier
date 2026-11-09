import { describe, expect, it } from "vitest";
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from "jose";
import { loadConfig, resolveOpsConfig } from "../config.js";
import {
  isMissingWorkspaceTablesError,
  mergeRecipients,
  opsRecipientsRoute,
  resolveRecipients,
  type RecipientsStore,
} from "./recipients.js";

const ISSUER = "https://auth.example.test";
const AUDIENCE = "https://ops.example.test/recipients";
const NOW = new Date("2026-11-09T12:00:00.000Z");

const { privateKey, publicKey } = await generateKeyPair("EdDSA");
const publicJwk = await exportJWK(publicKey);
const getKey = createLocalJWKSet({ keys: [publicJwk] });

async function serviceToken(audience: string = AUDIENCE): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "EdDSA" })
    .setSubject("platform-alerts")
    .setIssuer(ISSUER)
    .setAudience(audience)
    .setIssuedAt(Math.floor(NOW.getTime() / 1000))
    .setExpirationTime(Math.floor(NOW.getTime() / 1000) + 300)
    .sign(privateKey);
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
    issuer: ISSUER,
    jwksUri: `${ISSUER}/.well-known/jwks.json`,
    audience: AUDIENCE,
    expectedTarget: "immo-preprod",
    referenceWorkspaceSlug: "ref-workspace",
    getKey,
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
      { headers: { authorization: `Bearer ${await serviceToken()}` } },
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
      { headers: { authorization: `Bearer ${await serviceToken()}` } },
    );
    expect(wrongTarget.status).toBe(404);
    expect(await wrongTarget.json()).toEqual({ error: "target_not_found" });
  });

  it("refuses a bearer minted for another audience with 401", async () => {
    const res = await route(fakeStore()).request(
      "/api/v1/ops/recipients?target=immo-preprod",
      {
        headers: {
          authorization: `Bearer ${await serviceToken("https://other.example.test")}`,
        },
      },
    );
    expect(res.status).toBe(401);
  });

  it("stays closed (503) while the L1 audience is not configured", async () => {
    const app = opsRecipientsRoute({
      store: fakeStore(),
      issuer: ISSUER,
      jwksUri: `${ISSUER}/.well-known/jwks.json`,
      expectedTarget: "immo-preprod",
      getKey,
      now: () => NOW.getTime(),
    });
    const res = await app.request("/api/v1/ops/recipients?target=immo-preprod", {
      headers: { authorization: `Bearer ${await serviceToken()}` },
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
          OPS_RECIPIENTS_AUDIENCE: AUDIENCE,
        }),
      ),
    ).toEqual({
      expectedTarget: "immo-prod",
      referenceWorkspaceSlug: "ref-workspace",
      recipientsAudience: AUDIENCE,
    });
    expect(() =>
      loadConfig({ ...base, OPS_TARGET: "staging" }),
    ).toThrow();
  });
});
