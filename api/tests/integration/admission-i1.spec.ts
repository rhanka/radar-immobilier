// Lot I1 — admission prod -> preprod acceptance tests (real Postgres stack).
//
// Covers the converged-R2 I1 acceptance row: a prod-approved user unknown in
// preprod with a different sub opens a shared preprod artifact on first click;
// concurrent openings link once; prod revocation refuses after the next cycle;
// invalid signatures and unverified emails are rejected; local accounts are
// never overwritten by the sync.

import pg from "pg";
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
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
import { admissionRoute, pushAdmissionMutation } from "../../src/admission/route.js";
import { authRoute, protect, type AuthRouteOptions } from "../../src/routes/auth.js";
import { adminRoute } from "../../src/routes/admin.js";
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
      `/approve?${new URLSearchParams({ binding, origin: `https://${ARTIFACT_ID}.pages.example.test` })}`,
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

// ── Findings F1–F8 follow-up coverage (real Postgres, no mocks) ──────────
// All timestamps below stay strictly above the acceptance flow above
// (2026-11-03), because the F1 guard is a GLOBAL monotonic sequence.

function envelopeForAs(
  entries: { email: string; name?: string; status?: "pending" | "approved" | "rejected" | "suspended"; admin?: boolean }[],
  issuedAt: string,
  full: boolean,
  key: { kid: string; key: ReturnType<typeof parsePrivateKeyEntry>["key"] },
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
    { kid: key.kid, issuedAt: new Date(issuedAt), full },
  );
  return signSnapshot(payload, key.key);
}

describe("I1 F1 — no rollback across a key rotation", () => {
  it("should reject a delayed snapshot signed with a rotated-out key", async () => {
    const oldPair = generateAdmissionKeypair();
    const oldKey = parsePrivateKeyEntry(oldPair.privateEntry);
    // Rotation overlap: the current key plus the rotated-out one both verify.
    const bothKeys = new Map([...publicKeys, [oldPair.kid, oldKey.key]]);
    const email = "rotate@example.ca";

    await applyAdmissionSnapshot(db, envelopeFor([{ email }], "2026-11-04T10:00:00.000Z", false), {
      publicKeys,
    });
    await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-rotate", email, emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect((await accountBySub("preprod-sub-rotate"))?.status).toBe("approved");

    const revoked = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email, status: "rejected" }], "2026-11-04T13:00:00.000Z", false),
      { publicKeys },
    );
    expect(revoked.applied).toBe(true);
    expect((await accountBySub("preprod-sub-rotate"))?.status).toBe("rejected");

    // Delayed approval signed with the OLD key (never seen under it): the
    // per-kid guard would let it through and resurrect the account.
    const delayed = await applyAdmissionSnapshot(
      db,
      envelopeForAs([{ email }], "2026-11-04T12:30:00.000Z", false, {
        kid: oldPair.kid,
        key: oldKey.key,
      }),
      { publicKeys: bothKeys },
    );
    expect(delayed.applied).toBe(false);
    expect(delayed.stale).toBe(true);
    expect((await accountBySub("preprod-sub-rotate"))?.status).toBe("rejected");
  });
});

describe("I1 F3 — upgraded branch guards", () => {
  it("should adopt a matching pending local row and refuse every conflicting shape", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor(
        [{ email: "up-ok@example.ca" }, { email: "up-linked@example.ca" }, { email: "up-local@example.ca" }, { email: "up-null@example.ca" }],
        "2026-11-04T15:00:00.000Z",
        false,
      ),
      { publicKeys },
    );
    const ctx = { trustedIssuers: [ISSUER, PROD_ISSUER] } as const;
    const jit = (sub: string, email: string) =>
      reconcilePreprodSub(db, { sub, email, emailVerified: true, issuer: ISSUER }, { ...ctx });

    // Success: matching pending local auto-row is adopted.
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-upok','up-ok@example.ca','Up Ok','pending',false,'local')",
    );
    await expect(jit("preprod-sub-upok", "up-ok@example.ca")).resolves.toEqual({
      linked: true,
      mode: "upgraded",
    });
    const adopted = await accountBySub("preprod-sub-upok");
    expect(adopted?.status).toBe("approved");
    expect(adopted?.admissionSource).toBe("prod_sync");

    // Another sub already linked to the email: conflict, never a 500.
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-uplinked','up-linked@example.ca','Linked','approved',false,'prod_sync')",
    );
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-uplink','up-linked@example.ca','Up Link','pending',false,'local')",
    );
    await expect(jit("preprod-sub-uplink", "up-linked@example.ca")).resolves.toEqual({
      linked: false,
      reason: "already_linked_elsewhere",
    });
    expect((await accountBySub("preprod-sub-uplink"))?.admissionSource).toBe("local");

    // Another local account holding the email: no prod_sync duplicate.
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-uplocal-other','up-local@example.ca','Local Other','approved',false,'local')",
    );
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-uplocal','up-local@example.ca','Up Local','pending',false,'local')",
    );
    await expect(jit("preprod-sub-uplocal", "up-local@example.ca")).resolves.toEqual({
      linked: false,
      reason: "local_conflict",
    });

    // A pending local row with no email is never stamped with the address.
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-upnull',NULL,'Up Null','pending',false,'local')",
    );
    await expect(jit("preprod-sub-upnull", "up-null@example.ca")).resolves.toEqual({
      linked: false,
      reason: "local_conflict",
    });
    expect(await accountBySub("preprod-sub-upnull")).toMatchObject({ email: null, status: "pending" });
  });
});

