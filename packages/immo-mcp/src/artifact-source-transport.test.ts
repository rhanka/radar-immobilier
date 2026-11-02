import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT } from "jose";
import { ARTIFACT_P0B, createAdmissionAuthority } from "@radar/artifacts-host";
import { p0bFixture } from "../../artifacts-host/src/p0b.test-support.js";
import { bindArtifactProvider } from "./registry/artifact-provider.js";
import { createImmoHttpApp, type ImmoHttpConfig } from "./server-http.js";

const config: ImmoHttpConfig = {
  issuer: "https://synthetic.test", resource: "https://synthetic.test/mcp", requiredScopes: [],
  scopesSupported: ["immo:artifacts:read"], dataMode: "simulation", port: 0,
  sessionIdleTimeoutMs: 1000, sessionMaxLifetimeMs: 2000,
};

describe.skipIf(!ARTIFACT_P0B || !process.env.P0B_DATABASE_URL)("source admission over the MCP transport", () => {
  let h: Awaited<ReturnType<typeof p0bFixture>>;
  beforeAll(async () => { h = await p0bFixture(); });
  beforeEach(async () => { await h.pool.query("DELETE FROM artifacts.host_actor_rate"); });
  afterAll(async () => {
    if (!h) return;
    try { await h.pool.query("DROP SCHEMA artifacts CASCADE; DROP SCHEMA drizzle CASCADE; DROP TABLE account_users"); }
    finally { await h.close(); }
  });

  it.each([
    ["account", { error: "account_not_approved" }, false],
    ["activation", { error: "activation_closed" }, false],
    ["membership", { error: "workspace_membership_required" }, false],
    ["unavailable", { error: "capability_unavailable" }, true],
  ] as const)("should return a typed refusal after %s changes during the final getBlob", async (revocation, error, retryable) => {
    const { artifactId, files } = await h.page();
    expect((await h.call("publish", { artifactId, idempotencyKey: randomUUID(),
      files: [...files, { path: "app.js", mimeType: "text/javascript", text: "const privateSource = 42;" }] })).status).toBe(201);
    let enabled = true;
    let memberships = ["p0b"];
    const admission = { ...createAdmissionAuthority(h.pool, () => enabled
      ? { enabled: true, subjects: ["alice"], expiresAtMs: Number.POSITIVE_INFINITY }
      : { enabled: false, reason: "activation_off" }), readMemberships: async () => memberships };
    const artifacts = bindArtifactProvider({ app: h.host.app, storageScopeId: "p0b", admission,
      authorizeCommit: () => h.host.authorizeCommit });
    const keys = await generateKeyPair("RS256");
    const app = createImmoHttpApp(config, { artifacts, authorize: async () => true,
      keySource: { resolveKey: async () => keys.publicKey } });
    const token = await new SignJWT({ scope: "immo:artifacts:read" }).setIssuer(config.issuer).setAudience(config.resource)
      .setSubject("alice").setIssuedAt().setExpirationTime("5m").setProtectedHeader({ alg: "RS256" }).sign(keys.privateKey);
    const post = (message: object, session?: string) => app.request("/mcp", { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json",
        accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify(message) });
    const initialized = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "source-race", version: "1" } } });
    expect(initialized.status).toBe(200);
    const call = () => post({ jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "artifacts_get_source", arguments: { artifactId } } }, initialized.headers.get("mcp-session-id")!);
    const accepted = await (await call()).json() as { result: { content: { text: string }[] } };
    expect(JSON.parse(accepted.result.content[0]!.text)).toMatchObject({ artifactId,
      files: expect.arrayContaining([expect.objectContaining({ path: "app.js" })]), authoringGuide: expect.any(Object) });
    const getBlob = h.host.blobs.getBlob.bind(h.host.blobs);
    let reads = 0;
    const spy = vi.spyOn(h.host.blobs, "getBlob").mockImplementation(async (key) => {
      const bytes = await getBlob(key);
      if (++reads === 2) {
        if (revocation === "account") await h.pool.query("UPDATE account_users SET status='pending' WHERE sub='alice'");
        if (revocation === "activation") enabled = false;
        if (revocation === "membership") memberships = ["another-workspace"];
        if (revocation === "unavailable") vi.spyOn(admission, "readStatus").mockRejectedValue(new Error("private database failure"));
      }
      return bytes;
    });
    try {
      const response = await call();
      expect(response.status).toBe(200);
      const { result } = await response.json() as { result: { isError?: boolean; content: { text: string }[] } };
      expect(spy).toHaveBeenCalledTimes(2);
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0]!.text)).toEqual({ ...error, retryable });
      expect(result).not.toHaveProperty("structuredContent");
      expect(JSON.stringify(result)).not.toMatch(/privateSource|private database failure|authoringGuide|manifest|"files"/);
    } finally {
      vi.restoreAllMocks();
      await h.pool.query("UPDATE account_users SET status='approved' WHERE sub='alice'");
    }
  });
});
