import { beforeEach, expect, it, vi } from "vitest";
import { writeIntentAppRoute } from "./write-intent-app-route.js";
import type { WriteAppDeps } from "./write-intent-app-authority.js";
import { challengeBootstrap, writeCsrf } from "./write-intent-app-authority.js";
import { BASKET_WRITE_PREPARE_SCOPE_ID } from "./reader-consent.js";

/**
 * R2 Gate B at write confirmation time (reader-consent design §3.3): a
 * preparation awaiting the user's in-app confirmation re-checks the live
 * `baskets.write.prepare` row before executing. Revoking the consent while
 * the preparation is pending blocks the confirm; a live row lets it run.
 */

const f = vi.hoisted(() => {
  const principal = { issuer: "https://auth.sent-tech.ca", tier: "prod", sub: "owner" };
  return { principal, access: vi.fn(), load: vi.fn(), confirm: vi.fn(),
    gate: vi.fn(),
    pass: { principal, rawCookie: "synthetic-cookie", session: { sub: "owner", iat: 1, exp: 3600 } } };
});
vi.mock("../services/facets/pw-write-store.js", () => ({ loadPwIntentForShare: f.load }));
vi.mock("../services/workspaces/store.js", () => ({
  approvedAccountId: async () => "owner-id", resolveWorkspaceAccess: f.access,
}));
vi.mock("../services/workspaces/mutations.js", () => ({ lockWorkspace: async () => {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: (client: unknown) => client }));
vi.mock("pg", () => ({ default: { Client: class {
  on() {} async connect() {} async query() {} async end() {}
} } }));
vi.mock("./write-intent-app-guard.js", () => ({
  guardWriteIntentAppSession: async () => f.pass,
  requireApprovedAppAccount: async () => null,
  assertAppMutationHeaders: () => null,
}));

const id = "11111111-1111-4111-8111-111111111111";
const ARTIFACT = "123e4567-e89b-12d3-a456-426614174000";
const row = { intentId: id, workspaceId: "workspace", principal: f.principal,
  authorityReferences: {}, executionState: "pending", revokedAt: null,
  operation: "facets.signals.personal.select.v1", challengeKeyId: "key",
  challengeId: "b".repeat(64), intentDigest: "a".repeat(64), expiresAt: new Date(60_000),
  artifactRef: { artifactId: ARTIFACT } };
const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
const client = { release: vi.fn(), transaction: async (run: (tx: unknown) => unknown) => run(tx),
  on: vi.fn(), off: vi.fn(), query: async () => ({ rows: [{ pid: 123 }] }) };
const deps = { db: { $client: { connect: async () => client, options: {} } },
  domain: { identityIssuer: f.principal.issuer, tier: "prod",
    appOrigin: "https://immo.sent-tech.ca", clientId: "client" },
  nowMs: () => 1000, sessionSecret: "synthetic-secret-with-32-characters",
  challengeKeys: new Map([["key", Buffer.alloc(32, 7)]]),
  confirm: f.confirm,
  basketConsent: { hasLiveConsent: f.gate } } as unknown as WriteAppDeps;

beforeEach(() => {
  vi.clearAllMocks();
  f.load.mockResolvedValue(row);
  f.access.mockResolvedValue({ moderateArchive: true });
  f.confirm.mockResolvedValue({});
  f.gate.mockResolvedValue(true);
});

function confirmRequest() {
  const bootstrap = challengeBootstrap(row as never, deps, f.pass as never);
  return new Request(`https://immo.sent-tech.ca/api/v1/artifacts/write-intents/${id}/confirm`, {
    method: "POST",
    headers: { "content-type": "application/json",
      origin: "https://immo.sent-tech.ca",
      "x-artifact-write-csrf": writeCsrf(deps, f.pass as never, id) },
    body: JSON.stringify({ challengeToken: bootstrap.challengeToken }),
  });
}

it("should block the confirm when the write-prepare consent was revoked while pending", async () => {
  f.gate.mockResolvedValue(false);
  const response = await writeIntentAppRoute(deps).request(confirmRequest());
  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({
    ok: false, error: { code: "basket_consent_required", action: "consent_baskets" } });
  expect(f.gate).toHaveBeenCalledWith("owner", ARTIFACT, BASKET_WRITE_PREPARE_SCOPE_ID);
  expect(f.confirm).not.toHaveBeenCalled();
});

it("should confirm when the write-prepare consent row is live", async () => {
  const response = await writeIntentAppRoute(deps).request(confirmRequest());
  expect(response.status).toBe(200);
  expect(f.gate).toHaveBeenCalledWith("owner", ARTIFACT, BASKET_WRITE_PREPARE_SCOPE_ID);
  expect(f.confirm).toHaveBeenCalledTimes(1);
});