describe("I1 F8 — email matching trims like the normaliser", () => {
  it("should adopt a pending local row whose email only differs by case/whitespace", async () => {
    await applyAdmissionSnapshot(db, envelopeFor([{ email: "spaced@example.ca" }], "2026-11-04T15:30:00.000Z", false), {
      publicKeys,
    });
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-spaced','  Spaced@Example.CA ','Spaced','pending',false,'local')",
    );
    await expect(
      reconcilePreprodSub(
        db,
        { sub: "preprod-sub-spaced", email: "spaced@example.ca", emailVerified: true, issuer: ISSUER },
        { trustedIssuers: [ISSUER, PROD_ISSUER] },
      ),
    ).resolves.toEqual({ linked: true, mode: "upgraded" });
  });
});

describe("I1 F4 — JIT on existing sessions and the MCP path", () => {
  const STRICT_ISSUER = "https://exchange.admission.test";
  const STRICT_AUTH: AuthConfig = {
    ...AUTH,
    strict: {
      enabled: true,
      armingRequested: true,
      issuer: STRICT_ISSUER,
      apiAudience: "https://preprod.immo.sent-tech.ca",
      mcpAudience: "https://preprod.immo.sent-tech.ca/mcp",
      workloadSub: "immo-mcp-workload",
      workloadClientId: "immo-mcp-workload",
      requiredScope: "immo:search",
      maxLifetimeS: 300,
      environment: "test",
    },
  };

  async function signExchanged(opts: {
    sub: string;
    email?: string;
    emailVerified?: boolean;
  }): Promise<{ presented: string; getKey: ReturnType<typeof createLocalJWKSet> }> {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "ex-f4";
    pubJwk.alg = "EdDSA";
    const presented = await new SignJWT({
      scope: "immo:search",
      client_id: "immo-mcp-workload",
      act: { sub: "immo-mcp-workload" },
      ...(opts.email !== undefined ? { email: opts.email } : {}),
      ...(opts.emailVerified !== undefined ? { email_verified: opts.emailVerified } : {}),
    })
      .setProtectedHeader({ alg: "EdDSA", kid: "ex-f4", typ: "at+jwt" })
      .setIssuer(STRICT_ISSUER)
      .setAudience("https://preprod.immo.sent-tech.ca")
      .setSubject(opts.sub)
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(privateKey);
    return { presented, getKey: createLocalJWKSet({ keys: [pubJwk] }) };
  }

  async function signAccessToken(opts: { sub: string; email?: string; emailVerified?: boolean }) {
    const { publicKey, privateKey } = await generateKeyPair("EdDSA", { crv: "Ed25519" });
    const pubJwk: JWK = await exportJWK(publicKey);
    pubJwk.kid = "at-f4";
    pubJwk.alg = "EdDSA";
    const accessToken = await new SignJWT({
      ...(opts.email !== undefined ? { email: opts.email } : {}),
      ...(opts.emailVerified !== undefined ? { email_verified: opts.emailVerified } : {}),
    })
      .setProtectedHeader({ alg: "EdDSA", kid: "at-f4" })
      .setIssuer(ISSUER)
      .setAudience(AUTH.bearerAudiences[0])
      .setSubject(opts.sub)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    return { accessToken, getKey: createLocalJWKSet({ keys: [pubJwk] }) };
  }

  it("should repair a pre-sync session on /me after the snapshot lands", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "f4session@example.ca" }], "2026-11-04T16:00:00.000Z", false),
      { publicKeys },
    );
    const session = await signSession(
      { sub: "preprod-sub-f4me", email: "f4session@example.ca", emailVerified: true, idpIssuer: ISSUER },
      { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 },
    );
    const app = authRoute(AUTH, { db, admissionTrustedIssuers: [ISSUER, PROD_ISSUER] });
    const res = await app.request("/api/v1/auth/me", { headers: { cookie: `radar_session=${session}` } });
    expect(res.status).toBe(200);
    expect((await res.json()).user.status).toBe("approved");
    expect((await accountBySub("preprod-sub-f4me"))?.admissionSource).toBe("prod_sync");
  });

  it("should let the same repaired session through cookie protect", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "f4cookie@example.ca" }], "2026-11-04T16:01:00.000Z", false),
      { publicKeys },
    );
    const session = await signSession(
      { sub: "preprod-sub-f4cookie", email: "f4cookie@example.ca", emailVerified: true, idpIssuer: ISSUER },
      { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 },
    );
    const app = new Hono();
    app.use("*", protect(AUTH, { db, admissionTrustedIssuers: [ISSUER, PROD_ISSUER] }));
    app.get("/api/protected", (c) => c.json({ ok: true }));
    const res = await app.request("/api/protected", { headers: { cookie: `radar_session=${session}` } });
    expect(res.status).toBe(200);
    expect((await accountBySub("preprod-sub-f4cookie"))?.status).toBe("approved");
  });

  it("should JIT-link a first-time MCP user on the strict exchanged path", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "f4strict@example.ca" }], "2026-11-04T16:02:00.000Z", false),
      { publicKeys },
    );
    const { presented, getKey } = await signExchanged({
      sub: "preprod-sub-f4strict",
      email: "f4strict@example.ca",
      emailVerified: true,
    });
    const app = new Hono();
    app.use(
      "*",
      protect(STRICT_AUTH, { db, bearerGetKey: getKey, admissionTrustedIssuers: [STRICT_ISSUER, ISSUER] }),
    );
    app.get("/api/v1/mcp/facets/signals/search", (c) => c.json({ ok: true }));
    const res = await app.request("/api/v1/mcp/facets/signals/search?city=valleyfield", {
      headers: { authorization: `Bearer ${presented}` },
    });
    expect(res.status).toBe(200);
    expect((await accountBySub("preprod-sub-f4strict"))?.admissionSource).toBe("prod_sync");
  });

  it("should keep refusing the strict path when the exchanged token carries no email", async () => {
    const { presented, getKey } = await signExchanged({ sub: "preprod-sub-f4strict-noemail" });
    const app = new Hono();
    app.use(
      "*",
      protect(STRICT_AUTH, { db, bearerGetKey: getKey, admissionTrustedIssuers: [STRICT_ISSUER, ISSUER] }),
    );
    app.get("/api/v1/mcp/facets/signals/search", (c) => c.json({ ok: true }));
    const res = await app.request("/api/v1/mcp/facets/signals/search?city=valleyfield", {
      headers: { authorization: `Bearer ${presented}` },
    });
    expect(res.status).toBe(403);
    expect(await accountBySub("preprod-sub-f4strict-noemail")).toBeUndefined();
  });

  it("should JIT-link a first-time user on the plain Bearer [REDACTED]", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "f4bearer@example.ca" }], "2026-11-04T16:03:00.000Z", false),
      { publicKeys },
    );
    const { accessToken, getKey } = await signAccessToken({
      sub: "preprod-sub-f4bearer",
      email: "f4bearer@example.ca",
      emailVerified: true,
    });
    const app = new Hono();
    app.use("*", protect(AUTH, { db, bearerGetKey: getKey, admissionTrustedIssuers: [ISSUER, PROD_ISSUER] }));
    app.get("/api/protected", (c) => c.json({ ok: true }));
    const res = await app.request("/api/protected", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(res.status).toBe(200);
    expect((await accountBySub("preprod-sub-f4bearer"))?.admissionSource).toBe("prod_sync");
  });
});

