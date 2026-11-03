// Lot I1 — admission prod -> preprod acceptance tests (real Postgres stack).
//
// Covers the converged-R2 I1 acceptance row: a prod-approved user unknown in
// preprod with a different sub opens a shared preprod artifact on first click;
// concurrent openings link once; prod revocation refuses after the next cycle;
// invalid signatures and unverified emails are rejected; local accounts are
// never overwritten by the sync.

import pg from "pg";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import { generateKeyPair, SignJWT, createLocalJWKSet, exportJWK, type JWK } from "jose";
import { loadConfig, type AuthConfig } from "../../src/config.js";
import type { Database } from "../../src/db/client.js";
import { accountUsers } from "../../src/db/schema.js";
import {
  buildAdmissionSnapshot,
  generateAdmissionKeypair,
  parsePrivateKeyEntry,
  parsePublicKeyList,
  signSnapshot,
  SnapshotRejectedError,
} from "../../src/admission/snapshot.js";
import { applyAdmissionSnapshot } from "../../src/admission/ingest.js";
import { reconcilePreprodSub } from "../../src/admission/jit.js";
import { admissionRoute } from "../../src/admission/route.js";
import { authRoute, type AuthRouteOptions } from "../../src/routes/auth.js";
import type { FetchLike, OidcDiscovery } from "../../src/services/auth/oidc.js";
import { signSession } from "../../src/services/auth/session.js";
import { createReaderOpening } from "../../src/artifacts/reader-opening.js";
import { createStoredReader } from "../../src/artifacts/reader-storage.js";
import { createSharedReaderTickets } from "../../src/artifacts/reader-tickets.js";

const DB_NAME = "admission_i1";
const SCOPE = "admission_scope";
const ISSUER = "https://preprod.auth.sent-tech.ca";
const PROD_ISSUER = "https://auth.sent-tech.ca";
const ARTIFACT_ID = "123e4567-e89b-12d3-a456-426614174000";
const RELEASE_ID = "123e4567-e89b-12d3-a456-426614174001";

const AUTH: AuthConfig = {
  enabled: true,
  issuer: ISSUER,
  clientId: "radar-immobilier",
  clientSecret: "super-secret",
  redirectUri: "https://preprod.immo.sent-tech.ca/api/v1/auth/oauth/callback",
  scopes: "openid profile email",
  appBaseUrl: "https://preprod.immo.sent-tech.ca",
  sessionSecret: "admission-i1-session-secret-32bytes!",
  sessionTtlSeconds: 3600,
  sessionAbsoluteTtlSeconds: 7200,
  jwksUri: `${ISSUER}/.well-known/jwks.json`,
  bearerAudiences: ["https://preprod.immo.sent-tech.ca", "https://preprod.immo.sent-tech.ca/mcp"],
};

