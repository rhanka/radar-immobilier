import { beforeEach, expect, it, vi } from "vitest";
import { WorkspaceError } from "../services/workspaces/types.js";
import { writeIntentAppRoute } from "./write-intent-app-route.js";
import type { WriteAppDeps } from "./write-intent-app-authority.js";

const f = vi.hoisted(() => {
  const principal = { issuer: "https://auth.sent-tech.ca", tier: "prod", sub: "owner" };
  return { principal, access: vi.fn(), load: vi.fn(), render: vi.fn(),
    pass: { principal, rawCookie: "synthetic-cookie", session: { sub: "owner", iat: 1, exp: 3600 } } };
});
vi.mock("../services/facets/pw-write-store.js", () => ({ loadPwIntentForShare: f.load }));
vi.mock("../services/workspaces/store.js", () => ({
  approvedAccountId: async () => "owner-id", resolveWorkspaceAccess: f.access,
}));
vi.mock("../services/workspaces/mutations.js", () => ({ lockWorkspace: async () => {} }));
vi.mock("drizzle-orm/node-postgres", () => ({ drizzle: (client: unknown) => client }));
vi.mock("./write-intent-app-guard.js", () => ({
  guardWriteIntentAppSession: async () => f.pass,
  requireApprovedAppAccount: async () => null,
  assertAppMutationHeaders: () => null,
}));

const id = "11111111-1111-4111-8111-111111111111";
const row = { intentId: id, workspaceId: "workspace", principal: f.principal,
  operation: "facets.signals.personal.select.v1", challengeKeyId: "key",
  challengeId: "b".repeat(64), intentDigest: "a".repeat(64), expiresAt: new Date(60_000) };
const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
const client = { release: vi.fn(), transaction: async (run: (tx: unknown) => unknown) => run(tx) };
const deps = { db: { $client: { connect: async () => client } },
  domain: { identityIssuer: f.principal.issuer, tier: "prod",
    appOrigin: "https://immo.sent-tech.ca", clientId: "client" },
  nowMs: () => 1000, sessionSecret: "synthetic-secret-with-32-characters",
  challengeKeys: new Map([["key", Buffer.alloc(32, 7)]]), renderSummary: f.render } as unknown as WriteAppDeps;

beforeEach(() => {
  vi.clearAllMocks();
  f.load.mockResolvedValue(row);
  f.access.mockResolvedValue({ moderateArchive: true });
  f.render.mockImplementation((c, _row, bootstrap) => c.json({ business: true, ...bootstrap }));
});

it("should deliver the business summary to a current workspace member", async () => {
  const response = await writeIntentAppRoute(deps).request(`/artifact-write/intents/${id}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ business: true, challengeToken: expect.any(String) });
});

it("should keep only technical management after membership loss with approval intact", async () => {
  f.access.mockRejectedValue(new WorkspaceError(403, "workspace_membership_required"));
  const response = await writeIntentAppRoute(deps).request(`/artifact-write/intents/${id}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ intentId: id, management: true, csrf: expect.any(String) });
  expect(f.render).not.toHaveBeenCalled();
});

it("should keep only technical management after common archive capability loss", async () => {
  f.load.mockResolvedValue({ ...row, operation: "facets.signals.workspace.restore.v1" });
  f.access.mockResolvedValue({ moderateArchive: false });
  const response = await writeIntentAppRoute(deps).request(`/artifact-write/intents/${id}`);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ intentId: id, management: true, csrf: expect.any(String) });
  expect(f.render).not.toHaveBeenCalled();
});

it("should normalize foreign management references without changing summary identity refusal", async () => {
  f.load.mockResolvedValue({ ...row, principal: { ...f.principal, sub: "other" } });
  const app = writeIntentAppRoute(deps);
  const management = await app.request(`/api/v1/artifacts/write-intents/${id}`);
  expect(management.status).toBe(404);
  expect(await management.json()).toMatchObject({ error: { code: "write_intent_not_found", action: "refresh_state" } });
  const summary = await app.request(`/artifact-write/intents/${id}`);
  expect(summary.status).toBe(403);
  expect(await summary.json()).toMatchObject({ error: { code: "confirmation_identity_mismatch" } });
});