describe("I1 F7 — no replay, admin reset, honest push", () => {
  it("should not replay markedAbsent on a repeated full cycle", async () => {
    const first = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "keep-a@example.ca" }, { email: "gone-a@example.ca" }], "2026-11-04T17:00:00.000Z", true),
      { publicKeys },
    );
    expect(first.applied).toBe(true);
    const second = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "keep-a@example.ca" }], "2026-11-04T17:01:00.000Z", true),
      { publicKeys },
    );
    expect(second.applied).toBe(true);
    expect(second.markedAbsent).toBe(1);
    const staged = await pool.query("SELECT status FROM admission_sync_profiles WHERE email=$1", ["gone-a@example.ca"]);
    expect(staged.rows[0]?.status).toBe("rejected");
    const third = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "keep-a@example.ca" }], "2026-11-04T17:02:00.000Z", true),
      { publicKeys },
    );
    expect(third.applied).toBe(true);
    expect(third.markedAbsent).toBe(0);
  });

  it("should reset isAdmin when a revocation propagates to the mirror row", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "adminreset@example.ca", admin: true }], "2026-11-04T17:10:00.000Z", false),
      { publicKeys },
    );
    await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-adminreset", email: "adminreset@example.ca", emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect((await accountBySub("preprod-sub-adminreset"))?.isAdmin).toBe(true);
    const full = await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "keep-a@example.ca" }], "2026-11-04T17:11:00.000Z", true),
      { publicKeys },
    );
    expect(full.applied).toBe(true);
    const mirror = await accountBySub("preprod-sub-adminreset");
    expect(mirror?.status).toBe("rejected");
    expect(mirror?.isAdmin).toBe(false);
  });

  it("should report a stale mutation push as not emitted", async () => {
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('prod-sub-push','pushprod@example.ca','Push Prod','approved',false,'local')",
    );
    const staleFetch = (async () => ({
      ok: true,
      json: async () => ({ ok: true, applied: false, stale: true, kid: "k", issuedAt: "", full: false }),
    })) as unknown as typeof fetch;
    const stale = await pushAdmissionMutation(
      { db, kid: "k", key: signKey.key, pushUrl: "https://preprod.test/ingest", fetchImpl: staleFetch },
      "prod-sub-push",
    );
    expect(stale).toEqual({ pushed: false, reason: "push_stale" });

    const appliedFetch = (async () => ({
      ok: true,
      json: async () => ({ ok: true, applied: true, stale: false, kid: "k", issuedAt: "", full: false }),
    })) as unknown as typeof fetch;
    const applied = await pushAdmissionMutation(
      { db, kid: "k", key: signKey.key, pushUrl: "https://preprod.test/ingest", fetchImpl: appliedFetch },
      "prod-sub-push",
    );
    expect(applied).toEqual({ pushed: true });
  });
});