const DISCOVERY: OidcDiscovery = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/.well-known/jwks.json`,
};

let admin: pg.Pool;
let pool: pg.Pool;
let db: Database;
let kid: string;
let signKey: ReturnType<typeof parsePrivateKeyEntry>;
let publicKeys: ReturnType<typeof parsePublicKeyList>;

function envelopeFor(
  entries: { email: string; name?: string; status?: "pending" | "approved" | "rejected" | "suspended"; admin?: boolean }[],
  issuedAt: string,
  full: boolean,
) {
  const payload = buildAdmissionSnapshot(
    entries.map((entry) => ({
      email: entry.email,
      name: entry.name ?? null,
      status: entry.status ?? "approved",
      isAdmin: entry.admin ?? false,
      createdAt: "2026-01-01T00:00:00.000Z",
      approvedAt: "2026-02-01T00:00:00.000Z",
    })),
    { kid, issuedAt: new Date(issuedAt), full },
  );
  return signSnapshot(payload, signKey.key);
}

async function accountBySub(sub: string) {
  const rows = await db.select().from(accountUsers).where(eq(accountUsers.sub, sub)).limit(1);
  return rows[0];
}

async function seedArtifact() {
  await pool.query("INSERT INTO artifacts.storage_scopes (id, org_id) VALUES ($1,'admission_org') ON CONFLICT DO NOTHING", [SCOPE]);
  await pool.query(
    "INSERT INTO artifacts.artifacts (id, storage_scope_id, owner_id, binding_name) VALUES ($1,$2,'owner-prod-sub','admission-doc') ON CONFLICT DO NOTHING",
    [ARTIFACT_ID, SCOPE],
  );
  await pool.query(
    "INSERT INTO artifacts.releases (id, artifact_id, manifest_digest, manifest) VALUES ($1,$2,'test','{}') ON CONFLICT DO NOTHING",
    [RELEASE_ID, ARTIFACT_ID],
  );
  await pool.query(
    "INSERT INTO artifacts.artifact_current (artifact_id, release_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [ARTIFACT_ID, RELEASE_ID],
  );
}

beforeAll(async () => {
  const env = loadConfig();
  const params = {
    host: env.POSTGRES_HOST, port: env.POSTGRES_PORT, user: env.POSTGRES_USER,
    password: env.POSTGRES_PASSWORD, database: env.POSTGRES_DB,
  };
  admin = new pg.Pool(params);
  pool = new pg.Pool({ ...params, database: DB_NAME });
  try {
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../../drizzle", import.meta.url)) });
    db = drizzle(pool);
    const pair = generateAdmissionKeypair();
    kid = pair.kid;
    signKey = parsePrivateKeyEntry(pair.privateEntry);
    publicKeys = parsePublicKeyList(pair.publicEntry);
    await seedArtifact();
  } catch (error) {
    await pool.end().catch(() => undefined);
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => undefined);
    await admin.end().catch(() => undefined);
    throw error;
  }
}, 120_000);

afterAll(async () => {
  await pool.end().catch(() => undefined);
  await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => undefined);
  await admin.end().catch(() => undefined);
});

describe("I1 acceptance — first click opens the artifact", () => {
  it("should approve a prod-approved unknown user with a different sub", async () => {
    // Unknown in preprod: no account row for either identity.
    expect(await accountBySub("preprod-sub-farid")).toBeUndefined();
    // Prod admission: approved in prod (prod sub is never transmitted).
    const result = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "Farid@example.ca", name: "Farid" }], "2026-11-03T10:00:00.000Z", true),
      { publicKeys },
    );
    expect(result.applied).toBe(true);
    // First login on preprod (different sub, verified email): JIT links.
    const jit = await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-farid", email: "farid@example.ca", emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect(jit).toEqual({ linked: true, mode: "created" });
    // The mirrored row is approved with the preprod sub: getRights opens.
    const row = await accountBySub("preprod-sub-farid");
    expect(row?.status).toBe("approved");
    expect(row?.admissionSource).toBe("prod_sync");
    await pool.query(
      "INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1,$2,'read') ON CONFLICT DO NOTHING",
      [ARTIFACT_ID, "preprod-sub-farid"],
    );
    const authority = createStoredReader(pool, SCOPE, "pages.example.test", {
      getBlob: async () => null,
    }).authority;
    const rights = await authority.getRights("preprod-sub-farid", ARTIFACT_ID);
    expect(rights?.approved).toBe(true);
  });

  it("should link exactly once under two concurrent openings", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "twins@example.ca" }], "2026-11-03T11:00:00.000Z", false),
      { publicKeys },
    );
    const input = {
      sub: "preprod-sub-twins", email: "twins@example.ca", emailVerified: true, issuer: PROD_ISSUER,
    } as const;
    const ctx = { trustedIssuers: [ISSUER, PROD_ISSUER] } as const;
    const [first, second] = await Promise.all([
      reconcilePreprodSub(db, { ...input }, { ...ctx }),
      reconcilePreprodSub(db, { ...input }, { ...ctx }),
    ]);
    expect(first.linked).toBe(true);
    expect(second.linked).toBe(true);
    const rows = await pool.query(
      "SELECT count(*)::int AS n FROM account_users WHERE lower(email)=lower($1)",
      ["twins@example.ca"],
    );
    expect(rows.rows[0].n).toBe(1);
  });
});

describe("I1 acceptance — revocation propagates on the next cycle", () => {
  it("should refuse a revoked user after the next snapshot", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "leaver@example.ca" }], "2026-11-03T12:00:00.000Z", false),
      { publicKeys },
    );
    await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-leaver", email: "leaver@example.ca", emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect((await accountBySub("preprod-sub-leaver"))?.status).toBe("approved");
    // Prod revokes: next cycle carries status rejected with a newer issuedAt.
    const revoked = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "leaver@example.ca", status: "rejected" }], "2026-11-03T13:00:00.000Z", false),
      { publicKeys },
    );
    expect(revoked.applied).toBe(true);
    expect(revoked.propagated).toBe(1);
    expect((await accountBySub("preprod-sub-leaver"))?.status).toBe("rejected");
    const authority = createStoredReader(pool, SCOPE, "pages.example.test", {
      getBlob: async () => null,
    }).authority;
    await pool.query(
      "INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1,$2,'read') ON CONFLICT DO NOTHING",
      [ARTIFACT_ID, "preprod-sub-leaver"],
    );
    const rights = await authority.getRights("preprod-sub-leaver", ARTIFACT_ID);
    expect(rights?.approved).toBe(false);
  });

  it("should ignore a delayed snapshot that would resurrect a revocation", async () => {
    const stale = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "leaver@example.ca" }], "2026-11-03T12:30:00.000Z", true),
      { publicKeys },
    );
    expect(stale.applied).toBe(false);
    expect(stale.stale).toBe(true);
    expect((await accountBySub("preprod-sub-leaver"))?.status).toBe("rejected");
  });
});

describe("I1 acceptance — rejections", () => {
  it("should reject an invalid signature at ingestion", async () => {
    const good = envelopeFor([{ email: "mallory@example.ca" }], "2026-11-03T14:00:00.000Z", false);
    const tampered = {
      payload: {
        ...good.payload,
        // Flip the staged status: the bytes no longer match the signature.
        entries: [{ ...good.payload.entries[0]!, status: "rejected" as const }],
      },
      signature: good.signature,
    };
    await expect(applyAdmissionSnapshot(db, tampered, { publicKeys })).rejects.toThrow(SnapshotRejectedError);
    // Nothing staged from the forged envelope.
    const staged = await pool.query("SELECT count(*)::int AS n FROM admission_sync_profiles WHERE email=$1", [
      "mallory@example.ca",
    ]);
    expect(staged.rows[0].n).toBe(0);

    const route = admissionRoute({ db, enabled: true, publicKeys });
    const res = await route.request("/api/v1/admission/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(tampered),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("admission_invalid_signature");
  });

  it("should answer 503 when the sync is not enabled", async () => {
    const route = admissionRoute({ db, enabled: false, publicKeys });
    const res = await route.request("/api/v1/admission/ingest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(envelopeFor([{ email: "x@example.ca" }], "2026-11-03T14:00:00.000Z", false)),
    });
    expect(res.status).toBe(503);
  });

  it("should reject unverified and untrusted JIT attempts", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "pending-link@example.ca" }], "2026-11-03T15:00:00.000Z", false),
      { publicKeys },
    );
    await expect(
      reconcilePreprodSub(
        db,
        { sub: "preprod-sub-unverified", email: "pending-link@example.ca", emailVerified: false, issuer: ISSUER },
        { trustedIssuers: [ISSUER, PROD_ISSUER] },
      ),
    ).resolves.toEqual({ linked: false, reason: "unverified_email" });
    await expect(
      reconcilePreprodSub(
        db,
        { sub: "preprod-sub-untrusted", email: "pending-link@example.ca", emailVerified: true, issuer: "https://evil.test" },
        { trustedIssuers: [ISSUER, PROD_ISSUER] },
      ),
    ).resolves.toEqual({ linked: false, reason: "untrusted_issuer" });
    expect(await accountBySub("preprod-sub-unverified")).toBeUndefined();
    expect(await accountBySub("preprod-sub-untrusted")).toBeUndefined();
  });

  it("should never relink an already linked account", async () => {
    const relink = await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-impostor", email: "farid@example.ca", emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect(relink).toEqual({ linked: false, reason: "already_linked_elsewhere" });
    expect((await accountBySub("preprod-sub-farid"))?.status).toBe("approved");
  });
});

describe("I1 acceptance — local accounts survive the sync", () => {
  it("should never overwrite a local preprod account", async () => {
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('local-sub-simone','simone@example.ca','Simone','approved',false,'local')",
    );
    // The sync carries the same email with a different (admin) profile.
    const result = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "simone@example.ca", name: "Simone Prod", admin: true }], "2026-11-03T16:00:00.000Z", false),
      { publicKeys },
    );
    expect(result.applied).toBe(true);
    expect(result.propagated).toBe(0);
    const local = await accountBySub("local-sub-simone");
    expect(local?.status).toBe("approved");
    expect(local?.isAdmin).toBe(false);
    expect(local?.name).toBe("Simone");
    expect(local?.sub).toBe("local-sub-simone");
    expect(local?.admissionSource).toBe("local");
    // And JIT must not hijack the local row for another sub.
    const hijack = await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-simone-clone", email: "simone@example.ca", emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect(hijack).toEqual({ linked: false, reason: "local_conflict" });
    expect(await accountBySub("preprod-sub-simone-clone")).toBeUndefined();
  });
});

describe("I1 placement — JIT before getRights, login linking", () => {
  it("should reconcile before getRights in the reader opening flow", async () => {
    const order: string[] = [];
    const authority = {
      getAuthorizationVersion: async () => "v1",
      getContentOrigin: async () => "https://pages.example.test",
      getRelease: async () => ({ artifactId: ARTIFACT_ID, releaseId: RELEASE_ID, authorSub: "owner-prod-sub" }),
      getProfile: async () => ({ name: "radar-baskets", policyRevision: "basket-read-v1", capabilities: [] as never[] }),
      getRights: async (readerSub: string, artifactId: string) => {
        order.push("getRights");
        return { readerSub, artifactId, approved: true, capabilities: [] as never[] };
      },
    };
    const opening = createReaderOpening({
      auth: AUTH,
      contentBase: "pages.example.test",
      authority,
      tickets: createSharedReaderTickets(pool),
      issuer: { issuer: "https://preprod.immo.sent-tech.ca", audience: "x", tier: "test" },
      grantSecret: "grant-secret-32-bytes-long-padding!",
      sessionSecret: AUTH.sessionSecret,
      reconcile: async () => {
        order.push("reconcile");
        return { linked: true, mode: "already" as const };
      },
    });
    const session = await signSession(
      { sub: "preprod-sub-opener", email: "opener@example.ca", emailVerified: true, idpIssuer: ISSUER },
      { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 },
    );
    const binding = "ab".repeat(32);
    const res = await opening.application.request(
      `/approve?${new URLSearchParams({ artifactId: ARTIFACT_ID, binding })}`,
      { headers: { cookie: `radar_session=${session}` } },
    );
    expect(res.status).toBe(200);
    expect(order).toEqual(["reconcile", "getRights"]);
  });

  it("should land an unknown prod-approved user home at login, not pending", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "login-link@example.ca", name: "Login Link" }], "2026-11-03T17:00:00.000Z", false),
      { publicKeys },
    );
    // OIDC mocks: token endpoint returns an id_token with email_verified.
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "login-k1";
    pubJwk.alg = "EdDSA";
    const getKey = createLocalJWKSet({ keys: [pubJwk] });
    const nonce = "LOGIN-NONCE";
    const idToken = await new SignJWT({ nonce, email: "login-link@example.ca", email_verified: true, name: "Login Link" })
      .setProtectedHeader({ alg: "EdDSA", kid: "login-k1" })
      .setIssuer(ISSUER)
      .setAudience(AUTH.clientId)
      .setSubject("preprod-sub-login-link")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);
    const fetchImpl: FetchLike = async () => ({
      ok: true, status: 200, json: async () => ({ id_token: idToken }), text: async () => "",
    });
    const options: AuthRouteOptions = {
      discovery: DISCOVERY,
      fetchImpl,
      getKey,
      db,
      admissionTrustedIssuers: [ISSUER, PROD_ISSUER],
    };
    const app = authRoute(AUTH, options);
    const flow = { state: "LOGIN-STATE", nonce, codeVerifier: "VERIFIER" };
    const res = await app.request("/api/v1/auth/oauth/callback?code=CODE&state=LOGIN-STATE", {
      headers: { cookie: `radar_oauth_flow=${encodeURIComponent(JSON.stringify(flow))}` },
    });
    expect(res.status).toBe(302);
    // Approved via JIT: home, not /pending.
    expect(res.headers.get("location")).toBe(AUTH.appBaseUrl);
    const row = await accountBySub("preprod-sub-login-link");
    expect(row?.status).toBe("approved");
    expect(row?.admissionSource).toBe("prod_sync");
  });
});