describe("I1 F6 — real reader opening and branch coverage", () => {
  it("should open for a first-time user through real reconcile and real getRights", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "opener-real@example.ca", name: "Real Opener" }], "2026-11-04T18:00:00.000Z", false),
      { publicKeys },
    );
    await pool.query(
      "INSERT INTO artifacts.artifact_access (artifact_id, principal_id, permission) VALUES ($1,$2,'read') ON CONFLICT DO NOTHING",
      [ARTIFACT_ID, "preprod-sub-realopen"],
    );
    const stored = createStoredReader(pool, SCOPE, "pages.example.test", { getBlob: async () => null });
    const opening = createReaderOpening({
      auth: AUTH,
      contentBase: "pages.example.test",
      authority: stored.authority,
      getArtifactIdForRelease: stored.getArtifactIdForRelease,
      tickets: createSharedReaderTickets(pool),
      issuer: { issuer: "https://preprod.immo.sent-tech.ca", audience: "x", tier: "test" },
      grantSecret: "grant-secret-32-bytes-long-padding!",
      sessionSecret: AUTH.sessionSecret,
      reconcile: (input) =>
        reconcilePreprodSub(
          db,
          { sub: input.sub, ...(input.email !== undefined ? { email: input.email } : {}), emailVerified: input.emailVerified, issuer: input.issuer },
          { trustedIssuers: [ISSUER, PROD_ISSUER] },
        ),
    });
    // Local pending auto-row from a pre-sync login: adopted, then approved.
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('preprod-sub-realopen','opener-real@example.ca','Real Opener','pending',false,'local')",
    );
    const session = await signSession(
      { sub: "preprod-sub-realopen", email: "opener-real@example.ca", emailVerified: true, idpIssuer: ISSUER },
      { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 },
    );
    const binding = "ab".repeat(32);
    const res = await opening.application.request(
      `/approve?${new URLSearchParams({ binding, origin: `https://${ARTIFACT_ID}.pages.example.test` })}`,
      { headers: { cookie: `radar_session=${session}` } },
    );
    expect(res.status).toBe(200);
    const row = await accountBySub("preprod-sub-realopen");
    expect(row?.status).toBe("approved");
    expect(row?.admissionSource).toBe("prod_sync");
  });

  it("should re-admit a locally revoked link (reapproved) without relinking", async () => {
    await applyAdmissionSnapshot(
      db,
      envelopeFor([{ email: "reapprove@example.ca" }], "2026-11-04T18:01:00.000Z", false),
      { publicKeys },
    );
    await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-reapprove", email: "reapprove@example.ca", emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    // Local change after the link: the mirror row is rejected while prod
    // still approves it.
    await pool.query("UPDATE account_users SET status='rejected' WHERE sub='preprod-sub-reapprove'");
    const outcome = await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-reapprove", email: "reapprove@example.ca", emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect(outcome).toEqual({ linked: true, mode: "reapproved" });
    expect((await accountBySub("preprod-sub-reapprove"))?.status).toBe("approved");
  });

  it("should report the admin mutation emission honestly", async () => {
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('admin-sub-f6','admin-f6@example.ca','Admin F6','approved',true,'local')",
    );
    await pool.query(
      "INSERT INTO account_users (sub, email, name, status, is_admin, admission_source) VALUES ('target-sub-f6','target-f6@example.ca','Target F6','pending',false,'local')",
    );
    const adminSession = await signSession({ sub: "admin-sub-f6" }, { sessionSecret: AUTH.sessionSecret, ttlSeconds: 3600 });
    const withEmit = (pushed: boolean) =>
      adminRoute({
        db,
        sessionSecret: AUTH.sessionSecret,
        admission: { emit: async () => ({ pushed }) },
      });
    const okRes = await withEmit(true).request(
      `/api/v1/admin/users/${encodeURIComponent("target-sub-f6")}/status`,
      {
        method: "POST",
        headers: { cookie: `radar_session=${adminSession}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "approved" }),
      },
    );
    expect(okRes.status).toBe(200);
    expect((await okRes.json()).admissionEmitted).toBe(true);
    const staleRes = await withEmit(false).request(
      `/api/v1/admin/users/${encodeURIComponent("target-sub-f6")}/status`,
      {
        method: "POST",
        headers: { cookie: `radar_session=${adminSession}`, "content-type": "application/json" },
        body: JSON.stringify({ status: "suspended" }),
      },
    );
    expect(staleRes.status).toBe(200);
    expect((await staleRes.json()).admissionEmitted).toBe(false);
  });
});

describe("I1 F2 — concurrent snapshot and revocation serialise", () => {
  it("should always converge on the newer revocation, never resurrect", async () => {
    const email = "aaa-race-leaver@example.ca";
    await applyAdmissionSnapshot(db, envelopeFor([{ email }], "2026-11-04T19:00:00.000Z", false), {
      publicKeys,
    });
    await reconcilePreprodSub(
      db,
      { sub: "preprod-sub-race", email, emailVerified: true, issuer: ISSUER },
      { trustedIssuers: [ISSUER, PROD_ISSUER] },
    );
    expect((await accountBySub("preprod-sub-race"))?.status).toBe("approved");

    // Slow FULL snapshot (older, keeps the approval) racing a fast
    // incremental revocation (newer). The filler mass keeps the full ingest
    // in flight long after the revocation commits.
    const fillers = Array.from({ length: 1200 }, (_, index) => ({
      email: `f2fill${String(index).padStart(4, "0")}@example.ca`,
    }));
    const slowFull = envelopeFor([{ email }, ...fillers], "2026-11-04T19:01:00.000Z", true);
    const fastRevocation = envelopeFor([{ email, status: "rejected" }], "2026-11-04T19:02:00.000Z", false);

    const slow = applyAdmissionSnapshot(db, slowFull, { publicKeys });
    // Only start the revocation once the full ingest visibly holds the lock
    // and is mid-loop: the outcome must not depend on commit order.
    const deadline = Date.now() + 10_000;
    for (;;) {
      const counted = await pool.query(
        "SELECT count(*)::int AS n FROM admission_sync_profiles WHERE email LIKE 'f2fill%'",
      );
      if ((counted.rows[0]?.n as number) >= 3) break;
      if (Date.now() > deadline) throw new Error("f2 slow ingest never started");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const revocation = await applyAdmissionSnapshot(db, fastRevocation, { publicKeys });
    const fullResult = await slow;

    expect(revocation.applied).toBe(true);
    expect(fullResult.stale === true || fullResult.applied === true).toBe(true);
    const state = await pool.query("SELECT max(issued_at) AS m FROM admission_sync_state");
    expect(new Date(state.rows[0].m as string).toISOString()).toBe("2026-11-04T19:02:00.000Z");
    expect((await accountBySub("preprod-sub-race"))?.status).toBe("rejected");
  }, 120_000);
});
